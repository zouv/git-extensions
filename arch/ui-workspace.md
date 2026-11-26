# 仓库工作区链路图谱 · git-extensions

> 本文是 `ARCHITECTURE.md` 的前端分册之一：单仓库工作区（提交图 / 详情 / Diff / 变更 / 任务视图）。应用外壳见 [`ui-shell.md`](./ui-shell.md)，弹窗 / 命令 / 设置见 [`ui-dialogs.md`](./ui-dialogs.md)；入口路由见 [`ui.md`](./ui.md)。
>
> 体量上限 25,000 字（`sh check-docs.sh` 计算）；超了继续按模块拆。

---

## 1. 文件职责

| 文件 | 职责 | 何时改它 |
|---|---|---|
| `src/RepoWorkspace.tsx` | 单仓库草稿会话、分级刷新、refs / HEAD 轮询、命令注册、任务视图与分栏；历史工作区为「上：提交图 + 详情 / 变更文件，下：常驻 Diff 面板（未选文件显示空状态）」 | 改仓库内状态流 / 布局 |
| `src/components/Toolbar.tsx` | 命令栏：最左导航开关；Repository / Navigate / View / Commands 四菜单；分支下拉 + 刷新；Fetch / Pull / Push 锚定面板；恢复历史 / Stash / 标签 / 子模块；Statistics 与设置 | 改工具栏组织 |
| `src/components/RemoteActionPanel.tsx` | 工具栏 Fetch / Pull / Push 的锚定面板：远程 / 分支 / 选项 → 同面板执行并显示 `remote-progress` 进度、命令、进度条与输出；Push 含待推送提交列表 | 改远程操作面板 / 进度展示 |
| `src/components/LeftPanel.tsx` / `src/leftPanelState.ts` | 本地变更 / 全部提交 / 分支 / 标签 / Submodules / Worktrees；默认只展开本地分支，分类与文件夹折叠状态按仓库持久化；分支标签过滤、200 条分页、树键盘移动、worktree 打开、分支目录右键批量删除；宽度自由拖拽无上限 | 改引用导航 / 折叠恢复 |
| `src/branchDelete.ts` | 分支目录收集与删除计划纯函数：`prefix/` 匹配、嵌套、远程 HEAD 排除、合并状态 → 是否强制 | 改目录删除规则 |
| `src/branchDeleteDialog.tsx` | 单分支 / 本地目录 / 远程目录删除确认框：动态确认按钮与警告文案 | 改删除确认文案或样式 |
| `src/components/RevisionGrid.tsx` | 虚拟化提交列表 + Canvas 分支图；`aria-activedescendant`、容器级方向键、增量图宽；引用紧贴分支图与主题（无固定空白列），整行高亮覆盖分支图节点；View 菜单控制图列 / 作者 / 日期 / SHA / 远程标签 / 标签 / 相对时间；可选 `showColumnHeader` + 受控 `columnWidths`（仅 View history 启用） | 改列表 / 图渲染 / 列宽规则 |
| `src/components/CommitFilesPanel.tsx` | 检查器下半部的提交变更文件列表：列表 / 文件树切换、状态字母 + 路径、500 条封顶、上下键 / Home / End / Enter、与底部 Diff 联动 | 改提交文件列表交互 |
| `src/components/CommitInfo.tsx` | 提交详情；SHA / 邮箱复制、包含分支 / 标签可点击过滤 | 改详情字段展示 |
| `src/components/DiffView.tsx` | 文件列表 / 目录树、过滤与 500 条封顶、按需 patch、Inline / Split 图标分段按钮、完整上下文、hunk 导航与内联 Hunk 暂存 / 取消暂存 / 丢弃、行右键、增删统计、显示模式 / 换行 / 折叠 / 完整内容经 diffPrefs 全局共享 | 改 diff 展示 |
| `src/diffPrefs.ts` | Diff 面板共享状态：模式 / 换行 / 折叠 / 完整内容 / 底部面板高度；全局 localStorage + 同窗口订阅 + 跨窗口 storage 事件同步 | 改 diff 偏好存储 / 同步 |
| `src/viewState.ts` | Diff 解析 / 分类 / 分栏 / 折叠 / 虚拟窗口、`extractHunkPatch`、`buildFileTreeRows`、`buildBranchTree`、`applyAutosquashOrder`、草稿恢复、dirty 规则 | 改可测试的视图状态规则 |
| `src/highlight.worker.ts` / `src/languages.ts` | highlight.js 后台高亮、扩展名到语言映射 | 改高亮语言 / 请求协议 |
| `src/components/ChangesPanel.tsx` | 暂存区 / 工作区列表（列表 / 目录树切换、可拖拽高度）、过滤、行选中（Ctrl+A / Ctrl+点击 / Shift+点击）与独立勾选框、键盘预览、diff 预览（stale-while-revalidate）与 Hunk 级操作、右键还原更改 / ignore 弹窗（复用 explorer IgnorePathDialog）、提交（Amend 位于底部按钮行）与内联错误；批量操作按「行选中 ∪ 勾选」；左侧宽度自由拖拽无上限 | 改 stage/commit 交互 |
| `src/components/CommitContentDialog.tsx` | Push 待推送提交的内容查看：提交信息 + 文件清单与按需单文件 diff（getCommitFiles / getCommitFileDiff） | 改提交内容预览 |
| `src/historyLayout.ts` | View history 分栏 / 列宽持久化：`loadHistoryLayout` / `saveHistoryLayout`（localStorage、范围夹取、首次按窗口宽度给列表宽度） | 改历史窗口布局规则 |
| `src/components/CompareView.tsx` | 双端提交 / 分支 / 标签对比；保留上一次结果、Enter 触发、内联错误 | 改对比交互 |
| `src/components/StatisticsDialog.tsx` | 提交统计弹窗：OVERVIEW / MONTH / WEEK 单序列柱状图、ref 范围与作者筛选、AUTHORS / COMMITS 页脚；数据由后端 `stats.rs::get_statistics` 聚合 | 改统计展示 / 图表 |
| `src/components/ConflictCenter.tsx` | 冲突草稿、来源快照校验、冲突标记提示、合并两侧、继续 / 跳过 / 中止 | 改冲突工作流 |
| `src/components/RebasePlanner.tsx` | 会话内线性 Rebase 计划、批量动作 / 重排 / Autosquash 自动重排 / 拖放指示、执行 | 改 Rebase 交互 |
| `src/repoOperations.ts` / `useRepoBusy.ts` | 仓库级写状态同步与共享 busy | 改写状态与关闭保护 |
| `src/api.ts` | 在途读取去重、`writeInvoke`、log-batch 订阅、日期格式化 | 改 IPC 调用方式 |
| `src/types.ts` | 前后端共享 TS 类型 | 改 IPC 字段 |

