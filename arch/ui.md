# 前端 UI 链路图谱 · git-extensions

> 本文是 `ARCHITECTURE.md` 的前端分册：文件职责、任务入口、重点链路与 UI 易踩坑。改前端结构或交互后同步本文件；总览与后端见根目录 `ARCHITECTURE.md`。
>
> 体量上限 25,000 字（`sh check-docs.sh` 计算）；超了继续按模块拆。

---

## 1. 前端文件职责

| 文件 | 职责 | 何时改它 |
|---|---|---|
| `src/App.tsx` | 完整主窗口：页签恢复 / 分组、窗口状态、通知、全局命令注册、快捷键与外部启动请求队列 | 改跨仓库状态 / 主窗口生命周期 |
| `src/RepoWorkspace.tsx` | 单仓库草稿会话、分级刷新、refs / HEAD 轮询、命令注册、任务视图与分栏 | 改仓库内状态流 / 布局 |
| `src/commands.ts` | 类型化命令接口、应用 / 仓库命令注册表、`SHORTCUT_HELP` 单一事实源 | 新增可搜索命令或改快捷键帮助 |
| `src/components/CommandPalette.tsx` | `Ctrl+K` 命令面板：搜索、分组、键盘选择、执行 | 改命令面板交互 |
| `src/nativeDialog.ts` | `@tauri-apps/plugin-dialog` 的原生目录 / 文件选择封装 | 改打开、克隆、新建、补丁路径选择 |
| `src/dialogState.ts` | 弹窗草稿登记，供窗口关闭守卫汇总 | 新增带未保存输入的弹窗 |
| `src/ui/confirmContext.ts` | Confirm 上下文与 `useConfirm`（独立文件避免 Dialog ↔ Confirm 循环依赖） | 改确认接口 |
| `src/ui/layerStack.ts` | 弹窗 / 菜单浮层栈；只有栈顶处理 Esc / Tab | 新增浮层类型或改浮层优先级 |
| `src/ui/useDirtyClose.ts` | 弹窗 dirty 关闭守卫：Esc、遮罩与“取消 / 关闭”按钮共用；同时登记窗口关闭保护 | 新增带草稿的弹窗 |
| `src/ui/InlineError.tsx` | 统一内联错误（保留多行 Git 输出、复制按钮） | 改错误展示 |
| `src/ui/listNav.ts` | 列表行方向键 / Home / End 焦点移动 | 改列表键盘行为 |
| `src/components/TitleBar.tsx` | 自绘顶部栏：应用菜单（打开 / 克隆 / 新建 / 命令面板 / 设置 / 最近仓库 / 关于 / 关闭）、分组多选弹层、Pin、页签、窗口控制 | 改顶部栏 / 窗口行为 |
| `src/components/RepositoryTabs.tsx` / `NotificationCenter.tsx` | 多仓库页签（拖拽排序、关闭、右键、方向键、加载 / 错误徽标）；通知 toast、通知中心抽屉与错误详情 | 改全局反馈 |
| `src/components/RepoGroupsDialog.tsx` / `GroupAvatar.tsx` | 分组管理器（CRUD、Pin、色板、逐页签分组 / 别名）与组头像 | 改分组管理交互 |
| `src/ui/Dialog.tsx` / `dialogSize.ts` | 统一弹窗：初始焦点、焦点陷阱、浮层栈、busy / dirty 关闭保护、焦点恢复；可选四边 / 四角拖拽调整尺寸并按 `sizeKey` 持久化；`closeOnBackdrop=false` 可禁止遮罩关闭 | 改所有弹窗的共同行为 |
| `src/explorerWindowState.ts` | 资源管理器轻量动作窗口按 action 保存 / 恢复原生窗口尺寸 | 改轻量窗口尺寸规则 |
| `src/ui/ContextMenu.tsx` | 统一右键菜单：视口定位、焦点循环、`keepOpen` 多选菜单、浮层栈 | 改菜单行为 |
| `src/ui/Confirm.tsx` | 应用内危险确认；危险操作默认聚焦“取消”，requireAck 聚焦勾选框 | 改危险确认策略 |
| `src/ui/SplitHandle.tsx` / `Icon.tsx` | 可拖拽分栏与本地 SVG 图标 | 改共享交互原语 |
| `src/components/Toolbar.tsx` | 命令栏：分支 / 远程 / 过滤 / 视图菜单 / 窄窗口“更多”菜单 | 改工具栏组织 |
| `src/components/LeftPanel.tsx` | 本地变更 / 全部提交 / 分支 / 标签 / Submodules / Worktrees；分支标签过滤、200 条分页、树键盘移动、worktree 打开、分支目录右键批量删除 | 改引用导航 |
| `src/branchDelete.ts` | 分支目录收集与删除计划纯函数：`prefix/` 匹配、嵌套、远程 HEAD 排除、合并状态 → 是否强制 | 改目录删除规则 |
| `src/branchDeleteDialog.tsx` | 单分支 / 本地目录 / 远程目录删除确认框：动态确认按钮与警告文案 | 改删除确认文案或样式 |
| `src/components/RevisionGrid.tsx` | 虚拟化提交列表 + Canvas 分支图；`aria-activedescendant`、容器级方向键、增量图宽 | 改列表 / 图渲染 |
| `src/components/DiffView.tsx` | 文件列表 / 目录树、过滤与 500 条封顶、按需 patch、Inline / Split、hunk 导航与内联 Hunk 暂存 / 取消暂存 / 丢弃、行右键、增删统计、按仓库记住模式 | 改 diff 展示 |
| `src/viewState.ts` | Diff 解析 / 分类 / 分栏 / 折叠 / 虚拟窗口、`extractHunkPatch`、`buildBranchTree`、`applyAutosquashOrder`、草稿恢复、dirty 规则 | 改可测试的视图状态规则 |
| `src/highlight.worker.ts` / `src/languages.ts` | highlight.js 后台高亮、扩展名到语言映射 | 改高亮语言 / 请求协议 |
| `src/components/ChangesPanel.tsx` | 暂存区 / 工作区列表、过滤、键盘预览、diff 预览（stale-while-revalidate）与 Hunk 级操作、`.gitignore` 快捷添加、提交（含 Amend 修正）与内联错误 | 改 stage/commit 交互 |
| `src/components/CommitInfo.tsx` | 提交详情；SHA / 邮箱复制、包含分支 / 标签可点击过滤 | 改详情字段展示 |
| `src/components/CompareView.tsx` | 双端提交 / 分支 / 标签对比；保留上一次结果、Enter 触发、内联错误 | 改对比交互 |
| `src/components/ConflictCenter.tsx` | 冲突草稿、来源快照校验、冲突标记提示、合并两侧、继续 / 跳过 / 中止 | 改冲突工作流 |
| `src/components/RebasePlanner.tsx` | 会话内线性 Rebase 计划、批量动作 / 重排 / Autosquash 自动重排 / 拖放指示、执行 | 改 Rebase 交互 |
| `src/components/{Branch,Merge,Pull,Remotes,Worktree,CommandLog,Search,Stash,Tag,Submodule,CheckoutRevision,DiffTool,ApplyPatch,AddFiles,Clone,CreateRepository,Push,Reset,Recovery,Blame,BlameView,FileHistory,TrackedFile}Dialog.tsx` | 各类任务弹窗 / 共用视图；表单弹窗使用 dirty 关闭守卫，错误内联并保留 Git 原始输出 | 改对应工作流 |
| `src/components/SettingsDialog.tsx` | 行为设置、分类键盘导航、未保存修改保护、快捷键帮助；可拖拽边框调整并记住尺寸；「应用」生效但不关闭面板、点击遮罩不关闭 | 改设置交互 |
| `src/explorer/` | 单任务窗口 Host、Commit / Pull / History 轻量界面与原生关闭保护 | 改 Explorer 轻量工作流 |
| `src/repoGroups.ts` | 页签分组纯数据层：组 CRUD、Pin、颜色、分配、多选并集、别名 | 改分组规则 |
| `src/openRepos.ts` | 打开页签持久化：路径白名单、缺失 / 空列表语义、恢复候选 | 改启动恢复规则 |
| `src/tabOrder.ts` | 页签拖拽插入位置与重排纯函数 | 改拖拽排序规则 |
| `src/settings.ts` / `windowState.ts` / `explorerWindowState.ts` / `explorerMenu.ts` | 行为设置、按仓库布局、主窗口 bounds、轻量动作窗口尺寸、资源管理器菜单配置；localStorage 白名单与离屏修正 | 改持久化规则 |
| `src/repoOperations.ts` / `useRepoBusy.ts` | 仓库级写状态同步与共享 busy | 改写状态与关闭保护 |
| `src/api.ts` | 在途读取去重、`writeInvoke`、log-batch 订阅、日期格式化 | 改 IPC 调用方式 |
| `src/types.ts` | 前后端共享 TS 类型 | 改 IPC 字段 |
| `src/styles.css` | 全部样式（暗色主题，按注释分段；含命令面板、通知中心、Diff 工具条） | 改外观 |
| `src/main.tsx` | 窗口 bootstrap；主窗口挂 App，Explorer 窗口挂 ConfirmProvider + ExplorerWindow | 改窗口入口 |

