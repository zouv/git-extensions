import { useCallback, useEffect, useState } from "react";
import { api, formatDate } from "../api";
import type { CommandLogEntry } from "../types";
import Dialog from "../ui/Dialog";
import Icon from "../ui/Icon";

interface Props {
  repoPath: string;
  onClose: () => void;
}

export default function CommandLogDialog({ repoPath, onClose }: Props) {
  const [entries, setEntries] = useState<CommandLogEntry[]>([]);
  const [onlyCurrentRepo, setOnlyCurrentRepo] = useState(true);
  const [selected, setSelected] = useState<number>(0);

  const load = useCallback(async () => {
    const list = await api.getCommandLog(onlyCurrentRepo ? repoPath : undefined);
    setEntries(list);
    setSelected(0);
  }, [onlyCurrentRepo, repoPath]);

  useEffect(() => { void load(); }, [load]);

  const current = entries[selected] ?? null;

  return (
    <Dialog
      title="Git 命令执行日志"
      wide
      onClose={onClose}
      footer={<>
        <label className="force-label">
          <input type="checkbox" checked={onlyCurrentRepo} onChange={(e) => setOnlyCurrentRepo(e.target.checked)} />
          仅显示当前仓库
        </label>
        <button onClick={() => void load()}><Icon name="refresh" />刷新</button>
        <button disabled={entries.length === 0} onClick={() => { void api.clearCommandLog().then(() => setEntries([])); }}>清空日志</button>
        <button className="primary" onClick={onClose}>关闭</button>
      </>}
    >
      <div className="command-log-list" role="listbox" aria-label="Git 命令记录">
        {entries.map((entry, idx) => (
          <div
            key={`${entry.timestamp}-${idx}`}
            role="option"
            aria-selected={idx === selected}
            className={`branch-item command-log-row${idx === selected ? " selected" : ""}${entry.success ? "" : " command-failed"}`}
            tabIndex={0}
            onClick={() => setSelected(idx)}
          >
            <span className="mono">
              <span className={entry.success ? "status-added" : "status-deleted"}>{entry.success ? "✓" : `✗ (${entry.exitCode ?? "?"})`}</span>{" "}
              git {entry.args.join(" ")}
            </span>
            <span className="branch-oid">{entry.durationMs} ms · {formatDate(entry.timestamp)}</span>
          </div>
        ))}
        {entries.length === 0 && <div className="panel-hint">暂无已记录的 Git CLI 命令。</div>}
      </div>
      {current && (
        <div className="command-log-detail">
          <div className="branch-actions">
            <code className="mono">git {current.args.join(" ")}</code>
            <button onClick={() => { void navigator.clipboard?.writeText(`git ${current.args.join(" ")}`); }}>复制命令</button>
          </div>
          {current.stderr && <pre className="git-output">{current.stderr}</pre>}
        </div>
      )}
    </Dialog>
  );
}
