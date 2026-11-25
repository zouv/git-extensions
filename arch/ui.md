# 前端链路图谱 · git-extensions

> 本文是 `ARCHITECTURE.md` 的前端入口路由。前端内容已按模块拆成三份分册；先按本页路由定位，再只读命中的分册，不在本页重复维护。
>
> 体量上限 25,000 字（`sh check-docs.sh` 计算）；分册超了继续按模块拆。

---

## 0.5 作用域路由

| 我要改的东西 | 读哪份分册 | 先看哪些文件 / 锚点 |
|---|---|---|
| 应用外壳：顶部栏 / 应用菜单 / 窗口控制 / 通知 | [`ui-shell.md`](./ui-shell.md) | `App.tsx`、`TitleBar.tsx`、`NotificationCenter.tsx`、`windowState.ts`、`styles.css` 顶部栏段 |
| 仓库页签 / 分组 / Pin / 页签显示模式 / 启动恢复 | [`ui-shell.md`](./ui-shell.md) | `RepositoryTabs.tsx`、`RepositoryGroupNav.tsx`、`repoGroups.ts`、`openRepos.ts`、`tabOrder.ts`、`repositoryNavigation.css` |
| 组管理器 / 持久仓库记录 / 查找定位 | [`ui-shell.md`](./ui-shell.md) | `RepoGroupsDialog.tsx`、`RepositoryRecordList.tsx`、`RepositorySearchDialog.tsx`、`repositoryRecords.ts`、`repositorySession.ts` |
| 仓库工作区骨架 / 提交图 / 提交详情 / 底部 Diff | [`ui-workspace.md`](./ui-workspace.md) | `RepoWorkspace.tsx`、`RevisionGrid.tsx`、`CommitFilesPanel.tsx`、`DiffView.tsx`、`CommitInfo.tsx` |
| 暂存 / 提交 / 变更列表 / 工作区 diff / 轮询 | [`ui-workspace.md`](./ui-workspace.md) | `ChangesPanel.tsx`、`RepoWorkspace.tsx` 的 `refreshAux` / `pollOnce`、`viewState.ts`、`diffPrefs.ts` |
| 左侧导航 / 分支目录 / 分支删除 | [`ui-workspace.md`](./ui-workspace.md) | `LeftPanel.tsx`、`leftPanelState.ts`、`branchDelete.ts`、`branchDeleteDialog.tsx` |
| 工具栏 / 提交导航 / View 显示选项 | [`ui-workspace.md`](./ui-workspace.md) | `Toolbar.tsx`、`RepoWorkspace.tsx` 的导航函数、`RevisionGrid.tsx`、`settings.ts::GridDisplayOptions` |
| 对比 / 冲突中心 / 交互式 Rebase / 任务视图 | [`ui-workspace.md`](./ui-workspace.md) | `CompareView.tsx`、`ConflictCenter.tsx`、`RebasePlanner.tsx`、`RepoWorkspace.tsx` 的 `task` / 草稿 |
| 弹窗焦点 / 关闭保护 / 浮层栈 | [`ui-dialogs.md`](./ui-dialogs.md) | `ui/Dialog.tsx`、`ui/layerStack.ts`、`ui/useDirtyClose.ts`、`dialogState.ts` |
| 命令面板 / 全局命令 / 快捷键 | [`ui-dialogs.md`](./ui-dialogs.md) | `commands.ts`、`CommandPalette.tsx`、`App.tsx` / `RepoWorkspace.tsx` 命令 effect |
| 右键菜单 / 多选菜单 / 确认框 | [`ui-dialogs.md`](./ui-dialogs.md) | `ui/ContextMenu.tsx`、`ui/Confirm.tsx`、`RepositoryGroupNav.tsx` 菜单 |
| 设置 / 布局持久化 / 原生目录选择 | [`ui-dialogs.md`](./ui-dialogs.md) | `settings.ts`、`SettingsDialog.tsx`、`ui/dialogSize.ts`、`nativeDialog.ts` |
| 各类任务弹窗 / 轻量动作窗口 / 克隆进度 | [`ui-dialogs.md`](./ui-dialogs.md) | `src/components/*Dialog.tsx`、`src/explorer/`、`cloneProgress.ts`、`explorerWindowState.ts` |

---

## 跨模块不变量

- **单一事实源**：分组 / 页签顺序在 `repoGroups.ts` 与 `App.repos`；视图规则在 `viewState.ts`；命令与快捷键在 `commands.ts`；Diff 偏好在 `diffPrefs.ts`。不要在组件内复制一套规则。
- **读写分界**：任何改变仓库状态的操作走 `src-tauri/src/git/cli.rs` 的 CLI 路径；读操作优先 git2。
- **仓库隔离**：布局、折叠状态、Diff 偏好、草稿都按仓库键隔离；全局设置只放显示 / 行为偏好。
- **浮层统一**：弹窗 / 菜单 / 确认共用 `ui/layerStack.ts`；关闭路径统一走 dirty 守卫。
- **文档自愈**：函数名或锚点对不上时以代码为准，并顺手订正对应分册；改结构后同步本路由表。

---

## 样式分段

`src/styles.css` 按注释锚点分段：`顶部栏`、`仓库页签`、`命令栏`、`命令面板`、`工作区骨架与分栏`、`提交图`、`提交信息`、`统一 diff`、`变更工作区`、`临时任务视图`、`冲突中心`、`Rebase 计划`、`菜单`、`仓库页签分组管理`、`弹窗与确认`、`状态与通知`。改外观先搜锚点；作用域隔离样式见 `repositoryNavigation.css` / `repositoryManager.css`。
