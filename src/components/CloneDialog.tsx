import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, onCloneProgress } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import Dialog from "../ui/Dialog";
import { useDirtyClose } from "../ui/useDirtyClose";
import { pickDirectory } from "../nativeDialog";

interface Props {
  initialParent: string;
  onOpen: (path: string) => Promise<unknown>;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}

type ClonePhase = "form" | "cloning" | "done" | "error";

interface CloneStatus {
  phase: string | null;
  percent: number | null;
}

const PHASE_LABELS: Record<string, string> = {
  "Enumerating objects": "枚举对象",
  "Counting objects": "统计对象",
  "Compressing objects": "压缩对象",
  "Receiving objects": "接收对象",
  "Resolving deltas": "解析差异",
  "Updating files": "更新文件",
  "Updating working tree": "更新工作区",
};

function inferredName(url: string) {
  const trimmed = url.trim().replace(/[\\/]+$/, "");
  const name = trimmed.split(/[\\/:/]/).filter(Boolean).pop()?.replace(/\.git$/i, "") ?? "";
  return name && !name.startsWith("-") ? name : "repository";
}

/** 空分支表示使用远端 HEAD；勾选项默认值与 CloneDialog 的初始状态一致。 */
const DEFAULT_OPTIONS = { branch: "", initSubmodules: true, depthOne: false, singleBranch: false };

function branchMenuLabel(branch: string) {
  return branch.trim() ? branch : "(default: remote HEAD)";
}

/** 解析 `Receiving objects: 45% (...)` 一类的 git --progress 输出。 */
function parseCloneProgress(line: string): CloneStatus | null {
  const cleaned = line.replace(/^remote:\s*/i, "").trim();
  const match = cleaned.match(/^([^:]{1,40}):\s*(\d{1,3})%/);
  if (!match) return null;
  const percent = Number(match[2]);
  if (!Number.isFinite(percent)) return null;
  return { phase: match[1], percent: Math.max(0, Math.min(100, percent)) };
}

