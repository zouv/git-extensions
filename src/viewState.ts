import type { BranchInfo, ConflictDraft, ConflictFile, FileDiff, RebaseTodoEntry } from "./types";
export type DiffLineKind = "add" | "del" | "hunk" | "meta" | "ctx";
export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("@@")) return "hunk";
  if (/^(diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename |copy |old mode|new mode)/.test(line)) return "meta";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
}
export function restoreConflictDraft(file: ConflictFile, draft?: ConflictDraft) {
  return {
    source: draft?.file ?? file,
    result: draft?.result ?? file.worktree ?? file.ours ?? file.theirs ?? "",
    resolveAsDeletion: draft?.resolveAsDeletion ?? false,
    dirty: !!draft,
    stale: !!draft && JSON.stringify(draft.file) !== JSON.stringify(file),
  };
}
export function selectedFileIndex(files: FileDiff[], path: string | null): number {
  const index = files.findIndex((file) => file.path === path);
  return index < 0 ? 0 : index;
}

export function diffWindow(lineCount: number, scrollTop: number, viewportHeight: number, lineHeight = 20) {
  const visible = Math.max(1, Math.ceil(viewportHeight / lineHeight));
  const top = Math.max(0, Math.min(Math.floor(scrollTop / lineHeight), lineCount - visible));
  return { start: Math.max(0, top - 5), end: Math.min(lineCount, top + visible + 5) };
}

export function hasSessionDrafts(currentDirty: boolean, conflictDraftCount: number, rebaseDraftCount: number): boolean {
  return currentDirty || conflictDraftCount > 0 || rebaseDraftCount > 0;
}

export type PatchLineKind = DiffLineKind | "note";

export interface PatchLine {
  kind: PatchLineKind;
  /** 原始 patch 行（含 +/-/空格前缀或 meta/hunk 原文）。 */
  text: string;
  /** 去掉前缀后的内容，用于语法高亮。 */
  content: string;
  /** 在解析后的行数组中的下标，作为高亮结果的键。 */
  sourceIndex: number;
  hunkIndex: number | null;
  oldLine: number | null;
  newLine: number | null;
}

export interface HunkInfo {
  index: number;
  row: number;
  header: string;
  oldStart: number;
  newStart: number;
}

