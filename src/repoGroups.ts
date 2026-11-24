/** 仓库分组配置：归组与别名独立于打开页签、持久仓库记录。 */
/** 分组预设色库：保留旧 10 色值以兼容已保存配置，再按色系补充常用色。 */
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
  { label: "深蓝", value: "#1d4ed8" },
  { label: "宝蓝", value: "#2563eb" },
  { label: "浅蓝", value: "#60a5fa" },
  { label: "湖蓝", value: "#0ea5e9" },
  { label: "深海蓝", value: "#0369a1" },
  { label: "藏蓝", value: "#1e3a8a" },
  { label: "深绿", value: "#15803d" },
  { label: "翠绿", value: "#16a34a" },
  { label: "草绿", value: "#22c55e" },
  { label: "浅绿", value: "#4ade80" },
  { label: "黄绿", value: "#84cc16" },
  { label: "橄榄绿", value: "#65a30d" },
  { label: "翡翠绿", value: "#059669" },
  { label: "薄荷绿", value: "#10b981" },
  { label: "深青", value: "#0891b2" },
  { label: "亮青", value: "#06b6d4" },
  { label: "浅青", value: "#22d3ee" },
  { label: "碧绿", value: "#2dd4bf" },
  { label: "墨绿", value: "#0f766e" },
  { label: "深橙", value: "#ea580c" },
  { label: "明橙", value: "#f97316" },
  { label: "浅橙", value: "#fb923c" },
  { label: "琥珀", value: "#f59e0b" },
  { label: "金黄", value: "#fbbf24" },
  { label: "柠檬黄", value: "#eab308" },
  { label: "棕黄", value: "#a16207" },
  { label: "正红", value: "#dc2626" },
  { label: "亮红", value: "#ef4444" },
  { label: "浅红", value: "#f87171" },
  { label: "玫红", value: "#e11d48" },
  { label: "洋红", value: "#db2777" },
  { label: "桃红", value: "#ec4899" },
  { label: "浅粉", value: "#f472b6" },
  { label: "深紫", value: "#6d28d9" },
  { label: "亮紫", value: "#8b5cf6" },
  { label: "紫罗兰", value: "#a855f7" },
  { label: "浅紫", value: "#c084fc" },
  { label: "棕色", value: "#b45309" },
  { label: "深棕", value: "#92400e" },
  { label: "米灰", value: "#a8a29e" },
  { label: "暖灰", value: "#78716c" },
  { label: "石板灰", value: "#475569" },
  { label: "深灰", value: "#334155" },
  { label: "炭黑", value: "#1f2937" },
  { label: "墨黑", value: "#0b1220" },
  { label: "浅灰", value: "#d4d4d8" },
] as const;
export type RepoGroupColor = (typeof GROUP_COLOR_PRESETS)[number]["value"];
export const DEFAULT_GROUP_COLOR: RepoGroupColor = "#646a73";

export interface RepoGroup {
  id: string;
  name: string;
  /** 兼容旧调用；固定导航的事实源为 pinnedGroupIds。 */
  pinned: boolean;
  color: RepoGroupColor;
  /** 顶部栏 / 管理器的自定义图标文字；缺省时按组名生成缩写。 */
  badge?: string;
}

export type RepoGroupView =
  | { kind: "group"; groupId: string }
  | { kind: "all-open" }
  | { kind: "none" }
  | { kind: "combined"; groupIds: string[] };

export interface RepoGroupConfig {
  groups: RepoGroup[];
  /** repoPath → groupId；未记录的仓库归入未分组。 */
  assignments: Record<string, string>;
  /** view 的兼容镜像；all-open / none 为 []，不作为可见性的事实源。 */
  activeGroupIds: string[];
  aliases: Record<string, string>;
  view: RepoGroupView;
  /** 固定组成员；显示顺序由 groups 数组决定。 */
  pinnedGroupIds: string[];
  lastActivePathByGroup: Record<string, string>;
}

