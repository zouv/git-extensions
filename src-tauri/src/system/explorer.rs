use std::error::Error;
use std::fmt::{Display, Formatter};
use std::path::Path;

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
    },
    Context {
        root: r"Software\Classes\Directory\Background\shell",
        classes_root: r"Directory\Background\shell",
        placeholder: "%V",
        file_context: false,
    },
    Context {
        root: r"Software\Classes\*\shell",
        classes_root: r"*\shell",
        placeholder: "%1",
        file_context: true,
    },
];

#[derive(Clone, Copy)]
struct Context {
    root: &'static str,
    classes_root: &'static str,
    placeholder: &'static str,
    file_context: bool,
}

impl Context {
    fn supports(self, action: ExplorerAction) -> bool {
        !self.file_context
            || !matches!(
                action,
                ExplorerAction::Clone | ExplorerAction::CreateRepository
            )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MenuPlacement {
    Top,
    Cascade,
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
}

const ACTIONS: [ActionSpec; 17] = [
    ActionSpec {
        action: ExplorerAction::Clone,
        label: "Clone...",
        key: "GitExt.Clone",
    },
    ActionSpec {
        action: ExplorerAction::CreateRepository,
        label: "Create new repository...",
        key: "GitExt.CreateRepository",
    },
    ActionSpec {
        action: ExplorerAction::Commit,
        label: "Commit...",
        key: "GitExt.Commit",
    },
    ActionSpec {
        action: ExplorerAction::OpenRepository,
        label: "Open repository",
        key: "GitExt.OpenRepository",
    },
    ActionSpec {
        action: ExplorerAction::Pull,
        label: "Pull",
        key: "GitExt.Pull",
    },
    ActionSpec {
        action: ExplorerAction::Push,
        label: "Push",
        key: "GitExt.Push",
    },
    ActionSpec {
        action: ExplorerAction::ViewStash,
        label: "View stash",
        key: "GitExt.ViewStash",
    },
    ActionSpec {
        action: ExplorerAction::ViewChanges,
        label: "View changes",
        key: "GitExt.ViewChanges",
    },
    ActionSpec {
        action: ExplorerAction::CheckoutBranch,
        label: "Checkout branch",
        key: "GitExt.CheckoutBranch",
    },
    ActionSpec {
        action: ExplorerAction::CheckoutRevision,
        label: "Checkout revision",
        key: "GitExt.CheckoutRevision",
    },
    ActionSpec {
        action: ExplorerAction::CreateBranch,
        label: "Create branch",
        key: "GitExt.CreateBranch",
    },
    ActionSpec {
        action: ExplorerAction::OpenWithDifftool,
        label: "Open with difftool",
        key: "GitExt.OpenWithDifftool",
    },
    ActionSpec {
        action: ExplorerAction::FileHistory,
        label: "View changelog",
        key: "GitExt.FileHistory",
    },
    ActionSpec {
        action: ExplorerAction::ResetFileChanges,
        label: "Reset file changes",
        key: "GitExt.ResetFileChanges",
    },
    ActionSpec {
        action: ExplorerAction::AddFiles,
        label: "Add files",
        key: "GitExt.AddFiles",
    },
    ActionSpec {
        action: ExplorerAction::ApplyPatch,
        label: "Apply patch",
        key: "GitExt.ApplyPatch",
    },
    ActionSpec {
        action: ExplorerAction::Settings,
        label: "Settings",
        key: "GitExt.Settings",
    },
];

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
            let exe = std::env::current_exe().map_err(|error| {
                ExplorerError::new(format!("cannot locate current executable: {error}"))
            })?;
            let desired = build_configured_plan(Some(&exe), &placements, always_show_all_commands)?;
            reconcile(&mut registry, &known, &desired)
        } else {
            disable(&mut registry, &known)
        };
        if result.is_ok() {
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct RegistryValue {
    name: &'static str,
    value: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PlannedKey {
    path: String,
    values: Vec<RegistryValue>,
}

fn value(name: &'static str, value: impl Into<String>) -> RegistryValue {
    RegistryValue {
        name,
        value: value.into(),
    }
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

#[cfg(test)]
fn default_placements() -> [MenuPlacement; ExplorerAction::ALL.len()] {
    let mut placements = [MenuPlacement::Cascade; ExplorerAction::ALL.len()];
    for action in [
        ExplorerAction::Clone,
        ExplorerAction::CreateRepository,
        ExplorerAction::Commit,
    ] {
        placements[action as usize] = MenuPlacement::Top;
    }
    placements
}

#[cfg(test)]
fn build_plan(exe: Option<&Path>) -> Result<Vec<PlannedKey>, ExplorerError> {
    build_configured_plan(exe, &default_placements(), false)
}

fn build_configured_plan(
    exe: Option<&Path>,
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
                format!(r"{}\{}", context.root, spec.key),
                format!("GitExt {}", spec.label),
                spec.action,
                context,
                exe,
            )?;
        }

        let cascade_specs: Vec<_> = ACTIONS
            .iter()
            .filter(|spec| {
                context.supports(spec.action)
                    && !always_show_all_commands
                    && placements[spec.action as usize] == MenuPlacement::Cascade
            })
            .collect();
        if !cascade_specs.is_empty() {
            let cascade = format!(r"{}\{CASCADE_KEY}", context.root);
            plan.push(PlannedKey {
                path: cascade.clone(),
                values: owned_values(vec![
                    // Explorer's own Directory verbs use a registry path value;
                    // an empty value or a literal ExtendedSubCommandsKey child
                    // does not identify the subcommand source key.
                    value("MUIVerb", "Git Extensions"),
                    value("Icon", exe.unwrap_or("")),
                    value(
                        "ExtendedSubCommandsKey",
                        format!(r"{}\{CASCADE_KEY}", context.classes_root),
                    ),
                ]),
            });
            let cascade_shell = format!(r"{cascade}\shell");
            plan.push(PlannedKey {
                path: cascade_shell.clone(),
                values: owned_values(Vec::new()),
            });
            for spec in cascade_specs {
                add_menu_item(
                    &mut plan,
                    format!(r"{cascade_shell}\{}", spec.action.as_str()),
                    spec.label.to_owned(),
                    spec.action,
                    context,
                    exe,
                )?;
            }
        }
    }
    Ok(plan)
}

/// Covers every current and legacy location so reconfiguration and disable never
/// leave old menu entries behind. The literal ExtendedSubCommandsKey child tree
/// and old empty path value are intentionally remove-only during migration.
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
                value("Icon", exe.unwrap_or("")),
                value("ExtendedSubCommandsKey", ""),
            ]),
        });
        let extended = format!(r"{cascade}\ExtendedSubCommandsKey");
        plan.push(PlannedKey {
            path: extended.clone(),
            values: owned_values(Vec::new()),
        });
        let shell = format!(r"{extended}\shell");
        plan.push(PlannedKey {
            path: shell.clone(),
            values: owned_values(Vec::new()),
        });
        for spec in &ACTIONS {
            add_menu_item(
                &mut plan,
                format!(r"{shell}\{}", spec.action.as_str()),
                spec.label.to_owned(),
                spec.action,
                context,
                exe,
            )?;
        }

        let legacy_shell = format!(r"{cascade}\shell");
        plan.push(PlannedKey {
            path: legacy_shell.clone(),
            values: owned_values(Vec::new()),
        });
        for spec in &ACTIONS {
            add_legacy_menu_item(
                &mut plan,
                format!(r"{legacy_shell}\{}", spec.action.as_str()),
                spec.label.to_owned(),
                spec.action,
                context,
                exe,
            )?;
        }
        for spec in &ACTIONS {
            add_legacy_menu_item(
                &mut plan,
                format!(r"{}\{}", context.root, spec.key),
                format!("GitExt {}", spec.label),
                spec.action,
                context,
                exe,
            )?;
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
) -> Result<(), ExplorerError> {
    let item_values = vec![value("MUIVerb", label), value("Icon", exe.unwrap_or(""))];
    let command_values = vec![value(
        DEFAULT_VALUE,
        exe.map(|exe| command_line(exe, action.as_str(), context.placeholder))
            .unwrap_or_default(),
    )];
    plan.push(PlannedKey {
        path: key.clone(),
        values: owned_values(item_values),
    });
    plan.push(PlannedKey {
        path: format!(r"{key}\command"),
        values: owned_values(command_values),
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
) -> Result<(), ExplorerError> {
    let item_index = plan.len();
    add_menu_item(plan, key, label.clone(), action, context, exe)?;
    // The first implementation used (Default) for item labels. Include it in
    // snapshots and cleanup so migration does not mistake our own label for
    // foreign data and retain a non-empty child key.
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
    fn value_names(&mut self, key: &str) -> Result<Vec<String>, ExplorerError>;
    fn has_subkeys(&mut self, key: &str) -> Result<bool, ExplorerError>;
    fn create_key(&mut self, key: &str) -> Result<(), ExplorerError>;
    fn set_string(&mut self, key: &str, name: &str, value: &str) -> Result<(), ExplorerError>;
    fn delete_value(&mut self, key: &str, name: &str) -> Result<(), ExplorerError>;
    fn delete_key(&mut self, key: &str) -> Result<(), ExplorerError>;
}

#[derive(Debug)]
struct KeySnapshot {
    existed: bool,
    values: Vec<Option<String>>,
}

fn snapshot_key(
    registry: &mut impl ExplorerRegistry,
    key: &PlannedKey,
) -> Result<KeySnapshot, ExplorerError> {
    let existed = registry.key_exists(&key.path)?;
    let mut values = Vec::with_capacity(key.values.len());
    if existed {
        for entry in &key.values {
            values.push(registry.get_string(&key.path, entry.name)?);
        }
    }
    Ok(KeySnapshot { existed, values })
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
            for entry in &known[index].values {
                if !desired_key
                    .values
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

    fn set_string(&mut self, key: &str, name: &str, value: &str) -> Result<(), ExplorerError> {
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

        fn value_names(&mut self, key: &str) -> Result<Vec<String>, ExplorerError> {
            self.maybe_fail_read()?;
            Ok(self
                .keys
                .get(key)
                .map(|values| values.keys().cloned().collect())
                .unwrap_or_default())
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

        fn set_string(&mut self, key: &str, name: &str, value: &str) -> Result<(), ExplorerError> {
            self.maybe_fail()?;
            self.keys
                .get_mut(key)
                .ok_or_else(|| ExplorerError::new("fake key does not exist"))?
                .insert(name.to_owned(), value.to_owned());
            Ok(())
        }

        fn delete_value(&mut self, key: &str, name: &str) -> Result<(), ExplorerError> {
            self.maybe_fail()?;
            if let Some(values) = self.keys.get_mut(key) {
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
                let cascade_path = format!(
                    r"{}\{CASCADE_KEY}\shell\{}",
                    context.root,
                    spec.action.as_str()
                );
                assert_eq!(
                    plan.iter().any(|key| key.path == cascade_path),
                    context.supports(spec.action)
                        && default_placements()[spec.action as usize] == MenuPlacement::Cascade,
                    "unexpected cascade membership for {}",
                    spec.action
                );
            }
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
                !matches!(
                    spec.action,
                    ExplorerAction::Clone | ExplorerAction::CreateRepository
                ),
                "unexpected file membership for {}",
                spec.action
            );
        }
    }

    #[test]
    fn top_level_labels_include_ellipsis() {
        let plan = plan();
        for (key, label) in [
            ("GitExt.Clone", "GitExt Clone..."),
            ("GitExt.CreateRepository", "GitExt Create new repository..."),
            ("GitExt.Commit", "GitExt Commit..."),
        ] {
            let path = format!(r"Software\Classes\Directory\shell\{key}");
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
                .any(|entry| entry.name == "Icon" && entry.value.ends_with("GitExt.exe")));
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
        let once = registry.keys.clone();
        enable(&mut registry, &plan).unwrap();
        assert_eq!(registry.keys, once);
        disable(&mut registry, &build_plan(None).unwrap()).unwrap();
        assert!(registry.keys.is_empty());
        disable(&mut registry, &build_plan(None).unwrap()).unwrap();
        assert!(registry.keys.is_empty());
    }

    #[test]
    fn enable_protects_foreign_keys_and_rolls_back_before_writing() {
        let plan = plan();
        let mut registry = FakeRegistry::default();
        registry.keys.insert(
            r"Software\Classes\Directory\shell\GitExt.Clone".into(),
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
            .get(&format!(r"{}\GitExt.Clone", CONTEXTS[1].root))
            .unwrap();
        assert!(!top_level.contains_key(DEFAULT_VALUE));

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
        assert!(registry.keys.contains_key(&format!(r"{root}\shell\pull")));
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
        let desired =
            build_configured_plan(Some(Path::new(r"C:\GitExt\GitExt.exe")), &placements, true)
                .unwrap();
        let mut registry = FakeRegistry::default();
        enable(&mut registry, &plan()).unwrap();
        reconcile(&mut registry, &build_known_plan(None).unwrap(), &desired).unwrap();

        let root = CONTEXTS[0].root;
        assert!(registry.keys.contains_key(&format!(r"{root}\GitExt.Push")));
        assert!(!registry.keys.contains_key(&format!(r"{root}\GitExt.Pull")));
        assert!(!registry
            .keys
            .contains_key(&format!(r"{root}\{CASCADE_KEY}")));
        assert!(desired.iter().all(|key| !key.path.contains(CASCADE_KEY)));
    }

    #[test]
    fn no_cascade_items_omit_the_empty_menu_root() {
        let mut placements = [MenuPlacement::Hidden; ExplorerAction::ALL.len()];
        placements[ExplorerAction::Clone as usize] = MenuPlacement::Top;
        let plan =
            build_configured_plan(Some(Path::new(r"C:\GitExt\GitExt.exe")), &placements, false)
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
    fn failed_reconcile_restores_the_previous_complete_menu() {
        let known = build_known_plan(None).unwrap();
        let desired = build_configured_plan(
            Some(Path::new(r"D:\New GitExt\GitExt.exe")),
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
