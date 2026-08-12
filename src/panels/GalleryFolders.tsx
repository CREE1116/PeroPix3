import { useI18n } from "../i18n";
import { useWs } from "../store/workspace";
import { ALL, useGallery } from "../store/gallery";

/** 갤러리의 폴더 목록 — 좌 패널.
 *
 *  ★폴더 축은 **사용자 소유**다 (feature-inventory K절). 앱이 캐릭터 이름 같은 걸로 폴더를
 *    만들지 않으므로, 여기 뜨는 이름은 전부 사용자가 붙인 탭·셀 이름이다.
 *  ★그림이 하나라도 있는 폴더만 서버가 준다 — 미리 만들어진 빈 셀 폴더로 목록이 차지 않게. */
export function GalleryFolders() {
  const t = useI18n((s) => s.t);
  const ws = useWs((s) => s.current);
  // ★목록을 불러오는 것은 **중앙(Gallery)** 이다 — 이 패널은 접으면 언마운트되므로
  //   (Shell 이 접힌 쪽을 렌더하지 않는다) 여기서 불러오면 접었을 때 갤러리가 빈다.
  const { folders, folder, items, setFolder } = useGallery();

  // ★서버가 주는 첫 줄(`path: ""`)이 **전체**다 — 그걸 그대로 쓴다.
  //   따로 더하면 하위 폴더가 두 번 세어지고, 이름 없는 빈 줄이 하나 더 생긴다
  //   (실측 2026-08-05: 3장짜리 폴더 하나에 전체가 6으로 뜨고 무명 줄이 붙었다).
  const total = folders.find((f) => f.path === ALL)?.count ?? 0;
  const rest = folders.filter((f) => f.path !== ALL);

  return (
    // ★제목은 패널 머리글(Shell)이 이미 달고 있다 — 여기서 또 적으면 두 겹이 된다
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--sp-2) var(--sp-2) var(--sp-3)" }}>
        <Row
          label={t("gallery.all")}
          count={total}
          on={folder === ALL}
          onClick={() => void setFolder(ws, ALL)}
        />
        {rest.map((f) => (
          <Row
            key={f.path}
            label={f.path}
            count={f.count}
            on={folder === f.path}
            onClick={() => void setFolder(ws, f.path)}
          />
        ))}
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: "var(--sp-2) var(--sp-4)",
          borderTop: "1px solid var(--line-soft)",
          fontSize: "var(--text-2xs)",
          color: "var(--ink-faint)",
        }}
      >
        {/* ★숫자만 두면 무엇의 개수인지 알 수 없다 — 지금 보고 있는 범위를 함께 적는다 */}
        {folder === ALL ? t("gallery.all") : folder} · {t("gallery.countImages", { n: items.length })}
      </div>
    </div>
  );
}

function Row({
  label,
  count,
  on,
  onClick,
}: {
  label: string;
  count: number;
  on: boolean;
  onClick: () => void;
}) {
  // 폴더는 `work/유나/포즈1` 처럼 계층이라, 마지막 조각을 굵게 두고 앞은 흐리게 둔다
  const parts = label.split("/");
  const leaf = parts.pop()!;
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: "var(--sp-2)",
        width: "100%",
        padding: "5px var(--sp-3)",
        borderRadius: "var(--r-2)",
        background: on ? "var(--surface2)" : "transparent",
        color: on ? "var(--ink)" : "var(--ink-dim)",
        fontSize: "var(--text-xs)",
        textAlign: "left",
      }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {parts.length > 0 && (
          <span style={{ color: "var(--ink-faint)" }}>{parts.join("/")}/</span>
        )}
        <span style={{ fontWeight: on ? 600 : 400 }}>{leaf}</span>
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
        {count}
      </span>
    </button>
  );
}
