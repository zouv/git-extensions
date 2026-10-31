import { useState } from "react";
import type { AppSettings } from "../settings";
import Dialog from "../ui/Dialog";

interface Props { settings: AppSettings; onSave: (settings: AppSettings) => void; onClose: () => void }

export default function SettingsDialog({ settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => setDraft((prev) => ({ ...prev, [key]: value }));
  return <Dialog title="设置" onClose={onClose} footer={<><button onClick={onClose}>取消</button><button className="primary" onClick={() => onSave(draft)}>保存</button></>}>
    <label className="setting-row"><span>工作区变更自动刷新</span><input type="checkbox" checked={draft.autoRefresh} onChange={(e) => update("autoRefresh", e.target.checked)} /></label>
    <label className="setting-row"><span>轮询间隔</span><select value={draft.pollIntervalSeconds} disabled={!draft.autoRefresh} onChange={(e) => update("pollIntervalSeconds", Number(e.target.value))}>{[3, 5, 10, 30, 60].map((seconds) => <option key={seconds} value={seconds}>{seconds} 秒</option>)}</select></label>
    <label className="setting-row"><span>diff 语法高亮</span><input type="checkbox" checked={draft.highlightEnabled} onChange={(e) => update("highlightEnabled", e.target.checked)} /></label>
    <label className="setting-row"><span>新仓库默认显示导航</span><input type="checkbox" checked={draft.showLeftPanel} onChange={(e) => update("showLeftPanel", e.target.checked)} /></label>
    <label className="setting-row"><span>提交日志加载上限</span><select value={draft.maxLogCount} onChange={(e) => update("maxLogCount", Number(e.target.value))}>{[10_000, 50_000, 100_000, 200_000].map((count) => <option key={count} value={count}>{count.toLocaleString()} 条</option>)}</select></label>
    <div className="settings-note">行为设置保存在本机；面板尺寸与位置按仓库独立保存。日志上限在保存后重新加载。</div>
    <details className="shortcut-help"><summary>查看全部快捷键</summary>
      <div><kbd>Ctrl+O</kbd> 打开仓库　<kbd>Ctrl+W</kbd> 关闭页签　<kbd>Ctrl+Tab</kbd> 切换仓库</div>
      <div><kbd>Ctrl+1/2/3</kbd> 历史 / 变更 / 对比　<kbd>F5</kbd> 刷新　<kbd>F6</kbd> 面板焦点</div>
      <div><kbd>Ctrl+F</kbd> 过滤　<kbd>Ctrl+B</kbd> 导航　<kbd>Shift+F10</kbd> 右键菜单</div>
      <div><kbd>↑/↓</kbd> 选择提交　<kbd>PgUp/PgDn</kbd> 翻页　<kbd>Enter</kbd> 查看差异</div>
      <div><kbd>Ctrl+Shift+B/S/T/M</kbd> 分支 / Stash / 标签 / 子模块</div>
      <div><kbd>Ctrl+Shift+F/L/P</kbd> Fetch / Pull / Push　<kbd>Ctrl+Enter</kbd> 提交</div>
      <div><kbd>Ctrl+S</kbd> 保存冲突结果　<kbd>Esc</kbd> 退出最大化 / 关闭弹窗</div>
    </details>
  </Dialog>;
}
