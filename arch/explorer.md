# Windows 资源管理器集成与外部启动链路

> 本册只覆盖可选资源管理器菜单、单实例多窗口、受控启动参数及其轻量 Git 工作流。通用写调度、设置白名单和仓库恢复规则见根图谱对应小节。

## 1. 模块职责

| 文件 | 职责 |
|---|---|
| `src-tauri/src/launch.rs` | 17 个固定 `ExplorerAction`、`opens_main_window`、严格 `OsString` 参数解析、`LaunchRequest` |
| `src-tauri/src/window_host.rs` | 单实例请求路由、按窗口 pending 队列、主窗口确保 / 聚焦、轻量窗口创建、最后窗口退出 |
| `src-tauri/src/system.rs` / `system/explorer.rs` | 平台能力 IPC；HKCU 菜单计划、文件 / 目录上下文、所有权保护、注册 / 注销、回滚与 Shell 刷新 |
| `src-tauri/src/lib.rs` / `main.rs` | Rebase editor 优先；注册第一个插件 single-instance，创建窗口后按首请求分流 |
| `src/main.tsx` / `window_host` 命令 | 启动时先取 `get_window_bootstrap`，分流到完整 App 或单任务窗口；轻量窗口渲染后显示 |
| `src/App.tsx` | 完整主窗口恢复页签；订阅 `main-launch-available`，串行消费 Open repository / Settings 请求 |
| `src/explorer/ExplorerWindow.tsx` | 轻量窗口总入口、动作分发、错误 / 关闭保护；不挂载页签、主工作区和持久化 effect |
| `src/explorer/{CommitWindow,PullWindow,HistoryWindow}.tsx` | 提交 / 变更、Pull 输出、分支 / 目录 / 文件范围历史与 Reset / Rebase 操作 |
| `src/explorer/portableWindow.ts` | 原生标题栏关闭保护与关闭当前窗口 |
| `src/explorerMenu.ts` / `settings.ts` / `components/SettingsDialog.tsx` | 固定动作表、三态 placement 白名单与迁移、命令列表及实时预览 |
| `src/components/{Clone,CreateRepository,CheckoutRevision,DiffTool,ApplyPatch,Push,Stash,Branch}Dialog.tsx` | 轻量窗口复用的显式输入、预览、确认与忙碌状态 |
| `src-tauri/src/git/{cli,commands,operations,repo,history}.rs` | Clone / init / revision / difftool / pull 输出 / patch；文件目标解析与范围历史 |

## 2. 常见改动入口

| 任务 | 函数 / 锚点 | 约定 |
|---|---|---|
| 改菜单项或命令行 | `explorer.rs` 的 `ACTIONS`、`CONTEXTS`、`build_configured_plan`、`command_line` | 同步 `launch.rs::ExplorerAction`、`explorerMenu.ts`、`types.ts`；文件上下文用 `Context::supports` 限制动作 |
| 改注册 / 注销 / 布局迁移 | `explorer.rs::build_known_plan`、`reconcile`、`disable_owned_key`、`notify_shell_association_changed` | 三种上下文均纳入 known；成功变更后 `SHChangeNotify(SHCNE_ASSOCCHANGED)`；自动测试不写真实 HKCU |
| 改窗口路由 | `window_host.rs::route_request`、`queue_main_request`、`create_explorer_window`、`window_destroyed` | 请求先入对应窗口队列再创建窗口；主窗口事件只作唤醒，前端再排空队列 |
| 改启动参数 | `launch.rs::parse_launch_request`、`opens_main_window` | 只有 Open repository / Settings 进入主窗口；路径允许目录或文件 |
| 改文件目标 | `repo.rs::resolve_explorer_target`、`history.rs::scoped_history` | 文件从父目录 discover；返回仓库根、scope、相对路径；禁止 `.git` 与逃逸路径 |
| 改轻量动作 | `ExplorerWindow.tsx` 动作 switch、对应 `src/explorer/*` | 复用现有 Dialog；轻量入口不得写 openRepos / settings / windowState；写操作仍走 api / lease |
| 改菜单设置 / 预览 | `explorerMenu.ts` 纯预览；`SettingsDialog.tsx` 系统集成分类；`App.tsx::saveSettingsDialog` | 三态 top / cascade / hidden；启用时保存即重注册，成功后才保存 / 关闭 |

## 3. 启动与窗口链路

