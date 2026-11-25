# 前端外壳链路图谱 · git-extensions

> 本文是 `ARCHITECTURE.md` 的前端分册之一：应用外壳（顶部栏 / 页签 / 分组 / 启动恢复 / 通知）。仓库内工作区见 [`ui-workspace.md`](./ui-workspace.md)，弹窗 / 命令 / 设置见 [`ui-dialogs.md`](./ui-dialogs.md)；入口路由见 [`ui.md`](./ui.md)。
>
> 体量上限 25,000 字（`sh check-docs.sh` 计算）；超了继续按模块拆。

---

## 1. 文件职责

| 文件 | 职责 | 何时改它 |
|---|---|---|
| `src/App.tsx` | 完整主窗口：页签恢复 / 分组、窗口状态、通知、全局命令注册、快捷键与外部启动请求队列；持有全局 `settings.groupNavMode` 并透传给顶部栏 | 改跨仓库状态 / 主窗口生命周期 |
| `src/main.tsx` | 窗口 bootstrap；主窗口挂 App，Explorer 窗口挂 ConfirmProvider + ExplorerWindow | 改窗口入口 |
| `src/components/TitleBar.tsx` | 同行顶部：应用菜单 / 组入口 / 页签 / 查找与窗口控制；按 `groupNavMode` 决定显示 Pin 栏或页签内分组图标 | 改顶部导航 / 窗口行为 |
| `src/components/RepositoryGroupNav.tsx` | 组入口与多选菜单；`pin` 模式额外渲染 Pin 彩色缩写图标栏，支持拖动排序并与组顺序同步 | 改分组菜单 / Pin 栏 |
| `src/components/RepositoryTabs.tsx` | `tab` 模式按组渲染「组图标 + 该组页签」并可收起 / 展开、拖动分组、组内拖动页签；`pin` 模式平铺页签；页签关闭 / 键盘 / 溢出列表 / 激活滚入；右键移动分组 / 别名 | 改页签与分组绘制 |
| `src/components/RepoAvatar.tsx` | 仓库页签字母徽标：显示名缩写 + 路径稳定色 + 自动对比文字 | 改页签图标外观 |
| `src/repoIdentity.ts` | 仓库缩写、路径稳定色、文字对比色、同名页签父目录后缀；纯函数无副作用 | 改页签图标识别规则 |
| `src/components/RepoGroupsDialog.tsx` / `GroupAvatar.tsx` / `GroupColorPanel.tsx` | 左组选右记录的组管理器：CRUD / 固定 / 56 色色板面板 / 别名 / 多选归组 / 安全关闭移除 / 分组拖拽排序 / 自定义图标文字 | 改分类整理 |
| `src/components/RepositoryRecordList.tsx` / `RepositorySearchDialog.tsx` | 管理与查找共用记录行、roving 键盘、本地搜索、按需打开与失败定位入口 | 改仓库查找 / 记录列表 |
| `src/components/NotificationCenter.tsx` | 通知 toast 与错误详情抽屉 | 改全局反馈 |
| `src/repoGroups.ts` | 组 CRUD / 归属 / 别名 / 显式 view / 组顺序与 Pin / 图标文字 / 预设色库 / 组内活动记忆；`visibleGroupIds` 与 `reorderGroupSlots` 支撑 Tab 模式分组段 | 改分类与导航规则 |
| `src/repositoryRecords.ts` / `repositorySession.ts` | 持久目录迁移 / 搜索 / 定位；确认后关闭守卫、规范路径活动目标、新路径默认归组纯函数 | 改记录生命周期 / 会话保护 |
| `src/openRepos.ts` | 打开页签持久化：路径白名单、缺失 / 空列表语义、恢复候选 | 改启动恢复规则 |
| `src/tabOrder.ts` | 页签拖拽插入位置、`movePath` 与按过滤条件替换子集 `replaceFiltered` | 改拖拽排序规则 |
| `src/windowState.ts` / `explorerWindowState.ts` | 主窗口 bounds、轻量动作窗口尺寸；localStorage 白名单与离屏修正 | 改窗口尺寸持久化 |
| `src/styles.css` / `repositoryNavigation.css` / `repositoryManager.css` | 主题与通用样式；通过顶部 import 加载作用域限定的同行导航、组管理与查找布局；页签 Chrome 风格、分组段与底部组色线 | 改外观 |

---

## 2. 任务 → 前端入口

