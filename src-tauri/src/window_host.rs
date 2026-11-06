use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::launch::{ExplorerAction, LaunchRequest};

pub const MAIN_LAUNCH_EVENT: &str = "main-launch-available";
const MAIN_LABEL: &str = "main";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WindowRole {
    Main,
    Explorer,
}

#[derive(Debug)]
struct WindowSession {
    role: WindowRole,
    pending: Vec<LaunchRequest>,
}

#[derive(Debug, Default)]
struct WindowState {
    sessions: HashMap<String, WindowSession>,
    main_label: Option<String>,
    next_explorer_id: u64,
}

#[derive(Default)]
pub struct LaunchState(Mutex<WindowState>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBootstrap {
    pub kind: WindowRole,
    pub requests: Vec<LaunchRequest>,
}

fn lock(state: &LaunchState) -> std::sync::MutexGuard<'_, WindowState> {
    state
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Sends an Explorer action to the single process. `open-repository` and
/// `settings` belong to the full application; every other action gets its own
/// lightweight window. Requests are queued before the window loads so no event
/// can be lost between window creation and React subscribing.
pub fn route_request(app: &AppHandle, request: LaunchRequest) {
    if request.action.opens_main_window() {
        queue_main_request(app, Some(request));
    } else if let Err(error) = create_explorer_window(app, request) {
        eprintln!("failed to create Explorer action window: {error}");
    }
}

pub fn queue_main_request(app: &AppHandle, request: Option<LaunchRequest>) {
    let state = app.state::<LaunchState>();
    let main_label = {
        let mut windows = lock(&state);
        if let Some(label) = windows
            .main_label
            .clone()
            .filter(|label| windows.sessions.contains_key(label))
        {
            if let Some(request) = request.as_ref() {
                if let Some(session) = windows.sessions.get_mut(&label) {
                    session.pending.push(request.clone());
                }
            }
            Some(label)
        } else {
            windows.main_label = None;
            None
        }
    };

    if let Some(label) = main_label {
        focus_and_notify(app, &label);
        return;
    }
    if let Err(error) = create_main_window(app, request) {
        eprintln!("failed to create main window: {error}");
    }
}

fn focus_and_notify(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        if let Err(error) = app.emit_to(label, MAIN_LAUNCH_EVENT, ()) {
            eprintln!("failed to notify main window: {error}");
        }
    }
}

fn create_main_window(app: &AppHandle, request: Option<LaunchRequest>) -> Result<(), String> {
    let state = app.state::<LaunchState>();
    {
        let mut windows = lock(&state);
        if let Some(label) = windows.main_label.clone() {
            if windows.sessions.contains_key(&label) {
                if let Some(request) = request {
                    if let Some(session) = windows.sessions.get_mut(&label) {
                        session.pending.push(request);
                    }
                }
                drop(windows);
                focus_and_notify(app, &label);
                return Ok(());
            }
        }
        windows.main_label = Some(MAIN_LABEL.into());
        windows.sessions.insert(
            MAIN_LABEL.into(),
            WindowSession {
                role: WindowRole::Main,
                pending: request.into_iter().collect(),
            },
        );
    }

    let built = WebviewWindowBuilder::new(app, MAIN_LABEL, WebviewUrl::App("index.html".into()))
        .title("Git Extensions")
        .inner_size(1440.0, 900.0)
        .min_inner_size(900.0, 600.0)
        .decorations(false)
        .visible(false)
        .build();

    if let Err(error) = built {
        let mut windows = lock(&state);
        windows.sessions.remove(MAIN_LABEL);
        windows.main_label = None;
        return Err(error.to_string());
    }
    Ok(())
}

fn explorer_window_size(action: ExplorerAction) -> (f64, f64) {
    match action {
        ExplorerAction::Commit
        | ExplorerAction::ViewChanges
        | ExplorerAction::ViewStash
        | ExplorerAction::Pull
        | ExplorerAction::Push
        | ExplorerAction::FileHistory => (1100.0, 760.0),
        ExplorerAction::CheckoutBranch
        | ExplorerAction::CheckoutRevision
        | ExplorerAction::CreateBranch
        | ExplorerAction::ApplyPatch => (760.0, 620.0),
        _ => (700.0, 560.0),
    }
}

fn explorer_window_min_size(action: ExplorerAction) -> (f64, f64) {
    match action {
        ExplorerAction::Commit
        | ExplorerAction::ViewChanges
        | ExplorerAction::Pull
        | ExplorerAction::FileHistory => (900.0, 620.0),
        _ => (560.0, 420.0),
    }
}

fn create_explorer_window(app: &AppHandle, request: LaunchRequest) -> Result<(), String> {
    let state = app.state::<LaunchState>();
    let label = {
        let mut windows = lock(&state);
        windows.next_explorer_id += 1;
        format!("action-{}", windows.next_explorer_id)
    };
    let (width, height) = explorer_window_size(request.action);
    let (min_width, min_height) = explorer_window_min_size(request.action);
    {
        let mut windows = lock(&state);
        windows.sessions.insert(
            label.clone(),
            WindowSession {
                role: WindowRole::Explorer,
                pending: vec![request.clone()],
            },
        );
    }

    let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title(format!(
            "Git Extensions · {}",
            request.action.window_title()
        ))
        .inner_size(width, height)
        .min_inner_size(min_width, min_height)
        .decorations(true)
        .visible(false)
        .build();

    match built {
        Ok(window) => {
            let _ = window.center();
            Ok(())
        }
        Err(error) => {
            lock(&state).sessions.remove(&label);
            Err(error.to_string())
        }
    }
}

#[tauri::command]
pub fn get_window_bootstrap(
    window: WebviewWindow,
    state: State<'_, LaunchState>,
) -> Result<WindowBootstrap, String> {
    let mut windows = lock(&state);
    let session = windows
        .sessions
        .get_mut(window.label())
        .ok_or_else(|| format!("window {} has no launch session", window.label()))?;
    Ok(WindowBootstrap {
        kind: session.role,
        requests: std::mem::take(&mut session.pending),
    })
}

#[tauri::command]
pub fn take_pending_launches(
    window: WebviewWindow,
    state: State<'_, LaunchState>,
) -> Vec<LaunchRequest> {
    lock(&state)
        .sessions
        .get_mut(window.label())
        .map(|session| std::mem::take(&mut session.pending))
        .unwrap_or_default()
}

#[tauri::command]
pub fn show_current_window(window: WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_repository_in_main(app: AppHandle, path: String) -> Result<(), String> {
    open_repository_from_action(&app, path)
}

#[tauri::command]
pub fn focus_main_window(app: AppHandle) {
    queue_main_request(&app, None);
}

pub fn open_repository_from_action(app: &AppHandle, path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("repository path is empty".into());
    }
    queue_main_request(
        app,
        Some(LaunchRequest {
            action: ExplorerAction::OpenRepository,
            path: Some(path.into()),
        }),
    );
    Ok(())
}

pub fn initialize(app: &AppHandle, request: Option<LaunchRequest>) {
    match request {
        Some(request) => route_request(app, request),
        None => queue_main_request(app, None),
    }
}

pub fn window_destroyed(app: &AppHandle, label: &str) {
    let state = app.state::<LaunchState>();
    let empty = {
        let mut windows = lock(&state);
        windows.sessions.remove(label);
        if windows.main_label.as_deref() == Some(label) {
            windows.main_label = None;
        }
        windows.sessions.is_empty()
    };
    if empty {
        app.exit(0);
    }
}
