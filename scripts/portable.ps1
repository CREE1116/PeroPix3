# PeroPix 3.0 — 포터블 한 벌을 조립한다 (사용자 결정 2026-08-26).
#
# ★★**설치본을 안 만든다.** 이 앱은 데이터가 **앱 폴더 옆**에 쌓이는 구조라
#   (`backend/server.py` 의 `APP_DIR`), 설치 자리가 곧 창고 자리가 된다.
#   MSI 는 Program Files 라 아예 못 쓰고, NSIS 는 %LOCALAPPDATA% 안이라 그림을 꺼내 보기
#   나쁘며, 언인스톨러가 설치 폴더를 통째로 지운다 — 데이터가 그 안에 있다.
# ★★코드는 이미 이 배치를 전제로 쓰여 있다: `backend.rs` 의 `find_repo_root` 가 exe 옆에서
#   위로 올라가며 `backend/server.py` 를 찾고, `find_python` 이 `<그 폴더>/python/python.exe`
#   를 먼저 본다. 그러니 포터블은 새 형식이 아니라 **원래 모습대로 담는 일**이다.
#
# 결과: _dist/PeroPix/          (그대로 실행할 수 있는 한 벌)
#       _dist/PeroPix-<버전>-win64.zip
#
# 쓰기: portable.bat  (또는 powershell -File scripts/portable.ps1 [-SkipBuild])

param(
  # 이미 빌드해 둔 exe 를 쓴다 (Rust 빌드가 3분쯤 걸린다)
  [switch]$SkipBuild,
  # 받아 둔 파이썬을 그대로 쓴다 (다시 받지 않고 pip 도 건너뛴다)
  [switch]$SkipPython
)

$ErrorActionPreference = "Stop"
# ★로그로 넘길 때 한글이 깨지지 않게 (윈도우 콘솔 기본 코드페이지가 949 다)
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$root = Split-Path $PSScriptRoot -Parent
$dist = Join-Path $root "_dist"
$app = Join-Path $dist "PeroPix"
$cache = Join-Path $dist "_cache"

# ★버전은 **한 곳**에서 온다 (`src-tauri/tauri.conf.json`). 스크립트에 박으면 어긋난다.
$conf = Get-Content (Join-Path $root "src-tauri/tauri.conf.json") -Raw | ConvertFrom-Json
$version = $conf.version
Write-Host "[포터블] PeroPix $version"

if (-not $SkipBuild) {
  Write-Host "[포터블] 릴리스 빌드 (몇 분 걸립니다)"
  Push-Location $root
  # ★`--no-bundle` — msi·nsis 를 안 굽는다. 포터블만 내보내기로 정했으므로(사용자 결정
  #   2026-08-26) 굽는 시간이 통째로 낭비다.
  npm run tauri build -- --no-bundle
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw "빌드 실패" }
  Pop-Location
}

# ★★빌드가 내는 이름은 **Cargo 이름**(`peropix.exe`)이다 — 설치본을 구울 때만
#   `productName` 으로 바뀐다. 받는 사람이 보는 이름은 `PeroPix.exe` 여야 하므로 여기서
#   바꿔 담는다 (릴리즈 워크플로가 쓰던 규칙 그대로다).
$exe = Join-Path $root "src-tauri/target/release/peropix.exe"
if (-not (Test-Path $exe)) { throw "실행 파일이 없습니다: $exe  (먼저 build.bat)" }