export const DEFAULT_GROUP_ID = "default";
export const DEFAULT_GROUP_NAME = "未分组";
const STORAGE_KEY = "git-extensions.repoGroups.v2";
const LEGACY_STORAGE_KEY = "git-extensions.repoGroups.v1";
const MAX_GROUPS = 64;
const MAX_NAME = 40;
const MAX_ALIAS = 40;
export const MAX_GROUP_BADGE = 2;

export function isRepoGroupColor(value: unknown): value is RepoGroupColor {
  return typeof value === "string" && GROUP_COLOR_PRESETS.some((preset) => preset.value === value);
}

export function fallbackGroupColor(id: string): RepoGroupColor {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return GROUP_COLOR_PRESETS[Math.abs(hash) % GROUP_COLOR_PRESETS.length].value;
}

export function defaultGroup(color: RepoGroupColor = DEFAULT_GROUP_COLOR): RepoGroup {
  return { id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, pinned: false, color };
}

export function emptyConfig(): RepoGroupConfig {
  return {
    groups: [defaultGroup()], assignments: {}, activeGroupIds: [], aliases: {},
    view: { kind: "all-open" }, pinnedGroupIds: [], lastActivePathByGroup: {},
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 图标文字按字符（而非 UTF-16 码元）截断，避免拆开表情或代理对。 */
function validBadge(value: unknown): string {
  if (typeof value !== "string") return "";
  return [...value.trim()].slice(0, MAX_GROUP_BADGE).join("");
}

function validGroup(value: unknown): RepoGroup | null {
  if (!isObject(value)) return null;
  if (typeof value.id !== "string" || !value.id.trim() || value.id.trim() === DEFAULT_GROUP_ID) return null;
  if (typeof value.name !== "string" || !value.name.trim()) return null;
  const id = value.id.trim();
  const badge = validBadge(value.badge);
  return {
    id, name: value.name.trim().slice(0, MAX_NAME), pinned: value.pinned === true,
    color: isRepoGroupColor(value.color) ? value.color : fallbackGroupColor(id),
    ...(badge ? { badge } : {}),
  };
}

function validIds(value: unknown, ids: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string")
    .map((id) => id.trim()).filter((id) => ids.has(id)))];
}

function viewIds(view: RepoGroupView): string[] {
  return view.kind === "group" ? [view.groupId] : view.kind === "combined" ? view.groupIds : [];
}

function viewForIds(ids: string[]): RepoGroupView {
  return ids.length === 1 ? { kind: "group", groupId: ids[0] }
    : ids.length > 1 ? { kind: "combined", groupIds: ids } : { kind: "all-open" };
}

function withView(config: RepoGroupConfig, view: RepoGroupView): RepoGroupConfig {
  return { ...config, view, activeGroupIds: [...viewIds(view)] };
}

