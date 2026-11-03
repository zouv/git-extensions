/** 打开的仓库页签：只持久化有序路径，恢复时再逐个校验仓库是否仍可打开。 */
export const OPEN_REPOS_KEY = "git-extensions.openRepos.v1";
export const MAX_OPEN_REPOS = 32;

/** localStorage 可能被手工修改：只接受非空字符串，去重、保序并限制数量。 */
export function sanitizeOpenRepos(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const path = item.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
    if (paths.length >= MAX_OPEN_REPOS) break;
  }
  return paths;
}

/** null = 键缺失或内容不可用（回退旧版单仓库）；[] = 用户已关闭全部页签。 */
export function parseOpenRepos(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? sanitizeOpenRepos(value) : null;
  } catch {
    return null;
  }
}

export function loadOpenRepos(): string[] | null {
  try {
    return parseOpenRepos(localStorage.getItem(OPEN_REPOS_KEY));
  } catch {
    return null;
  }
}

export function saveOpenRepos(paths: readonly string[]) {
  try {
    localStorage.setItem(OPEN_REPOS_KEY, JSON.stringify(sanitizeOpenRepos(paths)));
  } catch {
    // 隐私模式或存储已满不影响当前会话
  }
}

/** 新键存在（含显式空列表）时优先；仅键缺失才回退旧版上次活动仓库。 */
export function restoreCandidates(stored: string[] | null, lastRepo: string | null): string[] {
  if (stored !== null) return stored;
  return lastRepo ? sanitizeOpenRepos([lastRepo]) : [];
}

/** 上次活动仓库仍在恢复结果中则沿用，否则选第一个成功恢复的页签。 */
export function pickActivePath(restoredPaths: readonly string[], lastRepo: string | null): string | null {
  const saved = lastRepo?.trim();
  return saved && restoredPaths.includes(saved) ? saved : restoredPaths[0] ?? null;
}