# ── 자리 만들기 ────────────────────────────────────────────────────
# ★파이썬은 **남겨 둔다** — 다시 받는 데 시간이 걸린다 (`-SkipPython` 이 이걸 노린다)
$keepPython = $SkipPython -and (Test-Path (Join-Path $app "python/python.exe"))
if ($keepPython) {
  Get-ChildItem $app -Force | Where-Object { $_.Name -ne "python" } | Remove-Item -Recurse -Force
} elseif (Test-Path $app) {
  Remove-Item $app -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $app, $cache | Out-Null

# ── 파이썬 (임베드 판) ─────────────────────────────────────────────
# ★★v2 가 쓰던 것과 **같은 판**이다 (3.11.9 embed-amd64). 임베드 판은 기본으로
#   site-packages 를 안 읽으므로 `._pth` 의 `#import site` 를 살려야 pip 로 깐 것이 보인다.
if (-not $keepPython) {
  $pyZip = Join-Path $cache "python-3.11.9-embed-amd64.zip"
  if (-not (Test-Path $pyZip)) {
    Write-Host "[포터블] 임베드 파이썬 내려받기"
    Invoke-WebRequest "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip" -OutFile $pyZip
  }
  $py = Join-Path $app "python"
  Expand-Archive $pyZip -DestinationPath $py
  $pth = Join-Path $py "python311._pth"
  (Get-Content $pth) -replace '#import site', 'import site' | Set-Content $pth

  $getPip = Join-Path $cache "get-pip.py"
  if (-not (Test-Path $getPip)) {
    Invoke-WebRequest "https://bootstrap.pypa.io/get-pip.py" -OutFile $getPip
  }
  & (Join-Path $py "python.exe") $getPip --no-warn-script-location
  Write-Host "[포터블] 의존성 설치"
  & (Join-Path $py "python.exe") -m pip install --no-warn-script-location -r (Join-Path $root "backend/requirements.txt")
  if ($LASTEXITCODE -ne 0) { throw "pip 설치 실패" }
}

# ── 앱 ─────────────────────────────────────────────────────────────
Copy-Item $exe -Destination (Join-Path $app "PeroPix.exe")
# ★백엔드는 **소스 그대로** 간다 (파이썬이라 컴파일이 없다). `__pycache__` 는 뺀다 —
#   다른 파이썬 판에서 만든 것이라 쓸모가 없고, 패치 비교만 어지럽힌다.
Copy-Item (Join-Path $root "backend") -Destination $app -Recurse
Get-ChildItem $app -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force
# ★테스트는 빼고 담는다 (배포물이 아니다 — 릴리즈 워크플로가 쓰던 규칙 그대로다)
Get-ChildItem (Join-Path $app "backend") -Filter "test_*.py" | Remove-Item -Force

# ★★검열은 **기본 모델만** 담는다 (사용자 지시 2026-08-26). 무거운 XL(251MB)을 빼면
#   `censor.models()` 가 폴더를 훑어 가벼운 것부터 내므로, 남은 하나가 그대로 기본이 된다
#   — 코드를 고칠 것이 없다.
$censor = Join-Path $app "models/censor"
New-Item -ItemType Directory -Force -Path $censor | Out-Null
Get-ChildItem (Join-Path $root "models/censor") -Filter "*.onnx" |
  Sort-Object Length | Select-Object -First 1 |
  ForEach-Object { Copy-Item $_.FullName -Destination $censor; Write-Host "[포터블] 검열 모델: $($_.Name) ($([math]::Round($_.Length/1MB))MB)" }

# ★어휘·읽을거리는 있으면 담는다 (없어도 앱은 뜬다)
foreach ($n in @("LICENSE", "README.md")) {
  $p = Join-Path $root $n
  if (Test-Path $p) { Copy-Item $p -Destination $app }
}

# ★★**버전을 파일로 남긴다** — 업데이트가 「지금 무엇을 쓰고 있나」를 이걸로 안다
#   (`backend/server.py` 의 `APP_VERSION`). 소스의 상수는 개발용 기본값일 뿐이다.
# ★BOM 없이 쓴다 — 파워셸의 `Set-Content -Encoding UTF8` 은 BOM 을 붙이고, 그러면
#   파이썬의 `json.loads` 가 첫 글자에서 걸린다 (실측 2026-08-26: 버전이 조용히 개발값으로
#   떨어졌다). 백엔드도 `utf-8-sig` 로 읽어 견디지만, 애초에 안 붙이는 편이 낫다.
[IO.File]::WriteAllText(
  (Join-Path $app "version.json"),
  (@{ version = $version; built = (Get-Date -Format "yyyy-MM-dd") } | ConvertTo-Json))

# ── 묶기 ───────────────────────────────────────────────────────────
$zip = Join-Path $dist "PeroPix-$version-win64.zip"
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path $app -DestinationPath $zip
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
$appMb = [math]::Round(((Get-ChildItem $app -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
Write-Host ""
Write-Host "[포터블] 완료 — 푼 크기 ${appMb}MB / zip ${mb}MB"
Write-Host "  $app"
Write-Host "  $zip"
