use std::error::Error;
use std::ffi::{OsStr, OsString};
use std::fmt::{Display, Formatter};
use std::path::PathBuf;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

const EXPLORER_ACTION_ARG: &str = "--explorer-action";
const PATH_ARG: &str = "--path";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExplorerAction {
    Clone,
    CreateRepository,
    Commit,
    OpenRepository,
    Pull,
    Push,
    ViewStash,
    ViewChanges,
    CheckoutBranch,
    CheckoutRevision,
    CreateBranch,
    OpenWithDifftool,
    FileHistory,
    ResetFileChanges,
    AddFiles,
    ApplyPatch,
    Settings,
}

impl ExplorerAction {
    pub const ALL: [Self; 17] = [
        Self::Clone,
        Self::CreateRepository,
        Self::Commit,
        Self::OpenRepository,
        Self::Pull,
        Self::Push,
        Self::ViewStash,
        Self::ViewChanges,
        Self::CheckoutBranch,
        Self::CheckoutRevision,
        Self::CreateBranch,
        Self::OpenWithDifftool,
        Self::FileHistory,
        Self::ResetFileChanges,
        Self::AddFiles,
        Self::ApplyPatch,
        Self::Settings,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Clone => "clone",
            Self::CreateRepository => "create-repository",
            Self::Commit => "commit",
            Self::OpenRepository => "open-repository",
            Self::Pull => "pull",
            Self::Push => "push",
            Self::ViewStash => "view-stash",
            Self::ViewChanges => "view-changes",
            Self::CheckoutBranch => "checkout-branch",
            Self::CheckoutRevision => "checkout-revision",
            Self::CreateBranch => "create-branch",
            Self::OpenWithDifftool => "open-with-difftool",
            Self::FileHistory => "file-history",
            Self::ResetFileChanges => "reset-file-changes",
            Self::AddFiles => "add-files",
            Self::ApplyPatch => "apply-patch",
            Self::Settings => "settings",
        }
    }

    pub const fn requires_path(self) -> bool {
        !matches!(self, Self::Settings)
    }

    /// Actions that need the full repository workspace rather than a standalone
    /// Explorer workflow window.
    pub const fn opens_main_window(self) -> bool {
        matches!(self, Self::OpenRepository | Self::Settings)
    }

    pub const fn window_title(self) -> &'static str {
        match self {
            Self::Clone => "Clone",
            Self::CreateRepository => "Create new repository",
            Self::Commit => "Commit",
            Self::OpenRepository => "Open repository",
            Self::Pull => "Pull",
            Self::Push => "Push",
            Self::ViewStash => "View stash",
            Self::ViewChanges => "View changes",
            Self::CheckoutBranch => "Checkout branch",
            Self::CheckoutRevision => "Checkout revision",
            Self::CreateBranch => "Create branch",
            Self::OpenWithDifftool => "Open with difftool",
            Self::FileHistory => "View changelog",
            Self::ResetFileChanges => "Reset file changes",
            Self::AddFiles => "Add files",
            Self::ApplyPatch => "Apply patch",
            Self::Settings => "Settings",
        }
    }
}

