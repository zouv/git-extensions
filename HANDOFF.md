# 接力进度 / Handoff · git-extensions

## 状态快照

- 最近更新：2026-11-02。无进行中任务。
- 远程已关联并推送：origin = https://github.com/zouv/git-extensions，main + v0.2.0 + v0.3.0 已推送。
- 0.3.0 已发布：提交 856dca9；GitHub Release v0.3.0 含 NSIS / MSI 安装包与 SHA256SUMS-v0.3.0.txt（发布说明与校验文件在本机 .runtime/）。

## 待验收

1. **顶部栏 GUI**：拖动空白移动窗口、双击最大化/还原、最小化/最大化/关闭按钮、边缘缩放、应用图标菜单、分组入口菜单。
2. **标签分组 GUI**：新建/重命名/删除组（含「移入 Default」与「同时删标签」两种勾选）、切组后 TagDialog 与 LeftPanel 只显示该组、未分组归 Default、Pin 图标缩写与配色、多仓库配置隔离。
3. **拖拽**：仓库页签排序、Pin 组图标排序，Pin 顺序刷新后保持。
4. （遗留）完整 Windows GUI 工作流验收；150% / 200% DPI、macOS 实机或 CI；上游界面端到端性能对比。
5. （遗留）0.2.0 Release 资产上传（安装包在 src-tauri/target/release/bundle/，SHA256SUMS 与 release-notes 已备）。

## 验证边界

- 本轮：前端 tsc + vite build 通过；23 个 Node 单测全过（含新增 tag-groups 6 项）；cargo test 全过（61 项）；dev 模式启动无报错、日志流正常。
- 环境限制：GUI 截图 / 自动化（CopyFromScreen 句柄无效、GetCursorPos 拒绝访问）不可用，顶部栏与分组的实际交互未实测，需人工验收。
- 仅临时仓库做破坏性 Git 回归，真实大仓库仅只读测量。
- 安装包未代码签名。应用写互斥不能消除外部 Git 竞态，HEAD 备份不包含未提交内容。
