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
import { hasDirtyDialogs } from "./dialogState";
import { fitWindowState, loadWindowState, saveWindowState } from "./windowState";
import type { WindowState } from "./windowState";
import { loadOpenRepos, restoreCandidates, sanitizeRecentRepos, saveOpenRepos } from "./openRepos";
import { canonicalActivePath, closeBlockedPaths, newRepositoryGroup } from "./repositorySession";
import type { RepoGroupConfig } from "./repoGroups";
import {
  ensureGroupActive, groupForPinShortcut, groupForRepo, loadRepoGroups,
  displayRepoName, saveRepoGroups, setRepoAlias, setRepoGroup, visibleRepos,
  rememberGroupActive, pickVisibleActive, selectGroup, relocateRepoConfig,
} from "./repoGroups";
import {
  loadRepositoryRecords, saveRepositoryRecords, recordRepository, removeRepositoryRecords,
  relocateRepositoryRecord, repositoryName,
} from "./repositoryRecords";
import type { RepositoryRecord } from "./repositoryRecords";
import RepositorySearchDialog from "./components/RepositorySearchDialog";
import RepoGroupsDialog from "./components/RepoGroupsDialog";
import CloneDialog from "./components/CloneDialog";
import CreateRepositoryDialog from "./components/CreateRepositoryDialog";
import CommandPalette from "./components/CommandPalette";
import { registerCommands, unregisterCommands } from "./commands";
import type { Command } from "./commands";
import { pickDirectory } from "./nativeDialog";

const LAST_REPO_KEY = "git-extensions.lastRepo";
const RECENT_REPOS_KEY = "git-extensions.recentRepos.v2";
const TEST_REPO = import.meta.env.DEV ? import.meta.env.VITE_TEST_REPO : undefined;
function rememberActive(path: string | null) {
  if (TEST_REPO) return;
  try {
    if (path) localStorage.setItem(LAST_REPO_KEY, path);
    else localStorage.removeItem(LAST_REPO_KEY);
  } catch { /* 存储不可用不影响当前页签 */ }
}
const EMPTY_META: SessionMeta = { busy: false, dirty: false, conflictCount: 0, loading: false, error: null };

function recentRepos(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_REPOS_KEY) ?? "[]");
    const paths = sanitizeRecentRepos(value);
    // 旧版本可能写入空路径 / 重复项；过滤后顺手回写，避免菜单出现空的「最近打开」。
    if (Array.isArray(value) && paths.length !== value.length) {
      try { localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(paths)); } catch { /* 存储不可用时仅影响回写 */ }
    }
    return paths;
  } catch { return []; }
}

