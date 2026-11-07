# 接力进度 / Handoff · git-extensions

## 状态快照

- 最近更新：2026-11-07。0.7.0 已发布：GitHub Release v0.7.0（https://github.com/zouv/git-extensions/releases/tag/v0.7.0）包含 NSIS / MSI、便携 zip 与 SHA256 校验；main、标签 v0.7.0 与 Release 已推送。另修复 dev.bat 与发布版互斥问题（独立 dev identifier，待随下个版本归档）。
- 远程已关联并推送：origin = https://github.com/zouv/git-extensions，main 与历史标签已推送。

## 当前任务

- 目标：界面交互全面优化（P0–P2）。先修确定性缺陷，再做可发现性与键盘可达性，最后处理大列表性能与 Diff / 冲突 / Rebase 打磨。
- 范围：`src/ui/`、`src/components/`、`App.tsx`、`RepoWorkspace.tsx`、`styles.css`、`explorer/`；新增 `@tauri-apps/plugin-dialog` 原生目录选择。
- 完成定义：P0 全部缺陷修复；P1 命令面板 / 溢出菜单 / 对比基准 / 分组多选 / 键盘列表 / 入口补齐；P2 大列表性能、Diff 工具增强、轻量窗口尺寸；`test.bat`、文档检查与 GUI 验收通过。
- 代码状态：P0–P2 已完成，0.7.0 已发布；剩余真实 GUI 验收与问题修复。

### 上一个任务（0.6.0 Explorer 轻量窗口）

- 目标：Explorer 动作不再打开完整主布局；Clone / Commit / Pull / Push / View changelog 等使用单任务窗口，Open repository / Settings 聚焦已有主窗口。
- 范围：`window_host.rs`、`launch.rs`、`system/explorer.rs`、`src/explorer/*`、`src/main.tsx`、`App.tsx`、`ChangesPanel` / `RevisionGrid` 的轻量复用与 `arch/explorer.md`。
- 完成定义：17 个动作按便携性分流；文件 / 目录 / 仓库范围历史可查看 diff 并执行 Reset / Rebase 等；主窗口请求不丢失、不重复；关闭与写操作保护有效；自动测试、构建和真实 GUI 验收通过。
- 关键决策：官方 `tauri-plugin-single-instance`；所有窗口同进程共享后端写锁；轻量窗口不写主窗口持久化键；`File history` 用户可见名称统一为 `View changelog`（内部 action 仍为 `file-history`）。

## 进行中

### 界面交互优化（2026-11-07）

- [x] P0：Dialog 焦点 / 模态栈 / dirty 关闭保护、弹窗内联错误、变更预览 stale-while-revalidate、通知中心保留错误、关闭其它说明、F6 可见区域、Rebase / 冲突状态判断。
- [x] P1：命令注册与 `Ctrl+K`、视图 / 更多菜单、对比基准条、原生目录选择与拖放、分组多选不关闭、列表键盘模型、读取失败局部状态、页签加载 / 错误徽标、Worktree 打开。
- [x] P2：过滤 / 封顶 / 增量图宽、Diff 过滤 / 统计 / 行菜单 / 偏好记忆、提交详情复制与 ref 链接、冲突 / Rebase 细节、Blame 跳转、轻量窗口最小尺寸。
- [x] 0.7.0：版本号、提交、标签、release 打包、GitHub Release 上传与重新下载 SHA256 校验。
- [ ] 真实 GUI 验收 P0–P2（见「待验收」第 1 条）。

### 0.6.0 Explorer 轻量窗口（延续）

- [x] 单实例插件、动态主窗口 / action 窗口、按窗口请求队列与最后窗口退出。
- [x] Clone / Create / Commit / Changes / Pull 输出 / Push / Stash / Branch / Checkout / Difftool / Patch 轻量 Host。
- [x] 文件右键菜单、`resolve_explorer_target`、目录 / 文件范围 `scoped_history`、changelog Reset / Rebase / Cherry-pick / Revert。
- [x] 完整自动回归、文档检查和最终 release 构建。
- [x] 0.6.0 打包、GitHub Release 上传与产物 SHA256 校验。
- [ ] 真实 GUI 验收文件菜单、轻量窗口、主窗口复用与关闭 / 冲突反馈。

