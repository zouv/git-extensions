import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { getRepoOperation } from "./repoOperations";
import type { RepoInfo } from "./types";
import RepoWorkspace from "./RepoWorkspace";
import RepositoryTabs from "./components/RepositoryTabs";
import type { SessionMeta } from "./components/RepositoryTabs";
import SettingsDialog from "./components/SettingsDialog";
import NotificationCenter from "./components/NotificationCenter";
import type { Notice } from "./components/NotificationCenter";
import Dialog from "./ui/Dialog";
import Icon from "./ui/Icon";
import { ConfirmProvider, useConfirm } from "./ui/Confirm";
import { loadSettings, saveSettings } from "./settings";

const LAST_REPO_KEY = "git-extensions.lastRepo";
const RECENT_REPOS_KEY = "git-extensions.recentRepos.v2";
const TEST_REPO = import.meta.env.DEV ? import.meta.env.VITE_TEST_REPO : undefined;
function rememberActive(path: string | null) {
  if (TEST_REPO) return;
  if (path) localStorage.setItem(LAST_REPO_KEY, path);
  else localStorage.removeItem(LAST_REPO_KEY);
}
const EMPTY_META: SessionMeta = { busy: false, dirty: false, conflictCount: 0 };

function recentRepos(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_REPOS_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, 12) : [];
  } catch { return []; }
}

