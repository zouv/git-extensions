# Windows 资源管理器集成与外部启动链路

> 本册只覆盖可选资源管理器菜单、单实例多窗口、受控启动参数及其轻量 Git 工作流。通用写调度、设置白名单和仓库恢复规则见根图谱对应小节。

## 1. 模块职责

| 文件 | 职责 |
|---|---|
| `src-tauri/src/launch.rs` | 20 个固定 `ExplorerAction`、`opens_main_window`、严格 `OsString` 参数解析、`LaunchRequest` |
| `src-tauri/src/window_host.rs` | 单实例请求路由、按窗口 pending 队列、主窗口确保 / 聚焦、轻量窗口创建、最后窗口退出 |
| `src-tauri/src/system.rs` / `system/explorer.rs` | 平台能力 IPC；HKCU 平铺分组菜单（分隔线）计划、内嵌图标物化、文件 / 目录上下文、所有权保护、注册 / 注销、回滚与 Shell 刷新 |
| `src-tauri/src/lib.rs` / `main.rs` | Rebase editor 优先；注册第一个插件 single-instance，创建窗口后按首请求分流 |
| `src/main.tsx` / `window_host` 命令 | 启动时先取 `get_window_bootstrap`，分流到完整 App 或单任务窗口；轻量窗口渲染后显示 |
| `src/App.tsx` | 完整主窗口恢复页签；订阅 `main-launch-available`，串行消费 Open repository / Settings 请求 |
| `src/explorer/ExplorerWindow.tsx` | 轻量窗口总入口、动作分发、错误 / 关闭保护；不挂载页签、主工作区和持久化 effect |
| `src/explorer/{CommitWindow,HistoryWindow,StashWindow,RepositorySettingsWindow,ViewFilesWindow}.tsx` | 提交 / 变更、只读 View changes / 文件历史（含文件内容 View / Blame 页签）、工作区 + stash 管理窗口、当前仓库只读设置、HEAD 文件树 / 内容浏览 |
| `src/explorer/ResetChangesDialog.tsx` / `RenamePathDialog.tsx` | Reset file changes 确认与真正重置；Rename 输入新名称并执行 `git mv` |
| `src/explorer/portableWindow.ts` / `src/explorerWindowState.ts` | 原生标题栏关闭保护与关闭当前窗口；轻量窗口按动作保存 / 恢复尺寸 |
| `src/explorerMenu.ts` / `settings.ts` / `components/SettingsDialog.tsx` | 固定动作表、三态 placement 白名单与迁移、命令列表及实时预览 |
| `src/components/{Clone,CreateRepository,CheckoutRevision,DiffTool,ApplyPatch,Push,Stash,Branch}Dialog.tsx` | 轻量窗口复用的显式输入、预览、确认与忙碌状态；Clone 含窗口内进度页 |
| `src/components/{AddFilesDialog,BlameView,BlameDialog,PullDialog}.tsx` | Add files（pathspec + dry-run/force）、Blame 列表、可复用的 Pull 选项弹窗 |
| `src-tauri/src/git/{cli,commands,operations,repo,history,status}.rs` | Clone / init（含 bare）/ revision / difftool / pull / push / stash / patch 管理；文件目标解析、范围历史与 patch/am 操作状态 |

## 2. 常见改动入口

