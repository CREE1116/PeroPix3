import { useRef, useState } from "react";
import { useTagSuggest } from "./TagSuggest";

/** 태그를 적는 입력칸 — **자동완성이 붙은** textarea.
 *
 *  블록 편집기(BlockRow)와 달리 여기는 "열렸다가 blur 로 닫히는" 자리를 위한 것이다
 *  (슬롯의 공통·추가). 값은 안에서 들고 있다가 나갈 때 한 번 넘긴다 —
 *  자동완성이 값을 갈아 끼우려면 controlled 여야 한다. */
export function TagTextarea({
  value,
  onCommit,
  style,
  ...rest
}: {
  value: string;
  onCommit: (v: string) => void;
  style?: React.CSSProperties;
} & React.HTMLAttributes<HTMLTextAreaElement>) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const ac = useTagSuggest(text, setText, ref);

  return (
    <>
      <textarea
        {...rest}
        ref={ref}
        autoFocus
        value={text}
        onChange={ac.onChange}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (ac.onKeyDown(e)) return; // 목록이 떠 있으면 그쪽이 먼저
          if (e.key === "Escape") ref.current?.blur();
        }}
        onBlur={() => onCommit(text)}
        style={style}
      />
      {ac.node}
    </>
  );
}