---

## 2. 任务 → 前端入口

| 我要改的东西 | 关键函数 / 锚点 | 备注 |
|---|---|---|
| 打开仓库 / 页签 / 启动恢复 | `App.tsx` 的 `openRepo`、`activateRepo`、`closeRepo`、`closeOthers`、`reorderRepos`、启动恢复 effect、`onDragDropEvent`；`openRepos.ts` | 页签持久化 `openRepos.v1`；恢复只挂载活动页签 |
| 全局命令 / 命令面板 | `commands.ts` 的 `registerCommands` / `useCommands`；`App.tsx` 全局命令 effect；`RepoWorkspace.tsx` 活动仓库命令 effect；`CommandPalette.tsx` | `Ctrl+K`；仓库命令只在 `active` 时注册 |
| 弹窗焦点 / 关闭保护 | `ui/Dialog.tsx` 的 `initialTarget`、`requestClose`、layer effect；`ui/useDirtyClose.ts`；`dialogState.ts` | 焦点 effect 只挂载一次；Esc / 遮罩 / 按钮统一走 dirty 守卫 |
| 右键菜单 / 多选菜单 | `ui/ContextMenu.tsx`；`TitleBar.tsx` 的 `groupMenuItems`（`keepOpen`） | 分组多选菜单保持打开；浮层栈只让顶层处理 Esc |
| 通知 / 错误反馈 | `NotificationCenter.tsx` 的 `ToastItem`、`clearAll`；`App.tsx` 的 `notify`；`ui/InlineError.tsx` | 成功 toast 4 秒自动消失，hover / focus 暂停；错误保留在通知中心 |
| 变更预览 / 轮询 | `RepoWorkspace.tsx` 的 `refreshAux`、`pollOnce`；`ChangesPanel.tsx` 的 `showPreview` 与 status effect | 后台重取保留旧 patch；status 无实质变化不重绘 DiffView |
| 提交 / 暂存 / Amend / Hunk / `.gitignore` | `ChangesPanel.tsx` 的 `run`、`doCommit`、`toggleAmend`、`applyHunk`、`ignorePattern`、`commitError`；`viewState.ts::extractHunkPatch` | Amend 自动回填 HEAD 提交信息；Hunk 丢弃需危险确认 |
| 提交图选择 / 图宽 / 右键扩展动作 | `RevisionGrid.tsx` 的容器 keydown、`aria-activedescendant`、`graphScan`、`RevisionAction` | 支持合并到当前分支、Fixup/Squash、导出补丁/归档、Bisect Good/Bad |
| Diff 模式 / 文件过滤 / Hunk 按钮 | `DiffView.tsx` 的 `loadDiffMode` / `loadDiffWrap`、`filteredEntries`、`renderHunkBar`、`openLineMenu`、`goDiff` | 偏好键含 `prefKey`（仓库路径）；文件列表 500 条封顶 |
| 左侧导航 / 分支文件夹树 | `LeftPanel.tsx` 的 `refFilter`、`refLimit`、`collapsedFolders`、`focusProps`、`treeKeyDown`、`onOpenWorktree`、`onDeleteBranchFolder`；`viewState.ts::buildBranchTree`；`branchDelete.ts::planBranchFolderDelete`、`decideBranchDeletion` | 分支按 `/` 分层可折叠；右键支持远程检出、重命名、远程删除与合并；目录右键可批量删除整棵子树，含当前 HEAD 的本地目录禁用 |
| Merge / Pull / Remotes / Worktree / 搜索 / 命令日志 / Bisect | `MergeDialog.tsx`、`PullDialog.tsx`、`RemotesDialog.tsx`、`WorktreeDialog.tsx`、`SearchDialog.tsx`、`CommandLogDialog.tsx`；`RepoWorkspace.tsx` 的 Bisect 横幅 | `Ctrl+Shift+H` 打开搜索、`Ctrl+Shift+G` 打开命令日志 |
| 对比基准 | `RepoWorkspace.tsx` 的 `compareBase`、`onRevisionAction("compare-base")`；`Toolbar.tsx` 的 `compare-base-chip`；`RevisionGrid.tsx` 菜单标签 | 基准 chip 可清除；Esc 先清基准 |
| 任务视图 / 草稿 | `RepoWorkspace.tsx` 的 `conflictDrafts`、`rebaseDrafts`、`saveConflictDraft`、`saveRebaseDraft`、`switchWorkspace` | 草稿存在会话 maps；关闭页签确认 |
| 分组管理 / 页签别名 | `repoGroups.ts`；`RepoGroupsDialog.tsx`；`TitleBar.tsx`；`RepositoryTabs.tsx` | 全局持久化；别名只改显示 |
| 设置 / 布局 | `settings.ts` 的 `loadSettings` / `loadLayout`；`SettingsDialog.tsx`；`ui/dialogSize.ts` | 行为全局、布局按仓库；dirty 关闭确认；设置弹窗尺寸独立保存 |
| 轻量窗口尺寸 | `explorerWindowState.ts` 的 `restoreExplorerWindowSize` / `watchExplorerWindowSize`；`main.tsx` | 按 action 存独立 localStorage 键；窗口创建后先恢复尺寸再 show |
| 共享 busy / 写调度 | `api.ts` 的 `writeInvoke`；`repoOperations.ts` 的 `runRepoWrite`；`useRepoBusy.ts` | 写组件共享 busy；关闭前复核实时状态 |
| 原生目录 / 文件选择 | `nativeDialog.ts` 的 `pickDirectory` / `pickFile` | Tauri dialog 插件；权限 `dialog:allow-open` |
| 列表键盘 / 树键盘 | `ui/listNav.ts`；`LeftPanel.tsx` 的 `treeKeyDown`；`RevisionGrid.tsx` 容器 keydown；`ChangesPanel.tsx` 的 `listKeyDown` | 行用 Enter/Space/Shift+F10 |

