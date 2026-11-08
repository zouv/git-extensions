# 接力进度 / Handoff · git-extensions

## 状态快照

- 最近更新：2026-11-08。0.8.0 已发布（对齐上游 Git Extensions 的 P0–P2 共 13 项核心 Git 能力已全部实现并通过自动化测试与打包发布），当前无进行中任务（待人工 GUI 验收）。
- 远程已关联并推送：origin = https://github.com/zouv/git-extensions，main 与历史标签已推送。

## 当前任务

- 无进行中任务。

## 进行中

- 无。

## 下一步

- 按「待验收」清单完成 Windows / macOS GUI 实机验收，或整理 `[未发布]` 发布新版本。

## 验证状态

- 2026-11-08 P0–P2 核心能力补齐：`pnpm test` Node 68/68、`pnpm build`（tsc + Vite）通过、`cargo test` Rust 92/92（含新增 `merge_amend_hunk_branch_remotes_worktree_search_export_and_bisect_capabilities` 集成测试）与 `sh check-docs.sh` 全部通过。
- 2026-11-07 UI 优化本轮：`pnpm test` Node 65/65、`pnpm build`（tsc + Vite）通过、`cargo check` 通过（含 `tauri-plugin-dialog`）、`cargo test` Rust 91/91（36 + 5 + 21 + 14 + 15）、`cargo fmt --check` 与 `sh check-docs.sh` 通过。
- 2026-11-07 UI 实机（WebView2 远程调试驱动，非完整人工验收）：弹窗初始焦点落在路径输入框，等待 6 秒轮询后不跳；`Ctrl+K` 面板可搜索并执行刷新；错误通知进入通知抽屉；嵌套删除确认按 Esc 只关一层；dirty 弹窗关闭确认 / 取消 / 放弃均正确；变更预览跨轮询保留 DiffView 与滚动状态；Split 偏好写入按仓库 key。原生目录选择、拖放打开、150% / 200% DPI 仍需人工验收。
- 2026-11-07 dev.bat 修复验证：0.7.0 便携版运行中执行 `dev.bat` 仍会先编译并启动独立 dev 实例（`com.gitextensions.dev.dev`），release 实例保持运行；非 0 退出时批处理保留窗口显示错误。
- 0.7.0 release 构建通过：NSIS 0.7.0（3.17 MiB）、MSI 0.7.0（5.37 MiB）、unpack 目录、便携 zip（4.32 MiB）与 SHA256SUMS；本地校验通过。
- GitHub Release v0.7.0 已创建并上传 4 个资产（`Git.Extensions_0.7.0_x64-setup.exe` / `.msi` / `-unpack.zip` / `SHA256SUMS.txt`）；重新下载后按发布版 SHA256SUMS 校验三个二进制产物全部 OK。
- 0.6.0 历史发布与自动验收见 CHANGELOG [0.6.0]。

## 待验收

