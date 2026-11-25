# 弹窗 / 命令 / 设置链路图谱 · git-extensions

> 本文是 `ARCHITECTURE.md` 的前端分册之一：浮层、弹窗、命令、设置与快捷键。应用外壳见 [`ui-shell.md`](./ui-shell.md)，仓库工作区见 [`ui-workspace.md`](./ui-workspace.md)；入口路由见 [`ui.md`](./ui.md)。
>
> 体量上限 25,000 字（`sh check-docs.sh` 计算）；超了继续按模块拆。

---

## 1. 文件职责

| 文件 | 职责 | 何时改它 |
|---|---|---|
| `src/commands.ts` | 类型化命令接口、应用 / 仓库命令注册表、`SHORTCUT_HELP` 单一事实源 | 新增可搜索命令或改快捷键帮助 |
| `src/components/CommandPalette.tsx` | `Ctrl+K` 命令面板：搜索、分组、键盘选择、执行 | 改命令面板交互 |
| `src/ui/layerStack.ts` | 弹窗 / 菜单浮层栈；只有栈顶处理 Esc / Tab | 新增浮层类型或改浮层优先级 |
| `src/ui/Dialog.tsx` / `dialogSize.ts` | 统一弹窗：初始焦点、焦点陷阱、浮层栈、busy / dirty 关闭保护、焦点恢复；可选四边 / 四角拖拽调整尺寸并按 `sizeKey` 持久化；`closeOnBackdrop=false` 可禁止遮罩关闭 | 改所有弹窗的共同行为 |
| `src/ui/useDirtyClose.ts` | 弹窗 dirty 关闭守卫：Esc、遮罩与“取消 / 关闭”按钮共用；同时登记窗口关闭保护 | 新增带草稿的弹窗 |
| `src/ui/confirmContext.ts` / `Confirm.tsx` | Confirm 上下文与 `useConfirm`（独立文件避免 Dialog ↔ Confirm 循环依赖）；危险操作默认聚焦“取消”，requireAck 聚焦勾选框 | 改确认接口 / 危险确认策略 |
| `src/ui/ContextMenu.tsx` | 统一右键菜单：视口定位、焦点循环、`keepOpen` 多选菜单、`children` 一级子菜单、浮层栈；菜单内按勾选 / 图标列统一对齐 | 改菜单行为 |
| `src/ui/InlineError.tsx` | 统一内联错误（保留多行 Git 输出、复制按钮） | 改错误展示 |
| `src/ui/listNav.ts` | 列表行方向键 / Home / End 焦点移动 | 改列表键盘行为 |
| `src/ui/SplitHandle.tsx` / `Icon.tsx` | 可拖拽分栏与本地 SVG 图标 | 改共享交互原语 |
| `src/dialogState.ts` | 弹窗草稿登记，供窗口关闭守卫汇总 | 新增带未保存输入的弹窗 |
| `src/nativeDialog.ts` | `@tauri-apps/plugin-dialog` 的原生目录 / 文件选择封装 | 改打开、克隆、新建、补丁路径选择 |
| `src/settings.ts` | 行为设置、按仓库布局与 View 显示选项（`GridDisplayOptions`）、`groupNavMode`；localStorage 白名单 | 改设置存储 / 默认值 |
| `src/explorerMenu.ts` | 资源管理器右键菜单配置与预览纯函数 | 改系统集成菜单 |
| `src/components/SettingsDialog.tsx` | 行为设置、分类键盘导航、未保存修改保护、快捷键帮助；可拖拽边框调整并记住尺寸；「应用」生效但不关闭面板、点击遮罩不关闭 | 改设置交互 |
| `src/components/RepositorySettingsDialog.tsx` | Repository 菜单的仓库设置弹窗；内容与 `explorer/RepositorySettingsWindow.tsx` 共用 | 改仓库设置展示 |
| `src/components/{Branch,Merge,Pull,Remotes,Worktree,CommandLog,Search,Stash,Tag,Submodule,CheckoutRevision,DiffTool,ApplyPatch,AddFiles,Clone,CreateRepository,Push,Reset,Recovery,Blame,BlameView,FileHistory,TrackedFile}Dialog.tsx` | 各类任务弹窗 / 共用视图；表单弹窗使用 dirty 关闭守卫，错误内联并保留 Git 原始输出 | 改对应工作流 |
| `src/cloneProgress.ts` | 克隆进度输出解析与归并：`parseCloneProgress`、`appendCloneLogLine`（连续同阶段进度只保留最新一行、400 行上限） | 改克隆进度展示 |
| `src/explorer/` | 单任务窗口 Host、Commit / Pull / History 轻量界面与原生关闭保护 | 改 Explorer 轻量工作流 |

---

## 2. 任务 → 前端入口

