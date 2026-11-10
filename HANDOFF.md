# 接力进度 / Handoff · git-extensions

## 状态快照

- 最近更新：2026-11-10。0.9.1 已发布并上传 GitHub Release：资源管理器 Commit / View changes 目录作用域、View history 三目标、右键动作无控制台闪烁、Rename 占用提示。NSIS 3.50 MiB、MSI 5.85 MiB、便携 zip 4.81 MiB，SHA256SUMS 校验通过；当前无进行中任务（待人工 GUI 验收）。
- 远程已关联并推送：origin = https://github.com/zouv/git-extensions，main 与历史标签已推送。

## 当前任务

- 无进行中任务（本轮 3 项资源管理器反馈已实现，待 GUI 验收）。

## 进行中

- 无。

## 下一步

- 按「待验收」清单完成 0.9.1 GUI 验收；重点确认右键菜单指向 dev 构建时点击不再闪命令行窗口，且 dev.bat / cargo 启动仍有日志；从子目录右键 Commit / View changes / View history 时范围正确；Rename 被占用时显示原因提示。若 Others 仍不足，按设置页提示把超限的目录直排命令改为一级或隐藏后重新保存。验收前请先运行要使用的构建（release unpack 或 dev）并点一次「保存 / 应用」，让菜单命令指向该可执行文件。

## 验证状态

- 2026-11-10 0.9.1 发布验证：`pnpm test` 71/71、`pnpm build`、`cargo test` 108/108、`cargo fmt --check`、`sh check-docs.sh` 通过；`package` 生成 NSIS 0.9.1（3.50 MiB）、MSI 0.9.1（5.85 MiB）、`unpack/` 便携目录、便携 zip（4.81 MiB）与 `SHA256SUMS.txt`，本地 `sha256sum -c` 三个产物全部 OK；GitHub Release `v0.9.1` 已创建并上传全部 4 个资产。
- 2026-11-10 0.9.0 发布验证：`pnpm test` 71/71、`pnpm build`、`cargo test` 106/106、`cargo fmt --check`、`sh check-docs.sh` 通过；`package` 生成 NSIS 0.9.0（3.50 MiB）、MSI 0.9.0（5.86 MiB）、`unpack/` 便携目录、便携 zip（4.81 MiB）与 `SHA256SUMS.txt`，本地 `sha256sum -c` 三个产物全部 OK；GitHub Release `v0.9.0` 已创建并上传全部 4 个资产。
- 2026-11-10 本轮：`pnpm test` Node 71/71、`pnpm build`（tsc + Vite）通过、`cargo test` Rust 108/108（47 lib + 11 repository_capabilities + 21 safety + 14 smoke + 15 workflows）、`cargo fmt --check` 通过。新增 scoped commit 集成测试（普通 / Amend 均只提交目录内暂存内容且保留目录外暂存）与 View history 三上下文单测；无效启动参数的实测确认 debug exe 已无控制台子系统（输出转到父控制台，退出码正确）。Rename 权限错误已在本机复现：Windows 不允许改名被其它进程作为 cwd 的目录；面板改为解释原因，并对瞬时占用重试两次。
- 2026-11-10 本轮（0.9.0 前一轮）：`pnpm test` Node 71/71、`pnpm build`（tsc + Vite）通过、`cargo test` Rust 106/106（46 lib + 10 repository_capabilities + 21 safety + 14 smoke + 15 workflows）、`cargo fmt --check` 通过。新增 Rename 集成测试、菜单 16 项上限 / 遗留键清理 / 分组单测；在 dev 实例中实测 Rename 面板打开、F5 后仍可恢复、Open with difftool 窗口保持打开、设置「应用」后保持面板并置灰、点遮罩不关闭；用真实 Shell 菜单枚举确认 Branches & Repos 分组、Rename 项、重复 Reset 键已清理。另发现菜单指向 dev 构建时若无 Vite 服务会表现为“点菜单没反应”，已加 3 秒兜底显示。

