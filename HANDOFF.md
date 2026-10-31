# 接力进度 / Handoff · git-extensions

> **这是什么**：AI 断点续作的「交接包」。一次对话没干完，**下一个 AI 会话先读本文件**，就知道「做到哪、还剩什么、卡在哪、下一步从哪开始」。
>
> **维护规则见 AGENTS §5**：只留还在路上的内容；完成清单归 ROADMAP / CHANGELOG，代码坑归 ARCH。
>
> **接手步骤**：读 `AGENTS.md` → 按任务范围查 ARCH §0.5 → 从「下一步」开始。

---

## 状态快照

- **最近更新**：2026-10-31
- **整体状态**：✅ 「提交图一直加载中」已修复（Tauri 事件权限缺失），自动化复测通过
- **最后验证状态**：Windows `pnpm build` ✅、`cargo test` ✅ 14/14；`VITE_TEST_REPO` 自动化复测 ✅（17,783 提交正常加载）

---

## 待验收（代码已完成，等用户确认）

1. **完整 GUI 工作流**：提交图、diff 高亮、stage/commit、分支 / 标签 / stash、远程操作、blame / 文件历史。
2. **设置与键盘操作**：设置重启后保持；弹窗、页签、远程快捷键；方向键 / 翻页选择时列表自动滚动；Ctrl/Cmd+Enter 提交。
3. **性能与 macOS**：同仓库对比 Git Extensions 的首屏、滚动和提交切换；运行 macOS CI 或实机 `sh test.sh`（当前无 macOS 环境，未声称通过）。

## 阻塞 / 待决策（Blockers）

- macOS 实际执行需要 macOS 环境或运行已配置的 CI；其余无阻塞。

---

## 下一步（Next Steps）

1. 用户运行 `dev.bat` 统一 GUI 验收，问题按 ARCH §0.5 定位修复。
2. 推送项目后运行三平台 CI，或在 macOS 实机执行 `sh test.sh`，补齐最后一项平台验收。

---

## 本任务验证（Verify）

- Windows 一键回归：`test.bat`。
- Linux / macOS：`sh test.sh`。
- 大仓库复测：`cd src-tauri && cargo run --release --example bench -- <仓库路径> 3`，结果解释见 `docs/03-性能与平台验证.md`。
- 自动化测试不替代 GUI 验收；macOS 当前仅完成资源与 CI 配置。

---

## 待解问题 / 给用户的提问（Open Questions）

- （无。）
