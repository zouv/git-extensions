// 弹窗草稿登记：窗口关闭守卫需要知道设置 / 分支名 / 标签名等尚未保存的输入。
const dirtyDialogs = new Set<symbol>();

export function addDirtyDialog(token: symbol) {
  dirtyDialogs.add(token);
}

export function removeDirtyDialog(token: symbol) {
  dirtyDialogs.delete(token);
}

export function hasDirtyDialogs(): boolean {
  return dirtyDialogs.size > 0;
}