export default function CloneDialog({ initialParent, onOpen, onClose, onBusyChange }: Props) {
  const [url, setUrl] = useState("");
  const [destination, setDestination] = useState(initialParent);
  const [destinationEdited, setDestinationEdited] = useState(false);
  const [phase, setPhase] = useState<ClonePhase>("form");
  const [status, setStatus] = useState<CloneStatus>({ phase: null, percent: null });
  const [lines, setLines] = useState<string[]>([]);
  const [clonedPath, setClonedPath] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [localBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState({ ...DEFAULT_OPTIONS });
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [remoteBranches, setRemoteBranches] = useState<string[] | null>(null);
  const [branchQueryBusy, setBranchQueryBusy] = useState(false);
  const [branchQueryError, setBranchQueryError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const repoBusy = useRepoBusy(destination.trim());
  const busy = localBusy || repoBusy;
  const dirty = phase !== "done" && (
    url.trim().length > 0 || destination !== initialParent ||
    options.branch.trim().length > 0 || options.depthOne || options.singleBranch || !options.initSubmodules
  );
  const close = useDirtyClose(dirty, busy, onClose);

  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  useEffect(() => () => {
    unlistenRef.current?.();
    unlistenRef.current = null;
  }, []);

  useEffect(() => {
    if (phase !== "cloning") return;
    const started = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines]);

  const updateUrl = (value: string) => {
    setUrl(value);
    // 应用菜单 / 欢迎页没有父目录；此时不要生成 `/repo` 这类非绝对路径，
    // 留给用户浏览或手填目标目录。
    if (!destinationEdited && initialParent.trim()) {
      const separator = initialParent.includes("\\") ? "\\" : "/";
      setDestination(`${initialParent.replace(/[\\/]+$/, "")}${separator}${inferredName(value)}`);
    }
  };

  const browse = async () => {
    try {
      const path = await pickDirectory("选择克隆目标目录");
      if (path) { setDestination(path); setDestinationEdited(true); }
    } catch (e) { setError(String(e)); }
  };

  const queryRemoteBranches = async () => {
    if (!url.trim() || branchQueryBusy) return;
    setBranchQueryBusy(true);
    setBranchQueryError(null);
    try {
      setRemoteBranches(await api.listRemoteBranches(url.trim()));
    } catch (e) {
      setBranchQueryError(String(e));
    } finally {
      setBranchQueryBusy(false);
    }
  };

  const cloneOptions = () => ({
    branch: options.branch.trim(),
    initSubmodules: options.initSubmodules,
    depthOne: options.depthOne,
    singleBranch: options.singleBranch,
  });

  const clone = async () => {
    if (busy || !url.trim() || !destination.trim()) return;
    setBusy(true);
    setError(null);
    setPhase("cloning");
    setStatus({ phase: null, percent: null });
    setLines([]);
    setClonedPath("");
    const operationId = `clone-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      unlistenRef.current?.();
      unlistenRef.current = await onCloneProgress((progress) => {
        if (progress.operationId !== operationId) return;
        setLines((prev) => [...prev.slice(-399), progress.line]);
        const parsed = parseCloneProgress(progress.line);
        if (parsed) setStatus(parsed);
      });
      const target = await api.cloneRepositoryWithProgress(destination.trim(), url.trim(), cloneOptions(), operationId);
      setClonedPath(target || destination.trim());
      setPhase("done");
    } catch (e) {
      setError(String(e));
      setPhase("error");
    } finally {
      unlistenRef.current?.();
      unlistenRef.current = null;
      setBusy(false);
    }
  };

  /** 保留原来的快速路径：克隆成功后立即打开仓库。 */
  const cloneAndOpen = async () => {
    if (busy || !url.trim() || !destination.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const target = await api.cloneRepository(destination.trim(), url.trim(), cloneOptions());
      const cloned = target || destination.trim();
      try {
        await onOpen(cloned);
        onClose();
      } catch (e) {
        // 克隆已完成但打开失败：留在结果页，用户仍可重试打开。
        setClonedPath(cloned);
        setError(String(e));
        setPhase("done");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const openCloned = async () => {
    if (busy || !clonedPath) return;
    setBusy(true);
    setError(null);
    try {
      await onOpen(clonedPath);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const statusText = status.phase
    ? `${PHASE_LABELS[status.phase] ?? status.phase}${status.percent === null ? "" : ` · ${status.percent}%`}`
    : "准备中…";

  const details = <dl className="clone-status-grid">
    <dt>远程仓库</dt><dd>{url.trim()}</dd>
    <dt>目标目录</dt><dd>{clonedPath || destination.trim()}</dd>
    <dt>{phase === "cloning" ? "当前阶段" : "结果"}</dt>
    <dd aria-live="polite">{phase === "cloning" ? statusText : phase === "done" ? "克隆完成" : "克隆失败"}</dd>
    <dt>已用时间</dt><dd>{elapsed} 秒</dd>
  </dl>;

  const progressBar = <div className={`clone-progress-track${status.percent === null ? " indeterminate" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={status.percent ?? undefined} aria-label="克隆进度">
    <div className="clone-progress-fill" style={status.percent === null ? undefined : { width: `${status.percent}%` }} />
  </div>;

  const log = <pre className="clone-progress-log" ref={logRef} aria-label="克隆输出">{lines.length > 0 ? lines.join("\n") : "等待 Git 输出…"}</pre>;

  let footer: ReactNode;
  if (phase === "cloning") {
    footer = <span className="muted" role="status">正在克隆，请稍候…</span>;
  } else if (phase === "done") {
    footer = <>
      <button disabled={busy} onClick={close}>关闭</button>
      <button className="primary" disabled={busy} onClick={() => void openCloned()}>打开仓库</button>
    </>;
  } else if (phase === "error") {
    footer = <>
      <button disabled={busy} onClick={close}>关闭</button>
      <button disabled={busy} onClick={() => setPhase("form")}>返回修改</button>
      <button className="primary" disabled={busy} onClick={() => void clone()}>重试</button>
    </>;
  } else {
    footer = <>
      <button disabled={busy} onClick={close}>取消</button>
      <button disabled={busy || !url.trim() || !destination.trim()} onClick={() => void cloneAndOpen()}>{localBusy ? "克隆中…" : "克隆并打开"}</button>
      <button className="primary" disabled={busy || !url.trim() || !destination.trim()} onClick={() => void clone()}>克隆</button>
    </>;
  }

  return <Dialog title={phase === "done" ? "克隆完成" : "克隆仓库"} onClose={close} busy={busy} footer={footer}>
    {phase === "form"
      ? <div className="dialog-form">
        <label><span>远程仓库 URL</span><input data-autofocus disabled={busy} value={url} onChange={(e) => { updateUrl(e.target.value); setRemoteBranches(null); }} placeholder="https://example.com/owner/repository.git" /></label>
        <label><span>目标目录（将克隆到这里）</span><div className="path-input-row"><input disabled={busy} value={destination} onChange={(e) => { setDestination(e.target.value); setDestinationEdited(true); }} /><button type="button" disabled={busy} onClick={() => void browse()}>浏览…</button></div></label>
        <label><span>Branch（可选，默认使用远端 HEAD）</span>
          <div className="branch-combo">
            <input disabled={busy} value={options.branch} onChange={(e) => setOptions((prev) => ({ ...prev, branch: e.target.value }))} placeholder={branchMenuLabel("")} aria-label="分支名称" />
            <button type="button" disabled={busy} aria-expanded={branchMenuOpen} aria-label="分支列表" onClick={() => setBranchMenuOpen((open) => !open)}>▾</button>
            {branchMenuOpen && <div className="branch-combo-menu" role="listbox">
              {remoteBranches === null
                ? <button type="button" role="option" disabled={branchQueryBusy || !url.trim()} onClick={() => void queryRemoteBranches()}>
                  {branchQueryBusy ? "查询中…" : "查询远程分支"}
                </button>
                : <>
                  {remoteBranches.length === 0 && <span className="muted branch-combo-empty">没有找到远程分支</span>}
                  {remoteBranches.map((name) => <button key={name} type="button" role="option" aria-selected={options.branch === name} onClick={() => { setOptions((prev) => ({ ...prev, branch: name })); setBranchMenuOpen(false); }}>{name}</button>)}
                  <button type="button" role="option" disabled={branchQueryBusy || !url.trim()} onClick={() => void queryRemoteBranches()}>{branchQueryBusy ? "查询中…" : "重新查询远程分支"}</button>
                </>}
              {branchQueryError && <span className="inline-error" role="alert">{branchQueryError}</span>}
            </div>}
          </div>
        </label>
        <label className="checkbox-row" title="同时递归克隆并初始化所有子模块（git clone --recurse-submodules）"><input type="checkbox" disabled={busy} checked={options.initSubmodules} onChange={(e) => setOptions((prev) => ({ ...prev, initSubmodules: e.target.checked }))} />Initialize all submodules</label>
        <label className="checkbox-row" title="只下载最近一次提交，创建浅克隆（git clone --depth 1）；不能与需要完整历史的场景同时使用"><input type="checkbox" disabled={busy} checked={options.depthOne} onChange={(e) => setOptions((prev) => ({ ...prev, depthOne: e.target.checked }))} />depth 1</label>
        <label className="checkbox-row" title="只跟踪选中分支的历史，减小克隆体积（git clone --single-branch）"><input type="checkbox" disabled={busy} checked={options.singleBranch} onChange={(e) => setOptions((prev) => ({ ...prev, singleBranch: e.target.checked }))} />single-branch</label>
        <div className="settings-note">资源管理器所选目录仅作为默认父目录；未指定时请手动选择目标目录。凭证由本机 Git credential helper 处理，应用不会保存凭证；分支列表仅在点击「查询远程分支」后读取。</div>
        {error && <div className="inline-error" role="alert">{error}</div>}
      </div>
      : <div className="clone-result">
        {details}
        {progressBar}
        {log}
        {error && <div className="inline-error" role="alert">{error}</div>}
        {phase === "done" && <div className="settings-note success-text">仓库已克隆完成，可以打开继续操作。</div>}
      </div>}
  </Dialog>;
}
