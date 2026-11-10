import { useState } from "react";
import type { AppSettings } from "../settings";
import type { ExplorerAction, ExplorerMenuPlacement } from "../types";
import {
  EXPLORER_MENU_ACTIONS, EXPLORER_MENU_GROUPS, explorerMenuLevelCounts, explorerMenuPreview,
  MAX_MENU_LEVEL_ITEMS,
} from "../explorerMenu";
import Dialog from "../ui/Dialog";
import { useDirtyClose } from "../ui/useDirtyClose";
import { SHORTCUT_HELP } from "../commands";

interface Props {
  settings: AppSettings;
  onSave: (settings: AppSettings) => Promise<void>;
  /** 应用但不关闭设置面板；App 会更新 settings，面板据此重新计算 dirty。 */
  onApply: (settings: AppSettings) => Promise<void>;
  onClose: () => void;
  explorerIntegrationSupported: boolean;
}

type Category = "general" | "interface" | "system" | "shortcuts";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "general", label: "常规" },
  { id: "interface", label: "界面" },
  { id: "system", label: "系统集成" },
  { id: "shortcuts", label: "快捷键" },
];

export default function SettingsDialog({ settings, onSave, onApply, onClose, explorerIntegrationSupported }: Props) {
  const [draft, setDraft] = useState<AppSettings>({
    ...settings,
    explorerContextMenuPlacements: { ...settings.explorerContextMenuPlacements },
  });
  const [category, setCategory] = useState<Category>("general");
  const [saving, setSaving] = useState(false);
  const [applied, setApplied] = useState(false);
  const [saveError, setSaveError] = useState("");
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setApplied(false);
    setSaveError("");
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const requestClose = useDirtyClose(dirty, saving, onClose);
  const updatePlacement = (action: ExplorerAction, placement: ExplorerMenuPlacement) => {
    setDraft((prev) => ({
      ...prev,
      explorerContextMenuPlacements: { ...prev.explorerContextMenuPlacements, [action]: placement },
    }));
    setApplied(false);
    setSaveError("");
  };
  const preview = explorerMenuPreview(draft.explorerContextMenuPlacements, draft.explorerAlwaysShowAllCommands);
  const levels = explorerMenuLevelCounts(draft.explorerContextMenuPlacements, draft.explorerAlwaysShowAllCommands);
  const hasLevelIssue = !draft.explorerAlwaysShowAllCommands && levels.issues.length > 0;
  // 关闭菜单时应允许保存超限配置；只有启用时才阻止注册。
  const levelIssue = draft.explorerContextMenuEnabled && hasLevelIssue;
  const applyOrSave = async (mode: "apply" | "save") => {
    if (saving) return;
    if (levelIssue) {
      setSaveError(`菜单层级超出限制：${levels.issues.join("；")}`);
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      await (mode === "apply" ? onApply(draft) : onSave(draft));
      if (mode === "apply") setApplied(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return <Dialog
    title="设置"
    wide
    className="settings-dialog"
    onClose={requestClose}
    busy={saving}
    resizable
    sizeKey="settings"
    minWidth={720}
    minHeight={480}
    closeOnBackdrop={false}
    footer={<>
    {saveError && <div className="settings-error" role="alert">保存失败：{saveError}</div>}
    {applied && !dirty && <div className="settings-applied" role="status">设置已应用</div>}
    <div className="settings-footer-actions">
      <button type="button" disabled={saving} onClick={requestClose}>取消</button>
      <button type="button" disabled={saving || levelIssue || !dirty} title={levelIssue ? "请先调整菜单层级到限制以内" : undefined} onClick={() => void applyOrSave("apply")}>{saving ? "处理中…" : "应用"}</button>
      <button type="button" className="primary" disabled={saving || levelIssue} title={levelIssue ? "请先调整菜单层级到限制以内" : undefined} onClick={() => void applyOrSave("save")}>{saving ? "保存中…" : "保存"}</button>
    </div>
  </>}>
    <div className="settings-layout">
      <nav className="settings-categories" aria-label="设置分类" onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        if (buttons.length === 0) return;
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : event.key === "ArrowDown" ? (index < 0 ? 0 : Math.min(buttons.length - 1, index + 1))
          : (index <= 0 ? 0 : index - 1);
        buttons[next]?.focus();
        if (CATEGORIES[next]) setCategory(CATEGORIES[next].id);
      }}>
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
            <div className="shell-level-counts">
              <span>一级 {levels.level1} 项（系统菜单）</span>
              <span>二级 {levels.level2} 项（含 Others）</span>
              <span>三级 {levels.level3} 项</span>
              <span>级联合计：目录 {levels.directoryTotal} / 文件 {levels.fileTotal} 项（上限 {MAX_MENU_LEVEL_ITEMS}）</span>
              {draft.explorerAlwaysShowAllCommands && <span>已启用“始终显示全部命令”，层级设置不生效</span>}
            </div>
            {hasLevelIssue && <div className="shell-level-warning" role="alert">
              {levels.issues.map((issue) => <div key={issue}>⚠ {issue}。</div>)}
              {!draft.explorerContextMenuEnabled && <div>当前菜单未启用，可先保存；启用前需调整到上限以内。</div>}
            </div>}
            <div className="shell-command-columns">
              <div className="shell-command-list" role="group" aria-label="资源管理器命令">
                {EXPLORER_MENU_GROUPS.map((group) => <div className="shell-command-group" key={group.id}>
                  <div className="shell-command-group-label">{group.label}</div>
                  {EXPLORER_MENU_ACTIONS.filter((spec) => spec.group === group.id).map((spec) => <div className="shell-command-row" key={spec.action}>
                    <span className="shell-command-label">{spec.label}</span>
                    <select
                      className="shell-level-select"
                      aria-label={`${spec.label} 菜单位置`}
                      disabled={saving || !explorerIntegrationSupported}
                      value={draft.explorerContextMenuPlacements[spec.action]}
                      onChange={(e) => updatePlacement(spec.action, e.target.value as ExplorerMenuPlacement)}
                    >
                      <option value="top">一级</option>
                      <option value="cascade">二级</option>
                      <option value="others">三级（Others）</option>
                      <option value="hidden">隐藏</option>
                    </select>
                  </div>)}
                </div>)}
              </div>
              <div className="shell-menu-preview" aria-label="Context menu preview">
                <h5>Context menu preview</h5>
                {!draft.explorerContextMenuEnabled && <div className="settings-note">当前未启用，以下为保存并启用后的预览。</div>}
                {(preview.groups.length > 0 || preview.otherGroups.length > 0) && <div>Git Extensions &gt;
                  <div className="shell-menu-preview-children">
                    {preview.groups.map((group, groupIndex) => <div key={group.id}>
                      {groupIndex > 0 && <div className="shell-menu-preview-separator" />}
                      {group.items.map((spec) => <div key={spec.action}>{spec.label}</div>)}
                    </div>)}
                    {preview.otherGroups.length > 0 && <div>
                      <div className="shell-menu-preview-separator" />
                      <div>Others &gt;
                        <div className="shell-menu-preview-children">
                          {preview.otherGroups.map((group, groupIndex) => <div key={group.id}>
                            {groupIndex > 0 && <div className="shell-menu-preview-separator" />}
                            {group.items.map((spec) => <div key={spec.action}>{spec.label}</div>)}
                          </div>)}
                        </div>
                      </div>
                    </div>}
                  </div>
                </div>}
                {preview.topLevel.length > 0 && <>
                  <div className="shell-menu-preview-separator" />
                  <div className="settings-note">一级（紧贴 Git Extensions 下方，按设置顺序）</div>
                  {preview.topLevel.map((spec) => <div key={spec.action}>GitExt {spec.label}</div>)}
                </>}
                {preview.topLevel.length === 0 && preview.groups.length === 0 && preview.otherGroups.length === 0 && <div className="settings-note">（无菜单项）</div>}
              </div>
            </div>
            <div className="settings-note">菜单位置：一级 = 系统右键菜单（紧贴 Git Extensions 下方）；二级 = Git Extensions 子菜单；三级 = Others 子菜单；隐藏 = 不显示。Windows 对整棵级联菜单（Git Extensions 子菜单 + Others 子菜单）合计最多渲染 16 个命令，超出部分会被系统静默丢弃；设置页按目录 / 文件上下文分别提示，不会自动移动其它命令。一级是系统右键菜单，不受此限制。便携版移动程序位置后，请重新启用菜单。</div>
          </fieldset>
          {!explorerIntegrationSupported && <div className="settings-note" role="status">当前操作系统不支持资源管理器右键菜单集成。</div>}
        </>}
        {category === "shortcuts" && <div className="shortcut-help">
          <h4>快捷键</h4>
          {SHORTCUT_HELP.map((item) => <div key={item.keys}><kbd>{item.keys}</kbd>{item.text}</div>)}
        </div>}
      </section>
    </div>
  </Dialog>;
}
