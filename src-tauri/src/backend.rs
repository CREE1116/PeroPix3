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

/// 백엔드 포트 — **한 번 정하고 그대로 쓴다** (`OnceLock`).
///
/// ★**환경변수로 갈아 끼운다** (사용자 지시 2026-08-08). 예전엔 상수라, QA 인스턴스와
/// 사용자 앱이 같은 8770 을 다퉜다 — 나중에 켠 쪽은 사이드카를 못 띄워 창은 뜨는데
/// API 가 없는 상태(502)가 됐고, 원인이 화면에 안 나왔다.
/// `qa\host.cmd` 가 `PEROPIX_BACKEND_PORT=8771` 을 넣어 준다.
///
/// ★★**비어 있는 포트를 스스로 찾는다** (사용자 지시 2026-08-26, 포터블 배포 준비).
///   포터블은 **여러 벌을 다른 폴더에 풀어 두고 함께 쓰는** 형식이라, 번호를 하나로 박아
///   두면 나중에 켠 쪽이 남의 백엔드에 붙는다 — 창은 이쪽인데 데이터는 저쪽이 된다.
///   ★그래도 **8770 이 비어 있으면 그것을 쓴다** — 로그·문서·MCP 설정에 익숙한 번호가
///     유지되는 편이 낫고, 혼자 켤 때가 대부분이다.
///   ★잡았다 놓는 사이에 남이 채 갈 수는 있다. 그때는 사이드카가 못 떠서 **눈에 보이게**
///     실패한다 (조용히 남의 것에 붙는 지금보다 낫다).
/// ★★**CSP 도 함께 열어 두어야 한다** (`tauri.conf.json` 의 `app.security.csp`).
///   거기 포트를 번호로 박아 두면(예전에는 `127.0.0.1:8770`), 다른 포트로 뜬 인스턴스는
///   웹뷰가 **제 백엔드를 막아** 창만 뜨고 아무것도 못 한다. 그래서 `127.0.0.1:*` 이다.
///   ★그 설정 파일에는 주석을 못 단다 (스키마가 모르는 열쇠를 거부한다) — 그래서 여기 적는다.
/// 이번 실행의 **열쇠** — 주소 앞머리(`/k/<열쇠>`)로 실려 나간다.
///
/// ★★**왜 있나** (2026-08-26, 첫 공개 배포 점검에서 잡았다): 백엔드는 `127.0.0.1` 에만
///   붙지만 **브라우저는 로컬 주소로도 요청을 보낸다.** 포트가 8770 으로 거의 고정이라,
///   앱을 켜 둔 채 아무 사이트나 열려 있으면 그 사이트가 우리 API 를 그대로 부를 수 있었다
///   (실측: `Origin: https://evil.example` 로 프리플라이트를 던지니 `allow-origin: *` 이
///   돌아왔다). 그 API 에는 **임의의 실행 파일을 띄우는 길**(`/api/cli/run` 의 `exe`),
///   생성(돈), 워크스페이스 버리기, 폴더 경로 흘리기가 다 들어 있다.
/// ★★막는 방식은 **주소 앞머리**다. 화면이 쓰는 주소는 전부 이 값(`backend_url`)에
///   경로를 이어 붙여 만들어지므로(`lib/backend.ts`·`lib/imgUrl.ts`·소켓), 앞머리 하나로
///   **`<img>` 도 웹소켓도 함께 덮인다.** 헤더로 하면 그 둘이 헤더를 못 실어 새어 나간다.
/// ★웹페이지는 이 값을 알 길이 없다 — 껍데기가 만들고 화면에만 알려 준다.
///
/// ★**개발 중에는 안 건다** (`PEROPIX_DEV_RELOAD` — `dev.bat`·`qa\host.cmd` 만 넣는다).
///   그래야 브라우저로 `localhost:1420` 을 열어 사이드카에 붙이는 확인 방법이 그대로 산다
///   (`CLAUDE.md` 의 「확인 방법」). 배포되는 앱은 그 값을 넣지 않으므로 언제나 잠긴다.
pub fn backend_key() -> &'static str {
    use std::sync::OnceLock;
    static KEY: OnceLock<String> = OnceLock::new();
    KEY.get_or_init(|| {
        if std::env::var("PEROPIX_DEV_RELOAD").is_ok() {
            return String::new();
        }
        // ★새 크레이트를 안 들인다 — `RandomState` 의 씨앗은 OS 난수다(표준 문서).
        //   맞히는 쪽이 얻는 것은 403 뿐이라 되풀이 시도로 좁혀 갈 실마리도 없다.
        use std::collections::hash_map::RandomState;
        use std::hash::{BuildHasher, Hasher};
        let mut s = String::with_capacity(32);
        while s.len() < 32 {
            let mut h = RandomState::new().build_hasher();
            h.write_usize(s.len());
            s.push_str(&format!("{:016x}", h.finish()));
        }
        s
    })
}

