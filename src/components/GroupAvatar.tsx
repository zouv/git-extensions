import { fallbackGroupColor } from "../repoGroups";
import type { RepoGroupColor } from "../repoGroups";

/** 组名 → 飞书群聊风格缩写图标：英文取单词首字母（≤2），中文取前 2 字。 */
export function groupAbbreviation(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  // 含 CJK：取前 2 个字符（中日韩表意文字单字信息量大）。
  const chars = [...trimmed];
  if (chars.some((c) => /[一-鿿぀-ヿ가-힯]/.test(c))) return chars.slice(0, 2).join("");
  const words = trimmed.split(/[\s\-_\\/]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  // 单词：仅在含驼峰大写边界时拆分取首字母，否则取前两个字符（版本号等不拆）。
  if (/[a-z0-9][A-Z]/.test(trimmed)) {
    const camel = trimmed.match(/[A-Z][a-z0-9]*|[a-z0-9]+/g);
    if (camel && camel.length >= 2) return (camel[0][0] + camel[1][0]).toUpperCase();
  }
  return chars.slice(0, 2).join("").toUpperCase();
}

function textColor(background: string): string {
  const [r, g, b] = [1, 3, 5].map((start) => Number.parseInt(background.slice(start, start + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#11151b" : "#fff";
}

export default function GroupAvatar({ id, name, color, size = 22, active = false }: { id: string; name: string; color?: RepoGroupColor; size?: number; active?: boolean }) {
  const background = color ?? fallbackGroupColor(id);
  return (
    <span
      className={`group-avatar${active ? " active" : ""}`}
      style={{ width: size, height: size, background, color: textColor(background), fontSize: Math.max(9, Math.round(size * 0.42)) }}
      aria-hidden="true"
    >
      {groupAbbreviation(name)}
    </span>
  );
}
