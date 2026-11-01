/** 组名 → 飞书群聊风格缩写图标：英文取单词首字母（≤2），中文取前 2 字，按组 id 哈希配色。 */

const PALETTE = [
  "#3370ff", "#34c759", "#ff8800", "#f54a45", "#7f3bf5",
  "#14c0ff", "#00d6b9", "#ffc60a", "#ff66a1", "#646a73",
];

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

export function groupColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export default function GroupAvatar({ id, name, size = 22, active = false }: { id: string; name: string; size?: number; active?: boolean }) {
  return (
    <span
      className={`group-avatar${active ? " active" : ""}`}
      style={{ width: size, height: size, background: groupColor(id), fontSize: Math.max(9, Math.round(size * 0.42)) }}
      aria-hidden="true"
    >
      {groupAbbreviation(name)}
    </span>
  );
}
