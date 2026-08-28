//! 창 가장자리 — **커서가 바뀌는 자리와 누름이 먹는 자리를 하나로** 한다.
//!
//! ★★사용자 지적 2026-08-28: *"커서가 리사이즈 모양으로 변하는 구간이 100이면 아래 50%
//!   정도에서만 더블클릭이 먹는다."* · *"커서 판정이랑 동일하게 일치시켜야 할 듯."*
//!
//! 그 위쪽 절반의 주인을 `WindowFromPoint` 로 물어 **이름을 받았다**(실측 2026-08-28):
//!
//! ```text
//! 맨위+0  주인 = TAURI_DRAG_RESIZE_BORDERS   판정=12(HTTOP)
//! 맨위+2  주인 = TAURI_DRAG_RESIZE_BORDERS   판정=12
//! 맨위+4  주인 = Chrome_RenderWidgetHostHWND  판정=1(HTCLIENT)
//! ```
//!
//! **Tauri 가 스스로 깔아 두는 투명 덧창**이다 (`tauri-runtime-wry` 의 `undecorated_resizing.rs`).
//! `decorations:false` 이고 크기 조절이 되는 창에 붙어, 클라이언트 안쪽 가장자리 `SM_CXFRAME`
//! (배율 1 에서 4px) 너비의 띠만 남기고 가운데를 도려낸 자식창이다. 그 띠에서:
//!   · `WM_NCHITTEST` 에 `HTTOP` 등을 돌려주므로 **커서가 크기 조절 모양으로 바뀌고**,
//!   · `WM_NCLBUTTONDOWN` 을 받으면 부모에게 같은 것을 부쳐 **OS 크기 조절을 시작**한다.
//!   · 더블클릭은 아무것도 안 한다 (클래스에 `CS_DBLCLKS` 도 없다).
//! 화면(웹뷰)은 그 띠 밑에 있어 **누름을 아예 못 본다.** 그래서 우리가 그린 8px 손잡이 중
//! 위쪽 4px 은 커서만 바뀌고 더블클릭이 죽어 있었고, 거기서 시작한 끌기는 우리 손을 안 거쳐
//! 「늘린 것을 되돌리기」(`lib/window` 의 `unfitFor`)도 건너뛰었다. 같은 뿌리의 한 증상이다.
//!
//! ★★그래서 **그 덧창을 걷어낸다.** 가장자리는 화면의 손잡이 하나가 맡는다 — 커서도 누름도
//!   더블클릭도 같은 요소가 받으므로 어긋날 자리가 없다. 끌어서 크기를 바꾸는 것은 지금까지처럼
//!   `startResizeDragging` 이 OS 에 넘긴다 (화면 끝에 붙였을 때의 스냅도 그대로다).
//! ★Tauri 는 이미 있으면 다시 만들지 않는다(`attach_resize_handler` 의 `FindWindowExW` 검사) —
//!   없앤 뒤 되살아나는 길은 `set_decorations`·`set_shadow` 를 다시 부르는 것뿐인데, 이 앱은
//!   둘 다 안 부른다.
//! ★같은 프로세스·같은 스레드의 창이라 `DestroyWindow` 로 바로 없앨 수 있다.
//!
//! ~~한때 여기에 「tao 가 돌려주는 `HTTOP` 을 `HTCLIENT` 로 바꾸는 후크」가 있었다~~ — 그 판정은
//! 웹뷰 자식창이 창을 통째로 덮고 있어 부모에게 **아예 오지 않는다**(로그 0회). 죽은 코드라 걷었다.

/// Tauri 의 크기 조절 덧창을 없앤다. 있었으면 `true`.
#[cfg(windows)]
pub fn drop_tauri_resize_overlay(hwnd: *mut core::ffi::c_void) -> bool {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{DestroyWindow, FindWindowExW};

    // 이름은 `tauri-runtime-wry/src/undecorated_resizing.rs` 의 상수 그대로다
    let class: Vec<u16> = "TAURI_DRAG_RESIZE_BORDERS\0".encode_utf16().collect();
    let name: Vec<u16> = "TAURI_DRAG_RESIZE_WINDOW\0".encode_utf16().collect();
    unsafe {
        let child = FindWindowExW(hwnd as HWND, std::ptr::null_mut(), class.as_ptr(), name.as_ptr());
        if child.is_null() {
            return false;
        }
        DestroyWindow(child) != 0
    }
}

#[cfg(not(windows))]
pub fn drop_tauri_resize_overlay(_hwnd: *mut core::ffi::c_void) -> bool {
    false
}