## 下一步

1. 启动 `dev.bat` 按「待验收」第 1 条验收界面交互优化：弹窗焦点与 dirty 守卫、嵌套 Esc、通知抽屉、`Ctrl+K`、原生目录选择 / 拖放、Diff 偏好、窄窗口 / 高 DPI。
2. 用 0.7.0 发布版保存一次系统集成设置，验证文件右键菜单与各轻量窗口。
3. 验证 Open repository / Settings 不新开窗口；关闭最后窗口进程退出；冲突后转主窗口。

## 验证状态

- 2026-11-07 UI 优化本轮：`pnpm test` Node 65/65、`pnpm build`（tsc + Vite）通过、`cargo check` 通过（含 `tauri-plugin-dialog`）、`cargo test` Rust 91/91（36 + 5 + 21 + 14 + 15）、`cargo fmt --check` 与 `sh check-docs.sh` 通过。
- 2026-11-07 UI 实机（WebView2 远程调试驱动，非完整人工验收）：弹窗初始焦点落在路径输入框，等待 6 秒轮询后不跳；`Ctrl+K` 面板可搜索并执行刷新；错误通知进入通知抽屉；嵌套删除确认按 Esc 只关一层；dirty 弹窗关闭确认 / 取消 / 放弃均正确；变更预览跨轮询保留 DiffView 与滚动状态；Split 偏好写入按仓库 key。原生目录选择、拖放打开、150% / 200% DPI 仍需人工验收。
- 2026-11-07 dev.bat 修复验证：0.7.0 便携版运行中执行 `dev.bat` 仍会先编译并启动独立 dev 实例（`com.gitextensions.dev.dev`），release 实例保持运行；非 0 退出时批处理保留窗口显示错误。
- 0.7.0 release 构建通过：NSIS 0.7.0（3.17 MiB）、MSI 0.7.0（5.37 MiB）、unpack 目录、便携 zip（4.32 MiB）与 SHA256SUMS；本地校验通过。
- GitHub Release v0.7.0 已创建并上传 4 个资产（`Git.Extensions_0.7.0_x64-setup.exe` / `.msi` / `-unpack.zip` / `SHA256SUMS.txt`）；重新下载后按发布版 SHA256SUMS 校验三个二进制产物全部 OK。
- 0.6.0 历史发布与自动验收见 CHANGELOG [0.6.0]。

## 待验收

