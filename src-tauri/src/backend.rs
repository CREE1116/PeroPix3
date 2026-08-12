//! 파이썬 백엔드를 자식 프로세스로 띄우고, 앱이 닫힐 때 함께 내린다.
//!
//! ★2025-12-30 의 Tauri 시도에서 이 부분(사이드카 spawn)은 이미 올바르게 작성돼 있었다.
//! 당시 막힌 것은 빌드 배관이었지 이 구조가 아니다. 같은 형태를 유지하되
//! 프로세스 수명 관리를 셸이 확실히 하도록 정리했다.

use std::fs::File;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

pub const DEFAULT_PORT: u16 = 8770;

/// 백엔드 포트.
///
/// ★**환경변수로 갈아 끼운다** (사용자 지시 2026-08-08). 예전엔 상수라, QA 인스턴스와
/// 사용자 앱이 같은 8770 을 다퉜다 — 나중에 켠 쪽은 사이드카를 못 띄워 창은 뜨는데
/// API 가 없는 상태(502)가 됐고, 원인이 화면에 안 나왔다.
/// `qa\host.cmd` 가 `PEROPIX_BACKEND_PORT=8771` 을 넣어 준다.
pub fn backend_port() -> u16 {
    std::env::var("PEROPIX_BACKEND_PORT")
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

/// 자식을 **Job Object 에 매단다** — 부모가 어떻게 죽든 함께 내려간다.
///
/// ★`kill()` 은 종료 이벤트에서만 돈다. `taskkill /F`·크래시·`process::exit` 에서는
/// 그 이벤트가 안 돌아 **파이썬이 고아로 남고 포트를 계속 쥔다.** 실측(2026-08-08):
/// 고아 사이드카가 8770 을 잡고 있어 새로 띄운 백엔드가 바인딩에 실패했고,
/// **옛 코드가 계속 응답해서** 고친 것이 안 먹힌 것처럼 보였다.
/// 잡의 `KILL_ON_JOB_CLOSE` 는 커널이 보장하므로 우리 코드가 안 돌아도 지켜진다.
#[cfg(windows)]
fn adopt_into_job(child: &Child) {
    use std::os::windows::io::AsRawHandle;
    use std::sync::OnceLock;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    // ★핸들을 **살려 둔다.** 닫는 순간 잡이 닫히고 멤버가 죽는다 — 프로세스가 끝날 때까지 들고 있는다.
    static JOB: OnceLock<usize> = OnceLock::new();
    let job = *JOB.get_or_init(|| unsafe {
        let h = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if h.is_null() {
            return 0;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            h,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const std::ffi::c_void,
            std::mem::size_of_val(&info) as u32,
        );
        h as usize
    });
    if job == 0 {
        eprintln!("[backend] job object 를 못 만들었습니다 — 고아 방지가 꺼집니다");
        return;
    }
    let ok = unsafe { AssignProcessToJobObject(job as HANDLE, child.as_raw_handle() as HANDLE) };
    if ok == 0 {
        eprintln!("[backend] job 에 매달지 못했습니다 — 고아 방지가 꺼집니다");
    }
}

#[cfg(not(windows))]
fn adopt_into_job(_child: &Child) {}

/// 자식 프로세스 핸들.
///
/// ★종료는 `kill()` 을 종료 이벤트에서 **명시적으로** 부르는 것이 정본이다.
/// `Drop` 은 process::exit 경로에서 실행되지 않아 백엔드가 고아로 남는다 — 실측으로 확인됨.
/// Drop 은 마지막 안전망으로만 둔다.
pub struct Backend(pub Mutex<Option<Child>>);

impl Backend {
    pub fn kill(&self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
            *guard = None;
        }
    }
}

impl Drop for Backend {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn app_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
}

/// 개발 중에는 실행 파일이 `src-tauri/target/debug` 에 있으므로 저장소 루트를 거슬러 찾는다.
fn find_repo_root() -> Option<PathBuf> {
    let mut dir = app_dir();
    for _ in 0..6 {
        if dir.join("backend").join("server.py").exists() {
            return Some(dir);
        }
        dir = dir.parent()?.to_path_buf();
    }
    None
}

/// 번들된 파이썬 → 저장소 파이썬 → PATH 의 python 순으로 찾는다.
fn find_python(root: &PathBuf) -> PathBuf {
    let bundled = root.join("python").join("python.exe");
    if bundled.exists() {
        return bundled;
    }
    PathBuf::from("python")
}

pub fn spawn() -> std::io::Result<Child> {
    let root = find_repo_root().unwrap_or_else(app_dir);
    let python = find_python(&root);
    let script = root.join("backend").join("server.py");
    let log_dir = root.join("logs");
    let _ = std::fs::create_dir_all(&log_dir);

    let out = File::create(log_dir.join("backend.log")).ok();
    let err = File::create(log_dir.join("backend.err.log")).ok();

    println!("[backend] root   = {}", root.display());
    println!("[backend] python = {}", python.display());
    println!("[backend] script = {}", script.display());

    let mut cmd = Command::new(&python);
    cmd.arg(&script)
        .arg("--port")
        .arg(backend_port().to_string())
        .current_dir(&root)
        .stdout(out.map(Stdio::from).unwrap_or_else(Stdio::null))
        .stderr(err.map(Stdio::from).unwrap_or_else(Stdio::null));

    // 콘솔 창이 따로 뜨지 않게 (Windows)
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd.spawn()?;
    adopt_into_job(&child); // ★부모가 어떻게 죽든 함께 내려가게
    Ok(child)
}
