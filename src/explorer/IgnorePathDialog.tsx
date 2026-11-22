import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import Dialog from "../ui/Dialog";

interface Props {
  repoPath: string;
  relativePath: string;
  scope: "directory" | "file";
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  setMessage: (message: string) => void;
  /** 写入成功后的回调（主窗口用于刷新工作区；轻量窗口关闭后不需要）。 */
  onChanged?: () => void;
  /** 覆盖默认规则（如「忽略同类后缀」传入 *.ext）；两个写入位置都用它。 */
  initialPattern?: string;
}

function baseName(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] ?? path;
}

/**
 * Add to ignore 弹窗（资源管理器动作与主窗口变更面板共用）：把选中的
 * 文件 / 目录写入仓库根目录或其所属目录的 .gitignore。规则默认选中完整
 * 路径（根目录）或末段名称（所属目录），两者都可编辑。
 */
export default function IgnorePathDialog({ repoPath, relativePath, scope, onClose, onDirtyChange, setMessage, onChanged, initialPattern }: Props) {
  const cleanPath = relativePath.replace(/\/+$/, "");
  const parentDir = cleanPath.includes("/") ? cleanPath.slice(0, cleanPath.lastIndexOf("/")) : "";
  const rootRule = initialPattern ?? (scope === "directory" ? `${cleanPath}/` : cleanPath);
  const localRule = initialPattern ?? `${baseName(cleanPath)}${scope === "directory" ? "/" : ""}`;
  const [location, setLocation] = useState<"root" | "parent">("root");
  const [pattern, setPattern] = useState(rootRule);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const repoBusy = useRepoBusy(repoPath);
  const initial = useMemo(() => ({ rootRule, localRule, parentDir }), [rootRule, localRule, parentDir]);
  const dirty = (location === "root" && pattern !== initial.rootRule)
    || (location === "parent" && pattern !== initial.localRule);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  const chooseLocation = (next: "root" | "parent") => {
    if (next === location) return;
    setLocation(next);
    setPattern(next === "root" ? initial.rootRule : initial.localRule);
  };

  const submit = async () => {
    const rule = pattern.trim();
    if (busy || repoBusy || !rule || rule.includes("\n") || rule.includes("\r")) return;
    setBusy(true);
    setError("");
    try {
      const message = await api.ignoreFileAt(
        repoPath,
        location === "parent" ? initial.parentDir : null,
        rule,
      );
      setMessage(message);
      onChanged?.();
      onClose();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || repoBusy;
  return <Dialog title="添加到 ignore" onClose={onClose} busy={disabled} footer={<>
    <button disabled={disabled} onClick={onClose}>取消</button>
    <button className="primary" disabled={disabled || !pattern.trim()} onClick={() => void submit()}>
      {busy ? "添加中…" : "添加"}
    </button>
  </>}>
    <div className="dialog-form">
      <label><span>目标</span><input readOnly value={relativePath} /></label>
      <fieldset disabled={disabled}>
        <legend>写入位置</legend>
        <label className="radio-row">
          <input type="radio" name="ignore-location" checked={location === "root"} onChange={() => chooseLocation("root")} />
          <span>项目根目录 <code>.gitignore</code></span>
        </label>
        <label className="radio-row">
          <input type="radio" name="ignore-location" checked={location === "parent"} onChange={() => chooseLocation("parent")} />
          <span>所属目录 <code>{initial.parentDir || "."}/.gitignore</code></span>
        </label>
      </fieldset>
      <label><span>ignore 规则</span><input data-autofocus disabled={disabled} value={pattern} onChange={(event) => setPattern(event.target.value)} /></label>
      <div className="settings-note">根目录规则按仓库根路径匹配；所属目录规则只在该目录及其子目录生效。已存在的相同规则不会重复写入。</div>
      {error && <div className="inline-error" role="alert">{error}</div>}
    </div>
  </Dialog>;
}
