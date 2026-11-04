import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import Dialog from "../ui/Dialog";

interface Props {
  repoPath: string;
  onClose: () => void;
  onSelect: (file: string) => void;
}

export default function TrackedFileDialog({ repoPath, onClose, onSelect }: Props) {
  const [files, setFiles] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.listTrackedFiles(repoPath).then((result) => { if (!cancelled) { setFiles(result); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(String(e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [repoPath]);
  const matches = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    return files.filter((file) => !query || file.toLocaleLowerCase().includes(query));
  }, [files, filter]);
  const visible = matches.slice(0, 500);
  return <Dialog title="选择仓库文件" onClose={onClose} footer={<button onClick={onClose}>取消</button>}>
    <div className="dialog-form file-picker">
      <input data-autofocus aria-label="过滤仓库文件" placeholder="输入路径过滤…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {loading && <div className="panel-hint">正在读取 tracked 文件…</div>}
      {error && <div className="inline-error" role="alert">{error}</div>}
      {!loading && !error && <div className="file-picker-list" role="listbox" aria-label="仓库文件">
        {visible.map((file) => <button role="option" aria-selected="false" key={file} onDoubleClick={() => onSelect(file)} onClick={() => onSelect(file)}>{file}</button>)}
        {matches.length === 0 && <div className="panel-hint">没有匹配的 tracked 文件。</div>}
      </div>}
      {matches.length > visible.length && <div className="settings-note">仅显示前 500 个匹配项，请继续输入以缩小范围。</div>}
    </div>
  </Dialog>;
}
