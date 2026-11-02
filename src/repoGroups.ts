/** 仓库页签分组：全局 UI 配置，按仓库路径记录组与显示名，不改动任何仓库数据。 */
export const GROUP_COLOR_PRESETS = [
  { label: "蓝色", value: "#3370ff" },
  { label: "绿色", value: "#34c759" },
  { label: "橙色", value: "#ff8800" },
  { label: "红色", value: "#f54a45" },
  { label: "紫色", value: "#7f3bf5" },
  { label: "青色", value: "#14c0ff" },
  { label: "蓝绿色", value: "#00d6b9" },
  { label: "黄色", value: "#ffc60a" },
  { label: "粉色", value: "#ff66a1" },
  { label: "灰色", value: "#646a73" },
] as const;
export type RepoGroupColor = (typeof GROUP_COLOR_PRESETS)[number]["value"];
export const DEFAULT_GROUP_COLOR: RepoGroupColor = "#646a73";

export interface RepoGroup {
  id: string;
  name: string;
  pinned: boolean;
  color: RepoGroupColor;
}

export interface RepoGroupConfig {
  groups: RepoGroup[];
  /** repoPath → groupId；未记录的仓库页签归入 Default。 */
  assignments: Record<string, string>;
  /** 当前选中的组（多选）；页签栏显示这些组内仓库的并集。 */
  activeGroupIds: string[];
  /** repoPath → 自定义页签名（别名）；只影响显示，不影响仓库身份。 */
  aliases: Record<string, string>;
}

export const DEFAULT_GROUP_ID = "default";
export const DEFAULT_GROUP_NAME = "Default";

const STORAGE_KEY = "git-extensions.repoGroups.v1";
const MAX_GROUPS = 64;
const MAX_NAME = 40;
const MAX_ALIAS = 40;

export function isRepoGroupColor(value: unknown): value is RepoGroupColor {
  return typeof value === "string" && GROUP_COLOR_PRESETS.some((preset) => preset.value === value);
}

/** 旧配置没有颜色时按组 ID 稳定补色，沿用初版头像的哈希规则。 */
export function fallbackGroupColor(id: string): RepoGroupColor {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return GROUP_COLOR_PRESETS[Math.abs(hash) % GROUP_COLOR_PRESETS.length].value;
}

export function defaultGroup(color: RepoGroupColor = DEFAULT_GROUP_COLOR): RepoGroup {
  return { id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, pinned: false, color };
}

export function emptyConfig(): RepoGroupConfig {
  return { groups: [defaultGroup()], assignments: {}, activeGroupIds: [DEFAULT_GROUP_ID], aliases: {} };
}

function validGroup(value: unknown): RepoGroup | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Partial<RepoGroup>;
  if (typeof raw.id !== "string" || !raw.id || raw.id === DEFAULT_GROUP_ID) return null;
  if (typeof raw.name !== "string" || !raw.name.trim()) return null;
  return {
    id: raw.id,
    name: raw.name.trim().slice(0, MAX_NAME),
    pinned: raw.pinned === true,
    color: isRepoGroupColor(raw.color) ? raw.color : fallbackGroupColor(raw.id),
  };
}

