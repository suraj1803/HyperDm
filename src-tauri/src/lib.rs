pub mod commands;
pub mod engine;

use std::sync::Arc;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

use crate::engine::bridge::start_bridge_server;
use crate::engine::manager::DownloadManager;
use crate::engine::models::DownloadTaskInfo;

fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("hyperdm"));

            let app_handle = app.handle().clone();
            let emitter = Arc::new(move |task: DownloadTaskInfo| {
                let _ = app_handle.emit("download:progress", &task);
            });

            let manager = DownloadManager::new(&data_dir, emitter)
                .expect("Failed to initialize HyperDM download manager");

            let bridge_port = manager.get_settings().bridge_port;
            let bridge_manager = manager.clone();
            let browser_handle = app.handle().clone();
            let yt_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let on_browser = Arc::new(move |task: DownloadTaskInfo| {
                    let _ = browser_handle.emit("download:from-browser", &task);
                    show_main_window(&browser_handle);
                });
                let on_youtube = Arc::new(move |url: String| {
                    let _ = yt_handle.emit("youtube:open-url", &url);
                    show_main_window(&yt_handle);
                });
                if let Err(e) =
                    start_bridge_server(bridge_port, bridge_manager, on_browser, on_youtube).await
                {
                    eprintln!(
                        "HyperDM browser bridge failed to bind on 127.0.0.1:{}: {}",
                        bridge_port, e
                    );
                }
            });

            app.manage(manager);

            // Build System Tray icon & menu
            let show_item = MenuItem::with_id(app, "show", "Show HyperDM", true, None::<&str>)?;
            let pause_all_item =
                MenuItem::with_id(app, "pause_all", "Pause All Downloads", true, None::<&str>)?;
            let resume_all_item =
                MenuItem::with_id(app, "resume_all", "Resume All Downloads", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit HyperDM", true, None::<&str>)?;

            let tray_menu = Menu::with_items(
                app,
                &[
                    &show_item,
                    &pause_all_item,
                    &resume_all_item,
                    &separator,
                    &quit_item,
                ],
            )?;

            let mut tray_builder = TrayIconBuilder::with_id("hyperdm-tray")
                .menu(&tray_menu)
                .tooltip("HyperDM — High-Speed Download Manager")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "pause_all" => {
                        let mgr = app.state::<DownloadManager>();
                        mgr.pause_all();
                    }
                    "resume_all" => {
                        let mgr = app.state::<DownloadManager>().inner().clone();
                        tauri::async_runtime::spawn(async move {
                            mgr.resume_all().await;
                        });
                    }
                    "quit" => {
                        let mgr = app.state::<DownloadManager>();
                        mgr.pause_all();
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }

            let _ = tray_builder.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    let mgr = window.app_handle().state::<DownloadManager>();
                    if mgr.get_settings().minimize_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::probe_url,
            commands::probe_youtube,
            commands::get_media_tools_status,
            commands::install_ytdlp,
            commands::install_ffmpeg,
            commands::add_download,
            commands::list_downloads,
            commands::pause_download,
            commands::resume_download,
            commands::cancel_download,
            commands::remove_download,
            commands::get_settings,
            commands::update_settings,
            commands::open_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running HyperDM");
}