function AppShell() {
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>(() => TEST_REPO ? [] : recentRepos());
  const [settings, setSettings] = useState(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showOpen, setShowOpen] = useState(false);
  const [openPath, setOpenPath] = useState("");
  const [opening, setOpening] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [meta, setMeta] = useState<Record<string, SessionMeta>>({});
  const noticeId = useRef(0);
  const confirm = useConfirm();

  useEffect(() => { if (!TEST_REPO) saveSettings(settings); }, [settings]);

  const notify = useCallback((repoPath: string, kind: Notice["kind"], message: string, details?: string, repoName?: string) => {
    const id = ++noticeId.current;
    setNotices((prev) => [...prev.slice(-19), { id, repoPath, repoName: repoName ?? repoPath.split(/[\\/]/).pop() ?? repoPath, kind, message, details }]);
    if (kind === "success") window.setTimeout(() => setNotices((prev) => prev.filter((n) => n.id !== id)), 4000);
  }, []);

  const openRepo = useCallback(async (path: string) => {
    const trimmed = path.trim();
    if (!trimmed || opening) return;
    setOpening(true);
    try {
      const info = await api.openRepo(trimmed);
      setRepos((prev) => prev.some((r) => r.path === info.path) ? prev : [...prev, info]);
      setActivePath(info.path);
      rememberActive(info.path);
      setRecent((prev) => {
        const next = [info.path, ...prev.filter((p) => p !== info.path)].slice(0, 12);
        if (!TEST_REPO) localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(next));
        return next;
      });
      setShowOpen(false);
      setOpenPath("");
    } catch (e) {
      notify(trimmed, "error", "无法打开仓库", String(e), "打开仓库");
    } finally { setOpening(false); }
  }, [notify, opening]);

  useEffect(() => {
    const last = localStorage.getItem(LAST_REPO_KEY);
    if (TEST_REPO || last) void openRepo(TEST_REPO || last!);
    // 启动只恢复一个仓库，避免多个大仓库同时加载。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeRepo = useCallback(async (path: string) => {
    const state = meta[path] ?? EMPTY_META;
    if (state.busy || getRepoOperation(path)) {
      notify(path, "info", "当前仓库有操作进行中，完成后才能关闭");
      return;
    }
    if (state.dirty && !await confirm({ title: "关闭含未保存内容的仓库？", body: "提交、冲突编辑或 Rebase 计划草稿尚未保存。关闭页签不会删除仓库，但会丢弃这些界面草稿。", confirmLabel: "丢弃草稿并关闭", danger: true })) return;
    if (getRepoOperation(path)) { notify(path, "info", "当前仓库有操作进行中，完成后才能关闭"); return; }
    setRepos((prev) => {
      const index = prev.findIndex((r) => r.path === path);
      const next = prev.filter((r) => r.path !== path);
      if (path === activePath) {
        const fallback = next[Math.min(index, next.length - 1)];
        setActivePath(fallback?.path ?? null);
        rememberActive(fallback?.path ?? null);
      }
      return next;
    });
    setMeta((prev) => { const next = { ...prev }; delete next[path]; return next; });
  }, [activePath, confirm, meta, notify]);

  const closeOthers = useCallback((path: string) => {
    const closing = repos.filter((repo) => repo.path !== path && !meta[repo.path]?.busy && !getRepoOperation(repo.path) && !meta[repo.path]?.dirty);
    if (closing.length === 0) { setActivePath(path); rememberActive(path); return; }
    const paths = new Set(closing.map((repo) => repo.path));
    setRepos((prev) => prev.filter((repo) => !paths.has(repo.path)));
    setMeta((prev) => Object.fromEntries(Object.entries(prev).filter(([repoPath]) => !paths.has(repoPath))));
    setActivePath(path);
    rememberActive(path);
  }, [meta, repos]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector(".modal-backdrop, .context-menu")) return;
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        setOpenPath(activePath ?? "");
        setShowOpen(true);
      } else if (event.key.toLowerCase() === "w" && activePath) {
        event.preventDefault();
        void closeRepo(activePath);
      } else if (event.key === "Tab" && repos.length > 1) {
        event.preventDefault();
        const index = repos.findIndex((r) => r.path === activePath);
        const next = (index + (event.shiftKey ? -1 : 1) + repos.length) % repos.length;
        setActivePath(repos[next].path);
        rememberActive(repos[next].path);
      } else if (event.key === ",") {
        event.preventDefault();
        setShowSettings(true);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [activePath, closeRepo, repos]);

  const updateMeta = useCallback((path: string, value: SessionMeta) => {
    setMeta((prev) => {
      const old = prev[path];
      if (old && old.busy === value.busy && old.dirty === value.dirty && old.conflictCount === value.conflictCount) return prev;
      return { ...prev, [path]: value };
    });
  }, []);

  return (
    <div className="app">
      <RepositoryTabs
        repos={repos}
        activePath={activePath}
        meta={meta}
        onActivate={(path) => { setActivePath(path); rememberActive(path); }}
        onClose={(path) => void closeRepo(path)}
        onCloseOthers={(path) => closeOthers(path)}
        onOpen={() => { setOpenPath(""); setShowOpen(true); }}
        onCopyPath={(path) => { void navigator.clipboard?.writeText(path).then(() => notify(path, "success", "已复制仓库路径")); }}
        onReveal={(path) => { void api.revealPath(path).catch((e) => notify(path, "error", "无法打开文件管理器", String(e))); }}
      />
      {repos.map((repo) => (
        <div className={`repo-host${repo.path === activePath ? " active" : ""}`} key={repo.path} aria-hidden={repo.path !== activePath}>
          <RepoWorkspace
            repo={repo}
            active={repo.path === activePath}
            settings={settings}
            onOpen={() => { setOpenPath(repo.path); setShowOpen(true); }}
            onSettings={() => setShowSettings(true)}
            onNotify={(kind, message, details) => notify(repo.path, kind, message, details, repo.name)}
            onMeta={(value) => updateMeta(repo.path, value)}
          />
        </div>
      ))}
      {repos.length === 0 && <div className="welcome-screen">
        <Icon name="branch" size={42} />
        <h1>Git Extensions</h1>
        <p>打开一个本地 Git 仓库，开始查看历史或提交变更。</p>
        <button className="primary" onClick={() => setShowOpen(true)}><Icon name="plus" />打开仓库</button>
      </div>}
      {showOpen && <Dialog title="打开 Git 仓库" onClose={() => { if (!opening) setShowOpen(false); }} busy={opening} footer={<>
        <button disabled={opening} onClick={() => setShowOpen(false)}>取消</button>
        <button className="primary" disabled={opening || !openPath.trim()} onClick={() => void openRepo(openPath)}>{opening ? "打开中…" : "打开"}</button>
      </>}>
        <label className="field-label">仓库路径<input data-autofocus className="repo-path-input" placeholder="C:\path\to\project" value={openPath} onChange={(e) => setOpenPath(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void openRepo(openPath); }} /></label>
        {recent.length > 0 && <div className="recent-repos"><div className="section-label">最近打开</div>{recent.map((path) => <button key={path} onClick={() => setOpenPath(path)} title={path}><Icon name="history" /><span>{path}</span></button>)}</div>}
      </Dialog>}
      {showSettings && <SettingsDialog settings={settings} onSave={(next) => { setSettings(next); setShowSettings(false); }} onClose={() => setShowSettings(false)} />}
      <NotificationCenter notices={notices} onDismiss={(id) => setNotices((prev) => prev.filter((n) => n.id !== id))} onClear={() => setNotices([])} />
    </div>
  );
}

export default function App() {
  return <ConfirmProvider><AppShell /></ConfirmProvider>;
}
