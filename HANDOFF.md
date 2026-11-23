# 接力进度 / Handoff · git-extensions

## 状态快照

- 最近更新：2026-11-23。0.13.0 发版：「commit / push / diff 界面六项增强」随本次发布提交 / 打标签 / 推送并上传 Release；版本号四处同步（package.json / Cargo.toml / Cargo.lock / tauri.conf.json），CHANGELOG 已归档到 [0.13.0]。当前无进行中任务，待真实 GUI 验收。分支 main。
- 远程已关联并推送：origin = https://github.com/zouv/git-extensions。

## 状态快照

- 最近更新：2026-11-23。Clone 界面优化完成：输出面板填满弹窗剩余空间、连续同阶段进度合并为一行；`test.bat` 全绿（Node 131、cargo 48+15+22+16+15），`sh check-docs.sh` 通过；CHANGELOG `[未发布]` / ROADMAP / ARCH（ui.md / explorer.md）已同步。当前无进行中任务。分支 main，本次改动**尚未提交**（9 个文件）。
- 远程已关联并推送：origin = https://github.com/zouv/git-extensions；0.13.0 已发布。

## 状态快照

- 最近更新：2026-11-23。Commit 界面细节优化完成：目录树目录 / 文件列对齐、文件列表 Ctrl+A / Ctrl+点击 / Shift+点击多选、Amend 移到提交按钮行左侧；连同 Clone / View history 优化全部通过 `test.bat` 全绿（Node 141、cargo 48+15+22+16+15），`sh check-docs.sh` 通过；CHANGELOG `[未发布]` / ROADMAP / ARCH 已同步。当前无进行中任务。分支 main，三组改动**尚未提交**。
- 远程已关联并推送：origin = https://github.com/zouv/git-extensions；0.13.0 已发布。

## 状态快照

- 最近更新：2026-11-23。Commit 界面第二轮优化完成：Ctrl+A / Ctrl+点击 / Shift+点击改为行选中（批量按钮取「行选中 ∪ 勾选」）、Shift 不再触发文本选择、未暂存 / 已暂存列表可拖拽高度并按仓库持久化、提交标题 / 正文增加用途提示；连同 Clone / View history 与前一轮 Commit 优化全部通过 `test.bat` 全绿（Node 143、cargo 48+15+22+16+15），`sh check-docs.sh` 通过；CHANGELOG `[未发布]` / ROADMAP / ARCH 已同步。当前无进行中任务。分支 main，四组改动已提交到 main（**尚未推送**）。
- 远程已关联并推送：origin = https://github.com/zouv/git-extensions；0.13.0 已发布。

## 当前任务

无进行中任务。

## 进行中

无。

## 下一步

1. 用户 GUI 验收 0.13.0 六项增强与 Clone / View history / Commit 界面优化（见「待验收」第 1、4、5 条）。
2. 需要时推送 main（本次改动已提交、未推送）或整理 `[未发布]` 发版。

## 待验收

1. **Git 工作流 GUI**：Merge / Amend / 远程分支 / Hunk / Remotes / Pull-Push 选项 / Worktree / 搜索 / Rebase / 导出 / Bisect / 分支删除；**新增：Push 窗口待推送提交列表（有 / 无 upstream、未 fetch 提示）与点击提交查看内容弹窗**。
2. **顶部栏与全局交互 GUI**：应用菜单、页签拖拽与溢出、快捷键、弹窗焦点 / 脏关闭、通知、命令面板、窄窗工具栏。
3. **仓库导航与组管理器 GUI**：Pin / 范围切换 / 拖动排序、记录搜索 / 定位 / 关闭 / 移除、重启恢复。
4. **左侧导航与 Diff GUI**：分支 / 标签 / 子模块 / 工作树 / Stash、行号 / Hunk 操作、Blame、冲突与 Rebase；**新增：提交界面目录树切换与目录右键（暂存 / 还原 / ignore）、文件右键还原更改与 ignore 弹窗（根 / 所属目录）、左侧面板无限制拖宽（双击恢复 420）、行内 / 并排偏好在检查器 / 变更预览 / 历史弹窗间即时同步并重启沿用、目录树目录与文件列对齐、Ctrl+A / Ctrl+点击 / Shift+点击行选中（批量按钮取并集）、Shift 无文本选择、未暂存 / 已暂存列表可拖拽高度并持久化、Amend 位于提交按钮行左侧**；并复核 0.11.1 三档窄窗。
5. **资源管理器与轻量窗口 GUI**：菜单注册 / 16 项上限 / 图标、自绘标题栏、Clone / Commit / History / Stash / Apply patch / Rename / Add to ignore、Create new repository、设置缩放与 DPI；确认主程序为 `GitExtensions.exe`；**新增：Commit / Push 轻量窗口复用提交界面与 Push 增强；Clone 结果页输出面板填满 + 进度归并；View history 列头 / 列宽拖拽持久化、上下布局、三处分隔条与布局恢复、文件列表与 diff 联动**。

## 验证边界

- 自动测试不等同于真实 GUI / 注册表 / 安装包行为；高 DPI、多显示器、macOS、安装版 / 便携版仍需人工验收。
- 仅临时仓库做破坏性 Git 回归，真实大仓库只读；安装包未签名，写互斥不消除外部 Git 竞态。