| 我要改的东西 | 关键函数 / 锚点 | 备注 |
|---|---|---|
| 打开仓库 / 页签 / 启动恢复 | `App.tsx` 的 `openRepo`（可选 `groupId` / `alias`）、`activateRepo`、`discardSessions`、`closeRepo`、`closeOthers`、`reorderRepos`、`reorderGroupRepos`、`reorderVisibleGroups`、打开弹窗、恢复 effect；`openRepos.ts` | 恢复期禁止普通打开；路径规范化同步活动目标；仅懒挂载活动页签；打开弹窗「自动 / 空」不覆盖现有归属与别名 |
| 分组显示模式 / 分组排序 | `settings.ts::groupNavMode`；`SettingsDialog.tsx`；`RepositoryTabs.tsx` 的 `tabMode` / `collapsedGroups` / `beginGroupDrag` / `updateGroupInsertion` / `finishGroupDrag`；`repoGroups.ts::visibleGroupIds` / `reorderGroupSlots` / `groupForShortcut`；`App.tsx::reorderVisibleGroups` | `tab` 默认：组图标在页签内、点击收起展开、组可拖拽；隐藏 Pin / 固定 UI，Alt+1…9 按分组段顺序；`pin`：原 Pin 图标栏与固定组快捷键 |
| 仓库页签图标 / 同名区分 | `repoIdentity.ts` 的 `abbreviation` / `repoAvatarColor` / `avatarTextColor` / `disambiguateLabels`；`RepoAvatar.tsx`；`RepositoryTabs.tsx` 的 `labels` / `renderTab` | 缩写来自显示名（别名优先），颜色来自规范化路径；同名仓库追加父目录后缀，只改显示不改别名 |
| 通知 / 错误反馈 | `NotificationCenter.tsx` 的 `ToastItem`、`clearAll`；`App.tsx` 的 `notify` | 成功 toast 4 秒自动消失，hover / focus 暂停；错误保留在通知中心 |
| 分组导航 / 页签别名 | `repoGroups.ts` 的 `toggleActiveGroup` / `groupForPinShortcut` / `selectGroup` / `selectAllOpen` / `pickVisibleActive` / `reorderPinned` / `reorderGroups` / `setGroupBadge` / `setGroupColor`；`RepositoryGroupNav.tsx`、`RepoGroupsDialog.tsx`、`GroupColorPanel.tsx`、`RepositoryTabs.tsx`、`App.tsx` 打开弹窗 | Pin / 菜单多选：全部打开下点击组进入单选、取消最后一组保持无选择（`view.kind = "none"`）；Alt+1…9 按组顺序独占固定组、Alt+0 未分组；组顺序是管理器与 Pin 的单一事实源；页签右键可直接移动分组；Ctrl+1…9 切页签 |
| 持久记录管理 / 查找 / 定位 | `repositoryRecords.ts::loadRepositoryRecords / filterRepositoryRecords`；`repositorySession.ts::closeBlockedPaths / canonicalActivePath / newRepositoryGroup`；`App.tsx::openRecorded / addRecorded / closeRepos / removeRecorded / relocateRecorded` | 关闭保留记录；目标已存在时保留其未分组 / 无别名语义 |
| 轻量窗口尺寸 | `explorerWindowState.ts` 的 `restoreExplorerWindowSize` / `watchExplorerWindowSize`；`main.tsx` | 按 action 存独立 localStorage 键；窗口创建后先恢复尺寸再 show |
| 顶部栏 / 窗口控制 | `TitleBar.tsx`；`windowState.ts`；`src-tauri/src/window_host.rs`；capabilities | 自绘标题栏、拖动区域、窗口按钮与系统关闭守卫 |

---

## 3. 重点链路

### 页签与分组的两种绘制模式

- `AppSettings.groupNavMode` 为全局设置，默认 `"tab"`；缺失 / 非法值由 `loadSettings` 回退为 `"tab"`，设置弹窗「界面」可切换为 `"pin"`。
- **`tab` 模式**：`RepositoryTabs` 用 `visibleGroupIds(config, repos)` 按 `groups` 顺序渲染分组段；每段先渲染组图标按钮（`GroupAvatar`），再渲染该组页签。
  - 点击组图标切换本地 `collapsedGroups`，只收起 / 展开该组页签，不改变 `RepoGroupConfig.view`；活动仓库所在组在外部激活时自动展开，用户主动收起活动组时不会自动弹回。
  - 组图标可拖拽排序：`updateGroupInsertion` 用组段矩形计算插入点，提交时 `movePath(groupIds, ...)` → `App.reorderVisibleGroups` → `reorderGroupSlots`；只重排可见组槽位，隐藏组保持原位。
  - 页签拖拽只计算同组页签的插入点；提交时 `movePath(groupPaths, ...)` → `App.reorderGroupRepos` → `replaceFiltered` 只替换该组槽位。
  - 键盘导航只遍历展开组的页签；溢出菜单选中收起组页签时先展开再激活。