---

## 2. 任务 → 前端入口

| 我要改的东西 | 关键函数 / 锚点 | 备注 |
|---|---|---|
| 主窗口历史布局 / 检查器 / 底部 Diff | `RepoWorkspace.tsx` 的 `historyView`、`selectedCommitFile`、`loadCommit(oid, openDiff)`、`onRevisionAction("diff")`、检查器分栏与底部 Diff 常驻 / 空状态；`CommitFilesPanel.tsx`；`settings.ts` 的 `inspectorSize` / `inspectorInfoHeight` / `historyDiffHeight` | 上：提交图 + 详情（上）/ 变更文件（下），下：常驻 Diff 面板（未选文件时显示空状态）；双击 / Enter 提交自动打开第一个文件，Esc 取消选中 |
| 变更预览 / 轮询 | `RepoWorkspace.tsx` 的 `refreshAux`、`pollOnce`；`ChangesPanel.tsx` 的 `showPreview` 与 status effect | 后台重取保留旧 patch；status 无实质变化不重绘 DiffView |
| 提交 / 暂存 / Amend / Hunk / 还原 / ignore | `ChangesPanel.tsx` 的 `run`、`doCommit`、`toggleAmend`、`applyHunk`、`restorePaths`、`pathsUnder`、`renderList`、`onRowClick`、`targetPaths`、`resizeLists`、`listKeyDown`、`commitError`；`viewState.ts::extractHunkPatch` / `buildFileTreeRows` / `rangeSelection` | 行选中与勾选框分开维护，批量按钮取并集；Ctrl+A 只改行选中；列表分割比例存 `UILayout.changesListSplit`；Amend 自动回填 HEAD 提交信息；Hunk 丢弃与还原更改需危险确认；ignore 经 `IgnorePathDialog` 选根 / 所属目录 |
| Push 待推送提交 / 提交内容查看 | `PushDialog.tsx` 的 unpushed effect 与 `push-commits` 列表（资源管理器轻量窗口）；`CommitContentDialog.tsx`；后端 `cli.rs::get_unpushed_commits` | 有 upstream 比 upstream，无 upstream 按显式 remote/target；baseRef=null 提示先 Fetch；点击行打开内容弹窗 |
| Fetch / Pull / Push 面板与进度 | `Toolbar.tsx` 的 `data-remote-action` / `remoteAnchor`；`RepoWorkspace.tsx` 的 `remotePanel` / `runRemote`；`RemoteActionPanel.tsx`；`api.ts` 的 `*WithProgress` / `onRemoteProgress`；后端 `commands.rs` 的 `REMOTE_PROGRESS_EVENT` | 面板顶部对齐点击按钮；OK 后同面板显示进度；`operationId` 过滤其它窗口事件 |
| 提交图选择 / 图宽 / 右键扩展动作 | `RevisionGrid.tsx` 的容器 keydown、`aria-activedescendant`、`graphScan`、`RevisionAction` | 引用与主题紧贴分支图，选中整行高亮覆盖图节点；支持合并到当前分支、Fixup/Squash、导出补丁/归档、Bisect Good/Bad |
| Diff 模式 / 文件过滤 / Hunk 按钮 | `DiffView.tsx` 的 `changeDiffMode` / `changeWrap` / `toggleCollapse` / `toggleFullContext`、`filteredEntries`、`renderHunkBar`、`openLineMenu`、`goDiff`；`diffPrefs.ts` | 模式 / 换行 / 折叠 / 完整内容经 `setDiffPrefs` 写入并广播给全部实例；文件列表 500 条封顶 |
| 左侧导航 / 分支文件夹树 | `LeftPanel.tsx` 的 `refFilter`、`refLimit`、`collapsed`、`focusProps`、`treeKeyDown`、`onOpenWorktree`、`onDeleteBranchFolder`；`leftPanelState.ts` 的 `loadLeftPanelCollapsed` / `saveLeftPanelCollapsed`；`viewState.ts::buildBranchTree`；`branchDelete.ts::planBranchFolderDelete`、`decideBranchDeletion` | 分支按 `/` 分层可折叠；默认只展开本地分支，折叠状态按仓库恢复；width 由拖拽决定、不设上限；右键支持远程检出、重命名、远程删除与合并；目录右键可批量删除整棵子树，含当前 HEAD 的本地目录禁用 |
| 工具栏分支切换 / 分支管理入口 | `Toolbar.tsx` 的 `branchMenu`、`branchItems`、`onCheckoutBranch`；`BranchDialog.tsx` | 下拉列出全部本地分支，当前分支勾选并禁用；底部「分支管理…」才打开管理弹窗；弹窗只在输入真正变化时算 dirty |
| 工具栏四菜单 / 提交导航 / 视图显示 | `Toolbar.tsx` 的 `repositoryItems` / `navigateItems` / `viewItems` / `commandItems`；`RepoWorkspace.tsx` 的 `goToRevision` / `goParent` / `goChild` / `goMergeBase` / `navigateBackward` / `stepQuickSearch`；`RevisionGrid.tsx` 的 `display`；`settings.ts` 的 `GridDisplayOptions` | 导航只使用已加载的 `revisions` / `parents`；View 显示选项按仓库保存在 `UILayout`，隐藏列不改变后端顺序与 lane |
| Merge / Pull / Remotes / Worktree / 搜索 / 命令日志 / Bisect | `MergeDialog.tsx`、`PullDialog.tsx`、`RemotesDialog.tsx`、`WorktreeDialog.tsx`、`SearchDialog.tsx`、`CommandLogDialog.tsx`；`RepoWorkspace.tsx` 的 Bisect 横幅 | `Ctrl+Shift+H` 打开搜索、`Ctrl+Shift+G` 打开命令日志 |
| 对比基准 | `RepoWorkspace.tsx` 的 `compareBase`、`onRevisionAction("compare-base")`；`Toolbar.tsx` 的 `compare-base-chip`；`RevisionGrid.tsx` 菜单标签 | 基准 chip 可清除；Esc 先清基准 |
| 提交统计 | `RepoWorkspace.tsx` 的 `showStatistics`；`Toolbar.tsx` 的设置按钮左侧入口；`StatisticsDialog.tsx` 的 tab / revspec / author / BarChart；后端 `stats.rs::get_statistics` | 作者筛选只影响时间桶与总数；统计上限 100,000 提交 |
| 任务视图 / 草稿 | `RepoWorkspace.tsx` 的 `conflictDrafts`、`rebaseDrafts`、`saveConflictDraft`、`saveRebaseDraft`、`switchWorkspace` | 草稿存在会话 maps；关闭页签确认 |
| 共享 busy / 写调度 | `api.ts` 的 `writeInvoke`；`repoOperations.ts` 的 `runRepoWrite`；`useRepoBusy.ts` | 写组件共享 busy；关闭前复核实时状态 |
| 列表键盘 / 树键盘 | `ui/listNav.ts`；`LeftPanel.tsx` 的 `treeKeyDown`；`RevisionGrid.tsx` 容器 keydown；`ChangesPanel.tsx` 的 `listKeyDown` | 行用 Enter/Space/Shift+F10 |