1. **P0–P2 新增 Git 工作流 GUI**：Merge 分支弹窗与右键合并（默认 / `--no-ff` / `--ff-only` / `--squash`）；Amend 修正提交勾选自动回填 HEAD 信息；远程分支检出跟踪、本地分支重命名、远程分支删除与批量清理已合并分支；变更预览 Hunk 级暂存 / 取消暂存 / 丢弃与右键加入 `.gitignore`；Remotes 远程管理、Pull 策略弹窗、Push `--force-with-lease` & `--tags`；Worktree 新建 / 锁定 / 移除 / 清理与左侧分支 `/` 文件夹树折叠；`Ctrl+Shift+G` 命令日志查看器、`Ctrl+Shift+H` 提交与 `git grep` 搜索；Fixup / Squash 提交与 Rebase Autosquash 重排；导出补丁 / 归档保存对话框与 Git Bisect 横幅工作流。
2. **顶部栏、弹窗、通知与命令面板 GUI**：应用图标菜单（打开仓库 / 克隆 / 新建 / 命令面板 / 设置 / 最近仓库 / 关于 / 关闭窗口，键盘与关闭后焦点恢复）；空白区拖动移动窗口、双击最大化 / 还原、右键打开应用菜单；页签悬停显示关闭 X 且不位移、中键只关闭目标；页签右键菜单（关闭 / 关闭其它并列出保留原因 / 在右侧打开仓库并激活 / 别名 / 复制路径 / 文件管理器）；拖动超过 6px 才排序、3px 插入线、Esc / 条外 / 丢失捕获取消、边缘自动滚动；方向键与 Home/End 切换页签、Shift+F10 菜单；「+」紧随末页签且溢出时仍可见。弹窗打开后焦点落在正文 `data-autofocus` 而非关闭 X，等待 2 个轮询周期焦点不跳；嵌套删除确认按 Esc 只关一层；带草稿弹窗按 Esc / 点外部 / 取消均有确认；通知抽屉保留全部错误、清空需确认、成功 toast 悬停暂停；`Ctrl+K` 搜索与执行命令；原生目录 / 文件选择与拖放打开仓库；窄窗口下视图菜单与“更多”菜单可达。
3. **仓库页签分组与持久化 GUI**：多选切换与页签并集、分组菜单保持打开以便连续多选、菜单右侧快速 Pin 且不误切组、Default 禁 Pin；管理器颜色改为点击当前色块弹出预设色板，组色同步到头像/菜单/页签色条并重启保持；管理界面逐页签更换分组、编辑显示名。打开 4–6 个仓库后重启，页签数量 / 顺序 / 活动页签 / 分组可见性保持，恢复时仅活动页签加载，未访问页签首次点击才加载；切回页签立即刷新并显示加载 / 错误徽标。
4. **左侧导航与差异视图 GUI**：组按钮 / Pin 图标与页签栏间距；「本地变更」显示变更面板，选中分支 / 标签 / 全部提交显示对应历史；分支 / 标签过滤与 200 条分页；Submodules 与 Worktrees 分组可折叠、标题计数、空状态；Worktrees 行双击 / Enter 打开为页签；Stash / 子模块固定在侧栏底部。本地变更预览不重复显示文件名 / 文件列表且轮询不闪烁；Inline / Split 切换、上一处 / 下一处（Alt+↑ / ↓ 或 n / p）、折叠未修改、差异块计数、增删统计、文件过滤与 500 条封顶、行右键复制 `路径:行号`，Inline / Split 与换行偏好重启保持；冲突标记数量、合并两侧、继续禁用原因、Rebase 拖放指示可见；Blame 点击提交 SHA 跳转。
5. **资源管理器、轻量窗口与设置 GUI**：保存设置后目录 / 目录背景 / 文件均出现菜单；轻量窗口使用独立单任务布局，Clone/Create/Commit/Pull 输出/Push/Stash/分支/Difftool/Patch 可完成；View changelog 在仓库根显示当前分支、子目录按目录、文件按文件，查看提交文件 / diff 并执行 Reset / Rebase；Open repository / Settings 聚焦已有主窗口；关闭含草稿 / 写操作窗口有保护，冲突可转主窗口；关闭最后窗口进程退出。另补窗口状态、三态菜单、150% / 200% DPI、多显示器、安装版 / 便携版及 macOS 实机或 CI。

## 验证边界

- 本轮自动验证结果见上；真实 GUI / 注册表、安装版与便携版行为不以此代替。2026-11-07 UI 优化的弹窗焦点、原生对话框、拖放、通知抽屉、命令面板与快捷键只做了静态 / 自动验证，必须实机验收。
- 新增 `@tauri-apps/plugin-dialog`（前端）与 `tauri-plugin-dialog`（Rust），capabilities 已加 `dialog:allow-open`；安装版 / 便携版需确认目录选择可用。
- 环境限制：GUI 截图 / WebView UIA 不可用，自定义关闭按钮的鼠标点击与分组视觉交互需人工验收；窗口关闭消息链路、进程退出与启动子系统已自动验证。
- 仅临时仓库做破坏性 Git 回归，真实大仓库仅只读测量。
- 安装包未代码签名。应用写互斥不能消除外部 Git 竞态，HEAD 备份不包含未提交内容。
