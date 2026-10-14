# Octop 阿里云生产部署方案

## 服务器准备

### ECS 实例信息

| ECS     | 信息                   |
| ------- | ---------------------- |
| 实例 ID | i-uf6b7cnyb3qyh593p576 |
| 名称    | prod2-python           |
| 公网    | 139.196.234.43         |
| 私网    | 172.21.184.54          |

### SSL 证书

同一 VPC 下的其他 ECS 通过 `prod-python(106.14.33.55)` 共享 `*.meerkatai.cn` 泛域名证书。

`prod-python(106.14.33.55)` 的 `deploy.sh` 在每次 cerbot 续期时，自动经内网（`172.21.184.54`）scp 到 `prod2-python(139.196.234.43)` 。

## 方案一：Github Actions + 容器镜像服务 ACR

### 容器镜像服务 ACR

| 镜像仓库           | 信息                                                         |
| ------------------ | ------------------------------------------------------------ |
| 仓库名称           | mapid                                                        |
| 仓库地域           | 华东2（上海）                                                |
| 仓库类型           | 私有                                                         |
| 公网地址           | `crpi-5ftd6t47c80kdz6q.cn-shanghai.personal.cr.aliyuncs.com/meerkatai/mapid` |
| 专有网络           | `crpi-5ftd6t47c80kdz6q-vpc.cn-shanghai.personal.cr.aliyuncs.com/meerkatai/mapid` |
| 访问凭证的登录密码 | <ACR_PASSWORD>                                                |

### Github 侧配置

#### 仓库配置 Actions Secret

| Name         | Value                                                      |
| ------------ | ---------------------------------------------------------- |
| ACR_REGISTRY | crpi-5ftd6t47c80kdz6q.cn-shanghai.personal.cr.aliyuncs.com |
| ACR_USERNAME | <ACR_USERNAME>                                         |
| ACR_PASSWORD | <ACR_PASSWORD>                                              |

#### 创建 workflow 文件

详见 `.github/workflows/docker-publish-acr.yml`。

#### 部署流程

```tex
① 开发者合并/推送代码到 meerkat 分支
        │
        ▼
② GitHub Actions (docker-publish-acr.yml)
     - checkout 源码
     - 用 secrets 登录 ACR
     - docker build（阶段1: npm/vite 前端 → 阶段2: Python 运行时 + 前端产物）
     - 推送镜像 → ACR
        │
        ▼
③ 阿里云 ACR  —— 存储镜像  meerkatai/mapid:latest + :sha-xxxx
        │
        ▼
④ ECS 139.196.234.43
     - docker compose pull   （拉新镜像，私有仓库要先 docker login）
     - docker compose up -d  （重启容器，监听 127.0.0.1:8088）
        │
        ▼
⑤ 本机 nginx（443 + 证书 *.meerkatai.cn，反代 + SSE/WebSocket）
        │
        ▼
⑥ 用户访问 https://mapid.meerkatai.cn   （DNS: mapid → 139.196.234.43）
```

**关键节点**：

1. **构建**

   Actions 里出镜像，前后端都在这一步编译；

   - 阶段1（前端编译）：用 `node:20-slim`，`npm ci` + `vite build`，把 React 编译成静态文件，产物落在 `/build/src/octop/dashboard/`（`docker/Dockerfile:36-58`）。

   - 阶段2（运行时组装）：：用 `python:3.12-slim`，`uv sync` 装好 Python 依赖到 `/app/.venv`，拷入 `src/` 源码，再把阶段 1 的前端产物拷进来（`docker/Dockerfile:116`）。

2. **存储**

   ACR 私有仓库，产出 `latest` + `sha-xxx` 两个 tag；

3. **拉取**

   ECS 从 ACR 拉（私有仓库必须 `docker login`）；

4. **运行**

   容器绑定 `127.0.0.1:8088`，只给本机 nginx，数据在 `/opt/octop-data`

