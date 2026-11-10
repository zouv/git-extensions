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
     └──log-batch 事件流── start_log 经有界后台读取分批推送
```

架构约束：每个命令显式传仓库路径、重新打开，不缓存 Repository。所有 Git 读取 IPC（含日志流）经 `commands.rs` / `log.rs` 与 `operations.rs::run_read` 在 blocking pool 执行，共享四个异步读取令牌；写 IPC 经 `run_blocking`，实现层按 canonical common Git dir 互斥。仅保存调度状态，不缓存 Repository；写操作走 CLI 保留 hooks。

---

## 0.5 任务作用域路由（先定范围，避免污染上下文）

> **怎么用**：动手前先在下表找到你的任务类型，只读「该读」列的文件 / 小节，「可忽略」列默认不打开（证据指向那里时除外，见 AGENTS §0）。
> 无关代码不进上下文，省 token、少误改。

| 任务类型 | 该读（仅限） | 可忽略 | 入口小节 |
|---|---|---|---|
| 改提交日志 / 分支图数据 | `src-tauri/src/git/log.rs`、`src/components/RevisionGrid.tsx` | 其它后端模块、diff / changes 组件 | §2.1、§3；`arch/ui.md §2` |
| 改 diff 获取或渲染 | `src-tauri/src/git/diff.rs`、`src/components/DiffView.tsx`、`src/viewState.ts` 与调用方 loader | log.rs、写路径 | §2、§3、§4；`arch/ui.md §2–§3` |
| 改暂存 / 提交 / 分支 / 远程 / Worktree / Merge / Bisect 或写调度 | `src-tauri/src/git/cli.rs`、`commands.rs`、`operations.rs`、`repo.rs`；`src/api.ts`、`repoOperations.ts` / `useRepoBusy.ts` 与对应写操作组件 | 读路径模块 | §2、§3、§4；`arch/ui.md §2–§3` |
| 改提交搜索 / 代码搜索 / 导出补丁与归档 / 命令日志 | `src-tauri/src/git/history.rs`、`cli.rs`、`commands.rs`；`src/components/{Search,CommandLog}Dialog.tsx`、`RevisionGrid.tsx` | 分支图渲染与写锁 | §2、§4；`arch/ui.md §1–§2` |
| 改后台读调度 / 失效与刷新 | `operations.rs`、`commands.rs`、`log.rs`；`src/api.ts`、`repoOperations.ts`、`RepoWorkspace.tsx`、`ChangesPanel.tsx` | 无关写组件 | §2、§3、§7；`arch/ui.md §3` |
| 改 Reset / 恢复 | `src-tauri/src/git/reset.rs`、`commands.rs`；`src/components/ResetDialog.tsx`、`RecoveryDialog.tsx`、`RepoWorkspace.tsx` | 分支图与高亮 Worker | §2、§3、§4；`arch/ui.md §2` |
| 改页面布局 / 状态流转 | `src/App.tsx`、`src/RepoWorkspace.tsx`、`src/ui/`、`src/styles.css` | 后端 git 模块 | `arch/ui.md §1–§3` |
| 改顶部栏 / 窗口控制 / 页签与 Pin 拖拽 | `src/components/TitleBar.tsx`、`RepositoryTabs.tsx`、`src/App.tsx`、`src/tabOrder.ts`、`src-tauri/src/window_host.rs`、`capabilities/default.json` | 后端 git 模块 | `arch/ui.md §1–§3、§5`；§7 窗口生命周期 |
| 改仓库页签分组 / Pin / 别名 | `src/repoGroups.ts`、`src/components/RepoGroupsDialog.tsx`、`GroupAvatar.tsx`、`TitleBar.tsx`、`RepositoryTabs.tsx`、`src/App.tsx` | 后端 git 模块 | `arch/ui.md §1–§2、§5` |
| 改启动恢复 / 页签持久化 | `src/App.tsx`、`src/openRepos.ts`、`tests/open-repos.test.mjs` | 后端 git 模块、其它 UI 组件 | `arch/ui.md §2–§3、§5` |
| 改命令面板 / 统一快捷键 | `src/commands.ts`、`src/components/CommandPalette.tsx`、`src/App.tsx`、`src/RepoWorkspace.tsx` | 后端 git 模块 | `arch/ui.md §2–§3` |
| 改弹窗焦点 / 关闭保护 / 通知 | `src/ui/Dialog.tsx`、`src/ui/layerStack.ts`、`src/ui/useDirtyClose.ts`、`src/ui/Confirm.tsx`、`src/components/NotificationCenter.tsx`、`src/App.tsx`、`src/dialogState.ts` | Git 读写模块 | `arch/ui.md §2–§3、§5` |
| 改原生目录选择 / 拖放打开 | `src/nativeDialog.ts`、`src/App.tsx`、`src/components/{Clone,CreateRepository,ApplyPatch}Dialog.tsx`、`src-tauri/src/lib.rs`、`Cargo.toml`、`capabilities/default.json` | Git 读写模块 | `arch/ui.md §2–§3` |
| 改资源管理器菜单 / 外部启动 / 克隆进度 / Rename | [`arch/explorer.md`](./arch/explorer.md)，按分册定位源码 | 无关 Git 读路径与 Diff 组件 | 分册 §1–§5 |
| 改对比 / 冲突 / 交互式 Rebase | `src/components/CompareView.tsx`、`ConflictCenter.tsx`、`RebasePlanner.tsx`；后端 `diff.rs`、`status.rs`、`rebase.rs` | 提交图与高亮 Worker | §2、§3、§4；`arch/ui.md §1–§3` |
| 改文档 / 流程 | 对应的 `docs/` 篇章或根目录文档 | 源码 | AGENTS §5 |

> 跨多个区域的任务才需要跨列读；仍然遵循「**先定位函数名，再只读那几个函数**」，不要整文件通读。

---

## 1. 文件职责速查（先看这张表）

| 文件 | 职责 | 何时改它 |
|---|---|---|
| `src-tauri/src/lib.rs` | Tauri 命令注册、插件与窗口生命周期；最后一个窗口销毁后退出 | 新增 / 删除 IPC 命令、改应用生命周期 |
| `src-tauri/src/error.rs` | 统一错误类型 `GitError`（可序列化给前端） | 新增错误类别 |
| `src-tauri/src/git/mod.rs` | `open()`：按路径 discover 打开仓库 | 改仓库打开策略 |
| `src-tauri/src/git/repo.rs` | 仓库信息、分支列表、远程列表、已合并本地分支、linked worktree 列表 | 改仓库概览 / 分支 / remote / worktree 字段 |
| `src-tauri/src/git/log.rs` | revwalk 流式日志、refs 收集、分支图 lane 布局、代际取消 | 改日志加载 / 图数据 |
| `src-tauri/src/git/diff.rs` | 提交 / 工作区 / 双端文件清单与单文件 patch、大小保护 | 改 diff 数据 |
| `src-tauri/src/git/status.rs` | 状态快照、真实 operation state（含 Bisect）、冲突四方内容 | 改状态分类 / 冲突读取 |
| `src-tauri/src/git/cli.rs` | 同步 Git 写实现与参数校验（含 Hunk 暂存、Amend/Fixup、Merge、Remote、Worktree、Bisect、导出、命令日志、Clone 进度流、Add/Reset/Patch/Stash 扩展、Rename 与 Pull/Push 选项） | 改任何 Git 写操作或 CLI 命令记录 |
| `src-tauri/src/git/commands.rs` / `operations.rs` | 全部 Git 读写 IPC 适配；有界后台读取与 common Git dir 写互斥 | 改写操作执行调度 |
| `src-tauri/src/git/reset.rs` | Reset 预览、状态指纹、CLI HEAD 备份、执行与 reflog / 备份恢复列表 | 改 Reset / 恢复保护 |
| `src-tauri/src/git/rebase.rs` | 线性计划校验、真实 `rebase -i`、内部 sequence/message editor | 改交互式 Rebase |
| `src-tauri/src/system.rs` / `system/explorer.rs` | 安全解析仓库内路径并调用 OS 打开 / 显示；可选 HKCU 平铺分组资源管理器菜单与内嵌图标；同步后清理旧布局遗留键 | 改系统集成；菜单详见 `arch/explorer.md` |
| `src-tauri/src/launch.rs` | 固定 Explorer 动作与受控启动参数解析 | 改外部启动协议 |
| `src-tauri/src/window_host.rs` | 单实例请求队列、主窗口聚焦、轻量动作窗口创建与最后窗口退出 | 改外部启动 / 多窗口路由 |
| `src-tauri/src/git/history.rs` | git2 逐行 blame、CLI `--follow` 单文件历史、目录 / 文件范围 changelog、提交搜索与 `git grep` | 改文件历史 / 搜索 / 行数上限 |
| `src/types.ts` / `src/api.ts` | 前后端共享 TS 类型、在途读取去重 / `writeInvoke`、log-batch 订阅 | 改 IPC 字段 / 调用方式 |
| 前端页面、组件、交互原语、持久化与样式 | 见 [`arch/ui.md §1`](./arch/ui.md) | 改布局 / 交互 / 前端状态 |
| `src-tauri/tests/smoke.rs` / `workflows.rs` / `safety.rs` / `repository_capabilities.rs` | 临时真实仓库测试：基础流程、文件 / 冲突、Rebase、参数 / Push 安全、写互斥与新增仓库能力 | 改命令行为时补对应用例 |
| `tests/*.test.mjs` | Node 测试：正式 TS busy / 读取去重 / 草稿 / Diff、分组、打开页签、拖拽排序规则 | 改调度 / 视图 / 存储规则 |
| `src-tauri/examples/bench.rs` | release 日志、全量 diff / 按需首文件选中链路性能测量 | 改测量指标或核心读路径 |
| `src-tauri/tauri.conf.json` | 窗口、标识、构建配置 | 改窗口 / 打包 |
| `src-tauri/capabilities/default.json` | Tauri 2 权限配置（事件 listen/emit、窗口控制、dialog open 等） | 新增 IPC / 事件 / 插件权限 |
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
| 日志取消机制 | `log.rs` 的 `cancel_log`、`LOG_GENERATIONS`、`log_generations` | 按仓库 path 隔离；前端 `nextLogRequestId` 全局唯一 |
| diff 内容 / 大小上限 | `diff.rs` 的 `collect`、`oversized`、`MAX_PATCH_BYTES`、`MAX_TOTAL_PATCH_BYTES`、`MAX_DIFF_FILE_BYTES` | 先尺寸保护，再按需生成 Patch；`truncated` 与 binary 分开 |
| 文件清单 / 单文件 patch | `diff.rs` 的 `get_commit_files`、`get_commit_file_diff_with_old`、`get_worktree_file_diff_with_old`、`get_compare_files`、`get_compare_file_diff` | 清单不生成 patch；pathspec literal，改名传两侧路径 |
| 双端对比 | `diff.rs` 的 `get_compare_diff` | 解析两个 commit 后直接比较 tree，不等同于 `A..B` 日志 |
| 冲突状态 / 内容 | `status.rs` 的 `get_operation_state`、`get_conflict_file` | index stage 1/2/3 = base/ours/theirs |
| 冲突保存 / 继续 / 中止 | `cli.rs` 的 `save_resolved_file_checked`、`continue_operation`、`skip_operation`、`abort_operation` | 保存校验 expected 来源；skip 校验 expected 操作状态；危险操作 UI 确认 |
| 交互式 Rebase | `rebase.rs` 的 `prepare_interactive_rebase`、`validate_plan`、`internal_editor_entry` | 真实 `rebase -i`；内部 editor 从当前 exe 启动 |
| 工作区文件操作 | `cli.rs` 的 `discard_files`、`delete_untracked_files`；`system.rs` | 丢弃保留 staged；删除与打开前校验路径 |
| 写操作参数或错误处理 | `cli.rs` 的 `run_git`、`validate_ref_name`、`commit_argument` | 分支名 / revision 分开验证；Windows 下 `CREATE_NO_WINDOW` |
| 写互斥 / 后台执行 | `operations.rs` 的 `acquire_write`、`run_blocking`；`commands.rs` | 同仓库及 linked worktree 拒绝并发写；不同仓库可并行 |
| 有界后台读取 | `operations.rs` 的 `run_read`、`ReadPermit`；`commands.rs` 读适配、`log.rs::start_log` | 四令牌 FIFO 异步等待；令牌由 blocking 工作持有 |
| Reset / 恢复备份 | `reset.rs` 的 `get_reset_preview`、`reset`、`get_recovery_entries`、`create_backup` | 原 HEAD 与 branch / index / dirty 内容指纹；Hard clean 保护 |
| Push 目标与预览 / 远程管理 | `cli.rs` 的 `get_push_info`、`push_ex`、`fetch_ex`、`pull_ex`、`remote_*`；`repo.rs::remote_list` | 不 fallback；支持 `--force-with-lease`、`--tags`、fetch `--prune`、pull 策略与 `--autostash` |
| 分支扩展 / Merge / Worktree / Bisect | `cli.rs` 的 `checkout_remote_branch`、`rename_branch`、`delete_branches`、`delete_remote_branch`、`merge_branch`、`worktree_*`、`bisect_*`；`repo.rs::get_merged_branches` | 均经 `acquire_write` 与参数验证；`get_merged_branches` 自动排除当前 HEAD 与常见主干分支 |
| Hunk 暂存 / Fixup / 忽略 / 导出 / 命令日志 | `cli.rs` 的 `apply_diff_patch`、`commit_ex`、`commit_fixup`、`ignore_file`、`format_patch`、`archive_commit`、`get_command_log` | `apply_diff_patch` 通过 stdin 传给 `git apply`；命令日志保留最近 200 条 CLI 记录 |
| 重命名工作区文件 / 目录 | `cli.rs` 的 `rename_path`、`validate_rename_name` | 只允许同目录改名；`git mv` 仅处理已跟踪内容；拒绝路径分隔符、`.git`、Windows 保留名与已存在目标 |
| blame / 文件历史 / 提交与代码搜索 | `history.rs` 的 `blame_file`、`file_log`、`search_commits`、`git_grep` | blame 上限 2 MiB / 20000 行；搜索经受控 CLI NUL 协议解析 |

### 2.2 前端（`src/`）

前端页面、组件、交互原语、持久化、键盘与命令的入口表已拆到 [`arch/ui.md §2`](./arch/ui.md)。先按 §0.5 路由定位，再只读分册对应行，不在总览重复维护。

---

## 3. 重点链路详解（高频改动区 / 容易写错的地方）

### 日志流与取消（打开仓库 / 刷新 / 写操作后刷新）

- **需求语义**：日志可能上万条，必须分批到达；同仓库再次刷新时旧流必须作废，不同仓库可以并行加载。
- **关键坑**：旧请求的批次晚于新请求到达会污染列表；若取消代际全局唯一，一个仓库刷新会误停另一个仓库。
- **正确实现**：前端 `nextLogRequestId()` 生成全局唯一 ID，`RepoWorkspace` 只接收当前 ID；后端 `LOG_GENERATIONS` 以仓库 path 为键保存当前 ID，每批前检查，只取消同仓库旧流。
- **调用链**：`RepoWorkspace.refreshAll` → `api.startLog(path, id)` → `run_read` → `run_log` 每 300 条 emit `log-batch` → 会话校验 `requestId` 后 append。卸载发 `cancel_log`，同时作废详情 / 辅助读取代际；过期日志不发错误、不删除新请求代际。

### 前端刷新与预览链路

启动恢复与按需挂载、按需 Diff 预览、写操作后的分级刷新与轮询、diff 预览的 stale-while-revalidate 见 [`arch/ui.md §3`](./arch/ui.md)。后端读取令牌、写互斥与任务视图的 Git 语义见下节。

### 写操作调度与安全

- 所有写 API 经 `writeInvoke` 同步标记仓库 busy；写组件共享状态，关闭页签 / 离开任务复核 store，避免 React 重渲染前的重复点击。前端按打开路径分组，后端按 canonical common Git dir 兜底路径别名与 linked worktree。
- `commands.rs` 只把同步实现转入 blocking pool；`cli.rs` 与 Rebase 开始入口在校验前申请 RAII lease，覆盖文件写入、CLI 与 hooks，失败自动释放。同仓库拒绝新写而非排队；不同仓库可并行。保存冲突内部 stage 借用原 lease，不二次加锁。
- 无 upstream 的 Push 必须显式选已配置远程和合法目标分支，再检查预览 branch / HEAD；正常 Push 保留 Git 配置及原始失败，不自动改推 origin。创建分支用名称验证和解析后的 OID；切换只接受已存在的本地分支。
- 有界读取与写互斥是应用内部调度，不提供进程进度 / 超时或强杀；也不阻止外部 Git 进程，快照校验不能消除最后检查到 CLI 执行间的竞态。

### 冲突与交互式 Rebase

- 冲突中心以 `Repository::state()` 与 index conflicts 为准；stage 1/2/3 = base/ours/theirs。保存携带实际读取的 `expected` 四方内容，外部改动会被拒绝；刷新保留草稿原来源并提示陈旧，核对新来源后确认覆盖。保存后 stage，全部解决才允许 continue。
- 冲突文件草稿与 Rebase 计划存于当前 `RepoWorkspace` maps，提交面板常驻（隐藏而非卸载）。导航不丢草稿，关闭页签仍会警告；仅会话内保留，不写 localStorage。保存 / 执行成功或进入真实 Rebase 后清理对应草稿。
- Rebase 计划只编辑前端副本；执行时后端重新检查 clean 状态、原计划完整 branch ref、HEAD、线性范围和每个 OID，再生成受控 todo。`main.rs` 的内部 editor 模式把 todo / 提交信息写回 Git 指定文件，不依赖 shell 脚本或全局 Rebase 会话。
- 普通 / 交互式 Rebase 在开始前保存原 HEAD 备份引用，成功 / 失败反馈带引用；因冲突暂停进入冲突中心。skip（Rebase / Cherry-pick / Revert）携带原 OperationState，当前类型 / HEAD / 进度 / 冲突改变时拒绝；skip / abort 必须危险确认。

### Reset 预览与恢复

- `get_reset_preview` 解析固定目标 OID，展示 branch / HEAD、soft / mixed / hard 影响、staged / unstaged / untracked、将离开的提交数（最多 10000，超限标记）与阻挡路径。
- `reset` 在写 lease 内重取预览，对照 HEAD / 完整分支与 index + dirty 文件实际字节指纹；拒绝进行中操作与过期预览，先用 CLI `update-ref` 创建 `refs/git-extensions/backups/*` 再 reset。
- Hard 仅允许 clean index / worktree，未跟踪及 ignored 阻挡目标路径也拒绝；不递归修改子模块。soft 保留 index / worktree，mixed 保留 worktree。HEAD 备份不保护未提交内容，不能冒充整仓库快照。
- Recovery 列出备份引用与 HEAD reflog；选择恢复仍进入 Reset 预览与危险确认，不直接隐式修改仓库。备份提交不作为日常日志起点。

---

## 4. 数据流 / 接口契约（模块边界）

命令 = Tauri invoke（参数 camelCase，与 `src/api.ts` 一一对应），事件 = `log-batch`。

| 调用方 | 路由 / 入口 | 关键字段 / 约定 |
|---|---|---|
| 前端 → 后端 | `open_repo` / `get_branches` / `get_status` | `path` 为仓库内任意路径，后端 discover；RepoInfo 的 headOid / headBranch 在空仓库可为 null；detached 返回 HEAD 名称与实际 OID；状态项 `path` / `oldPath` 为重命名新 / 旧路径 |
| 前端 → 后端 | `start_log` / `cancel_log` | `requestId` 代际号；cancel 只取消匹配代际；`maxCount` 默认 100000，revspec 非空只从指定 ref 出发 |
| 后端 → 前端 | `log-batch` 事件 | `requestId`、`revisions[]`、`done`、`error` |
| 前端 → 后端 | `get_commit` / `get_commit_diff` | `oid` 为完整 40 位 |
| 前端 → 后端 | `get_commit_files` / `get_compare_files` | 不生成 patch 的 FileDiff 清单；compare 返回解析后的 baseOid / targetOid，后续单文件不再用可移动 ref |
| 前端 → 后端 | `get_commit_file_diff` / `get_compare_file_diff` / `get_worktree_file_diff` | 单文件 literal path；commit / compare / worktree 可携带 oldFile 保留改名两侧；worktree 的 staged 区分 HEAD-index / index-workdir |
| 前端 → 后端 | `get_compare_diff` | 保留全量兼容入口；base / target 解析提交后直接比较两棵 tree |
| 前端 → 后端 | `get_operation_state` / `get_conflict_file` | 返回真实操作类型、Rebase 进度、冲突列表与 base/ours/theirs/worktree |
| 前端 → 后端 | `save_resolved_file` / `continue_operation` / `skip_operation` / `abort_operation` | save 接受 expected ConflictFile，resolveAsDeletion=true 删除并 stage；拒绝 binary / 截断 / 非 UTF-8；skip expected OperationState，未解决禁止 continue |
| 前端 → 后端 | `prepare_interactive_rebase` / `start_interactive_rebase` | 线性非根范围；prepare 返回 onto、originalHead、完整 branch ref、entries；start 接收原完整 `plan`，不得重建 branch，执行前重新校验 |
| 前端 → 后端 | `discard_files` / `delete_untracked_files` / `open_path` / `reveal_path` | 仅仓库内相对路径；丢弃保留 staged；删除拒绝 tracked / ignored / 目录 |
| 前端 → 后端 | `get_worktree_diff` | `staged`：true=HEAD vs index，false=index vs workdir |
| 前端 → 后端 | `stage_files` / `unstage_files` / `preview_add_files` / `add_files` / `reset_changes` / `commit` / `commit_fixup` / `apply_diff_patch` / `ignore_file` | 走 CLI，stderr 原文返回；`preview_add_files` 执行 `git add --dry-run`；`add_files` 的 Filter 按 Git pathspec 语义；`reset_changes` 支持 deleteNew；`commit` 支持 `amend`；`apply_diff_patch` 支持 `cached` 与 `reverse`（Hunk 暂存/取消暂存/丢弃） |
| 前端 → 后端 | `create_branch` / `checkout_branch` / `checkout_remote_branch` / `rename_branch` / `delete_branch` / `delete_branches` / `delete_remote_branch` / `get_merged_branches` / `merge_branch` | 远程检出自动创建跟踪分支；批量删除与远程删除需确认；`merge_branch` 支持 `default` / `no-ff` / `ff-only` / `squash` |
| 前端 → 后端 | `fetch` / `pull` / `push` / `remote_list` / `remote_add` / `remote_set_url` / `remote_rename` / `remote_remove` | `fetch` 支持 `remote` / `prune`；`pull` 支持 `mode`、`autostash`、`remote` / `branch`、`fetchOnly`、`prune`、`tagsMode`；`push` 支持 `forceWithLease`、`force`、`pushTags`、`recurseSubmodules` |
| 前端 → 后端 | `list_patch_directory` / `apply_patch_file` / `apply_patch_directory` / `get_patch_apply_state` / `continue_patch` / `skip_patch` / `abort_patch` | 文件按内容自动选 `git apply` / `git am`；目录按文件名顺序；返回输出与退出码；am 冲突映射为 `applyPatch` 操作状态 |
| 前端 → 后端 | `worktree_list` / `worktree_add` / `worktree_remove` / `worktree_lock` / `worktree_prune` | 管理 linked worktree，写操作均走 CLI 并受仓库写互斥保护 |
| 前端 → 后端 | `search_commits` / `git_grep` / `format_patch` / `archive_commit` / `bisect_start` / `bisect_mark` / `bisect_reset` / `get_command_log` / `clear_command_log` | 提交搜索支持 message/author/path/allRefs；`git_grep` 支持 revision 与大小写；导出补丁/归档经 `dialog:allow-save` 选择目标路径；命令日志返回耗时、退出码与输出摘要 |
| 前端 → 后端 | `stash_*` / `cherry_pick` / `revert` / `rebase` / `create_tag` / `delete_tag` / `submodule_update` | 写操作经后台 IPC 与仓库写互斥，仍走 CLI；Push 契约见下一行 |
| 前端 → 后端 | `get_push_info` / `push` | 信息含 branch、branchRef、headOid、hasUpstream、upstream、remotes；push 可传 remote / branch 和 expectedHead / expectedBranch。明确目标必须携带预览，未指定则须有 upstream 并保留 Git 配置 |
| 前端 → 后端 | `get_reset_preview` / `reset` / `get_recovery_entries` | target + mode 返回 ResetPreview（branch / headOid / targetOid / fingerprint / 影响）；reset 必须传完整预览，返回 backupRef / previousHead / newHead / output；RecoveryEntry 含 oid / label / time / backupRef |
| 前端 → 后端 | `stash_apply` / `stash_drop` | 合法 stash@{n} + expectedOid，索引移动或对象变化时拒绝过期选择 |
| 前端 → 后端 | `get_contained_in` / `tag_list` / `submodule_list` / `worktree_list` / `get_ahead_behind` | 只读；contained-in 的分支 / 标签各限 100 条 |
| 前端 → 后端 | `blame_file` / `file_log` / `list_head_files` / `get_file_content` | blame 可选 oid 指定版本，默认对真实工作区 buffer 计算，未提交行 OID 为零；file_log 经 CLI --follow + NUL 字段协议，FileLogEntry.filePath 为该提交时期路径；list_head_files 只列 HEAD 已提交文件；get_file_content 读取指定 revision 内容（2 MiB 截断） |

**数据 / 单位约定**：时间戳为 Unix 秒，前端 `formatDate` 转本地时间；文件路径用 git 输出的 UTF-8 正斜杠形式；serde 结构统一 `rename_all = "camelCase"`；单 patch 512 KiB / 一次全量 patch 总计 4 MiB，单文件内容超过 8 MiB 则生成 patch 前跳过；超限置 truncated，不伪装 binary。

---

## 5. 样式 / 资源分段地图

样式锚点见 [`arch/ui.md §4`](./arch/ui.md)；图标资源跨平台要求见 §7。

---

## 6. 运维 / 脚本（启停 / 配置 / 打包）

- Windows 双击脚本（项目根，均为 pnpm/cargo 的薄包装，风格对齐 sc-code）：`setup.bat` 装依赖、`dev.bat` 开发运行、`build.bat` 前端构建（输出 `.runtime/dist`）、`test.bat` 前端状态 / IPC 测试 + 构建检查 + Rust 测试、`package.bat` 打包并把**本次新生成**的 NSIS / MSI、`unpack/` 免安装便携目录与便携 zip 发布到 `dist/release/`（`scripts/copy-bundle.mjs`：构建前 `snapshot` 记录安装包指纹，构建后 `collect` 只导出指纹变化的产物并附 SHA256SUMS.txt）、`clean.bat` 清构建产物（保留 `dist/release/`）。`snapshot` / `collect` 先检测并确认强制关闭占用发布 / 构建目录的运行中进程。`dev.bat` 调用的 `tauri:dev` 通过 `src-tauri/tauri.dev.conf.json` 使用独立 `productName` / `identifier`，可与安装版或便携版同时运行；非 0 退出时保留控制台窗口显示错误。
- 等价命令定义在 `package.json` 的 scripts（`dev`、`test`、`build`、`tauri:dev`、`tauri:build`），Rust 侧用 `cargo check` / `cargo test`（在 `src-tauri/`）。
- Linux / macOS 用 `sh test.sh`；三平台 CI 矩阵在 `.github/workflows/build-and-test.yml`。
- 大仓库性能测量：`cd src-tauri && cargo run --release --example bench -- <仓库路径> 3`；测量沿用正式同步读实现；输出首批 / 全日志、全量 diff、文件清单 / 首文件 patch 与两类选中链路 P95（不含 IPC / WebView 绘制）。历史基线见 `docs/03-性能与平台验证.md`。
- 文档机械体检：`sh check-docs.sh`。
- 资源管理器菜单图标：`powershell -File scripts/generate-menu-icons.ps1` 重新生成 `src-tauri/icons/menu/*.ico`（由 `include_bytes!` 内嵌，运行时物化到 `%LOCALAPPDATA%`）。

---

## 7. 易踩的坑 / 设计取舍

- **写操作不走 git2**：libgit2 不执行 hooks，且部分行为与 CLI 有差异；所有写操作（stage/commit/branch）经 `cli.rs` 派生 `git -C <path>`，stderr 原样上抛。
- **不缓存 Repository / 不做全局命令缓存**：每次按路径重新打开，避免 Git Extensions 那种缓存键不含工作目录导致跨仓库串数据的问题。
- **GUI 下派生 CLI 必须 `CREATE_NO_WINDOW`**（Windows），否则每次写操作闪控制台窗口。
- **无 HEAD 的新仓库**：`restore --staged` 会失败，`unstage_files` 自动退回 `reset -q --`。
- **diff 先限内容再限输出**：单文件 >8 MiB 在 Patch 前检查 delta / ODB header / 工作区元数据并跳过，单 patch 512 KiB、合计 4 MiB；超限是 truncated，不伪装 binary。Patch 生成后才能确定二进制，文件清单不能假定最终 binary 分类。
- **默认 revwalk 起点是 HEAD + refs（排除内部备份）**：detached 也必须 push HEAD；refs 先 peel_to_commit，annotated tag 不能直接 push。排除 refs/git-extensions/backups/，避免被 reset / drop 的旧提交只因备份而混入日常日志；空仓库发空 done。
- **Push 失败绝不更换目标**：无 upstream 时显式选择目标并校验 branch / HEAD；已有 upstream 的普通 Push 尊重 Git 配置。认证、网络、非快进等失败必须原样返回，不能当作首次推送 fallback。
- **写锁不可重入**：一个用户操作的内部步骤共用 RAII lease（例如冲突保存后 stage），不能再调用会申请锁的公共写入口；新增写 IPC 必须接入后端调度与前端 `writeInvoke`。
- **按 ref 过滤仍走同一条日志流**：`start_log` 的可选 `revspec` 只改变 revwalk 起点，保留同一套分批、图布局与双端取消逻辑。
- **性能测量复用正式实现**：`run_log` 暴露给同步调用方，Tauri 命令仍在后台线程执行；`examples/bench.rs` 不复制日志算法，避免基准与产品行为漂移。
- **破坏性文件操作必须先限定路径**：仓库内路径统一拒绝绝对路径、`..` 与越出 workdir；删除未跟踪文件前复核真实 Git 状态，discard 用 literal pathspec 且保留 index 中已暂存内容。
- **Rebase helper 使用 Git 元数据目录**：内部计划放在 `repo.path()` 下，兼容 linked worktree；不能把 `.git` 当目录拼在 workdir 后。
- **日志流线程必须捕获 panic**：`start_log` 用 `catch_unwind` 包裹 `run_log`，发生 panic 时回传 `error` 批次；否则线程静默退出，前端永远收不到 `done` / `error`，界面卡在「加载中」。`app.emit` 失败也要 `eprintln!`，不能 `let _ =` 静默吞掉。
- **Tauri 2 事件权限必须显式声明**：前端 `listen("log-batch")` 需要 `core:event:allow-listen`，否则权限拒绝导致提交图一直「加载中」；权限配置在 `src-tauri/capabilities/default.json`。
- **自动化复测入口**：开发模式 VITE_TEST_REPO 自动打开夹具，不写打开页签、最近仓库、上次仓库、行为设置或布局；关键状态通过 report_frontend_state 写后端临时日志。构建 / 单测不能替代 GUI、高 DPI 与 macOS 验收。
- **Reset / Rebase 备份只保存原 HEAD**：不是未提交文件备份。Hard 必须 clean，ignored 阻挡也检查；备份引用保留可达提交但不会进入默认日志。应用内部写锁与指纹校验不消除外部进程竞态；不要擅自执行 force push。
- **Stash 选择不是稳定索引**：应用 / 弹出 / 删除必须校验 expectedOid，stash@{n} 变动后拒绝旧预览；不能只凭索引误操作另一条。
- **文件历史路径属于对应提交**：--follow 的 rename 状态用 NUL 分隔解析，不用作者 / subject 可包含的文本哨兵；返回 filePath，查看历史 diff 使用该时期路径并从清单取得 oldPath。
- **图标资源必须跨平台齐全**：即使 bundle 未显式引用，`generate_context!` 在非 Windows 构建也需要 PNG；`icons/` 同时保留 ICO / PNG / ICNS，并在 bundle 配置中引用。
- **窗口启动请求必须可重复读取**：`get_window_bootstrap` 不能 `mem::take` 初始请求，否则 WebView 刷新（F5 / Ctrl+R / 前端重载）后拿不到动作，窗口停在「无法启动窗口」；`WindowSession` 分离 `initial` 与 `pending`，前端同时在捕获阶段拦截 F5 / Ctrl+R。轻量窗口隐藏创建，若前端页面加载失败会永远不显示，`show_after_timeout` 3 秒兜底 show，至少让用户看到错误页并可关闭。
- **前端交互取舍见分册**：顶部栏 / 页签拖拽 / 分组 / 启动恢复 / 草稿隔离 / 设置白名单 / 高亮限量 / 读取去重等 UI 规则见 [`arch/ui.md §5`](./arch/ui.md)；窗口生命周期与 capabilities 仍以本节和后端代码为准。
- **Explorer 文件/目录动作不同**：Commit/Pull/Push/Stash/View changes/Checkout 只在目录上下文，Difftool/File history/Apply patch 只在文件上下文，Rename 只在具体文件 / 目录（不进目录背景）；注册表菜单无法判断目录是否为有效 Git 仓库。**Windows 的 16 项上限作用于整棵级联菜单（Git Extensions 子菜单 + Others 及其子项合计），不是每层 16 项**；超出部分被系统静默丢弃。`validate_levels` 按目录 / 文件上下文分别统计并阻止保存，不自动迁移命令；一级项用 `GitExt.Top.*` 键紧跟 Git Extensions；二级分组为 Repository & sync / Branches & Repos / Files & history / Settings，Create new repository 与 Open repository 归在 Branches & Repos。成功同步后会清理 `GitExt.*` 命名空间里带所有权标记但不在 known 计划中的遗留键（旧开发版分组顺序会留下 `30.03.reset-file-changes` 之类重复项，既重复显示又占用 16 项容量）。Add files 的 Filter 是唯一按 Git pathspec 展开的写入口；`git stash push -u` 不能带 `--literal-pathspecs`，否则未跟踪文件不会被 stash。
- **打包产物只导本次构建**：NSIS / MSI 每次构建都会内嵌时间戳，大小与 SHA256 都会变，不能靠「文件已存在 + 版本号」判断新包。`package.bat` 先 `snapshot` 记录 bundle 内安装包的 size / mtime / birthtime，构建后 `collect` 只导出指纹变化且版本匹配的产物，否则报错而不是发布旧包。`dist/release/` 整目录重建（旧产物清理），unpack 直接取 `target/release` 的 exe（写入 bundle 信息后仍可独立运行），zip 用 `Compress-Archive` 以应用根为根目录并回读校验。
- **前端产物与发布产物目录分离**：vite `build.outDir` 设为 `.runtime/dist`，`tauri.conf.json` 的 `frontendDist` 指向 `../.runtime/dist`；项目根 `dist/release/` 只放打包成品。若前端仍输出到 `dist/`，`vite build` 会清空整个目录，把安装包、便携 zip 和 unpack 一起删掉。`clean.bat` 因此保留 `dist/release/`，只清 `.runtime/dist`、打包临时状态与 `src-tauri/target`。
