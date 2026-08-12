// 배포 빌드에서 콘솔 창이 뜨지 않게
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    peropix_lib::run()
}
