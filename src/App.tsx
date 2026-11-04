import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { api } from "./api";
import { getRepoOperation } from "./repoOperations";
import type { RepoInfo, LaunchRequest, WorkspaceLaunchRequest } from "./types";
import { workspaceLaunch as makeWorkspaceLaunch } from "./launchAction";
import { explorerMenuItems } from "./explorerMenu";
import RepoWorkspace from "./RepoWorkspace";
import TitleBar from "./components/TitleBar";
import type { SessionMeta } from "./components/RepositoryTabs";
import SettingsDialog from "./components/SettingsDialog";
import NotificationCenter from "./components/NotificationCenter";
import type { Notice } from "./components/NotificationCenter";
import Dialog from "./ui/Dialog";
import Icon from "./ui/Icon";
import { ConfirmProvider, useConfirm } from "./ui/Confirm";
import { loadSettings, saveSettings } from "./settings";
import { fitWindowState, loadWindowState, saveWindowState } from "./windowState";
import type { WindowState } from "./windowState";
import { loadOpenRepos, pickActivePath, restoreCandidates, saveOpenRepos } from "./openRepos";
import type { RepoGroupConfig } from "./repoGroups";
import {
  DEFAULT_GROUP_ID, ensureGroupActive, groupForRepo, loadRepoGroups, primaryGroupId,
  saveRepoGroups, setRepoAlias, setRepoGroup, visibleRepos,
} from "./repoGroups";
import RepoGroupsDialog from "./components/RepoGroupsDialog";
import CloneDialog from "./components/CloneDialog";
import CreateRepositoryDialog from "./components/CreateRepositoryDialog";

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

