# PeroPix 3.0

NovelAI 이미지 생성 작업대. **씬 줄**에 장면을 늘어놓고 한 번에 굴리며, 프롬프트는
**블록**으로 쌓고 **카드**로 재사용한다.

Tauri 2 + React 19 (프런트) + Python FastAPI (백엔드, 사이드카).

## 받아서 쓰기

릴리즈의 `PeroPix-3.0-Windows.zip` 을 풀고 `PeroPix.exe` 를 실행한다.

- **설치 프로그램이 아니라 포터블이다.** 앱이 `data/`·`workspaces/`·`logs/` 를
  **실행 파일 옆에** 쓰므로, 쓰기가 되는 자리(문서 폴더·D 드라이브 등)에 풀어야 한다.
  Program Files 에 두면 첫 실행부터 막힌다.
- 파이썬은 꾸러미 안에 들어 있다 (`python/`). 따로 설치하지 않아도 된다.
- 윈도우 10/11. WebView2 런타임이 필요한데 보통 이미 깔려 있다.

## 개발

```bash
npm install
npm run tauri dev      # 프런트(1420) + 백엔드(8770) + 창
```

백엔드만 따로 띄우려면 `python backend/server.py --port 8770`.
의존성은 `backend/requirements.txt`.

## 릴리즈

태그를 밀면 워크플로가 **초안 릴리즈**를 만든다 (`.github/workflows/release.yml`).

```bash
git tag v3.0.1 && git push origin v3.0.1
```

버전은 **태그가 정본**이라 빌드가 `tauri.conf.json`·`package.json` 을 그 값으로 맞춘다.
확인만 하고 싶으면 Actions 에서 손으로 돌린다 — 그때는 릴리즈를 안 만들고
아티팩트로만 올라간다.

## 검열 모델

`models/censor/*.onnx` 를 넣어 두면 앱이 목록에서 고른다. 기본은 **가벼운 쪽**이다.
저장소에는 40MB 짜리만 들어 있다 — 239MB 짜리는 GitHub 파일 제한(100MB)을 넘어
따로 두고 쓴다.