5. **入口 Nginx**

   前端打包进了后端，FastAPI 直接托管编译好的 React 项目。所以 Nginx 在这里主要做三件事：

   - **HTTPS(443)**：容器里的 Python 只跑 HTTP(127.0.0.1:8088)。对外需要暴露 443，且加载 `*.meerkatai.cn` 证书的是 nginx。

   - **反代转发**：`https://mapid...` ➡️ `http://127.0.0.1:8088`

   - **SSE / WebSocket 特殊处理**：Octop 的流式对话是 SSE、终端/浏览器是 WebSocket。nginx 要把缓冲关掉（`proxy_buffering off`）、转发 `Upgrade` 头、设长超时，否则流式会卡、WS 连不上。

   - 其实，Octop 自身也能做 TLS（内置 Let's Encrypt 签发，见 `docs/api.md:428`）。如果不用 nginx，可以让应用直接监听 443 管证书。但 `prod2-python` 上已有 nginx + 现成证书，所以用 nginx 最省事。

6. **初始化**

   首次启动 entrypoint 自动 `octop init`，密码写 `credential.txt`

   `octop init` 会：

   - 创建 `~/.octop/` 目录结构
   - 创建控制面数据库（默认 SQLite octop.db） 并跑迁移
   - 生成 JWT 密钥
   - 创建第一个管理员用户（用户名 + 密码）

   执行完把用户名/密码写进 `/data/.octop/credential.txt（docker/docker-entrypoint.sh:48-100）`

   密码来源：`OCTOP_DEFAULT_PASSWORD`；不设置就自动生成随机强密码。同时首次启动服务器还会播种默认的 main agent 和内置插件。

## 方案二：Github workflow + ECS 自托管 Runner

`Github workflow` 不执行打包部署相关的操作，只负责调度任务，会通知到 ECS 内部的 Runner，Runner 自动开始构建镜像，重启 Docker 服务。

### 部署流程

```tex
push meerkat ──► GitHub 派发 ──► .43 自托管 Runner（ghrunner）
                                   │ docker build -t octop:meerkat
                                   │ docker compose -f /opt/octop-deploy/... up -d
                                   ▼
                            容器 octop（127.0.0.1:8088，健康）
                                   │
        DNS mapid → 139.196.234.43 ▼
                            nginx 443（*.meerkatai.cn 证书）+ 反代（SSE/WS）
                                   ▼
                        用户 https://mapid.meerkatai.cn
```

### Nginx 配置

详见 `/etc/nginx/nginx.conf`

### 后续发版

1. 改代码 → 合并/推送到 meerkat 分支

2. 自动触发 → 在 `.43` 上构建并重启容器（健康检查通过才算成功）

3. 回滚

   ```bash
   docker tag octop:sha-<提交前12位> octop:meerkat && docker compose -f /opt/octop-deploy/docker-compose.yml up -d
   ```

## 关于沙箱

### 目前生产环境沙箱的现状

当前生产的"沙箱"= octop 应用容器本身。换句话说，agent 都在整个 octop  容器本身内执行，没有给每个 agent 单独配置隔离的运行沙箱。

### Agent 执行后的文件都在哪里？能下载吗？

`/opt/octop-data` 挂到 Docker 容器 `/data/.octop`，而 Agent 的 `workspace_dir` 是 `/data/.octop/agents/<id>`（也就是前端展示的工作区），正好在挂载卷下。所以 Agent 的产物也在其中。

挂载卷不会因容器的重启而丢失，所以可以做到持久化。文件在前端都能展示和下载。

### Octop 的「存储后端」是什么？

管理存储后端（本地、对象存储、沙箱、数据库），供专家使用。

目前有：

1. **本地文件系统**

   `本地文件系统`（也就是 octop 容器自己的 fs）只能进行文件读写（只能聊天，用不上）。