## 待验收

1. **P0–P2 新增 Git 工作流 GUI**：Merge 分支弹窗与右键合并（默认 / `--no-ff` / `--ff-only` / `--squash`）；Amend 修正提交勾选自动回填 HEAD 信息；远程分支检出跟踪、本地分支重命名、远程分支删除与批量清理已合并分支；变更预览 Hunk 级暂存 / 取消暂存 / 丢弃与右键加入 `.gitignore`；Remotes 远程管理、Pull 策略弹窗、Push `--force-with-lease` & `--tags`；Worktree 新建 / 锁定 / 移除 / 清理与左侧分支 `/` 文件夹树折叠；`Ctrl+Shift+G` 命令日志查看器、`Ctrl+Shift+H` 提交与 `git grep` 搜索；Fixup / Squash 提交与 Rebase Autosquash 重排；导出补丁 / 归档保存对话框与 Git Bisect 横幅工作流。
2. **顶部栏、弹窗、通知与命令面板 GUI**：应用图标菜单（打开仓库 / 克隆 / 新建 / 命令面板 / 设置 / 最近仓库 / 关于 / 关闭窗口，键盘与关闭后焦点恢复）；空白区拖动移动窗口、双击最大化 / 还原、右键打开应用菜单；页签悬停显示关闭 X 且不位移、中键只关闭目标；页签右键菜单（关闭 / 关闭其它并列出保留原因 / 在右侧打开仓库并激活 / 别名 / 复制路径 / 文件管理器）；拖动超过 6px 才排序、3px 插入线、Esc / 条外 / 丢失捕获取消、边缘自动滚动；方向键与 Home/End 切换页签、Shift+F10 菜单；「+」紧随末页签且溢出时仍可见。弹窗打开后焦点落在正文 `data-autofocus` 而非关闭 X，等待 2 个轮询周期焦点不跳；嵌套删除确认按 Esc 只关一层；带草稿弹窗按 Esc / 点外部 / 取消均有确认；通知抽屉保留全部错误、清空需确认、成功 toast 悬停暂停；`Ctrl+K` 搜索与执行命令；原生目录 / 文件选择与拖放打开仓库；窄窗口下视图菜单与“更多”菜单可达；资源管理器二级菜单平铺分隔线分组 / 图标 / 16 项上限，Clone 窗口内进度页与「克隆并打开」双按钮；应用菜单「最近打开」不再出现空行。
3. **仓库页签分组与持久化 GUI**：多选切换与页签并集、分组菜单保持打开以便连续多选、菜单右侧快速 Pin 且不误切组、Default 禁 Pin；管理器颜色改为点击当前色块弹出预设色板，组色同步到头像/菜单/页签色条并重启保持；管理界面逐页签更换分组、编辑显示名。打开 4–6 个仓库后重启，页签数量 / 顺序 / 活动页签 / 分组可见性保持，恢复时仅活动页签加载，未访问页签首次点击才加载；切回页签立即刷新并显示加载 / 错误徽标。
4. **左侧导航与差异视图 GUI**：组按钮 / Pin 图标与页签栏间距；「本地变更」显示变更面板，选中分支 / 标签 / 全部提交显示对应历史；分支 / 标签过滤与 200 条分页；Submodules 与 Worktrees 分组可折叠、标题计数、空状态；Worktrees 行双击 / Enter 打开为页签；Stash / 子模块固定在侧栏底部。本地变更预览不重复显示文件名 / 文件列表且轮询不闪烁；Inline / Split 切换、上一处 / 下一处（Alt+↑ / ↓ 或 n / p）、折叠未修改、差异块计数、增删统计、文件过滤与 500 条封顶、行右键复制 `路径:行号`，Inline / Split 与换行偏好重启保持；冲突标记数量、合并两侧、继续禁用原因、Rebase 拖放指示可见；Blame 点击提交 SHA 跳转。
5. **资源管理器、轻量窗口与设置 GUI（含本轮 3 项）**：保存设置后目录 / 目录背景 / 文件均出现菜单，并按上下文只显示适用命令；轻量窗口使用独立单任务布局，Clone（含进度页）/ Create（个人 / 中心 bare）/ Commit / Pull 选项 / Push 选项 / View changes 只读 diff / View stash 工作区 / Add files / Reset file changes / Apply patch（文件 / 目录与 am 冲突）/ 分支与 Checkout / Difftool / Rename（文件与目录改名）可完成；Commit 以当前文件夹 / 选中目录为范围且只提交该目录已暂存内容，View changes 只显示该目录历史；View history 在文件、选中目录与目录背景均可用并查询对应目标，查看提交文件 / diff 并执行 Reset / Rebase，文件上下文含文件内容 View / Blame 页签；Repository settings 展示远程地址 / upstream，View files 以文件树展示当前分支已提交文件，菜单位置支持一级 / 二级 / 三级（Others）/ 隐藏，整棵级联树按目录 / 文件上下文超过 16 项提示并禁止保存；一级项以 `GitExt.Top.*` 紧贴 Git Extensions 下方；Create new repository / Open repository 位于 Branches & Repos 分组；所有动作窗口支持 Esc 关闭、拖拽原生边框缩放并按动作记住尺寸，F5 / Ctrl+R 不再刷新窗口；Open with difftool 窗口启动后保持打开；点击任意菜单项不再闪命令行窗口；Rename 被占用时显示原因提示；设置弹窗支持拖拽四边 / 四角缩放并记住尺寸、点击遮罩不关闭、「应用」按钮即时生效且不关闭面板并自动置灰；Others 配置 3 项以上时全部显示（不再静默截断），旧的重复菜单项被清理；Open repository / Settings 聚焦已有主窗口；关闭含草稿 / 写操作窗口有保护，冲突可转主窗口；关闭最后窗口进程退出。另补窗口状态、三态菜单、150% / 200% DPI、多显示器、安装版 / 便携版及 macOS 实机或 CI。

