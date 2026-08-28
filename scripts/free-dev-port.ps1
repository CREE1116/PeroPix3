# 1420 을 붙들고 있는 **우리 저장소의 고아 vite** 를 내린다 (사용자 결정 2026-08-28, dev.bat 이 부른다).
#
# ★★포트를 자동으로 옮기지 않는 까닭: Vite 의 포트와 `src-tauri/tauri.conf.json` 의 `devUrl` 이
#   **같아야** 한다 (어긋나면 창이 빈 화면으로 뜬다). 그래서 1420 은 못 박아 두고, 막고 있는 것이
#   **지난 실행이 남긴 우리 vite** 일 때만 내린다.
# ★★두 겹으로 지킨다 — (1) PeroPix 백엔드(8770·8771)가 하나라도 살아 있으면 **아무것도 안 한다**
#   (앱이 켜져 있다는 뜻이다), (2) 그 프로세스의 명령줄이 **이 저장소의 node_modules 의 vite** 일
#   때만 내린다. 남의 프로젝트나 켜져 있는 앱은 건드리지 않는다.
param([string]$Root)

$ErrorActionPreference = "SilentlyContinue"

if (Get-NetTCPConnection -LocalPort 8770, 8771 -State Listen) {
    return                                  # 앱이 돌고 있다 — 손대지 않는다
}

$pids = (Get-NetTCPConnection -LocalPort 1420 -State Listen).OwningProcess | Select-Object -Unique
foreach ($procId in $pids) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId"
    if (-not $proc) { continue }
    if ($proc.CommandLine -like "*$Root*node_modules*vite*") {
        Write-Host "[PeroPix] Freeing port 1420 (stale vite, pid $procId)"
        Stop-Process -Id $procId -Force
        Start-Sleep -Milliseconds 400
    }
    else {
        Write-Host "[PeroPix] Port 1420 is held by something else (pid $procId) - leaving it alone"
    }
}