---

## 3. 重点链路

### 自动刷新与 diff 预览

- `RepoWorkspace.pollOnce` 在活动页签挂载、切回页签和窗口重新可见时立即执行一次，之后按设置间隔轮询；轮询前检查 `auxPending` / busy / 外部写状态。
- HEAD、分支名或 refs 指纹变化才 `refreshAll`；否则只更新状态与辅助数据。
- `ChangesPanel` 对当前预览文件做 stale-while-revalidate：保留旧 `file`，后台重取；patch 未变时保持原对象，避免 DiffView 卸载与滚动 / 模式复位。初次失败保留错误并停止自动重试，等待用户重选。
- `DiffView` 的 Inline / Split、换行、折叠与完整内容经 `diffPrefs.ts` 的共享状态保存（单一 localStorage 键）；同窗口所有实例订阅同一份状态，跨窗口靠 storage 事件同步。完整内容切换时按 `loadFile(file, true)` 重新取整文件 patch；调用方已带 patch（变更预览）时直接复用，避免重复请求。

### Fetch / Pull / Push 面板与进度

- 工具栏按钮把自身 `getBoundingClientRect` 传给 `RepoWorkspace.runRemote`；`RemoteActionPanel` 用 `position: fixed` 渲染在按钮下方（top = anchor.bottom + 6），并随内容高度 / 窗口尺寸重新夹取到视口内。
- 确认后调用 `api.fetchWithProgress` / `pullWithProgress` / `pushWithProgress`：后端在写互斥内执行，stderr 的进度行经 `remote-progress` 事件推送；面板按 `operationId` 过滤其它窗口 / 仓库的事件，百分比取历史最大值，最多保留 200 行日志。
- 执行中面板不可关闭（避免丢失进度与事件监听）；Pull 冲突失败时关闭面板并进入冲突中心，成功后 `refreshAll` 刷新提交图与状态。
- 资源管理器轻量窗口仍用 `PullDialog` / `PushDialog`；主窗口 Repository 菜单的「Pull / Fetch…」保留完整选项对话框，工具栏入口使用紧凑面板。

