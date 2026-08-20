import { useI18n } from "../i18n";
import { Icon } from "./Icon";
import { useRename } from "./useRename";

/** 그 자리에서 고치는 **이름** — 앱 어디서나 이것 하나다 (사용자 지적 2026-08-20:
 *  *"편집버튼도 모든 편집버튼이 각각 만들어서 일관성이 보장이 안되잖아"*).
 *
 *  ★조작은 `useRename` 이 정한다: 연필 단추는 **토글**(다시 누르면 저장하고 끝) ·
 *    `Enter` 저장 · `Esc` 취소 · 밖을 누르면 저장 · 더블클릭으로도 열린다.
 *  ★자리마다 다른 것은 **생김새뿐**이라 `style`·`inputStyle` 로만 받는다.
 *  ★단추가 필요 없는 자리(탭 이름처럼 좁은 곳)는 `btn={false}` 로 끈다 — 그때도
 *    더블클릭 규칙은 같다. */
export function EditableName({
  name,
  onRename,
  ctrl,
  btn = true,
  mark,
  style,
  inputStyle,
}: {
  name: string;
  onRename: (v: string) => void;
  /** 여닫는 상태를 밖에서 들 때 (목록이 「지금 고치는 것」을 하나만 두는 경우) */
  ctrl?: { editing: boolean; setEditing: (v: boolean) => void };
  btn?: boolean;
  /** 조작 테스트가 잡는 손잡이 — `<이름>-name` / `<이름>-rename` 으로 나간다 */
  mark?: string;
  style?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
}) {
  const t = useI18n((s) => s.t);
  const rename = useRename(name, onRename, ctrl);
  return (
    <>
      {rename.editing ? (
        <input
          {...(mark ? { [`data-${mark}-input`]: "" } : {})}
          {...rename.inputProps}
          style={inputStyle}
        />
      ) : (
        <span
          {...(mark ? { [`data-${mark}`]: "" } : {})}
          onDoubleClick={(e) => {
            e.stopPropagation();
            rename.toggle();
          }}
          style={style}
        >
          {name}
        </span>
      )}
      {btn && (
        <button
          {...(mark ? { [`data-${mark}-rename`]: "" } : {})}
          {...rename.btnProps}
          data-tip={t("cards.rename")}
          style={{ color: "var(--ink-faint)", display: "grid", padding: "0 2px" }}
        >
          {Icon.pencil}
        </button>
      )}
    </>
  );
}