function AppShell({ initialLaunches = [] }: { initialLaunches?: LaunchRequest[] }) {
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>(() => TEST_REPO ? [] : recentRepos());
  const [settings, setSettings] = useState(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [explorerIntegrationSupported, setExplorerIntegrationSupported] = useState(false);
  const [cloneParent, setCloneParent] = useState<string | null>(null);
  const [createRepositoryPath, setCreateRepositoryPath] = useState<string | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [workspaceLaunch, setWorkspaceLaunch] = useState<(WorkspaceLaunchRequest & { path: string }) | null>(null);
  const [showOpen, setShowOpen] = useState(false);
  const [openPath, setOpenPath] = useState("");
  const [openInsertAfter, setOpenInsertAfter] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [meta, setMeta] = useState<Record<string, SessionMeta>>({});
  const [repoGroups, setRepoGroups] = useState<RepoGroupConfig>(loadRepoGroups);
  const [showGroupManager, setShowGroupManager] = useState(false);
  const [sessionRestored, setSessionRestored] = useState(false);
  const [restoring, setRestoring] = useState(() => {
    if (TEST_REPO) return false;
    const stored = loadOpenRepos();
    if (stored !== null) return stored.length > 0;
    try { return localStorage.getItem(LAST_REPO_KEY) !== null; } catch { return false; }
  });
  const [mountedPaths, setMountedPaths] = useState<string[]>([]);
  const noticeId = useRef(0);
  const restoreStartedRef = useRef(false);
  const launchQueueRef = useRef<LaunchRequest[]>(initialLaunches);
  const launchProcessingRef = useRef(false);
  const [launchTick, setLaunchTick] = useState(0);
  const launchActionIdRef = useRef(0);
  const activePathRef = useRef<string | null>(null);
  activePathRef.current = activePath;
  const confirm = useConfirm();
  const windowStateRef = useRef<WindowState | null>(null);
  const windowReadyRef = useRef<Promise<void> | null>(null);
  const windowSaveTimerRef = useRef<number | null>(null);

  const flushWindowState = useCallback(async () => {
    if (windowSaveTimerRef.current !== null) {
      window.clearTimeout(windowSaveTimerRef.current);
      windowSaveTimerRef.current = null;
    }
    if (TEST_REPO) return;
    const appWindow = getCurrentWindow();
    if (await appWindow.isMinimized()) return;
    if (await appWindow.isMaximized()) {
      if (windowStateRef.current) {
        windowStateRef.current = { ...windowStateRef.current, maximized: true };
        saveWindowState(windowStateRef.current);
      }
      return;
    }
    const [size, position] = await Promise.all([appWindow.innerSize(), appWindow.outerPosition()]);
    windowStateRef.current = {
      x: position.x, y: position.y, width: size.width, height: size.height, maximized: false,
    };
    saveWindowState(windowStateRef.current);
  }, []);

  // 原生窗口先隐藏，恢复普通 bounds 后再最大化，避免启动时跳回默认尺寸。
  useEffect(() => {
    const appWindow = getCurrentWindow();
    if (!windowReadyRef.current) {
      windowReadyRef.current = (async () => {
        try {
          const saved = TEST_REPO ? null : loadWindowState();
          if (saved) {
            const monitors = await availableMonitors();
            const fitted = fitWindowState(saved, monitors.map((monitor) => ({
              x: monitor.workArea.position.x, y: monitor.workArea.position.y,
              width: monitor.workArea.size.width, height: monitor.workArea.size.height,
            })));
            windowStateRef.current = fitted;
            await appWindow.setSize(new PhysicalSize(fitted.width, fitted.height));
            await appWindow.setPosition(new PhysicalPosition(fitted.x, fitted.y));
            if (fitted.maximized) await appWindow.maximize();
          } else {
            const [size, position] = await Promise.all([appWindow.innerSize(), appWindow.outerPosition()]);
            windowStateRef.current = {
              x: position.x, y: position.y, width: size.width, height: size.height, maximized: false,
            };
          }
        } catch {
          // 几何恢复失败不应阻止应用启动。
        } finally {
          try { await appWindow.show(); } catch { /* 保留现有窗口错误处理 */ }
        }
      })();
    }

    let disposed = false;
    let unlisteners: (() => void)[] = [];
    const scheduleSave = () => {
      if (windowSaveTimerRef.current !== null) window.clearTimeout(windowSaveTimerRef.current);
      windowSaveTimerRef.current = window.setTimeout(() => {
        void flushWindowState().catch(() => { /* 下次移动、缩放或关闭时重试 */ });
      }, 200);
    };
    void windowReadyRef.current.then(async () => {
      if (disposed) return;
      const listeners = await Promise.all([appWindow.onMoved(scheduleSave), appWindow.onResized(scheduleSave)]);
      if (disposed) listeners.forEach((unlisten) => unlisten());
      else unlisteners = listeners;
    }).catch(() => { /* 不阻断仓库界面 */ });
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
      if (windowSaveTimerRef.current !== null) {
        window.clearTimeout(windowSaveTimerRef.current);
        windowSaveTimerRef.current = null;
      }
    };
  }, [flushWindowState]);

  useEffect(() => { if (!TEST_REPO) saveSettings(settings); }, [settings]);
  useEffect(() => { if (!TEST_REPO) saveRepoGroups(repoGroups); }, [repoGroups]);
  // 恢复完成前不能用空数组覆盖上次的页签列表。
  useEffect(() => {
    if (TEST_REPO || !sessionRestored) return;
    saveOpenRepos(repos.map((repo) => repo.path));
  }, [repos, sessionRestored]);

  const notify = useCallback((repoPath: string, kind: Notice["kind"], message: string, details?: string, repoName?: string) => {
    const id = ++noticeId.current;
    setNotices((prev) => [...prev.slice(-19), { id, repoPath, repoName: repoName ?? repoPath.split(/[\\/]/).pop() ?? repoPath, kind, message, details }]);
    if (kind === "success") window.setTimeout(() => setNotices((prev) => prev.filter((n) => n.id !== id)), 4000);
  }, []);

  const openRepo = useCallback(async (path: string): Promise<RepoInfo | null> => {
    const trimmed = path.trim();
    if (!trimmed || opening) return null;
    const insertAfter = openInsertAfter;
    setOpening(true);
    try {
      const info = await api.openRepo(trimmed);
      const alreadyOpen = repos.some((repo) => repo.path === info.path);
      setRepos((prev) => {
        if (prev.some((r) => r.path === info.path)) return prev;
        if (!insertAfter) return [...prev, info];
        const index = prev.findIndex((r) => r.path === insertAfter);
        if (index < 0) return [...prev, info];
        const next = [...prev];
        next.splice(index + 1, 0, info);
        return next;
      });
      // 新仓库归入当前可见的组；「在右侧打开」时归入锚点页签的组，保证相邻可见。
      setRepoGroups((prev) => {
        if (insertAfter && !alreadyOpen) {
          const anchorGroup = groupForRepo(prev, insertAfter);
          return ensureGroupActive(setRepoGroup(prev, info.path, anchorGroup), anchorGroup);
        }
        if (!Object.prototype.hasOwnProperty.call(prev.assignments, info.path)) {
          const target = prev.activeGroupIds.includes(DEFAULT_GROUP_ID) ? DEFAULT_GROUP_ID : primaryGroupId(prev);
          return setRepoGroup(prev, info.path, target);
        }
        return ensureGroupActive(prev, groupForRepo(prev, info.path));
      });
      setActivePath(info.path);
      rememberActive(info.path);
      setRecent((prev) => {
        const next = [info.path, ...prev.filter((p) => p !== info.path)].slice(0, 12);
        if (!TEST_REPO) localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(next));
        return next;
      });
      setShowOpen(false);
      setOpenPath("");
      setOpenInsertAfter(null);
      return info;
    } catch (e) {
      notify(trimmed, "error", "无法打开仓库", String(e), "打开仓库");
      return null;
    } finally { setOpening(false); }
  }, [notify, opening, openInsertAfter, repos]);

  const beginOpen = useCallback((prefill = "") => {
    setOpenInsertAfter(null);
    setOpenPath(prefill);
    setShowOpen(true);
  }, []);

  const beginOpenRightOf = useCallback((path: string) => {
    setOpenInsertAfter(path);
    setOpenPath("");
    setShowOpen(true);
  }, []);

  useEffect(() => {
    if (TEST_REPO) return;
    let alive = true;
    api.getExplorerIntegrationInfo().then((info) => { if (alive) setExplorerIntegrationSupported(info.supported); })
      .catch((error) => notify("", "error", "无法读取系统集成能力", String(error)));
    return () => { alive = false; };
  }, [notify]);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | null = null;
    const drain = async () => {
      try {
        const next = await api.takePendingLaunches();
        if (!alive || next.length === 0) return;
        launchQueueRef.current.push(...next);
        setLaunchTick((value) => value + 1);
      } catch (error) {
        if (alive) notify("", "error", "无法读取主窗口启动请求", String(error));
      }
    };
    void (async () => {
      const dispose = await listen("main-launch-available", () => { void drain(); });
      if (!alive) { dispose(); return; }
      unlisten = dispose;
      // 先订阅再排空，避免请求恰好落在“排空后、订阅前”的窗口期。
      await drain();
    })().catch((error) => {
      if (alive) notify("", "error", "无法订阅主窗口启动请求", String(error));
    });
    return () => { alive = false; unlisten?.(); };
  }, [notify]);

  useEffect(() => {
    if (!sessionRestored || opening || launchProcessingRef.current) return;
    const request = launchQueueRef.current.shift();
    if (!request) return;
    launchProcessingRef.current = true;
    setLaunchTick((value) => value + 1);
    void (async () => {
      if (request.action === "settings") { setShowSettings(true); return; }
      if (request.action === "clone") { setCloneParent(request.path); return; }
      if (request.action === "create-repository") { setCreateRepositoryPath(request.path); return; }
      if (!request.path) throw new Error("启动动作缺少目录参数");
      const info = await openRepo(request.path);
      if (!info) {
        if (request.action === "open-repository") beginOpen(request.path);
        return;
      }
      const launch = makeWorkspaceLaunch(request, info.path, ++launchActionIdRef.current);
      if (launch) setWorkspaceLaunch(launch);
    })().catch((error) => notify("", "error", "无法处理资源管理器启动动作", String(error)))
      .finally(() => {
        launchProcessingRef.current = false;
        setLaunchTick((value) => value + 1);
      });
  }, [beginOpen, notify, openRepo, opening, sessionRestored, launchTick]);

  const saveSettingsDialog = useCallback(async (next: typeof settings) => {
    const explorerChanged = next.explorerContextMenuEnabled !== settings.explorerContextMenuEnabled
      || next.explorerAlwaysShowAllCommands !== settings.explorerAlwaysShowAllCommands
      || JSON.stringify(next.explorerContextMenuPlacements) !== JSON.stringify(settings.explorerContextMenuPlacements);
    if ((next.explorerContextMenuEnabled || settings.explorerContextMenuEnabled)
      && (next.explorerContextMenuEnabled || explorerChanged)) {
      if (TEST_REPO) throw new Error("测试模式不允许修改资源管理器菜单");
      await api.setExplorerContextMenuEnabled(
        next.explorerContextMenuEnabled,
        explorerMenuItems(next.explorerContextMenuPlacements),
        next.explorerAlwaysShowAllCommands,
      );
    }
    setSettings(next);
    setShowSettings(false);
  }, [settings]);

  // 启动恢复上次打开的全部仓库页签；只取 RepoInfo，Git 数据等页签激活后再加载。
  useEffect(() => {
    if (restoreStartedRef.current) return;
    restoreStartedRef.current = true;

    if (TEST_REPO) {
      setSessionRestored(true);
      void openRepo(TEST_REPO);
      return;
    }

    const stored = loadOpenRepos();
    let last: string | null = null;
    try { last = localStorage.getItem(LAST_REPO_KEY); } catch { /* localStorage 不可用 */ }
    const candidates = restoreCandidates(stored, last);
    if (candidates.length === 0) {
      if (activePathRef.current === null) rememberActive(null);
      setSessionRestored(true);
      setRestoring(false);
      return;
    }

    void (async () => {
      const restored: RepoInfo[] = [];
      const failed: { path: string; error: string }[] = [];
      for (const path of candidates) {
        try {
          const info = await api.openRepo(path);
          if (!restored.some((repo) => repo.path === info.path)) restored.push(info);
        } catch (error) {
          failed.push({ path, error: String(error) });
        }
      }
      const target = pickActivePath(restored.map((repo) => repo.path), last);
      if (restored.length > 0) {
        setRepos((prev) => {
          if (prev.length === 0) return restored;
          const merged = new Map(restored.map((repo) => [repo.path, repo] as const));
          for (const repo of prev) if (!merged.has(repo.path)) merged.set(repo.path, repo);
          return [...merged.values()];
        });
        // 恢复期间用户已手动打开并激活仓库时，不覆盖其活动页签。
        if (activePathRef.current === null && target) {
          setActivePath(target);
          rememberActive(target);
          setRepoGroups((prev) => ensureGroupActive(prev, groupForRepo(prev, target)));
        }
      } else if (activePathRef.current === null) {
        rememberActive(null);
      }
      // 先更新页签，再解锁持久化，避免用旧列表覆盖保存值。
      setSessionRestored(true);
      setRestoring(false);
      if (failed.length > 0) {
        notify(failed[0].path, "error", `${failed.length} 个仓库页签无法恢复，已跳过`,
          failed.map(({ path, error }) => `${path}\n${error}`).join("\n\n"), "启动恢复");
      }
    })().catch((error) => {
      setSessionRestored(true);
      setRestoring(false);
      notify("", "error", "恢复仓库页签失败", String(error), "启动恢复");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shownRepos = useMemo(() => visibleRepos(repoGroups, repos), [repoGroups, repos]);
  // 恢复的页签先只挂载活动仓库，其余页签首次激活时才挂载并加载 Git 数据。
  const mounted = useMemo(
    () => new Set([...mountedPaths, ...(activePath ? [activePath] : [])]),
    [mountedPaths, activePath],
  );
  useEffect(() => {
    if (!activePath) return;
    setMountedPaths((prev) => prev.includes(activePath) ? prev : [...prev, activePath]);
  }, [activePath]);
  useEffect(() => {
    setMountedPaths((prev) => {
      const open = new Set(repos.map((repo) => repo.path));
      const next = prev.filter((path) => open.has(path));
      return next.length === prev.length ? prev : next;
    });
  }, [repos]);
  // 切换分组后若当前活动仓库被隐藏，自动切到该组第一个可见页签；空组则清空活动页签。
  useEffect(() => {
    if (activePath && shownRepos.some((repo) => repo.path === activePath)) return;
    const fallback = shownRepos[0]?.path ?? null;
    if (fallback !== activePath) { setActivePath(fallback); rememberActive(fallback); }
  }, [activePath, shownRepos]);

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
    const closing = shownRepos.filter((repo) => repo.path !== path && !meta[repo.path]?.busy && !getRepoOperation(repo.path) && !meta[repo.path]?.dirty);
    if (closing.length === 0) { setActivePath(path); rememberActive(path); return; }
    const paths = new Set(closing.map((repo) => repo.path));
    setRepos((prev) => prev.filter((repo) => !paths.has(repo.path)));
    setMeta((prev) => Object.fromEntries(Object.entries(prev).filter(([repoPath]) => !paths.has(repoPath))));
    setActivePath(path);
    rememberActive(path);
  }, [meta, shownRepos]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector(".modal-backdrop, .context-menu")) return;
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        beginOpen(activePath ?? "");
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
  }, [activePath, beginOpen, closeRepo, repos]);

  const updateMeta = useCallback((path: string, value: SessionMeta) => {
    setMeta((prev) => {
      const old = prev[path];
      if (old && old.busy === value.busy && old.dirty === value.dirty && old.conflictCount === value.conflictCount) return prev;
      return { ...prev, [path]: value };
    });
  }, []);

  const updateRepoGroups = useCallback((next: RepoGroupConfig) => setRepoGroups(next), []);

  // 页签栏可能只显示部分分组；只重排可见页签占用的槽位，隐藏页签保持原位。
  const reorderRepos = useCallback((orderedVisiblePaths: string[]) => {
    setRepos((prev) => {
      const visible = new Set(orderedVisiblePaths);
      const currentVisible = prev.filter((repo) => visible.has(repo.path));
      if (currentVisible.length !== orderedVisiblePaths.length) return prev;
      if (orderedVisiblePaths.some((path) => !currentVisible.some((repo) => repo.path === path))) return prev;
      const byPath = new Map(prev.map((repo) => [repo.path, repo]));
      const queue = [...orderedVisiblePaths];
      const next = prev.map((repo) => visible.has(repo.path) ? byPath.get(queue.shift()!)! : repo);
      return next.some((repo, index) => repo !== prev[index]) ? next : prev;
    });
  }, []);

  // 窗口关闭保护：任一仓库有未保存草稿或写操作进行中时需确认。
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const allowCloseRef = useRef(false);
  const closeWindow = useCallback(async () => {
    const entries = Object.entries(metaRef.current);
    const anyDirty = entries.some(([, m]) => m.dirty);
    const anyBusy = lifecycleBusy || entries.some(([, m]) => m.busy);
    if (anyBusy && !anyDirty) { notify(activePath ?? "", "info", "有仓库操作进行中，完成后才能关闭窗口"); return; }
    if (anyDirty || anyBusy) {
      const ok = await confirm({ title: "关闭应用？", body: "有仓库存在未保存草稿或正在执行的操作。关闭窗口会丢弃界面草稿（不会删除仓库），进行中的 Git 写操作可能在后台完成。", confirmLabel: "退出", danger: true });
      if (!ok) return;
    }
    try { await flushWindowState(); } catch { /* 状态保存失败不阻止退出 */ }
    allowCloseRef.current = true;
    try {
      await getCurrentWindow().close();
    } catch (error) {
      allowCloseRef.current = false;
      notify(activePath ?? "", "error", "无法关闭窗口", String(error));
    }
  }, [activePath, confirm, notify, lifecycleBusy, flushWindowState]);

  // 兜底：系统途径关窗（Alt+F4 等）同样拦截；确认后放行避免循环。
  useEffect(() => {
    let guarding = false;
    const unlisten = getCurrentWindow().onCloseRequested((event) => {
      if (allowCloseRef.current) return;
      // Tauri 会在异步处理器结束后自动 destroy；所有系统关闭都先拦截再统一保存状态。
      event.preventDefault();
      if (guarding) return;
      guarding = true;
      void closeWindow().finally(() => { guarding = false; });
    });
    return () => { void unlisten.then((f) => f()); };
  }, [closeWindow]);

  return (
    <div className="app">
      <TitleBar
        repos={shownRepos}
        activePath={activePath}
        meta={meta}
        repoGroups={repoGroups}
        onActivate={(path) => { setActivePath(path); rememberActive(path); }}
        onClose={(path) => void closeRepo(path)}
        onCloseOthers={(path) => closeOthers(path)}
        onOpen={() => beginOpen()}
        onOpenRightOf={beginOpenRightOf}
        onSettings={() => setShowSettings(true)}
        onCopyPath={(path) => { void navigator.clipboard?.writeText(path).then(() => notify(path, "success", "已复制仓库路径")); }}
        onReveal={(path) => { void api.revealPath(path).catch((e) => notify(path, "error", "无法打开文件管理器", String(e))); }}
        onReorderRepo={reorderRepos}
        onRepoGroupsChange={updateRepoGroups}
        onSetRepoAlias={(path, alias) => updateRepoGroups(setRepoAlias(repoGroups, path, alias))}
        onManageGroups={() => setShowGroupManager(true)}
        onCloseWindow={() => void closeWindow()}
      />
      {repos.filter((repo) => mounted.has(repo.path)).map((repo) => (
        <div className={`repo-host${repo.path === activePath ? " active" : ""}`} key={repo.path} aria-hidden={repo.path !== activePath}>
          <RepoWorkspace
            repo={repo}
            active={repo.path === activePath}
            settings={settings}
            onOpen={() => beginOpen(repo.path)}
            onSettings={() => setShowSettings(true)}
            onNotify={(kind, message, details) => notify(repo.path, kind, message, details, repo.name)}
            onMeta={(value) => updateMeta(repo.path, value)}
            launchAction={workspaceLaunch?.path === repo.path ? workspaceLaunch : null}
            onLaunchActionConsumed={() => setWorkspaceLaunch((current) => current?.path === repo.path ? null : current)}
          />
        </div>
      ))}
      {restoring && repos.length === 0 && <div className="welcome-screen">
        <Icon name="history" size={42} />
        <h1>正在恢复上次打开的仓库…</h1>
        <p>仅加载当前活动页签，其余页签切换时再读取数据。</p>
      </div>}
      {repos.length > 0 && shownRepos.length === 0 && <div className="welcome-screen">
        <Icon name="group" size={42} />
        <h1>当前分组没有仓库页签</h1>
        <p>切换分组或在「管理分组…」中把仓库页签移入当前组。</p>
        <button onClick={() => setShowGroupManager(true)}><Icon name="group" />管理分组</button>
      </div>}
      {repos.length === 0 && !restoring && <div className="welcome-screen">
        <Icon name="branch" size={42} />
        <h1>Git Extensions</h1>
        <p>打开一个本地 Git 仓库，开始查看历史或提交变更。</p>
        <button className="primary" onClick={() => beginOpen()}><Icon name="plus" />打开仓库</button>
      </div>}
      {showGroupManager && <RepoGroupsDialog config={repoGroups} repos={repos} onChange={updateRepoGroups} onClose={() => setShowGroupManager(false)} />}
      {showOpen && <Dialog title="打开 Git 仓库" onClose={() => { if (!opening) { setShowOpen(false); setOpenInsertAfter(null); } }} busy={opening} footer={<>
        <button disabled={opening} onClick={() => { setShowOpen(false); setOpenInsertAfter(null); }}>取消</button>
        <button className="primary" disabled={opening || !openPath.trim()} onClick={() => void openRepo(openPath)}>{opening ? "打开中…" : "打开"}</button>
      </>}>
        <label className="field-label">仓库路径<input data-autofocus className="repo-path-input" placeholder="C:\path\to\project" value={openPath} onChange={(e) => setOpenPath(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void openRepo(openPath); }} /></label>
        {recent.length > 0 && <div className="recent-repos"><div className="section-label">最近打开</div>{recent.map((path) => <button key={path} onClick={() => setOpenPath(path)} title={path}><Icon name="history" /><span>{path}</span></button>)}</div>}
      </Dialog>}
      {showSettings && <SettingsDialog settings={settings} explorerIntegrationSupported={!TEST_REPO && explorerIntegrationSupported} onSave={saveSettingsDialog} onClose={() => setShowSettings(false)} />}
      {cloneParent !== null && <CloneDialog initialParent={cloneParent} onOpen={openRepo} onClose={() => setCloneParent(null)} onBusyChange={setLifecycleBusy} />}
      {createRepositoryPath !== null && <CreateRepositoryDialog initialPath={createRepositoryPath} onOpen={openRepo} onClose={() => setCreateRepositoryPath(null)} onBusyChange={setLifecycleBusy} />}
      <NotificationCenter notices={notices} onDismiss={(id) => setNotices((prev) => prev.filter((n) => n.id !== id))} onClear={() => setNotices([])} />
    </div>
  );
}

export default function App({ initialLaunches = [] }: { initialLaunches?: LaunchRequest[] }) {
  return <ConfirmProvider><AppShell initialLaunches={initialLaunches} /></ConfirmProvider>;
}
