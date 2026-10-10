# CI/CD：GitHub Actions 部署到本地 Mac Mini

本仓库的持续交付链路：**push 到 `meerkat` 分支 → GitHub Actions 自托管 Runner（就在目标 Mac Mini 上）就地构建镜像 → 本机 Docker 重启容器**。

## 为什么是自托管 Runner

Mac Mini 通常在公司/家庭内网、没有公网入口，GitHub 的云端托管 Runner **无法主动连入**。自托管 Runner 由 Mac Mini **主动外连** GitHub 领取任务，因此：

- 不需要公网 IP、端口映射或内网穿透；
- 不需要把镜像推到任何镜像仓库（虽然后台仍可选，见文末）；
- 部署命令直接在本机执行，延迟低。

```
开发者 push meerkat
        │
        ▼
GitHub Actions（云）──派发任务──► 自托管 Runner（Mac Mini 常驻进程）
                                        │  checkout 源码
                                        │  docker compose up -d --build
                                        ▼
                                 Docker Desktop：octop 容器（数据卷 ~/.octop）
```

## 相关文件

| 文件 | 作用 |
|------|------|
| `.github/workflows/deploy-mac-mini.yml` | 部署工作流（本 Runbook 的操作对象） |
| `docker/docker-compose.yml` | 被工作流调用的 Compose 定义（`build:` + `~/.octop` 数据卷） |
| `docker/Dockerfile` | 多阶段镜像构建（前端 Node + Python 运行时） |

## 前置条件（在 Mac Mini 上）

- Apple Silicon（arm64）macOS，已登录桌面会话；
- 已安装 **Docker Desktop**，并开启「开机/登录自启动」，`docker version` 可用；
- 有该仓库的 `admin` 权限（生成 Runner 注册令牌需要）。

## 步骤 1：安装 Docker Desktop

从 https://www.docker.com/products/docker-desktop/ 安装后，在 Docker Desktop → Settings → General 勾选 **Start Docker Desktop when you sign in**。

> 自托管 Runner 在 macOS 上以当前登录用户的 LaunchAgent 运行，因此**需要用户保持登录**（可用「自动登录」+「锁屏」组合）。

## 步骤 2：安装自托管 Runner

先获取注册令牌：仓库 **Settings → Actions → Runners → New self-hosted runner → macOS / arm64**，页面给出的命令里含一次性 `--token`（有效期 1 小时）。

在 Mac Mini 上执行（用**日常登录的那个用户**，不要用 root）：

```bash
mkdir -p ~/actions-runner && cd ~/actions-runner

# 取最新 Runner 版本（跟随 releases/latest 的重定向，不依赖 API 配额）
RUNNER_VERSION="$(curl -fsSL -o /dev/null -w '%{url_effective}' \
  https://github.com/actions/runner/releases/latest | sed 's#.*/v##')"
echo "runner version: ${RUNNER_VERSION}"
curl -fL -o actions-runner.tar.gz \
  "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-osx-arm64-${RUNNER_VERSION}.tar.gz"
tar xzf actions-runner.tar.gz

# 注册，自定义标签 meerkat-macmini（工作流按此标签匹配）
./config.sh \
  --url https://github.com/MeerkatAIChina/meerkatai-octop \
  --token <REGISTRATION_TOKEN> \
  --name macmini-octop \
  --labels meerkat-macmini \
  --work _work
```

先前台自测一次，确认能领到任务：

```bash
./run.sh   # 出现 "Listening for Jobs" 即可 Ctrl-C 退出
```

## 步骤 3：注册为常驻服务

```bash
./svc.sh install      # 安装 LaunchAgent（当前登录用户）
./svc.sh start
./svc.sh status
```

之后可在仓库 **Settings → Actions → Runners** 看到 `macmini-octop` 处于 **Idle**。机器重启并登录后服务会自动拉起。

> **Docker CLI 路径**：Docker Desktop 把 CLI 装在 `~/.docker/bin`，而 Runner 作为 LaunchAgent 启动时 PATH 很干净。工作流已显式 `export PATH="$HOME/.docker/bin:$PATH"`，因此无需再做系统级软链或 `.path` 配置（`.path` 会被 Runner 的 `env.sh` 覆盖，不可依赖）。

## 步骤 3.5：无人值守重启（可选，但长期部署强烈建议）

Runner 以 **LaunchAgent** 运行，只在「存在图形登录会话」时启动；Docker Desktop 同样依赖登录会话。若希望 Mac Mini 掉电 / 重启后自动恢复，需要：

1. **Docker Desktop 登录自启**（二选一，建议都做）：
   - GUI：Docker Desktop → Settings → General → 勾选 *Start Docker Desktop when you sign in*（对应 `settings-store.json` 中 `AutoStart: true`）；
   - 兜底 LaunchAgent（GUI 勾选项未注册登录项时也能生效）：
     ```bash
     cat > ~/Library/LaunchAgents/com.meerkat.docker-autostart.plist <<'PLIST'
     <?xml version="1.0" encoding="UTF-8"?>
     <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
     <plist version="1.0">
     <dict>
       <key>Label</key><string>com.meerkat.docker-autostart</string>
       <key>ProgramArguments</key>
       <array><string>/usr/bin/open</string><string>/Applications/Docker.app</string></array>
       <key>RunAtLoad</key><true/>
       <key>LimitLoadToSessionType</key><string>Aqua</string>
     </dict>
     </plist>
     PLIST
     launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.meerkat.docker-autostart.plist
     ```