/** 白名单校验；组顺序即管理器与顶部栏 Pin 的显示顺序，Default 可参与排序。 */
export function sanitizeConfig(value: unknown): RepoGroupConfig {
  if (!isObject(value)) return emptyConfig();
  const rawGroups = Array.isArray(value.groups) ? value.groups : [];
  const groups: RepoGroup[] = [];
  const ids = new Set<string>();
  const names = new Set([DEFAULT_GROUP_NAME.toLowerCase(), "default"]);
  let defaultSeen = false;
  for (const item of rawGroups) {
    if (groups.length >= MAX_GROUPS) break;
    if (isObject(item) && item.id === DEFAULT_GROUP_ID) {
      if (defaultSeen) continue;
      defaultSeen = true;
      const entry = defaultGroup(isRepoGroupColor(item.color) ? item.color : DEFAULT_GROUP_COLOR);
      // 旧配置没有 pinnedGroupIds 时，Default 的 pinned 与其它组一样参与迁移。
      entry.pinned = item.pinned === true;
      const badge = validBadge(item.badge);
      if (badge) entry.badge = badge;
      groups.push(entry);
      ids.add(DEFAULT_GROUP_ID);
      continue;
    }
    const group = validGroup(item);
    if (!group || ids.has(group.id) || names.has(group.name.toLowerCase())) continue;
    ids.add(group.id);
    names.add(group.name.toLowerCase());
    groups.push(group);
  }
  if (!defaultSeen) groups.unshift(defaultGroup());
  if (groups.length > MAX_GROUPS) groups.length = MAX_GROUPS;
  ids.clear();
  for (const group of groups) ids.add(group.id);
  ids.add(DEFAULT_GROUP_ID);
  const assignments: Record<string, string> = {};
  if (isObject(value.assignments)) {
    for (const [rawPath, groupId] of Object.entries(value.assignments)) {
      const path = rawPath.trim();
      if (path && typeof groupId === "string" && ids.has(groupId) && groupId !== DEFAULT_GROUP_ID) {
        assignments[path] = groupId;
      }
    }
  }
  const aliases: Record<string, string> = {};
  if (isObject(value.aliases)) {
    for (const [rawPath, alias] of Object.entries(value.aliases)) {
      const path = rawPath.trim();
      if (path && typeof alias === "string" && alias.trim()) aliases[path] = alias.trim().slice(0, MAX_ALIAS);
    }
  }
  let view: RepoGroupView = { kind: "all-open" };
  if (!("view" in value)) {
    view = viewForIds(validIds(value.activeGroupIds, ids));
  } else if (isObject(value.view)) {
    const rawView = value.view;
    if (rawView.kind === "none") {
      view = { kind: "none" };
    } else if (rawView.kind === "group" && typeof rawView.groupId === "string" && ids.has(rawView.groupId.trim())) {
      view = { kind: "group", groupId: rawView.groupId.trim() };
    } else if (rawView.kind === "combined") {
      const groupIds = validIds(rawView.groupIds, ids);
      if (groupIds.length) view = { kind: "combined", groupIds };
    }
  }
  const pinnedSource = "pinnedGroupIds" in value
    ? validIds(value.pinnedGroupIds, ids) : groups.filter((g) => g.pinned).map((g) => g.id);
  const pinnedSet = new Set(pinnedSource);
  // Pin 顺序与组顺序统一：pinnedGroupIds 只记录成员关系。
  const pinnedGroupIds = groups.filter((g) => pinnedSet.has(g.id)).map((g) => g.id);
  const config: RepoGroupConfig = {
    groups: groups.map((g) => ({ ...g, pinned: pinnedGroupIds.includes(g.id) })),
    assignments, aliases, view, activeGroupIds: [...viewIds(view)], pinnedGroupIds,
    lastActivePathByGroup: {},
  };
  if (isObject(value.lastActivePathByGroup)) {
    for (const [id, rawPath] of Object.entries(value.lastActivePathByGroup)) {
      if (!ids.has(id) || typeof rawPath !== "string") continue;
      const path = rawPath.trim();
      if (path && groupForRepo(config, path) === id) config.lastActivePathByGroup[id] = path;
    }
  }
  return config;
}

export function loadRepoGroups(): RepoGroupConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    return sanitizeConfig(JSON.parse(raw ?? "{}"));
  } catch { return emptyConfig(); }
}

export function saveRepoGroups(config: RepoGroupConfig) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeConfig(config))); }
  catch { /* 隐私模式或存储已满不影响当前会话。 */ }
}

export function groupForRepo(config: RepoGroupConfig, repoPath: string): string {
  const id = config.assignments[repoPath.trim()];
  return id && config.groups.some((g) => g.id === id) ? id : DEFAULT_GROUP_ID;
}

export function visibleRepos<T extends { path: string }>(config: RepoGroupConfig, repos: T[]): T[] {
  if (config.view.kind === "all-open") return [...repos];
  const active = new Set(viewIds(config.view));
  return repos.filter((repo) => active.has(groupForRepo(config, repo.path)));
}

export function reposInGroup<T extends { path: string }>(config: RepoGroupConfig, repos: T[], groupId: string): T[] {
  return repos.filter((repo) => groupForRepo(config, repo.path) === groupId);
}

export function groupById(config: RepoGroupConfig, groupId: string): RepoGroup | undefined {
  return config.groups.find((g) => g.id === groupId);
}

