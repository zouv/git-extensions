# 接力进度 / Handoff · git-extensions

## 状态快照

- 最近更新：2026-11-01。0.2.0 版本配置、变更归档、验证与 Windows x64 打包已完成；远程发布等待目标仓库。
- 用户已授权 commit / push / package / upload，但当前 main 无 Git remote，不擅自新建仓库或公开代码。

## 待完成：远程发布

- 待用户提供目标仓库地址；若需新建，须明确名称和公开 / 私有属性。
- 先核对 main / v0.2.0 本地提交与远程历史，不强推；推送后发布 GitHub Release 并核对上传资产。
- 安装包：src-tauri/target/release/bundle/msi/Git Extensions_0.2.0_x64_en-US.msi 与 nsis/Git Extensions_0.2.0_x64-setup.exe。
- bundle/ 下已准备 SHA256SUMS-0.2.0.txt 和 release-notes-0.2.0.md；只上传本版本安装包与校验文件，不上传 PDB 或旧版本产物。

## 待验收

1. 完整 Windows GUI 新工作流：桌面工具 GetCursorPos 拒绝访问，本轮未完成实际交互验收。
2. 150% / 200% DPI、macOS 实机或 CI。
3. 上游界面端到端性能对比；后端基准不包含 IPC / WebView 绘制。

## 验证边界

- 仅临时仓库做破坏性 Git 回归，真实大仓库仅只读测量。
- 安装包未代码签名。应用写互斥不能消除外部 Git 竞态，HEAD 备份不包含未提交内容。
