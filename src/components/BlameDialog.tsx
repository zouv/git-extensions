import Dialog from "../ui/Dialog";
import BlameView from "./BlameView";

interface Props {
  repoPath: string;
  file: string;
  oid?: string;
  onClose: () => void;
  onOpenCommit?: (oid: string) => void;
}

export default function BlameDialog({ repoPath, file, oid, onClose, onOpenCommit }: Props) {
  return <Dialog title={`Blame · ${file}`} onClose={onClose} wide footer={<button onClick={onClose}>关闭</button>}>
    <BlameView repoPath={repoPath} file={file} oid={oid} onOpenCommit={onOpenCommit} />
  </Dialog>;
}