function AppShell({ initialLaunches = [] }: { initialLaunches?: LaunchRequest[] }) {
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>(() => TEST_REPO ? [] : recentRepos());
  const [settings, setSettings] = useState(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
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
  const [managerGroupId, setManagerGroupId] = useState<string | undefined>();
  const [showRepositorySearch, setShowRepositorySearch] = useState(false);
  const [records, setRecords] = useState<RepositoryRecord[]>(() => TEST_REPO ? [] : loadRepositoryRecords({
    openPaths: loadOpenRepos() ?? undefined, recentPaths: recent, groupConfig: repoGroups,
  }));
  const [recordErrors, setRecordErrors] = useState<Record<string, string>>({});
  const [recordBusy, setRecordBusy] = useState(false);
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const reposRef = useRef(repos);
  reposRef.current = repos;
  const groupsRef = useRef(repoGroups);
  groupsRef.current = repoGroups;
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const openingRef = useRef(false);
  const recordActionRef = useRef(false);
  const closeActionRef = useRef(false);
  const [sessionRestored, setSessionRestored] = useState(false);
  const [restoring, setRestoring] = useState(() => {
    if (TEST_REPO) return false;
    const stored = loadOpenRepos();
    if (stored !== null) return stored.length > 0;
    try { return localStorage.getItem(LAST_REPO_KEY) !== null; } catch { return false; }
  });
  const restoringRef = useRef(restoring);
  restoringRef.current = restoring;
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
  useEffect(() => { if (!TEST_REPO) saveRepositoryRecords(records); }, [records]);
  // 任务栏 / Alt+Tab 标题跟随活动仓库和草稿状态，而不是固定为应用名。
  useEffect(() => {
    const repo = repos.find((item) => item.path === activePath);
    const name = repo ? displayRepoName(repoGroups, repo) : "";
    const dirty = activePath ? meta[activePath]?.dirty : false;
    void getCurrentWindow().setTitle(name ? `${dirty ? "● " : ""}${name} — Git Extensions` : "Git Extensions").catch(() => undefined);
  }, [activePath, meta, repoGroups, repos]);
  // 恢复完成前不能用空数组覆盖上次的页签列表。
  useEffect(() => {
    if (TEST_REPO || !sessionRestored) return;
    saveOpenRepos(repos.map((repo) => repo.path));
  }, [repos, sessionRestored]);

  const notify = useCallback((repoPath: string, kind: Notice["kind"], message: string, details?: string, repoName?: string) => {
    const id = ++noticeId.current;
    setNotices((prev) => [...prev.slice(-99), { id, repoPath, repoName: repoName ?? repoPath.split(/[\\/]/).pop() ?? repoPath, kind, message, details }]);
  }, []);
  const dismissNotice = useCallback((id: number) => setNotices((prev) => prev.filter((notice) => notice.id !== id)), []);
  const clearNotices = useCallback(() => setNotices([]), []);

  const openRepo = useCallback(async (path: string): Promise<RepoInfo | null> => {
    const trimmed = path.trim();
    if (!trimmed || openingRef.current || recordActionRef.current || restoringRef.current) return null;
    const insertAfter = openInsertAfter;
    openingRef.current = true;
    setOpening(true);
    try {
      const info = await api.openRepo(trimmed);
      const targetRecorded = recordsRef.current.some((record) => record.path === info.path);
      const known = targetRecorded || recordsRef.current.some((record) => record.path === trimmed);
      const currentGroups = groupsRef.current;
      let nextGroups = trimmed !== info.path ? relocateRepoConfig(currentGroups, trimmed, info.path, targetRecorded) : currentGroups;
      if (!known) {
        const target = newRepositoryGroup(nextGroups, insertAfter ? groupForRepo(nextGroups, insertAfter) : undefined);
        nextGroups = setRepoGroup(nextGroups, info.path, target);
      }
      nextGroups = rememberGroupActive(ensureGroupActive(nextGroups, groupForRepo(nextGroups, info.path)), info.path);
      groupsRef.current = nextGroups;
      setRepoGroups(nextGroups);
      const nextRecords = recordRepository(
        trimmed !== info.path ? relocateRepositoryRecord(recordsRef.current, trimmed, info) : recordsRef.current,
        info, true,
      );
      recordsRef.current = nextRecords;
      setRecords(nextRecords);
      setRecordErrors((prev) => {
        const next = { ...prev }; delete next[trimmed]; delete next[info.path]; return next;
      });
      const currentRepos = reposRef.current;
      if (!currentRepos.some((repo) => repo.path === info.path)) {
        const index = insertAfter ? currentRepos.findIndex((repo) => repo.path === insertAfter) : -1;
        const next = [...currentRepos];
        next.splice(index < 0 ? next.length : index + 1, 0, info);
        reposRef.current = next;
        setRepos(next);
      }
      activePathRef.current = info.path;
      setActivePath(info.path);
      rememberActive(info.path);
      setRecent((prev) => {
        const next = sanitizeRecentRepos([info.path, ...prev.filter((item) => item !== trimmed)]);
        try { if (!TEST_REPO) localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(next)); } catch { /* 当前会话继续使用 */ }
        return next;
      });
      setShowOpen(false);
      setOpenPath("");
      setOpenInsertAfter(null);
      return info;
    } catch (e) {
      setRecordErrors((prev) => ({ ...prev, [trimmed]: String(e) }));
      notify(trimmed, "error", "无法打开仓库", String(e), "打开仓库");
      return null;
    } finally { openingRef.current = false; setOpening(false); }
  }, [notify, openInsertAfter]);

  const beginOpen = useCallback((prefill = "") => {
    setOpenInsertAfter(null);
    setOpenPath(prefill);
    setShowOpen(true);
  }, []);

  const browseOpenPath = useCallback(async () => {
    try {
      const path = await pickDirectory("选择 Git 仓库目录");
      if (path) setOpenPath(path);
    } catch (error) {
      notify("", "error", "无法打开目录选择器", String(error));
    }
  }, [notify]);

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

  // 拖放目录 / 仓库内文件即可打开仓库；多个路径按顺序打开，避免并发写页签列表。
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void getCurrentWindow().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type !== "drop" || payload.paths.length === 0) return;
      void (async () => {
        for (const path of payload.paths) await openRepo(path);
      })();
    }).then((fn) => { if (disposed) fn(); else unlisten = fn; }).catch(() => undefined);
    return () => { disposed = true; unlisten?.(); };
  }, [openRepo]);

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

  const persistSettings = useCallback(async (next: typeof settings) => {
    // 每次应用 / 保存都重新注册已启用的菜单：应用升级后无需改动配置也能应用
    // 新的分组、图标与命令表；关闭菜单时同样走一次注销。
    if (next.explorerContextMenuEnabled || settings.explorerContextMenuEnabled) {
      if (TEST_REPO) throw new Error("测试模式不允许修改资源管理器菜单");
      await api.setExplorerContextMenuEnabled(
        next.explorerContextMenuEnabled,
        explorerMenuItems(next.explorerContextMenuPlacements),
        next.explorerAlwaysShowAllCommands,
      );
    }
    setSettings(next);
  }, [settings]);

  const saveSettingsDialog = useCallback(async (next: typeof settings) => {
    await persistSettings(next);
    setShowSettings(false);
  }, [persistSettings]);

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
      const canonicalPaths = new Map<string, string>();
      const failed: { path: string; error: string }[] = [];
      for (const path of candidates) {
        try {
          const info = await api.openRepo(path);
          canonicalPaths.set(path, info.path);
          const targetRecorded = recordsRef.current.some((record) => record.path === info.path);
          if (!restored.some((repo) => repo.path === info.path)) restored.push(info);
          const nextRecords = recordRepository(
            path === info.path ? recordsRef.current : relocateRepositoryRecord(recordsRef.current, path, info), info, false,
          );
          recordsRef.current = nextRecords;
          setRecords(nextRecords);
          if (path !== info.path) {
            const nextGroups = relocateRepoConfig(groupsRef.current, path, info.path, targetRecorded);
            groupsRef.current = nextGroups;
            setRepoGroups(nextGroups);
          }
        } catch (error) {
          failed.push({ path, error: String(error) });
          setRecordErrors((prev) => ({ ...prev, [path]: String(error) }));
        }
      }
      const target = canonicalActivePath(restored.map((repo) => repo.path), last, canonicalPaths);
      setRecent((prev) => {
        const next = sanitizeRecentRepos(prev.map((path) => canonicalPaths.get(path) ?? path));
        try { if (!TEST_REPO) localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(next)); } catch { /* 当前会话继续 */ }
        return next;
      });
      if (restored.length > 0) {
        const merged = new Map(restored.map((repo) => [repo.path, repo] as const));
        for (const repo of reposRef.current) if (!merged.has(repo.path)) merged.set(repo.path, repo);
        const nextRepos = [...merged.values()];
        reposRef.current = nextRepos;
        setRepos(nextRepos);
        // 恢复不改变上次查看范围；失败项留在仓库记录中供重新定位。
        if (activePathRef.current === null) {
          const visibleTarget = pickVisibleActive(groupsRef.current, nextRepos, target);
          activePathRef.current = visibleTarget;
          setActivePath(visibleTarget);
          rememberActive(visibleTarget);
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
  // 当前范围与组内活动记忆决定回退；切换到空组不自动打开成员。
  useEffect(() => {
    if (restoring || (activePath && shownRepos.some((repo) => repo.path === activePath))) return;
    const fallback = pickVisibleActive(repoGroups, repos, activePath);
    if (fallback !== activePath) {
      activePathRef.current = fallback;
      setActivePath(fallback);
      rememberActive(fallback);
    }
  }, [activePath, repoGroups, repos, restoring]);
  useEffect(() => {
    if (!activePath || restoring || !shownRepos.some((repo) => repo.path === activePath)) return;
    setRepoGroups((prev) => rememberGroupActive(prev, activePath));
  }, [activePath, restoring, shownRepos]);

  const discardSessions = useCallback((paths: string[]) => {
    const removed = new Set(paths);
    const current = reposRef.current;
    const visible = visibleRepos(groupsRef.current, current);
    const index = visible.findIndex((repo) => repo.path === activePathRef.current);
    const next = current.filter((repo) => !removed.has(repo.path));
    reposRef.current = next;
    setRepos(next);
    setMeta((prev) => Object.fromEntries(Object.entries(prev).filter(([path]) => !removed.has(path))));
    if (activePathRef.current && removed.has(activePathRef.current)) {
      const remaining = visible.filter((repo) => !removed.has(repo.path));
      const fallback = remaining[Math.min(Math.max(index, 0), remaining.length - 1)]?.path ?? null;
      activePathRef.current = fallback;
      setActivePath(fallback);
      rememberActive(fallback);
      if (fallback) {
        const config = rememberGroupActive(groupsRef.current, fallback);
        groupsRef.current = config;
        setRepoGroups(config);
      }
    }
  }, []);

  const closeRepo = useCallback(async (path: string): Promise<boolean> => {
    if (closeActionRef.current || !reposRef.current.some((repo) => repo.path === path)) return false;
    closeActionRef.current = true;
    try {
      const state = metaRef.current[path] ?? EMPTY_META;
      if (state.busy || getRepoOperation(path)) {
        notify(path, "info", "当前仓库有操作进行中，完成后才能关闭");
        return false;
      }
      if (state.dirty && !await confirm({ title: "关闭含未保存内容的仓库？", body: "提交、冲突编辑或 Rebase 计划草稿尚未保存。关闭页签不会删除仓库或分类记录，但会丢弃这些界面草稿。", confirmLabel: "丢弃草稿并关闭", danger: true })) return false;
      if (metaRef.current[path]?.busy || getRepoOperation(path)) {
        notify(path, "info", "当前仓库有操作进行中，完成后才能关闭");
        return false;
      }
      discardSessions([path]);
      return true;
    } finally { closeActionRef.current = false; }
  }, [confirm, discardSessions, notify]);

  const closeRepos = useCallback(async (paths: string[]) => {
    if (closeActionRef.current) return;
    closeActionRef.current = true;
    try {
      const targets = reposRef.current.filter((repo) => paths.includes(repo.path));
      const blocked = targets.filter((repo) => metaRef.current[repo.path]?.busy || getRepoOperation(repo.path));
      const closable = targets.filter((repo) => !blocked.includes(repo));
      if (closable.length === 0) {
        if (blocked.length) notify("", "info", "所选仓库有操作进行中，完成后才能关闭");
        return;
      }
      const dirtyPaths = new Set(closable.filter((repo) => metaRef.current[repo.path]?.dirty).map((repo) => repo.path));
      const dirty = dirtyPaths.size > 0;
      const ok = await confirm({
        title: `关闭 ${closable.length} 个仓库页签？`,
        body: <div><p>只关闭打开会话，保留仓库记录与归属，不删除磁盘文件。{dirty && "未保存的界面草稿将被丢弃。"}</p>
          <pre className="confirm-file-list">{closable.map((repo) => displayRepoName(groupsRef.current, repo)).join("\n")}</pre>
          {blocked.length > 0 && <p>{blocked.length} 个正在操作的仓库将保留。</p>}</div>,
        confirmLabel: dirty ? "丢弃草稿并关闭" : "关闭页签", danger: dirty,
      });
      if (!ok) return;
      const blockedAfterConfirm = new Set(closeBlockedPaths(closable.map((repo) => repo.path), metaRef.current,
        (path) => !!getRepoOperation(path), dirtyPaths));
      const safe = closable.filter((repo) => !blockedAfterConfirm.has(repo.path));
      discardSessions(safe.map((repo) => repo.path));
      if (safe.length < closable.length) notify("", "info", "部分仓库状态已变化，已保留对应页签");
    } finally { closeActionRef.current = false; }
  }, [confirm, discardSessions, notify]);

  const closeOthers = useCallback(async (path: string) => {
    if (closeActionRef.current) return;
    closeActionRef.current = true;
    try {
      const targets = visibleRepos(groupsRef.current, reposRef.current).filter((repo) => repo.path !== path);
      const kept = targets.filter((repo) => metaRef.current[repo.path]?.busy || metaRef.current[repo.path]?.dirty || getRepoOperation(repo.path));
      const closable = targets.filter((repo) => !kept.includes(repo));
      if (kept.length > 0) {
        const ok = closable.length > 0 && await confirm({ title: `关闭当前范围的其它 ${closable.length} 个页签？`,
          body: <div><p>带草稿或正在操作的页签将保留：</p><pre className="confirm-file-list">{kept.map((repo) => displayRepoName(groupsRef.current, repo)).join("\n")}</pre></div>,
          confirmLabel: "关闭其它页签" });
        if (!ok) { notify(path, "info", "已保留带草稿或正在操作的页签"); return; }
      }
      const blockedAfterConfirm = new Set(closeBlockedPaths(closable.map((repo) => repo.path), metaRef.current,
        (repoPath) => !!getRepoOperation(repoPath), new Set()));
      discardSessions(closable.filter((repo) => !blockedAfterConfirm.has(repo.path)).map((repo) => repo.path));
      activePathRef.current = path;
      setActivePath(path);
      rememberActive(path);
      setRepoGroups((prev) => rememberGroupActive(prev, path));
    } finally { closeActionRef.current = false; }
  }, [confirm, discardSessions, notify]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector(".modal-backdrop, .context-menu")) return;
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const activateShown = (repo: (typeof shownRepos)[number]) => {
        activePathRef.current = repo.path;
        setActivePath(repo.path);
        rememberActive(repo.path);
        setRepoGroups((prev) => rememberGroupActive(prev, repo.path));
      };
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowPalette(true);
      } else if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        beginOpen(activePath ?? "");
      } else if (event.key.toLowerCase() === "w" && activePath) {
        event.preventDefault();
        void closeRepo(activePath);
      } else if (!event.altKey && !event.shiftKey && /^[1-9]$/.test(event.key)) {
        const target = shownRepos[Number(event.key) - 1];
        if (!target) return;
        event.preventDefault();
        activateShown(target);
      } else if (event.key === "Tab" && shownRepos.length > 0) {
        event.preventDefault();
        const index = shownRepos.findIndex((r) => r.path === activePath);
        const next = (index + (event.shiftKey ? -1 : 1) + shownRepos.length) % shownRepos.length;
        activateShown(shownRepos[next]);
      } else if (event.key === ",") {
        event.preventDefault();
        setShowSettings(true);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [activePath, beginOpen, closeRepo, shownRepos]);

  const updateMeta = useCallback((path: string, value: SessionMeta) => {
    setMeta((prev) => {
      const old = prev[path];
      if (old && old.busy === value.busy && old.dirty === value.dirty && old.conflictCount === value.conflictCount && old.loading === value.loading && old.error === value.error) return prev;
      return { ...prev, [path]: value };
    });
  }, []);

  const activateRepo = useCallback((path: string, global = false) => {
    const current = groupsRef.current;
    const next = rememberGroupActive(global ? selectGroup(current, groupForRepo(current, path))
      : ensureGroupActive(current, groupForRepo(current, path)), path);
    groupsRef.current = next;
    setRepoGroups(next);
    activePathRef.current = path;
    setActivePath(path);
    rememberActive(path);
    const repo = reposRef.current.find((item) => item.path === path);
    if (repo) {
      const nextRecords = recordRepository(recordsRef.current, repo, true);
      recordsRef.current = nextRecords;
      setRecords(nextRecords);
    }
  }, []);

  const openRecorded = useCallback(async (path: string): Promise<boolean> => {
    if (reposRef.current.some((repo) => repo.path === path)) {
      activateRepo(path, true);
      return true;
    }
    const info = await openRepo(path);
    if (!info) return false;
    activateRepo(info.path, true);
    return true;
  }, [activateRepo, openRepo]);

  const addRecorded = useCallback(async (groupId: string) => {
    if (recordActionRef.current || openingRef.current || restoring) return;
    recordActionRef.current = true;
    setRecordBusy(true);
    try {
      const path = await pickDirectory("添加 Git 仓库到列表");
      if (!path) return;
      const info = await api.openRepo(path);
      const targetRecorded = recordsRef.current.some((record) => record.path === info.path);
      const known = targetRecorded || recordsRef.current.some((record) => record.path === path);
      let config = relocateRepoConfig(groupsRef.current, path, info.path, targetRecorded);
      if (!known) config = setRepoGroup(config, info.path, groupId);
      groupsRef.current = config;
      setRepoGroups(config);
      const next = recordRepository(relocateRepositoryRecord(recordsRef.current, path, info), info, false);
      recordsRef.current = next;
      setRecords(next);
      setRecordErrors((prev) => { const errors = { ...prev }; delete errors[path]; delete errors[info.path]; return errors; });
    } catch (error) { notify("", "error", "无法添加仓库", String(error)); }
    finally { recordActionRef.current = false; setRecordBusy(false); }
  }, [notify, restoring]);

  const removeRecorded = useCallback(async (paths: string[]) => {
    if (recordActionRef.current || openingRef.current || closeActionRef.current || restoring) return;
    const targets = recordsRef.current.filter((record) => paths.includes(record.path));
    if (targets.length === 0) return;
    recordActionRef.current = true;
    closeActionRef.current = true;
    setRecordBusy(true);
    try {
      const blocked = targets.filter((record) => metaRef.current[record.path]?.busy || getRepoOperation(record.path));
      if (blocked.length > 0) {
        notify(blocked[0].path, "info", "所选仓库有操作进行中，完成后才能移除记录");
        return;
      }
      const dirtyPaths = new Set(targets.filter((record) => metaRef.current[record.path]?.dirty).map((record) => record.path));
      const dirty = dirtyPaths.size > 0;
      const opened = targets.filter((record) => reposRef.current.some((repo) => repo.path === record.path));
      const ok = await confirm({ title: `从列表移除 ${targets.length} 个仓库？`,
        body: <div><p>仅移除应用中的记录、归属与别名，不删除磁盘仓库。{opened.length > 0 && `同时关闭 ${opened.length} 个打开页签。`}{dirty && "未保存的界面草稿将被丢弃。"}</p>
          <pre className="confirm-file-list">{targets.map((record) => repositoryName(record, groupsRef.current)).join("\n")}</pre></div>,
        confirmLabel: dirty ? "丢弃草稿、关闭并移除" : opened.length ? "关闭并移除记录" : "移除记录", danger: true });
      if (!ok) return;
      if (closeBlockedPaths(targets.map((record) => record.path), metaRef.current,
        (path) => !!getRepoOperation(path), dirtyPaths).length > 0) {
        notify("", "info", "仓库状态已变化，未移除记录，请重新确认");
        return;
      }
      const removedPaths = targets.map((record) => record.path);
      const removed = new Set(removedPaths);
      discardSessions(removedPaths);
      const config = groupsRef.current;
      const nextConfig = { ...config,
        assignments: Object.fromEntries(Object.entries(config.assignments).filter(([path]) => !removed.has(path))),
        aliases: Object.fromEntries(Object.entries(config.aliases).filter(([path]) => !removed.has(path))),
        lastActivePathByGroup: Object.fromEntries(Object.entries(config.lastActivePathByGroup).filter(([, path]) => !removed.has(path))),
      };
      groupsRef.current = nextConfig;
      setRepoGroups(nextConfig);
      const next = removeRepositoryRecords(recordsRef.current, removedPaths);
      recordsRef.current = next;
      setRecords(next);
      setRecordErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([path]) => !removed.has(path))));
      setRecent((prev) => {
        const nextRecent = prev.filter((path) => !removed.has(path));
        try { if (!TEST_REPO) localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(nextRecent)); } catch { /* 当前会话继续 */ }
        return nextRecent;
      });
    } finally { recordActionRef.current = false; closeActionRef.current = false; setRecordBusy(false); }
  }, [confirm, discardSessions, notify, restoring]);

  const relocateRecorded = useCallback(async (path: string) => {
    if (recordActionRef.current || openingRef.current || closeActionRef.current || restoring) return;
    if (reposRef.current.some((repo) => repo.path === path)) {
      notify(path, "info", "请先关闭仓库页签，再重新定位目录");
      return;
    }
    recordActionRef.current = true;
    setRecordBusy(true);
    try {
      const selected = await pickDirectory("重新定位 Git 仓库目录");
      if (!selected) return;
      const info = await api.openRepo(selected);
      const targetRecorded = recordsRef.current.some((record) => record.path === info.path);
      if (info.path !== path && targetRecorded) {
        const ok = await confirm({ title: "合并到已有仓库记录？", body: "目标目录已在列表中。保留目标记录的归属与别名，移除旧路径记录；不会删除磁盘文件。", confirmLabel: "合并记录" });
        if (!ok) return;
      }
      const next = relocateRepositoryRecord(recordsRef.current, path, info);
      recordsRef.current = next;
      setRecords(next);
      const config = relocateRepoConfig(groupsRef.current, path, info.path, targetRecorded);
      groupsRef.current = config;
      setRepoGroups(config);
      setRecordErrors((prev) => { const errors = { ...prev }; delete errors[path]; delete errors[info.path]; return errors; });
      setRecent((prev) => {
        const nextRecent = sanitizeRecentRepos(prev.map((item) => item === path ? info.path : item));
        try { if (!TEST_REPO) localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(nextRecent)); } catch { /* 当前会话继续 */ }
        return nextRecent;
      });
    } catch (error) {
      setRecordErrors((prev) => ({ ...prev, [path]: String(error) }));
      notify(path, "error", "无法重新定位仓库", String(error));
    } finally { recordActionRef.current = false; setRecordBusy(false); }
  }, [confirm, notify, restoring]);

  const manageGroups = useCallback((groupId?: string) => {
    setManagerGroupId(groupId);
    setShowGroupManager(true);
  }, []);

  // 全局命令：应用级动作与所有已打开仓库的切换；仓库内动作由 RepoWorkspace 注册。
  useEffect(() => {
    const commands: Command[] = [
      { id: "app.open-repo", title: "打开仓库…", group: "应用", shortcut: "Ctrl+O", keywords: ["open", "repository"], run: () => beginOpen() },
      { id: "app.clone", title: "克隆仓库…", group: "应用", keywords: ["clone"], run: () => setCloneParent("") },
      { id: "app.create", title: "新建仓库…", group: "应用", keywords: ["create", "init"], run: () => setCreateRepositoryPath("") },
      { id: "app.settings", title: "设置…", group: "应用", shortcut: "Ctrl+,", keywords: ["settings", "preferences"], run: () => setShowSettings(true) },
      { id: "app.groups", title: "组管理器…", group: "应用", keywords: ["group", "tab", "组管理", "仓库管理"], run: () => manageGroups() },
      { id: "app.find-repository", title: "查找仓库…", group: "应用", keywords: ["repository", "search", "查找"], run: () => setShowRepositorySearch(true) },
      { id: "app.close-tab", title: "关闭当前仓库页签", group: "应用", shortcut: "Ctrl+W", enabled: !!activePath, run: () => { if (activePath) void closeRepo(activePath); } },
    ];
    for (const record of records) {
      const opened = repos.some((repo) => repo.path === record.path);
      commands.push({
        id: `app.switch:${record.path}`,
        title: `${opened ? "切换到" : "打开"} ${repositoryName(record, repoGroups)}`,
        group: "仓库",
        keywords: [record.path, record.name, repoGroups.groups.find((group) => group.id === groupForRepo(repoGroups, record.path))?.name ?? ""],
        enabled: record.path !== activePath && !opening && !restoring && !recordBusy,
        run: () => { void openRecorded(record.path); },
      });
    }
    registerCommands("app", commands);
    return () => unregisterCommands("app");
  }, [activePath, beginOpen, closeRepo, manageGroups, openRecorded, opening, recordBusy, records, repoGroups, repos, restoring]);

  const updateRepoGroups = useCallback((next: RepoGroupConfig) => {
    groupsRef.current = next;
    setRepoGroups(next);
    const fallback = pickVisibleActive(next, reposRef.current, activePathRef.current);
    activePathRef.current = fallback;
    setActivePath(fallback);
    rememberActive(fallback);
  }, []);

  // Alt+1…9 独占选中固定组，Alt+0 独占未分组；不改变组的归属或固定状态。
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (document.querySelector(".modal-backdrop, .context-menu")) return;
      if ((event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable='true']")) return;
      let digit: number | null = null;
      if (/^[0-9]$/.test(event.key)) digit = Number(event.key);
      else if (/^Digit[0-9]$/.test(event.code)) digit = Number(event.code.slice(5));
      else if (/^Numpad[0-9]$/.test(event.code)) digit = Number(event.code.slice(6));
      if (digit === null) return;
      const config = groupsRef.current;
      const groupId = groupForPinShortcut(config, digit);
      if (!groupId) return;
      event.preventDefault();
      updateRepoGroups(selectGroup(config, groupId));
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [updateRepoGroups]);

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
  const allowCloseRef = useRef(false);
  const closeWindow = useCallback(async () => {
    const entries = Object.entries(metaRef.current);
    const anyDirty = hasDirtyDialogs() || entries.some(([, m]) => m.dirty);
    const anyBusy = lifecycleBusy || entries.some(([, m]) => m.busy);
    if (anyBusy && !anyDirty) { notify(activePath ?? "", "info", "有仓库操作进行中，完成后才能关闭窗口"); return; }
    if (anyDirty || anyBusy) {
      const ok = await confirm({ title: "关闭应用？", body: "有仓库存在未保存草稿、弹窗输入或正在执行的操作。关闭窗口会丢弃界面草稿与弹窗输入（不会删除仓库），进行中的 Git 写操作可能在后台完成。", confirmLabel: "退出", danger: true });
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
        onActivate={activateRepo}
        onClose={(path) => void closeRepo(path)}
        onCloseOthers={(path) => closeOthers(path)}
        onOpen={() => beginOpen()}
        onClone={() => setCloneParent("")}
        onCreate={() => setCreateRepositoryPath("")}
        onCommandPalette={() => setShowPalette(true)}
        onOpenRightOf={beginOpenRightOf}
        onSettings={() => setShowSettings(true)}
        onCopyPath={(path) => { void navigator.clipboard?.writeText(path).then(() => notify(path, "success", "已复制仓库路径")); }}
        onReveal={(path) => { void api.revealPath(path).catch((e) => notify(path, "error", "无法打开文件管理器", String(e))); }}
        onReorderRepo={reorderRepos}
        onRepoGroupsChange={updateRepoGroups}
        onSetRepoAlias={(path, alias) => updateRepoGroups(setRepoAlias(repoGroups, path, alias))}
        onManageRepoGroups={manageGroups}
        onSearchRepositories={() => setShowRepositorySearch(true)}
        onCloseWindow={() => void closeWindow()}
        recentRepos={recent}
        onOpenRecent={(path) => { void openRepo(path); }}
      />
      {repos.filter((repo) => mounted.has(repo.path)).map((repo) => (
        <div className={`repo-host${repo.path === activePath ? " active" : ""}`} key={repo.path} aria-hidden={repo.path !== activePath}>
          <RepoWorkspace
            repo={repo}
            active={repo.path === activePath}
            settings={settings}
            onSettings={() => setShowSettings(true)}
            onNotify={(kind, message, details) => notify(repo.path, kind, message, details, repo.name)}
            onMeta={(value) => updateMeta(repo.path, value)}
            onOpenRepo={(path) => { void openRepo(path); }}
            onCloseRepo={() => { void closeRepo(repo.path); }}
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
      {!restoring && shownRepos.length === 0 && repoGroups.view.kind !== "all-open" && <div className="welcome-screen">
        <Icon name="group" size={42} />
        <h1>当前范围没有打开的仓库</h1>
        <p>选择组内成员按需打开，或添加新的仓库；切换分组不会关闭其它仓库。</p>
        <div className="welcome-actions">
          <button className="primary" onClick={() => manageGroups(repoGroups.view.kind === "group" ? repoGroups.view.groupId : undefined)}><Icon name="group" />查看组内仓库</button>
          <button onClick={() => setShowRepositorySearch(true)}><Icon name="search" />查找仓库</button>
          <button onClick={() => beginOpen()}><Icon name="plus" />打开仓库</button>
        </div>
      </div>}
      {repos.length === 0 && !restoring && repoGroups.view.kind === "all-open" && <div className="welcome-screen">
        <Icon name="branch" size={42} />
        <h1>Git Extensions</h1>
        <p>打开一个本地 Git 仓库，开始查看历史或提交变更。</p>
        <div className="welcome-actions">
          <button className="primary" onClick={() => beginOpen()}><Icon name="plus" />打开仓库</button>
          <button onClick={() => setCloneParent("")}><Icon name="fetch" />克隆仓库</button>
          <button onClick={() => setCreateRepositoryPath("")}><Icon name="folder" />新建仓库</button>
        </div>
        {recent.length > 0 && <div className="welcome-recent">
          <span className="section-label">最近打开</span>
          {recent.slice(0, 6).map((path) => <button key={path} title={path} onClick={() => void openRepo(path)}><Icon name="history" size={13} /><span>{path}</span></button>)}
        </div>}
      </div>}
      {showGroupManager && <RepoGroupsDialog config={repoGroups} records={records} repos={repos}
        activePath={activePath} meta={meta} errors={recordErrors} busy={opening || recordBusy || restoring}
        initialGroupId={managerGroupId} onChange={updateRepoGroups} onClose={() => setShowGroupManager(false)}
        onOpen={openRecorded} onAdd={addRecorded} onCloseRepos={closeRepos} onRemove={removeRecorded} onRelocate={relocateRecorded} />}
      {showRepositorySearch && <RepositorySearchDialog config={repoGroups} records={records} repos={repos}
        activePath={activePath} errors={recordErrors} busy={opening || recordBusy || restoring}
        onClose={() => setShowRepositorySearch(false)} onOpen={openRecorded} onRemove={removeRecorded} onRelocate={relocateRecorded} />}
      {showOpen && <Dialog title="打开 Git 仓库" onClose={() => { if (!opening) { setShowOpen(false); setOpenInsertAfter(null); } }} busy={opening} footer={<>
        <button disabled={opening} onClick={() => { setShowOpen(false); setOpenInsertAfter(null); }}>取消</button>
        <button className="primary" disabled={opening || !openPath.trim()} onClick={() => void openRepo(openPath)}>{opening ? "打开中…" : "打开"}</button>
      </>}>
        <label className="field-label">仓库路径
          <div className="path-input-row">
            <input data-autofocus className="repo-path-input" placeholder="C:\path\to\project" value={openPath} onChange={(e) => setOpenPath(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void openRepo(openPath); }} />
            <button type="button" disabled={opening} onClick={() => void browseOpenPath()}>浏览…</button>
          </div>
        </label>
        {recent.length > 0 && <div className="recent-repos"><div className="section-label">最近打开</div>{recent.map((path) => <button key={path} onClick={() => setOpenPath(path)} onDoubleClick={() => void openRepo(path)} title={`${path}（双击直接打开）`}><Icon name="history" /><span>{path}</span></button>)}</div>}
      </Dialog>}
      {showSettings && <SettingsDialog settings={settings} explorerIntegrationSupported={!TEST_REPO && explorerIntegrationSupported} onSave={saveSettingsDialog} onApply={persistSettings} onClose={() => setShowSettings(false)} />}
      {showPalette && <CommandPalette onClose={() => setShowPalette(false)} />}
      {cloneParent !== null && <CloneDialog initialParent={cloneParent} onOpen={openRepo} onClose={() => setCloneParent(null)} onBusyChange={setLifecycleBusy} />}
      {createRepositoryPath !== null && <CreateRepositoryDialog initialPath={createRepositoryPath} onOpen={openRepo} onClose={() => setCreateRepositoryPath(null)} onBusyChange={setLifecycleBusy} onMessage={(text) => notify(createRepositoryPath, "info", text)} />}
      <NotificationCenter notices={notices} onDismiss={dismissNotice} onClear={clearNotices} />
    </div>
  );
}

export default function App({ initialLaunches = [] }: { initialLaunches?: LaunchRequest[] }) {
  return <ConfirmProvider><AppShell initialLaunches={initialLaunches} /></ConfirmProvider>;
}