/** localStorage 可能被手工修改：白名单校验，Default 强制存在且不可 Pin。 */
export function sanitizeConfig(value: unknown): RepoGroupConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return emptyConfig();
  const raw = value as Partial<RepoGroupConfig>;
  let defaultColor = DEFAULT_GROUP_COLOR;
  if (Array.isArray(raw.groups)) {
    const rawDefault = raw.groups.find((item) => typeof item === "object" && item !== null
      && (item as Partial<RepoGroup>).id === DEFAULT_GROUP_ID) as Partial<RepoGroup> | undefined;
    if (rawDefault && isRepoGroupColor(rawDefault.color)) defaultColor = rawDefault.color;
  }
  const groups: RepoGroup[] = [defaultGroup(defaultColor)];
  const ids = new Set<string>([DEFAULT_GROUP_ID]);
  const names = new Set<string>([DEFAULT_GROUP_NAME.toLowerCase()]);
  if (Array.isArray(raw.groups)) {
    for (const item of raw.groups) {
      if (groups.length >= MAX_GROUPS) break;
      const group = validGroup(item);
      if (!group || ids.has(group.id) || names.has(group.name.toLowerCase())) continue;
      ids.add(group.id);
      names.add(group.name.toLowerCase());
      groups.push(group);
    }
  }
  const assignments: Record<string, string> = {};
  if (typeof raw.assignments === "object" && raw.assignments !== null && !Array.isArray(raw.assignments)) {
    for (const [repoPath, groupId] of Object.entries(raw.assignments)) {
      if (!repoPath) continue;
      if (typeof groupId === "string" && ids.has(groupId) && groupId !== DEFAULT_GROUP_ID) assignments[repoPath] = groupId;
    }
  }
  const activeGroupIds: string[] = [];
  if (Array.isArray(raw.activeGroupIds)) {
    for (const id of raw.activeGroupIds) {
      if (typeof id === "string" && ids.has(id) && !activeGroupIds.includes(id)) activeGroupIds.push(id);
    }
  }
  if (activeGroupIds.length === 0) activeGroupIds.push(DEFAULT_GROUP_ID);
  const aliases: Record<string, string> = {};
  if (typeof raw.aliases === "object" && raw.aliases !== null && !Array.isArray(raw.aliases)) {
    for (const [repoPath, alias] of Object.entries(raw.aliases)) {
      if (!repoPath || typeof alias !== "string") continue;
      const trimmed = alias.trim().slice(0, MAX_ALIAS);
      if (trimmed) aliases[repoPath] = trimmed;
    }
  }
  return { groups, assignments, activeGroupIds, aliases };
}

export function loadRepoGroups(): RepoGroupConfig {
  try {
    return sanitizeConfig(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"));
  } catch {
    return emptyConfig();
  }
}

export function saveRepoGroups(config: RepoGroupConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // 隐私模式或存储已满不影响当前会话中的分组调整。
  }
}

export function groupForRepo(config: RepoGroupConfig, repoPath: string): string {
  const id = config.assignments[repoPath];
  return id && config.groups.some((g) => g.id === id) ? id : DEFAULT_GROUP_ID;
}

/** 当前选中的组（多选）可见的仓库页签并集。 */
export function visibleRepos<T extends { path: string }>(config: RepoGroupConfig, repos: T[]): T[] {
  const active = new Set(config.activeGroupIds);
  return repos.filter((repo) => active.has(groupForRepo(config, repo.path)));
}

export function reposInGroup<T extends { path: string }>(config: RepoGroupConfig, repos: T[], groupId: string): T[] {
  return repos.filter((repo) => groupForRepo(config, repo.path) === groupId);
}

export function groupById(config: RepoGroupConfig, groupId: string): RepoGroup | undefined {
  return config.groups.find((g) => g.id === groupId);
}

export function pinnedGroups(config: RepoGroupConfig): RepoGroup[] {
  return config.groups.filter((g) => g.pinned);
}

export function isGroupActive(config: RepoGroupConfig, groupId: string): boolean {
  return config.activeGroupIds.includes(groupId);
}

/** 新打开仓库优先归入的组：第一个选中的非 Default 组。 */
export function primaryGroupId(config: RepoGroupConfig): string {
  return config.activeGroupIds.find((id) => id !== DEFAULT_GROUP_ID) ?? DEFAULT_GROUP_ID;
}

/** 确保指定组处于选中状态（打开仓库时让该页签可见）。 */
export function ensureGroupActive(config: RepoGroupConfig, groupId: string): RepoGroupConfig {
  if (!groupById(config, groupId) || isGroupActive(config, groupId)) return config;
  return { ...config, activeGroupIds: [...config.activeGroupIds, groupId] };
}

/** 多选切换；至少保留 Default，避免页签栏全空。 */
export function toggleActiveGroup(config: RepoGroupConfig, groupId: string): RepoGroupConfig {
  if (!groupById(config, groupId)) return config;
  const next = isGroupActive(config, groupId)
    ? config.activeGroupIds.filter((id) => id !== groupId)
    : [...config.activeGroupIds, groupId];
  return { ...config, activeGroupIds: next.length > 0 ? next : [DEFAULT_GROUP_ID] };
}

export function setActiveGroups(config: RepoGroupConfig, groupIds: string[]): RepoGroupConfig {
  const valid = groupIds.filter((id, index) => groupById(config, id) && groupIds.indexOf(id) === index);
  return { ...config, activeGroupIds: valid.length > 0 ? valid : [DEFAULT_GROUP_ID] };
}

