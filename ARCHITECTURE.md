# 代码链路图谱 · git-extensions

> **本文件的目的**：给 AI（及人类）一份「读这一份就能定位代码」的导航地图，避免每次改动 / 排查都全量扫描源码，节省上下文与 token。
>
> **维护**：改了代码结构（新增入口 / 移动逻辑 / 改数据流 / 改接口），同步更新本文件（见 AGENTS §1）。
>
> **体量**：不超过 25,000 字（按字符计，命令见 AGENTS §4）；超了按 AGENTS §1.1 拆到 `arch/<module>.md`，总览只留 §0 / §0.5 / §1。单元格写「是什么、在哪、为什么」，一般不超过 150 字；不写日期、版本、改动经过（归 CHANGELOG / git log）。
>
> 文中「AGENTS §x」指 `AGENTS.md` 的章节；不带前缀的 §x 指本文件。

---

## 0. 一句话架构

Tauri 桌面应用：React 前端（虚拟化列表 + Canvas 分支图）通过类型化 IPC 调 Rust 后端；读操作走 git2 库，写操作派生 git CLI。

```
React (src/) ──invoke──> Rust 命令 (src-tauri/src/git/*) ──读──> git2 (libgit2)
     ▲                          └────────────写──────────> git.exe (hooks 生效)
     └──log-batch 事件流── start_log 后台线程分批推送
```

架构约束：后端无全局仓库状态，每个命令显式传仓库路径、重新打开（打开很快），从根上避免跨仓库数据串扰；耗时读操作在后台线程执行并分批推送，UI 不等待；写操作必须走 CLI 以保 hooks 与行为一致。

---

## 0.5 任务作用域路由（先定范围，避免污染上下文）

> **怎么用**：动手前先在下表找到你的任务类型，只读「该读」列的文件 / 小节，「可忽略」列默认不打开（证据指向那里时除外，见 AGENTS §0）。
> 无关代码不进上下文，省 token、少误改。

| 任务类型 | 该读（仅限） | 可忽略 | 入口小节 |
|---|---|---|---|
| 改提交日志 / 分支图数据 | `src-tauri/src/git/log.rs`、`src/components/RevisionGrid.tsx` | 其它后端模块、diff / changes 组件 | §2.1、§3 |
| 改 diff 获取或渲染 | `src-tauri/src/git/diff.rs`、`src/components/DiffView.tsx` | log.rs、ChangesPanel | §2.1 |
| 改暂存 / 提交 / 分支操作 | `src-tauri/src/git/cli.rs`、`src/components/ChangesPanel.tsx` 或 `BranchDialog.tsx` | 读路径模块 | §2.1、§3 |
| 改页面布局 / 状态流转 | `src/App.tsx`、`src/styles.css`、`src/api.ts` | 后端 git 模块 | §2.2 |
| 改文档 / 流程 | 对应的 `docs/` 篇章或根目录文档 | 源码 | AGENTS §5 |

> 跨多个区域的任务才需要跨列读；仍然遵循「**先定位函数名，再只读那几个函数**」，不要整文件通读。

---

## 1. 文件职责速查（先看这张表）

