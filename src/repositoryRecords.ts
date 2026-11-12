import { displayRepoName, groupById, groupForRepo, type RepoGroupConfig } from "./repoGroups";

/** 持久仓库目录：不复制归组、别名或运行状态，关闭页签不删除记录。 */
export interface RepositoryRecord {
  path: string;
  name: string;
  lastOpenedAt: number;
}

const STORAGE_KEY = "git-extensions.repositoryRecords.v1";
const LEGACY_GROUP_KEY = "git-extensions.repoGroups.v1";
const OPEN_KEY = "git-extensions.openRepos.v1";
const RECENT_KEY = "git-extensions.recentRepos.v2";
const LAST_KEY = "git-extensions.lastRepo";

function pathName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}

function sanitizedRecord(value: unknown): RepositoryRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Partial<RepositoryRecord>;
  if (typeof raw.path !== "string" || !raw.path.trim()) return null;
  const path = raw.path.trim();
  return {
    path, name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : pathName(path),
    lastOpenedAt: typeof raw.lastOpenedAt === "number" && Number.isFinite(raw.lastOpenedAt) && raw.lastOpenedAt >= 0
      ? raw.lastOpenedAt : 0,
  };
}

/** 精确路径去重、保序；同路径时间取最新，不设页签/最近列表数量上限。 */
export function sanitizeRepositoryRecords(value: unknown): RepositoryRecord[] {
  if (!Array.isArray(value)) return [];
  const records = new Map<string, RepositoryRecord>();
  for (const item of value) {
    const record = sanitizedRecord(item);
    if (!record) continue;
    const previous = records.get(record.path);
    if (!previous || record.lastOpenedAt > previous.lastOpenedAt) records.set(record.path, record);
  }
  return [...records.values()];
}

function readStored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function parseStored(key: string): unknown {
  try { return JSON.parse(readStored(key) ?? "null"); } catch { return null; }
}

function mappingPaths(value: unknown): string[] {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.keys(value) : [];
}

/** 只初始化、不预写。新键存在（含 []/损坏数据）即停止旧路径迁移，避免移除项复活。 */
export function loadRepositoryRecords(sources?: {
  openPaths?: string[];
  recentPaths?: string[];
  groupConfig?: RepoGroupConfig;
}): RepositoryRecord[] {
  const stored = readStored(STORAGE_KEY);
  if (stored !== null) {
    try { return sanitizeRepositoryRecords(JSON.parse(stored)); } catch { return []; }
  }
  const legacy = parseStored(LEGACY_GROUP_KEY);
  const raw = typeof legacy === "object" && legacy !== null && !Array.isArray(legacy)
    ? legacy as Record<string, unknown> : {};
  const open = parseStored(OPEN_KEY);
  const recent = parseStored(RECENT_KEY);
  const paths: unknown[] = [
    ...mappingPaths(raw.assignments), ...mappingPaths(raw.aliases),
    ...mappingPaths(sources?.groupConfig?.assignments), ...mappingPaths(sources?.groupConfig?.aliases),
    ...(Array.isArray(open) ? open : []), ...(Array.isArray(recent) ? recent : []),
    ...(sources?.openPaths ?? []), ...(sources?.recentPaths ?? []), readStored(LAST_KEY),
  ];
  // 旧数据没有可靠时间，不把初始化/迁移伪装成一次打开。
  return sanitizeRepositoryRecords(paths.map((path) => ({ path, lastOpenedAt: 0 })));
}

export function saveRepositoryRecords(records: RepositoryRecord[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeRepositoryRecords(records))); }
  catch { /* 隐私模式或配额不足时保留当前会话数据。 */ }
}

/** opened=false 用于登记已知/关闭仓库，不伪造打开时间。默认记录真实打开。 */
export function recordRepository(records: RepositoryRecord[], info: { path: string; name: string }, opened = true): RepositoryRecord[] {
  const record = sanitizedRecord(info);
  if (!record) return records;
  const clean = sanitizeRepositoryRecords(records);
  const index = clean.findIndex((item) => item.path === record.path);
  const previous = index < 0 ? undefined : clean[index];
  record.lastOpenedAt = opened ? Math.max(Date.now(), previous?.lastOpenedAt ?? 0) : previous?.lastOpenedAt ?? 0;
  if (index < 0) return [...clean, record];
  return clean.map((item, i) => i === index ? record : item);
}

export function removeRepositoryRecords(records: RepositoryRecord[], paths: string[]): RepositoryRecord[] {
  const removed = new Set(paths.map((path) => path.trim()).filter(Boolean));
  return records.filter((record) => !removed.has(record.path));
}

/** 定位冲突合并为一条：新 info 的原名优先，时间取两记录最新，保留最早列表位置。 */
export function relocateRepositoryRecord(records: RepositoryRecord[], oldPath: string, info: { path: string; name: string }): RepositoryRecord[] {
  oldPath = oldPath.trim();
  const replacement = sanitizedRecord(info);
  if (!oldPath || !replacement) return records;
  const clean = sanitizeRepositoryRecords(records);
  const merged = clean.filter((record) => record.path === oldPath || record.path === replacement.path);
  replacement.lastOpenedAt = Math.max(0, ...merged.map((record) => record.lastOpenedAt));
  let inserted = false;
  const result: RepositoryRecord[] = [];
  for (const record of clean) {
    if (record.path !== oldPath && record.path !== replacement.path) result.push(record);
    else if (!inserted) {
      result.push(replacement);
      inserted = true;
    }
  }
  if (!inserted) result.push(replacement);
  return result;
}

export function repositoryName(record: RepositoryRecord, config: RepoGroupConfig): string {
  return displayRepoName(config, record);
}

/** 纯本地搜索；传 groupId 限定归组，传 openPaths（包括 []）限定打开项，与 query 取交集。 */
export function filterRepositoryRecords(records: RepositoryRecord[], config: RepoGroupConfig, query: string, options?: {
  groupId?: string;
  openPaths?: string[];
}): RepositoryRecord[] {
  const needle = query.trim().toLowerCase();
  const open = options?.openPaths === undefined ? null : new Set(options.openPaths.map((path) => path.trim()));
  return records.filter((record) => {
    const groupId = groupForRepo(config, record.path);
    if (options?.groupId !== undefined && groupId !== options.groupId) return false;
    if (open !== null && !open.has(record.path)) return false;
    return !needle || [repositoryName(record, config), record.name, record.path, groupById(config, groupId)?.name ?? ""]
      .some((text) => text.toLowerCase().includes(needle));
  });
}
