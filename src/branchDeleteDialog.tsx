import type { BranchDeleteDecision } from "./branchDelete";
import type { ConfirmOptions } from "./ui/confirmContext";

export function singleBranchDeleteConfirm(name: string, oid: string, force: boolean): ConfirmOptions {
  const shortOid = oid ? oid.slice(0, 7) : "未知";
  return {
    title: `删除分支 ${name}？`,
    body: force ? (
      <div>
        <p className="warning-text">分支 {name} 未通过 Git 的合并检查，可能包含尚未合并的提交。强制删除后这些提交可能难以找回。</p>
        <p>分支提交：<code>{shortOid}</code>。只删除本地分支，不会影响远程分支。</p>
      </div>
    ) : (
      <div>
        <p>分支 {name} 已通过 Git 的合并检查，可以安全删除。</p>
        <p>分支提交：<code>{shortOid}</code>。只删除本地分支，不会影响远程分支。</p>
      </div>
    ),
    confirmLabel: force ? "强制删除" : "删除分支",
    danger: force,
  };
}

export function localFolderDeleteConfirm(prefix: string, decision: BranchDeleteDecision): ConfirmOptions {
  const count = decision.names.length;
  const unmerged = new Set(decision.unmerged);
  const lines = decision.names.map((name) => (unmerged.has(name) ? `${name}（未合并）` : name));
  return {
    title: `删除目录 ${prefix}/ 下的 ${count} 个分支？`,
    body: (
      <div>
        {decision.force ? (
          <p className="warning-text">标记「未合并」的分支需要强制删除；确认后将强制删除目录下全部 {count} 个分支，未合并的提交可能难以找回。</p>
        ) : (
          <p>以下分支均已通过 Git 的合并检查，可以安全删除。</p>
        )}
        <pre className="confirm-file-list">{lines.join("\n")}</pre>
        {decision.missing.length > 0 && (
          <p className="muted">以下分支已不存在，将跳过：{decision.missing.join("、")}</p>
        )}
      </div>
    ),
    confirmLabel: decision.force ? "强制删除" : `删除 ${count} 个分支`,
    danger: decision.force,
  };
}

export function remoteFolderDeleteConfirm(prefix: string, names: string[]): ConfirmOptions {
  return {
    title: `删除目录 ${prefix}/ 下的 ${names.length} 个远程分支？`,
    body: (
      <div>
        <p className="warning-text">将向远程逐个执行 git push --delete，删除后其他协作者也会失去这些远端分支引用。</p>
        <pre className="confirm-file-list">{names.join("\n")}</pre>
      </div>
    ),
    confirmLabel: `删除 ${names.length} 个远程分支`,
    danger: true,
    requireAck: true,
    ackLabel: "我确认从远端仓库删除这些分支",
  };
}