---

## 3. 重点链路

### 浮层栈、焦点与关闭保护

- `Dialog` 挂载时向 `layerStack` 推入 token，卸载弹出；Esc / Tab 只有栈顶处理。`Confirm`、嵌套删除确认、`ContextMenu` 共用同一栈，避免一次 Esc 关两层。
- 初始焦点只做一次：先找 `[data-autofocus]`，不可用时聚焦正文第一个可聚焦元素（排除标题栏关闭按钮），再回退模态容器。父组件轮询重渲染不会重置焦点。
- 焦点陷阱在焦点落到弹窗外时主动拉回；busy 时无可用焦点则聚焦 `.modal` 容器。
- 表单类弹窗用 `useDirtyClose`：busy 时不关闭；dirty 时先确认。它同时把 dirty 登记到 `dialogState`，`App.closeWindow` 的窗口关闭守卫会汇总弹窗输入与仓库草稿。
- `Dialog` 的 `dirty` prop 仍保留给通用场景，但表单弹窗统一走 `useDirtyClose`，避免底部按钮绕过 Esc 守卫。
- `Dialog` 的 `resizable` 在四边 / 四角渲染透明拖拽带，pointermove 时把尺寸夹在 `minWidth/minHeight` 与视口之间；`sizeKey` 存在时把尺寸写到 `git-extensions.dialog-size.v1.<key>`。设置弹窗使用 `sizeKey="settings"`；轻量动作窗口的尺寸由 `explorerWindowState.ts` 按 action 单独保存。
- 设置弹窗的「应用」与「保存」共用保存逻辑，但「应用」只更新父级 `settings`（并重新注册菜单）不关闭面板；父级状态更新后 `dirty` 变 false，应用按钮自动置灰。设置弹窗传 `closeOnBackdrop={false}`，点遮罩不关闭；Esc / 取消 / 关闭按钮仍按 dirty 守卫处理。
- `main.tsx` 在捕获阶段拦截 F5 / Ctrl+R，阻止 WebView 刷新；窗口启动请求由 `window_host` 的 `initial` 保存，刷新后重新 bootstrap 仍能拿到同一份动作。