## 验证边界

- 本轮自动验证结果见上；真实 GUI / 注册表、安装版与便携版行为不以此代替。2026-11-07 UI 优化的弹窗焦点、原生对话框、拖放、通知抽屉、命令面板与快捷键只做了静态 / 自动验证，必须实机验收。
- 资源管理器菜单的 Windows 级联上限已在本机用真实 Shell 菜单证实：16 项按整棵级联树（含 Others 子项）统计，超出的尾部命令被丢弃；目录上下文 15 直排 + 1 个 Others 子项时 Others 只剩 1 项，文件上下文 8 直排 + 3 子项时全部显示。`CommandFlags` 分隔线、图标显示与 Clone 进度事件仍以真实 Explorer 视觉为准；新清理逻辑只做了 FakeRegistry 单测，需在保存设置后确认重复项消失。
- 新增的 Add files / Reset / Stash / Apply patch / Pull 与 Push 选项、文件历史 Blame、View changes 只读窗口只做自动测试；`git am` 冲突及补丁目录流程需在真实冲突仓库与 GUI 中验收。
- 新增 `@tauri-apps/plugin-dialog`（前端）与 `tauri-plugin-dialog`（Rust），capabilities 已加 `dialog:allow-open`；安装版 / 便携版需确认目录选择可用。
- 环境限制：GUI 截图 / WebView UIA 不可用，自定义关闭按钮的鼠标点击与分组视觉交互需人工验收；窗口关闭消息链路、进程退出与启动子系统已自动验证。
- 仅临时仓库做破坏性 Git 回归，真实大仓库仅只读测量。
- 安装包未代码签名。应用写互斥不能消除外部 Git 竞态，HEAD 备份不包含未提交内容。