- **`pin` 模式**：`RepositoryGroupNav` 渲染 Pin 图标栏，页签平铺渲染；原有 Pin 点击切组、拖动排序、Alt+1…9 按固定组不变。
- **`tab` 模式隐藏 Pin**：分组菜单不渲染 Pin 尾随操作，组管理器不显示「固定」标记 / 菜单项 / 保存提示里的固定字样；Alt+1…9 改按 `groups` 分组段顺序切组。
- 页签的加载 / 操作中 spinner 占用固定的 18px 仓库徽标槽位，不能追加在名称末尾，否则状态切换会拉宽页签并跳动。
- 页签图标使用仓库字母徽标（`RepoAvatar`）：缩写取显示名（别名优先），底色由规范化仓库路径哈希到 12 个固定低饱和色，文字按亮度自动取白 / 深色；同名仓库在显示名后追加父目录后缀，悬停标题补充分支。
- 两种模式共用 Chrome 风格页签样式：活动页签顶部圆角 + 组色描边；`tab` 模式展开时高亮线贯穿组图标与页签底部（收起时隐藏），并有分组段的组色底纹；`pin` 模式使用页签底部高亮线。
- 收起状态是 `RepositoryTabs` 的会话内 state，不写入 `RepoGroupConfig`；重启后全部展开。

### 启动恢复与按需挂载

- `loadOpenRepos`（缺失回退 `lastRepo`，显式 `[]` 不恢复）→ 串行 `api.openRepo` → 同步记录原名 / 规范路径与活动目标 → 批量设置会话 → 解锁持久化。恢复期普通打开有同步门禁，避免最终快照复活已关闭会话；失败目录保留记录和运行期错误。
- `repositoryRecords.v1` 独立于打开列表与 `repoGroups.v2`；缺键才合并旧归属 / 别名 / 打开 / 最近 / last 可获取路径，新键 `[]` 不重新迁移。旧键保留，未知旧组回落未分组；不虚构已丢失的历史。
- App 只渲染 `mountedPaths ∪ {activePath}` 的工作区；未打开记录不发 Git 状态请求。切组从组内记忆选仍打开成员，空组只展示入口；Ctrl+Tab 按可见页签循环。拖放与外部打开复用 `openRepo`。

### 仓库记录、分组与关闭保护

- `RepoGroupConfig.view` 是单组 / 全部已打开 / 无选择（`none`）/ 显式组合的判别联合；`groups` 数组顺序同时决定管理器、顶部栏 Pin 与 Tab 模式分组段的显示顺序，`pinnedGroupIds` 只记录成员关系。`assignments` / `aliases` 仍为归属和别名唯一事实源；记录只存 `path / name / lastOpenedAt`。
- 分组图标默认按组名生成缩写，`RepoGroup.badge`（最多 2 字符）可自定义；清空 badge 即恢复自动生成。组管理器左侧支持指针 / Alt+↑↓ 拖拽排序，顶部栏 Pin 拖动会同步组顺序。页签右键「移动到分组」直接调用 `setRepoGroup`；打开仓库弹窗可选所属分组与页签显示名，分组「自动」/ 显示名留空时保留现有归属与别名。
- 分组颜色走 `GroupColorPanel` 8 列弹层（56 个预设色，保留旧 10 色值）；方向键 / Home / End 移动焦点、Tab 循环、Esc / 外点关闭，选中即调用 `setGroupColor`。颜色仍是受控预设值，存盘前由 `isRepoGroupColor` 白名单校验，不接受任意 hex。
- 添加只验证目录并登记；已有记录打开保留归属，未分组的身份由记录存在性判断，不以稀疏 assignment 判断新旧。仅新路径按单组或相邻锚点归组，全量 / 组合下归未分组。
- 管理器筛选独立于导航 view，双击 / Enter 才激活。关闭仅清会话与草稿，删除组仅取消归组；移除记录需确认，涉及打开项同时走关闭守卫，绝不删磁盘文件。
- 批量确认后重新读取 `metaRef` 与同步 `getRepoOperation`，新 dirty / busy 项保留或中止；确认串行门闩避免多个 resolver 互相覆盖。定位已有目标用 `relocateRepoConfig(..., targetAlreadyRecorded=true)` 保留其隐式未分组 / 无别名，不能按缺项继承源覆盖。
- 路径身份沿用后端返回值与 trim 精确去重，不前端统一小写；只有用户按需打开 / 定位时验证有效性，未打开不等于失效。

