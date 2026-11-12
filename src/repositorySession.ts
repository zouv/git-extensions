import type { RepoGroupView } from "./repoGroups";

/** 确认后复核：写操作始终阻止关闭，dirty 仅允许已明确授权的路径。 */
export function closeBlockedPaths(
  paths: string[],
  meta: Record<string, { busy?: boolean; dirty?: boolean }>,
  isWriting: (path: string) => boolean,
  approvedDirtyPaths: ReadonlySet<string>,
): string[] {
  return paths.filter((path) =>
    meta[path]?.busy || isWriting(path) || (meta[path]?.dirty && !approvedDirtyPaths.has(path)),
  );
}

/** last 经本轮路径规范化映射后仍在打开列表中才保留，否则回落首项。 */
export function canonicalActivePath(
  paths: string[],
  last: string | null,
  canonicalPaths: ReadonlyMap<string, string>,
): string | null {
  const active = last === null ? null : canonicalPaths.get(last) ?? last;
  return active !== null && paths.includes(active) ? active : paths[0] ?? null;
}

export function newRepositoryGroup(
  config: { view: RepoGroupView },
  anchorGroupId?: string,
): string {
  return anchorGroupId ?? (config.view.kind === "group" ? config.view.groupId : "default");
}
