import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import Dialog from "../ui/Dialog";
import InlineError from "../ui/InlineError";

interface Props {
  repoPath: string;
  relativePath: string;
  onClose: () => void;
  onChanged: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  setMessage: (message: string) => void;
}

function baseName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function selectStem(input: HTMLInputElement) {
  const dot = input.value.lastIndexOf(".");
  if (dot > 0) input.setSelectionRange(0, dot);
  else input.select();
}

/** Windows 共享冲突：目录可能是某个终端 / 编辑器 / Agent 的当前工作目录。 */
const RENAME_LOCKED = /permission denied|access is denied|being used by another process|拒绝访问/i;

function renameErrorText(reason: unknown): string {
  const text = String(reason);
  if (!RENAME_LOCKED.test(text)) return text;
  return `无法重命名：Windows 拒绝访问，目标目录 / 文件正被其它程序占用。常见原因：\n`
    + `· 终端、编辑器或 Agent 把该目录作为当前工作目录（Windows 不允许重命名这种目录）；\n`
    + `· 目录内有文件正被打开、预览或同步。\n`
    + `请关闭占用它的程序（或在其中切换到别的目录）后重试。\n\n${text}`;
}

/** 资源管理器 Rename 动作：对选中的文件 / 目录执行 `git mv`（同目录改名）。 */
export default function RenamePathDialog({ repoPath, relativePath, onClose, onChanged, onDirtyChange, setMessage }: Props) {
  const original = baseName(relativePath);
  const [name, setName] = useState(original);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const repoBusy = useRepoBusy(repoPath);
  const inputRef = useRef<HTMLInputElement>(null);
  const parent = relativePath.includes("/") ? `${relativePath.slice(0, relativePath.lastIndexOf("/"))}/` : "";

  useLayoutEffect(() => {
    if (inputRef.current) selectStem(inputRef.current);
  }, []);

  const renamed = name !== original;
  useEffect(() => {
    onDirtyChange?.(renamed);
    return () => onDirtyChange?.(false);
  }, [renamed, onDirtyChange]);
  const submit = async () => {
    if (busy || repoBusy || !renamed) return;
    setBusy(true);
    setError("");
    try {
      const next = await api.renamePath(repoPath, relativePath, name);
      setMessage(`已重命名为 ${next}`);
      onChanged();
      onClose();
    } catch (reason) {
      setError(renameErrorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || repoBusy;
  return <Dialog title="重命名" onClose={onClose} busy={busy} dirty={renamed} footer={<>
    <button disabled={disabled} onClick={onClose}>取消</button>
    <button className="primary" disabled={disabled || !renamed || !name.trim()} onClick={() => void submit()}>
      {busy ? "重命名中…" : "重命名"}
    </button>
  </>}>
    <form className="dialog-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label>
        <span className="settings-note">新名称（仅改名，不移动目录）</span>
        <input
          ref={inputRef}
          data-autofocus
          value={name}
          disabled={disabled}
          onChange={(event) => { setName(event.target.value); setError(""); }}
          aria-label="新名称"
        />
      </label>
      <div className="settings-note">
        {parent && <span>{parent}</span>}
        <strong>{original}</strong>
        <span> → </span>
        <strong>{name.trim() || "…"}</strong>
      </div>
      <div className="settings-note">通过 <code>git mv</code> 执行；未跟踪的文件或目录请先用 Add files 加入索引。仓库根目录不能重命名。</div>
      {error && <InlineError message={error} />}
    </form>
  </Dialog>;
}