### 命令注册与命令面板

- `commands.ts` 维护 `Map<owner, Command[]>` 和版本缓存；`useCommands` 用 `useSyncExternalStore` 订阅。
- App 注册应用命令（打开 / 克隆 / 新建 / 设置 / 分组 / 关闭页签 / 切换仓库）；`RepoWorkspace` 在 `active` 时注册当前仓库命令（刷新、工作区、视图预设、分支 / Stash / 标签 / 子模块 / Fetch / Pull / Push 等），切走时注销，避免跨仓库执行。
- `CommandPalette` 搜索 title / group / keywords / shortcut，↑/↓/Home/End/Enter 操作；执行后先关闭面板再运行命令。

### 通知中心

- `App.notify` 保留最近 100 条，不再自动删除成功通知；成功 toast 的 4 秒计时在 `ToastItem` 内，hover / focus 暂停。
- 右下角“通知”入口打开抽屉，列出全部通知；错误行高亮，点击查看完整 Git 输出并可复制。“清空全部”在有错误时二次确认。
- 行内错误（弹窗 / 提交框 / 变更面板）与通知中心是两条互补通道：局部失败必须内联可见，后台失败进通知中心。

### 自动刷新与 diff 预览

- `RepoWorkspace.pollOnce` 在活动页签挂载、切回页签和窗口重新可见时立即执行一次，之后按设置间隔轮询；轮询前检查 `auxPending` / busy / 外部写状态。
- HEAD、分支名或 refs 指纹变化才 `refreshAll`；否则只更新状态与辅助数据。
- `ChangesPanel` 对当前预览文件做 stale-while-revalidate：保留旧 `file`，后台重取；patch 未变时保持原对象，避免 DiffView 卸载与滚动 / 模式复位。初次失败保留错误并停止自动重试，等待用户重选。
- `DiffView` 的 Inline / Split 与换行偏好存 `git-extensions.diffMode:<repoPath>` / `git-extensions.diffWrap:<repoPath>`。

