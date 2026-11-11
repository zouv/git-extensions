import type { BranchDeleteStatus, BranchInfo } from "./types";

export type BranchRefKind = "local" | "remote";

export interface BranchFolderDeletePlan {
  prefix: string;
  kind: BranchRefKind;
  names: string[];
  headBranch: string | null;
}

export interface BranchDeleteDecision {
  force: boolean;
  names: string[];
  unmerged: string[];
  missing: string[];
}

/** 远程跟踪引用里的 `origin/HEAD` 不是可删除分支；只排除「远程名/HEAD」两段形式。 */
const REMOTE_HEAD = /^[^/]+\/HEAD$/;

export function branchFolderNames(
  branches: readonly BranchInfo[],
  prefix: string,
  kind: BranchRefKind,
): string[] {
  if (!prefix) return [];
  const remote = kind === "remote";
  return branches
    .filter((branch) => branch.isRemote === remote)
    .map((branch) => branch.name)
    .filter((name) => name.startsWith(`${prefix}/`))
    .filter((name) => !(remote && REMOTE_HEAD.test(name)))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * 目录删除必须基于完整分支列表（不受左侧过滤词和 200 条分页影响），
 * 并包含嵌套子目录；本地目录同时返回当前 HEAD 用于禁用整目录删除。
 */
export function planBranchFolderDelete(
  branches: readonly BranchInfo[],
  prefix: string,
  kind: BranchRefKind,
): BranchFolderDeletePlan {
  const names = branchFolderNames(branches, prefix, kind);
  const headBranch =
    kind === "local"
      ? (branches.find(
          (branch) => !branch.isRemote && branch.isHead && branch.name.startsWith(`${prefix}/`),
        )?.name ?? null)
      : null;
  return { prefix, kind, names, headBranch };
}

/** 只对仍存在的分支生成删除计划；缺失分支跳过，不因此触发强制删除。 */
export function decideBranchDeletion(
  statuses: readonly BranchDeleteStatus[],
  requestedNames: readonly string[],
): BranchDeleteDecision {
  const byName = new Map(statuses.map((status) => [status.name, status]));
  const names: string[] = [];
  const unmerged: string[] = [];
  const missing: string[] = [];
  for (const name of requestedNames) {
    const status = byName.get(name);
    if (!status || !status.exists) {
      missing.push(name);
      continue;
    }
    names.push(name);
    if (!status.merged) unmerged.push(name);
  }
  return { force: unmerged.length > 0, names, unmerged, missing };
}
