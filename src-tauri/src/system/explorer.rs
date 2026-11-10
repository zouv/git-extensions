use std::error::Error;
use std::fmt::{Display, Formatter};
use std::path::{Path, PathBuf};

use crate::launch::ExplorerAction;

const OWNER_VALUE: &str = "GitExtensionsOwner";
const OWNER: &str = "git-extensions";
const DEFAULT_VALUE: &str = "";
const CASCADE_KEY: &str = "GitExt.Menu";
const CONTEXTS: [Context; 3] = [
    Context {
        root: r"Software\Classes\Directory\shell",
        classes_root: r"Directory\shell",
        placeholder: "%1",
        file_context: false,
        background: false,
    },
    Context {
        root: r"Software\Classes\Directory\Background\shell",
        classes_root: r"Directory\Background\shell",
        placeholder: "%V",
        file_context: false,
        background: true,
    },
    Context {
        root: r"Software\Classes\*\shell",
        classes_root: r"*\shell",
        placeholder: "%1",
        file_context: true,
        background: false,
    },
];

#[derive(Clone, Copy)]
struct Context {
    root: &'static str,
    classes_root: &'static str,
    placeholder: &'static str,
    file_context: bool,
    background: bool,
}

impl Context {
    /// 与参考项目的 Shell Extension 对齐：仓库级动作只在目录上下文出现，
    /// 单文件动作只在文件上下文出现；Open/Add/Reset/Settings 两者都可用。
    fn supports(self, action: ExplorerAction) -> bool {
        match action {
            ExplorerAction::Clone | ExplorerAction::CreateRepository => !self.file_context,
            ExplorerAction::OpenWithDifftool
            | ExplorerAction::FileHistory
            | ExplorerAction::ApplyPatch => self.file_context,
            ExplorerAction::Commit
            | ExplorerAction::Pull
            | ExplorerAction::Push
            | ExplorerAction::ViewStash
            | ExplorerAction::ViewChanges
            | ExplorerAction::CheckoutBranch
            | ExplorerAction::CheckoutRevision
            | ExplorerAction::CreateBranch => !self.file_context,
            ExplorerAction::OpenRepository
            | ExplorerAction::ResetFileChanges
            | ExplorerAction::AddFiles
            | ExplorerAction::Settings
            | ExplorerAction::RepositorySettings
            | ExplorerAction::ViewFiles => true,
            // 重命名作用于选中的文件或目录；目录背景菜单里的 %V 是当前
            // 文件夹本身，在那里提供重命名容易误操作，故只在一级上下文出现。
            ExplorerAction::Rename => !self.background,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MenuPlacement {
    Top,
    Cascade,
    Others,
    Hidden,
}

#[derive(Debug, Clone, Copy, serde::Deserialize)]
pub struct ExplorerMenuItem {
    pub action: ExplorerAction,
    pub placement: MenuPlacement,
}

struct ActionSpec {
    action: ExplorerAction,
    label: &'static str,
    key: &'static str,
    icon: &'static str,
}

/// Explorer sorts cascaded submenu entries by their registry key names. The
/// group prefix and action index below keep the flat second-level menu in the
/// reference project's order; groups are separated with CommandFlags.
struct GroupSpec {
    prefix: &'static str,
    actions: &'static [ExplorerAction],
}

const GROUPS: [GroupSpec; 4] = [
    GroupSpec {
        prefix: "10",
        actions: &[
            ExplorerAction::Clone,
            ExplorerAction::Commit,
            ExplorerAction::Pull,
            ExplorerAction::Push,
            ExplorerAction::ViewStash,
            ExplorerAction::ViewChanges,
        ],
    },
    GroupSpec {
        prefix: "20",
        actions: &[
            ExplorerAction::CreateRepository,
            ExplorerAction::OpenRepository,
            ExplorerAction::CheckoutBranch,
            ExplorerAction::CheckoutRevision,
            ExplorerAction::CreateBranch,
        ],
    },
    GroupSpec {
        prefix: "30",
        actions: &[
            ExplorerAction::OpenWithDifftool,
            ExplorerAction::FileHistory,
            ExplorerAction::ViewFiles,
            ExplorerAction::ResetFileChanges,
            ExplorerAction::AddFiles,
            ExplorerAction::ApplyPatch,
            ExplorerAction::Rename,
        ],
    },
    GroupSpec {
        prefix: "40",
        actions: &[ExplorerAction::RepositorySettings, ExplorerAction::Settings],
    },
];

/// The previous build also used a flat menu with different group prefixes.
/// Keep those keys in the known plan as remove-only.
struct LegacyFlatGroupSpec {
    prefix: &'static str,
    actions: &'static [ExplorerAction],
}

const LEGACY_FLAT_GROUPS: [LegacyFlatGroupSpec; 5] = [
    LegacyFlatGroupSpec {
        prefix: "10",
        actions: &[
            ExplorerAction::Clone,
            ExplorerAction::Commit,
            ExplorerAction::Pull,
            ExplorerAction::Push,
        ],
    },
    LegacyFlatGroupSpec {
        prefix: "20",
        actions: &[
            ExplorerAction::CreateRepository,
            ExplorerAction::OpenRepository,
        ],
    },
    LegacyFlatGroupSpec {
        prefix: "30",
        actions: &[
            ExplorerAction::AddFiles,
            ExplorerAction::ViewChanges,
            ExplorerAction::ApplyPatch,
            ExplorerAction::ViewStash,
            ExplorerAction::ResetFileChanges,
        ],
    },
    LegacyFlatGroupSpec {
        prefix: "40",
        actions: &[
            ExplorerAction::CheckoutBranch,
            ExplorerAction::CheckoutRevision,
            ExplorerAction::CreateBranch,
        ],
    },
    LegacyFlatGroupSpec {
        prefix: "50",
        actions: &[
            ExplorerAction::FileHistory,
            ExplorerAction::OpenWithDifftool,
            ExplorerAction::Settings,
        ],
    },
];

/// The previous build registered a nested group layout. Keep its exact shape
/// in the known plan so reconcile/disable can remove those keys safely.
struct LegacyGroupSpec {
    key: &'static str,
    registry_id: &'static str,
    actions: &'static [ExplorerAction],
}

const LEGACY_NESTED_GROUPS: [LegacyGroupSpec; 5] = [
    LegacyGroupSpec {
        key: "GitExt.Group.10.Common",
        registry_id: "10.Common",
        actions: &[
            ExplorerAction::Clone,
            ExplorerAction::Commit,
            ExplorerAction::Pull,
            ExplorerAction::Push,
        ],
    },
    LegacyGroupSpec {
        key: "GitExt.Group.20.Repository",
        registry_id: "20.Repository",
        actions: &[
            ExplorerAction::CreateRepository,
            ExplorerAction::OpenRepository,
        ],
    },
    LegacyGroupSpec {
        key: "GitExt.Group.30.Changes",
        registry_id: "30.Changes",
        actions: &[
            ExplorerAction::AddFiles,
            ExplorerAction::ViewChanges,
            ExplorerAction::ApplyPatch,
            ExplorerAction::ViewStash,
            ExplorerAction::ResetFileChanges,
        ],
    },
    LegacyGroupSpec {
        key: "GitExt.Group.40.Branches",
        registry_id: "40.Branches",
        actions: &[
            ExplorerAction::CheckoutBranch,
            ExplorerAction::CheckoutRevision,
            ExplorerAction::CreateBranch,
        ],
    },
    LegacyGroupSpec {
        key: "GitExt.Group.50.HistoryTools",
        registry_id: "50.HistoryTools",
        actions: &[
            ExplorerAction::FileHistory,
            ExplorerAction::OpenWithDifftool,
            ExplorerAction::Settings,
        ],
    },
];

/// Windows silently drops commands beyond 16 in a registry cascading menu tree;
/// the limit covers nested `ExtendedSubCommandsKey` levels (Others) as well.
const MAX_MENU_LEVEL_ITEMS: usize = 16;

/// The separator flags live on the first item of each group after the first.
const ECF_SEPARATORBEFORE: u32 = 0x20;

/// Icons are embedded so the menu does not depend on Tauri resource paths in
/// dev, installed and portable layouts alike. They are materialized under
/// %LOCALAPPDATA% only when the context menu is enabled.
const ICON_FILES: &[(&str, &[u8])] = &[
    ("clone.ico", include_bytes!("../../icons/menu/clone.ico")),
    (
        "create-repository.ico",
        include_bytes!("../../icons/menu/create-repository.ico"),
    ),
    ("commit.ico", include_bytes!("../../icons/menu/commit.ico")),
    (
        "open-repository.ico",
        include_bytes!("../../icons/menu/open-repository.ico"),
    ),
    ("pull.ico", include_bytes!("../../icons/menu/pull.ico")),
    ("push.ico", include_bytes!("../../icons/menu/push.ico")),
    (
        "view-stash.ico",
        include_bytes!("../../icons/menu/view-stash.ico"),
    ),
    (
        "view-changes.ico",
        include_bytes!("../../icons/menu/view-changes.ico"),
    ),
    (
        "checkout-branch.ico",
        include_bytes!("../../icons/menu/checkout-branch.ico"),
    ),
    (
        "checkout-revision.ico",
        include_bytes!("../../icons/menu/checkout-revision.ico"),
    ),
    (
        "create-branch.ico",
        include_bytes!("../../icons/menu/create-branch.ico"),
    ),
    (
        "open-with-difftool.ico",
        include_bytes!("../../icons/menu/open-with-difftool.ico"),
    ),
    (
        "file-history.ico",
        include_bytes!("../../icons/menu/file-history.ico"),
    ),
    (
        "reset-file-changes.ico",
        include_bytes!("../../icons/menu/reset-file-changes.ico"),
    ),
    (
        "add-files.ico",
        include_bytes!("../../icons/menu/add-files.ico"),
    ),
    (
        "apply-patch.ico",
        include_bytes!("../../icons/menu/apply-patch.ico"),
    ),
    (
        "settings.ico",
        include_bytes!("../../icons/menu/settings.ico"),
    ),
    (
        "repository-settings.ico",
        include_bytes!("../../icons/menu/repository-settings.ico"),
    ),
    (
        "view-files.ico",
        include_bytes!("../../icons/menu/view-files.ico"),
    ),
    ("others.ico", include_bytes!("../../icons/menu/others.ico")),
    ("rename.ico", include_bytes!("../../icons/menu/rename.ico")),
];

const ACTIONS: [ActionSpec; 20] = [
    ActionSpec {
        action: ExplorerAction::Clone,
        label: "Clone...",
        key: "GitExt.Clone",
        icon: "clone.ico",
    },
    ActionSpec {
        action: ExplorerAction::CreateRepository,
        label: "Create new repository...",
        key: "GitExt.CreateRepository",
        icon: "create-repository.ico",
    },
    ActionSpec {
        action: ExplorerAction::Commit,
        label: "Commit...",
        key: "GitExt.Commit",
        icon: "commit.ico",
    },
    ActionSpec {
        action: ExplorerAction::OpenRepository,
        label: "Open repository",
        key: "GitExt.OpenRepository",
        icon: "open-repository.ico",
    },
    ActionSpec {
        action: ExplorerAction::Pull,
        label: "Pull...",
        key: "GitExt.Pull",
        icon: "pull.ico",
    },
    ActionSpec {
        action: ExplorerAction::Push,
        label: "Push...",
        key: "GitExt.Push",
        icon: "push.ico",
    },
    ActionSpec {
        action: ExplorerAction::ViewStash,
        label: "View stash",
        key: "GitExt.ViewStash",
        icon: "view-stash.ico",
    },
    ActionSpec {
        action: ExplorerAction::ViewChanges,
        label: "View changes",
        key: "GitExt.ViewChanges",
        icon: "view-changes.ico",
    },
    ActionSpec {
        action: ExplorerAction::CheckoutBranch,
        label: "Checkout branch...",
        key: "GitExt.CheckoutBranch",
        icon: "checkout-branch.ico",
    },
    ActionSpec {
        action: ExplorerAction::CheckoutRevision,
        label: "Checkout revision...",
        key: "GitExt.CheckoutRevision",
        icon: "checkout-revision.ico",
    },
    ActionSpec {
        action: ExplorerAction::CreateBranch,
        label: "Create branch...",
        key: "GitExt.CreateBranch",
        icon: "create-branch.ico",
    },
    ActionSpec {
        action: ExplorerAction::OpenWithDifftool,
        label: "Open with difftool",
        key: "GitExt.OpenWithDifftool",
        icon: "open-with-difftool.ico",
    },
    ActionSpec {
        action: ExplorerAction::FileHistory,
        label: "File history",
        key: "GitExt.FileHistory",
        icon: "file-history.ico",
    },
    ActionSpec {
        action: ExplorerAction::ResetFileChanges,
        label: "Reset file changes...",
        key: "GitExt.ResetFileChanges",
        icon: "reset-file-changes.ico",
    },
    ActionSpec {
        action: ExplorerAction::AddFiles,
        label: "Add files...",
        key: "GitExt.AddFiles",
        icon: "add-files.ico",
    },
    ActionSpec {
        action: ExplorerAction::ApplyPatch,
        label: "Apply patch...",
        key: "GitExt.ApplyPatch",
        icon: "apply-patch.ico",
    },
    ActionSpec {
        action: ExplorerAction::ViewFiles,
        label: "View files",
        key: "GitExt.ViewFiles",
        icon: "view-files.ico",
    },
    ActionSpec {
        action: ExplorerAction::RepositorySettings,
        label: "Repository settings...",
        key: "GitExt.RepositorySettings",
        icon: "repository-settings.ico",
    },
    ActionSpec {
        action: ExplorerAction::Settings,
        label: "Settings",
        key: "GitExt.Settings",
        icon: "settings.ico",
    },
    ActionSpec {
        action: ExplorerAction::Rename,
        label: "Rename...",
        key: "GitExt.Rename",
        icon: "rename.ico",
    },
];

fn action_spec(action: ExplorerAction) -> &'static ActionSpec {
    ACTIONS
        .iter()
        .find(|spec| spec.action == action)
        .expect("every ExplorerAction has a menu spec")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExplorerError(String);

impl ExplorerError {
    fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl Display for ExplorerError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl Error for ExplorerError {}

pub const fn supported() -> bool {
    cfg!(target_os = "windows")
}

pub fn set_enabled(
    enabled: bool,
    items: Vec<ExplorerMenuItem>,
    always_show_all_commands: bool,
) -> Result<(), ExplorerError> {
    #[cfg(target_os = "windows")]
    {
        let placements = validate_placements(items)?;
        let mut registry = WinregRegistry;
        let known = build_known_plan(None)?;
        let result = if enabled {
            // 关闭菜单时不应受层级上限阻挡，否则用户无法停用超限配置。
            validate_levels(&placements, always_show_all_commands)?;
            let exe = std::env::current_exe().map_err(|error| {
                ExplorerError::new(format!("cannot locate current executable: {error}"))
            })?;
            let icons = prepare_icons();
            let desired = build_configured_plan(
                Some(&exe),
                icons.as_deref(),
                &placements,
                always_show_all_commands,
            )?;
            reconcile(&mut registry, &known, &desired)
        } else {
            disable(&mut registry, &known)
        };
        if result.is_ok() {
            // 开发 / 升级过程中可能留下当前 known 计划未覆盖的旧键（例如旧
            // 分组顺序产生的 30.03.reset-file-changes）。它们既会出现在菜单里，
            // 也占用 Windows 级联菜单的 16 项上限，因此在成功同步后清理。
            let keep: &[PlannedKey] = if enabled { &known } else { &[] };
            if let Err(error) = cleanup_owned_leftovers(&mut registry, keep) {
                eprintln!("failed to clean stale Explorer context menu keys: {error}");
            }
            notify_shell_association_changed();
        }
        result
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (enabled, items, always_show_all_commands);
        Err(ExplorerError::new(
            "Windows Explorer context menu integration is only supported on Windows",
        ))
    }
}

#[cfg(target_os = "windows")]
fn notify_shell_association_changed() {
    const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
    const SHCNF_IDLIST: u32 = 0;

    #[link(name = "shell32")]
    extern "system" {
        fn SHChangeNotify(
            event_id: i32,
            flags: u32,
            item1: *const std::ffi::c_void,
            item2: *const std::ffi::c_void,
        );
    }

    // Association registration is complete; asks Explorer to rebuild its
    // context-menu cache instead of waiting for the next sign-in.
    unsafe {
        SHChangeNotify(
            SHCNE_ASSOCCHANGED,
            SHCNF_IDLIST,
            std::ptr::null(),
            std::ptr::null(),
        );
    }
}

fn validate_placements(
    items: Vec<ExplorerMenuItem>,
) -> Result<[MenuPlacement; ExplorerAction::ALL.len()], ExplorerError> {
    let mut placements = [MenuPlacement::Hidden; ExplorerAction::ALL.len()];
    let mut seen = [false; ExplorerAction::ALL.len()];
    for item in items {
        let index = item.action as usize;
        if seen[index] {
            return Err(ExplorerError::new(format!(
                "duplicate Explorer menu action: {}",
                item.action
            )));
        }
        seen[index] = true;
        placements[index] = item.placement;
    }
    Ok(placements)
}

/// Windows 对一棵 `ExtendedSubCommandsKey` 级联菜单（含 Others 子菜单）
/// 合计最多渲染 16 个命令；超出部分会被静默丢弃。这里按目录 / 文件上下文
/// 分别校验并返回明确错误，不自动把用户配置的菜单项挪到其它层级。
fn validate_levels(
    placements: &[MenuPlacement; ExplorerAction::ALL.len()],
    always_show_all_commands: bool,
) -> Result<(), ExplorerError> {
    if always_show_all_commands {
        return Ok(());
    }
    // Directory 与 Directory\Background 的 supports 规则相同，只需检查一次；
    // 文件上下文可用的命令不同，需要单独统计。
    for (label, context) in [("directory", CONTEXTS[0]), ("file", CONTEXTS[2])] {
        let cascade = GROUPS
            .iter()
            .flat_map(|group| group.actions.iter())
            .filter(|action| {
                context.supports(**action)
                    && placements[**action as usize] == MenuPlacement::Cascade
            })
            .count();
        let others = GROUPS
            .iter()
            .flat_map(|group| group.actions.iter())
            .filter(|action| {
                context.supports(**action) && placements[**action as usize] == MenuPlacement::Others
            })
            .count();
        let total = cascade + usize::from(others > 0) + others;
        if total > MAX_MENU_LEVEL_ITEMS {
            return Err(ExplorerError::new(format!(
                "{label} context cascaded menu has {total} commands (limit {MAX_MENU_LEVEL_ITEMS}, \
                 including Others and its subitems): {cascade} direct + {} Others + {others} subitems; \
                 move commands to the top level or hide them",
                usize::from(others > 0),
            )));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RegistryValue {
    name: &'static str,
    value: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RegistryDword {
    name: &'static str,
    value: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PlannedKey {
    path: String,
    values: Vec<RegistryValue>,
    dwords: Vec<RegistryDword>,
}

fn value(name: &'static str, value: impl Into<String>) -> RegistryValue {
    RegistryValue {
        name,
        value: value.into(),
    }
}

fn dword(name: &'static str, value: u32) -> RegistryDword {
    RegistryDword { name, value }
}

fn owned_values(mut values: Vec<RegistryValue>) -> Vec<RegistryValue> {
    values.push(value(OWNER_VALUE, OWNER));
    values
}

fn executable(exe: Option<&Path>) -> Result<Option<&str>, ExplorerError> {
    exe.map(|path| {
        path.to_str()
            .ok_or_else(|| ExplorerError::new("current executable path is not valid Unicode"))
    })
    .transpose()
}

/// Writes the embedded menu icons outside the application directory so the
/// menu keeps working when a portable build is moved. Returns `None` when the
/// icons cannot be materialized; callers then fall back to the application icon.
#[cfg(target_os = "windows")]
fn prepare_icons() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let directory = base.join("git-extensions").join("menu-icons");
    std::fs::create_dir_all(&directory).ok()?;
    for (name, bytes) in ICON_FILES {
        let path = directory.join(name);
        let unchanged = std::fs::read(&path).is_ok_and(|existing| existing == *bytes);
        if !unchanged && std::fs::write(&path, bytes).is_err() {
            return None;
        }
    }
    Some(directory)
}

#[cfg(not(target_os = "windows"))]
fn prepare_icons() -> Option<PathBuf> {
    // Keep the embedded asset table referenced on platforms without Explorer.
    let _ = ICON_FILES;
    None
}

fn quote_icon_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    if value.contains(' ') {
        format!("\"{value}\"")
    } else {
        value.into_owned()
    }
}

fn executable_icon(exe: Option<&str>) -> String {
    exe.map(|value| quote_icon_path(Path::new(value)))
        .unwrap_or_default()
}

fn icon_value(exe: Option<&str>, icons: Option<&Path>, file: &str) -> String {
    let icon_path = icons
        .map(|directory| directory.join(file))
        .filter(|path| path.is_file())
        .or_else(|| exe.map(PathBuf::from));
    icon_path
        .map(|path| quote_icon_path(&path))
        .unwrap_or_default()
}

#[cfg(test)]
fn default_placements() -> [MenuPlacement; ExplorerAction::ALL.len()] {
    let mut placements = [MenuPlacement::Cascade; ExplorerAction::ALL.len()];
    for action in [
        ExplorerAction::Clone,
        ExplorerAction::CreateRepository,
        ExplorerAction::OpenRepository,
        ExplorerAction::Commit,
    ] {
        placements[action as usize] = MenuPlacement::Top;
    }
    placements
}

#[cfg(test)]
fn build_plan(exe: Option<&Path>) -> Result<Vec<PlannedKey>, ExplorerError> {
    build_configured_plan(exe, None, &default_placements(), false)
}

fn cascade_key_with(prefix: &str, actions: &[ExplorerAction], action: ExplorerAction) -> String {
    let index = actions
        .iter()
        .position(|candidate| *candidate == action)
        .expect("action belongs to its group");
    format!("{prefix}.{:02}.{}", index + 1, action.as_str())
}

fn cascade_key(group: &GroupSpec, action: ExplorerAction) -> String {
    cascade_key_with(group.prefix, group.actions, action)
}

fn global_action_index(action: ExplorerAction) -> usize {
    GROUPS
        .iter()
        .flat_map(|group| group.actions.iter())
        .position(|candidate| *candidate == action)
        .map(|index| index + 1)
        .expect("action belongs to a menu group")
}

/// 一级菜单键排在 `GitExt.Menu` 之后（`T` > `M`），保证所有一级项紧贴在
/// Git Extensions 下方，并按设置界面的全局顺序排列。
fn top_level_key(action: ExplorerAction) -> String {
    format!(
        "GitExt.Top.{:02}.{}",
        global_action_index(action),
        action.as_str()
    )
}

fn build_configured_plan(
    exe: Option<&Path>,
    icons: Option<&Path>,
    placements: &[MenuPlacement; ExplorerAction::ALL.len()],
    always_show_all_commands: bool,
) -> Result<Vec<PlannedKey>, ExplorerError> {
    let exe = executable(exe)?;
    let mut plan = Vec::new();
    for context in CONTEXTS {
        for spec in ACTIONS.iter().filter(|spec| {
            context.supports(spec.action)
                && (placements[spec.action as usize] == MenuPlacement::Top
                    || (always_show_all_commands
                        && placements[spec.action as usize] != MenuPlacement::Hidden))
        }) {
            add_menu_item(
                &mut plan,
                format!(r"{}\{}", context.root, top_level_key(spec.action)),
                format!("GitExt {}", spec.label),
                spec.action,
                context,
                exe,
                icons,
                spec.icon,
                None,
            )?;
        }

        if always_show_all_commands {
            continue;
        }

        let has_cascade = ACTIONS.iter().any(|spec| {
            context.supports(spec.action)
                && matches!(
                    placements[spec.action as usize],
                    MenuPlacement::Cascade | MenuPlacement::Others
                )
        });
        if !has_cascade {
            continue;
        }

        let cascade = format!(r"{}\{CASCADE_KEY}", context.root);
        plan.push(PlannedKey {
            path: cascade.clone(),
            values: owned_values(vec![
                // Explorer's own Directory verbs use a registry path value;
                // an empty value or a literal ExtendedSubCommandsKey child
                // does not identify the subcommand source key.
                value("MUIVerb", "Git Extensions"),
                value("Icon", executable_icon(exe)),
                value(
                    "ExtendedSubCommandsKey",
                    format!(r"{}\{CASCADE_KEY}", context.classes_root),
                ),
            ]),
            dwords: Vec::new(),
        });
        let cascade_shell = format!(r"{cascade}\shell");
        plan.push(PlannedKey {
            path: cascade_shell.clone(),
            values: owned_values(Vec::new()),
            dwords: Vec::new(),
        });

        let mut first_visible_group = true;
        let mut direct_visible = false;
        for group in &GROUPS {
            let visible: Vec<ExplorerAction> = group
                .actions
                .iter()
                .copied()
                .filter(|action| {
                    context.supports(*action)
                        && placements[*action as usize] == MenuPlacement::Cascade
                })
                .collect();
            if visible.is_empty() {
                continue;
            }
            for (index, action) in visible.iter().enumerate() {
                let spec = action_spec(*action);
                let separator_before =
                    (!first_visible_group && index == 0).then_some(ECF_SEPARATORBEFORE);
                add_menu_item(
                    &mut plan,
                    format!(r"{cascade_shell}\{}", cascade_key(group, *action)),
                    spec.label.to_owned(),
                    *action,
                    context,
                    exe,
                    icons,
                    spec.icon,
                    separator_before,
                )?;
            }
            direct_visible = true;
            first_visible_group = false;
        }

        let mut others_parent_created = false;
        let mut first_others_group = true;
        let others_shell = format!(r"{cascade}\others\shell");
        for group in &GROUPS {
            let visible: Vec<ExplorerAction> = group
                .actions
                .iter()
                .copied()
                .filter(|action| {
                    context.supports(*action)
                        && placements[*action as usize] == MenuPlacement::Others
                })
                .collect();
            if visible.is_empty() {
                continue;
            }
            if !others_parent_created {
                plan.push(PlannedKey {
                    path: format!(r"{cascade_shell}\99.Others"),
                    values: owned_values(vec![
                        value("MUIVerb", "Others"),
                        value("Icon", icon_value(exe, icons, "others.ico")),
                        value(
                            "ExtendedSubCommandsKey",
                            format!(r"{}\{CASCADE_KEY}\others", context.classes_root),
                        ),
                    ]),
                    dwords: if direct_visible {
                        vec![dword("CommandFlags", ECF_SEPARATORBEFORE)]
                    } else {
                        Vec::new()
                    },
                });
                let container = format!(r"{cascade}\others");
                plan.push(PlannedKey {
                    path: container.clone(),
                    values: owned_values(Vec::new()),
                    dwords: Vec::new(),
                });
                plan.push(PlannedKey {
                    path: others_shell.clone(),
                    values: owned_values(Vec::new()),
                    dwords: Vec::new(),
                });
                others_parent_created = true;
            }
            for (index, action) in visible.iter().enumerate() {
                let spec = action_spec(*action);
                let separator_before =
                    (!first_others_group && index == 0).then_some(ECF_SEPARATORBEFORE);
                add_menu_item(
                    &mut plan,
                    format!(r"{others_shell}\{}", cascade_key(group, *action)),
                    spec.label.to_owned(),
                    *action,
                    context,
                    exe,
                    icons,
                    spec.icon,
                    separator_before,
                )?;
            }
            first_others_group = false;
        }
    }
    Ok(plan)
}

fn build_known_plan(exe: Option<&Path>) -> Result<Vec<PlannedKey>, ExplorerError> {
    let exe = executable(exe)?;
    let mut plan = Vec::new();
    for context in CONTEXTS {
        let cascade = format!(r"{}\{CASCADE_KEY}", context.root);
        plan.push(PlannedKey {
            path: cascade.clone(),
            values: owned_values(vec![
                value(DEFAULT_VALUE, ""),
                value("MUIVerb", "Git Extensions"),
                value("Icon", executable_icon(exe)),
                value("ExtendedSubCommandsKey", ""),
            ]),
            dwords: Vec::new(),
        });
        let extended = format!(r"{cascade}\ExtendedSubCommandsKey");
        plan.push(PlannedKey {
            path: extended.clone(),
            values: owned_values(Vec::new()),
            dwords: Vec::new(),
        });
        let shell = format!(r"{extended}\shell");
        plan.push(PlannedKey {
            path: shell.clone(),
            values: owned_values(Vec::new()),
            dwords: Vec::new(),
        });
        for spec in &ACTIONS {
            add_menu_item(
                &mut plan,
                format!(r"{shell}\{}", spec.action.as_str()),
                spec.label.to_owned(),
                spec.action,
                context,
                exe,
                None,
                spec.icon,
                None,
            )?;
        }

        let legacy_shell = format!(r"{cascade}\shell");
        plan.push(PlannedKey {
            path: legacy_shell.clone(),
            values: owned_values(Vec::new()),
            dwords: Vec::new(),
        });
        // Flat cascade entries from the previous release; reconcile removes
        // them as stale owned keys.
        for spec in &ACTIONS {
            add_legacy_menu_item(
                &mut plan,
                format!(r"{legacy_shell}\{}", spec.action.as_str()),
                spec.label.to_owned(),
                spec.action,
                context,
                exe,
                None,
                spec.icon,
                None,
            )?;
        }
        // Previous top-level keys.
        for spec in &ACTIONS {
            add_legacy_menu_item(
                &mut plan,
                format!(r"{}\{}", context.root, spec.key),
                format!("GitExt {}", spec.label),
                spec.action,
                context,
                exe,
                None,
                spec.icon,
                None,
            )?;
        }
        // Current top-level keys, directly below Git Extensions.
        for group in &GROUPS {
            for action in group.actions {
                let spec = action_spec(*action);
                add_menu_item(
                    &mut plan,
                    format!(r"{}\{}", context.root, top_level_key(*action)),
                    format!("GitExt {}", spec.label),
                    *action,
                    context,
                    exe,
                    None,
                    spec.icon,
                    None,
                )?;
            }
        }

        // Previous build's nested group layout (remove-only).
        let groups_root = format!(r"{cascade}\groups");
        plan.push(PlannedKey {
            path: groups_root,
            values: owned_values(Vec::new()),
            dwords: Vec::new(),
        });
        for group in &LEGACY_NESTED_GROUPS {
            plan.push(PlannedKey {
                path: format!(r"{legacy_shell}\{}", group.key),
                values: owned_values(vec![
                    value("MUIVerb", ""),
                    value("Icon", ""),
                    value("ExtendedSubCommandsKey", ""),
                ]),
                dwords: Vec::new(),
            });
            let container = format!(
                r"{}\{CASCADE_KEY}\groups\{}",
                context.root, group.registry_id
            );
            plan.push(PlannedKey {
                path: container.clone(),
                values: owned_values(Vec::new()),
                dwords: Vec::new(),
            });
            let group_shell = format!(r"{container}\shell");
            plan.push(PlannedKey {
                path: group_shell.clone(),
                values: owned_values(Vec::new()),
                dwords: Vec::new(),
            });
            for (index, action) in group.actions.iter().enumerate() {
                let spec = action_spec(*action);
                add_menu_item(
                    &mut plan,
                    format!(r"{group_shell}\{:02}.{}", index + 1, spec.action.as_str()),
                    spec.label.to_owned(),
                    *action,
                    context,
                    exe,
                    None,
                    spec.icon,
                    None,
                )?;
            }
        }

        // Current flat cascade entries; CommandFlags is included by name so a
        // stale separator is deleted when the action leaves a group boundary.
        for group in &GROUPS {
            for action in group.actions {
                let spec = action_spec(*action);
                add_menu_item(
                    &mut plan,
                    format!(r"{legacy_shell}\{}", cascade_key(group, *action)),
                    spec.label.to_owned(),
                    *action,
                    context,
                    exe,
                    None,
                    spec.icon,
                    Some(0),
                )?;
            }
        }

        // Flat keys from an earlier build's grouping. Skip duplicates with the
        // current flat keys.
        let current_flat_paths: std::collections::BTreeSet<String> = GROUPS
            .iter()
            .flat_map(|group| {
                group
                    .actions
                    .iter()
                    .map(|action| format!(r"{legacy_shell}\{}", cascade_key(group, *action)))
            })
            .collect();
        for group in &LEGACY_FLAT_GROUPS {
            for action in group.actions {
                let path = format!(
                    r"{legacy_shell}\{}",
                    cascade_key_with(group.prefix, group.actions, *action)
                );
                if current_flat_paths.contains(&path) {
                    continue;
                }
                let spec = action_spec(*action);
                add_menu_item(
                    &mut plan,
                    path,
                    spec.label.to_owned(),
                    *action,
                    context,
                    exe,
                    None,
                    spec.icon,
                    Some(0),
                )?;
            }
        }

        // Others overflow submenu (remove-only when unused).
        let others_parent = format!(r"{legacy_shell}\99.Others");
        plan.push(PlannedKey {
            path: others_parent,
            values: owned_values(vec![
                value("MUIVerb", "Others"),
                value("Icon", icon_value(exe, None, "others.ico")),
                value(
                    "ExtendedSubCommandsKey",
                    format!(r"{}\{CASCADE_KEY}\others", context.classes_root),
                ),
            ]),
            dwords: vec![dword("CommandFlags", ECF_SEPARATORBEFORE)],
        });
        let others_container = format!(r"{cascade}\others");
        plan.push(PlannedKey {
            path: others_container.clone(),
            values: owned_values(Vec::new()),
            dwords: Vec::new(),
        });
        let others_shell = format!(r"{others_container}\shell");
        plan.push(PlannedKey {
            path: others_shell.clone(),
            values: owned_values(Vec::new()),
            dwords: Vec::new(),
        });
        for group in &GROUPS {
            for action in group.actions {
                let spec = action_spec(*action);
                add_menu_item(
                    &mut plan,
                    format!(r"{others_shell}\{}", cascade_key(group, *action)),
                    spec.label.to_owned(),
                    *action,
                    context,
                    exe,
                    None,
                    spec.icon,
                    Some(0),
                )?;
            }
        }
    }
    Ok(plan)
}

fn add_menu_item(
    plan: &mut Vec<PlannedKey>,
    key: String,
    label: String,
    action: ExplorerAction,
    context: Context,
    exe: Option<&str>,
    icons: Option<&Path>,
    icon_file: &str,
    command_flags: Option<u32>,
) -> Result<(), ExplorerError> {
    let item_values = vec![
        value("MUIVerb", label),
        value("Icon", icon_value(exe, icons, icon_file)),
    ];
    let item_dwords = command_flags
        .map(|value| vec![dword("CommandFlags", value)])
        .unwrap_or_default();
    let command_values = vec![value(
        DEFAULT_VALUE,
        exe.map(|exe| command_line(exe, action.as_str(), context.placeholder))
            .unwrap_or_default(),
    )];
    plan.push(PlannedKey {
        path: key.clone(),
        values: owned_values(item_values),
        dwords: item_dwords,
    });
    plan.push(PlannedKey {
        path: format!(r"{key}\command"),
        values: owned_values(command_values),
        dwords: Vec::new(),
    });
    Ok(())
}

fn add_legacy_menu_item(
    plan: &mut Vec<PlannedKey>,
    key: String,
    label: String,
    action: ExplorerAction,
    context: Context,
    exe: Option<&str>,
    icons: Option<&Path>,
    icon_file: &str,
    command_flags: Option<u32>,
) -> Result<(), ExplorerError> {
    let item_index = plan.len();
    add_menu_item(
        plan,
        key,
        label.clone(),
        action,
        context,
        exe,
        icons,
        icon_file,
        command_flags,
    )?;
    plan[item_index]
        .values
        .insert(0, value(DEFAULT_VALUE, label));
    Ok(())
}

/// Quotes one Windows command-line argument; the executable and `%1`/`%V` are
/// quoted independently so shell expansion cannot alter the executable token.
fn command_line(exe: &str, action: &str, placeholder: &str) -> String {
    if action == "settings" {
        format!("{} --explorer-action settings", quote_windows_argument(exe))
    } else {
        format!(
            "{} --explorer-action {action} --path {}",
            quote_windows_argument(exe),
            quote_windows_argument(placeholder)
        )
    }
}

fn quote_windows_argument(argument: &str) -> String {
    let mut quoted = String::with_capacity(argument.len() + 2);
    quoted.push('"');
    let mut backslashes = 0;
    for character in argument.chars() {
        match character {
            '\\' => backslashes += 1,
            '"' => {
                quoted.extend(std::iter::repeat_n('\\', backslashes * 2 + 1));
                quoted.push('"');
                backslashes = 0;
            }
            _ => {
                quoted.extend(std::iter::repeat_n('\\', backslashes));
                backslashes = 0;
                quoted.push(character);
            }
        }
    }
    quoted.extend(std::iter::repeat_n('\\', backslashes * 2));
    quoted.push('"');
    quoted
}

trait ExplorerRegistry {
    fn key_exists(&mut self, key: &str) -> Result<bool, ExplorerError>;
    fn get_string(&mut self, key: &str, name: &str) -> Result<Option<String>, ExplorerError>;
    fn get_dword(&mut self, key: &str, name: &str) -> Result<Option<u32>, ExplorerError>;
    fn value_names(&mut self, key: &str) -> Result<Vec<String>, ExplorerError>;
    fn subkey_names(&mut self, key: &str) -> Result<Vec<String>, ExplorerError>;
    fn has_subkeys(&mut self, key: &str) -> Result<bool, ExplorerError>;
    fn create_key(&mut self, key: &str) -> Result<(), ExplorerError>;
    fn set_string(&mut self, key: &str, name: &str, value: &str) -> Result<(), ExplorerError>;
    fn set_dword(&mut self, key: &str, name: &str, value: u32) -> Result<(), ExplorerError>;
    fn delete_value(&mut self, key: &str, name: &str) -> Result<(), ExplorerError>;
    fn delete_key(&mut self, key: &str) -> Result<(), ExplorerError>;
}

#[derive(Debug)]
struct KeySnapshot {
    existed: bool,
    values: Vec<Option<String>>,
    dwords: Vec<Option<u32>>,
}

fn snapshot_key(
    registry: &mut impl ExplorerRegistry,
    key: &PlannedKey,
) -> Result<KeySnapshot, ExplorerError> {
    let existed = registry.key_exists(&key.path)?;
    let mut values = Vec::with_capacity(key.values.len());
    let mut dwords = Vec::with_capacity(key.dwords.len());
    if existed {
        for entry in &key.values {
            values.push(registry.get_string(&key.path, entry.name)?);
        }
        for entry in &key.dwords {
            dwords.push(registry.get_dword(&key.path, entry.name)?);
        }
    }
    Ok(KeySnapshot {
        existed,
        values,
        dwords,
    })
}

fn ensure_owned(
    registry: &mut impl ExplorerRegistry,
    key: &PlannedKey,
    snapshot: &KeySnapshot,
) -> Result<(), ExplorerError> {
    if snapshot.existed && registry.get_string(&key.path, OWNER_VALUE)?.as_deref() != Some(OWNER) {
        return Err(ExplorerError::new(format!(
            "refusing to modify unowned registry key: {}",
            key.path
        )));
    }
    Ok(())
}

fn snapshot_is_owned(key: &PlannedKey, snapshot: &KeySnapshot) -> bool {
    snapshot.existed
        && key
            .values
            .iter()
            .zip(&snapshot.values)
            .any(|(entry, previous)| {
                entry.name == OWNER_VALUE && previous.as_deref() == Some(OWNER)
            })
}

#[cfg(test)]
fn enable(registry: &mut impl ExplorerRegistry, plan: &[PlannedKey]) -> Result<(), ExplorerError> {
    let mut snapshots = Vec::with_capacity(plan.len());
    for key in plan {
        let snapshot = snapshot_key(registry, key)?;
        ensure_owned(registry, key, &snapshot)?;
        snapshots.push(snapshot);
    }

    let mut attempted = Vec::new();
    for (index, key) in plan.iter().enumerate() {
        attempted.push(index);
        let result = registry.create_key(&key.path).and_then(|_| {
            for entry in &key.values {
                registry.set_string(&key.path, entry.name, &entry.value)?;
            }
            for entry in &key.dwords {
                registry.set_dword(&key.path, entry.name, entry.value)?;
            }
            Ok(())
        });
        if let Err(error) = result {
            return Err(rollback_after_error(
                registry, plan, &snapshots, &attempted, error,
            ));
        }
    }
    Ok(())
}

fn reconcile(
    registry: &mut impl ExplorerRegistry,
    known: &[PlannedKey],
    desired: &[PlannedKey],
) -> Result<(), ExplorerError> {
    let mut snapshots = Vec::with_capacity(known.len());
    for key in known {
        let snapshot = snapshot_key(registry, key)?;
        ensure_owned(registry, key, &snapshot)?;
        snapshots.push(snapshot);
    }

    let desired_paths: std::collections::BTreeSet<_> =
        desired.iter().map(|key| key.path.as_str()).collect();
    let mut attempted = Vec::new();
    for desired_key in desired {
        let index = known
            .iter()
            .position(|key| key.path == desired_key.path)
            .ok_or_else(|| ExplorerError::new("desired menu key is missing from known plan"))?;
        attempted.push(index);
        let result = (|| {
            registry.create_key(&desired_key.path)?;
            for entry in &desired_key.values {
                registry.set_string(&desired_key.path, entry.name, &entry.value)?;
            }
            for entry in &desired_key.dwords {
                registry.set_dword(&desired_key.path, entry.name, entry.value)?;
            }
            for entry in &known[index].values {
                if !desired_key
                    .values
                    .iter()
                    .any(|value| value.name == entry.name)
                {
                    registry.delete_value(&desired_key.path, entry.name)?;
                }
            }
            for entry in &known[index].dwords {
                if !desired_key
                    .dwords
                    .iter()
                    .any(|value| value.name == entry.name)
                {
                    registry.delete_value(&desired_key.path, entry.name)?;
                }
            }
            Ok(())
        })();
        if let Err(error) = result {
            return Err(rollback_after_error(
                registry, known, &snapshots, &attempted, error,
            ));
        }
    }

    for index in (0..known.len()).rev() {
        let key = &known[index];
        if desired_paths.contains(key.path.as_str()) || !snapshot_is_owned(key, &snapshots[index]) {
            continue;
        }
        attempted.push(index);
        if let Err(error) = disable_owned_key(registry, key) {
            return Err(rollback_after_error(
                registry, known, &snapshots, &attempted, error,
            ));
        }
    }
    Ok(())
}

fn disable(registry: &mut impl ExplorerRegistry, plan: &[PlannedKey]) -> Result<(), ExplorerError> {
    let mut attempted = Vec::new();
    for index in (0..plan.len()).rev() {
        let key = &plan[index];
        let snapshot = match snapshot_key(registry, key) {
            Ok(snapshot) => snapshot,
            Err(error) => return Err(rollback_disable(registry, plan, &attempted, error)),
        };
        if !snapshot_is_owned(key, &snapshot) {
            continue;
        }
        attempted.push((index, snapshot));
        if let Err(error) = disable_owned_key(registry, key) {
            return Err(rollback_disable(registry, plan, &attempted, error));
        }
    }
    Ok(())
}

/// 清理 `GitExt.*` 命名空间里带所有权标记、但不在当前 known 计划中的旧键。
/// 递归处理；只删除确认由本应用拥有的键，遇到外部值 / 子键时保留整棵父键。
#[cfg(target_os = "windows")]
fn cleanup_owned_leftovers(
    registry: &mut impl ExplorerRegistry,
    keep: &[PlannedKey],
) -> Result<(), ExplorerError> {
    let keep: std::collections::BTreeSet<&str> = keep.iter().map(|key| key.path.as_str()).collect();
    for context in CONTEXTS {
        for name in registry.subkey_names(context.root)? {
            if !name.starts_with("GitExt.") {
                continue;
            }
            cleanup_key_tree(registry, &format!(r"{}\{}", context.root, name), &keep)?;
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn cleanup_key_tree(
    registry: &mut impl ExplorerRegistry,
    path: &str,
    keep: &std::collections::BTreeSet<&str>,
) -> Result<(), ExplorerError> {
    for name in registry.subkey_names(path)? {
        cleanup_key_tree(registry, &format!(r"{path}\{name}"), keep)?;
    }
    if keep.contains(path) {
        return Ok(());
    }
    if registry.get_string(path, OWNER_VALUE)?.as_deref() != Some(OWNER) {
        return Ok(());
    }
    // 外部数据挂在子键下时保留父键，避免误删。
    if registry.has_subkeys(path)? {
        return Ok(());
    }
    for name in registry.value_names(path)? {
        registry.delete_value(path, &name)?;
    }
    registry.delete_key(path)
}

/// Removes only values owned by this module. A key with any additional value or
/// remaining subkey is left with its ownership marker, so cleanup never deletes
/// foreign data and Windows never rejects a non-empty parent key.
fn disable_owned_key(
    registry: &mut impl ExplorerRegistry,
    key: &PlannedKey,
) -> Result<(), ExplorerError> {
    for entry in key.values.iter().filter(|entry| entry.name != OWNER_VALUE) {
        registry.delete_value(&key.path, entry.name)?;
    }
    for entry in &key.dwords {
        registry.delete_value(&key.path, entry.name)?;
    }
    let has_additional_values = registry
        .value_names(&key.path)?
        .into_iter()
        .any(|name| name != OWNER_VALUE);
    if has_additional_values || registry.has_subkeys(&key.path)? {
        return Ok(());
    }
    registry.delete_value(&key.path, OWNER_VALUE)?;
    registry.delete_key(&key.path)
}

fn rollback_disable(
    registry: &mut impl ExplorerRegistry,
    plan: &[PlannedKey],
    attempted: &[(usize, KeySnapshot)],
    error: ExplorerError,
) -> ExplorerError {
    let mut rollback_errors = Vec::new();
    for (index, snapshot) in attempted.iter().rev() {
        if let Err(error) = restore_snapshot(registry, &plan[*index], snapshot) {
            rollback_errors.push(error.to_string());
        }
    }
    with_rollback_errors(error, rollback_errors)
}

fn rollback_after_error(
    registry: &mut impl ExplorerRegistry,
    plan: &[PlannedKey],
    snapshots: &[KeySnapshot],
    attempted: &[usize],
    error: ExplorerError,
) -> ExplorerError {
    let mut rollback_errors = Vec::new();
    for index in attempted.iter().rev() {
        if let Err(error) = restore_snapshot(registry, &plan[*index], &snapshots[*index]) {
            rollback_errors.push(error.to_string());
        }
    }
    with_rollback_errors(error, rollback_errors)
}

fn restore_snapshot(
    registry: &mut impl ExplorerRegistry,
    key: &PlannedKey,
    snapshot: &KeySnapshot,
) -> Result<(), ExplorerError> {
    if !snapshot.existed {
        if registry.key_exists(&key.path)? {
            registry.delete_key(&key.path)?;
        }
        return Ok(());
    }

    registry.create_key(&key.path)?;
    for (entry, previous) in key.values.iter().zip(&snapshot.values) {
        if let Some(previous) = previous {
            registry.set_string(&key.path, entry.name, previous)?;
        } else {
            registry.delete_value(&key.path, entry.name)?;
        }
    }
    for (entry, previous) in key.dwords.iter().zip(&snapshot.dwords) {
        if let Some(previous) = previous {
            registry.set_dword(&key.path, entry.name, *previous)?;
        } else {
            registry.delete_value(&key.path, entry.name)?;
        }
    }
    Ok(())
}

fn with_rollback_errors(error: ExplorerError, rollback_errors: Vec<String>) -> ExplorerError {
    if rollback_errors.is_empty() {
        error
    } else {
        ExplorerError::new(format!(
            "{error}; rollback also failed: {}",
            rollback_errors.join("; ")
        ))
    }
}

#[cfg(target_os = "windows")]
struct WinregRegistry;

#[cfg(target_os = "windows")]
impl WinregRegistry {
    fn root() -> winreg::RegKey {
        winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
    }

    fn context(operation: &str, key: &str, error: std::io::Error) -> ExplorerError {
        ExplorerError::new(format!("{operation} HKCU\\{key}: {error}"))
    }
}

#[cfg(target_os = "windows")]
impl ExplorerRegistry for WinregRegistry {
    fn key_exists(&mut self, key: &str) -> Result<bool, ExplorerError> {
        match Self::root().open_subkey(key) {
            Ok(_) => Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(Self::context("cannot open", key, error)),
        }
    }

    fn get_string(&mut self, key: &str, name: &str) -> Result<Option<String>, ExplorerError> {
        match Self::root().open_subkey(key) {
            Ok(reg_key) => match reg_key.get_value(name) {
                Ok(value) => Ok(Some(value)),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
                Err(error) => Err(Self::context("cannot read", key, error)),
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(Self::context("cannot open", key, error)),
        }
    }

    fn get_dword(&mut self, key: &str, name: &str) -> Result<Option<u32>, ExplorerError> {
        match Self::root().open_subkey(key) {
            Ok(reg_key) => match reg_key.get_value(name) {
                Ok(value) => Ok(Some(value)),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
                Err(error) => Err(Self::context("cannot read", key, error)),
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(Self::context("cannot open", key, error)),
        }
    }

    fn value_names(&mut self, key: &str) -> Result<Vec<String>, ExplorerError> {
        match Self::root().open_subkey(key) {
            Ok(reg_key) => reg_key
                .enum_values()
                .map(|entry| entry.map(|(name, _)| name))
                .collect::<std::io::Result<Vec<_>>>()
                .map_err(|error| Self::context("cannot list values in", key, error)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(Self::context("cannot open", key, error)),
        }
    }

    fn create_key(&mut self, key: &str) -> Result<(), ExplorerError> {
        Self::root()
            .create_subkey(key)
            .map(|_| ())
            .map_err(|error| Self::context("cannot create", key, error))
    }

    fn has_subkeys(&mut self, key: &str) -> Result<bool, ExplorerError> {
        match Self::root().open_subkey(key) {
            Ok(reg_key) => match reg_key.enum_keys().next() {
                Some(Ok(_)) => Ok(true),
                Some(Err(error)) => Err(Self::context("cannot list subkeys in", key, error)),
                None => Ok(false),
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(Self::context("cannot open", key, error)),
        }
    }

    fn subkey_names(&mut self, key: &str) -> Result<Vec<String>, ExplorerError> {
        match Self::root().open_subkey(key) {
            Ok(reg_key) => reg_key
                .enum_keys()
                .collect::<std::io::Result<Vec<_>>>()
                .map_err(|error| Self::context("cannot list subkeys in", key, error)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(Self::context("cannot open", key, error)),
        }
    }

    fn set_string(&mut self, key: &str, name: &str, value: &str) -> Result<(), ExplorerError> {
        Self::root()
            .open_subkey_with_flags(key, winreg::enums::KEY_SET_VALUE)
            .and_then(|key| key.set_value(name, &value))
            .map_err(|error| Self::context("cannot write", key, error))
    }

    fn set_dword(&mut self, key: &str, name: &str, value: u32) -> Result<(), ExplorerError> {
        Self::root()
            .open_subkey_with_flags(key, winreg::enums::KEY_SET_VALUE)
            .and_then(|key| key.set_value(name, &value))
            .map_err(|error| Self::context("cannot write", key, error))
    }

    fn delete_value(&mut self, key: &str, name: &str) -> Result<(), ExplorerError> {
        match Self::root().open_subkey_with_flags(key, winreg::enums::KEY_SET_VALUE) {
            Ok(reg_key) => match reg_key.delete_value(name) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(Self::context("cannot delete value in", key, error)),
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(Self::context("cannot open", key, error)),
        }
    }

    fn delete_key(&mut self, key: &str) -> Result<(), ExplorerError> {
        match Self::root().delete_subkey(key) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(Self::context("cannot delete", key, error)),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    #[derive(Default)]
    struct FakeRegistry {
        keys: BTreeMap<String, BTreeMap<String, String>>,
        dwords: BTreeMap<String, BTreeMap<String, u32>>,
        writes: usize,
        fail_at: Option<usize>,
        reads: usize,
        fail_read_at: Option<usize>,
    }

    impl FakeRegistry {
        fn maybe_fail_read(&mut self) -> Result<(), ExplorerError> {
            self.reads += 1;
            if self.fail_read_at == Some(self.reads) {
                self.fail_read_at = None;
                return Err(ExplorerError::new(format!(
                    "injected read failure {}",
                    self.reads
                )));
            }
            Ok(())
        }

        fn maybe_fail(&mut self) -> Result<(), ExplorerError> {
            self.writes += 1;
            if self.fail_at == Some(self.writes) {
                self.fail_at = None;
                return Err(ExplorerError::new(format!(
                    "injected write failure {}",
                    self.writes
                )));
            }
            Ok(())
        }
    }

    impl ExplorerRegistry for FakeRegistry {
        fn key_exists(&mut self, key: &str) -> Result<bool, ExplorerError> {
            self.maybe_fail_read()?;
            Ok(self.keys.contains_key(key))
        }

        fn get_string(&mut self, key: &str, name: &str) -> Result<Option<String>, ExplorerError> {
            self.maybe_fail_read()?;
            Ok(self
                .keys
                .get(key)
                .and_then(|values| values.get(name))
                .cloned())
        }

        fn get_dword(&mut self, key: &str, name: &str) -> Result<Option<u32>, ExplorerError> {
            self.maybe_fail_read()?;
            Ok(self
                .dwords
                .get(key)
                .and_then(|values| values.get(name))
                .copied())
        }

        fn value_names(&mut self, key: &str) -> Result<Vec<String>, ExplorerError> {
            self.maybe_fail_read()?;
            let mut names: Vec<String> = self
                .keys
                .get(key)
                .map(|values| values.keys().cloned().collect())
                .unwrap_or_default();
            names.extend(
                self.dwords
                    .get(key)
                    .map(|values| values.keys().cloned())
                    .unwrap_or_default(),
            );
            names.sort();
            names.dedup();
            Ok(names)
        }

        fn create_key(&mut self, key: &str) -> Result<(), ExplorerError> {
            self.maybe_fail()?;
            self.keys.entry(key.to_owned()).or_default();
            Ok(())
        }

        fn has_subkeys(&mut self, key: &str) -> Result<bool, ExplorerError> {
            self.maybe_fail_read()?;
            let descendant = format!(r"{key}\");
            Ok(self
                .keys
                .keys()
                .any(|candidate| candidate.starts_with(&descendant)))
        }

        fn subkey_names(&mut self, key: &str) -> Result<Vec<String>, ExplorerError> {
            self.maybe_fail_read()?;
            let prefix = format!(r"{key}\");
            let mut names = std::collections::BTreeSet::new();
            for candidate in self.keys.keys() {
                if let Some(rest) = candidate.strip_prefix(&prefix) {
                    if let Some(name) = rest.split('\\').next() {
                        if !name.is_empty() {
                            names.insert(name.to_owned());
                        }
                    }
                }
            }
            Ok(names.into_iter().collect())
        }

        fn set_string(&mut self, key: &str, name: &str, value: &str) -> Result<(), ExplorerError> {
            self.maybe_fail()?;
            self.keys
                .get_mut(key)
                .ok_or_else(|| ExplorerError::new("fake key does not exist"))?
                .insert(name.to_owned(), value.to_owned());
            Ok(())
        }

        fn set_dword(&mut self, key: &str, name: &str, value: u32) -> Result<(), ExplorerError> {
            self.maybe_fail()?;
            if !self.keys.contains_key(key) {
                return Err(ExplorerError::new("fake key does not exist"));
            }
            self.dwords
                .entry(key.to_owned())
                .or_default()
                .insert(name.to_owned(), value);
            Ok(())
        }

        fn delete_value(&mut self, key: &str, name: &str) -> Result<(), ExplorerError> {
            self.maybe_fail()?;
            if let Some(values) = self.keys.get_mut(key) {
                values.remove(name);
            }
            if let Some(values) = self.dwords.get_mut(key) {
                values.remove(name);
            }
            Ok(())
        }

        fn delete_key(&mut self, key: &str) -> Result<(), ExplorerError> {
            self.maybe_fail()?;
            let descendant = format!(r"{key}\");
            if self
                .keys
                .keys()
                .any(|candidate| candidate.starts_with(&descendant))
            {
                return Err(ExplorerError::new("fake key still has children"));
            }
            self.keys.remove(key);
            self.dwords.remove(key);
            Ok(())
        }
    }

    fn plan() -> Vec<PlannedKey> {
        build_plan(Some(Path::new(
            r"C:\Program Files\Git Extensions\GitExt.exe",
        )))
        .unwrap()
    }

    #[test]
    fn quotes_executable_and_shell_placeholders_independently() {
        assert_eq!(
            command_line(r"C:\Program Files\GitExt\app.exe", "clone", "%1"),
            r#""C:\Program Files\GitExt\app.exe" --explorer-action clone --path "%1""#
        );
        assert_eq!(
            command_line("D:\\工具\\GitExt.exe", "settings", "%V"),
            r#""D:\工具\GitExt.exe" --explorer-action settings"#
        );
        assert_eq!(
            quote_windows_argument(r"C:\ trailing\"),
            r#""C:\ trailing\\""#
        );
        assert_eq!(quote_windows_argument(r#"a\"b"#), r#""a\\\"b""#);
    }

    #[test]
    fn plan_covers_both_contexts_and_every_action() {
        let plan = plan();
        for context in CONTEXTS {
            for spec in &ACTIONS {
                let expected = command_line(
                    r"C:\Program Files\Git Extensions\GitExt.exe",
                    spec.action.as_str(),
                    context.placeholder,
                );
                let occurrences = plan
                    .iter()
                    .filter(|key| key.path.starts_with(context.root))
                    .filter(|key| {
                        key.values
                            .iter()
                            .any(|entry| entry.name == DEFAULT_VALUE && entry.value == expected)
                    })
                    .count();
                assert_eq!(
                    occurrences,
                    usize::from(context.supports(spec.action)),
                    "{} {}",
                    context.root,
                    spec.action
                );
                let expected_cascade_path = GROUPS.iter().find_map(|group| {
                    group
                        .actions
                        .iter()
                        .any(|action| *action == spec.action)
                        .then(|| {
                            format!(
                                r"{}\{CASCADE_KEY}\shell\{}",
                                context.root,
                                cascade_key(group, spec.action)
                            )
                        })
                });
                assert_eq!(
                    expected_cascade_path
                        .as_deref()
                        .is_some_and(|path| plan.iter().any(|key| key.path == path)),
                    context.supports(spec.action)
                        && default_placements()[spec.action as usize] == MenuPlacement::Cascade,
                    "unexpected cascade membership for {}",
                    spec.action
                );
            }
        }
    }

    #[test]
    fn cascade_items_are_flat_and_separated_by_group() {
        let plan = plan();
        for context in CONTEXTS {
            let mut first_visible_group = true;
            for group in &GROUPS {
                let visible: Vec<ExplorerAction> = group
                    .actions
                    .iter()
                    .copied()
                    .filter(|action| {
                        context.supports(*action)
                            && default_placements()[*action as usize] == MenuPlacement::Cascade
                    })
                    .collect();
                if visible.is_empty() {
                    continue;
                }
                for (index, action) in visible.iter().enumerate() {
                    let path = format!(
                        r"{}\{CASCADE_KEY}\shell\{}",
                        context.root,
                        cascade_key(group, *action)
                    );
                    let item = plan
                        .iter()
                        .find(|key| key.path == path)
                        .unwrap_or_else(|| panic!("missing flat item {path}"));
                    let separator = item
                        .dwords
                        .iter()
                        .find(|entry| entry.name == "CommandFlags")
                        .map(|entry| entry.value);
                    assert_eq!(
                        separator,
                        (!first_visible_group && index == 0).then_some(ECF_SEPARATORBEFORE),
                        "unexpected separator for {}",
                        action
                    );
                }
                first_visible_group = false;
            }
            // The second-level menu must not contain nested group submenus.
            assert!(!plan.iter().any(|key| {
                key.path.starts_with(context.root)
                    && (key.path.contains(r"\GitExt.Group.")
                        || key.path.contains(r"\GitExt.Menu\groups"))
            }));
        }
    }

    #[test]
    fn cascade_total_is_limited_per_context() {
        let directory_actions: Vec<_> = GROUPS
            .iter()
            .flat_map(|group| group.actions.iter().copied())
            .filter(|action| CONTEXTS[0].supports(*action))
            .collect();
        let file_actions: Vec<_> = GROUPS
            .iter()
            .flat_map(|group| group.actions.iter().copied())
            .filter(|action| CONTEXTS[2].supports(*action))
            .collect();
        assert_eq!(directory_actions.len(), 17);
        assert_eq!(file_actions.len(), 10);

        // 目录上下文的直排项 + Others + Others 子项合计不能超过 16。
        let mut placements = [MenuPlacement::Hidden; ExplorerAction::ALL.len()];
        for action in directory_actions.iter().take(13) {
            placements[*action as usize] = MenuPlacement::Cascade;
        }
        for action in directory_actions.iter().skip(13).take(3) {
            placements[*action as usize] = MenuPlacement::Others;
        }
        let error = validate_levels(&placements, false).unwrap_err();
        assert!(error.to_string().contains("directory context"));
        assert!(error.to_string().contains("17 commands"));
        // 校验不会修改用户配置。
        assert_eq!(
            placements[directory_actions[13] as usize],
            MenuPlacement::Others
        );

        // 少一项直排即可容纳 Others 及其全部子项。
        placements[directory_actions[0] as usize] = MenuPlacement::Hidden;
        assert!(validate_levels(&placements, false).is_ok());

        // 文件上下文只统计文件可用命令：全部放到 Others 仍不超限。
        let mut file_placements = [MenuPlacement::Hidden; ExplorerAction::ALL.len()];
        for action in &file_actions {
            file_placements[*action as usize] = MenuPlacement::Others;
        }
        assert!(validate_levels(&file_placements, false).is_ok());
    }

    #[test]
    fn others_and_top_level_keys_have_expected_structure() {
        let mut placements = [MenuPlacement::Hidden; ExplorerAction::ALL.len()];
        placements[ExplorerAction::Clone as usize] = MenuPlacement::Cascade;
        placements[ExplorerAction::ResetFileChanges as usize] = MenuPlacement::Others;
        placements[ExplorerAction::Commit as usize] = MenuPlacement::Top;
        let plan = build_configured_plan(
            Some(Path::new(r"C:\GitExt\GitExt.exe")),
            None,
            &placements,
            false,
        )
        .unwrap();
        let root = CONTEXTS[0].root;
        assert!(plan
            .iter()
            .any(|key| key.path == format!(r"{root}\{CASCADE_KEY}\shell\99.Others")));
        let others_item = format!(
            r"{root}\{CASCADE_KEY}\others\shell\{}",
            cascade_key(&GROUPS[2], ExplorerAction::ResetFileChanges)
        );
        assert!(plan.iter().any(|key| key.path == others_item));
        let top = plan
            .iter()
            .find(|key| key.path.starts_with(&format!(r"{root}\GitExt.Top.")))
            .unwrap();
        assert!(top.path.contains(".commit"));
        assert!(top.path.contains("GitExt.Top."));
    }

    #[test]
    fn known_plan_has_no_duplicate_paths() {
        let known = build_known_plan(Some(Path::new(r"C:\GitExt\GitExt.exe"))).unwrap();
        let mut paths = std::collections::BTreeSet::new();
        for key in known {
            assert!(
                paths.insert(key.path.clone()),
                "duplicate known path {}",
                key.path
            );
        }
    }

    #[test]
    fn every_action_icon_is_embedded() {
        assert!(ICON_FILES.iter().any(|(name, _)| *name == "others.ico"));
        for file in ACTIONS.iter().map(|spec| spec.icon) {
            let (_, bytes) = ICON_FILES
                .iter()
                .find(|(name, _)| *name == file)
                .unwrap_or_else(|| panic!("missing embedded icon {file}"));
            assert!(bytes.len() > 4, "empty embedded icon {file}");
            assert_eq!(&bytes[..4], &[0, 0, 1, 0], "invalid ICO header for {file}");
        }
    }

    #[test]
    fn action_icons_are_used_when_materialized() {
        let directory = std::env::temp_dir().join(format!("ge-menu-icons-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("clone.ico"), b"icon").unwrap();
        let mut placements = [MenuPlacement::Hidden; ExplorerAction::ALL.len()];
        placements[ExplorerAction::Clone as usize] = MenuPlacement::Cascade;
        let plan = build_configured_plan(
            Some(Path::new(r"C:\GitExt\GitExt.exe")),
            Some(&directory),
            &placements,
            false,
        )
        .unwrap();
        let clone_icon = plan
            .iter()
            .find(|key| key.path.ends_with(r"\shell\10.01.clone"))
            .unwrap()
            .values
            .iter()
            .find(|entry| entry.name == "Icon")
            .map(|entry| entry.value.clone())
            .unwrap();
        assert_eq!(clone_icon, quote_icon_path(&directory.join("clone.ico")));
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn branches_and_repos_group_contains_repository_actions() {
        assert_eq!(
            &GROUPS[1].actions[..2],
            &[
                ExplorerAction::CreateRepository,
                ExplorerAction::OpenRepository
            ]
        );
    }

    #[test]
    fn rename_action_is_available_for_files_and_directories_only() {
        let mut placements = [MenuPlacement::Hidden; ExplorerAction::ALL.len()];
        placements[ExplorerAction::Rename as usize] = MenuPlacement::Cascade;
        let plan = build_configured_plan(
            Some(Path::new(r"C:\GitExt\GitExt.exe")),
            None,
            &placements,
            false,
        )
        .unwrap();
        let others_key = cascade_key(&GROUPS[2], ExplorerAction::Rename);
        for context in [CONTEXTS[0], CONTEXTS[2]] {
            let item = format!(r"{}\{CASCADE_KEY}\shell\{others_key}", context.root);
            let command = plan
                .iter()
                .find(|key| key.path == format!(r"{item}\command"))
                .unwrap();
            assert!(command
                .values
                .iter()
                .any(|entry| entry.value.contains("--explorer-action rename")));
        }
        // 目录背景菜单里的 %V 是当前文件夹本身，不提供重命名。
        assert!(!plan
            .iter()
            .any(|key| key.path.starts_with(CONTEXTS[1].root) && key.path.contains("rename")));
    }

    #[test]
    fn directory_context_omits_file_only_actions() {
        let plan = plan();
        let directory_root = CONTEXTS[0].root;
        for action in [
            ExplorerAction::OpenWithDifftool,
            ExplorerAction::FileHistory,
            ExplorerAction::ApplyPatch,
        ] {
            assert!(
                !plan.iter().any(|key| {
                    key.path.starts_with(directory_root)
                        && key.path.contains(&format!(".{}", action.as_str()))
                }),
                "directory context should omit {}",
                action
            );
        }
    }

    #[test]
    fn file_context_omits_directory_only_actions() {
        let plan = plan();
        let file_root = CONTEXTS[2].root;
        for spec in &ACTIONS {
            let present = plan.iter().any(|key| {
                key.path.starts_with(file_root)
                    && (key.path.ends_with(spec.action.as_str()) || key.path.ends_with(spec.key))
            });
            assert_eq!(
                present,
                CONTEXTS[2].supports(spec.action),
                "unexpected file membership for {}",
                spec.action
            );
        }
    }

    #[test]
    fn top_level_labels_include_ellipsis() {
        let plan = plan();
        for (action, label) in [
            (ExplorerAction::Clone, "GitExt Clone..."),
            (
                ExplorerAction::CreateRepository,
                "GitExt Create new repository...",
            ),
            (ExplorerAction::Commit, "GitExt Commit..."),
            (ExplorerAction::OpenRepository, "GitExt Open repository"),
        ] {
            let path = format!(
                r"Software\Classes\Directory\shell\{}",
                top_level_key(action)
            );
            assert!(plan.iter().any(|planned| {
                planned.path == path
                    && planned
                        .values
                        .iter()
                        .any(|entry| entry.name == "MUIVerb" && entry.value == label)
            }));
        }
    }

    #[test]
    fn cascade_uses_extended_subcommands_key_and_icons() {
        let plan = plan();
        for context in CONTEXTS {
            let root = format!(r"{}\{CASCADE_KEY}", context.root);
            let cascade = plan.iter().find(|key| key.path == root).unwrap();
            assert_eq!(
                cascade
                    .values
                    .iter()
                    .find(|entry| entry.name == "ExtendedSubCommandsKey")
                    .map(|entry| entry.value.as_str()),
                Some(format!(r"{}\{CASCADE_KEY}", context.classes_root).as_str())
            );
            assert!(cascade
                .values
                .iter()
                .any(|entry| entry.name == "MUIVerb" && entry.value == "Git Extensions"));
            assert!(cascade
                .values
                .iter()
                .all(|entry| entry.name != DEFAULT_VALUE));
            assert!(cascade
                .values
                .iter()
                .any(|entry| entry.name == "Icon" && entry.value.contains("GitExt.exe")));
            assert!(plan.iter().any(|key| key.path == format!(r"{root}\shell")));
            assert!(!plan
                .iter()
                .any(|key| key.path == format!(r"{root}\ExtendedSubCommandsKey")));
            assert!(!plan
                .iter()
                .any(|key| key.path == format!(r"{root}\ExtendedSubCommandsKey\shell")));
        }
    }

    #[test]
    fn enable_and_disable_are_idempotent() {
        let plan = plan();
        let mut registry = FakeRegistry::default();
        enable(&mut registry, &plan).unwrap();
        let once = (registry.keys.clone(), registry.dwords.clone());
        enable(&mut registry, &plan).unwrap();
        assert_eq!((registry.keys.clone(), registry.dwords.clone()), once);
        disable(&mut registry, &build_plan(None).unwrap()).unwrap();
        assert!(registry.keys.is_empty());
        assert!(registry.dwords.is_empty());
        disable(&mut registry, &build_plan(None).unwrap()).unwrap();
        assert!(registry.keys.is_empty());
        assert!(registry.dwords.is_empty());
    }

    #[test]
    fn enable_protects_foreign_keys_and_rolls_back_before_writing() {
        let plan = plan();
        let mut registry = FakeRegistry::default();
        registry.keys.insert(
            format!(
                r"Software\Classes\Directory\shell\{}",
                top_level_key(ExplorerAction::Clone)
            ),
            BTreeMap::from([(DEFAULT_VALUE.into(), "other application".into())]),
        );
        registry.keys.insert(
            r"Software\Classes\Directory\shell\OtherApp".into(),
            BTreeMap::from([(DEFAULT_VALUE.into(), "untouched".into())]),
        );
        let before = registry.keys.clone();
        assert!(enable(&mut registry, &plan)
            .unwrap_err()
            .to_string()
            .contains("unowned"));
        assert_eq!(registry.keys, before);
    }

    #[test]
    fn disable_skips_foreign_owned_namespace_and_siblings() {
        let plan = plan();
        let mut registry = FakeRegistry::default();
        registry.keys.insert(
            r"Software\Classes\Directory\shell\GitExt.Clone".into(),
            BTreeMap::from([(DEFAULT_VALUE.into(), "foreign".into())]),
        );
        registry.keys.insert(
            r"Software\Classes\Directory\shell\OtherApp".into(),
            BTreeMap::from([(DEFAULT_VALUE.into(), "foreign".into())]),
        );
        let before = registry.keys.clone();
        disable(&mut registry, &plan).unwrap();
        assert_eq!(registry.keys, before);
    }

    #[test]
    fn failed_enable_removes_new_keys() {
        let plan = plan();
        let mut registry = FakeRegistry {
            fail_at: Some(18),
            ..FakeRegistry::default()
        };
        assert!(enable(&mut registry, &plan).is_err());
        assert!(registry.keys.is_empty());
    }

    #[test]
    fn failed_enable_restores_previous_owned_values() {
        let old_plan = build_plan(Some(Path::new(r"D:\Old GitExt\GitExt.exe"))).unwrap();
        let new_plan = plan();
        let mut registry = FakeRegistry::default();
        enable(&mut registry, &old_plan).unwrap();
        registry
            .keys
            .get_mut(&old_plan[0].path)
            .unwrap()
            .insert("MUIVerb".into(), "previous label".into());
        let before = registry.keys.clone();
        registry.fail_at = Some(registry.writes + 20);
        assert!(enable(&mut registry, &new_plan).is_err());
        assert_eq!(registry.keys, before);
    }

    #[test]
    fn failed_disable_restores_deleted_owned_keys() {
        let plan = plan();
        let mut registry = FakeRegistry::default();
        enable(&mut registry, &plan).unwrap();
        let before = registry.keys.clone();
        registry.fail_at = Some(registry.writes + 8);
        assert!(disable(&mut registry, &plan).is_err());
        assert_eq!(registry.keys, before);
    }

    #[test]
    fn disable_read_failure_rolls_back_already_deleted_keys() {
        let plan = plan();
        let mut registry = FakeRegistry::default();
        enable(&mut registry, &plan).unwrap();
        let before = registry.keys.clone();
        // The first command is deleted after three snapshot reads and one value
        // enumeration; fail on the following key's snapshot.
        registry.fail_read_at = Some(registry.reads + 5);
        assert!(disable(&mut registry, &build_plan(None).unwrap())
            .unwrap_err()
            .to_string()
            .contains("injected read failure"));
        assert_eq!(registry.keys, before);
    }

    #[test]
    fn disable_preserves_additional_values_in_owned_keys() {
        let plan = plan();
        let mut registry = FakeRegistry::default();
        enable(&mut registry, &plan).unwrap();
        let retained_path = plan[0].path.clone();
        registry
            .keys
            .get_mut(&retained_path)
            .unwrap()
            .insert("ExistingValue".into(), "keep me".into());

        disable(&mut registry, &build_plan(None).unwrap()).unwrap();

        let retained = registry.keys.get(&retained_path).unwrap();
        assert_eq!(
            retained.get("ExistingValue").map(String::as_str),
            Some("keep me")
        );
        assert_eq!(retained.get(OWNER_VALUE).map(String::as_str), Some(OWNER));
        assert!(!retained.contains_key("MUIVerb"));
        assert!(!retained.contains_key("Icon"));
        assert!(!registry.keys.contains_key(&plan[1].path));
    }

    #[test]
    fn reconcile_preserves_retained_legacy_children_without_failing_parent_cleanup() {
        let known = build_known_plan(Some(Path::new(r"C:\GitExt\GitExt.exe"))).unwrap();
        let desired = plan();
        let mut registry = FakeRegistry::default();
        enable(&mut registry, &known).unwrap();
        let legacy_shell = format!(
            r"{}\{CASCADE_KEY}\ExtendedSubCommandsKey\shell",
            CONTEXTS[1].root
        );
        let retained_path = format!(r"{legacy_shell}\pull");
        registry
            .keys
            .get_mut(&retained_path)
            .unwrap()
            .insert("ExistingValue".into(), "keep me".into());

        reconcile(&mut registry, &build_known_plan(None).unwrap(), &desired).unwrap();

        let retained = registry.keys.get(&retained_path).unwrap();
        assert_eq!(
            retained.get("ExistingValue").map(String::as_str),
            Some("keep me")
        );
        assert!(!retained.contains_key("MUIVerb"));
        assert!(!retained.contains_key(DEFAULT_VALUE));
        assert!(registry.keys.contains_key(&legacy_shell));
        let top_level = registry
            .keys
            .get(&format!(
                r"{}\{}",
                CONTEXTS[1].root,
                top_level_key(ExplorerAction::Clone)
            ))
            .unwrap();
        assert!(!top_level.contains_key(DEFAULT_VALUE));
        assert!(!registry
            .keys
            .contains_key(&format!(r"{}\GitExt.Clone", CONTEXTS[1].root)));

        disable(&mut registry, &build_known_plan(None).unwrap()).unwrap();
        assert_eq!(
            registry
                .keys
                .get(&retained_path)
                .unwrap()
                .get("ExistingValue")
                .map(String::as_str),
            Some("keep me")
        );
        registry
            .keys
            .get_mut(&retained_path)
            .unwrap()
            .remove("ExistingValue");
        disable(&mut registry, &build_known_plan(None).unwrap()).unwrap();
        assert!(registry.keys.is_empty());
    }

    #[test]
    fn reconcile_migrates_legacy_layout_and_removes_unselected_positions() {
        let known = build_known_plan(Some(Path::new(r"C:\GitExt\GitExt.exe"))).unwrap();
        let desired = plan();
        let mut registry = FakeRegistry::default();
        enable(&mut registry, &known).unwrap();
        let root = format!(r"{}\{CASCADE_KEY}", CONTEXTS[0].root);
        registry
            .keys
            .get_mut(&root)
            .unwrap()
            .insert(DEFAULT_VALUE.into(), "Git Extensions".into());

        reconcile(&mut registry, &build_known_plan(None).unwrap(), &desired).unwrap();

        let migrated = registry.keys.get(&root).unwrap();
        assert!(!migrated.contains_key(DEFAULT_VALUE));
        assert_eq!(
            migrated.get("MUIVerb").map(String::as_str),
            Some("Git Extensions")
        );
        assert_eq!(
            migrated.get("ExtendedSubCommandsKey").map(String::as_str),
            Some(r"Directory\shell\GitExt.Menu")
        );
        assert!(registry
            .keys
            .contains_key(&format!(r"{root}\shell\10.03.pull")));
        assert!(registry
            .keys
            .contains_key(&format!(r"{root}\shell\20.03.checkout-branch")));
        assert!(!registry
            .keys
            .contains_key(&format!(r"{root}\groups\10.Common\shell\03.pull")));
        assert!(!registry.keys.contains_key(&format!(r"{root}\shell\pull")));
        assert!(!registry
            .keys
            .contains_key(&format!(r"{root}\ExtendedSubCommandsKey")));
        assert!(!registry
            .keys
            .contains_key(&format!(r"{}\GitExt.Pull", CONTEXTS[0].root)));
        disable(&mut registry, &build_known_plan(None).unwrap()).unwrap();
        assert!(registry.keys.is_empty());
    }

    #[test]
    fn always_show_all_flattens_commands_and_honors_hidden_items() {
        let mut placements = default_placements();
        placements[ExplorerAction::Pull as usize] = MenuPlacement::Hidden;
        let desired = build_configured_plan(
            Some(Path::new(r"C:\GitExt\GitExt.exe")),
            None,
            &placements,
            true,
        )
        .unwrap();
        let mut registry = FakeRegistry::default();
        enable(&mut registry, &plan()).unwrap();
        reconcile(&mut registry, &build_known_plan(None).unwrap(), &desired).unwrap();

        let root = CONTEXTS[0].root;
        assert!(registry
            .keys
            .contains_key(&format!(r"{root}\{}", top_level_key(ExplorerAction::Push))));
        assert!(!registry
            .keys
            .contains_key(&format!(r"{root}\{}", top_level_key(ExplorerAction::Pull))));
        assert!(!registry
            .keys
            .contains_key(&format!(r"{root}\{CASCADE_KEY}")));
        assert!(desired.iter().all(|key| !key.path.contains(CASCADE_KEY)));
    }

    #[test]
    fn no_cascade_items_omit_the_empty_menu_root() {
        let mut placements = [MenuPlacement::Hidden; ExplorerAction::ALL.len()];
        placements[ExplorerAction::Clone as usize] = MenuPlacement::Top;
        let plan = build_configured_plan(
            Some(Path::new(r"C:\GitExt\GitExt.exe")),
            None,
            &placements,
            false,
        )
        .unwrap();
        assert!(plan.iter().all(|key| !key.path.contains(CASCADE_KEY)));
        assert_eq!(
            plan.len(),
            CONTEXTS
                .iter()
                .filter(|context| context.supports(ExplorerAction::Clone))
                .count()
                * 2
        );
    }

    #[test]
    fn duplicate_menu_actions_are_rejected() {
        let error = validate_placements(vec![
            ExplorerMenuItem {
                action: ExplorerAction::Clone,
                placement: MenuPlacement::Top,
            },
            ExplorerMenuItem {
                action: ExplorerAction::Clone,
                placement: MenuPlacement::Hidden,
            },
        ])
        .unwrap_err();
        assert!(error.to_string().contains("duplicate"));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn cleanup_removes_unknown_owned_keys_only() {
        use std::collections::BTreeMap;
        let known = build_known_plan(None).unwrap();
        let mut registry = FakeRegistry::default();
        let root = CONTEXTS[0].root;
        let stale = format!(r"{root}\{CASCADE_KEY}\shell\30.03.reset-file-changes");
        let stale_command = format!(r"{stale}\command");
        let kept = format!(
            r"{root}\{CASCADE_KEY}\shell\{}",
            cascade_key(&GROUPS[2], ExplorerAction::ResetFileChanges)
        );
        let foreign = format!(r"{root}\{CASCADE_KEY}\shell\foreign-entry");
        for path in [&stale, &stale_command, &kept] {
            registry.keys.insert(
                path.clone(),
                BTreeMap::from([(OWNER_VALUE.to_owned(), OWNER.to_owned())]),
            );
        }
        registry.keys.insert(
            foreign.clone(),
            BTreeMap::from([(OWNER_VALUE.to_owned(), "another-app".to_owned())]),
        );
        cleanup_owned_leftovers(&mut registry, &known).unwrap();
        assert!(!registry.keys.contains_key(&stale));
        assert!(!registry.keys.contains_key(&stale_command));
        assert!(registry.keys.contains_key(&kept));
        assert!(registry.keys.contains_key(&foreign));
    }

    #[test]
    fn failed_reconcile_restores_the_previous_complete_menu() {
        let known = build_known_plan(None).unwrap();
        let desired = build_configured_plan(
            Some(Path::new(r"D:\New GitExt\GitExt.exe")),
            None,
            &default_placements(),
            true,
        )
        .unwrap();
        let mut registry = FakeRegistry::default();
        enable(&mut registry, &plan()).unwrap();
        let before = registry.keys.clone();
        registry.fail_at = Some(registry.writes + 35);
        assert!(reconcile(&mut registry, &known, &desired).is_err());
        assert_eq!(registry.keys, before);
    }

    #[test]
    fn supported_matches_the_target_without_touching_registry() {
        assert_eq!(supported(), cfg!(target_os = "windows"));
    }
}