1. **顶部栏、弹窗、通知与命令面板 GUI**：应用图标菜单（打开仓库 / 克隆 / 新建 / 命令面板 / 设置 / 最近仓库 / 关于 / 关闭窗口，键盘与关闭后焦点恢复）；空白区拖动移动窗口、双击最大化 / 还原、右键打开应用菜单；页签悬停显示关闭 X 且不位移、中键只关闭目标；页签右键菜单（关闭 / 关闭其它并列出保留原因 / 在右侧打开仓库并激活 / 别名 / 复制路径 / 文件管理器）；拖动超过 6px 才排序、3px 插入线、Esc / 条外 / 丢失捕获取消、边缘自动滚动；方向键与 Home/End 切换页签、Shift+F10 菜单；「+」紧随末页签且溢出时仍可见。弹窗打开后焦点落在正文 `data-autofocus` 而非关闭 X，等待 2 个轮询周期焦点不跳；嵌套删除确认按 Esc 只关一层；带草稿弹窗按 Esc / 点外部 / 取消均有确认；通知抽屉保留全部错误、清空需确认、成功 toast 悬停暂停；`Ctrl+K` 搜索与执行命令；原生目录 / 文件选择与拖放打开仓库；窄窗口下视图菜单与“更多”菜单可达。
2. **仓库页签分组与别名 GUI**：多选切换与页签并集（分组菜单已移除「显示全部组 / 仅显示 Default」）、分组菜单保持打开以便连续多选、菜单右侧快速 Pin 且不误切组、Default 禁 Pin；管理器颜色改为点击当前色块弹出预设色板（选中即时生效、点外部 / Esc 关闭），组色同步到头像/菜单/页签色条并重启保持；新建/重命名/删除组、活动页签自动切换与空组提示；管理界面逐页签更换分组、编辑显示名，别名只改显示。
3. **仓库页签持久化 GUI**：打开 4–6 个仓库（含分组与拖拽排序）后重启，页签数量 / 顺序 / 活动页签 / 分组可见性保持；恢复时仅活动页签加载（看 `%TEMP%\git-extensions.log` 的 `start_log`，dev 下按不同路径数判断），未访问页签首次点击才加载、已访问页签切换不重复加载；切回页签立即刷新并显示加载 / 错误徽标；关闭全部页签后重启不回退；删除 / 改名路径后重启跳过并只提示一次；删除 `openRepos.v1` 保留 `lastRepo` 时按旧版迁移恢复单仓库。
4. **左侧导航与差异视图 GUI**：组按钮 / Pin 图标与页签栏间距；「本地变更」显示变更面板，选中分支 / 标签 / 全部提交显示对应历史；分支 / 标签过滤与 200 条分页；Submodules 与 Worktrees 分组可折叠、标题计数、空状态；子模块行打开管理弹窗与右键菜单；Worktrees 行双击 / Enter 打开为页签，右键复制路径 / 文件管理器显示、锁定标记；Stash / 子模块固定在侧栏底部，树内容独立滚动。本地变更预览不重复显示文件名 / 文件列表且轮询不闪烁；提交差异面板文件列表 / 目录树在文件栏顶部，Inline / Split 切换、上一处 / 下一处（Alt+↑ / ↓ 或 n / p）、折叠未修改、差异块计数、增删统计、文件过滤与 500 条封顶、行右键复制 `路径:行号`，Inline / Split 与换行偏好重启保持；split 行号与删除 / 新增配对正确；冲突标记数量、合并两侧、继续禁用原因、Rebase 拖放指示可见；Blame 点击提交 SHA 跳转。
5. **资源管理器、轻量窗口与设置 GUI**：保存设置后目录 / 目录背景 / 文件均出现菜单；轻量窗口使用独立单任务布局，Clone/Create/Commit/Pull 输出/Push/Stash/分支/Difftool/Patch 可完成，Commit / Changes / Pull / History 窗口最小尺寸不再挤压；View changelog 在仓库根显示当前分支、子目录按目录、文件按文件，查看提交文件 / diff 并执行 Reset / Rebase；Open repository / Settings 聚焦已有主窗口；关闭含草稿 / 写操作窗口有保护，冲突可转主窗口；关闭最后窗口进程退出。另补窗口状态、三态菜单、150% / 200% DPI、多显示器、安装版 / 便携版及 macOS 实机或 CI。

## 验证边界

- 本轮自动验证结果见上；真实 GUI / 注册表、安装版与便携版行为不以此代替。2026-11-07 UI 优化的弹窗焦点、原生对话框、拖放、通知抽屉、命令面板与快捷键只做了静态 / 自动验证，必须实机验收。
- 新增 `@tauri-apps/plugin-dialog`（前端）与 `tauri-plugin-dialog`（Rust），capabilities 已加 `dialog:allow-open`；安装版 / 便携版需确认目录选择可用。
- 环境限制：GUI 截图 / WebView UIA 不可用，自定义关闭按钮的鼠标点击与分组视觉交互需人工验收；窗口关闭消息链路、进程退出与启动子系统已自动验证。
- 仅临时仓库做破坏性 Git 回归，真实大仓库仅只读测量。
- 安装包未代码签名。应用写互斥不能消除外部 Git 竞态，HEAD 备份不包含未提交内容。
