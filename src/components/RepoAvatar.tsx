import { abbreviation, avatarTextColor, repoAvatarColor } from "../repoIdentity";

/** 仓库页签的字母徽标：字母负责身份，路径色负责快速区分。 */
export default function RepoAvatar({ path, name, size = 18 }: { path: string; name: string; size?: number }) {
  const background = repoAvatarColor(path);
  return (
    <span
      className="repo-avatar"
      style={{
        width: size,
        height: size,
        background,
        color: avatarTextColor(background),
        fontSize: Math.max(7, Math.round(size * 0.46)),
      }}
      aria-hidden="true"
    >
      {abbreviation(name)}
    </span>
  );
}
