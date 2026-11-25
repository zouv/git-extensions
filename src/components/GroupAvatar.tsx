import { fallbackGroupColor } from "../repoGroups";
import type { RepoGroupColor } from "../repoGroups";
import { abbreviation, avatarTextColor } from "../repoIdentity";

/** 组名 → 飞书群聊风格缩写图标：英文取单词首字母（≤2），中文取前 2 字。 */
export const groupAbbreviation = abbreviation;

export default function GroupAvatar({ id, name, color, badge, size = 22, active = false }: { id: string; name: string; color?: RepoGroupColor; badge?: string; size?: number; active?: boolean }) {
  const background = color ?? fallbackGroupColor(id);
  const text = badge?.trim() || groupAbbreviation(name);
  return (
    <span
      className={`group-avatar${active ? " active" : ""}`}
      style={{ width: size, height: size, background, color: avatarTextColor(background), fontSize: Math.max(9, Math.round(size * 0.42)) }}
      aria-hidden="true"
    >
      {text}
    </span>
  );
}
