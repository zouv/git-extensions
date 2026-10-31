import type { ReactNode } from "react";
import type { BranchInfo, TagInfo } from "../types";

interface Props {
  branches: BranchInfo[];
  tags: TagInfo[];
  activeRef: string | null;
  onFilter: (ref: string | null) => void;
  onCheckout: (name: string) => void;
  onClose: () => void;
}

/** 左侧分支树：点击按 ref 过滤日志，双击本地分支切换。 */
export default function LeftPanel({ branches, tags, activeRef, onFilter, onCheckout, onClose }: Props) {
  const local = branches.filter((b) => !b.isRemote);
  const remote = branches.filter((b) => b.isRemote);

  const item = (ref: string, label: string, extra?: ReactNode, onDoubleClick?: () => void) => (
    <div
      className={`tree-item${activeRef === ref ? " selected" : ""}`}
      onClick={() => onFilter(ref)}
      onDoubleClick={onDoubleClick}
      title={ref}
    >
      {label}
      {extra}
    </div>
  );

  return (
    <div className="left-panel">
      <div className="left-panel-header">
        <span>引用</span>
        <button className="icon-button" onClick={onClose} title="收起面板">×</button>
      </div>
      <div className="tree-items">
        <div className={`tree-item${activeRef === null ? " selected" : ""}`} onClick={() => onFilter(null)}>
          全部提交
        </div>
        <div className="tree-group">本地分支</div>
        {local.map((b) => (
          <div key={b.name}>
            {item(
              b.name,
              `${b.isHead ? "● " : ""}${b.name}`,
              undefined,
              b.isHead ? undefined : () => onCheckout(b.name),
            )}
          </div>
        ))}
        <div className="tree-group">远程分支</div>
        {remote.map((b) => (
          <div key={b.name}>{item(b.name, b.name)}</div>
        ))}
        <div className="tree-group">标签</div>
        {tags.map((t) => (
          <div key={t.name}>{item(t.name, t.name)}</div>
        ))}
      </div>
    </div>
  );
}
