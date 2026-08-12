/** 백엔드 주소는 Rust 가 알려준다 — 프론트에 포트를 하드코딩하지 않는다.
 *  브라우저(vite dev)에서 열었을 땐 Tauri 가 없으므로 기본값으로 떨어진다. */

const FALLBACK = "http://127.0.0.1:8770";

let cached: string | null = null;

export async function backendUrl(): Promise<string> {
  if (cached) return cached;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    cached = await invoke<string>("backend_url");
  } catch {
    cached = FALLBACK;
  }
  return cached!;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await backendUrl();
  const res = await fetch(base + path, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}
