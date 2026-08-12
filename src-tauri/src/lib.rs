mod backend;

use std::sync::Mutex;
use tauri::{Manager, RunEvent};

/// 프론트가 백엔드 주소를 알아내는 유일한 창구.
/// 포트를 프론트에 하드코딩하지 않는다 — 나중에 포트 충돌 회피가 필요해지면 여기만 고친다.
#[tauri::command]
fn backend_url() -> String {
    format!("http://127.0.0.1:{}", backend::backend_port())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![backend_url])
        .setup(|app| {
            match backend::spawn() {
                Ok(child) => {
                    app.manage(backend::Backend(Mutex::new(Some(child))));
                    println!("[backend] spawned on port {}", backend::backend_port());
                }
                Err(e) => {
                    // 백엔드가 안 떠도 창은 띄운다 — 프론트가 상태를 표시하고 로그를 안내한다.
                    eprintln!("[backend] spawn failed: {e}");
                    app.manage(backend::Backend(Mutex::new(None)));
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // ★사이드카는 종료 이벤트에서 명시적으로 내린다.
    //   Drop 에만 맡기면 강제 종료·process::exit 경로에서 실행되지 않아
    //   백엔드가 고아로 남는다 (v2.x 에서 "브라우저를 닫아도 서버가 남던" 문제와 같은 부류).
    app.run(|app_handle, event| match event {
        RunEvent::ExitRequested { .. } | RunEvent::Exit => {
            if let Some(state) = app_handle.try_state::<backend::Backend>() {
                state.kill();
            }
        }
        _ => {}
    });
}
