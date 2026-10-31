import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AheadBehind,
  BlameLine,
  BranchInfo,
  CommitDetail,
  ContainedInfo,
  FileDiff,
  FileLogEntry,
  LogBatch,
  RepoInfo,
  StashInfo,
  StatusSnapshot,
  SubmoduleInfo,
  TagInfo,
  CompareResult,
  OperationState,
  ConflictFile,
  RebasePlan,
  RebaseTodoEntry,
} from "./types";

export const api = {
  openRepo: (path: string) => invoke<RepoInfo>("open_repo", { path }),
  getBranches: (path: string) => invoke<BranchInfo[]>("get_branches", { path }),
  startLog: (path: string, requestId: number, maxCount?: number, revspec?: string | null) =>
    invoke<void>("start_log", { path, requestId, maxCount, revspec }),
  reportFrontendState: (state: string) => invoke<void>("report_frontend_state", { state }),
  getCommit: (path: string, oid: string) =>
    invoke<CommitDetail>("get_commit", { path, oid }),
  getCommitDiff: (path: string, oid: string) =>
    invoke<FileDiff[]>("get_commit_diff", { path, oid }),
  getWorktreeDiff: (path: string, staged: boolean) =>
    invoke<FileDiff[]>("get_worktree_diff", { path, staged }),
  getStatus: (path: string) => invoke<StatusSnapshot>("get_status", { path }),
  stageFiles: (path: string, paths: string[]) =>
    invoke<string>("stage_files", { path, paths }),
  unstageFiles: (path: string, paths: string[]) =>
    invoke<string>("unstage_files", { path, paths }),
  commit: (path: string, message: string) =>
    invoke<string>("commit", { path, message }),
  createBranch: (path: string, name: string, startPoint?: string) =>
    invoke<string>("create_branch", { path, name, startPoint }),
  checkoutBranch: (path: string, name: string) =>
    invoke<string>("checkout_branch", { path, name }),
  deleteBranch: (path: string, name: string, force: boolean) =>
    invoke<string>("delete_branch", { path, name, force }),
  getAheadBehind: (path: string) => invoke<AheadBehind | null>("get_ahead_behind", { path }),
  fetch: (path: string, remote?: string) => invoke<string>("fetch", { path, remote }),
  pull: (path: string) => invoke<string>("pull", { path }),
  push: (path: string) => invoke<string>("push", { path }),
  stashList: (path: string) => invoke<StashInfo[]>("stash_list", { path }),
  stashPush: (path: string, message: string, includeUntracked: boolean) =>
    invoke<string>("stash_push", { path, message, includeUntracked }),
  stashApply: (path: string, name: string, pop: boolean) =>
    invoke<string>("stash_apply", { path, name, pop }),
  stashDrop: (path: string, name: string) => invoke<string>("stash_drop", { path, name }),
  cherryPick: (path: string, oid: string) => invoke<string>("cherry_pick", { path, oid }),
  revert: (path: string, oid: string) => invoke<string>("revert", { path, oid }),
  rebase: (path: string, onto: string) => invoke<string>("rebase", { path, onto }),
  getContainedIn: (path: string, oid: string) =>
    invoke<ContainedInfo>("get_contained_in", { path, oid }),
  tagList: (path: string) => invoke<TagInfo[]>("tag_list", { path }),
  createTag: (path: string, name: string, oid?: string, message?: string) =>
    invoke<string>("create_tag", { path, name, oid, message }),
  deleteTag: (path: string, name: string) => invoke<string>("delete_tag", { path, name }),
  submoduleList: (path: string) => invoke<SubmoduleInfo[]>("submodule_list", { path }),
  submoduleUpdate: (path: string) => invoke<string>("submodule_update", { path }),
  blameFile: (path: string, file: string, oid?: string) =>
    invoke<BlameLine[]>("blame_file", { path, file, oid }),
  fileLog: (path: string, file: string, maxCount?: number) =>
    invoke<FileLogEntry[]>("file_log", { path, file, maxCount }),
  getCompareDiff: (path: string, base: string, target: string) =>
    invoke<CompareResult>("get_compare_diff", { path, base, target }),
  getOperationState: (path: string) => invoke<OperationState>("get_operation_state", { path }),
  getConflictFile: (path: string, file: string) => invoke<ConflictFile>("get_conflict_file", { path, file }),
  saveResolvedFile: (path: string, file: string, content: string, resolveAsDeletion = false) =>
    invoke<OperationState>("save_resolved_file", { path, file, content, resolveAsDeletion }),
  continueOperation: (path: string) => invoke<string>("continue_operation", { path }),
  abortOperation: (path: string) => invoke<string>("abort_operation", { path }),
  discardFiles: (path: string, paths: string[]) => invoke<string>("discard_files", { path, paths }),
  deleteUntrackedFiles: (path: string, paths: string[]) => invoke<string>("delete_untracked_files", { path, paths }),
  openPath: (path: string, file: string) => invoke<void>("open_path", { path, file }),
  revealPath: (path: string, file?: string) => invoke<void>("reveal_path", { path, file }),
  prepareInteractiveRebase: (path: string, oid: string) =>
    invoke<RebasePlan>("prepare_interactive_rebase", { path, oid }),
  startInteractiveRebase: (path: string, onto: string, originalHead: string, entries: RebaseTodoEntry[]) =>
    invoke<string>("start_interactive_rebase", { path, onto, originalHead, entries }),
};

let logRequestId = 0;
export function nextLogRequestId(): number {
  logRequestId += 1;
  return logRequestId;
}

/** 订阅日志流；回调内按 requestId 过滤过期批次。 */
export function onLogBatch(handler: (batch: LogBatch) => void) {
  return listen<LogBatch>("log-batch", (event) => handler(event.payload));
}

export function formatDate(seconds: number): string {
  const d = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