| 文件 | 职责 | 何时改它 |
|---|---|---|
| `src-tauri/src/lib.rs` | Tauri 命令注册、应用入口 | 新增 / 删除 IPC 命令 |
| `src-tauri/src/error.rs` | 统一错误类型 `GitError`（可序列化给前端） | 新增错误类别 |
| `src-tauri/src/git/mod.rs` | `open()`：按路径 discover 打开仓库 | 改仓库打开策略 |
| `src-tauri/src/git/repo.rs` | 仓库信息、分支列表 | 改仓库概览 / 分支字段 |
| `src-tauri/src/git/log.rs` | revwalk 流式日志、refs 收集、分支图 lane 布局、代际取消 | 改日志加载 / 图数据 |
| `src-tauri/src/git/diff.rs` | 提交详情、提交 diff、工作区 diff、patch 截断 | 改 diff 数据 |
| `src-tauri/src/git/status.rs` | git2 statuses → staged/unstaged 快照 | 改状态分类 |
| `src-tauri/src/git/cli.rs` | 写操作：stage/unstage/commit/branch/checkout/delete | 改任何写操作 |
| `src-tauri/src/git/history.rs` | git2 逐行 blame、CLI `--follow` 单文件历史 | 改文件历史 / 行数上限 |
| `src/types.ts` | 前后端共享 TS 类型（与 Rust serde 对应） | 改任何 IPC 字段 |
| `src/api.ts` | invoke 封装、log-batch 订阅、日期格式化 | 改 IPC 调用方式 |
| `src/settings.ts` | 行为设置类型、默认值、localStorage 白名单校验 | 新增 / 修改设置项 |
| `src/vite-env.d.ts` | Vite 客户端类型声明（`import.meta.env`） | 使用 Vite 环境变量时 |
| `src/App.tsx` | 全局状态、打开仓库、刷新、选择提交、页签、全局快捷键 | 改状态流 / 布局 / 快捷键 |
| `src/components/RevisionGrid.tsx` | 虚拟化提交列表 + Canvas 分支图绘制 | 改列表 / 图渲染 |
| `src/components/DiffView.tsx` | 文件列表 + 虚拟化 patch + Worker 异步语法高亮 | 改 diff 展示 |
| `src/highlight.worker.ts` / `src/languages.ts` | highlight.js 后台高亮、扩展名到语言映射 | 改高亮语言 / 请求协议 |
| `src/components/LeftPanel.tsx` | 本地 / 远程 / 标签树，按 ref 过滤日志、双击切换分支 | 改引用导航 |
| `src/components/BlameDialog.tsx` / `FileHistoryDialog.tsx` | 虚拟化 blame、文件历史与对应 diff | 改历史交互 |
| `src/components/CommitInfo.tsx` | 提交详情展示 | 改详情字段展示 |
| `src/components/ChangesPanel.tsx` | 暂存区 / 工作区列表、diff 预览、提交 | 改 stage/commit 交互 |
| `src/components/BranchDialog.tsx` | 分支切换 / 新建 / 删除弹窗 | 改分支交互 |
| `src/components/StashDialog.tsx` | stash 保存 / 应用 / 弹出 / 删除弹窗 | 改 stash 交互 |
| `src/components/TagDialog.tsx` | 标签列表 / 新建 / 删除弹窗 | 改标签交互 |
| `src/components/SubmoduleDialog.tsx` | 子模块状态列表与更新弹窗 | 改子模块交互 |
| `src/components/SettingsDialog.tsx` | 行为设置编辑、快捷键帮助 | 改设置交互 |
| `src/components/Toolbar.tsx` | 工具栏、远程操作、过滤框、打开仓库弹窗 | 改工具栏 |
| `src-tauri/tests/smoke.rs` | 集成测试：临时真实仓库跑读写全流程 | 改命令行为时补对应用例 |
| `src-tauri/examples/bench.rs` | release 大仓库日志 / 详情 / diff 性能测量 | 改测量指标或核心读路径 |
| `src/styles.css` | 全部样式（暗色主题，按注释分段） | 改外观 |
| `src-tauri/tauri.conf.json` | 窗口、标识、构建配置 | 改窗口 / 打包 |
| `src-tauri/capabilities/default.json` | Tauri 2 权限配置（事件 listen/emit 等） | 新增 IPC / 事件权限 |
| `package.json` / `src-tauri/Cargo.toml` | 前后端依赖与版本号 | 加依赖、发版 |

---

## 2. 按「我要做什么」反查代码位置（任务 → 入口）

> 只登记**常见改动的入口函数 / 注释锚点**，不是全量函数表（其它函数用 grep 找）。按函数名 / 锚点搜索，不写行号（行号会漂移）。
>
> **自愈规则**：本表是可自愈的「加速索引」，不是权威真相，只为省一次 grep。按本表的函数名搜不到 / 对不上（已改名或删除）→ **以 grep / 代码为准**，完成任务后顺手把这一行订正（改名的改名、删除的删除）；发现漏登记的常见入口同样补进来。过期的图谱比没有更糟。

### 2.1 Rust 后端（`src-tauri/src/`）

| 我要改的东西 | 关键函数 / 锚点 | 备注 |
|---|---|---|
| 新增一个 IPC 命令 | `lib.rs` 的 `generate_handler!` + 对应模块 | TS 侧同步改 `types.ts` / `api.ts` |
| 日志加载 / 图布局 | `log.rs` 的 `run_log`、`GraphLayout::place` | 批次大小 `BATCH_SIZE` |
| 日志取消机制 | `log.rs` 的 `LOG_GENERATION` | 前端 `requestIdRef` 对应 |
| diff 内容 / 大小上限 | `diff.rs` 的 `collect`、`MAX_PATCH_BYTES` | 截断标志 `truncated` |
| 写操作参数或错误处理 | `cli.rs` 的 `run_git` | Windows 下 `CREATE_NO_WINDOW` |

