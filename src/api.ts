import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { runRepoWrite } from "./repoOperations";
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
  WorktreeInfo,
  TagInfo,
  CompareResult,
  OperationState,
  ConflictFile,
  RebasePlan,
  PushInfo,
  ResetMode, ResetPreview, ResetResult, RecoveryEntry,
  ExplorerIntegrationInfo, LaunchRequest, PatchPreview, ExplorerMenuItem,
  WindowBootstrap, ExplorerTarget, ScopedHistoryEntry, CommandOutput,
} from "./types";

// 只合并仍在途的同参数读取，不缓存工作区结果。
const pendingReads = new Map<string, Promise<unknown>>();
function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const key = JSON.stringify([command, args]);
  const pending = pendingReads.get(key);
  if (pending) return pending as Promise<T>;
  const request = tauriInvoke<T>(command, args);
  pendingReads.set(key, request);
  const release = () => { if (pendingReads.get(key) === request) pendingReads.delete(key); };
  void request.then(release, release);
  return request;
}

function writeInvoke<T>(command: string, args: { path: string; [key: string]: unknown }): Promise<T> {
  return runRepoWrite(args.path, command, () => tauriInvoke<T>(command, args));
}

export const api = {
  openRepo: (path: string) => invoke<RepoInfo>("open_repo", { path }),
  getBranches: (path: string) => invoke<BranchInfo[]>("get_branches", { path }),
  startLog: (path: string, requestId: number, maxCount?: number, revspec?: string | null) =>
    invoke<void>("start_log", { path, requestId, maxCount, revspec }),
  cancelLog: (path: string, requestId: number) => invoke<void>("cancel_log", { path, requestId }),
  reportFrontendState: (state: string) => invoke<void>("report_frontend_state", { state }),
  getCommit: (path: string, oid: string) =>
    invoke<CommitDetail>("get_commit", { path, oid }),
  getCommitDiff: (path: string, oid: string) =>
    invoke<FileDiff[]>("get_commit_diff", { path, oid }),
  getCommitFiles: (path: string, oid: string) => invoke<FileDiff[]>("get_commit_files", { path, oid }),
  getCommitFileDiff: (path: string, oid: string, file: string, oldFile?: string | null) => invoke<FileDiff[]>("get_commit_file_diff", { path, oid, file, oldFile }),
  getWorktreeFileDiff: (path: string, staged: boolean, file: string, oldFile?: string | null) => invoke<FileDiff[]>("get_worktree_file_diff", { path, staged, file, oldFile }),
  getWorktreeDiff: (path: string, staged: boolean) =>
    invoke<FileDiff[]>("get_worktree_diff", { path, staged }),
  getStatus: (path: string) => invoke<StatusSnapshot>("get_status", { path }),
  stageFiles: (path: string, paths: string[]) =>
    writeInvoke<string>("stage_files", { path, paths }),
  unstageFiles: (path: string, paths: string[]) =>
    writeInvoke<string>("unstage_files", { path, paths }),
  commit: (path: string, message: string) =>
    writeInvoke<string>("commit", { path, message }),
  createBranch: (path: string, name: string, startPoint?: string) =>
    writeInvoke<string>("create_branch", { path, name, startPoint }),
  checkoutBranch: (path: string, name: string) =>
    writeInvoke<string>("checkout_branch", { path, name }),
  deleteBranch: (path: string, name: string, force: boolean) =>
    writeInvoke<string>("delete_branch", { path, name, force }),
  getAheadBehind: (path: string) => invoke<AheadBehind | null>("get_ahead_behind", { path }),
  fetch: (path: string, remote?: string) => writeInvoke<string>("fetch", { path, remote }),
  pull: (path: string) => writeInvoke<string>("pull", { path }),
  pullWithOutput: (path: string) => writeInvoke<CommandOutput>("pull_with_output", { path }),
  getPushInfo: (path: string) => invoke<PushInfo>("get_push_info", { path }),
  push: (path: string, remote?: string, branch?: string, preview?: PushInfo) =>
    writeInvoke<string>("push", { path, remote, branch, expectedHead: preview?.headOid, expectedBranch: preview?.branchRef }),
  stashList: (path: string) => invoke<StashInfo[]>("stash_list", { path }),
  stashPush: (path: string, message: string, includeUntracked: boolean) =>
    writeInvoke<string>("stash_push", { path, message, includeUntracked }),
  stashApply: (path: string, name: string, pop: boolean, expectedOid?: string) =>
    writeInvoke<string>("stash_apply", { path, name, pop, expectedOid }),
  stashDrop: (path: string, name: string, expectedOid?: string) => writeInvoke<string>("stash_drop", { path, name, expectedOid }),
  cherryPick: (path: string, oid: string) => writeInvoke<string>("cherry_pick", { path, oid }),
  revert: (path: string, oid: string) => writeInvoke<string>("revert", { path, oid }),
  rebase: (path: string, onto: string) => writeInvoke<string>("rebase", { path, onto }),
  getContainedIn: (path: string, oid: string) =>
    invoke<ContainedInfo>("get_contained_in", { path, oid }),
  tagList: (path: string) => invoke<TagInfo[]>("tag_list", { path }),
  createTag: (path: string, name: string, oid?: string, message?: string) =>
    writeInvoke<string>("create_tag", { path, name, oid, message }),
  deleteTag: (path: string, name: string) => writeInvoke<string>("delete_tag", { path, name }),
  submoduleList: (path: string) => invoke<SubmoduleInfo[]>("submodule_list", { path }),
  submoduleUpdate: (path: string) => writeInvoke<string>("submodule_update", { path }),
  worktreeList: (path: string) => invoke<WorktreeInfo[]>("worktree_list", { path }),
  blameFile: (path: string, file: string, oid?: string) =>
    invoke<BlameLine[]>("blame_file", { path, file, oid }),
  fileLog: (path: string, file: string, maxCount?: number) =>
    invoke<FileLogEntry[]>("file_log", { path, file, maxCount }),
  getCompareFiles: (path: string, base: string, target: string) => invoke<CompareResult>("get_compare_files", { path, base, target }),
  getCompareFileDiff: (path: string, base: string, target: string, file: string, oldFile?: string | null) => invoke<FileDiff[]>("get_compare_file_diff", { path, base, target, file, oldFile }),
  getCompareDiff: (path: string, base: string, target: string) =>
    invoke<CompareResult>("get_compare_diff", { path, base, target }),
  getOperationState: (path: string) => invoke<OperationState>("get_operation_state", { path }),
  getConflictFile: (path: string, file: string) => invoke<ConflictFile>("get_conflict_file", { path, file }),
  saveResolvedFile: (path: string, file: string, content: string, resolveAsDeletion = false, expected?: ConflictFile) =>
    writeInvoke<OperationState>("save_resolved_file", { path, file, content, resolveAsDeletion, expected }),
  continueOperation: (path: string) => writeInvoke<string>("continue_operation", { path }),
  skipOperation: (path: string, expected: OperationState) => writeInvoke<string>("skip_operation", { path, expected }),
  abortOperation: (path: string) => writeInvoke<string>("abort_operation", { path }),
  discardFiles: (path: string, paths: string[]) => writeInvoke<string>("discard_files", { path, paths }),
  deleteUntrackedFiles: (path: string, paths: string[]) => writeInvoke<string>("delete_untracked_files", { path, paths }),
  openPath: (path: string, file: string) => invoke<void>("open_path", { path, file }),
  revealPath: (path: string, file?: string) => invoke<void>("reveal_path", { path, file }),
  getResetPreview: (path: string, target: string, mode: ResetMode) => invoke<ResetPreview>("get_reset_preview", { path, target, mode }),
  reset: (path: string, preview: ResetPreview) => writeInvoke<ResetResult>("reset", { path, preview }),
  getRecoveryEntries: (path: string) => invoke<RecoveryEntry[]>("get_recovery_entries", { path }),
  prepareInteractiveRebase: (path: string, oid: string) =>
    invoke<RebasePlan>("prepare_interactive_rebase", { path, oid }),
  startInteractiveRebase: (path: string, plan: RebasePlan) =>
    writeInvoke<string>("start_interactive_rebase", { path, plan }),
  getWindowBootstrap: () => invoke<WindowBootstrap>("get_window_bootstrap", {}),
  takePendingLaunches: () => invoke<LaunchRequest[]>("take_pending_launches", {}),
  showCurrentWindow: () => invoke<void>("show_current_window", {}),
  focusMainWindow: () => invoke<void>("focus_main_window", {}),
  openRepositoryInMain: (path: string) => invoke<void>("open_repository_in_main", { path }),
  resolveExplorerTarget: (path: string) => invoke<ExplorerTarget>("resolve_explorer_target", { path }),
  scopedHistory: (path: string, file: string | null, follow: boolean, maxCount = 500) =>
    invoke<ScopedHistoryEntry[]>("scoped_history", { path, file, follow, maxCount }),
  getExplorerIntegrationInfo: () => invoke<ExplorerIntegrationInfo>("get_explorer_integration_info", {}),
  setExplorerContextMenuEnabled: (enabled: boolean, items: ExplorerMenuItem[], alwaysShowAllCommands: boolean) =>
    invoke<void>("set_explorer_context_menu_enabled", { enabled, items, alwaysShowAllCommands }),
  cloneRepository: (path: string, url: string) => writeInvoke<string>("clone_repository", { path, url }),
  createRepository: (path: string) => writeInvoke<string>("create_repository", { path }),
  resolveRevision: (path: string, revision: string) => invoke<string>("resolve_revision", { path, revision }),
  checkoutRevision: (path: string, oid: string) => writeInvoke<string>("checkout_revision", { path, oid }),
  openDifftool: (path: string, file: string, staged: boolean) => invoke<string>("open_difftool", { path, file, staged }),
  listTrackedFiles: (path: string) => invoke<string[]>("list_tracked_files", { path }),
  previewPatch: (path: string, patchPath: string) => invoke<PatchPreview>("preview_patch", { path, patchPath }),
  applyPatch: (path: string, patchPath: string, expectedPatchOid: string) =>
    writeInvoke<string>("apply_patch", { path, patchPath, expectedPatchOid }),
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
