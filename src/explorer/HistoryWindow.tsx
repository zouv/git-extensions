import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { CommitDetail, ContainedInfo, ExplorerTarget, FileContent, FileDiff, Revision, ScopedHistoryEntry } from "../types";
import CommitInfo from "../components/CommitInfo";
import DiffView from "../components/DiffView";
import BlameView from "../components/BlameView";
import RevisionGrid from "../components/RevisionGrid";
import type { RevisionAction } from "../components/RevisionGrid";
import ResetDialog from "../components/ResetDialog";
import { useConfirm } from "../ui/Confirm";
import { loadSettings } from "../settings";

interface Props {
  target: ExplorerTarget;
  onBusyChange: (busy: boolean) => void;
  /** view-changes 是只读 log/diff 窗口；file-history 还提供提交操作与 Blame。 */
  mode?: "file-history" | "view-changes";
}

export default function HistoryWindow({ target, onBusyChange, mode = "file-history" }: Props) {
  const readOnly = mode === "view-changes";
  const [tab, setTab] = useState<"commit" | "file" | "blame">("commit");
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [fileContentLoading, setFileContentLoading] = useState(false);
  const [fileContentError, setFileContentError] = useState("");
  const [entries, setEntries] = useState<ScopedHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [commit, setCommit] = useState<CommitDetail | null>(null);
  const [contained, setContained] = useState<ContainedInfo | null>(null);
  const [files, setFiles] = useState<FileDiff[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [localBusy, setBusy] = useState(false);
  const [highlightEnabled, setHighlightEnabled] = useState(true);
  const repoBusy = useRepoBusy(target.repo.path);
  const busy = localBusy || repoBusy;
  const confirm = useConfirm();
  const repoPath = target.repo.path;
  const follow = target.scope === "file";
  const reloadSequence = useRef(0);

  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  useEffect(() => { setHighlightEnabled(loadSettings().highlightEnabled); }, []);

  const reload = useCallback(async () => {
    const sequence = ++reloadSequence.current;
    setLoading(true); setError("");
    try {
      const next = await api.scopedHistory(repoPath, target.relativePath, follow, 1000);
      if (sequence !== reloadSequence.current) return;
      setEntries(next);
      setSelected((current) => next.some((entry) => entry.oid === current) ? current : next[0]?.oid ?? null);
    } catch (reason) {
      if (sequence === reloadSequence.current) setError(String(reason));
    } finally {
      if (sequence === reloadSequence.current) setLoading(false);
    }
  }, [follow, repoPath, target.relativePath]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!selected) { setCommit(null); setFiles([]); return; }
    let alive = true;
    setDetailLoading(true); setError("");
    Promise.all([
      api.getCommit(repoPath, selected),
      api.getCommitFiles(repoPath, selected),
      api.getContainedIn(repoPath, selected).catch(() => null),
    ]).then(([nextCommit, nextFiles, nextContained]) => {
      if (!alive) return;
      setCommit(nextCommit); setFiles(nextFiles); setContained(nextContained);
    }).catch((reason) => { if (alive) setError(String(reason)); })
      .finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [repoPath, selected]);

  useEffect(() => {
    if (tab !== "file" || target.scope !== "file" || !target.relativePath || !selected) {
      setFileContent(null);
      return;
    }
    let alive = true;
    setFileContentLoading(true);
    setFileContentError("");
    api.getFileContent(repoPath, target.relativePath, selected)
      .then((next) => { if (alive) setFileContent(next); })
      .catch((reason) => { if (alive) setFileContentError(String(reason)); })
      .finally(() => { if (alive) setFileContentLoading(false); });
    return () => { alive = false; };
  }, [tab, repoPath, target.scope, target.relativePath, selected]);

  const revisions = useMemo<Revision[]>(() => entries.map((entry, index) => ({
    oid: entry.oid,
    shortId: entry.shortId,
    parents: index + 1 < entries.length ? [entries[index + 1].oid] : [],
    authorName: entry.authorName,
    authorTime: entry.authorTime,
    subject: entry.subject,
    refs: entry.oid === target.repo.headOid ? [{ name: "HEAD", kind: "head" }] : [],
    lane: 0,
    parentLanes: index + 1 < entries.length ? [0] : [],
    mergedLanes: [],
    activeLanes: [true],
  })), [entries, target.repo.headOid]);

  const action = async (kind: RevisionAction, oid: string) => {
    if (busy || loading) return;
    if (kind === "diff") { setSelected(oid); return; }
    if (kind === "copy-sha") { await navigator.clipboard?.writeText(oid); return; }
    const revision = entries.find((entry) => entry.oid === oid);
    if (kind === "copy-subject") { await navigator.clipboard?.writeText(revision?.subject ?? ""); return; }
    if (kind === "reset") { setResetTarget(oid); return; }
    if (!["rebase", "cherry-pick", "revert"].includes(kind)) return;
    const descriptions: Record<string, string> = {
      rebase: "将当前分支 rebase 到该提交。执行前要求工作区干净，并会先备份原 HEAD。",
      "cherry-pick": "把该提交应用到当前分支。可能产生冲突。",
      revert: "在当前分支创建一个撤销该提交的新提交。",
    };
    const ok = await confirm({
      title: kind === "rebase" ? "确认 Rebase？" : kind === "cherry-pick" ? "确认 Cherry-pick？" : "确认 Revert？",
      body: <><p>{descriptions[kind]}</p><p className="mono">{oid.slice(0, 12)} {revision?.subject}</p></>,
      confirmLabel: "执行", danger: true, requireAck: true, ackLabel: "我已确认目标提交和当前分支",
    });
    if (!ok) return;
    setBusy(true); setError("");
    try {
      if (kind === "rebase") await api.rebase(repoPath, oid);
      else if (kind === "cherry-pick") await api.cherryPick(repoPath, oid);
      else await api.revert(repoPath, oid);
      await reload();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const scopeLabel = target.scope === "file" ? "文件" : target.scope === "directory" ? "目录" : "当前分支";
  const canBlame = target.scope === "file" && !!target.relativePath;
  const allowedActions: RevisionAction[] = readOnly
    ? ["diff", "copy-sha", "copy-subject"]
    : ["diff", "copy-sha", "copy-subject", "reset", "rebase", "cherry-pick", "revert"];
  const openMain = async () => {
    try { await api.openRepositoryInMain(repoPath); }
    catch (reason) { setError(`无法转到主窗口：${String(reason)}`); }
  };
  return <div className="history-window">
    <div className="history-toolbar">
      <div>
        <strong>{scopeLabel}</strong>
        <span className="muted">{target.relativePath ?? target.repo.headBranch ?? "HEAD"}</span>
      </div>
      <div className="history-toolbar-actions">
        {canBlame && <>
          <button className={tab === "commit" ? "active" : ""} disabled={loading || busy} onClick={() => setTab("commit")}>提交</button>
          <button className={tab === "file" ? "active" : ""} disabled={loading || busy} onClick={() => setTab("file")}>文件</button>
          <button className={tab === "blame" ? "active" : ""} disabled={loading || busy} onClick={() => setTab("blame")}>Blame</button>
        </>}
        <button disabled={loading || busy} onClick={() => void reload()}>刷新</button>
      </div>
    </div>
    {error && <div className="inline-error history-error" role="alert">{error}
      <button onClick={() => void openMain()}>转到主窗口</button>
    </div>}
    <div className="history-window-body">
      <section className="history-revisions">
        <RevisionGrid
          revisions={revisions}
          selectedOids={selected ? [selected] : []}
          onSelect={(oid) => setSelected(oid)}
          onContextAction={(kind, revision) => void action(kind, revision.oid)}
          loading={loading}
          allowedActions={allowedActions}
        />
      </section>
      <section className="history-detail">
        {tab === "file" && canBlame
          ? <div className="history-file-content">
            {fileContentLoading && <div className="panel-hint">加载中…</div>}
            {fileContentError && <div className="inline-error" role="alert">{fileContentError}</div>}
            {fileContent && (fileContent.binary
              ? <div className="empty-state">二进制文件（{fileContent.size.toLocaleString()} 字节）</div>
              : <>
                {fileContent.truncated && <div className="settings-note">文件超过 2 MiB，仅显示前 2 MiB。</div>}
                <pre>{fileContent.content}</pre>
              </>)}
          </div>
          : tab === "blame" && canBlame
            ? <div className="history-blame">
              <BlameView
                repoPath={repoPath}
                file={target.relativePath!}
                onOpenCommit={(oid) => { setTab("commit"); setSelected(oid); }}
              />
            </div>
            : <>
              <CommitInfo commit={commit} contained={contained} loading={detailLoading} />
              <div className="history-diff">
                <DiffView
                  files={files}
                  loading={detailLoading}
                  highlightEnabled={highlightEnabled}
                  prefKey={repoPath}
                  loadFile={(file) => api.getCommitFileDiff(repoPath, selected!, file.path, file.oldPath)
                    .then((diffs) => diffs.find((item) => item.path === file.path || item.oldPath === file.path) ?? null)}
                />
              </div>
            </>}
      </section>
    </div>
    {resetTarget && <ResetDialog
      repoPath={repoPath}
      target={resetTarget}
      onClose={() => setResetTarget(null)}
      onChanged={() => void reload()}
      onNotify={(kind, text) => {
        if (kind === "error") setError(text);
        void reload();
      }}
    />}
  </div>;
}