| 任务 | 函数 / 锚点 | 约定 |
|---|---|---|
| 改菜单项或命令行 | `explorer.rs` 的 `ACTIONS`、`GROUPS`、`ICON_FILES`、`CONTEXTS`、`build_configured_plan`、`command_line` | 同步 `launch.rs::ExplorerAction`、`explorerMenu.ts`（含 `EXPLORER_MENU_GROUPS`、上下文支持表）、`types.ts`；`Context::supports` 区分目录 / 文件动作，Rename 不进目录背景；一级键用 `GitExt.Top.NN.action` 紧跟 Git Extensions，二级键用「组前缀.动作序号.action」，三级用 `Others` 容器；整棵级联树（含 Others 子项）超过 16 项只报错不自动迁移 |
| 改 Add files / Reset file changes | `cli.rs::preview_add_files`、`add_files`、`reset_changes`；`AddFilesDialog.tsx`、`ResetChangesDialog.tsx` | Add files 的 Filter 按 Git pathspec 语义，Show files 走 `--dry-run`；Reset 用 `git restore --source=HEAD --staged --worktree`，可同时 clean 新增文件 |
| 改 Stash 窗口 | `cli.rs::stash_push_ex`、`StashWindow.tsx` | `stash push` 不能带 `--literal-pathspecs`（会破坏 `-u`）；选中路径用 `:(literal)` 保护；stash diff 复用 `get_commit_files` / `get_commit_file_diff` |
| 改 Apply patch | `cli.rs::{list_patch_directory,apply_patch_file_ex,apply_patch_directory_ex,get_patch_apply_state,continue_patch,skip_patch,abort_patch}`、`ApplyPatchDialog.tsx` | 自动识别 diff / mailbox；目录按文件名顺序逐个应用；`git am` 冲突在窗口内 continue/skip/abort，并映射为 `applyPatch` 操作状态 |
| 改 Pull / Push | `cli.rs::{pull_ex_advanced,push_ex_advanced}`、`PullDialog.tsx`、`PushDialog.tsx` | Pull 支持 upstream / 指定 remote+branch / fetch-only / prune / tag 模式；Push 支持 force-with-lease、force、tags、recurse-submodules=check |
| 改 Branch / Checkout | `cli.rs::{create_branch_ex,checkout_branch_ex,checkout_remote_branch_ex,checkout_revision_ex}`、`BranchDialog.tsx`、`CheckoutRevisionDialog.tsx` | 切换策略 default / stash / reset；创建分支可 checkout / orphan；切换 revision 可 force |
| 改克隆进度 | `cli.rs::clone_repository_with_progress`、`commands.rs::clone_repository_with_progress`、`CloneDialog.tsx` | stderr 按 `\r` / `\n` 分行经 `clone-progress` 事件推送；前端按 `operationId` 过滤；仍走仓库写互斥与 CLI |
| 改注册 / 注销 / 布局迁移 | `explorer.rs::build_known_plan`、`reconcile`、`disable_owned_key`、`notify_shell_association_changed` | 三种上下文均纳入 known；成功变更后 `SHChangeNotify(SHCNE_ASSOCCHANGED)`；自动测试不写真实 HKCU |
| 改窗口路由 | `window_host.rs::route_request`、`queue_main_request`、`create_explorer_window`、`window_destroyed` | 请求先入对应窗口队列再创建窗口；主窗口事件只作唤醒，前端再排空队列 |
| 改启动参数 | `launch.rs::parse_launch_request`、`opens_main_window` | 只有 Open repository / Settings 进入主窗口；路径允许目录或文件 |
| 改文件目标 | `repo.rs::resolve_explorer_target`、`history.rs::scoped_history` | 文件从父目录 discover；返回仓库根、scope、相对路径；禁止 `.git` 与逃逸路径 |
| 改 Commit / View changes 的目录作用域 | `cli.rs::commit_ex_scoped`、`ChangesPanel.tsx` 的 `scopePath`、`HistoryWindow.tsx` | Commit 用临时 index 只提交 scope 下已暂存内容并保留真实 index 其它改动；View changes / View history 用 scope 作为 pathspec；目录根为 null |
| 改轻量动作 | `ExplorerWindow.tsx` 动作 switch、对应 `src/explorer/*` | 复用现有 Dialog；轻量入口不得写 openRepos / settings / windowState；写操作仍走 api / lease；窗口尺寸由 `explorerWindowState.ts` 按动作存 localStorage，`main.tsx` 在 show 前恢复 |
| 改 Rename | `cli.rs::rename_path`、`validate_rename_name`、`RenamePathDialog.tsx` | 仅同目录改名；`git mv` 只处理已跟踪内容；仓库根、路径分隔符、`.git`、Windows 保留名与已存在目标一律拒绝 |
| 改菜单设置 / 预览 | `explorerMenu.ts` 纯预览；`SettingsDialog.tsx` 系统集成分类；`App.tsx::saveSettingsDialog` | 三态 top / cascade / hidden；启用时保存即重注册，成功后才保存 / 关闭 |

