import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { api, nextLogRequestId, onLogBatch } from "./api";
import { hasSessionDrafts } from "./viewState";
import { decideBranchDeletion, planBranchFolderDelete } from "./branchDelete";
import { localFolderDeleteConfirm, remoteFolderDeleteConfirm, singleBranchDeleteConfirm } from "./branchDeleteDialog";
import { useRepoBusy } from "./useRepoBusy";
import { getRepoOperation } from "./repoOperations";
import type { AheadBehind, BranchInfo, CommitDetail, ContainedInfo, FileDiff, ConflictDraft, RebaseDraft, OperationState, RepoFileTarget, GitMaintenanceAction, RepoInfo, Revision, StatusSnapshot, SubmoduleInfo, TagInfo, WorktreeInfo, WorkspaceLaunchAction, WorkspaceLaunchRequest } from "./types";
import type { AppSettings, GridDisplayOptions } from "./settings";
import { loadLayout, resetLayout, saveLayout } from "./settings";
import type { SessionMeta } from "./components/RepositoryTabs";
import Toolbar from "./components/Toolbar";
import LeftPanel from "./components/LeftPanel";
import RevisionGrid from "./components/RevisionGrid";
import type { RevisionAction } from "./components/RevisionGrid";
import CommitInfo from "./components/CommitInfo";
import DiffView from "./components/DiffView";
import type { FileAction } from "./components/DiffView";
import ChangesPanel from "./components/ChangesPanel";
import CompareView from "./components/CompareView";
import ConflictCenter from "./components/ConflictCenter";
import RebasePlanner from "./components/RebasePlanner";
import BranchDialog from "./components/BranchDialog";
import ResetDialog from "./components/ResetDialog";
import RecoveryDialog from "./components/RecoveryDialog";
import PushDialog from "./components/PushDialog";
import StashDialog from "./components/StashDialog";
import TagDialog from "./components/TagDialog";
import SubmoduleDialog from "./components/SubmoduleDialog";
import BlameDialog from "./components/BlameDialog";
import FileHistoryDialog from "./components/FileHistoryDialog";
import CheckoutRevisionDialog from "./components/CheckoutRevisionDialog";
import DiffToolDialog from "./components/DiffToolDialog";
import TrackedFileDialog from "./components/TrackedFileDialog";
import ApplyPatchDialog from "./components/ApplyPatchDialog";
import MergeDialog from "./components/MergeDialog";
import PullDialog from "./components/PullDialog";
import RemotesDialog from "./components/RemotesDialog";
import WorktreeDialog from "./components/WorktreeDialog";
import CommandLogDialog from "./components/CommandLogDialog";
import SearchDialog from "./components/SearchDialog";
import RepositorySettingsDialog from "./components/RepositorySettingsDialog";
import { pickSaveFile } from "./nativeDialog";
import SplitHandle from "./ui/SplitHandle";
import Icon from "./ui/Icon";
import Dialog from "./ui/Dialog";
import InlineError from "./ui/InlineError";
import { useConfirm } from "./ui/Confirm";
import { registerCommands, unregisterCommands } from "./commands";
import type { Command } from "./commands";

const EMPTY_STATUS: StatusSnapshot = { staged: [], unstaged: [] };
type Workspace = "history" | "changes";
type Task = { type: "compare"; base: string; target: string } | { type: "rebase"; oid: string } | { type: "conflict" } | null;
type NoticeKind = "success" | "error" | "info";

interface Props {
  repo: RepoInfo;
  active: boolean;
  settings: AppSettings;
  onSettings: () => void;
  onNotify: (kind: NoticeKind, message: string, details?: string) => void;
  onMeta: (meta: SessionMeta) => void;
  onOpenRepo: (path: string) => void;
  onCloseRepo: () => void;
  launchAction: WorkspaceLaunchRequest | null;
  onLaunchActionConsumed: () => void;
}

