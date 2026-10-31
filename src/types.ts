export interface RepoInfo {
  path: string;
  name: string;
  headBranch: string | null;
  isEmpty: boolean;
}

export interface BranchInfo {
  name: string;
  isHead: boolean;
  isRemote: boolean;
  oid: string;
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

export interface BlameLine {
  oid: string;
  shortId: string;
  author: string;
  time: number;
  line: number;
  content: string;
}

export interface FileLogEntry {
  oid: string;
  shortId: string;
  authorName: string;
  authorTime: number;
  subject: string;
}