impl Display for ExplorerAction {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for ExplorerAction {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::ALL
            .into_iter()
            .find(|action| action.as_str() == value)
            .ok_or(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LaunchRequest {
    pub action: ExplorerAction,
    pub path: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LaunchParseError {
    DuplicateArgument(&'static str),
    MissingValue(&'static str),
    UnknownAction(OsString),
    MissingAction,
    MissingPath(ExplorerAction),
    UnexpectedPath(ExplorerAction),
    EmptyPath,
    UnexpectedArgument(OsString),
}

impl Display for LaunchParseError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DuplicateArgument(argument) => {
                write!(formatter, "duplicate launch argument: {argument}")
            }
            Self::MissingValue(argument) => {
                write!(formatter, "missing value for launch argument: {argument}")
            }
            Self::UnknownAction(action) => write!(
                formatter,
                "unknown Explorer action: {}",
                action.to_string_lossy()
            ),
            Self::MissingAction => write!(formatter, "{PATH_ARG} requires {EXPLORER_ACTION_ARG}"),
            Self::MissingPath(action) => {
                write!(formatter, "Explorer action {action} requires {PATH_ARG}")
            }
            Self::UnexpectedPath(action) => {
                write!(
                    formatter,
                    "Explorer action {action} does not accept {PATH_ARG}"
                )
            }
            Self::EmptyPath => formatter.write_str("Explorer launch path is empty"),
            Self::UnexpectedArgument(argument) => write!(
                formatter,
                "unexpected Explorer launch argument: {}",
                argument.to_string_lossy()
            ),
        }
    }
}

impl Error for LaunchParseError {}

/// Parses arguments after the executable name. Unrelated arguments are ignored only
/// when no Explorer launch argument is present, leaving normal/rebase startup alone.
pub fn parse_launch_request<I>(args: I) -> Result<Option<LaunchRequest>, LaunchParseError>
where
    I: IntoIterator<Item = OsString>,
{
    let mut args = args.into_iter();
    let mut action: Option<ExplorerAction> = None;
    let mut path: Option<PathBuf> = None;
    let mut saw_explorer_argument = false;
    let mut unrelated_arguments = Vec::new();

    while let Some(argument) = args.next() {
        if is_malformed_explorer_argument(&argument) {
            return Err(LaunchParseError::UnexpectedArgument(argument));
        }

        if argument == EXPLORER_ACTION_ARG {
            saw_explorer_argument = true;
            if action.is_some() {
                return Err(LaunchParseError::DuplicateArgument(EXPLORER_ACTION_ARG));
            }
            let value = args
                .next()
                .filter(|value| !is_launch_flag(value))
                .ok_or(LaunchParseError::MissingValue(EXPLORER_ACTION_ARG))?;
            let parsed = value
                .to_str()
                .and_then(|value| value.parse().ok())
                .ok_or_else(|| LaunchParseError::UnknownAction(value.clone()))?;
            action = Some(parsed);
        } else if argument == PATH_ARG {
            saw_explorer_argument = true;
            if path.is_some() {
                return Err(LaunchParseError::DuplicateArgument(PATH_ARG));
            }
            let value = args
                .next()
                .filter(|value| !is_launch_flag(value))
                .ok_or(LaunchParseError::MissingValue(PATH_ARG))?;
            if is_malformed_explorer_argument(&value) {
                return Err(LaunchParseError::UnexpectedArgument(value));
            }
            if value.is_empty() {
                return Err(LaunchParseError::EmptyPath);
            }
            path = Some(PathBuf::from(value));
        } else {
            unrelated_arguments.push(argument);
        }
    }

    if !saw_explorer_argument {
        return Ok(None);
    }
    if let Some(argument) = unrelated_arguments.into_iter().next() {
        return Err(LaunchParseError::UnexpectedArgument(argument));
    }

    let action = action.ok_or(LaunchParseError::MissingAction)?;
    match (action.requires_path(), path) {
        (true, Some(path)) => Ok(Some(LaunchRequest {
            action,
            path: Some(path),
        })),
        (true, None) => Err(LaunchParseError::MissingPath(action)),
        (false, Some(_)) => Err(LaunchParseError::UnexpectedPath(action)),
        (false, None) => Ok(Some(LaunchRequest { action, path: None })),
    }
}

/// Entry point for `main`, after the internal rebase editor protocol has been handled.
pub fn parse_process_launch_request() -> Result<Option<LaunchRequest>, LaunchParseError> {
    parse_launch_request(std::env::args_os().skip(1))
}

fn is_launch_flag(value: &OsStr) -> bool {
    value == EXPLORER_ACTION_ARG || value == PATH_ARG
}

fn is_malformed_explorer_argument(value: &OsStr) -> bool {
    value.to_str().is_some_and(|value| {
        value.starts_with("--explorer-action=") || value.starts_with("--path=")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    #[test]
    fn parses_every_action_and_serde_names() {
        for action in ExplorerAction::ALL {
            let mut arguments = args(&[EXPLORER_ACTION_ARG, action.as_str()]);
            if action.requires_path() {
                arguments.extend(args(&[PATH_ARG, "C:\\work\\repo"]));
            }
            let request = parse_launch_request(arguments)
                .unwrap()
                .expect("launch request");
            assert_eq!(request.action, action);
            assert_eq!(
                request.path,
                action
                    .requires_path()
                    .then(|| PathBuf::from("C:\\work\\repo"))
            );
            assert_eq!(
                serde_json::to_string(&action).unwrap(),
                format!("\"{}\"", action.as_str())
            );
            let decoded: ExplorerAction =
                serde_json::from_str(&format!("\"{}\"", action.as_str())).unwrap();
            assert_eq!(decoded, action);
        }
    }

    #[test]
    fn only_open_and_settings_use_the_full_main_window() {
        for action in ExplorerAction::ALL {
            assert_eq!(
                action.opens_main_window(),
                matches!(
                    action,
                    ExplorerAction::OpenRepository | ExplorerAction::Settings
                ),
                "unexpected window route for {action}"
            );
            assert!(!action.window_title().is_empty());
        }
    }

    #[test]
    fn accepts_path_before_action_and_os_strings_with_spaces_and_unicode() {
        let path = OsString::from("D:\\代码 空间\\仓库 🦀");
        let request = parse_launch_request(vec![
            OsString::from(PATH_ARG),
            path.clone(),
            OsString::from(EXPLORER_ACTION_ARG),
            OsString::from("file-history"),
        ])
        .unwrap()
        .unwrap();
        assert_eq!(request.action, ExplorerAction::FileHistory);
        assert_eq!(request.path, Some(PathBuf::from(path)));
    }

    #[test]
    fn ignores_normal_and_rebase_only_arguments() {
        assert_eq!(parse_launch_request(Vec::new()).unwrap(), None);
        assert_eq!(
            parse_launch_request(args(&["--normal-startup", "value"])).unwrap(),
            None
        );
        assert_eq!(
            parse_launch_request(args(&[
                "--git-extensions-rebase-editor",
                "C:\\repo with space\\.git\\rebase-merge\\git-rebase-todo",
            ]))
            .unwrap(),
            None
        );
    }

    #[test]
    fn settings_rejects_a_path() {
        assert_eq!(
            parse_launch_request(args(&[
                EXPLORER_ACTION_ARG,
                "settings",
                PATH_ARG,
                "C:\\repo",
            ])),
            Err(LaunchParseError::UnexpectedPath(ExplorerAction::Settings))
        );
    }

    #[test]
    fn rejects_missing_action_path_and_values() {
        assert_eq!(
            parse_launch_request(args(&[PATH_ARG, "C:\\repo"])),
            Err(LaunchParseError::MissingAction)
        );
        assert_eq!(
            parse_launch_request(args(&[EXPLORER_ACTION_ARG, "clone"])),
            Err(LaunchParseError::MissingPath(ExplorerAction::Clone))
        );
        assert_eq!(
            parse_launch_request(args(&[EXPLORER_ACTION_ARG])),
            Err(LaunchParseError::MissingValue(EXPLORER_ACTION_ARG))
        );
        assert_eq!(
            parse_launch_request(args(&[EXPLORER_ACTION_ARG, PATH_ARG, "C:\\repo"])),
            Err(LaunchParseError::MissingValue(EXPLORER_ACTION_ARG))
        );
        assert_eq!(
            parse_launch_request(args(&[EXPLORER_ACTION_ARG, "clone", PATH_ARG])),
            Err(LaunchParseError::MissingValue(PATH_ARG))
        );
        assert_eq!(
            parse_launch_request(args(&[EXPLORER_ACTION_ARG, "clone", PATH_ARG, ""])),
            Err(LaunchParseError::EmptyPath)
        );
    }

    #[test]
    fn rejects_duplicate_arguments() {
        assert_eq!(
            parse_launch_request(args(&[
                EXPLORER_ACTION_ARG,
                "clone",
                EXPLORER_ACTION_ARG,
                "push",
                PATH_ARG,
                "C:\\repo",
            ])),
            Err(LaunchParseError::DuplicateArgument(EXPLORER_ACTION_ARG))
        );
        assert_eq!(
            parse_launch_request(args(&[
                EXPLORER_ACTION_ARG,
                "clone",
                PATH_ARG,
                "C:\\one",
                PATH_ARG,
                "C:\\two",
            ])),
            Err(LaunchParseError::DuplicateArgument(PATH_ARG))
        );
    }

    #[test]
    fn rejects_unknown_actions_and_arguments() {
        assert_eq!(
            parse_launch_request(args(&[
                EXPLORER_ACTION_ARG,
                "unknown",
                PATH_ARG,
                "C:\\repo"
            ])),
            Err(LaunchParseError::UnknownAction(OsString::from("unknown")))
        );
        assert_eq!(
            parse_launch_request(args(&[
                EXPLORER_ACTION_ARG,
                "clone",
                PATH_ARG,
                "C:\\repo",
                "--unknown",
            ])),
            Err(LaunchParseError::UnexpectedArgument(OsString::from(
                "--unknown"
            )))
        );
        assert_eq!(
            parse_launch_request(args(&["--explorer-action=clone"])),
            Err(LaunchParseError::UnexpectedArgument(OsString::from(
                "--explorer-action=clone"
            )))
        );
        assert_eq!(
            parse_launch_request(args(&["--path=C:\\repo"])),
            Err(LaunchParseError::UnexpectedArgument(OsString::from(
                "--path=C:\\repo"
            )))
        );
    }

    #[test]
    fn rejects_malformed_path_values() {
        for malformed in ["--path=C:\\other", "--explorer-action=push"] {
            assert_eq!(
                parse_launch_request(args(&[EXPLORER_ACTION_ARG, "clone", PATH_ARG, malformed,])),
                Err(LaunchParseError::UnexpectedArgument(OsString::from(
                    malformed
                )))
            );
        }
    }
}
