# Octop 本地开发指南

## 环境准备

| 项             | 说明                                                         |
| -------------- | ------------------------------------------------------------ |
| Python 3.12    | 略                                                           |
| git            | 略                                                           |
| node / npm     | 略                                                           |
| uv             | Python 包管理器，优势是快（依赖解析和安装通常比 pip 快 10-100 倍）和可复现（靠 uv.lock 锁定所有传递依赖的精确版本 + hash） |
| mise           | 和 `nvm`（管理 Node）、`pyenv`（管 python）是同一类，但是一个工具管理所有语言。保证本地工具链和 CI / Docker 完全一致。见仓库根目录的 `mise.toml` |
| 仓库内的 .venv | Python 的"虚拟环境"（本质是一个目录），装着一套独立的 Python 解释器入口和独立的包目录。往里面装包，只影响这个目录，不影响系统 Python，也不影响别的项目。 |
| make           | GNU Make，一个构建自动化工具。它读取仓库根目录的 `Makefile`，把里面定义的「target」（install、dev、test…）当作子命令来执行。 |
| octop 命令     |                                                              |
| `~/.octop`     |                                                              |

### win 安装 make

```powershell
# powershell
winget install ezwinports.make --accept-source-agreements --accept-package-agreements
```

```bash
# bash
make --version
```

## 启动命令手册

```bash
# 初始化
mise install          # 或手动装 python3.12 / node20 / npm10 / uv
make install          # uv sync，装后端 dev 依赖
make install-hooks    # 每次 clone 一次：pre-commit 跑 make all + 前端 build
octop init            # 或者 uv run octop init，建 ~/.octop/ 与管理员账号

# 前端启动
make dev-frontend	# cd dashboard && npm run dev → :5173

# 后端启动
make dev-backend	# uv run octop run	→ :8088

# 后端手动启动
uv run octop run
uv run octop run --host 0.0.0.0 --port 8088

# 前后端一键同起
make dev			# 并行跑 npm run dev（dashboard/ ）和 octop run，Ctrl-C 一起停

# 前端打包
make build-frontend	# cd dashboard && npm ci && npm run build

# 质量门禁
make all			# format-all + lint + typecheck + test（提交门槛）
make check-all		# 全栈版，多跑前端 lint/typecheck
make test-fast		# 跳过 slow（不跑真实 harness/browser 的集成测试）
make precommit		# pre-commit hook 用的，testmon 只跑受影响测试
```

## 前端

### 源码位置

前端在 `dashboard/` 下：

```tex
dashboard/
├── index.html
├── package.json          # octop-dashboard，React 18 + Vite 6 + vitest
├── vite.config.ts        # dev proxy 配置在这
├── vitest.config.ts
├── eslint.config.js
├── public/               # 静态资源（PWA 图标、offline.html 等）
├── scripts/
└── src/
    ├── main.tsx / App.tsx
    ├── api/              # 后端 API 调用
    ├── pages/            # 页面（chat / agents / connectors / channels / cron / settings …）
    ├── components/
    ├── layouts/
    ├── routes/
    ├── hooks/  context/  utils/
    ├── locales/          # i18n（i18next）
    ├── styles/
    ├── plugins/
    └── test/
```

### 技术栈

React 18 + TypeScript + Vite + Ant Design（antd 5.x，另外用了 xterm/monaco/recharts/mermaid 等）。

### 依赖安装

```bash
# ci 是 npm 自带的子命令
npm ci
```

**注意**：不用 `npm install` 是因为 `npm ci` 有以下特点：

|                                   | npm ci                     | npm install                          |
| --------------------------------- | -------------------------- | ------------------------------------ |
| 依据                              | 严格按 `package-lock.json` | 按 `package.json` 的版本范围重新解析 |
| 会改 lockfile 吗                  | ❌ 绝不                     | ✅ 可能会                             |
| 先清空 `node_modules` 吗          | ✅ 会                       | ❌ 不会                               |
| lockfile 与 `package.json` 冲突时 | 报错退出                   | 悄悄更新 lockfile                    |
| 速度                              | 快（跳过解析）             | 慢                                   |

