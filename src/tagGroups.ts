import type { TagInfo } from "./types";

/** 标签分组：按仓库持久化的纯 UI 配置，不修改任何 Git 数据。 */
export interface TagGroup {
  id: string;
  name: string;
  pinned: boolean;
}

export interface TagGroupConfig {
  groups: TagGroup[];
  /** tagName → groupId；未记录的标签归入 Default。 */
  assignments: Record<string, string>;
  /** 当前选中的组（多选）；标签栏显示这些组内标签的并集。 */
  activeGroupIds: string[];
  /** tagName → 自定义显示名（别名）；Git 操作始终使用真实标签名。 */
  aliases: Record<string, string>;
}

export const DEFAULT_GROUP_ID = "default";
export const DEFAULT_GROUP_NAME = "Default";

const KEY_PREFIX = "git-extensions.tagGroups.v1:";
const MAX_GROUPS = 64;
const MAX_NAME = 40;
const MAX_ALIAS = 40;

export function defaultGroup(): TagGroup {
  return { id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, pinned: false };
}

export function emptyConfig(): TagGroupConfig {
  return { groups: [defaultGroup()], assignments: {}, activeGroupIds: [DEFAULT_GROUP_ID], aliases: {} };
}

function validGroup(value: unknown): TagGroup | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Partial<TagGroup>;
  if (typeof raw.id !== "string" || !raw.id || raw.id === DEFAULT_GROUP_ID) return null;
  if (typeof raw.name !== "string" || !raw.name.trim()) return null;
  return { id: raw.id, name: raw.name.trim().slice(0, MAX_NAME), pinned: raw.pinned === true };
}

/**
 * localStorage 可能被手工修改：白名单校验，Default 强制存在且不可 Pin。
 * 兼容旧版单选字段 activeGroupId：读取时迁移为 activeGroupIds。
 */
export function sanitizeConfig(value: unknown): TagGroupConfig {
  if (typeof value !== "object" || value === null) return emptyConfig();
  const raw = value as Partial<TagGroupConfig> & { activeGroupId?: unknown };
  const groups: TagGroup[] = [defaultGroup()];
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
    for (const [tag, groupId] of Object.entries(raw.assignments)) {
      if (typeof groupId === "string" && ids.has(groupId) && groupId !== DEFAULT_GROUP_ID) assignments[tag] = groupId;
    }
  }
  const rawActive = Array.isArray(raw.activeGroupIds)
    ? raw.activeGroupIds
    : typeof raw.activeGroupId === "string" ? [raw.activeGroupId] : [];
  const activeGroupIds: string[] = [];
  for (const id of rawActive) {
    if (typeof id === "string" && ids.has(id) && !activeGroupIds.includes(id)) activeGroupIds.push(id);
  }
  if (activeGroupIds.length === 0) activeGroupIds.push(DEFAULT_GROUP_ID);
  const aliases: Record<string, string> = {};
  if (typeof raw.aliases === "object" && raw.aliases !== null && !Array.isArray(raw.aliases)) {
    for (const [tag, alias] of Object.entries(raw.aliases)) {
      if (!tag || typeof alias !== "string") continue;
      const trimmed = alias.trim().slice(0, MAX_ALIAS);
      if (trimmed && trimmed !== tag) aliases[tag] = trimmed;
    }
  }
  return { groups, assignments, activeGroupIds, aliases };
}

export function loadTagGroups(repoPath: string): TagGroupConfig {
  try {
    return sanitizeConfig(JSON.parse(localStorage.getItem(KEY_PREFIX + repoPath) ?? "{}"));
  } catch {
    return emptyConfig();
  }
}

export function saveTagGroups(repoPath: string, config: TagGroupConfig) {
  try {
    localStorage.setItem(KEY_PREFIX + repoPath, JSON.stringify(config));
  } catch {
    // 隐私模式或存储已满不影响当前会话中的分组调整。
  }
}

export function groupForTag(config: TagGroupConfig, tagName: string): string {
  const id = config.assignments[tagName];
  return id && config.groups.some((g) => g.id === id) ? id : DEFAULT_GROUP_ID;
}

/** 当前选中的组（多选）可见的标签并集；未分配标签只在选中 Default 时显示。 */
export function visibleTags(config: TagGroupConfig, tags: TagInfo[]): TagInfo[] {
  const active = new Set(config.activeGroupIds);
  return tags.filter((tag) => active.has(groupForTag(config, tag.name)));
}

export function tagsInGroup(config: TagGroupConfig, tags: TagInfo[], groupId: string): TagInfo[] {
  return tags.filter((tag) => groupForTag(config, tag.name) === groupId);
}

export function groupById(config: TagGroupConfig, groupId: string): TagGroup | undefined {
  return config.groups.find((g) => g.id === groupId);
}

export function pinnedGroups(config: TagGroupConfig): TagGroup[] {
  return config.groups.filter((g) => g.pinned);
}

export function isGroupActive(config: TagGroupConfig, groupId: string): boolean {
  return config.activeGroupIds.includes(groupId);
}

/** 新建标签时优先归入的组：第一个选中的非 Default 组。 */
export function primaryGroupId(config: TagGroupConfig): string {
  return config.activeGroupIds.find((id) => id !== DEFAULT_GROUP_ID) ?? DEFAULT_GROUP_ID;
}