/** 固定组按 groups 数组顺序返回；pinnedGroupIds 只表示成员关系。 */
export function pinnedGroups(config: RepoGroupConfig): RepoGroup[] {
  const pinned = new Set(config.pinnedGroupIds);
  return config.groups.filter((group) => pinned.has(group.id));
}

export function isGroupActive(config: RepoGroupConfig, groupId: string): boolean {
  return !!groupById(config, groupId) && (config.view.kind === "all-open" || viewIds(config.view).includes(groupId));
}

/** UI 勾选 / Pin 高亮只看显式 view；全部打开是独立系统视图，不把每个组都标成已选。 */
export function isGroupSelected(config: RepoGroupConfig, groupId: string): boolean {
  return !!groupById(config, groupId) && viewIds(config.view).includes(groupId);
}

/** 全部打开不推断归组；组合沿用第一个非默认组。 */
export function primaryGroupId(config: RepoGroupConfig): string {
  return viewIds(config.view).find((id) => id !== DEFAULT_GROUP_ID) ?? DEFAULT_GROUP_ID;
}

export function selectGroup(config: RepoGroupConfig, id: string): RepoGroupConfig {
  return groupById(config, id) ? withView(config, { kind: "group", groupId: id }) : config;
}

export function selectAllOpen(config: RepoGroupConfig): RepoGroupConfig {
  return withView(config, { kind: "all-open" });
}

export function selectCombinedGroups(config: RepoGroupConfig, ids: string[]): RepoGroupConfig {
  const groupIds = validIds(ids, new Set(config.groups.map((g) => g.id)));
  return groupIds.length ? withView(config, { kind: "combined", groupIds }) : selectAllOpen(config);
}

/** 目标已可见时不改变范围；不可见时独占切到目标组。 */
export function ensureGroupActive(config: RepoGroupConfig, groupId: string): RepoGroupConfig {
  return !groupById(config, groupId) || isGroupActive(config, groupId) ? config : selectGroup(config, groupId);
}

/** Pin / 菜单多选开关：全部视图点击组进入单选；取消最后一组保持无选择，不回落全部打开。 */
export function toggleActiveGroup(config: RepoGroupConfig, groupId: string): RepoGroupConfig {
  if (!groupById(config, groupId)) return config;
  if (config.view.kind === "all-open") return selectGroup(config, groupId);
  const ids = viewIds(config.view);
  if (ids.length === 0) return selectGroup(config, groupId);
  const next = ids.includes(groupId) ? ids.filter((id) => id !== groupId) : [...ids, groupId];
  return next.length ? selectCombinedGroups(config, next) : withView(config, { kind: "none" });
}

export function setActiveGroups(config: RepoGroupConfig, groupIds: string[]): RepoGroupConfig {
  return withView(config, viewForIds(validIds(groupIds, new Set(config.groups.map((g) => g.id)))));
}

export function rememberGroupActive(config: RepoGroupConfig, path: string): RepoGroupConfig {
  path = path.trim();
  if (!path) return config;
  const id = groupForRepo(config, path);
  if (config.lastActivePathByGroup[id] === path) return config;
  return { ...config, lastActivePathByGroup: { ...config.lastActivePathByGroup, [id]: path } };
}

export function pickVisibleActive<T extends { path: string }>(config: RepoGroupConfig, repos: T[], currentPath: string | null): string | null {
  const visible = visibleRepos(config, repos);
  const preferred = config.view.kind === "group" ? config.lastActivePathByGroup[config.view.groupId] : currentPath;
  return visible.find((repo) => repo.path === preferred)?.path ?? visible[0]?.path ?? null;
}

