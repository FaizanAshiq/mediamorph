use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{Manager, RunEvent};

#[cfg(debug_assertions)]
mod e2e;

/// The half-written output of the conversion in progress, if any.
#[derive(Default)]
struct ActiveTemp(Mutex<Option<PathBuf>>);

#[tauri::command]
fn set_active_temp(state: tauri::State<'_, ActiveTemp>, path: Option<String>) {
    *state.0.lock().unwrap() = path.map(PathBuf::from);
}

#[tauri::command]
fn move_to_trash(path: String) -> Result<(), String> {
    trash::delete(path).map_err(|e| e.to_string())
}

/// macOS's own caffeinate, holding off idle sleep while the queue runs.
#[derive(Default)]
struct KeepAwake(Mutex<Option<std::process::Child>>);

#[tauri::command]
fn keep_awake(state: tauri::State<'_, KeepAwake>, on: bool) -> Result<(), String> {
    let mut held = state.0.lock().unwrap();
    if let Some(mut child) = held.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    if on && cfg!(target_os = "macos") {
        // -w ties it to this app, so it ends by itself if the app dies mid-queue.
        let child = std::process::Command::new("/usr/bin/caffeinate")
            .args(["-i", "-w", &std::process::id().to_string()])
            .spawn()
            .map_err(|e| e.to_string())?;
        *held = Some(child);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // First, so a second launch hands over to the open window before anything else starts.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ActiveTemp::default())
        .manage(KeepAwake::default())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_menu(mac_menu(app.handle())?)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() != "quit" {
                return;
            }
            // Closing the window goes through the page's close guard, which asks before
            // stopping a conversion. The stock Quit item would end the app without asking.
            match app.get_webview_window("main") {
                Some(window) => {
                    let _ = window.close();
                }
                None => app.exit(0),
            }
        });

    #[cfg(debug_assertions)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        set_active_temp,
        move_to_trash,
        keep_awake,
        e2e::e2e_config,
        e2e::e2e_report,
        e2e::e2e_exit
    ]);
    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![set_active_temp, move_to_trash, keep_awake]);

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Dock Quit and logout end the app without asking the page first, so delete the
            // half-written file here; the shell plugin stops ffmpeg on the same exit.
            if let RunEvent::Exit = event {
                if let Some(path) = app.state::<ActiveTemp>().0.lock().unwrap().take() {
                    let _ = std::fs::remove_file(path);
                }
            }
        });
}

#[cfg(target_os = "macos")]
fn mac_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};

    let quit = MenuItem::with_id(app, "quit", "Quit Mediamorph", true, Some("CmdOrCtrl+Q"))?;
    let app_menu = SubmenuBuilder::new(app, "Mediamorph")
        .about(None)
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&quit)
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;
    MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &window_menu])
        .build()
}