- 设置默认关闭。启用写入 `HKCU\Software\Classes\Directory\shell`、`Directory\Background\shell` 与 `*\shell`；目录传 `%1`、背景传 `%V`、文件传 `%1`。文件上下文排除 Clone / Create repository，其余动作按三态配置。
- 级联父键使用 `MUIVerb`，`(Default)` 必须为**值未设置**。`ExtendedSubCommandsKey` 是父键上的 **REG_SZ 相对路径值**（如 `Directory\shell\GitExt.Menu`、`*\shell\GitExt.Menu`），子命令位于该路径对应键的 `shell` 下；字面 `ExtendedSubCommandsKey` 子键或空字符串值都不能让 Explorer 识别级联。此格式以 Windows 自带 `Directory\shell\UpdateEncryptionSettings` 为实测参照，known 计划同时覆盖两种旧布局和旧 `(Default)` 标签。
- `main` 先处理内部 Rebase editor，再解析 `--explorer-action <动作> [--path <路径>]`。single-instance 插件必须最先注册；首进程按首请求创建窗口，后续进程只把参数转发给首进程。
- `window_host` 为每个窗口保存 pending 请求。`main` / `open-repository` / `settings` 进入唯一完整主窗口；其余动作各创建 `action-N` 轻量窗口。主窗口已存在时先 `unminimize → show → set_focus`，再入队并 emit `main-launch-available`；前端先订阅事件，再调用 `take_pending_launches` 排空，避免丢请求。
- 前端启动 `get_window_bootstrap` 决定渲染完整 `App` 或 `ExplorerWindow`。轻量窗口隐藏创建，React 提交后调用 `show_current_window`；不读取 / 保存主窗口的窗口几何、页签、分组或最近仓库。
- Open repository / Settings 由主窗口串行消费。Open 复用 `openRepo` 去重 / 激活页签；Settings 直接打开设置弹窗。轻量动作窗口是单任务界面，不启动提交日志洪流或主工作区轮询。

## 4. IPC 契约

| 命令 | 关键字段 / 返回 |
|---|---|
| `get_window_bootstrap` / `take_pending_launches` | 当前窗口 `{ kind: main \| explorer, requests }`；bootstrap 消费初始请求，pending 排空后续请求 |
| `show_current_window` / `focus_main_window` / `open_repository_in_main` | 显示当前轻量窗口；确保并聚焦主窗口；把仓库路径排入主窗口 Open 请求 |
| `get_explorer_integration_info` / `set_explorer_context_menu_enabled` | `{ supported }` / `{ enabled, items, alwaysShowAllCommands }`；items 为强类型 action + placement，重复 action 拒绝、缺项按 hidden |
| `resolve_explorer_target` | `{ repo, scope: repository \| directory \| file, relativePath }`；文件从父目录 open，拒绝仓库外与 `.git` 内部路径 |
| `scoped_history` | 从 `HEAD` 取历史；目录按 pathspec 过滤，文件启用 `--follow`；最多 5000 条 |
| `pull_with_output` | 成功返回 `{ stdout, stderr, exitCode }` 两个独立通道；失败仍返回原始 `GitError::Cli` |
| `clone_repository` / `create_repository` | 绝对目标 path；成功返回可打开的规范化路径。Clone 目标须不存在或为空；Create 允许独立非空目录，拒绝嵌套，均为非 bare |
| `resolve_revision` / `checkout_revision` | revision peel 为完整 commit OID；checkout 只接受完整 OID，以 CLI detached switch 执行并保留 dirty 保护 |
| `open_difftool` / `list_tracked_files` | difftool 传仓库内 file + staged，等待已配置工具退出；tracked 清单排除 gitlink 与冲突 stage |
| `preview_patch` / `apply_patch` | patchPath 必须是绝对普通文件，≤16 MiB；预览返回 patchOid + stat，应用必须携带 expectedPatchOid |

## 5. 安全与平台边界

- Clone / init 在校验前以规范化目标未来 `.git` 路径申请非阻塞 RAII lease，与已有仓库 canonical common Git dir 写锁对齐。single-instance 后同进程窗口共享 Rust 写锁；外部 Git 仍需 Git 自身锁，前端 busy 不跨 WebView 自动同步。
- Apply patch 重读文件并核对 OID；hash、`apply --check`、stat、正式 apply 使用同一不可变字节快照经 stdin 传递，不经过 shell。只改 worktree，不带 `--index` 或三方合并。
- 轻量窗口只写 Git / 本机界面状态；主窗口配置、页签、分组、布局与窗口几何仍只由完整 App 写入，避免多窗口覆盖。
- 注册表计划带应用所有权标记，预先检查并支持幂等与失败回滚，不删除外部队列键。Windows 11 本期位于经典「显示更多选项」，不实现 COM / MSIX 一级菜单；不注册驱动器或桌面背景。
- 外部启动参数由 single-instance 插件以字符串转发，非 Unicode 路径不在保证范围；静态菜单不能复刻上游 COM 按 Git 仓库状态动态增删命令的能力。
- exe 路径取 `current_exe()`，安装版与便携版一致。便携目录移动后必须重新启用；卸载自动清理不在本期，卸载前先关闭菜单。
