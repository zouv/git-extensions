# 接力进度 / Handoff · git-extensions

## 状态快照

- 最近更新：2026-11-02。无进行中任务；`dist/release` 待关闭便携版后重建（见「待验收」）。
- 远程已关联并推送：origin = https://github.com/zouv/git-extensions，main + v0.2.0 + v0.3.0 已推送。
- 0.3.0 已发布：提交 856dca9；GitHub Release v0.3.0 含 NSIS / MSI 安装包与 SHA256SUMS-v0.3.0.txt（发布说明与校验文件在本机 .runtime/）。
- `package.bat` 已对齐 sc-code：构建前 snapshot、构建后 collect，产物（安装包 + unpack + zip + SHA256SUMS）发布到 `dist/release/`；前端构建输出在 `.runtime/dist/`。

## 待验收

1. **顶部栏与拖拽 GUI**：拖动空白移动窗口、双击最大化/还原、最小化/最大化/关闭、边缘缩放、应用图标菜单；仓库页签排序、Pin 图标排序（Pin 顺序刷新后保持）。
2. **仓库页签分组 GUI**：分组入口菜单与 Pin 图标菜单多选切换、页签栏显示并集、「显示全部组 / 仅显示 Default」；Pin 图标左键切换、右键菜单；新建/重命名/删除组、未分组页签归 Default；活动页签被隐藏时自动切换、空组提示。
3. **仓库页签别名 GUI**：管理界面逐页签更换分组、编辑显示名；页签右键「设置页签显示名…」；别名只改显示，Git 操作仍用真实路径。
4. **重建 dist/release**：关闭正在运行的 `dist/release/unpack/git-extensions.exe`（PID 45852）后重跑 `package.bat` 或 `node scripts/copy-bundle.mjs collect`；当前 dist/release 只剩旧 unpack，安装包与 zip 未重建。
5. （遗留）完整 Windows GUI 工作流、150% / 200% DPI、macOS 实机或 CI；0.2.0 Release 资产上传（安装包在 bundle/，SHA256SUMS 与 release-notes 已备）。

## 验证边界

- 本轮：tsc + vite build 通过；25 个 Node 单测全过（repo-groups 8 项）；cargo test 全过（6 + 21 + 14 + 14）。前置打包验证：tauri build 成功，collect 因运行中的便携版占用目录失败（非代码问题）。
- 环境限制：GUI 截图 / 自动化（CopyFromScreen 句柄无效、GetCursorPos 拒绝访问）不可用，顶部栏与分组的实际交互未实测，需人工验收。
- 仅临时仓库做破坏性 Git 回归，真实大仓库仅只读测量。
- 安装包未代码签名。应用写互斥不能消除外部 Git 竞态，HEAD 备份不包含未提交内容。
