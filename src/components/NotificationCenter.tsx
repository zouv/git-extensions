import { useEffect, useState } from "react";
import Icon from "../ui/Icon";
import Dialog from "../ui/Dialog";
import { useConfirm } from "../ui/Confirm";

export interface Notice {
  id: number;
  repoPath: string;
  repoName: string;
  kind: "success" | "error" | "info";
  message: string;
  details?: string;
}

function ToastItem({ notice, onDismiss, onShowDetails }: { notice: Notice; onDismiss: (id: number) => void; onShowDetails: (notice: Notice) => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (notice.kind !== "success" || paused) return;
    const timer = window.setTimeout(() => onDismiss(notice.id), 4000);
    return () => window.clearTimeout(timer);
  }, [notice.id, notice.kind, onDismiss, paused]);
  return (
    <div
      className={`toast ${notice.kind}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <Icon name={notice.kind === "success" ? "check" : notice.kind === "error" ? "warning" : "history"} />
      <button className="toast-content" onClick={() => onShowDetails(notice)}>
        <strong>{notice.repoName}</strong>
        <span>{notice.message}</span>
      </button>
      <button className="icon-button" aria-label="关闭通知" onClick={() => onDismiss(notice.id)}><Icon name="close" size={13} /></button>
    </div>
  );
}

export default function NotificationCenter({ notices, onDismiss, onClear }: { notices: Notice[]; onDismiss: (id: number) => void; onClear: () => void }) {
  const [details, setDetails] = useState<Notice | null>(null);
  const [open, setOpen] = useState(false);
  const confirm = useConfirm();
  const errorCount = notices.filter((notice) => notice.kind === "error").length;

  const clearAll = async () => {
    if (notices.length === 0) return;
    if (errorCount > 0 && !await confirm({
      title: "清空通知中心？",
      body: `其中包含 ${errorCount} 条错误通知，清空后无法在应用内再次查看。`,
      confirmLabel: "清空全部",
      danger: true,
    })) return;
    onClear();
    setOpen(false);
  };

  return (
    <>
      <div className="notification-region">
        <div className="toast-region" aria-live="polite" role="log">
          {notices.slice(-4).map((notice) => (
            <ToastItem key={notice.id} notice={notice} onDismiss={onDismiss} onShowDetails={setDetails} />
          ))}
        </div>
        {notices.length > 0 && (
          <button className="notification-trigger" type="button" onClick={() => setOpen(true)} title={`通知中心：${notices.length} 条通知，${errorCount} 条错误`}>
            <Icon name={errorCount > 0 ? "warning" : "history"} size={14} />
            <span>通知</span>
            <span className={`notification-count${errorCount > 0 ? " has-error" : ""}`}>{notices.length}</span>
          </button>
        )}
      </div>
      {open && <Dialog title="通知中心" wide onClose={() => setOpen(false)} footer={<>
        <button onClick={() => void clearAll()} disabled={notices.length === 0}>清空全部</button>
        <button className="primary" onClick={() => setOpen(false)}>关闭</button>
      </>}>
        <div className="notification-list" role="list">
          {notices.slice().reverse().map((notice) => (
            <div className={`notification-row ${notice.kind}`} role="listitem" key={notice.id}>
              <Icon name={notice.kind === "success" ? "check" : notice.kind === "error" ? "warning" : "history"} size={15} />
              <span className="notification-repo" title={notice.repoPath}>{notice.repoName}</span>
              <button className="notification-message" type="button" onClick={() => setDetails(notice)} title="查看完整详情">{notice.message}</button>
              <button className="icon-button" aria-label="关闭这条通知" onClick={() => onDismiss(notice.id)}><Icon name="close" size={13} /></button>
            </div>
          ))}
          {notices.length === 0 && <div className="panel-hint">（没有通知）</div>}
        </div>
      </Dialog>}
      {details && <Dialog title={`${details.repoName} · 操作详情`} onClose={() => setDetails(null)} wide footer={<>
        <button onClick={() => { void navigator.clipboard?.writeText(details.details || details.message); }}>复制详情</button>
        <button className="primary" onClick={() => setDetails(null)}>关闭</button>
      </>}>
        <div className={`notice-detail ${details.kind}`}>{details.message}</div>
        <pre className="git-output">{details.details || "无额外输出"}</pre>
      </Dialog>}
    </>
  );
}