### 通知中心

- `App.notify` 保留最近 100 条，不再自动删除成功通知；成功 toast 的 4 秒计时在 `ToastItem` 内，hover / focus 暂停。
- 右下角“通知”入口打开抽屉，列出全部通知；错误行高亮，点击查看完整 Git 输出并可复制。“清空全部”在有错误时二次确认。
- 行内错误（弹窗 / 提交框 / 变更面板）与通知中心是两条互补通道：局部失败必须内联可见，后台失败进通知中心。

---

## 4. 样式分段

`src/styles.css` 按注释锚点分段：`顶部栏`、`仓库页签`、`命令栏`、`命令面板`、`工作区骨架与分栏`、`提交图`、`提交信息`、`统一 diff`、`变更工作区`、`临时任务视图`、`冲突中心`、`Rebase 计划`、`菜单`、`仓库页签分组管理`、`弹窗与确认`、`状态与通知`。改外观先搜锚点。

`repositoryNavigation.css` 只作用于主窗口同行顶部导航；`repositoryManager.css` 只作用于组管理器 / 查找布局。

---

## 5. 易踩的坑

- **自绘顶部栏与窗口生命周期**：`decorations: false`；`data-tauri-drag-region` 只作用于直接元素；窗口控制权限在 capabilities；系统关闭统一走 `closeWindow`，`allowCloseRef` 防循环，关闭失败恢复标记并显示错误；主窗口 `Destroyed` 后显式 `exit(0)`。
- **页签分组 / 拖拽 / 启动恢复**：Default 内部 ID 不变、界面为未分组，不可改名 / 删除，但可以固定、取消固定与参与排序；view 与持久记录 / 会话分离。Pin 图标用完整组色表示选中、未选中灰化；组顺序统一管理 Pin 顺序与 Tab 模式分组段顺序，指针排序沿用页签的 6px 阈值 / 插入线 / Esc 取消 / 边缘滚动，Alt+1…9 与 Alt+0 独占切组，Ctrl+1…9 按当前可见页签切换。取消最后一个选中组进入 `none` 视图（不回落全部打开）；顶部栏不再显示范围文字，当前范围只放按钮 title / aria-label。页签 6px 阈值、条外 / Esc / 失捕取消；恢复缺失与 `[]` 不等价，`sessionRestored` 前禁写打开列表，StrictMode 用 ref 防双跑；路径迁移必须同步活动目标。
- **Tab 模式只重排可见槽位**：分组拖拽必须走 `reorderGroupSlots` / `App.reorderVisibleGroups`，不能直接 `reorderGroups` 全量重排，否则当前视图外的组会被挤走；组内页签拖拽必须走 `reorderGroupRepos` + `replaceFiltered`，不能用平铺模式的 `onReorder` 全量下标。
- **Tab 模式收起分组与键盘**：收起组的页签不渲染，方向键只能在 `visibleTabRepos` 内移动；活动页签被收起时内容区保持不变，溢出菜单 / Alt+数字激活目标时必须先展开该组。组图标 `pointerdown` 要 `stopPropagation`，避免同时触发页签拖拽。
- **组记忆与确认竞态**：切组时按记忆挑页签，日常 effect 只纠正不可见活动项，不能把手动激活又拉回旧记忆。批量关闭 / 移除记录用同步门闩及逐路径 dirty 快照，确认等待后必须再复核写状态。
- **通知不能被 slice 静默丢弃**：错误是用户唯一的 Git stderr 查看入口；只显示最近几条并让“清理”清空全部会让错误永久丢失。抽屉保留全部，清理需确认。
- **页签身份色必须来自路径**：用显示名或分组色会让同名仓库 / 同组仓库难以区分；缩写可随别名变化，但颜色不能。重名后缀只改页签显示，不写回别名或路径。
- **关闭其它页签要说明保留原因**：dirty / busy 页签不能静默跳过；一次确认列出将关闭与将保留的页签。