## 3. 启动与窗口链路

- 设置默认关闭。启用写入 `HKCU\Software\Classes\Directory\shell`、`Directory\Background\shell` 与 `*\shell`；目录传 `%1`、背景传 `%V`、文件传 `%1`。上下文规则与参考项目对齐：克隆 / 新建仓库只在目录上下文；Commit / Pull / Push / View stash / View changes / Checkout / Create branch 只在目录上下文；Open with difftool / Apply patch 只在文件上下文；View history / Open repository / Reset file changes / Add files / Settings / Repository settings / View files 在文件、目录与目录背景中都显示，View history 对文件用 `--follow`、对目录 / 当前文件夹按目录过滤。静态注册表菜单无法判断目录是否为有效 Git 仓库。
- 菜单位置支持一级 / 二级 / 三级（Others）/ 隐藏。一级项使用 `GitExt.Top.NN.<action>` 键，`T` > `M` 保证它们紧跟 `GitExt.Menu` 之后，并按键名中的全局序号与设置页顺序一致。二级菜单按分组平铺，组间用 `CommandFlags=0x20` 分隔；分组为 Repository & sync（Clone / Commit / Pull / Push / Stash / Changes）、Branches & Repos（Create new repository / Open repository / 分支动作）、Files & history、Settings；超出一级/二级配置的命令由用户显式设为三级，集中到 `Others` 子菜单（`GitExt.Menu\shell\99.Others` → `GitExt.Menu\others\shell\...`）。
- Windows 对 `ExtendedSubCommandsKey` 生成的整棵级联菜单（Git Extensions 子菜单 + `Others` 及其子项）合计最多渲染 16 个命令；超出部分被系统静默丢弃，且计数按目录 / 文件上下文的实际可用命令分别统计。`validate_levels` 返回错误、设置页提示并禁止保存，不会自动移动用户配置；参考项目使用原生 COM Shell Extension，不受此限。
- 成功同步（`set_enabled`）后会递归清理 `GitExt.*` 命名空间里带 `GitExtensionsOwner` 标记、但不在 known 计划中的遗留键：旧开发版的分组顺序会产生 `30.03.reset-file-changes` 之类的重复菜单项，既重复显示又占用 16 项容量；清理只删除确认由本应用拥有的键，外部值 / 子键存在时保留父键。
- 菜单图标由 `ICON_FILES` 内嵌进二进制，启用时写入 `%LOCALAPPDATA%\git-extensions\menu-icons\*.ico`，不在注册表里依赖安装目录或 Tauri resource 路径；写入失败时回落到应用 exe 图标。图标源文件与生成脚本见 `src-tauri/icons/menu/`、`scripts/generate-menu-icons.ps1`。
- 级联父键使用 `MUIVerb`，`(Default)` 必须为**值未设置**。`ExtendedSubCommandsKey` 是父键上的 **REG_SZ 相对路径值**（如 `Directory\shell\GitExt.Menu`、`*\shell\GitExt.Menu`），子命令位于该路径对应键的 `shell` 下；字面 `ExtendedSubCommandsKey` 子键或空字符串值都不能让 Explorer 识别级联。此格式以 Windows 自带 `Directory\shell\UpdateEncryptionSettings` 为实测参照，known 计划同时覆盖两种旧布局和旧 `(Default)` 标签。
- `main` 先处理内部 Rebase editor，再解析 `--explorer-action <动作> [--path <路径>]`。single-instance 插件必须最先注册；首进程按首请求创建窗口，后续进程只把参数转发给首进程。
- `window_host` 为每个窗口保存 `initial`（首个请求，重复 bootstrap 时原样返回）与 `pending` 请求。`main` / `open-repository` / `settings` 进入唯一完整主窗口；其余动作各创建 `action-N` 轻量窗口。主窗口已存在时先 `unminimize → show → set_focus`，再入队并 emit `main-launch-available`；前端先订阅事件，再调用 `take_pending_launches` 排空，避免丢请求。
- 前端启动 `get_window_bootstrap` 决定渲染完整 `App` 或 `ExplorerWindow`；轻量窗口在 `main.tsx` 外层包 `ConfirmProvider`，保证弹窗 dirty 关闭与危险确认可用。轻量窗口隐藏创建，React 提交后调用 `show_current_window`；若前端页面加载失败（例如菜单指向的 dev 构建没有 Vite 服务），`show_after_timeout` 会在 3 秒后兜底显示窗口，避免「点了菜单没反应」。`main.tsx` 在捕获阶段拦截 F5 / Ctrl+R，防止刷新清空窗口启动上下文。不读取 / 保存主窗口的窗口几何、页签、分组或最近仓库。
- exe 始终使用 Windows GUI 子系统，Explorer 从注册表菜单启动新进程时不会闪控制台窗口；调试构建在标准句柄缺失时 `AttachConsole(ATTACH_PARENT_PROCESS)` 并用 `CONOUT$` 恢复 stdout / stderr（已有句柄 / 重定向保持原样），所以 dev.bat / cargo / tauri dev 启动时日志仍可见。派生 `git` / `explorer.exe` 的 `CREATE_NO_WINDOW` 仍是独立要求。
- Open repository / Settings 由主窗口串行消费；Repository settings 是轻量窗口内的只读仓库配置面板。Open 复用 `openRepo` 去重 / 激活页签；Settings 直接打开设置弹窗。轻量动作窗口是单任务界面，不启动提交日志洪流或主工作区轮询。