### 2.2 前端（`src/`）

| 我要改的东西 | 关键函数 / 锚点 | 备注 |
|---|---|---|
| 打开仓库 / 刷新全流程 | `App.tsx` 的 `openRepo`、`refreshAll` | 写操作成功后统一走 `refreshAll` |
| 全局快捷键 | `App.tsx` 的全局 `keydown` effect | 弹窗打开时禁用；输入框内不抢导航键 |
| 行为设置 | `settings.ts` 的 `loadSettings`、 `SettingsDialog.tsx` | localStorage 键 `git-extensions.settings` |
| 选中提交的加载与竞态 | `App.tsx` 的 `selectCommit` | `selectionRef` 丢弃过期结果 |
| 列表虚拟化参数 | `RevisionGrid.tsx` 的 `ROW_H`、`LANE_W` | Canvas 只画可见行 |
| diff 行着色规则 | `DiffView.tsx` 的 `classify` | 行高 `LINE_H`；高亮上限 `MAX_HIGHLIGHT_LINES` |
| blame / 文件历史 | `history.rs` 的 `blame_file`、`file_log` | blame 上限 20000 行；历史默认 200 条 |

---

## 3. 重点链路详解（高频改动区 / 容易写错的地方）

### 日志流与取消（打开仓库 / 刷新 / 写操作后刷新）

- **需求语义**：日志可能上万条，必须分批到达；切换仓库或再次刷新时旧流必须作废。
- **关键坑**：旧请求的批次晚于新请求到达会污染列表；前端清空列表与后端发批之间存在竞态。
- **正确实现**：双端代际号——前端 `requestIdRef` 自增并忽略不匹配的批次，后端 `LOG_GENERATION` 在每批前检查、不匹配即中止线程（涉及函数：`App.tsx` 的 `refreshAll`、`log.rs` 的 `start_log`）。
- **调用链**：`refreshAll` → `api.startLog(path, id)` → 后端线程 `run_log` → 每 300 条 emit `log-batch` → 前端校验 `requestId` 后 append。

### 写操作后的刷新

- **需求语义**：stage / commit / 分支操作后，日志、分支、状态三样都要反映最新值。
- **关键坑**：分散刷新容易漏某项；操作失败不能触发刷新。
- **正确实现**：组件内 `run()` 包装器只在成功后调 `App.tsx` 的 `refreshAll`；错误经 `setMessage` 上状态栏。

---

## 4. 数据流 / 接口契约（模块边界）

命令 = Tauri invoke（参数 camelCase，与 `src/api.ts` 一一对应），事件 = `log-batch`。

| 调用方 | 路由 / 入口 | 关键字段 / 约定 |
|---|---|---|
| 前端 → 后端 | `open_repo` / `get_branches` / `get_status` | `path` 为仓库内任意路径，后端 discover |
| 前端 → 后端 | `start_log` | `requestId` 代际号；`maxCount` 默认 100000；`revspec` 非空时只从该 ref 出发 |
| 后端 → 前端 | `log-batch` 事件 | `requestId`、`revisions[]`、`done`、`error` |
| 前端 → 后端 | `get_commit` / `get_commit_diff` | `oid` 为完整 40 位 |
| 前端 → 后端 | `get_worktree_diff` | `staged`：true=HEAD vs index，false=index vs workdir |
| 前端 → 后端 | `stage_files` / `unstage_files` / `commit` / `create_branch` / `checkout_branch` / `delete_branch` | 走 CLI，stderr 原文返回给前端 |
| 前端 → 后端 | `fetch` / `pull` / `push` / `stash_*` / `cherry_pick` / `revert` / `rebase` / `create_tag` / `delete_tag` / `submodule_update` | 写操作同走 CLI；`push` 无 upstream 时自动退回 `push -u origin HEAD` |
| 前端 → 后端 | `get_contained_in` / `tag_list` / `submodule_list` / `get_ahead_behind` | 只读；contained-in 的分支 / 标签各限 100 条 |
| 前端 → 后端 | `blame_file` / `file_log` | blame 可选 `oid` 指定版本，默认工作区；文件历史经 CLI `--follow` |

**数据 / 单位约定**：时间戳为 Unix 秒，前端 `formatDate` 转本地时间；文件路径用 git 输出的 UTF-8 正斜杠形式；serde 结构统一 `rename_all = "camelCase"`；单文件 patch 超过 512 KiB 截断并置 `truncated`。

---

## 5. 样式 / 资源分段地图

