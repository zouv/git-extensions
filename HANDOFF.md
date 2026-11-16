# 接力进度 / Handoff · git-extensions

## 状态快照

- 最近更新：2026-11-16。主程序已更名为 `GitExtensions.exe`（`tauri.conf.json` 的 `mainBinaryName`），并已重新打包 0.11.1：便携目录与 zip 内为 `GitExtensions.exe`，`sha256sum -c` 三个产物全部 OK。改动已提交到本地 main，未推送远程。当前无进行中任务（150% / 200% DPI 与人工验收待补）。
- 远程已关联并推送：origin = https://github.com/zouv/git-extensions；0.11.1 尚未 push / tag / 上传 Release。

## 当前任务

- 无进行中任务。

## 进行中

- 无。

## 下一步

- 按「待验收」第 4 条复核 0.11.1 的 UI 修复与三档窗口 / 高 DPI；确认后再决定是否 push / tag / 上传 Release。

## 验证状态

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
5. **资源管理器与轻量窗口 GUI**：菜单注册 / 16 项上限 / 图标、Clone / Commit / History / Stash / Apply patch / Rename、设置缩放与 DPI；并确认安装 / 便携版主程序为 `GitExtensions.exe`、右键菜单命令指向新 exe。

## 验证边界

- 自动测试不等同于真实 GUI / 注册表 / 安装包行为；高 DPI、多显示器、macOS、安装版 / 便携版仍需人工验收。
- Windows Explorer 16 项上限已用真实 Shell 菜单确认；图标、分隔线、Clone 进度以真实 Explorer 视觉为准。
- 仅临时仓库做破坏性 Git 回归，真实大仓库只读；安装包未签名，写互斥不消除外部 Git 竞态。