export default function RepoWorkspace(props: Props) {
  const { repo, active, settings } = props;
  const [repoInfo, setRepoInfo] = useState(repo);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [logLoading, setLogLoading] = useState(true);
  const [logError, setLogError] = useState("");
  const [selectedOids, setSelectedOids] = useState<string[]>([]);
  const [commit, setCommit] = useState<CommitDetail | null>(null);
  const [commitDiff, setCommitDiff] = useState<FileDiff[]>([]);
  const [contained, setContained] = useState<ContainedInfo | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [commitError, setCommitError] = useState("");
  const [auxError, setAuxError] = useState("");
  const [status, setStatus] = useState<StatusSnapshot>(EMPTY_STATUS);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [aheadBehind, setAheadBehind] = useState<AheadBehind | null>(null);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [submodules, setSubmodules] = useState<SubmoduleInfo[]>([]);
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [operation, setOperation] = useState<OperationState | null>(null);
  const [workspace, setWorkspace] = useState<Workspace>("history");
  const [task, setTask] = useState<Task>(null);
  const [compareBase, setCompareBase] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<"details" | "diff">("details");
  const [layout, setLayout] = useState(() => loadLayout(repo.path, settings));
  const [maximized, setMaximized] = useState(false);
  const [leftRef, setLeftRef] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [message, setMessage] = useState("就绪");
  const [statusDetailsOpen, setStatusDetailsOpen] = useState(false);
  const [localBusy, setBusy] = useState(false);
  const repoBusy = useRepoBusy(repo.path);
  const busy = localBusy || repoBusy;
  const [showBranches, setShowBranches] = useState(false);
  const [branchMode, setBranchMode] = useState<"checkout" | "create">("checkout");
  const [showCheckoutRevision, setShowCheckoutRevision] = useState(false);
  const [showDiffTool, setShowDiffTool] = useState(false);
  const [showTrackedFiles, setShowTrackedFiles] = useState(false);
  const [showApplyPatch, setShowApplyPatch] = useState(false);
  const [focusCommitSignal, setFocusCommitSignal] = useState(0);
  const [initialAuxLoaded, setInitialAuxLoaded] = useState(false);
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [showRecovery, setShowRecovery] = useState(false);
  const [showPush, setShowPush] = useState(false);
  const [showStash, setShowStash] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [showSubmodules, setShowSubmodules] = useState(false);
  const [showRemotes, setShowRemotes] = useState(false);
  const [showWorktrees, setShowWorktrees] = useState(false);
  const [showPullOptions, setShowPullOptions] = useState(false);
  const [showCommandLog, setShowCommandLog] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showRepoInfo, setShowRepoInfo] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [branchSelected, setBranchSelected] = useState<string | undefined>();
  const [branchStart, setBranchStart] = useState<string | undefined>();
  const [tagTarget, setTagTarget] = useState<string | undefined>();
  const [fileAction, setFileAction] = useState<{ action: "history" | "blame"; file: FileDiff; oid?: string } | null>(null);
  const conflictDrafts = useRef(new Map<string, ConflictDraft>());
  const rebaseDrafts = useRef(new Map<string, RebaseDraft>());
  const saveConflictDraft = useCallback((file: string, draft: ConflictDraft | null) => {
    if (draft) conflictDrafts.current.set(file, draft); else conflictDrafts.current.delete(file);
    setConflictDirty(conflictDrafts.current.size > 0);
  }, []);
  const saveRebaseDraft = useCallback((oid: string, draft: RebaseDraft | null) => {
    if (draft?.dirty) rebaseDrafts.current.set(oid, draft); else rebaseDrafts.current.delete(oid);
    setRebaseDirty(rebaseDrafts.current.size > 0);
  }, []);
  const [commitDirty, setCommitDirty] = useState(false);
  const [conflictDirty, setConflictDirty] = useState(false);
  const [rebaseDirty, setRebaseDirty] = useState(false);

  const requestIdRef = useRef(0);
  const selectionRef = useRef(0);
  const headOidRef = useRef("");
  const headNameRef = useRef("");
  const refsFingerprint = useRef("");
  const statusRef = useRef<StatusSnapshot>(EMPTY_STATUS);
  const busyRef = useRef(false);
  const branchDeleteFlow = useRef(false);
  const pollingRef = useRef(false);
  const settingsRef = useRef(settings);
  const leftRefRef = useRef<string | null>(leftRef);
  const selectedOidsRef = useRef<string[]>([]);
  const logListenReadyRef = useRef<Promise<unknown> | null>(null);
  const confirm = useConfirm();
  const inspectorId = useId();
  const notifyRef = useRef(props.onNotify);
  const metaRef = useRef(props.onMeta);
  notifyRef.current = props.onNotify;
  metaRef.current = props.onMeta;
  statusRef.current = status;
  busyRef.current = busy;
  settingsRef.current = settings;
  leftRefRef.current = leftRef;
  selectedOidsRef.current = selectedOids;

  useEffect(() => { if (!(import.meta.env.DEV && import.meta.env.VITE_TEST_REPO)) saveLayout(repo.path, layout); }, [layout, repo.path]);
  useEffect(() => metaRef.current({
    busy,
    dirty: hasSessionDrafts(commitDirty || conflictDirty || rebaseDirty, conflictDrafts.current.size, rebaseDrafts.current.size),
    conflictCount: operation?.conflicts.length ?? 0,
    loading: logLoading,
    error: auxError || logError || null,
  }), [auxError, busy, commitDirty, conflictDirty, logError, logLoading, operation, rebaseDirty]);

  useEffect(() => {
    const unlisten = onLogBatch((batch) => {
      if (Number(batch.requestId) !== requestIdRef.current) return;
      if (batch.error) {
        setMessage(batch.error); setLogError(batch.error); setLogLoading(false); notifyRef.current("error", "提交日志加载失败", batch.error); return;
      }
      if (batch.revisions.length > 0) setRevisions((prev) => [...prev, ...batch.revisions]);
      if (batch.done) setLogLoading(false);
    });
    logListenReadyRef.current = unlisten;
    return () => { void api.cancelLog(repo.path, requestIdRef.current); requestIdRef.current = 0; selectionRef.current++; auxSequence.current++; auxPending.current.requested = null; void unlisten.then((fn) => fn()); };
  }, [repo.path]);

  const loadCommit = useCallback((oid: string) => {
    const selection = ++selectionRef.current;
    setDetailLoading(true); setCommit(null); setCommitDiff([]); setContained(null); setCommitError("");
    Promise.all([
      api.getCommit(repo.path, oid),
      api.getCommitFiles(repo.path, oid),
      api.getContainedIn(repo.path, oid).catch(() => null),
    ]).then(([detail, diff, contains]) => {
      if (selectionRef.current !== selection) return;
      setCommit(detail); setCommitDiff(diff); setContained(contains); setDetailLoading(false);
    }).catch((e) => {
      if (selectionRef.current !== selection) return;
      const details = String(e);
      setMessage(details); setCommitError(details); setDetailLoading(false);
    });
  }, [repo.path]);

  const navHistory = useRef<{ oids: string[]; index: number }>({ oids: [], index: -1 });
  /** 记录网格选中历史，供 Navigate > 向后 / 向前导航使用。 */
  const recordHistory = useCallback((oid: string) => {
    const history = navHistory.current;
    if (history.index >= 0 && history.oids[history.index] === oid) return;
    history.oids = history.oids.slice(0, history.index + 1);
    history.oids.push(oid);
    if (history.oids.length > 100) history.oids.shift();
    history.index = history.oids.length - 1;
  }, []);
  const selectRevision = useCallback((oid: string, record = true) => {
    setSelectedOids([oid]);
    if (record) recordHistory(oid);
    loadCommit(oid);
  }, [loadCommit, recordHistory]);

  const startLogWhenReady = useCallback((id: number, revspec?: string | null) => {
    void Promise.resolve(logListenReadyRef.current).then(() => api.startLog(repo.path, id, settingsRef.current.maxLogCount, revspec)).catch((e) => {
      if (id !== requestIdRef.current) return;
      setMessage(String(e)); setLogLoading(false);
    });
  }, [repo.path]);

  const loadCommitFile = useCallback(async (file: FileDiff) => {
    if (!commit) return null;
    const files = await api.getCommitFileDiff(repo.path, commit.oid, file.path, file.oldPath);
    return files.find((f) => f.path === file.path || f.oldPath === file.path) ?? null;
  }, [repo.path, commit]);

  const auxSequence = useRef(0);
  const auxPending = useRef<{ running: boolean; requested: "all" | "worktree" | null }>({ running: false, requested: null });
  const [worktreeVersion, setWorktreeVersion] = useState(0);
  const refreshAux = useCallback((scope: "all" | "worktree" = "all") => {
    const queue = auxPending.current;
    auxSequence.current++;
    queue.requested = queue.requested === "all" || scope === "all" ? "all" : "worktree";
    if (queue.running) return;
    queue.running = true;
    void (async () => {
      try {
        while (queue.requested) {
          const next = queue.requested; queue.requested = null;
          const id = auxSequence.current;
          try {
            const [snapshot, state, refs, ahead, tagRefs, info, moduleRefs, worktreeRefs] = await Promise.all([
              api.getStatus(repo.path), api.getOperationState(repo.path),
              next === "all" ? api.getBranches(repo.path) : Promise.resolve(null),
              next === "all" ? api.getAheadBehind(repo.path) : Promise.resolve(null),
              next === "all" ? api.tagList(repo.path) : Promise.resolve(null),
              next === "all" ? api.openRepo(repo.path) : Promise.resolve(null),
              next === "all" ? api.submoduleList(repo.path).catch(() => null) : Promise.resolve(null),
              next === "all" ? api.worktreeList(repo.path).catch(() => null) : Promise.resolve(null),
            ]);
            if (id !== auxSequence.current) continue;
            setAuxError("");
            setStatus(snapshot); setOperation(state); setWorktreeVersion((n) => n + 1);
            if (refs) {
              setBranches(refs); const head = refs.find((b) => b.isHead);
              headOidRef.current = info?.headOid ?? head?.oid ?? ""; headNameRef.current = info?.headBranch ?? head?.name ?? "";
              refsFingerprint.current = JSON.stringify([refs, tagRefs]);
              setAheadBehind(ahead);
            }
            if (tagRefs) setTags(tagRefs); if (info) setRepoInfo(info);
            if (moduleRefs) setSubmodules(moduleRefs); if (worktreeRefs) setWorktrees(worktreeRefs);
          } catch (e) { if (id === auxSequence.current) { const details = String(e); setMessage(details); setAuxError(details); } }
        }
      } finally { queue.running = false; setInitialAuxLoaded(true); }
    })();
  }, [repo.path]);
  const refreshWorktree = useCallback(() => refreshAux("worktree"), [refreshAux]);

  const refreshAll = useCallback(() => {
    const id = nextLogRequestId();
    requestIdRef.current = id;
    setRevisions([]); setLogLoading(true); setLogError("");
    startLogWhenReady(id, leftRefRef.current);
    refreshAux();
    const selected = selectedOidsRef.current[selectedOidsRef.current.length - 1];
    if (selected) loadCommit(selected);
  }, [loadCommit, refreshAux, startLogWhenReady]);

  useEffect(() => { refreshAll(); }, []); // 每个挂载的仓库会话独立加载
  const previousMax = useRef(settings.maxLogCount);
  useEffect(() => {
    if (previousMax.current === settings.maxLogCount) return;
    previousMax.current = settings.maxLogCount; refreshAll();
  }, [refreshAll, settings.maxLogCount]);
  const previousRef = useRef<string | null>(null);
  useEffect(() => {
    if (previousRef.current === leftRef) return;
    previousRef.current = leftRef; refreshAll();
  }, [leftRef, refreshAll]);
  /** 删除分支后清掉指向已删分支的历史过滤，避免下一次提交图加载使用失效 revspec。 */
  const clearDeletedRef = useCallback((names: readonly string[], prefix?: string) => {
    const current = leftRefRef.current;
    if (!current) return;
    if (!names.includes(current) && !(prefix && current.startsWith(`${prefix}/`))) return;
    leftRefRef.current = null;
    previousRef.current = null;
    setLeftRef(null);
  }, []);

  const pollOnce = useCallback(async () => {
    if (pollingRef.current || auxPending.current.running || busyRef.current || getRepoOperation(repo.path) || document.visibilityState !== "visible") return;
    pollingRef.current = true;
    const generation = auxSequence.current;
    try {
      const [snapshot, nextOperation, nextBranches, nextTags, nextInfo, nextAhead] = await Promise.all([
        api.getStatus(repo.path), api.getOperationState(repo.path), api.getBranches(repo.path),
        api.tagList(repo.path), api.openRepo(repo.path), api.getAheadBehind(repo.path),
      ]);
      if (generation !== auxSequence.current || getRepoOperation(repo.path)) return;
      setAuxError("");
      setStatus(snapshot); setWorktreeVersion((n) => n + 1); setOperation(nextOperation);
      const fingerprint = JSON.stringify([nextBranches, nextTags]);
      if ((nextInfo.headOid ?? "") !== headOidRef.current || (nextInfo.headBranch ?? "") !== headNameRef.current || fingerprint !== refsFingerprint.current) refreshAll();
      else { setBranches(nextBranches); setTags(nextTags); setRepoInfo(nextInfo); setAheadBehind(nextAhead); }
    } catch {
      setAuxError("自动刷新失败，当前显示的是上次成功读取的结果");
    } finally {
      pollingRef.current = false;
    }
  }, [refreshAll, repo.path]);

  // 切回页签或窗口重新可见时立即刷新一次；之后按设置的间隔轮询。
  useEffect(() => {
    if (!active || !settings.autoRefresh) return;
    const run = () => { void pollOnce(); };
    run();
    const timer = window.setInterval(run, settings.pollIntervalSeconds * 1000);
    document.addEventListener("visibilitychange", run);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, [active, pollOnce, settings.autoRefresh, settings.pollIntervalSeconds]);

  const openCompare = useCallback((base: string, target: string) => {
    if (getRepoOperation(repo.path)) return;
    const open = () => { if (getRepoOperation(repo.path)) return; setWorkspace("history"); setTask({ type: "compare", base, target }); setMaximized(false); };
    if ((task?.type === "conflict" && conflictDirty) || (task?.type === "rebase" && rebaseDirty)) {
      const isConflict = task.type === "conflict";
      void confirm({ title: isConflict ? "离开冲突编辑器？" : "离开 Rebase 计划？", body: "未执行的编辑将保留在当前仓库会话，重新打开任务可继续；关闭仓库页签才会丢失。", confirmLabel: "保留草稿并打开对比" }).then((ok) => {
        if (ok && !getRepoOperation(repo.path)) { open(); }
      });
    } else open();
  }, [conflictDirty, confirm, rebaseDirty, repo.path, task]);

  const selectCommit = useCallback((oid: string, additive: boolean) => {
    if (additive && selectedOids.length > 0 && selectedOids[0] !== oid) {
      const next = [selectedOids[0], oid];
      recordHistory(oid);
      setSelectedOids(next); openCompare(next[0], next[1]); return;
    }
    selectRevision(oid);
  }, [openCompare, recordHistory, selectedOids, selectRevision]);

  const runAction = useCallback(async (action: () => Promise<unknown>, success: string, scope: "all" | "worktree" = "all") => {
    if (busyRef.current || getRepoOperation(repo.path)) return;
    setBusy(true);
    try {
      await action();
      setMessage(success); notifyRef.current("success", success); if (scope === "all") refreshAll(); else refreshWorktree();
    } catch (e) {
      const details = String(e);
      setMessage(details); notifyRef.current("error", "操作失败", details);
      const state = await api.getOperationState(repo.path).catch(() => null);
      if (state) setOperation(state);
      if (state && state.kind !== "none" && state.kind !== "bisect") { setWorkspace("changes"); setTask({ type: "conflict" }); setMaximized(false); }
    } finally { setBusy(false); }
  }, [refreshAll, refreshWorktree, repo.path]);

  const runRemote = useCallback((kind: "fetch" | "pull" | "push") => {
    if (busyRef.current || getRepoOperation(repo.path)) return;
    if (kind === "push") { setShowPush(true); return; }
    const label = kind === "fetch" ? "Fetch" : "Pull";
    void runAction(() => api[kind](repo.path), `${label} 完成`);
  }, [repo.path, runAction]);

  const performFileAction = useCallback((action: FileAction, file: FileDiff, oid?: string) => {
    if (action === "history" || action === "blame") {
      setFileAction({ action, file, oid });
    } else if (action === "copy-path") {
      void navigator.clipboard?.writeText(file.path).then(() => setMessage("已复制相对路径"));
    } else {
      const call = action === "open" ? api.openPath(repo.path, file.path) : api.revealPath(repo.path, file.path);
      void call.catch((e) => notifyRef.current("error", action === "open" ? "无法打开文件" : "无法显示文件", String(e)));
    }
  }, [repo.path]);
  const onFileAction = useCallback((action: FileAction, file: FileDiff) => performFileAction(action, file), [performFileAction]);
  const onCommitFileAction = useCallback((action: FileAction, file: FileDiff) => {
    performFileAction(action, file, selectedOidsRef.current[selectedOidsRef.current.length - 1]);
  }, [performFileAction]);

  const onPathAction = useCallback((action: "open" | "reveal" | "copy-path", path: string) => {
    onFileAction(action, { path, oldPath: null, status: "modified", isBinary: false, truncated: false, patch: "" });
  }, [onFileAction]);

  const discard = useCallback(async (paths: string[], untracked: boolean) => {
    const ok = await confirm({
      title: untracked ? `删除 ${paths.length} 个未跟踪文件？` : `丢弃 ${paths.length} 个文件的未暂存变更？`,
      body: <div><p>{untracked ? "未跟踪文件删除后无法通过 Git 恢复。" : "只会恢复工作区内容，不会删除已暂存内容。"}</p><pre className="confirm-file-list">{paths.join("\n")}</pre></div>,
      confirmLabel: untracked ? "永久删除" : "丢弃变更",
      danger: true,
      requireAck: untracked,
      ackLabel: "我确认这些未跟踪文件不再需要",
    });
    if (!ok) return;
    void runAction(() => untracked ? api.deleteUntrackedFiles(repo.path, paths) : api.discardFiles(repo.path, paths), untracked ? "已删除未跟踪文件" : "已丢弃未暂存变更", "worktree");
  }, [confirm, repo.path, runAction]);

  const onRevisionAction = useCallback(async (action: RevisionAction, rev: Revision) => {
    const target = `${rev.shortId} ${rev.subject}`;
    if (action === "diff") { setInspectorTab("diff"); setLayout((prev) => ({ ...prev, showInspector: true })); setTask(null); }
    else if (action === "copy-sha" || action === "copy-subject") {
      await navigator.clipboard?.writeText(action === "copy-sha" ? rev.oid : rev.subject);
      setMessage(action === "copy-sha" ? "已复制完整提交 SHA" : "已复制提交主题");
    } else if (action === "compare-head") openCompare(rev.oid, "HEAD");
    else if (action === "compare-base") {
      if (compareBase === rev.oid) { setCompareBase(null); setMessage("已清除对比基准"); }
      else if (compareBase) { openCompare(compareBase, rev.oid); setCompareBase(null); setMessage(`已与基准 ${compareBase.slice(0, 7)} 对比`); }
      else { setCompareBase(rev.oid); setMessage(`已设 ${rev.shortId} 为对比基准，右键另一提交完成对比`); }
    } else if (action === "new-branch") { setBranchStart(rev.oid); setBranchMode("create"); setShowBranches(true); }
    else if (action === "reset") { setResetTarget(rev.oid); }
    else if (action === "new-tag") { setTagTarget(rev.oid); setShowTags(true); }
    else if (action === "interactive-rebase") { setTask({ type: "rebase", oid: rev.oid }); setMaximized(false); }
    else if (action === "merge-into-head") { setMergeTarget(rev.oid); }
    else if (action === "fixup" || action === "squash-commit") {
      if (statusRef.current.staged.length === 0) {
        notifyRef.current("info", "请先暂存变更，再创建 Fixup / Squash 提交");
        return;
      }
      const isSquash = action === "squash-commit";
      void runAction(
        () => api.commitFixup(repo.path, rev.oid, isSquash),
        `已为 ${rev.shortId} 创建 ${isSquash ? "squash!" : "fixup!"} 提交`,
      );
    } else if (action === "export-patch") {
      const savePath = await pickSaveFile(`导出提交 ${rev.shortId} 补丁`, `${rev.shortId}.patch`, [{ name: "Git Patch", extensions: ["patch"] }]);
      if (!savePath) return;
      try {
        await api.formatPatch(repo.path, rev.oid, savePath);
        setMessage(`已导出补丁到 ${savePath}`);
        notifyRef.current("success", `已导出补丁 (${rev.shortId})`);
      } catch (e) {
        notifyRef.current("error", "导出补丁失败", String(e));
      }
    } else if (action === "export-archive") {
      const savePath = await pickSaveFile(`导出提交 ${rev.shortId} 归档`, `${repoInfo.name}-${rev.shortId}.zip`, [
        { name: "ZIP Archive", extensions: ["zip"] },
        { name: "TAR.GZ Archive", extensions: ["tar.gz"] },
      ]);
      if (!savePath) return;
      try {
        await api.archiveCommit(repo.path, rev.oid, savePath);
        setMessage(`已导出归档到 ${savePath}`);
        notifyRef.current("success", `已导出归档 (${rev.shortId})`);
      } catch (e) {
        notifyRef.current("error", "导出归档失败", String(e));
      }
    } else if (action === "bisect-bad" || action === "bisect-good") {
      const verdict = action === "bisect-bad" ? "bad" : "good";
      if (operation?.kind !== "bisect") {
        void runAction(async () => {
          await api.bisectStart(
            repo.path,
            verdict === "bad" ? rev.oid : undefined,
            verdict === "good" ? rev.oid : undefined,
          );
        }, `已启动 Bisect 并标记 ${rev.shortId} 为 ${verdict}`);
      } else {
        void runAction(
          () => api.bisectMark(repo.path, verdict, rev.oid),
          `Bisect：已标记 ${rev.shortId} 为 ${verdict}`,
        );
      }
    } else {
      const labels = { "cherry-pick": "Cherry-pick", revert: "Revert", rebase: "Rebase" } as const;
      const label = labels[action];
      const body = action === "rebase" ? `将当前分支 Rebase 到 ${target}？这会重写当前分支历史。` : action === "revert" ? `为 ${target} 创建一个反向提交？` : `将 ${target} Cherry-pick 到当前分支？`;
      if (!await confirm({ title: `${label} 提交？`, body, confirmLabel: label, danger: action === "rebase", requireAck: action === "rebase", ackLabel: "我确认重写当前分支历史" })) return;
      const call = action === "cherry-pick" ? () => api.cherryPick(repo.path, rev.oid) : action === "revert" ? () => api.revert(repo.path, rev.oid) : () => api.rebase(repo.path, rev.oid);
      void runAction(call, `${label} 完成`);
    }
  }, [compareBase, confirm, openCompare, operation?.kind, repo.path, repoInfo.name, runAction]);

  const deleteBranch = useCallback(async (branch: BranchInfo) => {
    if (branchDeleteFlow.current || busyRef.current || getRepoOperation(repo.path)) return;
    branchDeleteFlow.current = true;
    try {
      const statuses = await api.getBranchDeleteStatus(repo.path, [branch.name]);
      const decision = decideBranchDeletion(statuses, [branch.name]);
      if (decision.names.length === 0) {
        setMessage(`分支 ${branch.name} 已不存在`);
        notifyRef.current("info", "分支已不存在", `${branch.name} 可能已被外部删除或重命名`);
        clearDeletedRef([branch.name]);
        refreshAll();
        return;
      }
      const force = decision.force;
      if (!await confirm(singleBranchDeleteConfirm(branch.name, branch.oid, force))) return;
      if (busyRef.current || getRepoOperation(repo.path)) return;
      await runAction(
        async () => {
          await api.deleteBranch(repo.path, branch.name, force);
          clearDeletedRef([branch.name]);
        },
        force ? `已强制删除 ${branch.name}` : `已删除 ${branch.name}`,
      );
    } catch (e) {
      setMessage(String(e));
      notifyRef.current("error", "无法删除分支", String(e));
    } finally {
      branchDeleteFlow.current = false;
    }
  }, [clearDeletedRef, confirm, refreshAll, repo.path, runAction]);

  const deleteBranchFolder = useCallback(async (prefix: string, kind: "local" | "remote") => {
    if (branchDeleteFlow.current || busyRef.current || getRepoOperation(repo.path)) return;
    branchDeleteFlow.current = true;
    try {
      const plan = planBranchFolderDelete(branches, prefix, kind);
      if (kind === "local") {
        if (plan.headBranch) {
          notifyRef.current("info", "无法删除目录", `目录 ${prefix}/ 包含当前检出的分支 ${plan.headBranch}，请先切换到其他分支`);
          return;
        }
        if (plan.names.length === 0) {
          notifyRef.current("info", "没有可删除的分支", `目录 ${prefix}/ 下没有本地分支`);
          refreshAll();
          return;
        }
        const statuses = await api.getBranchDeleteStatus(repo.path, plan.names);
        const decision = decideBranchDeletion(statuses, plan.names);
        if (decision.names.length === 0) {
          notifyRef.current("info", "没有可删除的分支", "目录下的分支已不存在");
          clearDeletedRef(plan.names, prefix);
          refreshAll();
          return;
        }
        if (!await confirm(localFolderDeleteConfirm(prefix, decision))) return;
        if (busyRef.current || getRepoOperation(repo.path)) return;
        await runAction(async () => {
          try {
            await api.deleteBranches(repo.path, decision.names, decision.force);
            clearDeletedRef(decision.names, prefix);
          } catch (e) {
            refreshAll();
            throw e;
          }
        }, decision.force ? `已强制删除 ${decision.names.length} 个分支` : `已删除 ${decision.names.length} 个分支`);
        return;
      }

      if (plan.names.length === 0) {
        notifyRef.current("info", "没有可删除的分支", `目录 ${prefix}/ 下没有远程分支`);
        clearDeletedRef([], prefix);
        refreshAll();
        return;
      }
      if (!await confirm(remoteFolderDeleteConfirm(prefix, plan.names))) return;
      if (busyRef.current || getRepoOperation(repo.path)) return;
      await runAction(async () => {
        const failures: string[] = [];
        const deletedNames: string[] = [];
        for (const name of plan.names) {
          try {
            await api.deleteRemoteBranch(repo.path, name);
            deletedNames.push(name);
          } catch (e) {
            failures.push(`${name}：${String(e)}`);
          }
        }
        clearDeletedRef(deletedNames);
        refreshAll();
        if (failures.length > 0) {
          throw new Error(`已删除 ${deletedNames.length}/${plan.names.length} 个远程分支\n${failures.join("\n")}`);
        }
      }, `已删除 ${plan.names.length} 个远程分支`);
    } catch (e) {
      setMessage(String(e));
      notifyRef.current("error", "无法删除分支目录", String(e));
    } finally {
      branchDeleteFlow.current = false;
    }
  }, [branches, clearDeletedRef, confirm, refreshAll, repo.path, runAction]);

  const deleteRemoteBranch = useCallback(async (remoteBranch: string) => {
    const ok = await confirm({
      title: `删除远程分支 ${remoteBranch}？`,
      body: "将向远端执行 git push --delete，删除后其他协作者也将失去该远程分支引用。",
      confirmLabel: "删除远程分支",
      danger: true,
      requireAck: true,
      ackLabel: "我确认从远端仓库删除该分支",
    });
    if (!ok) return;
    void runAction(() => api.deleteRemoteBranch(repo.path, remoteBranch), `已删除远程分支 ${remoteBranch}`);
  }, [confirm, repo.path, runAction]);

  const deferredFilter = useDeferredValue(filter);
  const filteredRevisions = useMemo(() => {
    const query = deferredFilter.trim().toLowerCase();
    if (!query) return revisions;
    return revisions.filter((rev) => rev.subject.toLowerCase().includes(query) || rev.authorName.toLowerCase().includes(query) || rev.oid.startsWith(query) || rev.refs.some((ref) => ref.name.toLowerCase().includes(query)));
  }, [deferredFilter, revisions]);

  const selectedRevision = useMemo(() => {
    const oid = selectedOids[selectedOids.length - 1];
    return oid ? revisions.find((rev) => rev.oid === oid) ?? null : null;
  }, [revisions, selectedOids]);

  const goToRevision = useCallback((oid: string | undefined, label = "目标提交") => {
    if (!oid) {
      notifyRef.current("info", "没有可跳转的提交");
      return;
    }
    if (!revisions.some((rev) => rev.oid === oid)) {
      notifyRef.current("info", "提交不在当前列表中", `${label} ${oid.slice(0, 7)} 不在当前提交图 / 过滤结果中`);
      return;
    }
    selectRevision(oid);
  }, [revisions, selectRevision]);

  const goCurrent = useCallback(() => {
    goToRevision(repoInfo.headOid ?? undefined, "当前 HEAD");
  }, [goToRevision, repoInfo.headOid]);

  const goParent = useCallback((kind: "parent" | "first" | "last") => {
    if (!selectedRevision) {
      notifyRef.current("info", "请先选中一个提交");
      return;
    }
    if (selectedRevision.parents.length === 0) {
      notifyRef.current("info", "当前提交没有父提交");
      return;
    }
    const parent = kind === "last" ? selectedRevision.parents[selectedRevision.parents.length - 1] : selectedRevision.parents[0];
    goToRevision(parent, "父提交");
  }, [goToRevision, selectedRevision]);

  const goChild = useCallback(() => {
    if (!selectedRevision) {
      notifyRef.current("info", "请先选中一个提交");
      return;
    }
    const index = revisions.findIndex((rev) => rev.oid === selectedRevision.oid);
    // 提交图从新到旧排列：子提交在选中提交上方；先找最近的上方提交，再兜底。
    const child = revisions.slice(0, index).reverse().find((rev) => rev.parents.includes(selectedRevision.oid))
      ?? revisions.slice(index + 1).find((rev) => rev.parents.includes(selectedRevision.oid))
      ?? revisions.find((rev) => rev.parents.includes(selectedRevision.oid));
    goToRevision(child?.oid, "子提交");
  }, [goToRevision, revisions, selectedRevision]);

  const goMergeBase = useCallback(() => {
    if (!selectedRevision) {
      notifyRef.current("info", "请先选中一个提交");
      return;
    }
    const targets = selectedOids.length >= 2
      ? [selectedOids[0], selectedOids[selectedOids.length - 1]]
      : repoInfo.headOid ? [selectedRevision.oid, repoInfo.headOid] : [];
    if (targets.length < 2) {
      notifyRef.current("info", "无法计算共同祖先", "需要选中两个提交，或选中一个提交且当前 HEAD 有效");
      return;
    }
    const byOid = new Map(revisions.map((rev) => [rev.oid, rev]));
    const ancestors = (start: string) => {
      const seen = new Set<string>();
      const queue = [start];
      while (queue.length > 0) {
        const oid = queue.shift()!;
        if (seen.has(oid)) continue;
        seen.add(oid);
        const rev = byOid.get(oid);
        if (rev) queue.push(...rev.parents);
      }
      return seen;
    };
    const firstAncestors = ancestors(targets[0]);
    const seen = new Set<string>();
    const queue = [targets[1]];
    while (queue.length > 0) {
      const oid = queue.shift()!;
      if (seen.has(oid)) continue;
      seen.add(oid);
      if (firstAncestors.has(oid)) {
        goToRevision(oid, "共同祖先");
        return;
      }
      const rev = byOid.get(oid);
      if (rev) queue.push(...rev.parents);
    }
    notifyRef.current("info", "未找到共同祖先", "两个提交的共同祖先不在当前已加载的提交列表中");
  }, [goToRevision, repoInfo.headOid, revisions, selectedOids, selectedRevision]);

  const navigateBackward = useCallback(() => {
    const history = navHistory.current;
    if (history.index <= 0) {
      notifyRef.current("info", "没有更早的导航记录");
      return;
    }
    const oid = history.oids[history.index - 1];
    if (!revisions.some((rev) => rev.oid === oid)) {
      notifyRef.current("info", "导航目标已不在当前列表中");
      return;
    }
    history.index -= 1;
    setSelectedOids([oid]); loadCommit(oid);
  }, [loadCommit, revisions]);

  const navigateForward = useCallback(() => {
    const history = navHistory.current;
    if (history.index < 0 || history.index >= history.oids.length - 1) {
      notifyRef.current("info", "没有更晚的导航记录");
      return;
    }
    const oid = history.oids[history.index + 1];
    if (!revisions.some((rev) => rev.oid === oid)) {
      notifyRef.current("info", "导航目标已不在当前列表中");
      return;
    }
    history.index += 1;
    setSelectedOids([oid]); loadCommit(oid);
  }, [loadCommit, revisions]);

  const applyBranchScope = useCallback((scope: "all" | "current" | "filtered") => {
    if (scope === "all") setLeftRef(null);
    else if (scope === "current") {
      if (!repoInfo.headBranch && !repoInfo.headOid) {
        notifyRef.current("info", "当前仓库还没有提交", "空仓库无法仅显示当前分支");
        return;
      }
      setLeftRef(repoInfo.headBranch ?? "HEAD");
    } else if (leftRef) setMessage(`当前历史已按 ${leftRef} 过滤`);
    else notifyRef.current("info", "请先在左侧选择一个分支或标签");
  }, [leftRef, repoInfo.headBranch, repoInfo.headOid]);

  const toggleDisplay = useCallback((option: keyof GridDisplayOptions) => {
    setLayout((prev) => ({ ...prev, [option]: !prev[option] }));
  }, []);

  const showConflict = useCallback(() => { setWorkspace("changes"); setTask({ type: "conflict" }); setMaximized(false); }, []);
  const dismissTask = useCallback(async () => {
    if (getRepoOperation(repo.path)) return;
    if ((task?.type === "conflict" && conflictDirty) || (task?.type === "rebase" && rebaseDirty)) {
      const isConflict = task.type === "conflict";
      const ok = await confirm({ title: isConflict ? "离开冲突编辑器？" : "离开 Rebase 计划？", body: isConflict ? "当前文件有未保存编辑。" : "当前重排、动作和提交信息编辑尚未执行。", confirmLabel: "保留草稿并离开" });
      if (!ok || getRepoOperation(repo.path)) return;
    }
    setTask(null); setMaximized(false);
  }, [conflictDirty, confirm, rebaseDirty, repo.path, task]);
  const switchWorkspace = useCallback(async (next: Workspace): Promise<boolean> => {
    if (getRepoOperation(repo.path)) return false;
    if ((task?.type === "conflict" && conflictDirty) || (task?.type === "rebase" && rebaseDirty)) {
      const isConflict = task.type === "conflict";
      const ok = await confirm({ title: isConflict ? "离开冲突编辑器？" : "离开 Rebase 计划？", body: isConflict ? "当前文件有未保存编辑。" : "当前重排、动作和提交信息编辑尚未执行。", confirmLabel: "保留草稿并切换" });
      if (!ok || getRepoOperation(repo.path)) return false;
    }
    setWorkspace(next); setTask(null); setMaximized(false);
    return true;
  }, [conflictDirty, confirm, rebaseDirty, repo.path, task]);

  const quickSearch = useCallback(() => {
    void switchWorkspace("history").then((ok) => {
      if (!ok) return;
      window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".repo-host.active .revision-filter")?.focus());
    });
  }, [switchWorkspace]);

  const stepQuickSearch = useCallback((delta: number) => {
    if (filteredRevisions.length === 0) {
      notifyRef.current("info", "当前过滤条件没有匹配提交");
      return;
    }
    const current = selectedOids[selectedOids.length - 1];
    const index = filteredRevisions.findIndex((rev) => rev.oid === current);
    const next = index < 0
      ? (delta > 0 ? 0 : filteredRevisions.length - 1)
      : (index + delta + filteredRevisions.length) % filteredRevisions.length;
    selectRevision(filteredRevisions[next].oid);
  }, [filteredRevisions, selectRevision, selectedOids]);
  const dispatchLaunchAction = useCallback(async (action: WorkspaceLaunchAction) => {
    if (action === "commit" || action === "view-changes" || action === "reset-file-changes" || action === "add-files") {
      await switchWorkspace("changes");
      if (action === "commit") setFocusCommitSignal((value) => value + 1);
    } else if (action === "pull") {
      if (busyRef.current || getRepoOperation(repo.path)) {
        notifyRef.current("info", "当前仓库有操作进行中，未执行 Pull");
        return;
      }
      const ok = await confirm({ title: `Pull ${repoInfo.name}？`, body: "将按当前分支的 upstream 配置执行 Pull。若产生冲突，会进入现有冲突解决中心。", confirmLabel: "Pull" });
      if (!ok) return;
      if (busyRef.current || getRepoOperation(repo.path)) {
        notifyRef.current("info", "当前仓库有操作进行中，未执行 Pull");
        return;
      }
      runRemote("pull");
    } else if (action === "push") setShowPush(true);
    else if (action === "view-stash") setShowStash(true);
    else if (action === "checkout-branch" || action === "create-branch") {
      setBranchStart(undefined); setBranchMode(action === "create-branch" ? "create" : "checkout"); setShowBranches(true);
    } else if (action === "checkout-revision") setShowCheckoutRevision(true);
    else if (action === "open-with-difftool") setShowDiffTool(true);
    else if (action === "file-history") setShowTrackedFiles(true);
    else if (action === "apply-patch") setShowApplyPatch(true);
  }, [confirm, repo.path, repoInfo.name, runRemote, switchWorkspace]);

  const fileExplorer = useCallback(() => {
    void api.revealPath(repo.path)
      .then(() => setMessage("已在文件资源管理器中打开仓库"))
      .catch((e) => notifyRef.current("error", "无法打开文件资源管理器", String(e)));
  }, [repo.path]);

  const editRepoFile = useCallback((target: RepoFileTarget) => {
    const labels: Record<RepoFileTarget, string> = { gitignore: ".gitignore", exclude: ".git/info/exclude", gitattributes: ".gitattributes", mailmap: ".mailmap", config: ".git/config" };
    void runAction(() => api.editRepoFile(repo.path, target), `已打开 ${labels[target]}`);
  }, [repo.path, runAction]);

  const updateAllSubmodules = useCallback(() => {
    void runAction(() => api.submoduleUpdate(repo.path), "所有子模块已更新");
  }, [repo.path, runAction]);

  const syncAllSubmodules = useCallback(() => {
    void runAction(() => api.submoduleSync(repo.path), "所有子模块已同步");
  }, [repo.path, runAction]);

  const maintenance = useCallback(async (action: GitMaintenanceAction | "edit-config") => {
    if (action === "edit-config") {
      editRepoFile("config");
      return;
    }
    if (action === "gc") {
      const ok = await confirm({
        title: "压缩 Git 数据库？",
        body: "将运行 git gc 重新打包对象并清理不可达对象。大仓库可能需要较长时间；建议先关闭其它正在读写该仓库的 Git 进程。",
        confirmLabel: "开始压缩",
      });
      if (ok) void runAction(() => api.gitMaintenance(repo.path, "gc"), "Git 数据库压缩完成");
      return;
    }
    const ok = await confirm({
      title: "删除 index.lock？",
      body: "仅当确认没有其它 Git 进程正在操作该仓库时使用。若 Git 仍在运行，删除锁文件可能导致 index 损坏。",
      confirmLabel: "删除 index.lock",
      danger: true,
      requireAck: true,
      ackLabel: "我确认没有其它 Git 进程在使用该仓库",
    });
    if (ok) void runAction(() => api.gitMaintenance(repo.path, "delete-index-lock"), "已删除 index.lock");
  }, [confirm, editRepoFile, repo.path, runAction]);

  const openCommitPanel = useCallback(() => {
    void switchWorkspace("changes").then((ok) => { if (ok) setFocusCommitSignal((value) => value + 1); });
  }, [switchWorkspace]);

  const rebaseSelected = useCallback(() => {
    if (!selectedRevision) {
      notifyRef.current("info", "请先选中要 Rebase 到的提交");
      return;
    }
    void onRevisionAction("rebase", selectedRevision);
  }, [onRevisionAction, selectedRevision]);

  const cherryPickSelected = useCallback(() => {
    if (!selectedRevision) {
      notifyRef.current("info", "请先选中要 Cherry-pick 的提交");
      return;
    }
    void onRevisionAction("cherry-pick", selectedRevision);
  }, [onRevisionAction, selectedRevision]);

  const archiveSelected = useCallback(() => {
    if (!selectedRevision) {
      notifyRef.current("info", "请先选中要导出的提交");
      return;
    }
    void onRevisionAction("export-archive", selectedRevision);
  }, [onRevisionAction, selectedRevision]);

  const formatPatchSelected = useCallback(() => {
    if (!selectedRevision) {
      notifyRef.current("info", "请先选中要导出的提交");
      return;
    }
    void onRevisionAction("export-patch", selectedRevision);
  }, [onRevisionAction, selectedRevision]);

  const openCreateBranch = useCallback(() => {
    setBranchStart(undefined); setBranchSelected(undefined); setBranchMode("create"); setShowBranches(true);
  }, []);

  const openBranches = useCallback(() => {
    setBranchStart(undefined); setBranchSelected(undefined); setBranchMode("checkout"); setShowBranches(true);
  }, []);

  const openTags = useCallback(() => {
    setTagTarget(undefined); setShowTags(true);
  }, []);

  const launchConsumedRef = useRef(0);
  useEffect(() => {
    const request = props.launchAction;
    if (!active || !request || !initialAuxLoaded || logLoading || launchConsumedRef.current === request.id) return;
    launchConsumedRef.current = request.id;
    props.onLaunchActionConsumed();
    void dispatchLaunchAction(request.action);
  }, [active, dispatchLaunchAction, initialAuxLoaded, logLoading, props.launchAction, props.onLaunchActionConsumed]);

  const closeDialog = useCallback(() => {
    setResetTarget(null); setShowRecovery(false); setShowPush(false); setShowBranches(false); setShowStash(false); setShowTags(false); setShowSubmodules(false); setFileAction(null);
    setShowCheckoutRevision(false); setShowDiffTool(false); setShowTrackedFiles(false); setShowApplyPatch(false);
    setShowRemotes(false); setShowWorktrees(false); setShowPullOptions(false); setShowCommandLog(false); setShowSearch(false); setMergeTarget(null); setShowRepoInfo(false);
  }, []);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector(".modal-backdrop, .context-menu")) return;
      if (event.key === "Escape") {
        if (maximized) { setMaximized(false); return; }
        if (task) { void dismissTask(); return; }
        if (compareBase) { setCompareBase(null); return; }
        closeDialog(); return;
      }
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const editing = !!(event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable='true']");
      if (event.key === "F5") { event.preventDefault(); if (!busyRef.current) refreshAll(); return; }
      if (!editing && !mod && event.altKey) {
        const inDiff = !!(event.target as HTMLElement | null)?.closest(".diff-view");
        if (event.key === "ArrowLeft") { event.preventDefault(); navigateBackward(); return; }
        if (event.key === "ArrowRight") { event.preventDefault(); navigateForward(); return; }
        if (event.key === "ArrowUp" && !inDiff) { event.preventDefault(); stepQuickSearch(-1); return; }
        if (event.key === "ArrowDown" && !inDiff) { event.preventDefault(); stepQuickSearch(1); return; }
      }
      if (!editing && mod) {
        if (key === "n" && !event.shiftKey) { event.preventDefault(); goChild(); return; }
        if (key === "p" && !event.shiftKey) { event.preventDefault(); goParent("parent"); return; }
        if (event.key === "ArrowLeft" && !event.shiftKey) { event.preventDefault(); goParent("first"); return; }
        if (event.key === "ArrowRight" && !event.shiftKey) { event.preventDefault(); goParent("last"); return; }
        if (key === "k" && event.shiftKey) { event.preventDefault(); goMergeBase(); return; }
        if (key === "g" && !event.shiftKey) { event.preventDefault(); setShowSearch(true); return; }
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); openCommitPanel(); return; }
        if (event.altKey && key === "w") { event.preventDefault(); setShowWorktrees(true); return; }
      }
      if (mod && event.shiftKey) {
        const actions: Record<string, () => void> = {
          b: () => { setBranchSelected(undefined); setBranchMode("checkout"); setShowBranches(true); }, s: () => setShowStash(true), t: () => setShowTags(true), m: () => setShowSubmodules(true),
          f: () => runRemote("fetch"), l: () => runRemote("pull"), p: () => runRemote("push"),
          h: () => setShowSearch(true), g: () => setShowCommandLog(true), o: fileExplorer,
          c: () => { const oid = selectedOidsRef.current[selectedOidsRef.current.length - 1]; if (oid) void navigator.clipboard?.writeText(oid); },
        };
        if (actions[key]) { event.preventDefault(); actions[key](); }
        return;
      }
      if (mod) {
        if (key === "f") { event.preventDefault(); document.querySelector<HTMLElement>(".repo-host.active .revision-filter")?.focus(); }
        else if (key === "b") { event.preventDefault(); setLayout((prev) => ({ ...prev, showLeft: !prev.showLeft })); }
        else if (key === "s" && task?.type === "conflict") return;
        return;
      }
      if (event.key === "F6") {
        event.preventDefault();
        const areas = [...document.querySelectorAll<HTMLElement>(".repo-host.active .left-panel, .repo-host.active .revision-grid, .repo-host.active .changes-panel, .repo-host.active .inspector")]
          .filter((el) => el.getClientRects().length > 0);
        const index = areas.findIndex((el) => el.contains(document.activeElement));
        const area = areas[(index + (event.shiftKey ? -1 : 1) + areas.length) % areas.length];
        if (area) { if (!area.hasAttribute("tabindex")) area.setAttribute("tabindex", "-1"); area.focus(); }
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, closeDialog, compareBase, dismissTask, fileExplorer, goChild, goMergeBase, goParent, maximized, navigateBackward, navigateForward, openCommitPanel, openCompare, refreshAll, runRemote, stepQuickSearch, switchWorkspace, task, workspace]);

  // 活动仓库把自身动作注册到命令面板；切走时注销，避免在 A 仓库执行 B 的命令。
  useEffect(() => {
    if (!active) return;
    const conflictCount = operation?.conflicts.length ?? 0;
    const commands: Command[] = [
      { id: `repo:${repo.path}:refresh`, title: "刷新当前仓库", group: "当前仓库", shortcut: "F5", keywords: ["refresh", "reload"], enabled: !busy, run: refreshAll },
      { id: `repo:${repo.path}:filter`, title: "聚焦提交过滤", group: "当前仓库", shortcut: "Ctrl+F", keywords: ["search", "filter"], run: () => document.querySelector<HTMLElement>(".repo-host.active .revision-filter")?.focus() },
      { id: `repo:${repo.path}:history`, title: "切换到历史工作区", group: "当前仓库", run: () => void switchWorkspace("history") },
      { id: `repo:${repo.path}:changes`, title: "切换到变更工作区", group: "当前仓库", run: () => void switchWorkspace("changes") },
      { id: `repo:${repo.path}:commit`, title: "打开提交变更面板", group: "当前仓库", shortcut: "Ctrl+Enter", keywords: ["commit", "stage"], enabled: !busy, run: () => { void switchWorkspace("changes").then((ok) => { if (ok) setFocusCommitSignal((value) => value + 1); }); } },
      { id: `repo:${repo.path}:conflict`, title: `解决冲突（${conflictCount}）`, group: "当前仓库", keywords: ["conflict", "merge", "rebase"], enabled: conflictCount > 0, run: showConflict },
      { id: `repo:${repo.path}:compare`, title: "创建提交 / 分支对比", group: "当前仓库", keywords: ["compare", "diff"], run: () => openCompare(compareBase ?? selectedOids[0] ?? "HEAD", "HEAD") },
      { id: `repo:${repo.path}:copy-sha`, title: "复制选中提交 SHA", group: "当前仓库", shortcut: "Ctrl+Shift+C", enabled: selectedOids.length > 0, run: () => { const oid = selectedOids[selectedOids.length - 1]; if (oid) void navigator.clipboard?.writeText(oid); } },
      { id: `repo:${repo.path}:left`, title: "显示 / 隐藏左侧导航", group: "视图", shortcut: "Ctrl+B", run: () => setLayout((prev) => ({ ...prev, showLeft: !prev.showLeft })) },
      { id: `repo:${repo.path}:inspector`, title: "显示 / 隐藏检查器", group: "视图", run: () => setLayout((prev) => ({ ...prev, showInspector: !prev.showInspector })) },
      { id: `repo:${repo.path}:inspector-right`, title: "检查器：右侧", group: "视图", run: () => setLayout((prev) => ({ ...prev, showInspector: true, inspectorPosition: "right" })) },
      { id: `repo:${repo.path}:inspector-bottom`, title: "检查器：底部", group: "视图", run: () => setLayout((prev) => ({ ...prev, showInspector: true, inspectorPosition: "bottom" })) },
      { id: `repo:${repo.path}:layout-default`, title: "布局：默认", group: "视图", run: () => setLayout(resetLayout(repo.path, settings)) },
      { id: `repo:${repo.path}:layout-wide`, title: "布局：宽 Diff", group: "视图", run: () => setLayout((prev) => ({ ...prev, showLeft: false, showInspector: true, inspectorPosition: "right", inspectorSize: 640 })) },
      { id: `repo:${repo.path}:layout-history`, title: "布局：专注历史", group: "视图", run: () => { void switchWorkspace("history").then((ok) => { if (ok) setLayout((prev) => ({ ...prev, showInspector: false })); }); } },
      { id: `repo:${repo.path}:branches`, title: "分支管理…", group: "Git 操作", shortcut: "Ctrl+Shift+B", enabled: !busy, run: () => { setBranchStart(undefined); setBranchSelected(undefined); setBranchMode("checkout"); setShowBranches(true); } },
      { id: `repo:${repo.path}:merge`, title: "合并分支到当前 HEAD…", group: "Git 操作", keywords: ["merge", "squash"], enabled: !busy, run: () => setMergeTarget("") },
      { id: `repo:${repo.path}:remotes`, title: "远程仓库管理 (Remotes)…", group: "Git 操作", keywords: ["remote", "origin", "upstream"], enabled: !busy, run: () => setShowRemotes(true) },
      { id: `repo:${repo.path}:worktrees`, title: "Worktree 多工作树管理…", group: "Git 操作", keywords: ["worktree"], enabled: !busy, run: () => setShowWorktrees(true) },
      { id: `repo:${repo.path}:pull-options`, title: "Pull 选项（Rebase / Autostash）…", group: "Git 操作", keywords: ["pull", "rebase", "autostash"], enabled: !busy, run: () => setShowPullOptions(true) },
      { id: `repo:${repo.path}:search`, title: "高级搜索（提交历史 / 代码全文）…", group: "当前仓库", shortcut: "Ctrl+Shift+H", keywords: ["search", "grep", "author"], run: () => setShowSearch(true) },
      { id: `repo:${repo.path}:command-log`, title: "Git 命令执行日志…", group: "当前仓库", shortcut: "Ctrl+Shift+G", keywords: ["log", "command", "cli"], run: () => setShowCommandLog(true) },
      { id: `repo:${repo.path}:bisect`, title: "启动 Git Bisect 二分排查", group: "Git 操作", keywords: ["bisect"], enabled: !busy && operation?.kind === "none", run: () => void runAction(() => api.bisectStart(repo.path), "已启动 Git Bisect，请标记好/坏提交") },
      { id: `repo:${repo.path}:stash`, title: "Stash 管理…", group: "Git 操作", shortcut: "Ctrl+Shift+S", enabled: !busy, run: () => setShowStash(true) },
      { id: `repo:${repo.path}:tags`, title: "标签管理…", group: "Git 操作", shortcut: "Ctrl+Shift+T", enabled: !busy, run: () => { setTagTarget(undefined); setShowTags(true); } },
      { id: `repo:${repo.path}:submodules`, title: "子模块…", group: "Git 操作", shortcut: "Ctrl+Shift+M", enabled: !busy, run: () => setShowSubmodules(true) },
      { id: `repo:${repo.path}:recovery`, title: "恢复历史（HEAD 备份与 reflog）…", group: "Git 操作", enabled: !busy, run: () => setShowRecovery(true) },
      { id: `repo:${repo.path}:fetch`, title: "Fetch", group: "Git 操作", shortcut: "Ctrl+Shift+F", enabled: !busy, run: () => runRemote("fetch") },
      { id: `repo:${repo.path}:pull`, title: "Pull", group: "Git 操作", shortcut: "Ctrl+Shift+L", enabled: !busy, run: () => runRemote("pull") },
      { id: `repo:${repo.path}:push`, title: "Push…", group: "Git 操作", shortcut: "Ctrl+Shift+P", enabled: !busy, run: () => runRemote("push") },
    ];
    registerCommands(`repo:${repo.path}`, commands);
    return () => unregisterCommands(`repo:${repo.path}`);
  }, [active, busy, compareBase, openCompare, operation?.conflicts.length, refreshAll, repo.path, runRemote, selectedOids, settings, showConflict, switchWorkspace]);

  const refs = useMemo(() => [...branches.map((b) => b.name), ...tags.map((t) => t.name), "HEAD"], [branches, tags]);
  const changeCount = status.staged.length + status.unstaged.length;
  const compareError = useCallback((value: string) => { setMessage(value); notifyRef.current("error", "对比失败", value); }, []);
  const updateCommitDirty = useCallback((value: boolean) => setCommitDirty(value), []);
  const updateConflictDirty = useCallback((value: boolean) => setConflictDirty(value || conflictDrafts.current.size > 0), []);
  const updateRebaseDirty = useCallback((value: boolean) => setRebaseDirty(value || rebaseDrafts.current.size > 0), []);
  const verticalInspector = layout.inspectorPosition === "right";

  return (
    <div className="repo-workspace">
      <Toolbar repo={repoInfo} branches={branches} loading={logLoading} busy={busy} revisionCount={filteredRevisions.length} aheadBehind={aheadBehind} filter={filter} workspace={workspace} inspectorVisible={layout.showInspector} leftVisible={layout.showLeft} inspectorPosition={layout.inspectorPosition} compareBase={compareBase}
        leftRef={leftRef} display={layout} selectedShortId={selectedRevision?.shortId ?? null} conflictCount={operation?.conflicts.length ?? 0}
        onFilter={setFilter} onCheckoutBranch={(name) => { if (name !== repoInfo.headBranch) void runAction(() => api.checkoutBranch(repo.path, name), `已切换到 ${name}`); }} onRefresh={refreshAll} onToggleLeft={() => setLayout((prev) => ({ ...prev, showLeft: !prev.showLeft }))} onToggleInspector={() => setLayout((prev) => ({ ...prev, showInspector: !prev.showInspector }))}
        onInspectorPosition={(position) => setLayout((prev) => ({ ...prev, inspectorPosition: position, showInspector: true }))}
        onResetLayout={() => setLayout(resetLayout(repo.path, settings))}
        onWideDiff={() => setLayout((prev) => ({ ...prev, showLeft: false, showInspector: true, inspectorPosition: "right", inspectorSize: 640 }))}
        onFocusHistory={() => { void switchWorkspace("history").then((ok) => { if (ok) setLayout((prev) => ({ ...prev, showInspector: false })); }); }}
        onBranches={openBranches} onStash={() => setShowStash(true)} onTags={openTags} onSubmodules={() => setShowSubmodules(true)}
        onRemotes={() => setShowRemotes(true)} onWorktrees={() => setShowWorktrees(true)} onPullOptions={() => setShowPullOptions(true)} onMerge={() => setMergeTarget("")} onSearch={() => setShowSearch(true)} onCommandLog={() => setShowCommandLog(true)}
        onBisectStart={() => void runAction(() => api.bisectStart(repo.path), "已启动 Git Bisect，请标记好/坏提交")}
        onSettings={props.onSettings} onRecovery={() => setShowRecovery(true)}
        onCompare={() => openCompare(compareBase ?? selectedOids[0] ?? "HEAD", "HEAD")} onClearCompareBase={() => setCompareBase(null)} onRemote={runRemote}
        onFileExplorer={fileExplorer} onEditRepoFile={editRepoFile} onUpdateAllSubmodules={updateAllSubmodules} onSyncAllSubmodules={syncAllSubmodules}
        onMaintenance={(action) => void maintenance(action)} onRepositorySettings={() => setShowRepoInfo(true)} onCloseRepo={props.onCloseRepo}
        onGoCurrent={goCurrent} onGoCommit={() => setShowSearch(true)} onGoChild={goChild} onGoParent={goParent} onGoMergeBase={goMergeBase}
        onNavigateBackward={navigateBackward} onNavigateForward={navigateForward} onQuickSearch={quickSearch}
        onQuickSearchPrev={() => stepQuickSearch(-1)} onQuickSearchNext={() => stepQuickSearch(1)}
        onBranchScope={applyBranchScope} onToggleDisplay={toggleDisplay}
        onCommit={openCommitPanel} onUndoLastCommit={() => setResetTarget("HEAD^")} onResetChanges={() => setResetTarget("HEAD")}
        onCreateBranch={openCreateBranch} onDeleteBranch={openBranches} onCheckoutBranchDialog={openBranches} onCreateTag={openTags}
        onCheckoutRevision={() => setShowCheckoutRevision(true)} onRebase={rebaseSelected} onFormatPatch={formatPatchSelected}
        onApplyPatch={() => setShowApplyPatch(true)} onConflict={showConflict} onCherryPick={cherryPickSelected} onArchive={archiveSelected} />
      {operation?.kind === "bisect" && (
        <div className="bisect-banner" role="region" aria-label="Git Bisect 状态栏">
          <Icon name="search" size={14} />
          <strong>Bisect 二分排查进行中</strong>
          <span>当前指向：<code>{repoInfo.headOid?.slice(0, 7) ?? "HEAD"}</code>（测试当前版本后标记好/坏，或右键任意历史提交标记）</span>
          <div className="toolbar-spacer" />
          <button disabled={busy} onClick={() => void runAction(() => api.bisectMark(repo.path, "good"), "Bisect：已标记当前提交为 Good")}>标记当前为好 (Good)</button>
          <button disabled={busy} onClick={() => void runAction(() => api.bisectMark(repo.path, "bad"), "Bisect：已标记当前提交为 Bad")}>标记当前为坏 (Bad)</button>
          <button disabled={busy} onClick={() => void runAction(() => api.bisectMark(repo.path, "skip"), "Bisect：已跳过当前提交")}>跳过 (Skip)</button>
          <button className="danger-button" disabled={busy} onClick={() => void runAction(() => api.bisectReset(repo.path), "已结束 Bisect 并恢复原分支")}>结束 Bisect (Reset)</button>
        </div>
      )}
      <div className="workspace-body">
        {layout.showLeft && <LeftPanel branches={branches} tags={tags} submodules={submodules} worktrees={worktrees} activeRef={leftRef} workspace={workspace} changeCount={changeCount} width={layout.leftWidth} conflictCount={operation?.conflicts.length ?? 0}
          onWorkspace={(next) => { void switchWorkspace(next); }} onFilter={setLeftRef} onCheckout={(name) => void runAction(() => api.checkoutBranch(repo.path, name), `已切换到 ${name}`)}
          onCheckoutRemote={(remoteBranch) => void runAction(() => api.checkoutRemoteBranch(repo.path, remoteBranch), `已检出并跟踪 ${remoteBranch}`)}
          onMergeRef={(ref) => setMergeTarget(ref)}
          onRenameBranch={(branch) => { setBranchSelected(branch.name); setBranchMode("checkout"); setShowBranches(true); }}
          onDeleteRemoteBranch={(remoteBranch) => void deleteRemoteBranch(remoteBranch)}
          onCompare={(ref) => openCompare("HEAD", ref)}
          onNewBranch={(start) => { setBranchStart(start); setBranchSelected(undefined); setBranchMode("create"); setShowBranches(true); }} onDeleteBranch={deleteBranch} onDeleteBranchFolder={deleteBranchFolder}
          onDeleteTag={(name) => { void confirm({ title: `删除标签 ${name}？`, body: "只删除本地标签。", danger: true, confirmLabel: "删除标签" }).then((ok) => { if (ok) void runAction(() => api.deleteTag(repo.path, name), `已删除标签 ${name}`); }); }}
          onStash={() => setShowStash(true)} onSubmodules={() => setShowSubmodules(true)} onWorktrees={() => setShowWorktrees(true)}
          onCopyPath={(path) => { void navigator.clipboard?.writeText(path).then(() => setMessage("已复制路径")); }}
          onRevealPath={(path) => { void api.revealPath(path).then(() => setMessage("已在文件管理器中显示")).catch((e) => setMessage(String(e))); }}
          onOpenWorktree={props.onOpenRepo} />}
        {layout.showLeft && <SplitHandle direction="vertical" label="调整导航宽度" onResize={(delta) => setLayout((prev) => ({ ...prev, leftWidth: Math.min(360, Math.max(160, prev.leftWidth + delta)) }))} onReset={() => setLayout((prev) => ({ ...prev, leftWidth: 224 }))} />}
        <div className={`content-area${verticalInspector ? " horizontal" : " vertical"}`}>
          <main className="workspace-main" style={{ display: maximized ? "none" : undefined }}>
            {task?.type === "compare" && <CompareView repoPath={repo.path} initialBase={task.base} initialTarget={task.target} refs={refs} onClose={() => setTask(null)} onFileAction={onFileAction} onError={compareError} />}
            {task?.type === "rebase" && <RebasePlanner key={task.oid} repoPath={repo.path} startOid={task.oid} draft={rebaseDrafts.current.get(task.oid)} onDraftChange={saveRebaseDraft} onExit={() => setTask(null)} onConflict={showConflict} onChanged={refreshAll} onDirtyChange={updateRebaseDirty} onNotify={props.onNotify} />}
            {task?.type === "conflict" && <ConflictCenter repoPath={repo.path} drafts={conflictDrafts.current} onDraftChange={saveConflictDraft} onExit={() => setTask(null)} onChanged={refreshAll} onDirtyChange={updateConflictDirty} onNotify={props.onNotify} />}
            {!task && workspace === "history" && <RevisionGrid revisions={filteredRevisions} selectedOids={selectedOids} onSelect={selectCommit} onContextAction={(action, rev) => void onRevisionAction(action, rev)} loading={logLoading} compareBase={compareBase} layoutKey={deferredFilter} display={layout} />}
            <div className="changes-workspace" style={{ display: workspace === "changes" && !task ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
              <ChangesPanel repoPath={repo.path} status={status} width={layout.changesWidth} conflictCount={operation?.conflicts.length ?? 0} error={auxError} onWidth={(changesWidth) => setLayout((prev) => ({ ...prev, changesWidth }))}
                onRefresh={(historyChanged) => historyChanged ? refreshAll() : refreshWorktree()} refreshVersion={worktreeVersion} setMessage={setMessage} highlightEnabled={settings.highlightEnabled} onFileAction={onFileAction} onPathAction={onPathAction} onDiscard={discard} onOpenConflict={showConflict} onDirtyChange={updateCommitDirty} focusCommitSignal={focusCommitSignal} />
            </div>
          </main>
          {workspace === "history" && !task && layout.showInspector && <>
            {!maximized && <SplitHandle direction={verticalInspector ? "vertical" : "horizontal"} label="调整检查器尺寸" onResize={(delta) => setLayout((prev) => ({ ...prev, inspectorSize: Math.min(720, Math.max(180, prev.inspectorSize - delta)) }))} onReset={() => setLayout((prev) => ({ ...prev, inspectorSize: 400 }))} />}
            <section className={`inspector${maximized ? " maximized" : ""}`} style={verticalInspector && !maximized ? { width: layout.inspectorSize } : !maximized ? { height: layout.inspectorSize } : undefined} tabIndex={-1}>
              <div className="inspector-header">
                <div className="tabs" role="tablist" aria-label="检查器视图" onKeyDown={(e) => { if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return; e.preventDefault(); const next = inspectorTab === "details" ? "diff" : "details"; setInspectorTab(next); document.getElementById(`${inspectorId}-${next}-tab`)?.focus(); }}><button role="tab" id={`${inspectorId}-details-tab`} aria-selected={inspectorTab === "details"} aria-controls={`${inspectorId}-panel`} className={inspectorTab === "details" ? "active" : ""} onClick={() => setInspectorTab("details")}>详情</button><button role="tab" id={`${inspectorId}-diff-tab`} aria-selected={inspectorTab === "diff"} aria-controls={`${inspectorId}-panel`} className={inspectorTab === "diff" ? "active" : ""} onClick={() => setInspectorTab("diff")}>差异{commitDiff.length > 0 ? ` (${commitDiff.length})` : ""}</button></div>
                <button className="icon-button" title={verticalInspector ? "移动到底部" : "移动到右侧"} aria-label={verticalInspector ? "将检查器移动到底部" : "将检查器移动到右侧"} onClick={() => setLayout((prev) => ({ ...prev, inspectorPosition: verticalInspector ? "bottom" : "right" }))}><Icon name="panel" /></button>
                <button className="icon-button" title={maximized ? "还原 (Esc)" : "最大化"} aria-label={maximized ? "还原检查器" : "最大化检查器"} onClick={() => setMaximized(!maximized)}>{maximized ? "↙" : "↗"}</button>
                <button className="icon-button" title="关闭检查器" aria-label="关闭检查器" onClick={() => { setMaximized(false); setLayout((prev) => ({ ...prev, showInspector: false })); }}><Icon name="close" /></button>
              </div>
              <div className="inspector-content" role="tabpanel" id={`${inspectorId}-panel`} aria-labelledby={`${inspectorId}-${inspectorTab}-tab`}>{commitError ? <InlineError message={commitError} /> : inspectorTab === "details" ? <CommitInfo commit={commit} contained={contained} loading={detailLoading} onCopy={(text, label) => { void navigator.clipboard?.writeText(text).then(() => setMessage(`已复制${label}`)); }} onFilterRef={(name) => { setLeftRef(name); setWorkspace("history"); }} /> : <DiffView files={commitDiff} loadFile={loadCommitFile} loading={detailLoading} highlightEnabled={settings.highlightEnabled} onFileAction={onCommitFileAction} prefKey={repo.path} />}</div>
            </section>
          </>}
        </div>
      </div>
      <div className="status-bar">
        <span className="status-branch"><Icon name="branch" size={13} />{repoInfo.headBranch ?? "detached"}{aheadBehind && ` ↑${aheadBehind.ahead} ↓${aheadBehind.behind}`}</span>
        <span className="status-message" role="status" aria-live="polite">
          <button type="button" className={`status-message-button${busy ? " busy" : ""}`} title={message} onClick={() => setStatusDetailsOpen(true)}>{busy && <span className="spinner" />}<span className="status-message-text">{message}</span></button>
        </span>
        <span>{filteredRevisions.length.toLocaleString()} 条</span>
      </div>
      {resetTarget && <ResetDialog repoPath={repo.path} target={resetTarget} onClose={() => setResetTarget(null)} onChanged={refreshAll} onNotify={props.onNotify} />}
      {showRecovery && <RecoveryDialog repoPath={repo.path} onClose={() => setShowRecovery(false)} onRestore={(oid) => { setShowRecovery(false); setResetTarget(oid); }} />}
      {showPush && <PushDialog repoPath={repo.path} onClose={() => setShowPush(false)} onChanged={refreshAll} onNotify={props.onNotify} />}
      {showBranches && <BranchDialog repoPath={repo.path} branches={branches} initialStartPoint={branchStart} initialMode={branchMode} initialSelected={branchSelected} onClose={() => setShowBranches(false)} onChanged={(deletedRefs) => { if (deletedRefs) clearDeletedRef(deletedRefs); refreshAll(); }} setMessage={setMessage} onMergeRef={(ref) => setMergeTarget(ref)} />}
      {mergeTarget !== null && <MergeDialog repoPath={repo.path} headBranch={repoInfo.headBranch} branches={branches} initialTarget={mergeTarget || undefined} onClose={() => setMergeTarget(null)} onChanged={refreshAll} onConflict={showConflict} onNotify={props.onNotify} />}
      {showPullOptions && <PullDialog repoPath={repo.path} headBranch={repoInfo.headBranch} onClose={() => setShowPullOptions(false)} onChanged={refreshAll} onConflict={showConflict} onNotify={props.onNotify} />}
      {showRemotes && <RemotesDialog repoPath={repo.path} onClose={() => setShowRemotes(false)} onChanged={refreshAll} setMessage={setMessage} />}
      {showWorktrees && <WorktreeDialog repoPath={repo.path} onClose={() => setShowWorktrees(false)} onChanged={refreshAll} onOpenWorktree={props.onOpenRepo} setMessage={setMessage} />}
      {showCommandLog && <CommandLogDialog repoPath={repo.path} onClose={() => setShowCommandLog(false)} />}
      {showSearch && <SearchDialog repoPath={repo.path} onClose={() => setShowSearch(false)} onSelectCommit={(oid) => { setTask(null); setWorkspace("history"); selectRevision(oid); setInspectorTab("details"); setLayout((prev) => ({ ...prev, showInspector: true })); }} onOpenFileAtLine={(file) => { setFileAction({ action: "blame", file: { path: file, oldPath: null, status: "modified", isBinary: false, truncated: false, patch: "" } }); }} />}
      {showRepoInfo && <RepositorySettingsDialog repo={repoInfo} onClose={() => setShowRepoInfo(false)} setMessage={setMessage} />}
      {showStash && <StashDialog repoPath={repo.path} onClose={() => setShowStash(false)} onChanged={refreshAll} setMessage={setMessage} />}
      {showTags && <TagDialog repoPath={repo.path} initialTarget={tagTarget} onClose={() => setShowTags(false)} onChanged={refreshAll} setMessage={setMessage} />}
      {showSubmodules && <SubmoduleDialog repoPath={repo.path} onClose={() => setShowSubmodules(false)} onChanged={refreshAll} setMessage={setMessage} />}
      {fileAction?.action === "blame" && <BlameDialog repoPath={repo.path} file={fileAction.file.path} oid={fileAction.oid} onClose={() => setFileAction(null)} onOpenCommit={(oid) => { setFileAction(null); setTask(null); setWorkspace("history"); selectRevision(oid); setInspectorTab("details"); setLayout((prev) => ({ ...prev, showInspector: true })); }} />}
      {fileAction?.action === "history" && <FileHistoryDialog repoPath={repo.path} file={fileAction.file.path} highlightEnabled={settings.highlightEnabled} onClose={() => setFileAction(null)} />}
      {showCheckoutRevision && <CheckoutRevisionDialog repoPath={repo.path} onClose={() => setShowCheckoutRevision(false)} onChanged={refreshAll} setMessage={setMessage} />}
      {showDiffTool && <DiffToolDialog repoPath={repo.path} status={status} onClose={() => setShowDiffTool(false)} setMessage={setMessage} />}
      {showTrackedFiles && <TrackedFileDialog repoPath={repo.path} onClose={() => setShowTrackedFiles(false)} onSelect={(file) => { setShowTrackedFiles(false); setFileAction({ action: "history", file: { path: file, oldPath: null, status: "modified", isBinary: false, truncated: false, patch: "" } }); }} />}
      {showApplyPatch && <ApplyPatchDialog repoPath={repo.path} onClose={() => setShowApplyPatch(false)} onChanged={refreshWorktree} setMessage={setMessage} />}
      {statusDetailsOpen && <Dialog title="操作详情" wide onClose={() => setStatusDetailsOpen(false)} footer={<>
        <button onClick={() => { void navigator.clipboard?.writeText(message); }}>复制详情</button>
        <button className="primary" onClick={() => setStatusDetailsOpen(false)}>关闭</button>
      </>}>
        <pre className="git-output">{message}</pre>
      </Dialog>}
    </div>
  );
}
