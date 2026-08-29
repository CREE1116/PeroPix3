import { Icon } from "../components/Icon";
import { useI18n } from "../i18n";
import { toast } from "../store/toast";
import { useTranslate } from "../store/translate";

/** 번역 모드 단추 — 프롬프트 라벨 줄, 와일드카드·블록 저장소 옆 (v2 도 그 줄에 있었다).
 *  켜면 무엇을 하면 되는지 한 번 알린다 (v2 와 같다). */
export function TranslateButton() {
  const t = useI18n((s) => s.t);
  const on = useTranslate((s) => s.on);
  const set = useTranslate((s) => s.set);
  return (
    <button
      data-translate-toggle
      data-on={on ? "" : undefined}
      onClick={() => {
        set(!on);
        if (!on) toast(t("translate.on"));
      }}
      data-tip={t("translate.hint")}
      style={{
        color: on ? "var(--accent)" : "var(--ink-faint)",
        display: "grid",
        padding: "0 4px",
      }}
    >
      {Icon.globe}
    </button>
  );
}