## 4. IPC 契约

| 命令 | 关键字段 / 返回 |
|---|---|
| `get_window_bootstrap` / `take_pending_launches` | 当前窗口 `{ kind: main \| explorer, requests }`；bootstrap 可重复调用并始终返回创建时的初始请求（页面刷新后仍能恢复），pending 仅由 `take_pending_launches` 排空 |
| `show_current_window` / `focus_main_window` / `open_repository_in_main` | 显示当前轻量窗口；确保并聚焦主窗口；把仓库路径排入主窗口 Open 请求 |
| `get_explorer_integration_info` / `set_explorer_context_menu_enabled` | `{ supported }` / `{ enabled, items, alwaysShowAllCommands }`；items 为强类型 action + placement（top / cascade / others / hidden），重复 action 拒绝、缺项按 hidden；任一上下文（目录 / 文件）整棵级联树超过 16 项返回错误 |
| `resolve_explorer_target` | `{ repo, scope: repository \| directory \| file, relativePath }`；文件从父目录 open，拒绝仓库外与 `.git` 内部路径 |
| `scoped_history` | 从 `HEAD` 取历史；目录按 pathspec 过滤，文件启用 `--follow`；最多 5000 条 |
| `list_head_files` / `get_file_content` | `list_head_files` 递归列出 HEAD tree 的 blob（不含暂存区未提交新文件）；`get_file_content` 读取指定 revision（默认 HEAD）内容，2 MiB 截断、binary 标记 |
| `rename_path` | `{ path, relative, newName } -> 新相对路径`；只允许同目录改名，`git mv` 失败时保留原错误；未跟踪内容拒绝 |
| `pull_with_output` / `pull` | `pull` 支持 `mode`、`autostash`、`remote` / `branch`、`fetchOnly`、`prune`、`tagsMode`；`pull_with_output` 保留 stdout/stderr 双通道 |
| `clone_repository` / `clone_repository_with_progress` / `create_repository` | 绝对目标 path；成功返回可打开的规范化路径。Clone 目标须不存在或为空；Create 支持 `bare=true`（`--bare --shared=all`），拒绝嵌套。带进度版本按 `operationId` 推送 `clone-progress` 事件 `{ operationId, line }`（git stderr 逐行） |
| `resolve_revision` / `checkout_revision` | revision peel 为完整 commit OID；checkout 只接受完整 OID，以 CLI detached switch 执行；`force` 对应 `--force` |
| `open_difftool` / `list_tracked_files` | difftool 传仓库内 file + staged，等待已配置工具退出；tracked 清单排除 gitlink 与冲突 stage |
| `preview_add_files` / `add_files` | Filter 按 Git pathspec 解释；preview 执行 `git add --dry-run`，add 执行 `git add`（可选 `-f`），返回原始终端输出与退出码 |
| `reset_changes` | paths 为空重置整仓库；否则按文件状态 restore / unstage / clean；`deleteNew` 控制是否删除新增文件 |
| `commit` | `scope` 为仓库内目录 / 文件相对路径（根为 null）；有 scope 时只提交该范围已暂存内容，临时 index 不改变真实 index；进行中操作 / 冲突时拒绝作用域提交 |
| `stash_push` | 扩展 `keepIndex` 与 `paths`；选中路径用 `:(literal)` 保护，`-u` 依赖非 literal pathspec 模式 |
| `create_branch` / `checkout_branch` / `checkout_remote_branch` | 创建分支支持 `checkout` / `orphan`；切换分支支持 `default` / `stash` / `reset` 本地修改策略 |
| `push` | 支持 `forceWithLease`、`force`、`pushTags`、`recurseSubmodules` |
| `list_patch_directory` / `apply_patch_file` / `apply_patch_directory` / `get_patch_apply_state` / `continue_patch` / `skip_patch` / `abort_patch` | 目录只收 `.patch/.diff/.mbox`；文件按内容自动选 `git apply` / `git am`；返回输出与退出码；am 冲突状态映射为 `applyPatch` 操作 |
| `preview_patch` / `apply_patch` | 旧的单文件 OID 校验入口保留；新 Apply patch 窗口使用上面的扩展命令 |

