import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, onLogBatch } from "./api";
import type {
  AheadBehind,
  BranchInfo,
  CommitDetail,
  ContainedInfo,
  FileDiff,
  RepoInfo,
  Revision,
  StatusSnapshot,
  TagInfo,
} from "./types";
import Toolbar from "./components/Toolbar";
import RevisionGrid from "./components/RevisionGrid";
import CommitInfo from "./components/CommitInfo";
import DiffView from "./components/DiffView";
import ChangesPanel from "./components/ChangesPanel";
import BranchDialog from "./components/BranchDialog";
import StashDialog from "./components/StashDialog";
import TagDialog from "./components/TagDialog";
import SubmoduleDialog from "./components/SubmoduleDialog";
import LeftPanel from "./components/LeftPanel";
import BlameDialog from "./components/BlameDialog";
import FileHistoryDialog from "./components/FileHistoryDialog";
import SettingsDialog from "./components/SettingsDialog";
import { loadSettings, saveSettings } from "./settings";

type Tab = "commit" | "diff" | "changes";

const EMPTY_STATUS: StatusSnapshot = { staged: [], unstaged: [] };
const LAST_REPO_KEY = "git-extensions.lastRepo";

/** 开发期日志：生产构建完全移除，避免刷屏。 */
function debug(...args: unknown[]) {
  if (import.meta.env.DEV) console.log("[git-extensions]", ...args);
}

