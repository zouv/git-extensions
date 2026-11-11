export interface RepoInfo {
  path: string;
  name: string;
  headBranch: string | null;
  headOid: string | null;
  isEmpty: boolean;
}

export interface BranchInfo {
  name: string;
  isHead: boolean;
  isRemote: boolean;
  oid: string;
}

export interface BranchDeleteStatus {
  name: string;
  exists: boolean;
  merged: boolean;
}

export interface RefLabel {
  name: string;
  kind: "head" | "branch" | "remote" | "tag" | "stash" | string;
}

export interface Revision {
  oid: string;
  shortId: string;
  parents: string[];
  authorName: string;
  authorTime: number;
  subject: string;
  refs: RefLabel[];
  lane: number;
  parentLanes: number[];
  mergedLanes: number[];
  activeLanes: boolean[];
}

export interface LogBatch {
  requestId: number;
  revisions: Revision[];
  done: boolean;
  error: string | null;
}

export interface CommitDetail {
  oid: string;
  shortId: string;
  authorName: string;
  authorEmail: string;
  authorTime: number;
  committerName: string;
  committerTime: number;
  message: string;
  parents: string[];
}

export interface FileDiff {
  path: string;
  oldPath: string | null;
  status: string;
  isBinary: boolean;
  truncated: boolean;
  patch: string;
}

export interface StatusEntry {
  path: string;
  oldPath: string | null;
  status: string;
}

export interface StatusSnapshot {
  staged: StatusEntry[];
  unstaged: StatusEntry[];
}

export interface AheadBehind {
  ahead: number;
  behind: number;
}

export interface StashInfo {
  name: string;
  oid: string;
  message: string;
}

export interface ContainedInfo {
  branches: string[];
  tags: string[];
  describe: string | null;
}

export interface TagInfo {
  name: string;
  oid: string;
  subject: string;
}

export interface SubmoduleInfo {
  path: string;
  oid: string;
  status: string;
}

export interface WorktreeInfo {
  name: string;
  path: string;
  locked: boolean;
}

export interface BlameLine {
  oid: string;
  shortId: string;
  author: string;
  time: number;
  line: number;
  content: string;
}

export interface FileLogEntry {
  filePath: string;
  oid: string;
  shortId: string;
  authorName: string;
  authorTime: number;
  subject: string;
}

export interface ScopedHistoryEntry {
  oid: string;
  shortId: string;
  authorName: string;
  authorTime: number;
  subject: string;
}

export interface ExplorerTarget {
  repo: RepoInfo;
  scope: "repository" | "directory" | "file";
  relativePath: string | null;
}

export interface CommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type WindowRole = "main" | "explorer";
export interface WindowBootstrap {
  kind: WindowRole;
  requests: LaunchRequest[];
}

export interface CompareResult {
  baseOid: string;
  targetOid: string;
  files: FileDiff[];
}

export type OperationKind = "none" | "merge" | "cherryPick" | "revert" | "rebase" | "bisect" | "applyPatch";

export interface RemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface CommandLogEntry {
  timestamp: number;
  repoPath: string;
  args: string[];
  durationMs: number;
  exitCode: number | null;
  success: boolean;
  stderr: string;
}

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
}

export type MergeMode = "default" | "no-ff" | "ff-only" | "squash";
export type PullMode = "default" | "rebase" | "ff-only" | "no-ff";

export interface OperationState {
  kind: OperationKind;
  interactive: boolean;
  current: number | null;
  total: number | null;
  onto: string | null;
  source: string | null;
  headName: string | null;
  conflicts: string[];
}

export interface ConflictFile {
  path: string;
  base: string | null;
  ours: string | null;
  theirs: string | null;
  worktree: string | null;
  oursLabel: string;
  theirsLabel: string;
  truncated: boolean;
  binary: boolean;
}

export type RebaseAction = "pick" | "reword" | "squash" | "fixup" | "drop";

export interface RebaseTodoEntry {
  oid: string;
  shortId: string;
  subject: string;
  message: string;
  action: RebaseAction;
}

export interface RebasePlan {
  onto: string;
  originalHead: string;
  branch: string;
  entries: RebaseTodoEntry[];
}

export interface PushInfo {
  branch: string;
  branchRef: string;
  headOid: string;
  hasUpstream: boolean;
  upstream: string | null;
  remotes: string[];
}

export type ResetMode = "soft" | "mixed" | "hard";
export interface ResetPreview {
  branch: string; headOid: string; targetOid: string; targetSubject: string; mode: ResetMode;
  fingerprint: string; staged: number; unstaged: number; untracked: number;
  affectedFiles: string[]; commitsToLeave: number; countLimited: boolean; blockedPaths: string[];
}
export interface ResetResult { backupRef: string; previousHead: string; newHead: string; output: string }
export interface RecoveryEntry { oid: string; label: string; time: number; backupRef: string | null }

export interface ConflictDraft { file: ConflictFile; result: string; resolveAsDeletion: boolean }
export interface RebaseDraft { plan: RebasePlan; entries: RebaseTodoEntry[]; dirty: boolean }

export type ExplorerAction = "clone" | "create-repository" | "commit" | "open-repository" | "pull" | "push" | "view-stash" | "view-changes" | "checkout-branch" | "checkout-revision" | "create-branch" | "open-with-difftool" | "file-history" | "reset-file-changes" | "add-files" | "apply-patch" | "settings" | "repository-settings" | "view-files" | "rename";
export type ExplorerMenuPlacement = "top" | "cascade" | "others" | "hidden";
export type ExplorerMenuPlacements = Record<ExplorerAction, ExplorerMenuPlacement>;
export interface ExplorerMenuItem { action: ExplorerAction; placement: ExplorerMenuPlacement }
export interface LaunchRequest { action: ExplorerAction; path: string | null }
export type WorkspaceLaunchAction = Exclude<ExplorerAction, "clone" | "create-repository" | "open-repository" | "settings" | "repository-settings" | "view-files" | "rename">;
export interface WorkspaceLaunchRequest { id: number; action: WorkspaceLaunchAction }
export interface ExplorerIntegrationInfo { supported: boolean }
export interface CloneProgress { operationId: string; line: string }
export interface PatchPreview { patchOid: string; summary: string }
export interface FileContent { content: string; binary: boolean; truncated: boolean; size: number }
export interface PatchFileInfo { path: string; name: string; subject: string; author: string; date: string; mailbox: boolean }
export interface PatchApplyState { inProgress: boolean; conflicts: string[] }
