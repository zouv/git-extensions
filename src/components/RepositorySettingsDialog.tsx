import type { RepoInfo } from "../types";
import { RepositorySettingsContent } from "../explorer/RepositorySettingsWindow";
import Dialog from "../ui/Dialog";

interface Props {
  repo: RepoInfo;
  onClose: () => void;
  setMessage?: (message: string) => void;
}

/** Repository 菜单的仓库设置入口；内容与资源管理器轻量窗口共用。 */
export default function RepositorySettingsDialog({ repo, onClose, setMessage }: Props) {
  return <Dialog title="Repository settings" wide onClose={onClose} footer={<button onClick={onClose}>关闭</button>}>
    <RepositorySettingsContent repo={repo} setMessage={setMessage} />
  </Dialog>;
}
