import type {
  ExplorerAction, ExplorerMenuItem, ExplorerMenuPlacement, ExplorerMenuPlacements,
} from "./types";

export type ExplorerMenuGroup = "repository" | "branches" | "files" | "settings";

export interface ExplorerMenuGroupSpec {
  id: ExplorerMenuGroup;
  label: string;
}

export const EXPLORER_MENU_GROUPS: readonly ExplorerMenuGroupSpec[] = [
  { id: "repository", label: "Repository & sync" },
  { id: "branches", label: "Branches & Repos" },
  { id: "files", label: "Files & history" },
  { id: "settings", label: "Settings" },
];

/** 注册表级联菜单整棵树（含 Others 子项）最多渲染 16 个命令；只提示，不自动调整用户配置。 */
export const MAX_MENU_LEVEL_ITEMS = 16;

export interface ExplorerMenuActionSpec {
  action: ExplorerAction;
  label: string;
  group: ExplorerMenuGroup;
  defaultPlacement: ExplorerMenuPlacement;
}

export const EXPLORER_MENU_ACTIONS: readonly ExplorerMenuActionSpec[] = [
  // Keep this order aligned with the Rust GROUPS table; it is also the
  // top-level menu order and the order shown in settings.
  { action: "clone", label: "Clone...", group: "repository", defaultPlacement: "top" },
  { action: "commit", label: "Commit...", group: "repository", defaultPlacement: "top" },
  { action: "pull", label: "Pull...", group: "repository", defaultPlacement: "cascade" },
  { action: "push", label: "Push...", group: "repository", defaultPlacement: "cascade" },
  { action: "view-stash", label: "View stash", group: "repository", defaultPlacement: "cascade" },
  { action: "view-changes", label: "View changes", group: "repository", defaultPlacement: "cascade" },
  { action: "create-repository", label: "Create new repository...", group: "branches", defaultPlacement: "top" },
  { action: "open-repository", label: "Open repository", group: "branches", defaultPlacement: "top" },
  { action: "checkout-branch", label: "Checkout branch...", group: "branches", defaultPlacement: "cascade" },
  { action: "checkout-revision", label: "Checkout revision...", group: "branches", defaultPlacement: "cascade" },
  { action: "create-branch", label: "Create branch...", group: "branches", defaultPlacement: "cascade" },
  { action: "open-with-difftool", label: "Open with difftool", group: "files", defaultPlacement: "cascade" },
  { action: "file-history", label: "View history", group: "files", defaultPlacement: "cascade" },
  { action: "view-files", label: "View files", group: "files", defaultPlacement: "cascade" },
  { action: "reset-file-changes", label: "Reset file changes...", group: "files", defaultPlacement: "cascade" },
  { action: "add-files", label: "Add files...", group: "files", defaultPlacement: "cascade" },
  { action: "apply-patch", label: "Apply patch...", group: "files", defaultPlacement: "cascade" },
  { action: "rename", label: "Rename...", group: "files", defaultPlacement: "cascade" },
  { action: "repository-settings", label: "Repository settings...", group: "settings", defaultPlacement: "cascade" },
  { action: "settings", label: "Settings", group: "settings", defaultPlacement: "cascade" },
];

export function defaultExplorerMenuPlacements(): ExplorerMenuPlacements {
  return Object.fromEntries(EXPLORER_MENU_ACTIONS.map((spec) => [spec.action, spec.defaultPlacement])) as ExplorerMenuPlacements;
}

export function normalizeExplorerMenuPlacements(value: unknown): ExplorerMenuPlacements {
  const defaults = defaultExplorerMenuPlacements();
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const raw = value as Partial<Record<ExplorerAction, unknown>>;
  for (const spec of EXPLORER_MENU_ACTIONS) {
    const placement = raw[spec.action];
    if (placement === "top" || placement === "cascade" || placement === "others" || placement === "hidden") {
      defaults[spec.action] = placement;
    }
  }
  return defaults;
}

export function explorerMenuItems(placements: ExplorerMenuPlacements): ExplorerMenuItem[] {
  return EXPLORER_MENU_ACTIONS.map(({ action }) => ({ action, placement: placements[action] }));
}

export interface ExplorerMenuLevelCounts {
  level1: number;
  level2Direct: number;
  level2: number;
  level3: number;
  /** 目录上下文（含目录背景）级联菜单实际命令数：直排 + Others + Others 子项。 */
  directoryTotal: number;
  /** 文件上下文级联菜单实际命令数。 */
  fileTotal: number;
  issues: string[];
}

