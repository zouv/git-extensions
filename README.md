# git-extensions

Tauri + React 实现的 Git 图形客户端，复刻 Git Extensions 核心工作流并解决其 UI 卡顿问题

## 用途 / 动机

Git Extensions 的卡顿主要来自 UI 线程同步等待 git 进程与全量刷新。本项目用「Rust 异步后端 + 虚拟化前端」重做核心工作流：读操作走 git2 库（省进程开销）、日志分批流式加载、写操作走 git CLI（hooks 生效），验证这一架构对流畅度的提升。

## 运行与构建

前置条件：Rust（cargo）、Node.js 22+、pnpm、git；Windows 上依赖系统 WebView2。

Windows 双击脚本（推荐）：

| 脚本 | 作用 |
|---|---|
| `setup.bat` | 检查工具链并安装依赖 |
| `dev.bat` | 开发模式运行桌面应用（前端热更新） |
| `build.bat` | TS 类型检查 + 前端产物 |
| `test.bat` | 前端检查 + Rust 单元 / 集成测试 |
| `package.bat` | 打包桌面安装包（输出在 `src-tauri/target/release/bundle/`） |
| `clean.bat` | 清理构建产物 |

等价命令：`pnpm install`、`pnpm tauri:dev`、`pnpm build`、`pnpm tauri:build`、`cd src-tauri && cargo test`。Linux / macOS 可运行 `sh test.sh`；跨平台 CI 矩阵见 `.github/workflows/build-and-test.yml`。

## 已知边界

- 优先支持 Windows；Linux 与 macOS 的验证状态见 `docs/03-性能与平台验证.md`。
- 功能是 Git Extensions 的子集：提交图、详情、diff、暂存 / 提交、分支 / 标签 / stash、远程同步、rebase / cherry-pick / revert、blame、文件历史、子模块基础支持；无插件体系。
- diff 高亮在 Worker 中异步执行，超过 5000 行或未知语言跳过；单文件 patch 超过 512 KiB 会截断。
- blame 超过 20000 行拒绝加载；文件历史默认读取最近 200 条。
- 工作区变更靠轮询自动刷新（5 秒，仅窗口可见时），也可手动点「刷新」。

## 目录结构

```
src/                    # React 前端（虚拟化列表 + Canvas 分支图）
src-tauri/              # Rust 后端（git2 读 + git CLI 写）
docs/                   # 使用/维护文档（面向人）
AGENTS.md               # AI 工作规则（AI 开工先读）
ARCHITECTURE.md         # 代码链路图谱（面向 AI）
ROADMAP.md              # 开发路线图（总体计划与完成度）
CHANGELOG.md            # 发布变更记录（按版本）
HANDOFF.md              # 会话接力（进行中状态）
check-docs.sh           # 文档体系机械体检
```

> AI 协作说明：本项目采用一套「AI 协作文档体系」，AI 代理开工请先读 [`AGENTS.md`](./AGENTS.md)。