2. **本地 Shell**

   `本地 Shell`（也就是 harness 的 `local_shell`）能进行文件读写与命令执行。

   根目录（`root_dir`）默认是 `/`，也就是该容器的根文件系统（不是 ECS 宿主机的 `/`）。它包括容器整个 rootfs：`/app`、`/tmp`、以及挂载卷 `/data/.octop/agents/<id>/`（这个才是持久的）等。也就是说现在 agent 的虚拟根是"整个容器"，能看到的范围很大。

   如果想收窄隔离`本地Shell`，就可以缩小根目录（`root_dir`）的范围，但是需要注意以下几点：

   - 根目录不能是 Linux 系统级目录。比如 `/root`、`/etc`、`/sys` 等。
   - 根目录需要覆盖 `agent` 的 `workspace_dir`，也就是 root_dir 必须是 workspace_dir 的祖先或本身。否则产物写不到挂载卷，也就没有持久化。
   - 如果该用户本身被设置了「允许的存储根目录」，那么 `root_dir` 必须落在其范围内，否则直接报错。但是容器环境会被忽略，因为容器本身就是隔离的（用户不能设置账号级别的「允许的存储根目录」）。

3. **沙箱**

   目前默认 Agent 都没有配置单独的运行时隔离，全部跑在 `octop:meerkat` 项目容器内。

   如果想让执行进入隔离沙箱，可以选择配置 Docker/OpenSandbox。

   **Docker 沙箱**

   Docker 沙箱会另起一个独立的 Docker 容器作为 agent 的沙箱。

   octop 通过 socket 驱动`宿主 daemon`，让宿主另起兄弟容器当沙箱。具体关系如图所示：

   ```tex
   ECS 宿主机
   ├── dockerd（宿主已有的 Docker daemon，正是它在跑 octop:meerkat）
   ├── 容器 octop:meerkat
   │      └── 里面：docker python SDK ──socket──> 宿主 daemon
   ├── 容器 octop_sandbox_agent_<id>   ← daemon 为每个 agent 新建的沙箱
   └── 容器 octop_sandbox_agent_<id2>
   ```

   一句话：Docker 沙箱 = 让 octop 容器借**用宿主已有的 Docker** 去**另开独立容器**跑 agent；octop 容器内既不装引擎、也不套娃，**只装个 SDK 和一根通向 daemon 的 socket**。

   **优点：** 真隔离、可控网络与资源、可复用持久、不依赖 userns。

   **缺点：** 代价是必须挂 `docker.sock`（=把宿主 Docker 控制权交出去），加上文件两处落盘/不持久、容器堆积、offload 错位、联网两难。

   **OpenSandbox 沙箱**

   **优点：**真隔离、不碰宿主 socket、无孤儿容器、开源可自建，且绕过了 bwrap/userns 限制。
   **缺点：**必须有个远端服务 + 数据出域 + octop 层文件易失 + 延迟 + 版本锁。

   **本地 Shell / Docker 沙箱 / OpenSandbox 横向对比**

   | 维度 | 本地 Shell（`local_shell`） | Docker 沙箱 | OpenSandbox |
   | --- | --- | --- | --- |
   | 隔离强度 | 弱（进程级软约束；容器内 bwrap 失效） | 强（独立容器，namespace + cgroup） | 强（远程容器 / microVM） |
   | 执行位置 | octop 容器内 | 宿主 daemon 新建的兄弟容器 | 远端沙箱服务 |
   | 需宿主 Docker socket | 否 | **是**（挂 `docker.sock`，≈交出宿主 Docker 控制权） | 否 |
   | 文件落点 | 容器 FS；`workspace_dir` 在挂载卷内 | 容器内同名路径（不落宿主卷） | 远端沙箱内 |
   | 持久性 | 挂载卷内持久 | 容器存活期持久，`destroy` 即丢 | agent 停止即销毁（易失） |
   | 资源限制 | 无 | 有（memory / cpu / pids） | 有（模板 / 资源规格） |
   | 网络控制 | 无（随容器网络） | 默认断网，可显式开启 | 支持 per-sandbox egress 策略（octop 暴露有限） |
   | 外部依赖 | 无 | 宿主 dockerd | 一个 OpenSandbox 服务端 |
   | 数据位置 | 本机（容器） | 本机（容器） | 远端（数据出域） |
   | 延迟 | 本地，最低 | 本地，低 | 远程，较高 |
   | 运维成本 | 低 | 中（删专家不回收容器，需手动清理） | 中高（需自建 / 托管服务） |
   | 前端可见 / 下载 | 是 | 是（走 backend 进容器读） | 是（专家工作区可预览） |
   | **优点** | 零依赖、最简单、产物落挂载卷持久 | 真隔离、可控网络与资源、容器可复用持久、不依赖 userns | 真隔离、不碰宿主 socket、无孤儿容器、开源可自建、绕过 bwrap/userns 限制 |
   | **缺点** | 无真隔离（且容器内 bwrap 失效，几乎等于裸跑） | 需挂 `docker.sock`、文件两处落盘不同步、容器堆积、offload 错位、联网两难 | 需一个远端服务、数据出域、octop 层文件易失、延迟、SDK 版本锁（0.1.x） |
   | **适合场景** | 单机 / 自托管、信任代码、追求简单与产物持久 | 需要真隔离且能接受 socket 风险、单机规模、可自行回收容器 | 云上多租户 / 跑不可信代码、不想碰宿主 Docker、可接受远端服务与数据出域 |

   一句话选型：**要简单且信任代码 → 本地 Shell；要真隔离且愿担 socket 风险 → Docker 沙箱；要真隔离又不想碰宿主 Docker（云上多租户）→ OpenSandbox（需额外解决持久化）。**