export function setRepoGroup(config: RepoGroupConfig, repoPath: string, groupId: string): RepoGroupConfig {
  repoPath = repoPath.trim();
  if (!repoPath) return config;
  const assignments = { ...config.assignments };
  if (groupId === DEFAULT_GROUP_ID || !groupById(config, groupId)) delete assignments[repoPath];
  else assignments[repoPath] = groupId;
  const lastActivePathByGroup = { ...config.lastActivePathByGroup };
  const next = { ...config, assignments, lastActivePathByGroup };
  for (const [id, path] of Object.entries(lastActivePathByGroup)) {
    if (path === repoPath && id !== groupForRepo(next, repoPath)) delete lastActivePathByGroup[id];
  }
  return next;
}

export function displayRepoName(config: RepoGroupConfig, repo: { path: string; name: string }): string {
  return config.aliases[repo.path.trim()] ?? repo.name;
}

export function setRepoAlias(config: RepoGroupConfig, repoPath: string, alias: string): RepoGroupConfig {
  repoPath = repoPath.trim();
  if (!repoPath) return config;
  const trimmed = alias.trim().slice(0, MAX_ALIAS);
  const aliases = { ...config.aliases };
  if (!trimmed) delete aliases[repoPath];
  else aliases[repoPath] = trimmed;
  return { ...config, aliases };
}

function nameTaken(config: RepoGroupConfig, name: string, except?: string): boolean {
  return name.toLowerCase() === "default" || config.groups.some((g) => g.id !== except && g.name.toLowerCase() === name.toLowerCase());
}

