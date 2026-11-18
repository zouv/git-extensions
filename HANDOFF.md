# 接力进度 / Handoff · git-extensions

## 状态快照

- 最近更新：2026-11-18。Clone 界面分支选择与克隆选项、移除轻量窗口重复界面内标题栏（Pull / Push / Clone 等）均已完成并通过 `test.bat` 全量验证；CHANGELOG / ARCH 已同步。0.12.0 已打包（NSIS / MSI / 便携 zip），`sha256sum -c` 三个产物全部 OK；主程序为 `GitExtensions.exe`。当前无进行中任务（真实资源管理器 GUI / 高 DPI 验收待补）。
- 远程已关联并推送：origin = https://github.com/zouv/git-extensions；0.12.0 随本次发布提交 / 打标签 / 推送并上传 Release。

## 当前任务

无进行中任务。上一任务（Clone 界面新增分支与克隆选项、移除轻量窗口重复界面内标题栏，2026-11-18）已完成并验证，成果见下方验证状态与 CHANGELOG `[未发布]`。

## 进行中

无。

## 下一步

1. 在真实资源管理器中复测轻量窗口标题栏（空白区拖动 / 图标 / 对齐 / 窗口控制 / 无重复界面内标题栏）与 Clone 窗口新分支、选项、远程查询交互；确认高 DPI 与安装 / 便携版菜单指向 `GitExtensions.exe`。
2. 如需发布，整理 `[未发布]` 条目并发版（当前 0.12.0 已随本次发布提交 / 打标签 / 推送并上传 Release）。

## 验证状态

- 2026-11-18 移除轻量窗口重复界面内标题栏：Pull / Push / Clone 等复用 `Dialog` 的窗口在自绘 `PortableTitleBar` 下又出现一层 `modal-header`（标题 + 关闭 X）。通过 `body.portable-window .modal-header { display: none }` 全局隐藏，并让紧随的 `.modal-body` 占满剩余高度；`tests/explorer-dialog-header.test.mjs` 覆盖。`./test.bat` 全绿（Node 114、cargo 48 + 15 + 21 + 16 + 15），`sh check-docs.sh` 通过；CHANGELOG / `arch/explorer.md` 已同步；待真实 GUI 视觉验收。
- 2026-11-18 Clone 分支与选项：`cli.rs` 新增 `CloneOptions` 与 `clone_repository_with_options`（branch 经 `validate_ref_name` 校验，映射 `--branch` / `--recurse-submodules` / `--depth 1` / `--single-branch`），新增只读 `list_remote_branches`（`git ls-remote --heads --`，禁交互凭证提示）；`commands.rs` / `lib.rs` / `api.ts` / `types.ts` 同步；`CloneDialog` 增加 Branch 组合框（默认 `(default: remote HEAD)`、按需查询远程分支）与三个带 title 说明的勾选项（子模块默认勾选）。`tests/clone-options.test.mjs` 3 项 + `tests/repo-operations.test.mjs` 参数断言 + Rust 集成测试 `clone_options_and_remote_branch_query_are_validated_and_applied` 覆盖；`./test.bat` 全绿（Node 113、cargo 48 + 15 + 21 + 16 + 15），`cargo fmt --check`、`sh check-docs.sh` 通过；CHANGELOG / `arch/explorer.md` 已同步；待真实 GUI 交互验收。
- 2026-11-18 标题栏三项修正：`PortableTitleBar` 标题栏整体 / 图标 / 文字设 `data-tauri-drag-region`，控制按钮设 `"false"`；新增 `get_explorer_action_icon` IPC，从 `explorer.rs::ICON_FILES` 内嵌菜单 ICO 第一帧取 PNG 转 data URL，前端 `<img>` 直接显示，与右键菜单同源；图标 / 文字统一 16px 高居中。`tests/explorer-titlebar.test.mjs` 3 项覆盖；`test.bat` 全绿（Node 110、cargo 48+14+21+16+15），CHANGELOG / `arch/explorer.md` 已同步；待真实资源管理器视觉验收。
- 2026-11-18 资源管理器右键菜单三项改动：轻量窗口 `decorations(false)` + `PortableTitleBar` 自绘标题栏（图标 / 标题 / 仓库·相对路径·分支 / 最小化·最大化·关闭）；Create new repository 增加「创建」按钮（只创建不打开，普通仓库另有「创建并打开」）；新增 ignore 动作（菜单 / 图标 / 启动路由 / `ignore_file_at` 根目录与所属目录写入 / `IgnorePathDialog`）。`test.bat` 全绿（Node 107、cargo 47+14+21+16+15），CHANGELOG / `arch/explorer.md` 已同步；待真实资源管理器 GUI 复测。
- 2026-11-18 Create new repository 卡死修复：根因是 `openInMain` / 弹窗 `onClose` 在 busy 未清除时调用 `getCurrentWindow().close()`，触发 `closeRequested`，被 `usePortableCloseGuard` 的 busy 分支 `preventDefault` 拦下，`await close()` 永不返回。改为 `closeCurrentWindow(true)` → `destroy()`（绕过守卫、仍触发 Rust `Destroyed` 清理）；新增 `tests/explorer-close.test.mjs` 3 项验证关闭路径。`test.bat` 全绿（Node 107、cargo 47+14+21+16+15），`sh check-docs.sh` 通过；待真实资源管理器人工复测。
- 2026-11-16 可执行文件更名：`tauri build` 产出 `target/release/GitExtensions.exe`（无旧 `git-extensions.exe`）；`copy-bundle.mjs` 已改为优先读取 `mainBinaryName`。重新打包 0.11.1（NSIS 3.53 MiB / MSI 5.91 MiB / 便携 zip 4.86 MiB），`dist/release/unpack/GitExtensions.exe` 与 zip 条目一致，`sha256sum -c` 三个产物 OK。`tauri dev` 仍运行 cargo 产物 `git-extensions.exe`（`mainBinaryName` 只作用于 build）。
- 2026-11-16 0.11.1 打包：版本号四处同步为 0.11.1（package.json / Cargo.toml / Cargo.lock / tauri.conf.json）；`package.bat` 生成 NSIS 0.11.1（3.53 MiB）、MSI 0.11.1（5.91 MiB）、`unpack/` 便携目录、便携 zip（4.86 MiB）与 `SHA256SUMS.txt`，本地 `sha256sum -c` 三个产物全部 OK。
- 2026-11-15 UI 修复：`pnpm test` 104/104、`pnpm build`、`cargo test` 113/113（47 lib + 14 repository_capabilities + 21 safety + 16 smoke + 15 workflows）、`cargo fmt --check`、`sh check-docs.sh` 通过；仅改前端，Rust 未改。
- 2026-11-15 实机截图核对：1920×1050 宽屏、1000×700 与 886×643 窄窗；验证提交图列隐藏 / refs 对齐、检查器 compact diff（含合并提交 5 文件）、Inline 双行号、Changes 统计、提交框 Amend 行、工具栏更多菜单、左栏底部按钮、设置快捷键分组与窄窗预览。未覆盖 150% / 200% DPI、真实 900px 最小拖拽边界与 macOS。
- 历史发布验证细节见 CHANGELOG 与 git log。