### 提交统计

- 工具栏 Statistics 按钮位于设置按钮左侧；弹窗顶部为 OVERVIEW / MONTH / WEEK 药丸切换，左侧是 ref 选择（`--- (All)` = HEAD + 全部 refs）与作者列表，右侧是单序列柱状图，页脚显示 AUTHORS / COMMITS。
- 后端 `stats.rs::get_statistics` 一次 revwalk 完成作者聚合与三种时间桶：按月的总览、最新提交所在月的每日、最新提交所在自然周的每日；最多遍历 100,000 个提交，超限返回 `truncated`。
- 作者筛选在服务端生效：只影响图表时间桶与页脚 COMMITS，左栏作者列表始终展示所选 ref 的全量作者；作者身份键优先使用邮箱，无邮箱时回退 `name:<名字>`。

### 主窗口历史布局（提交图 + 检查器 + 底部 Diff）

- 历史工作区固定为上下两段：上段左侧提交图，右侧检查器再分成「提交详情（上）/ 变更文件（下）」；下段 Diff 面板常驻，未选中文件时显示空状态提示。`RepoWorkspace` 用 `historyView` 判断渲染，`ChangesPanel` 始终挂载并用 `display:none` 隐藏，避免切视图丢草稿。
- 单击提交只刷新详情与文件列表，`selectedCommitFile` 清空、底部 Diff 显示空状态；双击提交或按 Enter（`RevisionAction = "diff"`）会经 `loadCommit(oid, true)` 自动选中第一个文件并打开 Diff。Esc 优先取消选中文件（面板保持显示），再清对比基准。
- 同提交刷新时按路径保留已选文件；切到其它提交则清空。`inspectorSize`（宽，右栏右锚定，拖拽方向为 `-delta`）、`inspectorInfoHeight`（详情高）按仓库保存；`historyDiffHeight`（底部 Diff 高）由 `diffPrefs.ts` 全局共享，所有仓库使用同一高度，宽度不设上下限，双击分隔条恢复默认。
- 检查器不再有「详情 / 差异」页签，也没有「移动到底部 / 最大化」按钮；View 菜单只保留显示 / 隐藏检查器与布局预设，三种预设按当前左右面板状态显示选中。底部 Diff 复用 `DiffView` 的单文件模式（`files=[selectedFile]` + `loadFile`），面板常驻，Esc 取消选中文件并显示空状态。