export interface ParsedPatch {
  lines: PatchLine[];
  hunks: HunkInfo[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** 解析 unified patch：补齐新旧行号、hunk 归属与高亮索引；末尾空行不生成幽灵行。 */
export function parsePatch(patch: string): ParsedPatch {
  const raw = patch.split("\n");
  if (raw.length > 0 && raw[raw.length - 1] === "") raw.pop();
  const lines: PatchLine[] = [];
  const hunks: HunkInfo[] = [];
  let hunkIndex = -1;
  let oldLine = 0;
  let newLine = 0;
  for (const text of raw) {
    const sourceIndex = lines.length;
    const kind = classifyDiffLine(text);
    if (kind === "hunk") {
      hunkIndex += 1;
      const match = HUNK_HEADER.exec(text);
      oldLine = match ? Number(match[1]) : 0;
      newLine = match ? Number(match[2]) : 0;
      lines.push({ kind: "hunk", text, content: text, sourceIndex, hunkIndex, oldLine: null, newLine: null });
      hunks.push({ index: hunkIndex, row: sourceIndex, header: text, oldStart: oldLine, newStart: newLine });
      continue;
    }
    if (kind === "meta") {
      lines.push({ kind: "meta", text, content: text, sourceIndex, hunkIndex: null, oldLine: null, newLine: null });
      continue;
    }
    if (text.startsWith("\\")) {
      lines.push({ kind: "note", text, content: text, sourceIndex, hunkIndex: hunkIndex >= 0 ? hunkIndex : null, oldLine: null, newLine: null });
      continue;
    }
    const hunk = hunkIndex >= 0 ? hunkIndex : null;
    if (kind === "add") {
      lines.push({ kind: "add", text, content: text.slice(1), sourceIndex, hunkIndex: hunk, oldLine: null, newLine: newLine++ });
    } else if (kind === "del") {
      lines.push({ kind: "del", text, content: text.slice(1), sourceIndex, hunkIndex: hunk, oldLine: oldLine++, newLine: null });
    } else {
      lines.push({ kind: "ctx", text, content: text.startsWith(" ") ? text.slice(1) : text, sourceIndex, hunkIndex: hunk, oldLine: oldLine++, newLine: newLine++ });
    }
  }
  return { lines, hunks };
}

export type InlineRow =
  | { kind: "line"; line: PatchLine }
  | { kind: "fold"; count: number; runId: string; hunkIndex: number | null };

export type SplitRow =
  | { kind: "whole"; line: PatchLine }
  | { kind: "pair"; left: PatchLine | null; right: PatchLine | null }
  | { kind: "fold"; count: number; runId: string; hunkIndex: number | null };

const CONTEXT_FOLD_MIN = 2;

/** Inline 视图：把连续未修改行折叠为一个可展开行。 */
export function buildInlineRows(lines: readonly PatchLine[], collapse: boolean, expanded: ReadonlySet<string>): InlineRow[] {
  const rows: InlineRow[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.kind !== "ctx") {
      rows.push({ kind: "line", line });
      index += 1;
      continue;
    }
    const start = index;
    while (index < lines.length && lines[index].kind === "ctx" && lines[index].hunkIndex === line.hunkIndex) index += 1;
    const run = lines.slice(start, index);
    const runId = `inline-${run[0].sourceIndex}`;
    if (collapse && run.length >= CONTEXT_FOLD_MIN && !expanded.has(runId)) {
      rows.push({ kind: "fold", count: run.length, runId, hunkIndex: line.hunkIndex });
    } else {
      for (const item of run) rows.push({ kind: "line", line: item });
    }
  }
  return rows;
}

/** Split 视图：同一变更组内删除 / 新增按行配对，未修改行左右同时显示。 */
export function buildSplitRows(lines: readonly PatchLine[], collapse: boolean, expanded: ReadonlySet<string>): SplitRow[] {
  const rows: SplitRow[] = [];
  let index = 0;
  const pushChanges = (deletions: PatchLine[], additions: PatchLine[]) => {
    const count = Math.max(deletions.length, additions.length);
    for (let i = 0; i < count; i += 1) {
      rows.push({ kind: "pair", left: deletions[i] ?? null, right: additions[i] ?? null });
    }
  };
  while (index < lines.length) {
    const line = lines[index];
    if (line.kind !== "del" && line.kind !== "add" && line.kind !== "ctx") {
      rows.push({ kind: "whole", line });
      index += 1;
      continue;
    }
    let deletions: PatchLine[] = [];
    let additions: PatchLine[] = [];
    while (index < lines.length) {
      const current = lines[index];
      if (current.kind === "del") { deletions.push(current); index += 1; continue; }
      if (current.kind === "add") { additions.push(current); index += 1; continue; }
      if (current.kind === "ctx") {
        pushChanges(deletions, additions);
        deletions = [];
        additions = [];
        const start = index;
        while (index < lines.length && lines[index].kind === "ctx") index += 1;
        const run = lines.slice(start, index);
        const runId = `split-${run[0].sourceIndex}`;
        if (collapse && run.length >= CONTEXT_FOLD_MIN && !expanded.has(runId)) {
          rows.push({ kind: "fold", count: run.length, runId, hunkIndex: run[0].hunkIndex });
        } else {
          for (const item of run) rows.push({ kind: "pair", left: item, right: item });
        }
        continue;
      }
      break;
    }
    pushChanges(deletions, additions);
  }
  return rows;
}

/** 显示行是否为 hunk 头（用于上一处 / 下一处差异定位）。 */
export function isHunkRow(row: InlineRow | SplitRow): boolean {
  return (row.kind === "line" && row.line.kind === "hunk") || (row.kind === "whole" && row.line.kind === "hunk");
}

/**
 * 从单文件 unified diff 中提取单个 hunk 的完整可应用补丁（供 `git apply --cached` / `-R` 使用）。
 */
export function extractHunkPatch(file: FileDiff, hunkIndex: number): string | null {
  const parsed = parsePatch(file.patch);
  if (hunkIndex < 0 || hunkIndex >= parsed.hunks.length) return null;
  const hunkLines = parsed.lines.filter((line) => line.hunkIndex === hunkIndex);
  if (hunkLines.length === 0) return null;
  const metaLines = parsed.lines.filter((line) => line.kind === "meta").map((line) => line.text);
  const oldPath = file.oldPath ?? file.path;
  const newPath = file.path;
  const headers: string[] = [];
  if (metaLines.some((line) => line.startsWith("--- ")) && metaLines.some((line) => line.startsWith("+++ "))) {
    if (!metaLines.some((line) => line.startsWith("diff "))) {
      headers.push(`diff --git a/${oldPath} b/${newPath}`);
    }
    headers.push(...metaLines);
  } else {
    headers.push(`diff --git a/${oldPath} b/${newPath}`);
    if (file.status === "added" || file.status === "new") {
      headers.push("--- /dev/null");
      headers.push(`+++ b/${newPath}`);
    } else if (file.status === "deleted") {
      headers.push(`--- a/${oldPath}`);
      headers.push("+++ /dev/null");
    } else {
      headers.push(`--- a/${oldPath}`);
      headers.push(`+++ b/${newPath}`);
    }
  }
  return `${[...headers, ...hunkLines.map((line) => line.text)].join("\n")}\n`;
}

export interface BranchTreeFolder {
  kind: "folder";
  name: string;
  prefix: string;
  count: number;
  children: BranchTreeNode[];
}

export interface BranchTreeLeaf {
  kind: "branch";
  label: string;
  branch: BranchInfo;
}

export type BranchTreeNode = BranchTreeFolder | BranchTreeLeaf;

/**
 * 将按 `/` 分层的分支列表转换为可折叠的树结构（例如 `feature/auth` -> `feature` 文件夹）。
 */
export function buildBranchTree(branches: readonly BranchInfo[]): BranchTreeNode[] {
  interface MutableFolder {
    name: string;
    prefix: string;
    folders: Map<string, MutableFolder>;
    leaves: BranchTreeLeaf[];
    count: number;
  }
  const root: MutableFolder = { name: "", prefix: "", folders: new Map(), leaves: [], count: 0 };
  for (const branch of branches) {
    const parts = branch.name.split("/").filter(Boolean);
    if (parts.length <= 1) {
      root.leaves.push({ kind: "branch", label: branch.name, branch });
      root.count += 1;
      continue;
    }
    let current = root;
    let prefix = "";
    for (let i = 0; i < parts.length - 1; i += 1) {
      const seg = parts[i];
      prefix = prefix ? `${prefix}/${seg}` : seg;
      let folder = current.folders.get(seg);
      if (!folder) {
        folder = { name: seg, prefix, folders: new Map(), leaves: [], count: 0 };
        current.folders.set(seg, folder);
      }
      folder.count += 1;
      current = folder;
    }
    current.leaves.push({ kind: "branch", label: parts[parts.length - 1], branch });
  }
  const toNodes = (folder: MutableFolder): BranchTreeNode[] => {
    const subFolders: BranchTreeFolder[] = Array.from(folder.folders.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((sub) => ({
        kind: "folder",
        name: sub.name,
        prefix: sub.prefix,
        count: sub.count,
        children: toNodes(sub),
      }));
    const leaves = [...folder.leaves].sort((a, b) => a.label.localeCompare(b.label));
    return [...subFolders, ...leaves];
  };
  return toNodes(root);
}

/**
 * Rebase 计划自动重排（Autosquash）：识别 `fixup! <target>` 与 `squash! <target>`，
 * 将其移动到对应目标提交之后并自动设置动作为 `fixup` / `squash`。
 */
export function applyAutosquashOrder(entries: readonly RebaseTodoEntry[]): RebaseTodoEntry[] {
  const parseDirective = (subject: string): { action: "fixup" | "squash"; target: string } | null => {
    if (subject.startsWith("fixup! ")) {
      const target = subject.slice("fixup! ".length).trim();
      return target ? { action: "fixup", target } : null;
    }
    if (subject.startsWith("squash! ")) {
      const target = subject.slice("squash! ".length).trim();
      return target ? { action: "squash", target } : null;
    }
    return null;
  };
  const normal: RebaseTodoEntry[] = [];
  const attached = new Map<string, RebaseTodoEntry[]>();
  const unmatched: RebaseTodoEntry[] = [];

  for (const entry of entries) {
    const dir = parseDirective(entry.subject);
    if (!dir) {
      normal.push({ ...entry });
      continue;
    }
    const targetCommit = entries.find(
      (candidate) =>
        candidate.oid !== entry.oid &&
        !parseDirective(candidate.subject) &&
        (candidate.subject === dir.target ||
          candidate.subject.startsWith(dir.target) ||
          candidate.oid.startsWith(dir.target)),
    );
    if (targetCommit) {
      const list = attached.get(targetCommit.oid) ?? [];
      list.push({ ...entry, action: dir.action });
      attached.set(targetCommit.oid, list);
    } else {
      unmatched.push({ ...entry });
    }
  }

  const result: RebaseTodoEntry[] = [];
  for (const item of normal) {
    result.push(item);
    const followups = attached.get(item.oid);
    if (followups) {
      result.push(...followups);
    }
  }
  result.push(...unmatched);
  return result;
}

