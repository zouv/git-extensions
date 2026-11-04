# 接力进度 / Handoff · git-extensions

## 状态快照

- 最近更新：2026-11-04。0.6.0 已发布：GitHub Release v0.6.0（https://github.com/zouv/git-extensions/releases/tag/v0.6.0）包含 NSIS / MSI、便携 zip 与 SHA256 校验；当前在 main 开发。
- 远程已关联并推送：origin = https://github.com/zouv/git-extensions，main、v0.6.0 标签与 Release 已推送。

## 当前任务

- 目标：Explorer 动作不再打开完整主布局；Clone / Commit / Pull / Push / View changelog 等使用单任务窗口，Open repository / Settings 聚焦已有主窗口。
- 范围：`window_host.rs`、`launch.rs`、`system/explorer.rs`、`src/explorer/*`、`src/main.tsx`、`App.tsx`、`ChangesPanel` / `RevisionGrid` 的轻量复用与 `arch/explorer.md`。
- 完成定义：17 个动作按便携性分流；文件 / 目录 / 仓库范围历史可查看 diff 并执行 Reset / Rebase 等；主窗口请求不丢失、不重复；关闭与写操作保护有效；自动测试、构建和真实 GUI 验收通过。
- 关键决策：官方 `tauri-plugin-single-instance`；所有窗口同进程共享后端写锁；轻量窗口不写主窗口持久化键；`File history` 用户可见名称统一为 `View changelog`（内部 action 仍为 `file-history`）。

## 进行中

- [x] 单实例插件、动态主窗口 / action 窗口、按窗口请求队列与最后窗口退出。
- [x] Clone / Create / Commit / Changes / Pull 输出 / Push / Stash / Branch / Checkout / Difftool / Patch 轻量 Host。
- [x] 文件右键菜单、`resolve_explorer_target`、目录 / 文件范围 `scoped_history`、changelog Reset / Rebase / Cherry-pick / Revert。
- [x] 完整自动回归、文档检查和最终 release 构建。
- [x] 0.6.0 打包、GitHub Release 上传与产物 SHA256 校验。
- [ ] 真实 GUI 验收文件菜单、轻量窗口、主窗口复用与关闭 / 冲突反馈。

## 下一步

1. 用 0.6.0 发布版保存一次系统集成设置，验证文件右键菜单与各轻量窗口。
2. 验证 Open repository / Settings 不新开窗口；关闭最后窗口进程退出；冲突后转主窗口。

## 验证状态

- 本轮 `test.bat` 已通过：Node 62/62、Rust 91/91（36 + 5 + 21 + 14 + 15），前端生产构建通过；`cargo fmt --check`、`git diff --check` 与 `sh check-docs.sh` 通过。
- 0.6.0 `package.bat` 已通过：`dist/release/` 已更新为 NSIS 0.6.0（3.08 MiB）、MSI 0.6.0（5.23 MiB）、unpack 目录、便携 zip（4.2 MiB）与 SHA256SUMS；本地校验通过。
- GitHub Release v0.6.0 已创建并上传 4 个资产；重新下载后按发布版 SHA256SUMS 校验三个二进制产物全部 OK。`dist/release/` 与 GitHub 资产名存在空格 / 点的差异，Release 内校验文件已按 GitHub 资产名生成。
- release 实机冒烟：正常启动、Commit、View changelog、Clone、Pull 均以单进程窗口打开；Open repository / Settings 复用主窗口；轻量首启后可再创建主窗口。文件菜单注册与各动作成功 / 失败仍需用户验收。

## 待验收

1. **顶部栏与页签交互 GUI**：应用图标菜单（打开仓库 / 设置 / 关于版本 / 关闭窗口，键盘与关闭后焦点恢复）；空白区拖动移动窗口、双击最大化 / 还原、右键打开应用菜单；页签悬停显示关闭 X 且不位移、中键只关闭目标；页签右键菜单（关闭 / 关闭其它 / 在右侧打开仓库并激活 / 别名 / 复制路径 / 文件管理器）；拖动超过 6px 才排序、3px 插入线、Esc / 条外 / 丢失捕获取消、边缘自动滚动；方向键与 Home/End 切换页签、Shift+F10 菜单；「+」紧随末页签且溢出时仍可见。
2. **仓库页签分组与别名 GUI**：多选切换与页签并集（分组菜单已移除「显示全部组 / 仅显示 Default」）、菜单右侧快速 Pin 且不误切组、Default 禁 Pin；管理器颜色改为点击当前色块弹出预设色板（选中即时生效、点外部 / Esc 关闭），组色同步到头像/菜单/页签色条并重启保持；新建/重命名/删除组、活动页签自动切换与空组提示；管理界面逐页签更换分组、编辑显示名，别名只改显示。
3. **仓库页签持久化 GUI**：打开 4–6 个仓库（含分组与拖拽排序）后重启，页签数量 / 顺序 / 活动页签 / 分组可见性保持；恢复时仅活动页签加载（看 `%TEMP%\git-extensions.log` 的 `start_log`，dev 下按不同路径数判断），未访问页签首次点击才加载、已访问页签切换不重复加载；关闭全部页签后重启不回退；删除 / 改名路径后重启跳过并只提示一次；删除 `openRepos.v1` 保留 `lastRepo` 时按旧版迁移恢复单仓库。
4. **左侧导航与差异视图 GUI**：组按钮 / Pin 图标与页签栏间距；「本地变更」显示变更面板，选中分支 / 标签 / 全部提交显示对应历史；Submodules 与 Worktrees 分组可折叠、标题计数、空状态；子模块行打开管理弹窗；Worktrees 行右键复制路径 / 文件管理器显示、锁定标记；Stash / 子模块固定在侧栏底部，树内容独立滚动。本地变更预览不重复显示文件名 / 文件列表；提交差异面板移除文件前后按钮、列表 / 目录树移到文件栏顶部、文件地址栏与功能栏移到右侧面板顶部并分隔、功能栏与预览一致；Inline / Split 切换；上一处 / 下一处差异（Alt+↑ / Alt+↓）；折叠未修改片段可点击展开；split 行号与删除 / 新增配对正确。
5. **资源管理器、轻量窗口与设置 GUI**：保存设置后目录 / 目录背景 / 文件均出现菜单；轻量窗口使用独立单任务布局，Clone/Create/Commit/Pull 输出/Push/Stash/分支/Difftool/Patch 可完成；View changelog 在仓库根显示当前分支、子目录按目录、文件按文件，查看提交文件 / diff 并执行 Reset / Rebase；Open repository / Settings 聚焦已有主窗口；关闭含草稿 / 写操作窗口有保护，冲突可转主窗口；关闭最后窗口进程退出。另补窗口状态、三态菜单、150% / 200% DPI、多显示器、安装版 / 便携版及 macOS 实机或 CI。

## 验证边界

- 本轮自动验证结果见上；真实 GUI / 注册表、安装版与便携版行为不以此代替。
- 环境限制：GUI 截图 / WebView UIA 不可用，自定义关闭按钮的鼠标点击与分组视觉交互需人工验收；窗口关闭消息链路、进程退出与启动子系统已自动验证。
- 仅临时仓库做破坏性 Git 回归，真实大仓库仅只读测量。
- 安装包未代码签名。应用写互斥不能消除外部 Git 竞态，HEAD 备份不包含未提交内容。