### 键盘列表与树

- `RevisionGrid` 容器是唯一 Tab 停靠点，行使用 `role="option"` + `aria-activedescendant`；方向键 / Home / End / PgUp / PgDn / Enter 由容器处理，选中变化后滚动保持容器焦点。
- `ChangesPanel` 每个文件列表是 `role="listbox"`，容器可聚焦；↑/↓/Home/End 预览，Enter 预览，Space 勾选，Shift+F10 / 菜单键打开文件菜单。
- `LeftPanel` 使用 `data-tree-key` + `focusKey` roving tabindex；↑/↓/Home/End 在组标题与行间移动；标签 / worktree 支持 Enter/Space。
- 分支 / 标签 / Stash / 文件历史弹窗行使用 `ui/listNav.ts` 的方向键移动 + Enter/Space 选择。

### 写操作后的刷新

- stage / unstage / discard / 删除未跟踪仅 `refreshWorktree`；commit / HEAD / refs 变动走 `refreshAll`。
- `refreshAux` 只允许一个在途批次与合并的 pending 范围，all 覆盖 worktree；代际失效抑制旧结果。
- 同一 status 的文件字节仍可能变动，轮询仍后台重读当前预览；但只有 patch 变化才替换 DiffView 数据。

---

## 4. 样式分段

