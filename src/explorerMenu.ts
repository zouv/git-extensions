import type {
  ExplorerAction, ExplorerMenuItem, ExplorerMenuPlacement, ExplorerMenuPlacements,
} from "./types";

export interface ExplorerMenuActionSpec {
  action: ExplorerAction;
  label: string;
  defaultPlacement: ExplorerMenuPlacement;
}

export const EXPLORER_MENU_ACTIONS: readonly ExplorerMenuActionSpec[] = [
  { action: "clone", label: "Clone...", defaultPlacement: "top" },
  { action: "create-repository", label: "Create new repository...", defaultPlacement: "top" },
  { action: "commit", label: "Commit...", defaultPlacement: "top" },
  { action: "open-repository", label: "Open repository", defaultPlacement: "cascade" },
  { action: "pull", label: "Pull", defaultPlacement: "cascade" },
  { action: "push", label: "Push", defaultPlacement: "cascade" },
  { action: "view-stash", label: "View stash", defaultPlacement: "cascade" },
  { action: "view-changes", label: "View changes", defaultPlacement: "cascade" },
  { action: "checkout-branch", label: "Checkout branch", defaultPlacement: "cascade" },
  { action: "checkout-revision", label: "Checkout revision", defaultPlacement: "cascade" },
  { action: "create-branch", label: "Create branch", defaultPlacement: "cascade" },
  { action: "open-with-difftool", label: "Open with difftool", defaultPlacement: "cascade" },
  { action: "file-history", label: "View changelog", defaultPlacement: "cascade" },
  { action: "reset-file-changes", label: "Reset file changes", defaultPlacement: "cascade" },
  { action: "add-files", label: "Add files", defaultPlacement: "cascade" },
  { action: "apply-patch", label: "Apply patch", defaultPlacement: "cascade" },
  { action: "settings", label: "Settings", defaultPlacement: "cascade" },
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
    if (placement === "top" || placement === "cascade" || placement === "hidden") {
      defaults[spec.action] = placement;
    }
  }
  return defaults;
}

export function explorerMenuItems(placements: ExplorerMenuPlacements): ExplorerMenuItem[] {
  return EXPLORER_MENU_ACTIONS.map(({ action }) => ({ action, placement: placements[action] }));
}

export function explorerMenuPreview(placements: ExplorerMenuPlacements, alwaysShowAll: boolean) {
  const topLevel: ExplorerMenuActionSpec[] = [];
  const cascade: ExplorerMenuActionSpec[] = [];
  for (const spec of EXPLORER_MENU_ACTIONS) {
    const placement = placements[spec.action];
    if (placement === "hidden") continue;
    if (alwaysShowAll || placement === "top") topLevel.push(spec);
    else cascade.push(spec);
  }
  return { topLevel, cascade };
}

export function nextExplorerMenuPlacement(placement: ExplorerMenuPlacement): ExplorerMenuPlacement {
  return placement === "cascade" ? "top" : placement === "top" ? "hidden" : "cascade";
}