### 本地开发

```bash
npm run build
```

### 打包编译

Octop 的后端和前端是打包在一起的：`FastAPI` 直接从 `src/octop/dashboard/` 这个目录读编译好的 React 静态文件。所以，我们要先编译前端。

```powershell
cd E:\projects\meerkatai-octop\dashboard
$env:NODE_OPTIONS = "--max-old-space-size=2048"
npm run build
```

## 后端

### 源码位置

后端在 `src/octop/` 下：

```tex
src/octop/
├── cli/           CLI 层（Click 命令）—— 你要找的"命令"就在这
│   ├── main.py            CLI 总入口
│   └── commands/run.py    ← `octop run` 的定义
├── api/           HTTP 层：FastAPI app、routers、JWT、SSE
├── infra/         业务核心：agents / gateway / cron / db / users / browser …
├── launch.py      OctopServer 启动 + uvicorn
├── config.py      环境变量配置
└── dashboard/     前端构建产物（打进 wheel，需要跑命令）
```

### 依赖安装

```powershell
$env:UV_HTTP_TIMEOUT = "300" # 加长超时
uv sync --python 3.12
```

### 隔离数据目录 + 初始化

在启动项目前，必须先有管理员账户。因为数据库、JWT secret、管理员账号全是这一步建的。没有它，服务起来也没有账号能登录。另外，本地 `octop run` 没有自动初始化逻辑。

#### 启动方式

**方式一：CLI**

```bash
uv run octop init
```

**方式二：网页向导**

直接启动前后端服务：

```bash
# 前端
npm run dev
```

打开 `http://localhost:5173/setup` 页面机型初始化配置。

```bash
# 后端
# 指定开发用的独立目录（隔离 .octop/ 干扰，出问题直接删目录重来）
$env:OCTOP_HOME = "E:\projects\meerkatai-octop\.octop-dev"

# 8088 端口提供后端 API / WebSocket / 前端静态文件等服务
uv run octop run
```

## git hooks

```bash
# 启用 hooks
 git config core.hooksPath .githooks # 关联 .githooks 文件夹下的执行文件
 
 # 关闭 hooks
git config --unset core.hooksPath
```

项目内的 `.githooks/pre-commit` 会在 commit 前做以下工作：

1. 跑 `make precommit`
   1. `ruff format` + `ruff check --fix` （后端格式化）
   2. `prettier --write` （前端格式化）
   3. `ruff check + mypy src/octop`（后端 lint + 类型检查）
   4. `pytrst --testmon` （只跑受影响的测试）
2. 跑 `npm run build`
   1. 等于 `tsc -b && vite build`（前端类型检查 + 完整构建）

### 本地化改造

本地开发，使用 `.githooks-local`，不做任何测试门禁，避免过度耗时和内存超标。

`.githooks-local/pre-commit` 按顺序做这些:

1. `make format-all` 格式化
   1. 后端：`uv run ruff check --fix src tests` 自动修复可修的问题
   2. 后端：`uv run ruff format src tests` 统一格式
   3. 前端：`cd dashboard && npm run format` 即 `prettier --write`
2. `make lint` 校验
   1. 后端：`uv run ruff check src tests` 检查
   2. 后端：`uv run ruff format --check src tests` 检查格式是否合规
   3. 先 `--fix` 自动修,再 `--check` 验证。所以格式类问题不会拦住你,它自己改完就过。
3.  `make typecheck`  后端类型检查
4. `tsc` 前端类型检查

如需手动跑测试检查，可以执行以下命令：

```bash
uv run pytest tests/unit -x			# 单元测试
uv run pytest tests/integration     # 改 API 层时
uv run ruff check --fix src tests   # 单独格式化
uv run mypy src/octop               # 单独类型检查
```