4. **对象存储**

   目前默认 Agent 的工作区都在容器的挂载卷上。

   如果想把 Agent工作区放到远端对象存储上，可以配置 OSS/COS/S3。

5. **数据库**

   目前默认是 SQLite 数据库。

   octop 有三层存储（ADR 002）：**控制面**（users / agents / channels / cron / settings / secrets）、**harness checkpoints**、**agent memory**。控制面可选 SQLite 或 PostgreSQL（`OCTOP_DATABASE_DRIVER=sqlite|postgresql`，默认 `sqlite`）。

   **PostgreSQL 与 SQLite 的区别**

   - **SQLite**：嵌入式、单文件（`octop.db`）、零依赖；WAL 模式下"多读单写"（写串行）；备份 = 拷贝文件。
   - **PostgreSQL**：独立数据库服务（C/S，走网络连接）；MVCC + 行级锁，支持多连接并发读写；类型/索引/事务隔离更丰富，支持扩展（如 pgvector）；支持复制、PITR、监控，可用托管实例（如阿里云 RDS）。

   | 维度 | SQLite | PostgreSQL |
   | --- | --- | --- |
   | 形态 | 单文件（`octop.db`），嵌入式 | 独立服务，网络连接 |
   | 依赖 | 零依赖 | 需单独部署或托管 |
   | 并发写 | WAL：多读单写，写串行 | MVCC + 行锁，多连接并发写 |
   | 备份 / 恢复 | 拷贝文件即可 | `pg_dump -Fc` / 实例快照 |
   | 类型 / 扩展 | 有限 | 丰富类型、索引、事务隔离、可扩展 |
   | 高可用 / 复制 | 无 | 主从复制、PITR、监控、托管 |
   | memory / checkpoint | 每 workspace 一个 `memory.sqlite` | 复用控制面 DSN，按 agent 建 schema |
   | 多实例共写 | 不支持 | octop 仍为单活跃写者（非多实例方案） |

   **PostgreSQL**

   - 优点：并发写能力强；状态可外置到托管实例（备份 / PITR / 高可用 / 监控）；memory 与 checkpoints 可集中管理；类型与扩展丰富；更利于合规。
   - 缺点：多一个组件和运维面；octop 启动时依赖它可达；备份 / 恢复更重；octop 切换到 PG 属 **greenfield（无自动迁移）**；仍非多实例共写方案。

   **SQLite**

   - 优点：零依赖、单文件、部署最简单；备份 = 拷贝文件；单机低并发场景完全够用（当前生产即是）。
   - 缺点：写是串行的（高并发写会成瓶颈）；不便跨进程 / 实例共享；无复制 / 高可用 / PITR；扩展能力有限。

   **使用场景**

   - 选 **SQLite**：单机 / 自托管、单实例、读写量不大、追求零运维。—— 当前生产（`octop:meerkat` + `/opt/octop-data` 卷）就属于此类。
   - 选 **PostgreSQL**：多用户 / 多 agent 高频并发写、需要托管高可用与集中备份、要求状态外置合规、希望 memory / checkpoint 集中管理。
