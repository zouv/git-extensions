import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, nextLogRequestId, onLogBatch } from "./api";
import { hasSessionDrafts } from "./viewState";
import { useRepoBusy } from "./useRepoBusy";
import { getRepoOperation } from "./repoOperations";
import type { AheadBehind, BranchInfo, CommitDetail, ContainedInfo, FileDiff, ConflictDraft, RebaseDraft, OperationState, RepoInfo, Revision, StatusSnapshot, TagInfo } from "./types";
import type { AppSettings } from "./settings";
import { loadLayout, resetLayout, saveLayout } from "./settings";
import type { TagGroupConfig } from "./tagGroups";
import { forgetTag, setTagAlias, setTagGroup, visibleTags } from "./tagGroups";
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
import TagGroupsDialog from "./components/TagGroupsDialog";
import SubmoduleDialog from "./components/SubmoduleDialog";
import BlameDialog from "./components/BlameDialog";
import FileHistoryDialog from "./components/FileHistoryDialog";
import SplitHandle from "./ui/SplitHandle";
import Icon from "./ui/Icon";
import { useConfirm } from "./ui/Confirm";

const EMPTY_STATUS: StatusSnapshot = { staged: [], unstaged: [] };
type Workspace = "history" | "changes";
type Task = { type: "compare"; base: string; target: string } | { type: "rebase"; oid: string } | { type: "conflict" } | null;
type NoticeKind = "success" | "error" | "info";

interface Props {
  repo: RepoInfo;
  active: boolean;
  settings: AppSettings;
  tagGroups: TagGroupConfig;
  onTagGroupsChange: (next: TagGroupConfig) => void;
  showGroupManager: boolean;
  onCloseGroupManager: () => void;
  onOpen: () => void;
  onSettings: () => void;
  onNotify: (kind: NoticeKind, message: string, details?: string) => void;
  onMeta: (meta: SessionMeta) => void;
}

