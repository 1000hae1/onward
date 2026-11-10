/** 입장 화면의 제목과 버튼 문구예요. 화면과 상관없는 순수 함수예요. */
export interface EntryHeading {
  title: string;
  /** 제목 아래 작은 안내예요. 없으면 null이에요. */
  note: string | null;
  enter: string;
}

/**
 * 방명록 링크로 왔으면 문병 제목, 이 기기에 저장된 모습과 서버가 준 토큰이 함께 있으면 "돌아왔네요",
 * 아니면 처음 오는 분의 제목이에요. 닉네임은 화면에 textContent로만 넣어요.
 */
export function entryHeading(input: { returning: boolean; nickname: string; visitTitle?: string }): EntryHeading {
  if (input.visitTitle) return { title: input.visitTitle, note: null, enter: "문병 갈게요" };
  if (input.returning) {
    return {
      title: `돌아왔네요, ${input.nickname}님`,
      note: "지난번 모습 그대로예요. 바꾸고 싶으면 아래에서 골라 주세요.",
      enter: "이대로 들어갈게요",
    };
  }
  return { title: "어떤 모습으로 머물까요?", note: null, enter: "병동에 들어갈게요" };
}

/** 저장소를 쓸 수 없는 브라우저에서 한 번 보여 주는 안내예요. */
export const NO_STORAGE_TEXT = "이 브라우저는 다음 방문을 기억하지 못해요. 다시 오시면 새로 만나요.";
