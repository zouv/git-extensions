import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { CompareResult, FileDiff } from "../types";
import DiffView from "./DiffView";
import type { FileAction } from "./DiffView";
import Icon from "../ui/Icon";

interface Props {
  repoPath: string;
  initialBase: string;
  initialTarget: string;
  refs: string[];
  onClose: () => void;
  onFileAction: (action: FileAction, file: FileDiff) => void;
  onError: (message: string) => void;
}

export default function CompareView(props: Props) {
  const [base, setBase] = useState(props.initialBase);
  const [target, setTarget] = useState(props.initialTarget);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(true);

  const compare = useCallback(async (a: string, b: string) => {
    if (!a.trim() || !b.trim()) return;
    setLoading(true);
    try { setResult(await api.getCompareDiff(props.repoPath, a.trim(), b.trim())); }
    catch (e) { props.onError(String(e)); }
    finally { setLoading(false); }
  }, [props.repoPath, props.onError]);

  useEffect(() => {
    setBase(props.initialBase);
    setTarget(props.initialTarget);
    void compare(props.initialBase, props.initialTarget);
  }, [compare, props.initialBase, props.initialTarget]);

  return (
    <div className="task-view compare-view">
      <div className="task-header">
        <button className="icon-button" title="返回历史" onClick={props.onClose}>←</button>
        <Icon name="compare" />
        <strong>比较文件差异</strong>
        <div className="compare-selectors">
          <input aria-label="对比基准" list="compare-refs" value={base} onChange={(e) => setBase(e.target.value)} />
          <span>与</span>
          <input aria-label="对比目标" list="compare-refs" value={target} onChange={(e) => setTarget(e.target.value)} />
          <datalist id="compare-refs">{props.refs.map((ref) => <option key={ref} value={ref} />)}</datalist>
        </div>
        <button disabled={loading || !base.trim() || !target.trim()} onClick={() => void compare(base, target)}>比较</button>
        <button title="交换两端" disabled={loading} onClick={() => { setBase(target); setTarget(base); void compare(target, base); }}><Icon name="compare" />交换</button>
        {result && <button title="复制两端完整 SHA" onClick={() => { void navigator.clipboard?.writeText(`${result.baseOid} ${result.targetOid}`); }}><Icon name="copy" />复制范围</button>}
      </div>
      <div className="compare-summary">
        {result ? <><span className="mono">{result.baseOid.slice(0, 10)}</span><span>→</span><span className="mono">{result.targetOid.slice(0, 10)}</span><span>{result.files.length} 个文件</span></> : <span>比较两个提交、分支或标签的文件树</span>}
      </div>
      <div className="task-content"><DiffView files={result?.files ?? []} loading={loading} onFileAction={props.onFileAction} /></div>
    </div>
  );
}