## 5. 安全与平台边界

- Clone / init 在校验前以规范化目标未来 `.git` 路径申请非阻塞 RAII lease，与已有仓库 canonical common Git dir 写锁对齐。single-instance 后同进程窗口共享 Rust 写锁；外部 Git 仍需 Git 自身锁，前端 busy 不跨 WebView 自动同步。
- Apply patch 重读文件并核对 OID；hash、`apply --check`、stat、正式 apply 使用同一不可变字节快照经 stdin 传递，不经过 shell。只改 worktree，不带 `--index` 或三方合并。
- Add files 是唯一允许关闭 `--literal-pathspecs` 的写入口，因为 Filter 本身就是用户输入的 Git pathspec；路径仍经 `--` 与参数校验隔离选项。`git stash push -u` 也不能带 `--literal-pathspecs`（会不清理未跟踪文件），选中路径改用 `:(literal)`。
- 新 Apply patch 窗口调用 `git apply` / `git am` 时保留原始终端输出与退出码；`git am` 冲突会留下仓库操作状态，窗口内提供 continue / skip / abort，并在主窗口 ConflictCenter 中按 `applyPatch` 处理。
- 轻量窗口只写 Git / 本机界面状态；主窗口配置、页签、分组、布局与窗口几何仍只由完整 App 写入，避免多窗口覆盖。轻量动作窗口自身尺寸按动作写入独立的 localStorage 键（`explorerWindowState.ts`），不属于主窗口几何。
- Windows 不允许重命名正被其它进程作为**当前工作目录**的目录，`git mv` 会报 `Permission denied`；Rename 面板检测该错误并提示关闭终端 / 编辑器 / Agent 或切换其目录，同时对可能是杀毒 / 索引造成的瞬时占用重试两次（工作区已部分移动时不重试）。
- 注册表计划带应用所有权标记，预先检查并支持幂等与失败回滚，不删除外部队列键。Windows 11 本期位于经典「显示更多选项」，不实现 COM / MSIX 一级菜单；不注册驱动器或桌面背景。
- 上一版嵌套分组布局的 `GitExt.Menu\groups`、`GitExt.Group.*` 以及上一版平铺分组键都已纳入 known 计划做 remove-only 清理；`winreg` 的 `create_subkey` 会隐式创建中间键，计划里必须显式包含这类父键，否则禁用后空键会阻止祖先键清理。Explorer 在 `(Default)` 为空时按子键名排序，所以平铺命令键仍带数字前缀。
- 外部启动参数由 single-instance 插件以字符串转发，非 Unicode 路径不在保证范围；静态菜单不能复刻上游 COM 按 Git 仓库状态动态增删命令的能力。
- exe 路径取 `current_exe()`，安装版与便携版一致。便携目录移动后必须重新启用；卸载自动清理不在本期，卸载前先关闭菜单。
