import { useEffect, useState } from "react";
import type { AheadBehind, RepoInfo } from "../types";

interface Props {
  repo: RepoInfo | null;
  loading: boolean;
  busy: boolean;
  revisionCount: number;
  aheadBehind: AheadBehind | null;
  filter: string;
  onFilter: (value: string) => void;
  onOpen: (path: string) => void;
  openRequest: number;
  onRefresh: () => void;
  onToggleLeft: () => void;
  onBranches: () => void;
  onStash: () => void;
  onTags: () => void;
  onSubmodules: () => void;
  onSettings: () => void;
  onRemote: (kind: "fetch" | "pull" | "push") => void;
}

export default function Toolbar(props: Props) {
  const { repo, loading, busy, revisionCount, aheadBehind, filter } = props;
  const [showOpen, setShowOpen] = useState(false);
  const [path, setPath] = useState("");

  useEffect(() => {
    if (props.openRequest === 0) return;
    setPath(repo?.path ?? "");
    setShowOpen(true);
  }, [props.openRequest]);

  const open = () => {
    if (!path.trim()) return;
    props.onOpen(path.trim());
    setShowOpen(false);
  };

  return (
    <>
      <div className="toolbar">
        <button onClick={() => { setPath(repo?.path ?? ""); setShowOpen(true); }} title="打开仓库 (Ctrl+O)">打开仓库</button>
        <button disabled={!repo} onClick={props.onToggleLeft} title="显示 / 隐藏左侧引用面板">引用</button>
        <button disabled={!repo || loading || busy} onClick={props.onRefresh} title="刷新 (F5)">刷新</button>
        <button disabled={!repo || busy} onClick={props.onBranches}>分支</button>
        <button disabled={!repo || busy} onClick={props.onStash}>Stash</button>
        <button disabled={!repo || busy} onClick={props.onTags}>标签</button>
        <button disabled={!repo || busy} onClick={props.onSubmodules} title="子模块 (Ctrl+Shift+M)">子模块</button>
        <button onClick={props.onSettings} title="设置与快捷键 (Ctrl+,)">设置</button>
        <span className="toolbar-separator" />
        <button disabled={!repo || busy} onClick={() => props.onRemote("fetch")}>Fetch</button>
        <button disabled={!repo || busy} onClick={() => props.onRemote("pull")}>Pull</button>
        <button disabled={!repo || busy} onClick={() => props.onRemote("push")}>Push</button>
        {repo && (
          <span className="repo-label">
            <strong>{repo.name}</strong>
            {repo.headBranch && (
              <span className="head-branch">
                [{repo.headBranch}
                {aheadBehind && (aheadBehind.ahead > 0 || aheadBehind.behind > 0)
                  ? ` ↑${aheadBehind.ahead} ↓${aheadBehind.behind}`
                  : ""}]
              </span>
            )}
            <span className="revision-count">{revisionCount} 条提交{loading ? "，加载中…" : busy ? "，操作中…" : ""}</span>
          </span>
        )}
        {!repo && <span className="repo-label muted">尚未打开仓库</span>}
        <input
          id="revision-filter"
          className="filter-input"
          placeholder="过滤：信息 / 作者 / sha (Ctrl+F)"
          value={filter}
          onChange={(e) => props.onFilter(e.target.value)}
          disabled={!repo}
        />
      </div>
      {showOpen && (
        <div className="modal-backdrop" onClick={() => setShowOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>打开 Git 仓库</h3>
            <input
              className="repo-path-input"
              placeholder="仓库路径，如 D:\Git\project"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && open()}
              autoFocus
            />
            <div className="modal-footer">
              <button onClick={() => setShowOpen(false)}>取消</button>
              <button className="primary" onClick={open}>打开</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
