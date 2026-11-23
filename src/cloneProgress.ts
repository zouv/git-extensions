/** 克隆进度输出的解析与归并（纯函数，供 CloneDialog 与单测复用）。 */
export interface CloneStatus {
  phase: string | null;
  percent: number | null;
}

/** 输出面板最多保留的行数；进度归并后仍按此上限截断。 */
export const MAX_CLONE_LOG_LINES = 400;

/** 解析 `Receiving objects: 45% (...)` 一类的 git --progress 输出。 */
export function parseCloneProgress(line: string): CloneStatus | null {
  const cleaned = line.replace(/^remote:\s*/i, "").trim();
  const match = cleaned.match(/^([^:]{1,40}):\s*(\d{1,3})%/);
  if (!match) return null;
  const percent = Number(match[2]);
  if (!Number.isFinite(percent)) return null;
  return { phase: match[1], percent: Math.max(0, Math.min(100, percent)) };
}

/**
 * 追加一行克隆输出。连续的同阶段进度（如 `Resolving deltas: 25%` → `33%`）
 * 只保留最新一条，避免每个百分比各占一行；其它输出原样追加。
 */
export function appendCloneLogLine(lines: readonly string[], line: string): string[] {
  const next = parseCloneProgress(line);
  if (next) {
    const last = lines[lines.length - 1];
    const previous = last === undefined ? null : parseCloneProgress(last);
    if (previous && previous.phase === next.phase) return [...lines.slice(0, -1), line];
  }
  return [...lines.slice(-(MAX_CLONE_LOG_LINES - 1)), line];
}