## 待验收

1. **Git 工作流 GUI**：Merge / Amend / 远程分支 / Hunk / Remotes / Pull-Push 选项 / Worktree / 搜索 / Rebase / 导出 / Bisect / 分支删除。
2. **顶部栏与全局交互 GUI**：应用菜单、页签拖拽与溢出、快捷键、弹窗焦点 / 脏关闭、通知、命令面板、窄窗工具栏。
3. **仓库导航与组管理器 GUI**：Pin / 范围切换 / 拖动排序、记录搜索 / 定位 / 关闭 / 移除、重启恢复。
4. **左侧导航与 Diff GUI**：分支 / 标签 / 子模块 / 工作树 / Stash、行内 / 并排、行号 / Hunk 操作、Blame、冲突与 Rebase；并复核 2026-11-15 UI 修复与 0.11.1 安装包 / 便携版的三档窄窗、工具栏标签 / 更多菜单、提交框、检查器 compact diff 与统计。
5. **资源管理器与轻量窗口 GUI**：菜单注册 / 16 项上限 / 图标、新自绘标题栏（空白区拖动、菜单图标一致、对齐、最小化 / 最大化 / 关闭）、Clone / Commit / History / Stash / Apply patch / Rename / Add to ignore（根目录与所属目录 `.gitignore`）、Create new repository 的「创建」与「创建并打开」、设置缩放与 DPI；并确认安装 / 便携版主程序为 `GitExtensions.exe`、右键菜单命令指向新 exe。

## 验证边界

- 自动测试不等同于真实 GUI / 注册表 / 安装包行为；高 DPI、多显示器、macOS、安装版 / 便携版仍需人工验收。
- Windows Explorer 16 项上限已用真实 Shell 菜单确认；图标、分隔线、Clone 进度以真实 Explorer 视觉为准。
- 仅临时仓库做破坏性 Git 回归，真实大仓库只读；安装包未签名，写互斥不消除外部 Git 竞态。
