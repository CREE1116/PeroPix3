//! 쌓아 둔 새 판을 **제자리에 놓고 다시 켠다** (사용자 지시 2026-08-26).
//!
//! ★★받는 것은 백엔드가 한다 (`backend/update.py`) — 여기 오는 순간 `.update/new/` 에는
//!   **앱 폴더와 같은 배치**로 새 파일이 놓여 있다. 그래서 이 코드는 무엇을 지킬지를
//!   따로 셈하지 않는다: **거기 없는 것은 안 건드리므로** `workspaces/`·`data/`·`gallery/`·
//!   `webview/` 는 손대지 않고 그대로 남는다.
//!
//! ★★**돌고 있는 exe 는 지울 수 없지만 이름은 바꿀 수 있다** — 윈도우의 오래된 성질이고,
//!   자기 자신을 갈아 끼우는 프로그램이 전부 쓰는 방법이다. 그래서 「지우고 쓰기」가 아니라
//!   **「비켜 놓고 놓기」**다: 옛것을 `.update/old/` 로 옮기고 새것을 제자리에 놓는다.
//!   옛것은 다음에 켤 때 지운다 (`sweep`) — 지금은 아직 우리가 그 위에서 돌고 있다.
//!
//! ★파이썬(사이드카)을 **먼저 내린다.** 안 그러면 `python/` 안의 파일이 잡혀 있어 못 옮긴다.

use std::path::{Path, PathBuf};

pub const STAGE: &str = ".update";

fn stage_dir(root: &Path) -> PathBuf {
    root.join(STAGE)
}

/// 지난번 업데이트가 남긴 옛 파일을 치운다. **켤 때 한 번**, 조용히.
///
/// ★그때는 못 지웠다 — 우리가 그 exe 위에서 돌고 있었기 때문이다. 지금은 새것으로 떠 있다.
/// ★실패해도 아무 말 안 한다. 다음에 또 해 보면 된다 (남아 있어도 앱은 멀쩡히 돈다).
pub fn sweep(root: &Path) {
    let _ = std::fs::remove_dir_all(stage_dir(root).join("old"));
    // 받아 둔 것을 다 옮겼으면 빈 껍데기만 남는다 — 비어 있을 때만 지운다
    let _ = std::fs::remove_dir(stage_dir(root).join("new"));
    let _ = std::fs::remove_dir(stage_dir(root));
}

/// 쌓아 둔 것이 있나 — 화면이 「지금 다시 켜기」를 낼지 정하는 근거.
pub fn staged(root: &Path) -> bool {
    stage_dir(root)
        .join("new")
        .read_dir()
        .map(|mut d| d.next().is_some())
        .unwrap_or(false)
}

/// `.update/new/` 의 것들을 제자리로 옮긴다.
///
/// ★한 항목이라도 실패하면 **거기서 멈춘다.** 이미 옮긴 것은 그대로 두는데, 그래도
///   반쯤 갈린 상태가 아니다 — 옛것은 `.update/old/` 에 온전히 있고, 다음 실행에서
///   같은 자리를 다시 시도한다. (되돌리기를 여기서 흉내 내면 그 코드가 더 위험하다.)
pub fn apply(root: &Path) -> std::io::Result<()> {
    let new = stage_dir(root).join("new");
    let old = stage_dir(root).join("old");
    std::fs::create_dir_all(&old)?;

    for e in std::fs::read_dir(&new)? {
        let e = e?;
        let name = e.file_name();
        let target = root.join(&name);
        if target.exists() {
            let park = old.join(&name);
            let _ = std::fs::remove_dir_all(&park);
            let _ = std::fs::remove_file(&park);
            // ★★**이름 바꾸기**다 (복사가 아니다) — 돌고 있는 exe 도 이건 된다
            std::fs::rename(&target, &park)?;
        }
        std::fs::rename(e.path(), &target)?;
    }
    let _ = std::fs::remove_dir(&new);
    Ok(())
}