### 键盘列表与树

- `RevisionGrid` 容器是唯一 Tab 停靠点，行使用 `role="option"` + `aria-activedescendant`；方向键 / Home / End / PgUp / PgDn / Enter 由容器处理，选中变化后滚动保持容器焦点。
- `ChangesPanel` 每个文件列表是 `role="listbox"`，容器可聚焦；↑/↓/Home/End 预览，Enter 预览，Space 勾选，Shift+F10 / 菜单键打开文件菜单。
- `LeftPanel` 使用 `data-tree-key` + `focusKey` roving tabindex；↑/↓/Home/End 在组标题与行间移动；标签 / worktree 支持 Enter/Space。
- 分支 / 标签 / Stash / 文件历史弹窗行使用 `ui/listNav.ts` 的方向键移动 + Enter/Space 选择。

### 启动恢复与按需挂载

- `loadOpenRepos`（键缺失回退 `lastRepo`，显式 `[]` 表示无页签）→ 串行 `api.openRepo` 只取 `RepoInfo` → 批量 `setRepos` / `setActivePath` / `ensureGroupActive` → 解锁持久化。
- App 只渲染 `mountedPaths ∪ {activePath}` 的 `RepoWorkspace`；恢复的非活动页签首次激活才挂载并 `refreshAll`。
- 拖放目录 / 仓库内文件由 `getCurrentWindow().onDragDropEvent` 接收，按路径顺序调用 `openRepo`。

### 写操作后的刷新

- stage / unstage / discard / 删除未跟踪仅 `refreshWorktree`；commit / HEAD / refs 变动走 `refreshAll`。
- `refreshAux` 只允许一个在途批次与合并的 pending 范围，all 覆盖 worktree；代际失效抑制旧结果。
- 同一 status 的文件字节仍可能变动，轮询仍后台重读当前预览；但只有 patch 变化才替换 DiffView 数据。

---

## 4. 样式分段

`src/styles.css` 按注释锚点分段：`顶部栏`、`仓库页签`、`命令栏`、`命令面板`、`工作区骨架与分栏`、`提交图`、`提交信息`、`统一 diff`、`变更工作区`、`临时任务视图`、`冲突中心`、`Rebase 计划`、`菜单`、`仓库页签分组管理`、`弹窗与确认`、`状态与通知`。改外观先搜锚点。

---

## 5. 易踩的坑