pub fn backend_port() -> u16 {
    use std::sync::OnceLock;
    static PORT: OnceLock<u16> = OnceLock::new();
    *PORT.get_or_init(|| {
        if let Some(p) = std::env::var("PEROPIX_BACKEND_PORT")
            .ok()
            .and_then(|s| s.trim().parse::<u16>().ok())
        {
            return p;
        }
        let free = |port: u16| {
            std::net::TcpListener::bind(("127.0.0.1", port))
                .and_then(|l| l.local_addr())
                .map(|a| a.port())
                .ok()
        };
        free(DEFAULT_PORT).or_else(|| free(0)).unwrap_or(DEFAULT_PORT)
    })
}

/// 이 앱이 서 있는 자리 — `backend/server.py` 를 품은 폴더다.
///
/// ★★**데이터도 여기 쌓인다** (`server.py` 의 `APP_DIR`): `data/`·`workspaces/`·`gallery/`.
///   그래서 이 값이 곧 **인스턴스의 신원**이다 — 웹뷰 저장소를 가르는 것도, 같은 폴더를
///   두 번 열지 못하게 막는 것도, 화면이 「내 백엔드가 맞나」를 묻는 것도 이 값으로 한다.
pub fn root() -> PathBuf {
    find_repo_root().unwrap_or_else(app_dir)
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

/// **같은 폴더를 두 번 열지 못하게** 잡아 두는 표식 (사용자 지시 2026-08-26).
///
/// ★★포터블은 **여러 벌을 다른 폴더에 두고 함께 쓰는** 형식이라, 「앱을 두 번 켜지 마라」는
///   전역 잠금은 오히려 방해다 (안정판 옆에 시험판을 두는 것을 막는다). 막아야 하는 것은
///   **같은 창고를 두 창이 만지는 것**뿐이다 — `workspaces/`·`data/` 가 곧 그 창고다.
/// ★파일을 **공유 없이** 연다. 잡혀 있으면 열리지 않으므로 그것이 곧 「누가 쓰는 중」이다.
///   ★핸들을 살려 둔다 — 닫으면 잠금이 풀린다. 프로세스가 죽으면 커널이 알아서 놓아 준다
///     (크래시·강제 종료에도 자물쇠가 남지 않는다).
#[cfg(windows)]
pub fn lock_app_dir() -> Option<File> {
    use std::os::windows::fs::OpenOptionsExt;
    std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .share_mode(0) // 아무에게도 안 빌려준다
        .open(root().join(".instance.lock"))
        .ok()
}

#[cfg(not(windows))]
pub fn lock_app_dir() -> Option<File> {
    File::create(root().join(".instance.lock")).ok()
}

pub fn spawn() -> std::io::Result<Child> {
    let root = root();
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
        // ★열쇠는 **환경변수로만** 넘긴다 — 명령줄에 실으면 작업 관리자에서 그대로 보인다
        .env("PEROPIX_KEY", backend_key())
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