export default function RepoWorkspace(props: Props) {
  const { repo, active, settings } = props;
  const [repoInfo, setRepoInfo] = useState(repo);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [logLoading, setLogLoading] = useState(true);
  const [selectedOids, setSelectedOids] = useState<string[]>([]);
  const [commit, setCommit] = useState<CommitDetail | null>(null);
  const [commitDiff, setCommitDiff] = useState<FileDiff[]>([]);
  const [contained, setContained] = useState<ContainedInfo | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [status, setStatus] = useState<StatusSnapshot>(EMPTY_STATUS);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [aheadBehind, setAheadBehind] = useState<AheadBehind | null>(null);
  const [tags, setTags] = useState<TagInfo[]>([]);
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
  const [localBusy, setBusy] = useState(false);
  const repoBusy = useRepoBusy(repo.path);
  const busy = localBusy || repoBusy;
  const [showBranches, setShowBranches] = useState(false);
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [showRecovery, setShowRecovery] = useState(false);
  const [showPush, setShowPush] = useState(false);
  const [showStash, setShowStash] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [showSubmodules, setShowSubmodules] = useState(false);
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
  const settingsRef = useRef(settings);
  const selectedOidsRef = useRef<string[]>([]);
  const logListenReadyRef = useRef<Promise<unknown> | null>(null);
  const confirm = useConfirm();
  const notifyRef = useRef(props.onNotify);
  const metaRef = useRef(props.onMeta);
  notifyRef.current = props.onNotify;
  metaRef.current = props.onMeta;
  statusRef.current = status;
  busyRef.current = busy;
  settingsRef.current = settings;
  selectedOidsRef.current = selectedOids;

  useEffect(() => { if (!(import.meta.env.DEV && import.meta.env.VITE_TEST_REPO)) saveLayout(repo.path, layout); }, [layout, repo.path]);
  useEffect(() => metaRef.current({ busy, dirty: hasSessionDrafts(commitDirty || conflictDirty || rebaseDirty, conflictDrafts.current.size, rebaseDrafts.current.size), conflictCount: operation?.conflicts.length ?? 0 }), [busy, commitDirty, conflictDirty, rebaseDirty, operation]);

  useEffect(() => {
    const unlisten = onLogBatch((batch) => {
      if (Number(batch.requestId) !== requestIdRef.current) return;
      if (batch.error) {
        setMessage(batch.error); setLogLoading(false); notifyRef.current("error", "提交日志加载失败", batch.error); return;
      }
      if (batch.revisions.length > 0) setRevisions((prev) => [...prev, ...batch.revisions]);
      if (batch.done) setLogLoading(false);
    });
    logListenReadyRef.current = unlisten;
    return () => { void api.cancelLog(repo.path, requestIdRef.current); requestIdRef.current = 0; selectionRef.current++; auxSequence.current++; auxPending.current.requested = null; void unlisten.then((fn) => fn()); };
  }, [repo.path]);

  const loadCommit = useCallback((oid: string) => {
    const selection = ++selectionRef.current;
    setDetailLoading(true); setCommit(null); setCommitDiff([]); setContained(null);
    Promise.all([
      api.getCommit(repo.path, oid),
      api.getCommitFiles(repo.path, oid),
      api.getContainedIn(repo.path, oid).catch(() => null),
    ]).then(([detail, diff, contains]) => {
      if (selectionRef.current !== selection) return;
      setCommit(detail); setCommitDiff(diff); setContained(contains); setDetailLoading(false);
    }).catch((e) => {
      if (selectionRef.current !== selection) return;
      setMessage(String(e)); setDetailLoading(false);
    });
  }, [repo.path]);

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
            const [snapshot, state, refs, ahead, tagRefs, info] = await Promise.all([
              api.getStatus(repo.path), api.getOperationState(repo.path),
              next === "all" ? api.getBranches(repo.path) : Promise.resolve(null),
              next === "all" ? api.getAheadBehind(repo.path) : Promise.resolve(null),
              next === "all" ? api.tagList(repo.path) : Promise.resolve(null),
              next === "all" ? api.openRepo(repo.path) : Promise.resolve(null),
            ]);
            if (id !== auxSequence.current) continue;
            setStatus(snapshot); setOperation(state); setWorktreeVersion((n) => n + 1);
            if (refs) {
              setBranches(refs); const head = refs.find((b) => b.isHead);
              headOidRef.current = info?.headOid ?? head?.oid ?? ""; headNameRef.current = info?.headBranch ?? head?.name ?? "";
              refsFingerprint.current = JSON.stringify([refs, tagRefs]);
              setAheadBehind(ahead);
            }
            if (tagRefs) setTags(tagRefs); if (info) setRepoInfo(info);
          } catch (e) { if (id === auxSequence.current) setMessage(String(e)); }
        }
      } finally { queue.running = false; }
    })();
  }, [repo.path]);
  const refreshWorktree = useCallback(() => refreshAux("worktree"), [refreshAux]);

  const refreshAll = useCallback(() => {
    const id = nextLogRequestId();
    requestIdRef.current = id;
    setRevisions([]); setLogLoading(true);
    startLogWhenReady(id, leftRef);
    refreshAux();
    const selected = selectedOidsRef.current[selectedOidsRef.current.length - 1];
    if (selected) loadCommit(selected);
  }, [leftRef, loadCommit, refreshAux, startLogWhenReady]);

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

  useEffect(() => {
    if (!active || !settings.autoRefresh) return;
    let polling = false; let alive = true;
    const timer = window.setInterval(() => {
      if (polling || auxPending.current.running || busyRef.current || getRepoOperation(repo.path) || document.visibilityState !== "visible") return;
      polling = true; const generation = auxSequence.current;
      void (async () => {
        try {
          const [snapshot, nextOperation, nextBranches, nextTags, nextInfo, nextAhead] = await Promise.all([
            api.getStatus(repo.path), api.getOperationState(repo.path), api.getBranches(repo.path),
            api.tagList(repo.path), api.openRepo(repo.path), api.getAheadBehind(repo.path),
          ]);
          if (!alive || generation !== auxSequence.current || getRepoOperation(repo.path)) return;
          setStatus(snapshot); setWorktreeVersion((n) => n + 1); setOperation(nextOperation);
          const fingerprint = JSON.stringify([nextBranches, nextTags]);
          if ((nextInfo.headOid ?? "") !== headOidRef.current || (nextInfo.headBranch ?? "") !== headNameRef.current || fingerprint !== refsFingerprint.current) refreshAll();
          else { setBranches(nextBranches); setTags(nextTags); setRepoInfo(nextInfo); setAheadBehind(nextAhead); }
        } catch { /* 下轮重试，不覆盖用户当前编辑 */ } finally { polling = false; }
      })();
    }, settings.pollIntervalSeconds * 1000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [active, refreshAll, repo.path, settings.autoRefresh, settings.pollIntervalSeconds]);

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
      setSelectedOids(next); openCompare(next[0], next[1]); return;
    }
    setSelectedOids([oid]); loadCommit(oid);
  }, [loadCommit, openCompare, selectedOids]);

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
      if (state && state.kind !== "none") { setWorkspace("changes"); setTask({ type: "conflict" }); setMaximized(false); }
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
      if (compareBase && compareBase !== rev.oid) { openCompare(compareBase, rev.oid); setCompareBase(null); }
      else { setCompareBase(rev.oid); setMessage(`已设 ${rev.shortId} 为对比基准，右键另一提交完成对比`); }
    } else if (action === "new-branch") { setBranchStart(rev.oid); setShowBranches(true); }
    else if (action === "reset") { setResetTarget(rev.oid); }
    else if (action === "new-tag") { setTagTarget(rev.oid); setShowTags(true); }
    else if (action === "interactive-rebase") { setTask({ type: "rebase", oid: rev.oid }); setMaximized(false); }
    else {
      const labels = { "cherry-pick": "Cherry-pick", revert: "Revert", rebase: "Rebase" } as const;
      const label = labels[action];
      const body = action === "rebase" ? `将当前分支 Rebase 到 ${target}？这会重写当前分支历史。` : action === "revert" ? `为 ${target} 创建一个反向提交？` : `将 ${target} Cherry-pick 到当前分支？`;
      if (!await confirm({ title: `${label} 提交？`, body, confirmLabel: label, danger: action === "rebase", requireAck: action === "rebase", ackLabel: "我确认重写当前分支历史" })) return;
      const call = action === "cherry-pick" ? () => api.cherryPick(repo.path, rev.oid) : action === "revert" ? () => api.revert(repo.path, rev.oid) : () => api.rebase(repo.path, rev.oid);
      void runAction(call, `${label} 完成`);
    }
  }, [compareBase, confirm, openCompare, repo.path, runAction]);

  const deleteBranch = useCallback(async (branch: BranchInfo) => {
    if (!await confirm({ title: `删除分支 ${branch.name}？`, body: "Git 会先检查是否已合并。强制删除请在分支管理中单独勾选。", confirmLabel: "删除分支", danger: true })) return;
    void runAction(() => api.deleteBranch(repo.path, branch.name, false), `已删除 ${branch.name}`);
  }, [confirm, repo.path, runAction]);

  const filteredRevisions = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return revisions;
    return revisions.filter((rev) => rev.subject.toLowerCase().includes(query) || rev.authorName.toLowerCase().includes(query) || rev.oid.startsWith(query) || rev.refs.some((ref) => ref.name.toLowerCase().includes(query)));
  }, [filter, revisions]);

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
  const switchWorkspace = useCallback(async (next: Workspace) => {
    if (getRepoOperation(repo.path)) return;
    if ((task?.type === "conflict" && conflictDirty) || (task?.type === "rebase" && rebaseDirty)) {
      const isConflict = task.type === "conflict";
      const ok = await confirm({ title: isConflict ? "离开冲突编辑器？" : "离开 Rebase 计划？", body: isConflict ? "当前文件有未保存编辑。" : "当前重排、动作和提交信息编辑尚未执行。", confirmLabel: "保留草稿并切换" });
      if (!ok || getRepoOperation(repo.path)) return;
    }
    setWorkspace(next); setTask(null); setMaximized(false);
  }, [conflictDirty, confirm, rebaseDirty, repo.path, task]);
  const closeDialog = useCallback(() => {
    setResetTarget(null); setShowRecovery(false); setShowPush(false); setShowBranches(false); setShowStash(false); setShowTags(false); setShowSubmodules(false); setFileAction(null);
  }, []);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector(".modal-backdrop, .context-menu")) return;
      if (event.key === "Escape") {
        if (maximized) { setMaximized(false); return; }
        if (task) { void dismissTask(); return; }
        closeDialog(); return;
      }
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (event.key === "F5") { event.preventDefault(); if (!busyRef.current) refreshAll(); return; }
      if (mod && event.shiftKey) {
        const actions: Record<string, () => void> = {
          b: () => setShowBranches(true), s: () => setShowStash(true), t: () => setShowTags(true), m: () => setShowSubmodules(true),
          f: () => runRemote("fetch"), l: () => runRemote("pull"), p: () => runRemote("push"),
          c: () => { const oid = selectedOidsRef.current[selectedOidsRef.current.length - 1]; if (oid) void navigator.clipboard?.writeText(oid); },
        };
        if (actions[key]) { event.preventDefault(); actions[key](); }
        return;
      }
      if (mod) {
        if (key === "f") { event.preventDefault(); document.querySelector<HTMLElement>(".repo-host.active .revision-filter")?.focus(); }
        else if (key === "b") { event.preventDefault(); setLayout((prev) => ({ ...prev, showLeft: !prev.showLeft })); }
        else if (key === "1") { event.preventDefault(); void switchWorkspace("history"); }
        else if (key === "2") { event.preventDefault(); void switchWorkspace("changes"); }
        else if (key === "3") { event.preventDefault(); const selected = selectedOidsRef.current; openCompare(compareBase ?? selected[0] ?? "HEAD", selected[1] ?? "HEAD"); }
        else if (key === "s" && task?.type === "conflict") return;
        return;
      }
      if (event.key === "F6") {
        event.preventDefault();
        const areas = [...document.querySelectorAll<HTMLElement>(".repo-host.active .left-panel, .repo-host.active .revision-grid, .repo-host.active .changes-panel, .repo-host.active .inspector")];
        const index = areas.findIndex((el) => el.contains(document.activeElement));
        const area = areas[(index + (event.shiftKey ? -1 : 1) + areas.length) % areas.length];
        if (area) { if (!area.hasAttribute("tabindex")) area.setAttribute("tabindex", "-1"); area.focus(); }
        return;
      }
      const target = event.target as HTMLElement | null;
      if (!target || target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (workspace !== "history" || task || !target.closest(".revision-grid")) return;
      const selected = selectedOidsRef.current[selectedOidsRef.current.length - 1];
      const index = filteredRevisions.findIndex((rev) => rev.oid === selected);
      let next: number | null = null;
      if (event.key === "ArrowDown") next = Math.min(index + 1, filteredRevisions.length - 1);
      else if (event.key === "ArrowUp") next = Math.max(index < 0 ? 0 : index - 1, 0);
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = filteredRevisions.length - 1;
      else if (event.key === "PageDown") next = Math.min((index < 0 ? 0 : index) + 20, filteredRevisions.length - 1);
      else if (event.key === "PageUp") next = Math.max((index < 0 ? 0 : index) - 20, 0);
      else if (event.key === "Enter" && index >= 0) { event.preventDefault(); setInspectorTab("diff"); setLayout((prev) => ({ ...prev, showInspector: true })); }
      if (next !== null && filteredRevisions[next]) { event.preventDefault(); selectCommit(filteredRevisions[next].oid, false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, closeDialog, compareBase, dismissTask, filteredRevisions, maximized, openCompare, refreshAll, runRemote, selectCommit, switchWorkspace, task, workspace]);

  const refs = useMemo(() => [...branches.map((b) => b.name), ...tags.map((t) => t.name), "HEAD"], [branches, tags]);
  const tagGroups = props.tagGroups;
  const shownTags = useMemo(() => visibleTags(tagGroups, tags), [tagGroups, tags]);
  // 切组后，若提交图仍按一个已隐藏标签过滤，清除该过滤避免困惑。
  useEffect(() => {
    if (leftRef && tags.some((t) => t.name === leftRef) && !shownTags.some((t) => t.name === leftRef)) setLeftRef(null);
  }, [leftRef, shownTags, tags]);
  const changeCount = status.staged.length + status.unstaged.length;
  const compareError = useCallback((value: string) => { setMessage(value); notifyRef.current("error", "对比失败", value); }, []);
  const updateCommitDirty = useCallback((value: boolean) => setCommitDirty(value), []);
  const updateConflictDirty = useCallback((value: boolean) => setConflictDirty(value || conflictDrafts.current.size > 0), []);
  const updateRebaseDirty = useCallback((value: boolean) => setRebaseDirty(value || rebaseDrafts.current.size > 0), []);
  const verticalInspector = layout.inspectorPosition === "right";

  return (
    <div className="repo-workspace">
      <Toolbar repo={repoInfo} loading={logLoading} busy={busy} revisionCount={filteredRevisions.length} aheadBehind={aheadBehind} filter={filter} workspace={workspace} inspectorVisible={layout.showInspector}
        onFilter={setFilter} onOpen={props.onOpen} onRefresh={refreshAll} onToggleLeft={() => setLayout((prev) => ({ ...prev, showLeft: !prev.showLeft }))} onToggleInspector={() => setLayout((prev) => ({ ...prev, showInspector: !prev.showInspector }))}
        onBranches={() => { setBranchStart(undefined); setShowBranches(true); }} onStash={() => setShowStash(true)} onTags={() => { setTagTarget(undefined); setShowTags(true); }} onSubmodules={() => setShowSubmodules(true)} onSettings={props.onSettings} onRecovery={() => setShowRecovery(true)}
        onCompare={() => openCompare(compareBase ?? selectedOids[0] ?? "HEAD", "HEAD")} onRemote={runRemote} />
      <div className="workspace-body">
        {layout.showLeft && <LeftPanel branches={branches} tags={shownTags} tagGroups={tagGroups} activeRef={leftRef} workspace={workspace} changeCount={changeCount} width={layout.leftWidth} conflictCount={operation?.conflicts.length ?? 0}
          onWorkspace={(next) => { void switchWorkspace(next); }} onFilter={setLeftRef} onCheckout={(name) => void runAction(() => api.checkoutBranch(repo.path, name), `已切换到 ${name}`)} onCompare={(ref) => openCompare("HEAD", ref)}
          onNewBranch={(start) => { setBranchStart(start); setShowBranches(true); }} onDeleteBranch={deleteBranch}
          onDeleteTag={(name) => { void confirm({ title: `删除标签 ${name}？`, body: "只删除本地标签。", danger: true, confirmLabel: "删除标签" }).then((ok) => { if (ok) void runAction(async () => { await api.deleteTag(repo.path, name); props.onTagGroupsChange(forgetTag(tagGroups, name)); }, `已删除标签 ${name}`); }); }}
          onSetTagGroup={(name, groupId) => props.onTagGroupsChange(setTagGroup(tagGroups, name, groupId))}
          onSetTagAlias={(name, alias) => props.onTagGroupsChange(setTagAlias(tagGroups, name, alias))}
          onStash={() => setShowStash(true)} onSubmodules={() => setShowSubmodules(true)} />}
        {layout.showLeft && <SplitHandle direction="vertical" label="调整导航宽度" onResize={(delta) => setLayout((prev) => ({ ...prev, leftWidth: Math.min(360, Math.max(160, prev.leftWidth + delta)) }))} onReset={() => setLayout((prev) => ({ ...prev, leftWidth: 224 }))} />}
        <div className={`content-area${verticalInspector ? " horizontal" : " vertical"}`}>
          <main className="workspace-main" style={{ display: maximized ? "none" : undefined }}>
            {task?.type === "compare" && <CompareView repoPath={repo.path} initialBase={task.base} initialTarget={task.target} refs={refs} onClose={() => setTask(null)} onFileAction={onFileAction} onError={compareError} />}
            {task?.type === "rebase" && <RebasePlanner key={task.oid} repoPath={repo.path} startOid={task.oid} draft={rebaseDrafts.current.get(task.oid)} onDraftChange={saveRebaseDraft} onExit={() => setTask(null)} onConflict={showConflict} onChanged={refreshAll} onDirtyChange={updateRebaseDirty} onNotify={props.onNotify} />}
            {task?.type === "conflict" && <ConflictCenter repoPath={repo.path} drafts={conflictDrafts.current} onDraftChange={saveConflictDraft} onExit={() => setTask(null)} onChanged={refreshAll} onDirtyChange={updateConflictDirty} onNotify={props.onNotify} />}
            {!task && workspace === "history" && <RevisionGrid revisions={filteredRevisions} selectedOids={selectedOids} tagAliases={tagGroups.aliases} onSelect={selectCommit} onContextAction={(action, rev) => void onRevisionAction(action, rev)} loading={logLoading} />}
            <div className="changes-workspace" style={{ display: workspace === "changes" && !task ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
              <ChangesPanel repoPath={repo.path} status={status} width={layout.changesWidth} conflictCount={operation?.conflicts.length ?? 0} onWidth={(changesWidth) => setLayout((prev) => ({ ...prev, changesWidth }))}
                onRefresh={(historyChanged) => historyChanged ? refreshAll() : refreshWorktree()} refreshVersion={worktreeVersion} setMessage={setMessage} highlightEnabled={settings.highlightEnabled} onFileAction={onFileAction} onPathAction={onPathAction} onDiscard={discard} onOpenConflict={showConflict} onDirtyChange={updateCommitDirty} />
            </div>
          </main>
          {workspace === "history" && !task && layout.showInspector && <>
            {!maximized && <SplitHandle direction={verticalInspector ? "vertical" : "horizontal"} label="调整检查器尺寸" onResize={(delta) => setLayout((prev) => ({ ...prev, inspectorSize: Math.min(720, Math.max(180, prev.inspectorSize - delta)) }))} onReset={() => setLayout((prev) => ({ ...prev, inspectorSize: 400 }))} />}
            <section className={`inspector${maximized ? " maximized" : ""}`} style={verticalInspector && !maximized ? { width: layout.inspectorSize } : !maximized ? { height: layout.inspectorSize } : undefined} tabIndex={-1}>
              <div className="inspector-header">
                <div className="tabs" role="tablist"><button className={inspectorTab === "details" ? "active" : ""} onClick={() => setInspectorTab("details")}>详情</button><button className={inspectorTab === "diff" ? "active" : ""} onClick={() => setInspectorTab("diff")}>差异{commitDiff.length > 0 ? ` (${commitDiff.length})` : ""}</button></div>
                <button className="icon-button" title={verticalInspector ? "移动到底部" : "移动到右侧"} onClick={() => setLayout((prev) => ({ ...prev, inspectorPosition: verticalInspector ? "bottom" : "right" }))}><Icon name="panel" /></button>
                <button className="icon-button" title={maximized ? "还原 (Esc)" : "最大化"} onClick={() => setMaximized(!maximized)}>{maximized ? "↙" : "↗"}</button>
                <button className="icon-button" title="关闭检查器" onClick={() => { setMaximized(false); setLayout((prev) => ({ ...prev, showInspector: false })); }}><Icon name="close" /></button>
              </div>
              <div className="inspector-content">{inspectorTab === "details" ? <CommitInfo commit={commit} contained={contained} loading={detailLoading} tagAliases={tagGroups.aliases} /> : <DiffView files={commitDiff} loadFile={loadCommitFile} loading={detailLoading} highlightEnabled={settings.highlightEnabled} onFileAction={onCommitFileAction} />}</div>
            </section>
          </>}
        </div>
      </div>
      <div className="status-bar">
        <span className="status-branch"><Icon name="branch" size={13} />{repoInfo.headBranch ?? "detached"}{aheadBehind && ` ↑${aheadBehind.ahead} ↓${aheadBehind.behind}`}</span>
        <span className={`status-message${busy ? " busy" : ""}`} title={message}>{busy && <span className="spinner" />}{message}</span>
        <span>{filteredRevisions.length.toLocaleString()} 条</span>
        <button title="默认布局" onClick={() => setLayout(resetLayout(repo.path, settings))}>重置布局</button>
        <button title="宽 Diff 布局" onClick={() => setLayout((prev) => ({ ...prev, showLeft: false, showInspector: true, inspectorPosition: "right", inspectorSize: 640 }))}>宽 Diff</button>
        <button title="专注历史" onClick={() => { void switchWorkspace("history"); setLayout((prev) => ({ ...prev, showInspector: false })); }}>专注历史</button>
      </div>
      {resetTarget && <ResetDialog repoPath={repo.path} target={resetTarget} onClose={() => setResetTarget(null)} onChanged={refreshAll} onNotify={props.onNotify} />}
      {showRecovery && <RecoveryDialog repoPath={repo.path} onClose={() => setShowRecovery(false)} onRestore={(oid) => { setShowRecovery(false); setResetTarget(oid); }} />}
      {showPush && <PushDialog repoPath={repo.path} onClose={() => setShowPush(false)} onChanged={refreshAll} onNotify={props.onNotify} />}
      {showBranches && <BranchDialog repoPath={repo.path} branches={branches} initialStartPoint={branchStart} onClose={() => setShowBranches(false)} onChanged={refreshAll} setMessage={setMessage} />}
      {showStash && <StashDialog repoPath={repo.path} onClose={() => setShowStash(false)} onChanged={refreshAll} setMessage={setMessage} />}
      {showTags && <TagDialog repoPath={repo.path} initialTarget={tagTarget} config={tagGroups} onConfigChange={props.onTagGroupsChange} onClose={() => setShowTags(false)} onChanged={refreshAll} setMessage={setMessage} />}
      {props.showGroupManager && <TagGroupsDialog repoPath={repo.path} config={tagGroups} tags={tags} busy={busy} onChange={props.onTagGroupsChange} onClose={props.onCloseGroupManager} setMessage={setMessage} />}
      {showSubmodules && <SubmoduleDialog repoPath={repo.path} onClose={() => setShowSubmodules(false)} onChanged={refreshAll} setMessage={setMessage} />}
      {fileAction?.action === "blame" && <BlameDialog repoPath={repo.path} file={fileAction.file.path} oid={fileAction.oid} onClose={() => setFileAction(null)} />}
      {fileAction?.action === "history" && <FileHistoryDialog repoPath={repo.path} file={fileAction.file.path} highlightEnabled={settings.highlightEnabled} onClose={() => setFileAction(null)} />}
    </div>
  );
}
