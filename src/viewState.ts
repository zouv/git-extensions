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