2. **系统自动登录**：系统设置 → 用户与群组 → 自动登录 → 选择 `meerkat`；或：
   ```bash
   sudo sysadminctl -autologin set -userName meerkat -password '<password>'
   ```
   > ⚠️ **FileVault 开启时无法自动登录**（macOS 硬限制；`sysadminctl -autologin` 会报 `Automatic login is disabled because FileVault is enabled.`）。此时只能二选一：保持 FileVault（断电/重启后需人工解锁一次，之后 Docker 与 Runner 自动拉起），或关闭 FileVault 后再设自动登录：
   > ```bash
   > sudo fdesetup disable      # 安全下降：磁盘不再加密；解密需时间且机器要保持开机
   > ```
3. **电源策略**：接电源时永不睡眠、断电自动开机（可参考与仓库同机的 `setup-server-mode.sh`）。

> 安全提示：自动登录会在本地明文解锁会话，仅适用于受控内网内的专用服务器，请勿在移动设备上启用。

## 步骤 4：配置仓库 Secrets

`deploy-mac-mini.yml` 会把下列 secret 透传给 Compose（未设置则为空，Compose 用默认值）：

仓库 **Settings → Secrets and variables → Actions → New repository secret**：

| Secret | 必填 | 说明 |
|--------|------|------|
| `OCTOP_DEFAULT_PASSWORD` | 建议 | 首次初始化管理员密码（≥8 位且含字母+数字）。不设则由容器自动生成随机密码并写入 `~/.octop/credential.txt` |
| `OPENAI_API_KEY` | 可选 | OpenAI 兼容 API Key |
| `DASHSCOPE_API_KEY` | 可选 | 阿里云通义千问 API Key |

> 需要更多变量（如 `OCTOP_PORT`、`OCTOP_DATABASE_URL`）时：在 `docker/docker-compose.yml` 的 `environment:` 已列出的键，直接加到工作流步骤的 `env:` 即可。

## 触发部署

- **自动**：向 `meerkat` 分支 push（或合并 PR 到 `meerkat`）即触发；
- **手动**：在 Actions 页面找到历史运行，点 **Re-run jobs**。
  > 说明：`workflow_dispatch` 的 "Run workflow" 按钮仅在**默认分支**（本仓库为 `main`）上存在该工作流文件时才可用；按分支约定不向 `main` 合并，因此日常手动重跑请用 Re-run。

工作流会：构建镜像 → `docker compose up -d --build` → 轮询 `http://localhost:${OCTOP_PORT:-8088}/api/health`（最多 180s），失败会打印最后 200 行容器日志并以非零码退出。

## 验证

在 Mac Mini 上：

```bash
docker compose -f docker/docker-compose.yml ps
docker logs -f octop
curl -fsS http://localhost:8088/api/health
```

浏览器访问 `http://<mac-mini-ip>:8088`。首次初始化的密码在 Mac Mini 的 `~/.octop/credential.txt`。

## 回滚

工作流每次部署都会把当前镜像另打一个 `octop:sha-<提交前12位>` 标签。回滚到某个历史提交：

```bash
cd <该 Mac Mini 上的工作目录>            # 例如 ~/actions-runner/_work/meerkatai-octop/meerkatai-octop
docker images | grep 'octop.*sha-'      # 找到目标 SHA 标签
docker tag octop:sha-<SHA> octop:latest
docker compose -f docker/docker-compose.yml up -d   # 注意：不要加 --build，否则会重新构建
```

> 注意：`octop:latest` 顶层标签会被下次部署覆盖，历史镜像靠 `octop:sha-*` 保留。如无 SHA 标签可用，则需 checkout 到目标提交并重新部署。

## 故障排查

| 现象 | 处理 |
|------|------|
| 任务一直 `Queued` | Runner 不在线：Mac Mini 上 `~/actions-runner/svc.sh status`；确认标签含 `meerkat-macmini` |
| `Cannot connect to the Docker daemon` | Docker Desktop 未启动或当前用户未登录；启动后重试 |
| `docker: command not found` | 工作流已注入 PATH；手动执行时先 `export PATH="$HOME/.docker/bin:$PATH"` |
| 健康检查失败 | 看工作流日志尾部的容器日志；常见原因是端口被占用或首次初始化失败 |
| Runner 更新后离线 | 重新 `./config.sh remove` + 重装，或让 Runner 自动更新（默认开启） |

## 安全说明

- 自托管 Runner **只应运行可信代码**。本工作流仅在 `push: meerkat` 与手动触发时运行，**不监听 `pull_request`**，因此来自 fork 的 PR 无法在 Mac Mini 上执行任意代码。
- `meerkat` 是生产发布分支（见 `docs/meerkat/README.md` 分支约定），请保持其保护规则，禁止直接 push 未经合并的代码。
- 本仓库当前为 **public**。GitHub 官方不建议在公开仓库使用自托管 Runner。建议将仓库改为 private，或至少对 `meerkat` 启用保护规则（禁止直推、要求 PR review、限制可推送者），并保留「fork PR 需批准后才运行」。
- Runner 进程以登录用户身份运行，可访问该用户的一切资源，请在专用用户下运行以降低影响面。

## 可选：改为「云端构建 + Mac Mini 拉取」

若不想占用 Mac Mini 资源做构建，可改为两段式：GitHub 托管 Runner（`ubuntu-24.04-arm`）构建 `linux/arm64` 镜像并推到 GHCR，再由自托管 Runner `docker compose pull` 拉取。现有 `.github/workflows/docker-publish.yml` 已具备多架构推送能力，可在此基础上扩展；本仓库当前采用「就地构建」以保持零镜像仓库依赖。