- **弹窗焦点 effect 不能依赖父组件回调**：`onClose` 常是内联箭头，父组件轮询重渲染会重建 effect；初始聚焦和焦点恢复必须只在挂载 / 卸载做一次，busy / dirty 用 ref 读取。
- **浮层必须共用 layerStack**：`ContextMenu` 与嵌套 `Dialog` 都在 `document` 捕获阶段监听；各自只处理 `isTopLayer`，Esc 用 `stopImmediatePropagation`。否则删除确认会连底层弹窗一起关闭。
- **dirty 守卫要覆盖所有关闭路径**：Esc、遮罩、标题栏 X、底部“取消 / 关闭”按钮和 Alt+F4 都必须走同一套确认；仅给 Dialog 加 dirty 不够。
- **通知不能被 slice 静默丢弃**：错误是用户唯一的 Git stderr 查看入口；只显示最近几条并让“清理”清空全部会让错误永久丢失。抽屉保留全部，清理需确认。
- **轮询不能重置 DiffView**：预览刷新时保留旧 patch；`setPreview({file:null})` 会让面板闪 spinner 并丢失滚动 / 模式 / 折叠。
- **命令注册按 active 仓库**：非活动 RepoWorkspace 不能注册命令，否则在 A 仓库会执行 B 的刷新 / 提交 / 分支操作。
- **键盘列表需要单一 Tab 停靠点**：表格化 rows 全部 `tabIndex=0` 会产生几十上百个 Tab 停靠点；用容器 / roving + `aria-activedescendant`。
- **原生 dialog 插件需要权限**：`@tauri-apps/plugin-dialog` 在 `lib.rs` 注册，capabilities 加 `dialog:allow-open`；便携版同样要在主进程初始化。
- **Diff 偏好按仓库键存储**：`prefKey` 为仓库路径；不要回退成全局键，否则不同仓库互相覆盖 Inline / Split 设置。
- **对比基准是 UI 状态**：`compareBase` 不是 Git 状态；Esc 清基准、右键第二提交执行对比后清空、工具栏 chip 可关闭，避免留下看不见的待对比状态。
- **关闭其它页签要说明保留原因**：dirty / busy 页签不能静默跳过；一次确认列出将关闭与将保留的页签。
- **高亮与历史限量**：Worker 结果按 id 丢弃，超过 5000 行或未知语言跳过；巨型 patch 的换行状态同时用于行与容器，短 patch 的虚拟窗口要 clamp；Blame 2 MiB / 20000 行；工作区使用真实 buffer，不误用 HEAD。
- **设置输入按白名单恢复**：localStorage 可被手工修改，`loadSettings` 只接受布尔值与预定义轮询间隔 / 日志上限；布局数值与弹窗 / 轻量窗口尺寸都按范围夹紧。
- **弹窗尺寸与原生窗口尺寸是两套状态**：设置弹窗拖拽只改 HTML `.modal` 的内联宽高并写 `dialogSize` 键；轻量动作窗口拖拽原生边框后由 `onResized` 写独立 action 键。不要把两者混进主窗口 `windowState`，否则多窗口会互相覆盖。
- **布局与草稿按仓库隔离**：已访问的 RepoWorkspace 与提交面板持久挂载；冲突 / Rebase 草稿保留在会话 maps（含空内容、删除意图、原来源），关闭页签才丢失；不持久化仓库内容草稿。
- **读取去重不是长期缓存**：`api.pendingReads` 只合并同参数在途 Promise，完成 / 失败立即释放；动态 ref 固定到 OID 后才给单文件 loader。
- **自绘顶部栏与窗口生命周期**：`decorations: false`；`data-tauri-drag-region` 只作用于直接元素；窗口控制权限在 capabilities；系统关闭统一走 `closeWindow`，`allowCloseRef` 防循环，关闭失败恢复标记并显示错误；主窗口 `Destroyed` 后显式 `exit(0)`。
- **分支目录删除必须基于全量列表**：不能用 `localTree` / `remoteTree` 或 `local.slice(0, refLimit)` 收集，否则过滤词与 200 条分页会漏删 / 误删；按 `prefix + "/"` 匹配（不包含同名叶子分支），本地 / 远程分开，远程排除 `origin/HEAD`。含当前 HEAD 的本地目录禁用整目录删除；确认框列出实际将删除的完整名单。预检结果只用于确认框，最终仍由 `git branch -d/-D` 复核。
- **页签分组 / 拖拽 / 启动恢复**：分组是纯 UI 配置，Default 不可改名 / 删除 / Pin；页签拖拽 6px 阈值、条外 / Esc / 失捕取消；`openRepos.v1` 缺失回退 `lastRepo`、显式 `[]` 不回退；恢复只懒挂载活动页签，`sessionRestored` 前禁止持久化，StrictMode 用 ref 防双跑。