/// 새 exe 를 띄운다. ★부모가 죽어도 살아 있어야 하므로 **잡에 매달지 않는다**
/// (사이드카와 정반대다 — 그쪽은 함께 죽어야 하고 이쪽은 살아남아야 한다).
/// 새 판을 띄우기 **직전에 디스크를 데운다** (사용자 결정 2026-08-27).
///
/// ★★**왜 필요한가 — 실측.** 패치 직후 첫 실행에서 파이썬이 제 임포트를 끝내는 데만
///   **16.6초**가 걸렸고(로그 `[boot]` 줄과 `[start]` 시각 대조), 그 다음 실행은 0.9초였다.
///   앱 옆의 `python/` 은 **파일 5,317개 · 202MB** 인데, 업데이트가 132MB 를 받아 350MB 를
///   풀면서 OS 파일 캐시가 통째로 밀려난다. 그러면 다음 실행이 그 5천 개를 회전 디스크에서
///   **흩어진 채** 다시 읽는다. 여기서 **순서대로 한 번 훑어** 캐시에 올려 두면, 그 읽기가
///   차례 읽기 한 번으로 바뀌고 값은 「설치 중」 화면 안에서 치러진다.
///
/// ★★**위험을 셋 다 막는다** (사용자 조건: *"별다른 위험성이 없으면"*):
///   1. **읽기만 한다.** 열고, 버리는 버퍼에 담고, 닫는다 — 쓰지도 지우지도 옮기지도 않는다.
///   2. **실패를 전부 삼킨다.** 못 읽는 파일 하나 때문에 업데이트가 멈추면 안 된다.
///   3. **시간 상한이 있다.** 디스크가 병든 경우에도 여기서 오래 붙들려 있지 않는다 —
///      상한을 넘으면 그냥 그만두고 다음으로 간다 (덜 데워졌을 뿐, 결과는 같다).
pub fn warm(paths: &[PathBuf], budget: std::time::Duration) -> (usize, u64) {
    let t0 = std::time::Instant::now();
    let mut buf = vec![0u8; 256 * 1024];
    let mut files = 0usize;
    let mut bytes = 0u64;
    let mut stack: Vec<PathBuf> = paths.to_vec();
    while let Some(p) = stack.pop() {
        if t0.elapsed() >= budget {
            break;
        }
        if p.is_dir() {
            if let Ok(rd) = std::fs::read_dir(&p) {
                for e in rd.flatten() {
                    stack.push(e.path());
                }
            }
            continue;
        }
        if let Ok(mut f) = std::fs::File::open(&p) {
            use std::io::Read;
            files += 1;
            loop {
                match f.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => bytes += n as u64,
                }
                if t0.elapsed() >= budget {
                    break;
                }
            }
        }
    }
    (files, bytes)
}

/// 데울 자리 — ★**부팅에 실제로 읽히는 것만**이다. 검열 모델(38MB)은 쓸 때 비로소
/// 읽히므로 넣지 않는다: 안 쓸 사람에게 그 시간을 물릴 이유가 없다.
pub fn warm_targets(root: &Path) -> Vec<PathBuf> {
    vec![root.join("python"), root.join("backend"), root.join("PeroPix.exe")]
}

pub fn relaunch(root: &Path) -> std::io::Result<()> {
    // ★★**이름을 박지 않는다** — 꾸러미에 담기는 이름은 `PeroPix.exe` 이고 빌드가 내는
    //   이름은 `peropix.exe` 다 (`scripts/portable.ps1` 이 바꿔 담는다). 지금 돌고 있는
    //   그 이름을 그대로 쓰면 어느 쪽이든 맞는다. (윈도우는 대소문자를 안 가리지만,
    //   이름이 또 바뀔 자리라 여기서 못 박지 않는다.)
    let name = std::env::current_exe()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_os_string()))
        .unwrap_or_else(|| "PeroPix.exe".into());
    let exe = root.join(name);
    let mut cmd = std::process::Command::new(exe);
    cmd.current_dir(root);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    cmd.spawn().map(|_| ())
}

#[cfg(test)]
mod warm_tests {
    use super::warm;
    use std::path::PathBuf;
    use std::time::Duration;

    /// 임시 자리에 작은 파일 몇 개를 만든다 (하위 폴더 포함)
    fn fixture(name: &str, n: usize) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("peropix-warm-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("안쪽")).unwrap();
        for i in 0..n {
            std::fs::write(dir.join(format!("a{i}.bin")), vec![7u8; 4096]).unwrap();
            std::fs::write(dir.join("안쪽").join(format!("b{i}.bin")), vec![7u8; 4096]).unwrap();
        }
        dir
    }

    #[test]
    fn 하위_폴더까지_읽는다() {
        let dir = fixture("all", 3);
        let (files, bytes) = warm(&[dir.clone()], Duration::from_secs(30));
        assert_eq!(files, 6, "위 3 + 안쪽 3");
        assert_eq!(bytes, 6 * 4096);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// ★상한이 실제로 멈추는가 — 병든 디스크에서 업데이트가 붙들리지 않게 하는 장치다
    #[test]
    fn 시간_상한에서_그만둔다() {
        let dir = fixture("budget", 50);
        let (files, _) = warm(&[dir.clone()], Duration::from_secs(0));
        assert_eq!(files, 0, "상한이 0이면 한 개도 안 읽는다");
        let _ = std::fs::remove_dir_all(dir);
    }

    /// ★없는 자리를 줘도 조용히 넘어간다 (읽기 실패를 삼키는지)
    #[test]
    fn 없는_자리는_조용히_넘어간다() {
        let (files, bytes) = warm(&[PathBuf::from("Z:/없는/자리")], Duration::from_secs(5));
        assert_eq!((files, bytes), (0, 0));
    }

    /// ★★**아무것도 안 바꾼다** — 읽기만 하는지 파일 내용과 목록으로 확인한다
    #[test]
    fn 읽기만_한다() {
        let dir = fixture("readonly", 2);
        let before: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.path()).collect();
        warm(&[dir.clone()], Duration::from_secs(30));
        let after: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.path()).collect();
        assert_eq!(before.len(), after.len(), "파일 수가 바뀌면 안 된다");
        assert_eq!(std::fs::read(dir.join("a0.bin")).unwrap(), vec![7u8; 4096], "내용이 바뀌면 안 된다");
        let _ = std::fs::remove_dir_all(dir);
    }
}