export default function App() {
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [selectedOid, setSelectedOid] = useState<string | null>(null);
  const [commit, setCommit] = useState<CommitDetail | null>(null);
  const [commitDiff, setCommitDiff] = useState<FileDiff[]>([]);
  const [contained, setContained] = useState<ContainedInfo | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("commit");
  const [status, setStatus] = useState<StatusSnapshot>(EMPTY_STATUS);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [aheadBehind, setAheadBehind] = useState<AheadBehind | null>(null);
  const [showBranches, setShowBranches] = useState(false);
  const [showStash, setShowStash] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [showSubmodules, setShowSubmodules] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [openRequest, setOpenRequest] = useState(0);
  const [settings, setSettings] = useState(loadSettings);
  const [leftRef, setLeftRef] = useState<string | null>(null);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [fileAction, setFileAction] = useState<{ action: "history" | "blame"; file: FileDiff; oid?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [message, setMessage] = useState("");

  const requestIdRef = useRef(0);
  const selectionRef = useRef(0);
  const headOidRef = useRef("");
  const repoRef = useRef<RepoInfo | null>(null);
  const statusRef = useRef<StatusSnapshot>(EMPTY_STATUS);
  const busyRef = useRef(false);
  const settingsRef = useRef(settings);
  const logListenReadyRef = useRef<Promise<unknown> | null>(null);
  repoRef.current = repo;
  statusRef.current = status;
  busyRef.current = busy;
  settingsRef.current = settings;

  useEffect(() => saveSettings(settings), [settings]);

  // 开发期诊断：把前端关键状态写入后端日志，便于自动化复测。
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    void api.reportFrontendState(JSON.stringify({ revisions: revisions.length, logLoading, requestId: requestIdRef.current }));
  }, [revisions.length, logLoading]);

  // 日志流订阅只挂一次；过期批次（切换仓库 / 再次刷新）直接丢弃
  useEffect(() => {
    const unlisten = onLogBatch((batch) => {
      debug("log-batch", { requestId: batch.requestId, current: requestIdRef.current, count: batch.revisions.length, done: batch.done, error: batch.error });
      if (Number(batch.requestId) !== requestIdRef.current) return;
      if (batch.error) {
        setMessage(batch.error);
        setLogLoading(false);
        return;
      }
      if (batch.revisions.length > 0) {
        setRevisions((prev) => [...prev, ...batch.revisions]);
      }
      if (batch.done) setLogLoading(false);
    });
    logListenReadyRef.current = unlisten;
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  /** 等事件监听注册完成后再启动日志流，避免开发模式 StrictMode 下的竞态丢批次。 */
  const startLogWhenReady = useCallback((path: string, id: number, maxCount: number, revspec?: string | null) => {
    debug("startLog", { path, id, maxCount, revspec });
    void Promise.resolve(logListenReadyRef.current)
      .then(() => api.startLog(path, id, maxCount, revspec))
      .catch((e) => {
        if (import.meta.env.DEV) void api.reportFrontendState(JSON.stringify({ startLogError: String(e) }));
        setMessage(String(e));
        setLogLoading(false);
      });
  }, []);

  const refreshAux = useCallback((path: string) => {
    void api.getBranches(path).then((bs) => {
      setBranches(bs);
      const head = bs.find((b) => b.isHead);
      if (head) headOidRef.current = head.oid;
    }).catch((e) => setMessage(String(e)));
    void api.getStatus(path).then(setStatus).catch((e) => setMessage(String(e)));
    void api.getAheadBehind(path).then(setAheadBehind).catch(() => undefined);
    void api.tagList(path).then(setTags).catch(() => undefined);
  }, []);

  const refreshAll = useCallback(() => {
    const current = repoRef.current;
    if (!current) return;
    const id = ++requestIdRef.current;
    setRevisions([]);
    setLogLoading(true);
    setCommit(null);
    setCommitDiff([]);
    setContained(null);
    setSelectedOid(null);
    startLogWhenReady(current.path, id, settings.maxLogCount, leftRef);
    refreshAux(current.path);
    void api.openRepo(current.path).then(setRepo).catch(() => undefined);
  }, [refreshAux, leftRef, settings.maxLogCount, startLogWhenReady]);

  const openRepo = useCallback((path: string) => {
    if (import.meta.env.DEV) void api.reportFrontendState(JSON.stringify({ openRepoStart: path }));
    // 使旧的日志流立即失效，再打开新仓库
    ++requestIdRef.current;
    api
      .openRepo(path)
      .then((info) => {
        if (import.meta.env.DEV) void api.reportFrontendState(JSON.stringify({ openRepoDone: info.path }));
        setRepo(info);
        localStorage.setItem(LAST_REPO_KEY, info.path);
        setMessage(`已打开 ${info.path}`);
        repoRef.current = info;
        const id = ++requestIdRef.current;
        setRevisions([]);
        setLogLoading(true);
        setCommit(null);
        setCommitDiff([]);
        setContained(null);
        setSelectedOid(null);
        setLeftRef(null);
        setFilter("");
        startLogWhenReady(info.path, id, settingsRef.current.maxLogCount);
        refreshAux(info.path);
      })
      .catch((e) => {
        if (import.meta.env.DEV) void api.reportFrontendState(JSON.stringify({ openRepoError: String(e) }));
        setMessage(String(e));
      });
  }, [refreshAux, startLogWhenReady]);

  useEffect(() => {
    const last = localStorage.getItem(LAST_REPO_KEY);
    if (import.meta.env.DEV) {
      void api.reportFrontendState(JSON.stringify({ init: true, last, testRepo: import.meta.env.VITE_TEST_REPO }));
    }
    if (import.meta.env.DEV && import.meta.env.VITE_TEST_REPO) {
      // 自动化复测入口：通过 VITE_TEST_REPO 指定仓库，避免手动操作 GUI。
      openRepo(import.meta.env.VITE_TEST_REPO);
    } else if (last) {
      openRepo(last);
    }
  }, [openRepo]);

  // 设置中的日志上限变化后重载，其余设置即时生效。
  const prevMaxLogCount = useRef(settings.maxLogCount);
  useEffect(() => {
    if (prevMaxLogCount.current === settings.maxLogCount) return;
    prevMaxLogCount.current = settings.maxLogCount;
    refreshAll();
  }, [settings.maxLogCount, refreshAll]);

  // 左侧面板切换 ref 过滤：仅在实际变化时重载日志
  const prevLeftRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevLeftRef.current === leftRef) return;
    prevLeftRef.current = leftRef;
    refreshAll();
  }, [leftRef, refreshAll]);

  // 工作区轮询：仅窗口可见且无操作进行中时；HEAD 移动才触发全量刷新，
  // 状态快照只在真正变化时更新，避免打断用户勾选 / 输入。
  useEffect(() => {
    if (!repo || !settings.autoRefresh) return;
    const timer = setInterval(() => {
      const current = repoRef.current;
      if (!current || busyRef.current || document.visibilityState !== "visible") return;
      void (async () => {
        try {
          const snap = await api.getStatus(current.path);
          if (JSON.stringify(snap) !== JSON.stringify(statusRef.current)) {
            setStatus(snap);
          }
          const bs = await api.getBranches(current.path);
          const head = bs.find((b) => b.isHead);
          if (head && headOidRef.current && head.oid !== headOidRef.current) {
            refreshAll();
          }
        } catch {
          // 轮询失败（仓库被删 / 锁冲突等）静默忽略，下轮再试
        }
      })();
    }, settings.pollIntervalSeconds * 1000);
    return () => clearInterval(timer);
  }, [repo, refreshAll, settings.autoRefresh, settings.pollIntervalSeconds]);

  const selectCommit = useCallback((oid: string) => {
    const current = repoRef.current;
    if (!current) return;
    setSelectedOid(oid);
    const sel = ++selectionRef.current;
    setDetailLoading(true);
    // 详情 / diff / contained-in 并行加载；快速连点只保留最后一次选择的结果
    Promise.all([
      api.getCommit(current.path, oid),
      api.getCommitDiff(current.path, oid),
      api.getContainedIn(current.path, oid).catch(() => null),
    ])
      .then(([detail, diff, contains]) => {
        if (selectionRef.current !== sel) return;
        setCommit(detail);
        setCommitDiff(diff);
        setContained(contains);
        setDetailLoading(false);
      })
      .catch((e) => {
        if (selectionRef.current !== sel) return;
        setMessage(String(e));
        setDetailLoading(false);
      });
  }, []);

  /** 写操作统一入口：防重入，成功后全量刷新，错误上状态栏。 */
  const runAction = useCallback(async (action: () => Promise<unknown>, success: string) => {
    if (busyRef.current) return;
    setBusy(true);
    try {
      await action();
      setMessage(success);
      refreshAll();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }, [refreshAll]);

  const runRemote = useCallback((kind: "fetch" | "pull" | "push") => {
    const current = repoRef.current;
    if (!current) return;
    const label = kind === "fetch" ? "Fetch" : kind === "pull" ? "Pull" : "Push";
    void runAction(() => api[kind](current.path), `${label} 完成`);
  }, [runAction]);

  const onContextAction = useCallback((action: "cherry-pick" | "revert" | "rebase", rev: Revision) => {
    const current = repoRef.current;
    if (!current) return;
    const target = `${rev.shortId} ${rev.subject}`;
    if (action === "cherry-pick") {
      if (!window.confirm(`Cherry-pick ${target} 到当前分支？`)) return;
      void runAction(() => api.cherryPick(current.path, rev.oid), "Cherry-pick 完成");
    } else if (action === "revert") {
      if (!window.confirm(`Revert ${target}（生成一个反向提交）？`)) return;
      void runAction(() => api.revert(current.path, rev.oid), "Revert 完成");
    } else {
      if (!window.confirm(`将当前分支 rebase 到 ${target}？\n冲突时需到命令行解决。`)) return;
      void runAction(() => api.rebase(current.path, rev.oid), "Rebase 完成");
    }
  }, [runAction]);

  const filteredRevisions = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return revisions;
    return revisions.filter(
      (r) =>
        r.subject.toLowerCase().includes(q) ||
        r.authorName.toLowerCase().includes(q) ||
        r.oid.startsWith(q) ||
        r.refs.some((ref) => ref.name.toLowerCase().includes(q)),
    );
  }, [revisions, filter]);

  // 全局快捷键；输入控件内只响应带修饰键的操作，不抢方向键与 Home/End。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowBranches(false);
        setShowStash(false);
        setShowTags(false);
        setShowSubmodules(false);
        setShowSettings(false);
        setFileAction(null);
        return;
      }
      if (showBranches || showStash || showTags || showSubmodules || showSettings || fileAction) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const current = repoRef.current;

      if (e.key === "F5") {
        e.preventDefault();
        if (!busyRef.current) refreshAll();
      } else if (mod && e.shiftKey && current) {
        const actions: Record<string, () => void> = {
          b: () => setShowBranches(true),
          s: () => setShowStash(true),
          t: () => setShowTags(true),
          m: () => setShowSubmodules(true),
          f: () => runRemote("fetch"),
          l: () => runRemote("pull"),
          p: () => runRemote("push"),
          c: () => {
            if (!selectedOid) return;
            if (!navigator.clipboard) {
              setMessage("当前环境不支持剪贴板访问");
              return;
            }
            void navigator.clipboard.writeText(selectedOid)
              .then(() => setMessage("已复制完整提交 SHA"))
              .catch((err) => setMessage(String(err)));
          },
        };
        if (actions[key]) {
          e.preventDefault();
          actions[key]();
        }
      } else if (mod) {
        if (key === "o") {
          e.preventDefault();
          setOpenRequest((n) => n + 1);
        } else if (key === "f") {
          e.preventDefault();
          document.getElementById("revision-filter")?.focus();
        } else if (key === "b" && current) {
          e.preventDefault();
          setSettings((prev) => ({ ...prev, showLeftPanel: !prev.showLeftPanel }));
        } else if (key === ",") {
          e.preventDefault();
          setShowSettings(true);
        } else if (current && ["1", "2", "3"].includes(key)) {
          e.preventDefault();
          setTab(key === "1" ? "commit" : key === "2" ? "diff" : "changes");
        }
      } else if (current) {
        const target = e.target as HTMLElement | null;
        if (target?.isContentEditable || target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT") return;
        const index = filteredRevisions.findIndex((r) => r.oid === selectedOid);
        let next: number | null = null;
        if (e.key === "ArrowDown") next = Math.min(index + 1, filteredRevisions.length - 1);
        else if (e.key === "ArrowUp") next = Math.max(index < 0 ? 0 : index - 1, 0);
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = filteredRevisions.length - 1;
        else if (e.key === "PageDown") next = Math.min((index < 0 ? 0 : index) + 20, filteredRevisions.length - 1);
        else if (e.key === "PageUp") next = Math.max((index < 0 ? 0 : index) - 20, 0);
        else if (e.key === "Enter" && index >= 0) {
          e.preventDefault();
          setTab("diff");
        }
        if (next !== null && filteredRevisions[next]) {
          e.preventDefault();
          selectCommit(filteredRevisions[next].oid);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fileAction, filteredRevisions, refreshAll, runRemote, selectCommit, selectedOid, showBranches, showSettings, showStash, showSubmodules, showTags]);

  return (
    <div className="app">
      <Toolbar
        repo={repo}
        loading={logLoading}
        busy={busy}
        revisionCount={filteredRevisions.length}
        aheadBehind={aheadBehind}
        filter={filter}
        onFilter={setFilter}
        onOpen={openRepo}
        openRequest={openRequest}
        onRefresh={refreshAll}
        onToggleLeft={() => setSettings((prev) => ({ ...prev, showLeftPanel: !prev.showLeftPanel }))}
        onBranches={() => setShowBranches(true)}
        onStash={() => setShowStash(true)}
        onTags={() => setShowTags(true)}
        onSubmodules={() => setShowSubmodules(true)}
        onSettings={() => setShowSettings(true)}
        onRemote={runRemote}
      />
      <div className="main-area">
        {settings.showLeftPanel && repo && (
          <LeftPanel
            branches={branches}
            tags={tags}
            activeRef={leftRef}
            onFilter={setLeftRef}
            onCheckout={(name) => void runAction(() => api.checkoutBranch(repo.path, name), `已切换到 ${name}`)}
            onClose={() => setSettings((prev) => ({ ...prev, showLeftPanel: false }))}
          />
        )}
        <RevisionGrid
          revisions={filteredRevisions}
          selectedOid={selectedOid}
          onSelect={selectCommit}
          onContextAction={onContextAction}
          loading={logLoading}
        />
      </div>
      <div className="bottom-area">
        <div className="tabs">
          <button className={tab === "commit" ? "active" : ""} onClick={() => setTab("commit")}>提交</button>
          <button className={tab === "diff" ? "active" : ""} onClick={() => setTab("diff")}>
            差异{commitDiff.length > 0 ? ` (${commitDiff.length})` : ""}
          </button>
          <button className={tab === "changes" ? "active" : ""} onClick={() => setTab("changes")}>
            变更{status.unstaged.length + status.staged.length > 0
              ? ` (${status.unstaged.length + status.staged.length})`
              : ""}
          </button>
        </div>
        <div className="tab-content">
          {tab === "commit" && <CommitInfo commit={commit} contained={contained} loading={detailLoading} />}
          {tab === "diff" && <DiffView files={commitDiff} loading={detailLoading} highlightEnabled={settings.highlightEnabled} onFileAction={(action, file) => setFileAction({ action, file, oid: selectedOid ?? undefined })} />}
          {tab === "changes" && repo && (
            <ChangesPanel
              repoPath={repo.path}
              status={status}
              onRefresh={refreshAll}
              setMessage={setMessage}
              highlightEnabled={settings.highlightEnabled}
              onFileAction={(action, file) => setFileAction({ action, file })}
            />
          )}
        </div>
      </div>
      <div className="status-bar">{message || "就绪"}</div>
      {showBranches && repo && (
        <BranchDialog
          repoPath={repo.path}
          branches={branches}
          onClose={() => setShowBranches(false)}
          onChanged={refreshAll}
          setMessage={setMessage}
        />
      )}
      {showStash && repo && (
        <StashDialog
          repoPath={repo.path}
          onClose={() => setShowStash(false)}
          onChanged={refreshAll}
          setMessage={setMessage}
        />
      )}
      {showTags && repo && (
        <TagDialog
          repoPath={repo.path}
          onClose={() => setShowTags(false)}
          onChanged={refreshAll}
          setMessage={setMessage}
        />
      )}
      {showSubmodules && repo && (
        <SubmoduleDialog
          repoPath={repo.path}
          onClose={() => setShowSubmodules(false)}
          onChanged={refreshAll}
          setMessage={setMessage}
        />
      )}
      {showSettings && (
        <SettingsDialog
          settings={settings}
          onSave={(next) => {
            setSettings(next);
            setShowSettings(false);
            setMessage("设置已保存");
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
      {fileAction && repo && fileAction.action === "blame" && (
        <BlameDialog repoPath={repo.path} file={fileAction.file.path} oid={fileAction.oid} onClose={() => setFileAction(null)} />
      )}
      {fileAction && repo && fileAction.action === "history" && (
        <FileHistoryDialog repoPath={repo.path} file={fileAction.file.path} highlightEnabled={settings.highlightEnabled} onClose={() => setFileAction(null)} />
      )}
    </div>
  );
}