export function createGroup(config: RepoGroupConfig, name: string): RepoGroupConfig {
  const trimmed = name.trim().slice(0, MAX_NAME);
  if (!trimmed || config.groups.length >= MAX_GROUPS || nameTaken(config, trimmed)) return config;
  const id = `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const usedColors = new Set(config.groups.map((group) => group.color));
  const color = GROUP_COLOR_PRESETS.find((preset) => !usedColors.has(preset.value))?.value ?? fallbackGroupColor(id);
  return { ...config, groups: [...config.groups, { id, name: trimmed, pinned: false, color }] };
}

export function setGroupColor(config: RepoGroupConfig, groupId: string, color: string): RepoGroupConfig {
  if (!isRepoGroupColor(color) || !groupById(config, groupId)) return config;
  return { ...config, groups: config.groups.map((g) => g.id === groupId ? { ...g, color } : g) };
}

/** 自定义图标文字；最多两个字符，清空后恢复按组名生成。 */
export function setGroupBadge(config: RepoGroupConfig, groupId: string, badge: string): RepoGroupConfig {
  if (!groupById(config, groupId)) return config;
  const trimmed = validBadge(badge);
  return {
    ...config,
    groups: config.groups.map((g) => {
      if (g.id !== groupId) return g;
      if (!trimmed) { const next = { ...g }; delete next.badge; return next; }
      return { ...g, badge: trimmed };
    }),
  };
}

export function renameGroup(config: RepoGroupConfig, groupId: string, name: string): RepoGroupConfig {
  const trimmed = name.trim().slice(0, MAX_NAME);
  if (!trimmed || groupId === DEFAULT_GROUP_ID || nameTaken(config, trimmed, groupId)) return config;
  return { ...config, groups: config.groups.map((g) => g.id === groupId ? { ...g, name: trimmed } : g) };
}

/** 删除组仅取消归组，别名和持久仓库记录不受影响。 */
export function deleteGroup(config: RepoGroupConfig, groupId: string): RepoGroupConfig {
  if (groupId === DEFAULT_GROUP_ID || !groupById(config, groupId)) return config;
  const assignments = Object.fromEntries(Object.entries(config.assignments).filter(([, id]) => id !== groupId));
  const lastActivePathByGroup = { ...config.lastActivePathByGroup };
  delete lastActivePathByGroup[groupId];
  const next = {
    ...config, groups: config.groups.filter((g) => g.id !== groupId), assignments,
    pinnedGroupIds: config.pinnedGroupIds.filter((id) => id !== groupId), lastActivePathByGroup,
  };
  if (config.view.kind === "all-open" || config.view.kind === "none") return next;
  const remaining = viewIds(config.view).filter((id) => id !== groupId);
  return config.view.kind === "combined" ? selectCombinedGroups(next, remaining)
    : remaining.length ? next : selectAllOpen(next);
}

export function togglePin(config: RepoGroupConfig, groupId: string): RepoGroupConfig {
  if (!groupById(config, groupId)) return config;
  const pinned = !config.pinnedGroupIds.includes(groupId);
  return {
    ...config, pinnedGroupIds: pinned ? [...config.pinnedGroupIds, groupId] : config.pinnedGroupIds.filter((id) => id !== groupId),
    groups: config.groups.map((g) => g.id === groupId ? { ...g, pinned } : g),
  };
}

/** Alt+1…9 按固定顺序取非默认组（未分组固定时仍走 Alt+0），越界返回 null。 */
export function groupForPinShortcut(config: RepoGroupConfig, digit: number): string | null {
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) return null;
  if (digit === 0) return groupById(config, DEFAULT_GROUP_ID) ? DEFAULT_GROUP_ID : null;
  return pinnedGroups(config).filter((group) => group.id !== DEFAULT_GROUP_ID)[digit - 1]?.id ?? null;
}

/** 顶部栏拖动排序：只在固定项占用的槽位内重排，组顺序随之更新。 */
export function reorderPinned(config: RepoGroupConfig, orderedPinnedIds: string[]): RepoGroupConfig {
  if (orderedPinnedIds.length !== config.pinnedGroupIds.length || new Set(orderedPinnedIds).size !== orderedPinnedIds.length
    || orderedPinnedIds.some((id) => !config.pinnedGroupIds.includes(id))) return config;
  const pinned = new Set(config.pinnedGroupIds);
  const byId = new Map(config.groups.map((group) => [group.id, group]));
  const queue = [...orderedPinnedIds];
  const groups = config.groups.map((group) => pinned.has(group.id) ? byId.get(queue.shift()!)! : group);
  return { ...config, groups, pinnedGroupIds: groups.filter((group) => pinned.has(group.id)).map((group) => group.id) };
}

/** 管理器拖动排序：完整重排 groups，Pin 顺序随组顺序派生。 */
export function reorderGroups(config: RepoGroupConfig, orderedGroupIds: string[]): RepoGroupConfig {
  const current = config.groups.map((group) => group.id);
  if (orderedGroupIds.length !== current.length || new Set(orderedGroupIds).size !== current.length
    || orderedGroupIds.some((id) => !current.includes(id))) return config;
  const byId = new Map(config.groups.map((group) => [group.id, group]));
  const groups = orderedGroupIds.map((id) => byId.get(id)!);
  const pinned = new Set(config.pinnedGroupIds);
  return { ...config, groups, pinnedGroupIds: groups.filter((group) => pinned.has(group.id)).map((group) => group.id) };
}

/** 重新定位：已登记目标完整保留归组/别名（含隐式未分组/无别名）；否则缺项继承旧路径。 */
export function relocateRepoConfig(config: RepoGroupConfig, oldPath: string, newPath: string, targetAlreadyRecorded = false): RepoGroupConfig {
  oldPath = oldPath.trim();
  newPath = newPath.trim();
  if (!oldPath || !newPath || oldPath === newPath) return config;
  const assignments = { ...config.assignments };
  const aliases = { ...config.aliases };
  if (!targetAlreadyRecorded) {
    if (!Object.hasOwn(assignments, newPath) && Object.hasOwn(assignments, oldPath)) assignments[newPath] = assignments[oldPath];
    if (!Object.hasOwn(aliases, newPath) && Object.hasOwn(aliases, oldPath)) aliases[newPath] = aliases[oldPath];
  }
  delete assignments[oldPath];
  delete aliases[oldPath];
  const lastActivePathByGroup = { ...config.lastActivePathByGroup };
  const next = { ...config, assignments, aliases, lastActivePathByGroup };
  for (const [id, path] of Object.entries(lastActivePathByGroup)) {
    if (path === oldPath) lastActivePathByGroup[id] = newPath;
    if (groupForRepo(next, lastActivePathByGroup[id]) !== id) delete lastActivePathByGroup[id];
  }
  return next;
}
