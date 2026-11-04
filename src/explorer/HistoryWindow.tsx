import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { CommitDetail, ContainedInfo, ExplorerTarget, FileDiff, Revision, ScopedHistoryEntry } from "../types";
import CommitInfo from "../components/CommitInfo";
import DiffView from "../components/DiffView";
import RevisionGrid from "../components/RevisionGrid";
import type { RevisionAction } from "../components/RevisionGrid";
import ResetDialog from "../components/ResetDialog";
import { useConfirm } from "../ui/Confirm";
import { loadSettings } from "../settings";

interface Props {
  target: ExplorerTarget;
  onBusyChange: (busy: boolean) => void;
}

export default function HistoryWindow({ target, onBusyChange }: Props) {
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

  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  useEffect(() => { setHighlightEnabled(loadSettings().highlightEnabled); }, []);

  const reload = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const next = await api.scopedHistory(repoPath, target.relativePath, follow, 1000);
      setEntries(next);
      setSelected((current) => next.some((entry) => entry.oid === current) ? current : next[0]?.oid ?? null);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
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
    if (busy) return;
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
  return <div className="history-window">
    <div className="history-toolbar">
      <div>
        <strong>{scopeLabel}</strong>
        <span className="muted">{target.relativePath ?? target.repo.headBranch ?? "HEAD"}</span>
      </div>
      <button disabled={loading || busy} onClick={() => void reload()}>刷新</button>
    </div>
    {error && <div className="inline-error history-error" role="alert">{error}
      <button onClick={() => void api.openRepositoryInMain(repoPath)}>转到主窗口</button>
    </div>}
    <div className="history-window-body">
      <section className="history-revisions">
        <RevisionGrid
          revisions={revisions}
          selectedOids={selected ? [selected] : []}
          onSelect={(oid) => setSelected(oid)}
          onContextAction={(kind, revision) => void action(kind, revision.oid)}
          loading={loading}
          allowedActions={["diff", "copy-sha", "copy-subject", "reset", "rebase", "cherry-pick", "revert"]}
        />
      </section>
      <section className="history-detail">
        <CommitInfo commit={commit} contained={contained} loading={detailLoading} />
        <div className="history-diff">
          <DiffView
            files={files}
            loading={detailLoading}
            highlightEnabled={highlightEnabled}
            loadFile={(file) => api.getCommitFileDiff(repoPath, selected!, file.path, file.oldPath)
              .then((diffs) => diffs.find((item) => item.path === file.path || item.oldPath === file.path) ?? null)}
          />
        </div>
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
