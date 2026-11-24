const COLLAPSED_PREFIX = "git-extensions.left-panel-collapsed.v1:";

/** 默认只展开「本地分支」，其余分类折叠。 */
export const DEFAULT_COLLAPSED_GROUPS = ["remote", "tags", "submodules", "worktrees"] as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** 折叠状态按仓库保存，包含分类与分支文件夹；旧记录 / 损坏数据回退默认值。 */
export function loadLeftPanelCollapsed(repoPath: string): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(COLLAPSED_PREFIX + repoPath) ?? "null");
    if (!isStringArray(raw)) return [...DEFAULT_COLLAPSED_GROUPS];
    return [...new Set(raw)];
  } catch {
    return [...DEFAULT_COLLAPSED_GROUPS];
  }
}

export function saveLeftPanelCollapsed(repoPath: string, collapsed: Iterable<string>): void {
  try {
    localStorage.setItem(COLLAPSED_PREFIX + repoPath, JSON.stringify([...collapsed]));
  } catch {
    // 隐私模式或存储已满不影响当前会话中的折叠状态。
  }
}
