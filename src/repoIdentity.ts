/** 仓库身份视觉：缩写、稳定色与重名后缀。纯函数，便于 Node 测试。 */

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/;
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;

/** 12 个低饱和固定色，保证白色 8px 文字与暗色主题的对比度。 */
const REPO_AVATAR_COLORS = [
  "#3f6fbf", "#5a5fc0", "#8a4fbf", "#b04a86",
  "#b84a55", "#a85a32", "#8c6a2f", "#5e7a2e",
  "#3b7a4f", "#2f7a70", "#2f6e8c", "#4a5f8c",
] as const;

function identityChars(value: string): string[] {
  return [...value.trim()].filter((char) => LETTER_OR_NUMBER.test(char));
}

/** 仓库名 → 2 字缩写：CJK 取前 2 字，英文取词首 / 驼峰首字母，否则前 2 字符。 */
export function abbreviation(name: string): string {
  const chars = identityChars(name);
  if (chars.length === 0) return "?";
  if (chars.some((char) => CJK.test(char))) return chars.slice(0, 2).join("");
  const trimmed = name.trim();
  const words = trimmed.split(/[\s\-_\\/]+/).filter(Boolean);
  if (words.length >= 2) {
    const initials = words.map((word) => identityChars(word)[0]).filter(Boolean);
    if (initials.length >= 2) return (initials[0] + initials[1]).toUpperCase();
  }
  if (/[a-z0-9][A-Z]/.test(trimmed)) {
    const camel = trimmed.match(/[A-Z][a-z0-9]*|[a-z0-9]+/g);
    if (camel && camel.length >= 2) return (camel[0][0] + camel[1][0]).toUpperCase();
  }
  return chars.slice(0, 2).join("").toUpperCase();
}

/** 按背景亮度选择深色或白色文字；与 GroupAvatar 原有规则一致。 */
export function avatarTextColor(background: string): string {
  const hex = background.replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return "#fff";
  const [r, g, b] = [0, 2, 4].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#11151b" : "#fff";
}

function hashPath(path: string): number {
  // Windows 路径大小写与分隔符不影响同一仓库的身份色。
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 路径稳定色：改别名、重启应用后颜色不变；同名仓库也能得到不同颜色。 */
export function repoAvatarColor(path: string): string {
  return REPO_AVATAR_COLORS[hashPath(path) % REPO_AVATAR_COLORS.length];
}

function pathParts(path: string): string[] {
  return path.trim().replace(/\\/g, "/").split("/").filter(Boolean);
}

function parentSegments(path: string, depth: number): string {
  const parts = pathParts(path);
  return parts.slice(Math.max(0, parts.length - 1 - depth), parts.length - 1).join("/");
}

/** 显示名重复时追加父目录后缀；仍重复则继续向上一层，最后用序号兜底。 */
export function disambiguateLabels<T extends { path: string }>(
  repos: T[],
  labelOf: (repo: T) => string,
): Record<string, string> {
  const grouped = new Map<string, T[]>();
  for (const repo of repos) {
    const label = labelOf(repo);
    const list = grouped.get(label);
    if (list) list.push(repo);
    else grouped.set(label, [repo]);
  }

  const result: Record<string, string> = {};
  for (const [label, group] of grouped) {
    if (group.length === 1) {
      result[group[0].path] = label;
      continue;
    }
    const maxDepth = Math.max(1, ...group.map((repo) => pathParts(repo.path).length - 1));
    let depth = 1;
    let suffixes = group.map((repo) => parentSegments(repo.path, depth));
    while (depth < maxDepth && new Set(suffixes).size < group.length) {
      depth += 1;
      suffixes = group.map((repo) => parentSegments(repo.path, depth));
    }
    if (new Set(suffixes).size < group.length) {
      suffixes = group.map((repo, index) => `${parentSegments(repo.path, depth) || "?"}#${index + 1}`);
    }
    group.forEach((repo, index) => {
      result[repo.path] = `${label}（${suffixes[index] || `#${index + 1}`}）`;
    });
  }
  return result;
}