| 我要改的东西 | 关键函数 / 锚点 | 备注 |
|---|---|---|
| 全局命令 / 命令面板 | `commands.ts` 的 `registerCommands` / `useCommands`；`App.tsx` 全局命令 effect；`RepoWorkspace.tsx` 活动仓库命令 effect；`CommandPalette.tsx` | `Ctrl+K`；仓库命令只在 `active` 时注册 |
| 弹窗焦点 / 关闭保护 | `ui/Dialog.tsx` 的 `initialTarget`、`requestClose`、layer effect；`ui/useDirtyClose.ts`；`dialogState.ts` | 焦点 effect 只挂载一次；Esc / 遮罩 / 按钮统一走 dirty 守卫 |
| 右键菜单 / 多选菜单 | `ui/ContextMenu.tsx`；`RepositoryGroupNav.tsx` 的 `menuItems` / `groupItems` | 组勾选保持打开；子项读取最新配置，Esc 只关闭栈顶 |
| 设置 / 布局 | `settings.ts` 的 `loadSettings` / `loadLayout`；`SettingsDialog.tsx`；`ui/dialogSize.ts` | 行为全局、布局按仓库；dirty 关闭确认；设置弹窗尺寸独立保存；`groupNavMode` 默认 `tab` |
| 原生目录 / 文件选择 | `nativeDialog.ts` 的 `pickDirectory` / `pickFile` | Tauri dialog 插件；权限 `dialog:allow-open` |
| 轻量窗口尺寸 | `explorerWindowState.ts` 的 `restoreExplorerWindowSize` / `watchExplorerWindowSize`；`main.tsx` | 按 action 存独立 localStorage 键；窗口创建后先恢复尺寸再 show |
| 快捷键说明 | `commands.ts::SHORTCUT_HELP` | 新增快捷键时同步帮助 |
| 克隆进度展示 | `cloneProgress.ts`；`CloneDialog.tsx` | Git 的 `\r` 进度逐行发出，前端归并连续同阶段进度 |

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
- App 注册应用命令与全部持久仓库的按需打开 / 切换命令（关键词含原名 / 路径 / 组名）；顶栏查找用独立 `RepositorySearchDialog`，成功后独占目标组。`RepoWorkspace` 只在 `active` 时注册仓库命令，切走注销，避免跨仓库执行。
- `CommandPalette` 搜索 title / group / keywords / shortcut，↑/↓/Home/End/Enter 操作；执行后先关闭面板再运行命令。

---

## 4. 样式分段

弹窗 / 菜单相关锚点：`菜单`、`仓库页签分组管理`、`弹窗与确认`、`状态与通知`。全局分段见 [`ui-shell.md §4`](./ui-shell.md)。

---

## 5. 易踩的坑

- **弹窗焦点 effect 不能依赖父组件回调**：`onClose` 常是内联箭头，父组件轮询重渲染会重建 effect；初始聚焦和焦点恢复必须只在挂载 / 卸载做一次，busy / dirty 用 ref 读取。
- **浮层必须共用 layerStack**：`ContextMenu` 与嵌套 `Dialog` 都在 `document` 捕获阶段监听；各自只处理 `isTopLayer`，Esc 用 `stopImmediatePropagation`。否则删除确认会连底层弹窗一起关闭。
- **dirty 守卫要覆盖所有关闭路径**：Esc、遮罩、标题栏 X、底部“取消 / 关闭”按钮和 Alt+F4 都必须走同一套确认；仅给 Dialog 加 dirty 不够。
- **菜单列对齐按菜单整体判断**：`ContextMenu` 只要菜单内含勾选或图标项，就给每一项渲染空的勾选 / 图标占位列，否则无图标项会左移；三种布局预设也传 `checked` 显示当前布局。
- **设置输入按白名单恢复**：localStorage 可被手工修改，`loadSettings` 只接受布尔值与预定义轮询间隔 / 日志上限 / `groupNavMode`；布局数值与弹窗 / 轻量窗口尺寸都按范围夹紧。
- **弹窗尺寸与原生窗口尺寸是两套状态**：设置弹窗拖拽只改 HTML `.modal` 的内联宽高并写 `dialogSize` 键；轻量动作窗口拖拽原生边框后由 `onResized` 写独立 action 键。不要把两者混进主窗口 `windowState`，否则多窗口会互相覆盖。
- **原生 dialog 插件需要权限**：`@tauri-apps/plugin-dialog` 在 `lib.rs` 注册，capabilities 加 `dialog:allow-open`；便携版同样要在主进程初始化。
- **查找弹窗单击只聚焦**：`RepositoryRecordList` 用 Enter / 双击打开，不要再传 `openOnClick`；否则鼠标用户无法先选中再重新定位 / 从列表移除。
- **术语与快捷键帮助**：Git 命令保留英文，应用概念统一中文；快捷键说明集中在 `commands.ts::SHORTCUT_HELP` 的分组数组，新增快捷键时同步。
- **克隆输出是逐条进度事件**：后端把 Git 的 `\r` 进度更新逐行发出，前端必须经 `appendCloneLogLine` 归并连续同阶段进度（否则每个百分比各占一行）；结果页输出面板用 flex 填满弹窗，弹窗高度由 `.clone-dialog` 提供（轻量窗口 100% 覆盖）。
