import { useCallback, useEffect, useRef, useState } from "react";
import type { AppSettings } from "../settings";
import type { ExplorerAction, ExplorerMenuPlacement } from "../types";
import {
  EXPLORER_MENU_ACTIONS, explorerMenuPreview, nextExplorerMenuPlacement,
} from "../explorerMenu";
import Dialog from "../ui/Dialog";

interface Props {
  settings: AppSettings;
  onSave: (settings: AppSettings) => Promise<void>;
  onClose: () => void;
  explorerIntegrationSupported: boolean;
}

type Category = "general" | "interface" | "system" | "shortcuts";

function PlacementCheckbox({ action, placement, disabled, onChange }: {
  action: ExplorerAction;
  placement: ExplorerMenuPlacement;
  disabled: boolean;
  onChange: (action: ExplorerAction, placement: ExplorerMenuPlacement) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = placement === "cascade"; }, [placement]);
  return <input
    ref={ref}
    type="checkbox"
    checked={placement === "top"}
    aria-checked={placement === "cascade" ? "mixed" : placement === "top"}
    disabled={disabled}
    onChange={() => onChange(action, nextExplorerMenuPlacement(placement))}
  />;
}

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "general", label: "常规" },
  { id: "interface", label: "界面" },
  { id: "system", label: "系统集成" },
  { id: "shortcuts", label: "快捷键" },
];

