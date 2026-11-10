// 始终使用 GUI 子系统：Explorer 每次从右键菜单启动都会新起一个进程，
// 控制台子系统会先闪一个黑色命令行窗口。dev.bat / cargo 启动时再挂回
// 父进程控制台，日志仍然可见（见 attach_parent_console）。
#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    #[cfg(all(windows, debug_assertions))]
    attach_parent_console();
    if let Some(result) = git_extensions_lib::git::rebase::internal_editor_entry() {
        if let Err(error) = result {
            eprintln!("internal Git editor failed: {error}");
            std::process::exit(1);
        }
        return;
    }
    let launch_request = match git_extensions_lib::launch::parse_process_launch_request() {
        Ok(request) => request,
        Err(error) => {
            eprintln!("invalid Explorer launch arguments: {error}");
            std::process::exit(2);
        }
    };
    git_extensions_lib::run(launch_request)
}

/// 调试构建保留控制台日志：若由终端（dev.bat、cargo、tauri dev）启动，
/// 则挂到父进程控制台并恢复 stdout / stderr 句柄；由 Explorer 启动时父进程
/// 没有控制台，这里什么也不做，因此不会弹出命令行窗口。发布构建不需要
/// 输出，直接跳过，避免从终端启动时把生命周期绑到控制台上。
#[cfg(all(windows, debug_assertions))]
fn attach_parent_console() {
    use std::ffi::c_void;
    use std::ptr;

    type Handle = *mut c_void;

    const ATTACH_PARENT_PROCESS: u32 = u32::MAX;
    const GENERIC_READ: u32 = 0x8000_0000;
    const GENERIC_WRITE: u32 = 0x4000_0000;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const OPEN_EXISTING: u32 = 3;
    const STD_OUTPUT_HANDLE: u32 = u32::MAX - 10; // -11
    const STD_ERROR_HANDLE: u32 = u32::MAX - 11; // -12
    const INVALID_HANDLE_VALUE: Handle = -1isize as Handle;

    #[link(name = "kernel32")]
    extern "system" {
        fn AttachConsole(process_id: u32) -> i32;
        fn CreateFileW(
            file_name: *const u16,
            desired_access: u32,
            share_mode: u32,
            security_attributes: *const c_void,
            creation_disposition: u32,
            flags_and_attributes: u32,
            template_file: Handle,
        ) -> Handle;
        fn GetStdHandle(std_handle: u32) -> Handle;
        fn SetStdHandle(std_handle: u32, handle: Handle) -> i32;
    }

    let invalid = |handle: Handle| handle.is_null() || handle == INVALID_HANDLE_VALUE;

    unsafe {
        // 终端 / 父进程已经提供标准句柄（含管道重定向）时保持原样，
        // 避免覆盖 dev.bat / tauri dev 收集的输出。
        let output = GetStdHandle(STD_OUTPUT_HANDLE);
        let error = GetStdHandle(STD_ERROR_HANDLE);
        if !invalid(output) && !invalid(error) {
            return;
        }
        // 已经连接控制台时 AttachConsole 会失败，但下面打开 CONOUT$ 仍成功，
        // 所以不因它的返回值提前退出。
        let _ = AttachConsole(ATTACH_PARENT_PROCESS);
        let name: Vec<u16> = "CONOUT$\0".encode_utf16().collect();
        let handle = CreateFileW(
            name.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            ptr::null(),
            OPEN_EXISTING,
            0,
            ptr::null_mut(),
        );
        if invalid(handle) {
            return;
        }
        if invalid(output) {
            SetStdHandle(STD_OUTPUT_HANDLE, handle);
        }
        if invalid(error) {
            SetStdHandle(STD_ERROR_HANDLE, handle);
        }
    }
}
