mod backend;
mod update;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

/// 프론트가 백엔드 주소를 알아내는 유일한 창구.
/// 포트를 프론트에 하드코딩하지 않는다 — 포트는 이제 인스턴스마다 다르다(`backend_port`).
#[tauri::command]
fn backend_url() -> String {
    format!("http://127.0.0.1:{}", backend::backend_port())
}

/// 이 앱이 서 있는 자리. ★화면이 **「지금 붙은 백엔드가 내 것인가」**를 묻는 데 쓴다 —
/// 백엔드도 같은 값을 알려 주므로(`/api/health` 의 `root`), 둘이 다르면 남의 것에 붙은 것이다.
#[tauri::command]
fn app_root() -> String {
    backend::root().to_string_lossy().to_string()
}

/// 쌓아 둔 새 판이 있나 — 화면이 「지금 다시 켜기」를 낼지 정하는 근거.
#[tauri::command]
fn update_staged() -> bool {
    update::staged(&backend::root())
}

/// **갈아 끼우고 다시 켠다** (사용자 지시 2026-08-26).
///
/// ★★차례가 곧 안전이다: **사이드카를 먼저 내린다** → 파일을 옮긴다 → 새 exe 를 띄운다 →
///   우리는 나간다. 파이썬이 살아 있으면 `python/` 안의 파일이 잡혀 있어 못 옮긴다.
/// ★옮기다 실패하면 **그 자리에서 멈추고 그대로 둔다** — 옛것은 `.update/old/` 에 온전히
///   있고, 다음에 켤 때 같은 자리를 다시 시도한다 (`update.rs` 머리 주석).
#[tauri::command]
fn apply_update(app: tauri::AppHandle) -> Result<(), String> {
    let root = backend::root();
    if let Some(state) = app.try_state::<backend::Backend>() {
        state.kill();
    }
    update::apply(&root).map_err(|e| format!("갈아 끼우지 못했습니다: {e}"))?;
    update::relaunch(&root).map_err(|e| format!("다시 켜지 못했습니다: {e}"))?;
    app.exit(0);
    Ok(())
}

/// 웹뷰(WebView2)의 저장소를 **앱 폴더 안**으로 끌어온다 (사용자 지적 2026-08-26).
///
/// ★★기본 자리는 `%LOCALAPPDATA%\<앱 식별자>\EBWebView` 이고, 그 이름이 **설치 경로가 아니라
///   앱 식별자**라 포터블 두 벌이 **같은 저장소를 함께 쓴다.** 거기 든 것이 가볍지 않다 —
///   생성 파라미터(`store/gen`)·검열 설정(`store/censor`)·엔진 선택(`store/cli`)·언어가
///   전부 localStorage 다. 한쪽에서 모델을 바꾸면 다른 쪽도 바뀐다.
/// ★자리를 옮기면 **앱을 지웠을 때 밖에 아무것도 안 남는다** — 포터블의 본뜻에 맞다.
/// ★WebView2 로더가 읽는 환경변수로 지정한다. **웹뷰가 만들어지기 전에** 놓아야 한다.
fn use_local_webview_profile() {
    let dir = backend::root().join("webview");
    if std::fs::create_dir_all(&dir).is_err() {
        return; // 못 만들면 기본 자리로 둔다 — 저장소 때문에 앱이 안 뜨면 안 된다
    }
    migrate_webview_profile(&dir);
    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &dir);
}

/// 옛 자리(`%LOCALAPPDATA%`)의 설정을 **한 번만** 옮겨 온다.
///
/// ★자리를 옮기는 순간 그동안 쓰던 설정이 초기화된 것처럼 보이는데, 사용자에게는 아무 일도
///   안 일어난 것처럼 보여야 한다.
/// ★**설정만** 데려온다 (`Local Storage`·`IndexedDB`). 캐시·쿠키는 다시 만들어지는 것이라
///   옮길 이유가 없고, 통째로 복사하면 수백 MB 가 든다.
/// ★실패해도 조용히 넘어간다 — 못 옮기면 설정이 기본값으로 시작할 뿐이다.
fn migrate_webview_profile(dir: &Path) {
    if dir.join("EBWebView").exists() {
        return; // 이미 이 자리에서 돌고 있다
    }
    let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) else {
        return;
    };
    let old = local.join("com.peropix.app").join("EBWebView").join("Default");
    if !old.exists() {
        return;
    }
    let to = dir.join("EBWebView").join("Default");
    for name in ["Local Storage", "IndexedDB"] {
        let _ = copy_tree(&old.join(name), &to.join(name));
    }
    println!("[webview] 옛 저장소에서 설정을 옮겨 왔습니다: {}", old.display());
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    if !from.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(to)?;
    for e in std::fs::read_dir(from)? {
        let e = e?;
        let (src, dst) = (e.path(), to.join(e.file_name()));
        if e.file_type()?.is_dir() {
            copy_tree(&src, &dst)?;
        } else {
            std::fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    /* ★★**같은 폴더를 두 번 열지 않는다** (사용자 지시 2026-08-26). 같은 `workspaces/` 를
         두 창이 만지면 나중에 저장하는 쪽이 상대의 편집을 덮는다. 다른 폴더의 두 벌은
         그대로 허용한다 — 포터블은 그러라고 있는 형식이다 (`backend::lock_app_dir` 의 ★주). */
    let Some(lock) = backend::lock_app_dir() else {
        eprintln!("[app] 이 폴더의 PeroPix 가 이미 실행 중입니다 — 창을 안 띄웁니다");
        return;
    };
    // ★자물쇠는 앱이 끝날 때까지 들고 있어야 한다 (핸들을 닫으면 풀린다)
    let _lock = lock;
    // ★웹뷰가 만들어지기 전에 저장소 자리를 정한다 (아래 ★주)
    use_local_webview_profile();
    // ★지난 업데이트가 남긴 옛 파일을 치운다 — 그때는 우리가 그 exe 위에서 돌고 있었다
    update::sweep(&backend::root());

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![backend_url, app_root, update_staged, apply_update])
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