/** 多选切换：点击组图标 / 菜单项切换该组是否参与过滤；至少保留 Default，避免标签栏全空。 */
export function toggleActiveGroup(config: TagGroupConfig, groupId: string): TagGroupConfig {
  if (!groupById(config, groupId)) return config;
  const next = isGroupActive(config, groupId)
    ? config.activeGroupIds.filter((id) => id !== groupId)
    : [...config.activeGroupIds, groupId];
  return { ...config, activeGroupIds: next.length > 0 ? next : [DEFAULT_GROUP_ID] };
}

export function setActiveGroups(config: TagGroupConfig, groupIds: string[]): TagGroupConfig {
  const valid = groupIds.filter((id, index) => groupById(config, id) && groupIds.indexOf(id) === index);
  return { ...config, activeGroupIds: valid.length > 0 ? valid : [DEFAULT_GROUP_ID] };
}

export function setTagGroup(config: TagGroupConfig, tagName: string, groupId: string): TagGroupConfig {
  const assignments = { ...config.assignments };
  if (groupId === DEFAULT_GROUP_ID || !groupById(config, groupId)) delete assignments[tagName];
  else assignments[tagName] = groupId;
  return { ...config, assignments };
}

/** 标签显示名：有别名用别名，否则用真实标签名。 */
export function displayName(config: TagGroupConfig, tagName: string): string {
  return config.aliases[tagName] ?? tagName;
}

export function setTagAlias(config: TagGroupConfig, tagName: string, alias: string): TagGroupConfig {
  const trimmed = alias.trim().slice(0, MAX_ALIAS);
  const aliases = { ...config.aliases };
  if (!trimmed || trimmed === tagName) delete aliases[tagName];
  else aliases[tagName] = trimmed;
  return { ...config, aliases };
}

/** Git 标签删除后清理其分组记录与别名。 */
export function forgetTag(config: TagGroupConfig, tagName: string): TagGroupConfig {
  if (!(tagName in config.assignments) && !(tagName in config.aliases)) return config;
  const assignments = { ...config.assignments };
  const aliases = { ...config.aliases };
  delete assignments[tagName];
  delete aliases[tagName];
  return { ...config, assignments, aliases };
}

export function createGroup(config: TagGroupConfig, name: string): TagGroupConfig {
  const trimmed = name.trim().slice(0, MAX_NAME);
  if (!trimmed || config.groups.length >= MAX_GROUPS) return config;
  if (config.groups.some((g) => g.name.toLowerCase() === trimmed.toLowerCase())) return config;
  const id = `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return { ...config, groups: [...config.groups, { id, name: trimmed, pinned: false }] };
}

export function renameGroup(config: TagGroupConfig, groupId: string, name: string): TagGroupConfig {
  const trimmed = name.trim().slice(0, MAX_NAME);
  if (!trimmed || groupId === DEFAULT_GROUP_ID) return config;
  if (config.groups.some((g) => g.id !== groupId && g.name.toLowerCase() === trimmed.toLowerCase())) return config;
  return { ...config, groups: config.groups.map((g) => g.id === groupId ? { ...g, name: trimmed } : g) };
}

/**
 * 删除组。
 * moveToDefault=true：组内标签移入 Default（清除分组记录，Git 标签保留）。
 * moveToDefault=false：组内标签随组一起移除——调用方负责先删除这些 Git 标签（git tag -d），
 *   此处只清理分组记录。这是危险操作，UI 必须二次确认并列出将删除的标签。
 */
export function deleteGroup(config: TagGroupConfig, groupId: string, moveToDefault: boolean): TagGroupConfig {
  if (groupId === DEFAULT_GROUP_ID || !groupById(config, groupId)) return config;
  void moveToDefault; // 两种路径的分组记录清理一致，差异在调用方是否先删 Git 标签。
  const assignments: Record<string, string> = {};
  for (const [tag, id] of Object.entries(config.assignments)) {
    if (id !== groupId) assignments[tag] = id;
  }
  const activeGroupIds = config.activeGroupIds.filter((id) => id !== groupId);
  return {
    groups: config.groups.filter((g) => g.id !== groupId),
    assignments,
    activeGroupIds: activeGroupIds.length > 0 ? activeGroupIds : [DEFAULT_GROUP_ID],
    aliases: config.aliases,
  };
}

export function togglePin(config: TagGroupConfig, groupId: string): TagGroupConfig {
  if (groupId === DEFAULT_GROUP_ID) return config;
  return { ...config, groups: config.groups.map((g) => g.id === groupId ? { ...g, pinned: !g.pinned } : g) };
}

/** 拖拽重排 Pin 组：pinned 组按新顺序写回（位于 Default 之后），非 pinned 组保持相对顺序。 */
export function reorderPinned(config: TagGroupConfig, orderedPinnedIds: string[]): TagGroupConfig {
  const pinned = pinnedGroups(config);
  if (orderedPinnedIds.length !== pinned.length) return config;
  if (orderedPinnedIds.some((id) => !pinned.some((g) => g.id === id))) return config;
  const queue = [...orderedPinnedIds];
  return { ...config, groups: config.groups.map((g) => g.pinned ? groupById(config, queue.shift()!)! : g) };
}
