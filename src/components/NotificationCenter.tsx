import { useState } from "react";
import Icon from "../ui/Icon";
import Dialog from "../ui/Dialog";

export interface Notice {
  id: number;
  repoPath: string;
  repoName: string;
  kind: "success" | "error" | "info";
  message: string;
  details?: string;
}

export default function NotificationCenter({ notices, onDismiss, onClear }: { notices: Notice[]; onDismiss: (id: number) => void; onClear: () => void }) {
  const [details, setDetails] = useState<Notice | null>(null);
  return (
    <>
      <div className="toast-region" aria-live="polite">
        {notices.slice(-4).map((notice) => (
          <div className={`toast ${notice.kind}`} key={notice.id}>
            <Icon name={notice.kind === "success" ? "check" : notice.kind === "error" ? "warning" : "history"} />
            <button className="toast-content" onClick={() => setDetails(notice)}>
              <strong>{notice.repoName}</strong>
              <span>{notice.message}</span>
            </button>
            <button className="icon-button" aria-label="关闭通知" onClick={() => onDismiss(notice.id)}><Icon name="close" size={13} /></button>
          </div>
        ))}
      </div>
      {details && <Dialog title={`${details.repoName} · 操作详情`} onClose={() => setDetails(null)} wide footer={<>
        <button onClick={() => { void navigator.clipboard?.writeText(details.details || details.message); }}>复制详情</button>
        <button className="primary" onClick={() => setDetails(null)}>关闭</button>
      </>}>
        <div className={`notice-detail ${details.kind}`}>{details.message}</div>
        <pre className="git-output">{details.details || "无额外输出"}</pre>
      </Dialog>}
      {notices.length > 4 && <button className="notification-more" onClick={onClear}>清理 {notices.length} 条通知</button>}
    </>
  );
}
