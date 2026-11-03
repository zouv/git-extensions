import type { ConflictDraft, ConflictFile, FileDiff } from "./types";
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