// 与 Rust `Context::supports` 保持一致：Windows 的 16 项上限按上下文
// 实际渲染的命令数计算，文件专用 / 目录专用命令不会同时出现。
const DIRECTORY_ONLY_ACTIONS = new Set<ExplorerAction>([
  "clone", "create-repository", "commit", "pull", "push", "view-stash", "view-changes",
  "checkout-branch", "checkout-revision", "create-branch",
]);
const FILE_ONLY_ACTIONS = new Set<ExplorerAction>([
  "open-with-difftool", "apply-patch",
]);
function contextSupports(action: ExplorerAction, fileContext: boolean): boolean {
  if (FILE_ONLY_ACTIONS.has(action)) return fileContext;
  if (DIRECTORY_ONLY_ACTIONS.has(action)) return !fileContext;
  return true;
}

/**
 * 统计各级菜单项数量与 Windows 级联菜单的实际容量。
 * `ExtendedSubCommandsKey` 生成的整棵级联菜单（含 Others 子菜单）最多
 * 渲染 16 个命令，超出部分会被静默丢弃；这里只提示，不自动修改配置。
 */
export function explorerMenuLevelCounts(
  placements: ExplorerMenuPlacements,
  alwaysShowAll: boolean,
): ExplorerMenuLevelCounts {
  if (alwaysShowAll) {
    return {
      level1: EXPLORER_MENU_ACTIONS.filter((spec) => placements[spec.action] !== "hidden").length,
      level2Direct: 0,
      level2: 0,
      level3: 0,
      directoryTotal: 0,
      fileTotal: 0,
      issues: [],
    };
  }
  const level1 = EXPLORER_MENU_ACTIONS.filter((spec) => placements[spec.action] === "top").length;
  const level2Direct = EXPLORER_MENU_ACTIONS.filter((spec) => placements[spec.action] === "cascade").length;
  const level3 = EXPLORER_MENU_ACTIONS.filter((spec) => placements[spec.action] === "others").length;
  const level2 = level2Direct + (level3 > 0 ? 1 : 0);
  const contextTotal = (fileContext: boolean) => {
    const direct = EXPLORER_MENU_ACTIONS.filter((spec) =>
      contextSupports(spec.action, fileContext) && placements[spec.action] === "cascade").length;
    const others = EXPLORER_MENU_ACTIONS.filter((spec) =>
      contextSupports(spec.action, fileContext) && placements[spec.action] === "others").length;
    return direct + (others > 0 ? 1 : 0) + others;
  };
  const directoryTotal = contextTotal(false);
  const fileTotal = contextTotal(true);
  const issues: string[] = [];
  for (const [label, total] of [["目录", directoryTotal], ["文件", fileTotal]] as const) {
    if (total > MAX_MENU_LEVEL_ITEMS) {
      issues.push(
        `${label}上下文级联菜单共 ${total} 项，超过 Windows 上限 ${MAX_MENU_LEVEL_ITEMS} 项`
        + `（含 Others 及其子项），请把至少 ${total - MAX_MENU_LEVEL_ITEMS} 项改为一级或隐藏`,
      );
    }
  }
  return { level1, level2Direct, level2, level3, directoryTotal, fileTotal, issues };
}

export function explorerMenuPreview(placements: ExplorerMenuPlacements, alwaysShowAll: boolean) {
  const topLevel: ExplorerMenuActionSpec[] = [];
  const cascade: ExplorerMenuActionSpec[] = [];
  const others: ExplorerMenuActionSpec[] = [];
  for (const spec of EXPLORER_MENU_ACTIONS) {
    const placement = placements[spec.action];
    if (placement === "hidden") continue;
    if (alwaysShowAll || placement === "top") topLevel.push(spec);
    else if (placement === "others") others.push(spec);
    else cascade.push(spec);
  }
  const groups = EXPLORER_MENU_GROUPS.map((group) => ({
    ...group,
    items: cascade.filter((spec) => spec.group === group.id),
  })).filter((group) => group.items.length > 0);
  const otherGroups = EXPLORER_MENU_GROUPS.map((group) => ({
    ...group,
    items: others.filter((spec) => spec.group === group.id),
  })).filter((group) => group.items.length > 0);
  return { topLevel, cascade, others, groups, otherGroups };
}