工作区相关锚点：`工作区骨架与分栏`、`提交图`、`提交信息`、`统一 diff`、`变更工作区`、`临时任务视图`、`冲突中心`、`Rebase 计划`。全局分段与顶部栏 / 页签样式见 [`ui-shell.md §4`](./ui-shell.md)。

---

## 5. 易踩的坑

- **轮询不能重置 DiffView**：预览刷新时保留旧 patch；`setPreview({file:null})` 会让面板闪 spinner 并丢失滚动 / 模式 / 折叠。
- **底部 Diff 由 `selectedCommitFile` 驱动**：单击提交只刷新详情 / 文件列表，选中的文件清空后面板显示空状态（面板常驻，不隐藏）；双击或 Enter 才自动打开第一个文件；同提交刷新按路径保留选择，切提交必须清空。Esc 取消选中文件，面板保持显示。`DiffView` 的 `files` 数组要用 `useMemo` 固定（避免每次渲染触发选中 / 观察器重置）。
- **右锚定面板的拖拽方向相反**：检查器在容器右侧，拖拽右移应缩小宽度，`inspectorSize` 用 `-delta`；左侧导航左锚定用 `+delta`，底部 Diff 用 `-delta`。方向写反会表现为分隔条跟随鼠标反向移动 / 拖不动。
- **命令注册按 active 仓库**：非活动 RepoWorkspace 不能注册命令，否则在 A 仓库会执行 B 的刷新 / 提交 / 分支操作。
- **分支管理 dirty 不能把自动回填当修改**：选中分支会把原名填进重命名框，dirty 必须是 `renameTo !== selectedBranch.name`；否则打开分支管理后直接关闭也会提示「放弃未保存的修改」。
- **工具栏分支按钮是下拉而不是管理入口**：点击展开本地分支菜单，当前分支勾选并禁用，底部「分支管理…」才打开 `BranchDialog`；不要把两个动作合并回一个按钮。
- **键盘列表需要单一 Tab 停靠点**：表格化 rows 全部 `tabIndex=0` 会产生几十上百个 Tab 停靠点；用容器 / roving + `aria-activedescendant`。
- **Diff 面板状态全局共享**：模式 / 换行 / 折叠 / 完整内容 / 底部高度都存在 `diffPrefs.ts` 的单一键里，所有仓库、所有 DiffView 实例共用；不要退回按仓库键，否则切换页签时模式、折叠与面板高度会跳动。同窗口用订阅通知、跨窗口用 storage 事件同步；组件内不直写 localStorage。
- **完整上下文必须由后端重新生成 patch**：前端只有默认 3 行上下文，`Show Full Content` 通过 `loadFile(file, true)` 让后端用超大 `context_lines` 重取；不要在前端伪造上下文行。重新生成后仍受单 patch 512 KiB 截断，`truncated` 提示保留。`loadFile` 不存在时（如已直接持有完整 patch 的视图）隐藏该按钮。
- **远程面板进度依赖 operationId 与提前注册监听**：`RemoteActionPanel` 在挂载时就订阅 `remote-progress`，用 ref 过滤 `operationId`；不要等到开始运行才 `listen`，否则会漏掉开头进度。执行中面板不可关闭（会卸载监听并丢失进度），切页签会收起面板但后台操作继续；后端仍以仓库写互斥保护。
- **统计在后端聚合且按邮箱识别作者**：`stats.rs` 一次 revwalk 输出作者 / 月 / 日 / 周桶，前端只渲染，不要在 IPC 里传全部提交时间戳。日期按 Unix 天（UTC）计算，避免引入时区依赖；作者筛选用邮箱身份键（无邮箱回退 `name:`），用显示名会把同名作者串在一起。
- **对比基准是 UI 状态**：`compareBase` 不是 Git 状态；Esc 清基准、右键第二提交执行对比后清空、工具栏 chip 可关闭，避免留下看不见的待对比状态。
- **高亮与历史限量**：Worker 结果按 id 丢弃，超过 5000 行或未知语言跳过；巨型 patch 的换行状态同时用于行与容器，短 patch 的虚拟窗口要 clamp；Blame 2 MiB / 20000 行；工作区使用真实 buffer，不误用 HEAD。
- **布局与草稿按仓库隔离**：已访问的 RepoWorkspace 与提交面板持久挂载；冲突 / Rebase 草稿保留在会话 maps（含空内容、删除意图、原来源），关闭页签才丢失；不持久化仓库内容草稿。
- **读取去重不是长期缓存**：`api.pendingReads` 只合并同参数在途 Promise，完成 / 失败立即释放；动态 ref 固定到 OID 后才给单文件 loader。
- **分支目录删除必须基于全量列表**：不能用 `localTree` / `remoteTree` 或 `local.slice(0, refLimit)` 收集，否则过滤词与 200 条分页会漏删 / 误删；按 `prefix + "/"` 匹配（不包含同名叶子分支），本地 / 远程分开，远程排除 `origin/HEAD`。含当前 HEAD 的本地目录禁用整目录删除；确认框列出实际将删除的完整名单。预检结果只用于确认框，最终仍由 `git branch -d/-D` 复核。写操作开始时 `writeInvoke` 会作废同仓库在途读取，删除后刷新不会复用旧结果；删除当前历史过滤的 ref 时必须清空 `leftRef`，否则提交图会用失效 revspec 加载。`origin/HEAD` 是符号引用，`get_branches` 与 ref 标签都应跳过，避免它作为远程分支或额外提交图标签出现。
- **窄窗布局依赖容器查询，但左右侧栏不设宽度上限**：提交图以 `.workspace-main` 为命名容器隐藏作者 / 日期 / SHA 列，`.rev-refs` 保持自适应宽度并随窄窗收紧上限。不要恢复 `.revision-content min-width:500`。左侧导航（`.left-panel`）、右侧检查器（`.inspector`）与变更文件面板（`.changes-left`）按用户要求移除拖拽夹取与 CSS min/max 上限，宽度完全由拖拽决定（双击分隔条分别恢复 224 / 400 / 420），不要恢复限制。
- **提交框标题、Amend 与字数统计必须流式排列**：`.commit-title-count` 不能恢复绝对定位覆盖标题输入框；标题 / 正文都处理 Ctrl+Enter 提交。
- **DiffView 的 showFileHeader / showStats 分离**：外部已有文件列表时传 `showFileHeader={false}` 隐藏标准路径头与文件列（变更预览、Stash、文件历史），仍可用 `showStats` 显示 +/−；底部 Diff 只有一个文件时保留路径头。Inline 行号在 `renderContent` 渲染，不要只给 Split 加行号。
- **工具栏响应式不能只隐藏不补位**：四菜单文字标签在 1280px 以下收起；1100px 以下 `.toolbar-overflow` 必须换成真实 `.toolbar-more` 菜单，否则恢复历史 / Stash / 标签 / 子模块入口会静默消失。
- **View history 列头是网格内 sticky 行**：列头在行虚拟化容器内占 26px 正常流高度，滚动定位要加 `headerH` 偏移；受控列宽时行宽取 `max(列总宽, 可视宽 - 图宽)`，列总宽超出时横向滚动。列头单元格必须 `overflow: visible`，否则会裁掉右侧的拖拽热区。分栏与列宽统一存 `git-extensions.history-layout.v1`，改保存字段时保持范围校验。
- **变更列表目录行是按钮**：全局 `button` 规则会 `justify-content: center`，目录行必须显式 `flex-start`，并用 14px 占位对齐文件行的状态字母列；复选框宽度也固定为 13px，否则目录 / 文件与各层级缩进会错位。行选中（高亮）与勾选框是两套状态：Ctrl+A / Ctrl+点击 / Shift+点击只改行选中，批量按钮取两者并集；列表行必须 `user-select: none`，否则 Shift+点击会触发浏览器文本选择。`rangeSelection` 只按当前显示顺序取范围。