`src/styles.css` 按注释锚点分段：`工具栏`、`提交列表与左侧引用树`、`底部页签`、`提交信息`、`diff`、`变更面板`、`弹窗`、`状态栏`。改外观先搜锚点。

---

## 6. 运维 / 脚本（启停 / 配置 / 打包）

- Windows 双击脚本（项目根，均为 pnpm/cargo 的薄包装，风格对齐 sc-code）：`setup.bat` 装依赖、`dev.bat` 开发运行、`build.bat` 前端构建、`test.bat` 前端检查 + Rust 测试、`package.bat` 打包安装包、`clean.bat` 清构建产物。
- 等价命令定义在 `package.json` 的 scripts（`dev`、`build`、`tauri:dev`、`tauri:build`），Rust 侧用 `cargo check` / `cargo test`（在 `src-tauri/`）。
- Linux / macOS 用 `sh test.sh`；三平台 CI 矩阵在 `.github/workflows/build-and-test.yml`。
- 大仓库性能测量：`cd src-tauri && cargo run --release --example bench -- <仓库路径> 3`；指标与结果见 `docs/03-性能与平台验证.md`。
- 文档机械体检：`sh check-docs.sh`。

---

## 7. 易踩的坑 / 设计取舍

- **写操作不走 git2**：libgit2 不执行 hooks，且部分行为与 CLI 有差异；所有写操作（stage/commit/branch）经 `cli.rs` 派生 `git -C <path>`，stderr 原样上抛。
- **不缓存 Repository / 不做全局命令缓存**：每次按路径重新打开，避免 Git Extensions 那种缓存键不含工作目录导致跨仓库串数据的问题。
- **GUI 下派生 CLI 必须 `CREATE_NO_WINDOW`**（Windows），否则每次写操作闪控制台窗口。
- **无 HEAD 的新仓库**：`restore --staged` 会失败，`unstage_files` 自动退回 `reset -q --`。
- **diff 必须限量**：patch 超 512 KiB 截断，二进制只标记不取内容，防止巨型 diff 阻塞 IPC 与渲染。
- **revwalk 起点是全部 refs**（`peel_to_commit` 后 push）：annotated tag 直接 push 会失败；空仓库（无 HEAD）直接发空 done 批次。
- **轮询自动刷新不抢用户操作**：仅窗口可见且无写操作进行中时轮询（`App.tsx` 的 `POLL_INTERVAL`）；status 快照只在真正变化时更新，避免 ChangesPanel 的勾选 / 输入被清掉；HEAD 移动才触发全量刷新。
- **首次 push 无 upstream**：`cli.rs` 的 `push` 先裸 `git push`，失败退回 `push -u origin HEAD`，让新仓库首次推送可用。
- **高亮与历史也要限量**：highlight.js 在 Worker 中运行，旧请求按 id 丢弃，超过 5000 行或未知语言跳过；blame 超过 20000 行拒绝加载，避免 IPC 与 DOM 峰值。
- **按 ref 过滤仍走同一条日志流**：`start_log` 的可选 `revspec` 只改变 revwalk 起点，保留同一套分批、图布局与双端取消逻辑。
- **设置输入按白名单恢复**：localStorage 可被手工修改，`loadSettings` 只接受布尔值及预定义的轮询间隔 / 日志上限，避免异常值造成高频轮询或超大加载。
- **性能测量复用正式实现**：`run_log` 暴露给同步调用方，Tauri 命令仍在后台线程执行；`examples/bench.rs` 不复制日志算法，避免基准与产品行为漂移。
- **日志流线程必须捕获 panic**：`start_log` 用 `catch_unwind` 包裹 `run_log`，发生 panic 时回传 `error` 批次；否则线程静默退出，前端永远收不到 `done` / `error`，界面卡在「加载中」。`app.emit` 失败也要 `eprintln!`，不能 `let _ =` 静默吞掉。
- **Tauri 2 事件权限必须显式声明**：前端 `listen("log-batch")` 需要 `core:event:allow-listen`，否则权限拒绝导致提交图一直「加载中」；权限配置在 `src-tauri/capabilities/default.json`。
- **自动化复测入口**：开发模式下设置 `VITE_TEST_REPO=<仓库路径>` 可自动打开仓库；前端关键状态通过 `report_frontend_state` 写入后端日志（`%TEMP%/git-extensions.log`），便于无 GUI 环境验证。
- **图标资源必须跨平台齐全**：即使 bundle 未显式引用，`generate_context!` 在非 Windows 构建也需要 PNG；`icons/` 同时保留 ICO / PNG / ICNS，并在 bundle 配置中引用。