export function setRepoGroup(config: RepoGroupConfig, repoPath: string, groupId: string): RepoGroupConfig {
  const assignments = { ...config.assignments };
  if (groupId === DEFAULT_GROUP_ID || !groupById(config, groupId)) delete assignments[repoPath];
  else assignments[repoPath] = groupId;
  return { ...config, assignments };
}

/** 仓库页签显示名：有别名用别名，否则用仓库名。 */
export function displayRepoName(config: RepoGroupConfig, repo: { path: string; name: string }): string {
  return config.aliases[repo.path] ?? repo.name;
}

export function setRepoAlias(config: RepoGroupConfig, repoPath: string, alias: string): RepoGroupConfig {
  const trimmed = alias.trim().slice(0, MAX_ALIAS);
  const aliases = { ...config.aliases };
  if (!trimmed) delete aliases[repoPath];
  else aliases[repoPath] = trimmed;
  return { ...config, aliases };
}

export function createGroup(config: RepoGroupConfig, name: string): RepoGroupConfig {
  const trimmed = name.trim().slice(0, MAX_NAME);
  if (!trimmed || config.groups.length >= MAX_GROUPS) return config;
  if (config.groups.some((g) => g.name.toLowerCase() === trimmed.toLowerCase())) return config;
  const id = `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const usedColors = new Set(config.groups.map((group) => group.color));
  const color = GROUP_COLOR_PRESETS.find((preset) => !usedColors.has(preset.value))?.value ?? fallbackGroupColor(id);
  return { ...config, groups: [...config.groups, { id, name: trimmed, pinned: false, color }] };
}

export function setGroupColor(config: RepoGroupConfig, groupId: string, color: string): RepoGroupConfig {
  if (!isRepoGroupColor(color) || !groupById(config, groupId)) return config;
  return { ...config, groups: config.groups.map((g) => g.id === groupId ? { ...g, color } : g) };
}

export function renameGroup(config: RepoGroupConfig, groupId: string, name: string): RepoGroupConfig {
  const trimmed = name.trim().slice(0, MAX_NAME);
  if (!trimmed || groupId === DEFAULT_GROUP_ID) return config;
  if (config.groups.some((g) => g.id !== groupId && g.name.toLowerCase() === trimmed.toLowerCase())) return config;
  return { ...config, groups: config.groups.map((g) => g.id === groupId ? { ...g, name: trimmed } : g) };
}

/** 删除组：组内仓库页签（含当前未打开的路径记录）回落 Default；不会删除任何仓库。 */
export function deleteGroup(config: RepoGroupConfig, groupId: string): RepoGroupConfig {
  if (groupId === DEFAULT_GROUP_ID || !groupById(config, groupId)) return config;
  const assignments: Record<string, string> = {};
  for (const [repoPath, id] of Object.entries(config.assignments)) {
    if (id !== groupId) assignments[repoPath] = id;
  }
  const activeGroupIds = config.activeGroupIds.filter((id) => id !== groupId);
  return {
    groups: config.groups.filter((g) => g.id !== groupId),
    assignments,
    activeGroupIds: activeGroupIds.length > 0 ? activeGroupIds : [DEFAULT_GROUP_ID],
    aliases: config.aliases,
  };
}

export function togglePin(config: RepoGroupConfig, groupId: string): RepoGroupConfig {
  if (groupId === DEFAULT_GROUP_ID) return config;
  return { ...config, groups: config.groups.map((g) => g.id === groupId ? { ...g, pinned: !g.pinned } : g) };
}

/** 拖拽重排 Pin 组：pinned 组按新顺序写回（Default 恒在首位），非 pinned 组保持相对顺序。 */
export function reorderPinned(config: RepoGroupConfig, orderedPinnedIds: string[]): RepoGroupConfig {
  const pinned = pinnedGroups(config);
  if (orderedPinnedIds.length !== pinned.length) return config;
  if (orderedPinnedIds.some((id) => !pinned.some((g) => g.id === id))) return config;
  const queue = [...orderedPinnedIds];
  return { ...config, groups: config.groups.map((g) => g.pinned ? groupById(config, queue.shift()!)! : g) };
}
