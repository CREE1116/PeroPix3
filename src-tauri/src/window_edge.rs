//! 창 가장자리 판정을 **화면(웹뷰)에 넘긴다.**
//!
//! ★★사용자 지적 2026-08-28: *"판정이 보이는 거랑 다름. 커서가 바뀐 곳에서 눌렀는데 안
//!   되어서 약간 내려서 누르니까 됨."* · *"커서 판정이랑 동일하게 일치시켜야 할 듯."*
//!
//! 까닭은 **테두리가 둘이었기 때문**이다. 우리가 화면에 그린 8px 손잡이 위에, 창 라이브러리
//! (tao)가 붙여 둔 **OS 테두리**가 한 겹 더 덮여 있었다 — 테두리 없는 창(`decorations: false`)
//! 이면서 크기 조절이 되고 최대화가 아닐 때, tao 는 `WM_NCHITTEST` 에 `HTTOP`·`HTLEFT` 를
//! 돌려준다 (`SM_CXFRAME`·`SM_CYFRAME`, 화면 배율에 따라 4~8px).
//!
//! 그 자리는 **비클라이언트 영역**이라
//!   · 커서는 OS 가 ↕ 로 바꿔 주고,
//!   · 누름은 웹뷰에 아예 오지 않는다.
//! 그래서 「커서가 바뀐 자리를 눌렀는데 아무 일도 안 나고, 조금 아래를 누르면 된다」가 됐다.
//! 눈에 보이는 것과 먹히는 것이 어긋난 것이 아니라 **주인이 둘**이었던 것이다.
//!
//! 그래서 가장자리 판정을 **HTCLIENT 로 되돌려** 웹뷰에 넘긴다. 그러면 커서도 판정도 우리
//! 손잡이 하나가 정한다 — 어긋날 자리가 없다. 끌어서 크기를 바꾸는 것은 그대로 OS 가 한다
//! (`startResizeDragging` 이 `WM_NCLBUTTONDOWN` 을 대신 보낸다), 그래서 가장자리를 화면 끝에
//! 붙였을 때의 스냅도 살아 있다.
//!
//! ★최대화 상태에서는 tao 가 애초에 판정을 안 하므로 여기도 지나간다.

/// `WM_NCHITTEST` 가 가장자리로 나오면 **본문**으로 바꾼다 (위 모듈 주석).
#[cfg(windows)]
pub fn client_edges(hwnd: *mut core::ffi::c_void) {
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        HTBOTTOM, HTBOTTOMLEFT, HTBOTTOMRIGHT, HTCLIENT, HTLEFT, HTRIGHT, HTTOP, HTTOPLEFT,
        HTTOPRIGHT, WM_NCHITTEST,
    };

    unsafe extern "system" fn hook(
        hwnd: HWND,
        msg: u32,
        wp: WPARAM,
        lp: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        // ★먼저 tao 에게 묻는다 — 그 답이 가장자리일 때만 바꾼다
        let r = unsafe { DefSubclassProc(hwnd, msg, wp, lp) };
        if msg == WM_NCHITTEST {
            let hit = r as i32;
            /* ★진단 — **처음 한 번** 원래 답을 그대로 남긴다 (사용자 지적 2026-08-28).
               「설치 = 성공」인데 바꾼 줄이 없으면 갈래가 둘이다: 후크가 아예 안 불렸거나,
               불렸는데 tao 가 가장자리라고 답하지 않거나. 이 줄 하나가 그것을 가른다.
               ★값: 1=본문 · 2=제목줄 · 12=위 · 15=아래 · 10=왼쪽 · 11=오른쪽 (HT*). */
            {
                use std::sync::atomic::{AtomicBool, Ordering};
                static SAID: AtomicBool = AtomicBool::new(false);
                if !SAID.swap(true, Ordering::Relaxed) {
                    crate::backend::log_line(&format!(
                        "[edge] 첫 판정이 왔다 — tao 의 답 = {hit} (1=본문 · 12=위 · 15=아래)"
                    ));
                }
            }
            let edge = hit == HTTOP as i32
                || hit == HTBOTTOM as i32
                || hit == HTLEFT as i32
                || hit == HTRIGHT as i32
                || hit == HTTOPLEFT as i32
                || hit == HTTOPRIGHT as i32
                || hit == HTBOTTOMLEFT as i32
                || hit == HTBOTTOMRIGHT as i32;
            if edge {
                // ★처음 한 번만 알린다 — 마우스를 움직일 때마다 오므로 흘려 쓰면 로그가 덮인다
                use std::sync::atomic::{AtomicBool, Ordering};
                static SAID: AtomicBool = AtomicBool::new(false);
                if !SAID.swap(true, Ordering::Relaxed) {
                    crate::backend::log_line("[edge] 가장자리 판정을 화면에 넘겼다 (처음 한 번만 알린다)");
                }
                return HTCLIENT as LRESULT;
            }
        }
        r
    }

    // ★두 번 걸어도 같은 id 면 갈아 끼워질 뿐이라 안전하다
    let ok = unsafe { SetWindowSubclass(hwnd as HWND, Some(hook), 1, 0) };
    /* ★진단 — 걸렸는지, 실제로 바꾸고 있는지를 로그로 남긴다 (사용자 지적 2026-08-28:
       *"커서가 리사이즈 모양으로 변하는 구간이 100이면 아래 50%에서만 더블클릭이 먹는다"*
       = OS 테두리가 위쪽을 아직 쥐고 있다는 뜻이다). 원인이 잡히면 걷는다. */
    crate::backend::log_line(&format!(
        "[edge] 가장자리 판정 넘기기 설치 = {}",
        if ok != 0 { "성공" } else { "실패" }
    ));
}

#[cfg(not(windows))]
pub fn client_edges(_hwnd: *mut core::ffi::c_void) {}