export default function SettingsDialog({ settings, onSave, onClose, explorerIntegrationSupported }: Props) {
  const [draft, setDraft] = useState<AppSettings>({
    ...settings,
    explorerContextMenuPlacements: { ...settings.explorerContextMenuPlacements },
  });
  const [category, setCategory] = useState<Category>("general");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setSaveError("");
  };
  const requestClose = useCallback(() => { if (!saving) onClose(); }, [onClose, saving]);
  const updatePlacement = (action: ExplorerAction, placement: ExplorerMenuPlacement) => {
    setDraft((prev) => ({
      ...prev,
      explorerContextMenuPlacements: { ...prev.explorerContextMenuPlacements, [action]: placement },
    }));
    setSaveError("");
  };
  const preview = explorerMenuPreview(draft.explorerContextMenuPlacements, draft.explorerAlwaysShowAllCommands);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError("");
    try {
      await onSave(draft);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return <Dialog title="设置" wide className="settings-dialog" onClose={requestClose} busy={saving} footer={<>
    {saveError && <div className="settings-error" role="alert">保存失败：{saveError}</div>}
    <div className="settings-footer-actions">
      <button type="button" disabled={saving} onClick={requestClose}>取消</button>
      <button type="button" className="primary" disabled={saving} onClick={() => void save()}>{saving ? "保存中…" : "保存"}</button>
    </div>
  </>}>
    <div className="settings-layout">
      <nav className="settings-categories" aria-label="设置分类">
        {CATEGORIES.map((item) => <button
          type="button"
          key={item.id}
          className="settings-category"
          aria-current={category === item.id ? "page" : undefined}
          disabled={saving}
          onClick={() => setCategory(item.id)}
        >{item.label}</button>)}
      </nav>
      <section className="settings-panel" aria-label={CATEGORIES.find((item) => item.id === category)?.label}>
        {category === "general" && <>
          <h4>常规</h4>
          <label className="setting-row"><span>工作区变更自动刷新</span><input type="checkbox" checked={draft.autoRefresh} disabled={saving} onChange={(e) => update("autoRefresh", e.target.checked)} /></label>
          <label className="setting-row"><span>轮询间隔</span><select value={draft.pollIntervalSeconds} disabled={saving || !draft.autoRefresh} onChange={(e) => update("pollIntervalSeconds", Number(e.target.value))}>{[3, 5, 10, 30, 60].map((seconds) => <option key={seconds} value={seconds}>{seconds} 秒</option>)}</select></label>
          <label className="setting-row"><span>提交日志加载上限</span><select value={draft.maxLogCount} disabled={saving} onChange={(e) => update("maxLogCount", Number(e.target.value))}>{[10_000, 50_000, 100_000, 200_000].map((count) => <option key={count} value={count}>{count.toLocaleString()} 条</option>)}</select></label>
          <div className="settings-note">行为设置保存在本机；日志上限在保存后重新加载。</div>
        </>}
        {category === "interface" && <>
          <h4>界面</h4>
          <label className="setting-row"><span>diff 语法高亮</span><input type="checkbox" checked={draft.highlightEnabled} disabled={saving} onChange={(e) => update("highlightEnabled", e.target.checked)} /></label>
          <label className="setting-row"><span>新仓库默认显示导航</span><input type="checkbox" checked={draft.showLeftPanel} disabled={saving} onChange={(e) => update("showLeftPanel", e.target.checked)} /></label>
          <div className="settings-note">面板尺寸与位置按仓库独立保存。</div>
        </>}
        {category === "system" && <>
          <h4>Shell extension</h4>
          <fieldset className="shell-settings-section" disabled={saving || !explorerIntegrationSupported}>
            <legend>Windows Explorer integration</legend>
            <label className="setting-row"><span>启用资源管理器 Git Extensions 右键菜单</span><input type="checkbox" checked={draft.explorerContextMenuEnabled} onChange={(e) => update("explorerContextMenuEnabled", e.target.checked)} /></label>
            <p className="settings-description">为目录、目录背景和文件添加菜单，仅对当前用户生效，无需管理员权限。文件菜单不包含 Clone / Create new repository；Windows 11 中位于“显示更多选项”。</p>
          </fieldset>
          <fieldset className="shell-settings-section" disabled={saving || !explorerIntegrationSupported}>
            <legend>Cascaded context menu</legend>
            <label className="shell-always-row"><input type="checkbox" checked={draft.explorerAlwaysShowAllCommands} onChange={(e) => update("explorerAlwaysShowAllCommands", e.target.checked)} /><span>始终显示全部命令</span></label>
            <div className="settings-note">勾选后，未隐藏的命令全部展开到顶级，不再放入 Git Extensions 二级菜单。</div>
            <div className="shell-command-columns">
              <div className="shell-command-list" role="group" aria-label="资源管理器命令">
                {EXPLORER_MENU_ACTIONS.map((spec) => <label className="shell-command-row" key={spec.action}>
                  <PlacementCheckbox action={spec.action} placement={draft.explorerContextMenuPlacements[spec.action]} disabled={saving || !explorerIntegrationSupported} onChange={updatePlacement} />
                  <span>{spec.label}</span>
                </label>)}
              </div>
              <div className="shell-menu-preview" aria-label="Context menu preview">
                <h5>Context menu preview</h5>
                {!draft.explorerContextMenuEnabled && <div className="settings-note">当前未启用，以下为保存并启用后的预览。</div>}
                {preview.topLevel.map((spec) => <div key={spec.action}>GitExt {spec.label}</div>)}
                {preview.cascade.length > 0 && <div>Git Extensions &gt;
                  <div className="shell-menu-preview-children">{preview.cascade.map((spec) => <div key={spec.action}>{spec.label}</div>)}</div>
                </div>}
                {preview.topLevel.length === 0 && preview.cascade.length === 0 && <div className="settings-note">（无菜单项）</div>}
              </div>
            </div>
            <div className="settings-note">三态复选框：勾选 = 顶级显示；半选 = 二级菜单；不勾选 = 不显示。便携版移动程序位置后，请重新启用菜单。</div>
          </fieldset>
          {!explorerIntegrationSupported && <div className="settings-note" role="status">当前操作系统不支持资源管理器右键菜单集成。</div>}
        </>}
        {category === "shortcuts" && <div className="shortcut-help">
          <h4>快捷键</h4>
          <div><kbd>Ctrl+O</kbd> 打开仓库　<kbd>Ctrl+W</kbd> 关闭页签　<kbd>Ctrl+Tab</kbd> 切换仓库</div>
          <div><kbd>Ctrl+1/2/3</kbd> 历史 / 变更 / 对比　<kbd>F5</kbd> 刷新　<kbd>F6</kbd> 面板焦点</div>
          <div><kbd>Ctrl+F</kbd> 过滤　<kbd>Ctrl+B</kbd> 导航　<kbd>Shift+F10</kbd> 右键菜单</div>
          <div><kbd>↑/↓</kbd> 选择提交　<kbd>PgUp/PgDn</kbd> 翻页　<kbd>Enter</kbd> 查看差异</div>
          <div><kbd>Ctrl+Shift+B/S/T/M</kbd> 分支 / Stash / 标签 / 子模块</div>
          <div><kbd>Ctrl+Shift+F/L/P</kbd> Fetch / Pull / Push　<kbd>Ctrl+Enter</kbd> 提交</div>
          <div><kbd>Ctrl+S</kbd> 保存冲突结果　<kbd>Esc</kbd> 退出最大化 / 关闭弹窗</div>
        </div>}
      </section>
    </div>
  </Dialog>;
}
