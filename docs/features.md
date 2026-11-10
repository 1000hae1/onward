# 온기병동(onWard) 기능 목록

> 기준: 2026-11-09, `main` 브랜치 작업 트리(커밋 안 된 입장 화면 배치 변경 포함). 코드를 직접 읽고 판단했어요.

온기병동은 환자복을 입은 동물들이 커튼을 걷어 둔 6인 병실에 머물며 서로의 평안을 빌어 주는 3D 웹 공간이에요. 의료 서비스는 아니에요. 들어온 사람은 토끼·곰·펭귄·수달·사슴 가운데 하나를 고르고 닉네임을 정한 뒤, 병동을 걷거나 빈 침대에 누울 수 있어요. 다른 동물에게 평안을 빌어 주거나, 정해진 한마디를 건네거나, 머리맡에 선물을 두거나, 창가에 불빛을 켜거나, 안아 줄 수 있어요. 자리에 없는 분께는 평안을 남겨 두면 다음에 들어올 때 전해져요. 방명록(사과나무) 링크를 아는 사람에게 보내면 그분만 사과를 남기거나 문병 올 수 있고, 떠날 때는 퇴원하며 같은 병실 사람들의 배웅을 받아요. 낮과 밤, 22시 소등, 겨울 선물은 모두 한국 시간을 따라요. 직접 쓰는 글자는 닉네임뿐이고, 나머지는 모두 번호로 주고받아요.

상태 표시: **완성** = 화면과 서버가 모두 이어져 동작해요 · **일부만** = 한쪽만 있거나 빠진 데가 있어요(빠진 것을 적었어요) · **없음** = 아직 없어요

---

## 1. 입장

| 기능 이름 | 사용자가 보는 모습 | 상태 | 어떻게 해보나 | 관련 코드 파일 |
| --- | --- | --- | --- | --- |
| 모습 고르기 | 다섯 동물의 그림을 보고 고르면 뒤의 병동에서 바로 바뀌어요. 옷은 환자복과 평상복 가운데 골라요. | 완성 | 첫 화면에서 동물 그림 → [환자]/[문병객] | `src/ui/entry-screen.ts`, `src/avatar/species.ts`, `src/avatar/portraits.ts`, `src/avatar/egg.ts`, `src/avatar/kit.ts` |
| 닉네임 정하기 | "따뜻한 곰"처럼 자동 닉네임이 채워져 있고, 고쳐 쓰면 규칙에 맞는지 바로 알려 줘요. | 완성 | 닉네임 칸 수정 → [병동에 들어갈게요] | `src/ui/entry-screen.ts`, `shared/nickname.ts`, `shared/bannedWords.ts`, `worker/ward-room.ts`(hello) |
| 고양이와 함께 들어가기 | 고양이가 내 옆에서 나란히 걷고, 다른 사람 화면에도 보여요. 내가 멈추면 옆에 앉고, 누우면 침대 옆에 웅크려요. 문처럼 좁은 곳에서는 잠깐 뒤따라와요. | 완성 | [함께 갈게요]/[혼자 갈게요] | `src/cat/companion.ts`, `src/ward/companion-side.ts`, `src/ward/companion-trail.ts`, `src/net/remote-guests.ts` |
| 간호사의 인사 | 현관으로 들어서면 간호사실 가운데 병아리 간호사가 고개를 숙이며 "어서 오세요. 편히 쉬다 가세요"라고 인사해요. 이 기기에서 두 번째부터는 "다시 오셨네요"예요. 내 화면에서만 보여요. 간호사는 병동 직원이라 닉네임이 없고 평안·선물·신고 대상이 아니에요. | 완성 | 앞마당에서 현관으로 걸어 들어가기 | `src/ward/chick-nurse.ts`, `src/ward/nurse-greeting.ts`, `src/ward/controls.ts`(setLobbyListener) |
| 다시 와도 같은 동물로 | 다음에 들어와도 같은 사람으로 알아봐요. 남겨진 평안도 이어져요. | 완성 | 들어갔다가 새로고침해서 다시 들어가기 | `worker/security.ts`, `src/net/ward-params.ts`(토큰 저장), `src/ui/profile.ts` |
| 정원과 다음 병실 | 한 병동이 30명으로 차면 다음 병실로 넘어가고, 모두 차면 혼자 머물러요. | 완성 | 창을 31개 이상 열어 보기(개발 환경) | `shared/ward-rules.ts`(admit, nextInstance), `src/net/ward-client.ts`(room-full) |
| 병동 고르기 | 1~99병동이 있지만 화면에서 고를 수는 없어요. | 일부만 | 주소에 `?ward=3` 붙이기 | `src/net/ward-params.ts`, `worker/index.ts` — **빠진 것: 병동을 고르는 화면이 없고 주소로만 바꿀 수 있어요** |

## 2. 병실과 이동

| 기능 이름 | 사용자가 보는 모습 | 상태 | 어떻게 해보나 | 관련 코드 파일 |
| --- | --- | --- | --- | --- |
| 걷기 | 바닥을 누르면 그곳으로 걸어가요. 갈 수 없는 곳이면 서버가 가까운 곳으로 바로잡아요. | 완성 | 바닥 누르기 | `src/ward/controls.ts`, `src/ward/movement.ts`, `shared/ward-layout.ts`, `shared/ward-rules.ts`(clampToWalkable) |
| 내 침대 고르기(고정 배정) | 아직 내 침대가 없을 때 빈 침대를 누르면 "이 침대를 쓰시겠어요?" [이 침대 쓰기]/[다른 곳 볼게요]를 물어요. [이 침대 쓰기]를 누르면 서버가 배정을 확정한 뒤에 걸어가 누워요. 동시에 누르면 서버가 먼저 처리한 한 사람에게만 주고, 늦은 사람에게는 "방금 다른 분이 자리를 잡았어요."가 떠요. 침대에서 내려와 걸어 다녀도 침대는 계속 내 것이고, 내 침대를 누르면 묻지 않고 바로 누워요. 다른 분의 침대를 누르면 눕지 않고 그분 메뉴가 떠요. | 완성 | 빈 침대 누르기 → [이 침대 쓰기] → 바닥 눌러 내려오기 → 내 침대 다시 누르기 | `shared/bed-rules.ts`(claimBed, lieDown, standUp), `src/ward/bed-flow.ts`(bedTapIntent), `src/ward/controls.ts`, `src/ui/action-bar.ts`(confirmClaim), `worker/ward-room.ts`(claim-bed, lie-down, get-up) |
| 침대 고르기 안내 | 정원(30명)은 침대 수와 따로라, 침대가 다 차도 병동에는 들어와 머물 수 있어요. 내 침대가 없는 환자가 병실에 들어서면 "빈 침대를 누르면 내 침대로 고를 수 있어요."를, 그 병실이 다 찼으면 "이 병실은 침대가 다 찼어요. 104호실에 빈 침대가 있어요."처럼 빈 병실을, 병동 전체가 찼으면 "지금은 빈 침대가 없어요. 편히 둘러보시다가 침대가 비면 골라 주세요."를 알려 줘요. | 완성 | 침대 없이 병실에 들어가기 | `shared/bed-rules.ts`(bedGuide, bedGuideText), `src/scene.ts` |
| 침대 이름표 | 침대를 배정받은 사람의 닉네임이 침대 발치에 달려 모두에게 보여요(같은 병실 안에서). 침대에서 내려와 걸어 다녀도 그대로이고, 퇴원하거나 30초 넘게 끊기면 사라져요. 서버가 정한 침대(guest.bed)를 따르고, 글자는 textContent로만 넣어요. | 완성 | 침대 고르기 → 내려와 걸어 다니기 → 다른 기기에서 같은 병실 보기 | `src/ward/bed-plates.ts`, `src/net/remote-guests.ts` |
| 침대 옮기기 | 내 침대가 있는데 다른 빈 침대를 누르면(누워 있든 서 있든) "이 침대로 옮길까요?" [옮길게요]/[그대로 있을게요]를 물어요. 옮기면 서버가 원래 침대를 반납하고 새 침대를 배정해요. 그사이 다른 분이 받으면 원래 침대를 그대로 지키고 "방금 다른 분이 누우셨어요."가 떠요. | 완성 | 내 침대가 있는 채 다른 빈 침대 누르기 | `shared/bed-rules.ts`(claimBed), `src/ward/bed-flow.ts`(bedTapIntent), `src/ui/action-bar.ts`(confirmMove) |
| 다른 동물 보기 | 같은 병동에 있는 동물들이 걷고 눕는 모습과 머리 위 닉네임이 보여요. | 완성 | 창 두 개로 들어가 보기 | `src/net/remote-guests.ts`, `src/ui/head-labels.ts` |
| 잠깐 끊겨도 자리 지키기 | 30초 안에 다시 이어지면 침대와 자리를 그대로 돌려받고, 다른 사람에게는 나간 것으로 보이지 않아요. 30초가 지나면 침대를 반납해요. 이 브라우저는 마지막 내 자리(병동·병실·침대 번호)를 기억해 두었다가, 다음에 들어올 때 그 병실로 가서 예전 침대가 비어 있으면 서버가 같은 침대를 먼저 돌려줘요. | 완성 | 개발자 도구에서 네트워크를 잠깐 끊었다가 잇기 / 창을 닫고 1분 뒤 다시 들어가기 | `shared/ward-rules.ts`(toAway, expireAway, GRACE_MS), `shared/bed-rules.ts`(seatOnEntry), `src/net/ward-params.ts`(loadSeat, saveSeat), `worker/ward-room.ts`(away 표, alarm) |
| 다른 창에서 들어오면 쉬기 | 같은 사람이 다른 창으로 들어오면 예전 창은 "이 창은 쉬어요"라고 알려요. | 완성 | 같은 브라우저 탭 두 개로 들어가기 | `src/net/ward-client.ts`(REPLACED_CODE), `worker/ward-room.ts` |
| 혼자 머물기 | 서버에 닿지 않아도 병실은 그대로 열리고, 내 화면에서만 동작해요. | 완성 | `npm run dev` 없이 정적 빌드만 열기 | `src/scene.ts`, `src/ui/action-bar.ts`(online이 false일 때) |
| 설정 | 들어온 뒤에는 고양이·안아 주기 받기·보기만 바꿔요. 동물과 닉네임은 입장 화면에서만 골라요. | 완성 | 오른쪽 위 [설정] | `src/ui/settings.ts`, `shared/ward-rules.ts`(updateProfile) |
| 가볍게 보기 | 처음 5초의 프레임 속도와 기기 메모리·코어 수로 보통/가볍게를 스스로 골라요. 가볍게면 픽셀 비율 1.5, 안티에일리어싱 끔, 눈 1/3, 9m보다 먼 동물은 몸만 그려요. 설정에서 [자동/켜기/끄기]로 바꿀 수 있어요. | 완성 | [설정] → [가볍게 보기], `?quality=light&debug=1`로 미리 보기 | `src/ward/quality.ts`, `src/ui/view-prefs.ts`, `src/scene.ts` |
| 탭이 안 보이면 쉬기 | 다른 탭으로 가면 그리기를 멈추고, 돌아오면 이어 그려요. | 완성 | 다른 탭으로 갔다가 돌아오기 | `src/scene.ts`(visibilitychange) |
| WebGL 안내 | WebGL을 쓸 수 없거나 그리는 도중 끊기면 "이 기기에서는 병실을 보여주기 어려워요"와 [다시 시도]가 떠요. 되살아나면 스스로 닫혀요. | 완성 | 개발자 도구에서 `WEBGL_lose_context`로 끊어 보기 | `src/ui/webgl-fallback.ts`, `src/main.ts` |
| 상단 병동 이름과 오늘의 집계 | "3병동 · 4/30"(1호가 아니면 "3병동 2호 · 4/30", 서버에 닿지 않으면 "3병동 · 혼자 머무는 중"), "오늘 다녀간 동물 5마리 · 모인 평안 12"가 보여요. | 일부만 | 들어가서 화면 위쪽 보기 | `src/scene.ts`(setHud, setStats), `shared/daily.ts`(statsLine) — **빠진 것: 서버는 오늘 켠 불빛 수(`stats.lamps`)도 세서 보내지만 화면에는 나오지 않아요** |

## 3. 평안을 빌어 주는 동작

| 기능 이름 | 사용자가 보는 모습 | 상태 | 어떻게 해보나 | 관련 코드 파일 |
| --- | --- | --- | --- | --- |
| 평안 빌기(침대) | 손을 모으면 빛이 고른 침대 머리맡으로 날아가요. 모두에게 보여요. | 완성 | [평안 빌기] → [침대 고르기] → 침대 누르기 | `src/ui/action-bar.ts`, `src/ward/offerings.ts`, `worker/ward-room.ts`(bless) |
| 평안 빌기(자리에 없는 분께 남기기) | 오늘 같은 병동에서 만난 분을 목록에서 골라요. 함께 있으면 "(함께 있어요)"로 보이고 그분 머리 위로 빛이 가요. | 완성 | [평안 빌기] → [자리에 없는 분께 남기기] → 이름 | `src/net/met-list.ts`, `src/ui/action-bar.ts`(pickPerson) |
| 목례와 한마디 | 고개를 숙이고 "평안하시길" 같은 말풍선이 떠요. 아침에는 "좋은 아침이에요"도 있어요. | 완성 | [목례와 한마디] → 한마디 고르기 | `shared/gestures.ts`, `shared/morning.ts`(phraseAllowed), `src/ui/head-labels.ts` |
| 머리맡 선물 | 네잎클로버·오잎클로버·귤·홍시·호빵을 침대 옆 협탁에 놓아요. 하루가 지나면 치워져요. | 완성 | [머리맡 선물] → 선물 → 침대 | `src/ward/offerings.ts`, `shared/ward-rules.ts`(giftSlot, GIFTS_PER_DAY), `shared/left-blessings.ts`(오잎클로버 하루 1번) |
| 창가에 불빛 | 지금 있는 병실 창가에 작은 불빛이 하나 늘고 모두에게 보여요. 놓은 사람에게는 빛이 창틀로 날아가고 "창가에 불빛을 놓았어요. 오늘 이 병실에 n개예요."가 떠요. 창가마다 12개까지예요. | 완성 | 병실 안이나 침대에 누워 [창가에 불빛] | `shared/ward-rules.ts`(lampRoom), `shared/offering-rules.ts`, `src/ward/offerings.ts` |
| 안아 주기 | 2m 안의 동물을 눌러 안아 주기를 청하면, 상대가 받을 때 다가가 안아요. 누워 있으면 침대 곁에서 안아요. 메뉴에는 [안아 주기]가 늘 있고, 멀거나·상대가 쉬는 중이거나·10분이 안 됐으면 버튼이 꺼지고 이유가 보여요. | 완성 | 다른 동물 누르기 → [안아 주기] / 받는 쪽은 [안길게요]·[다음에요] | `shared/hug-rules.ts`, `src/ui/moments.ts`, `src/ward/warm-glow.ts`, `worker/ward-room.ts`(hug-request, hug-answer) |

## 4. 혼자 있을 때

| 기능 이름 | 사용자가 보는 모습 | 상태 | 어떻게 해보나 | 관련 코드 파일 |
| --- | --- | --- | --- | --- |
| 빈 침대에 평안 남기기 | 빈 침대에 보낸 평안과 선물은 다음에 그 침대에 눕는 분께 카드로 전해져요(침대마다 5개, 7일). | 완성 | 빈 침대에 평안 빌기 → 다른 계정으로 그 침대에 눕기 | `shared/left-blessings.ts`, `src/ui/blessing-cards.ts`, `worker/ward-room.ts`(leaveOnBed, deliverLeft) |
| 자리에 없는 분께 남기기 | 오늘 만난 분이 나갔어도 평안이나 선물을 남기면 "남겨두었어요"라고 알려 줘요. 같은 분께는 하루 한 번이에요. 그분이 다시 들어오면 "내가 없는 동안 도착한 평안"으로 보이고, 화면이 받았다고 알린 뒤에야 지워져요. | 완성 | [평안 빌기]/[머리맡 선물] → [자리에 없는 분께 남기기] → 지금 없는 분 | `worker/directory.ts`(leaveFor, deposit), `shared/left-blessings.ts` |
| 없는 동안 온 평안 받기 | 다시 들어오면 그사이 도착한 평안 카드(최근 10개)가 먼저 보여요. | 완성 | 위처럼 남긴 뒤 받는 쪽으로 다시 들어가기 | `worker/directory.ts`(enter), `src/ui/blessing-cards.ts`(showInbox) |
| 수면 모드 | 누운 채 잠들면 화면이 어두워지고 바람 소리가 아주 작게 들려요. 잠든 동안 화면이 꺼지지 않고 안아 주기 요청도 오지 않아요. | 완성 | 침대에 누운 뒤 [잠들기] / [깨어나기] | `src/ui/sleep-mode.ts`, `worker/ward-room.ts`(sleep) |
| 병동 고양이가 찾아오기 | 오래 누워 있으면 병동 고양이가 침대로 찾아와요. 같은 병실 사람들 화면에서 같은 곳에 있어요. | 완성 | 침대에 2분쯤 누워 있기 | `src/cat/cats.ts`, `src/cat/cat-path.ts`, `shared/ward-rules.ts`(catVisits, changedVisits) |
| 오래 쉬면 연결 잠시 닫기 | 15분 동안 아무것도 누르지 않으면 "잠들었어요"가 뜨고, 누르면 다시 병실로 돌아가요. 수면 모드는 예외예요. | 완성 | 15분 기다리기 | `shared/daily.ts`(shouldPause, IDLE_LIMIT_MS), `src/ui/gate.ts`, `src/net/ward-client.ts`(pause, resume) |

## 5. 다시 오고 싶은 이유

| 기능 이름 | 사용자가 보는 모습 | 상태 | 어떻게 해보나 | 관련 코드 파일 |
| --- | --- | --- | --- | --- |
| 고양이가 알아보기 | 서로 다른 날 3일 이상 다녀가면 병동 고양이가 문 앞에 나와 반겨요. | 완성 | 날짜를 바꿔 세 번 들어가기 | `shared/return-rules.ts`, `worker/directory.ts`(guest_days), `src/cat/cats.ts`(welcome) |
| 아침 창문 | 06:30~09:00에 그날 처음 병실에 들어오면 창문이 열려요. 병실마다 하루 한 번이에요. | 완성 | 아침에 병실 들어가기 | `shared/morning.ts`, `src/ward/morning-window.ts`, `worker/ward-room.ts`(openWindowIfMorning) |
| 창가 화분 | 병실에 평안이 모일수록 새싹에서 꽃 여러 송이까지 6단계로 자라요. 줄지 않아요. | 완성 | 병실 안에서 창가 화분 누르기 | `shared/planter.ts`, `src/ward/planter-view.ts` |
| 함께한 밤 | 밤(22시~6시)에 1분 넘게 머물면 그 밤을 세고, 다음 밤에 "n번째 밤"이라고 알려 줘요. | 완성 | `?clockShift=분`으로 밤을 미리 보기 | `shared/daily.ts`(countNight, nightsText), `src/scene.ts` — 이 브라우저에만 저장해요 |
| 퇴원하기와 배웅 | 퇴원하면 평상복으로 갈아입고 문으로 걸어 나가요. 같은 병실 사람에게 [배웅하기]가 뜨고, 1분 뒤 "n분이 배웅해 주셨어요" 카드가 보여요. | 완성 | [내 침대] → [퇴원하기] → [퇴원할게요] (퇴원하면 침대를 바로 반납해요) | `shared/discharge-rules.ts`, `src/ui/moments.ts`, `worker/ward-room.ts`(discharge, farewell) |
| 다시 들러 주셨네요 | 퇴원한 뒤 다시 들어오면 한 번 반겨 줘요. | 완성 | 퇴원 뒤 다시 들어가기 | `shared/return-rules.ts`, `worker/directory.ts`(discharged) |

## 6. 방명록(사과나무)과 문병

서로 모르는 사람끼리는 글을 주고받지 않아요. 사과(방명록 글)는 주인이 직접 링크를 보낸 사람만 남길 수 있고, 주인만 볼 수 있어요.

| 기능 이름 | 사용자가 보는 모습 | 상태 | 어떻게 해보나 | 관련 코드 파일 |
| --- | --- | --- | --- | --- |
| 내 사과나무 | 누운 채 [내 침대] → [내 사과나무]. 주인만 보는 방명록 화면이 열려요(시안 A '그림책 사과나무'). 사과를 누르면 흰 링과 카드(이름·날짜·한마디·짧은 글)가 떠요. 카드 밖을 누르면 닫혀요. | 완성 | [내 침대] → [내 사과나무] | `src/guestbook/owner-panel.ts`, `src/guestbook/tree-view.ts`, `src/guestbook/tree-shape.ts`, `src/ui/action-bar.ts` |
| 내 방명록 링크 | 링크 주소(`/guestbook/{토큰}`) 전체, [복사]("복사했어요"), [보내기](공유 창, 안 되면 복사), "이 링크를 받은 분만 사과를 남길 수 있어요". [링크 끄기] / [새 링크 만들기] — 새로 만들면 예전 링크는 바로 닫혀요. | 완성 | 방명록 화면 위쪽 카드 | `src/net/guestbook-api.ts`, `worker/directory.ts`(createGuestbookLink), `shared/visit-rules.ts`(replaceLink, turnOffLink) |
| 사과 숨기기 | 주인이 카드의 [이 사과 숨기기]를 누르면 서버에서 바로 지워요. | 완성 | 사과 카드 → [이 사과 숨기기] | `worker/ward-room.ts`(hide-apple), `worker/directory.ts`(hideApple) |
| 침대 옆 작은 사과나무 | 링크가 켜져 있거나 사과가 있으면, **주인 화면에서만** 내 침대 발치 옆에 작은 나무가 보여요(사과 최대 8알). 다른 사람 화면에는 그리지 않아요. | 완성 | 링크를 만든 뒤 침대에 누워 있기 | `src/ward/apple-tree-view.ts`, `shared/ward-layout.ts`(appleTreeSpot) |
| 링크로 온 사람의 방명록 | `/guestbook/{토큰}`으로 열면 3D 병동 없이 방명록만 떠요. 같은 나무가 보이고, 다른 분의 사과는 모양과 개수만, 내가 단 사과는 눌러서 내용을 볼 수 있어요. | 완성 | 받은 링크 열기 | `src/guestbook/visitor-page.ts`, `worker/index.ts`(`GET /api/guestbook/{토큰}`) |
| 사과 달기 | [사과 하나 달아 주기] → 시트에서 이름(2~10자), 한마디 5개 가운데 하나, 짧은 글(선택, 100자). 달면 봉오리에서 사과로 톡 열리고(0.6초) 카드가 잠깐 떠올라요. 같은 링크로 1시간에 10개까지. | 완성 | 링크 화면 → [사과 하나 달아 주기] | `src/guestbook/apple-sheet.ts`, `shared/guestbook-rules.ts`, `worker/index.ts`(`POST /api/guestbook/{토큰}/apples`), `worker/directory.ts`(addApple) |
| 병실에 문병 가기 | 링크 화면 맨 아래 [병실에 문병 가기 →] → "○○님에게 문병 왔어요" 입장 화면(평상복+꽃다발). 주인 침대 옆에서 시작하고, 침대는 차지하지 못하고, 정원에 세지 않아요. 한 링크로 동시에 3명. | 완성 | 링크 화면 → [병실에 문병 가기 →] → [문병 갈게요] | `src/net/guestbook-api.ts`(goVisit), `src/scene.ts`, `shared/visit-rules.ts`(checkVisit, visitorSpot) |
| 주인이 없을 때 | 주인이 마지막에 있던 침대 옆에 서요. 그때 주인 침대로 빈 평안은 '내가 없는 동안 도착한 평안'으로 전해져요. | 완성 | 주인이 나간 뒤 문병 가서 주인 침대에 평안 빌기 | `shared/visit-rules.ts`(visitorDelivery), `worker/ward-room.ts`(leaveForVisitedOwner) |
| 문병객 도착 알림 | 문병객이 오면 주인 화면에 "○○님이 문병 왔어요"가 떠요. | 완성 | 주인이 누워 있을 때 문병 가기 | `worker/ward-room.ts`(visitor-arrived), `src/scene.ts` |

## 7. 시간과 계절

| 기능 이름 | 사용자가 보는 모습 | 상태 | 어떻게 해보나 | 관련 코드 파일 |
| --- | --- | --- | --- | --- |
| 낮·저녁·소등 조명 | 6~18시 낮, 18~22시 저녁, 22시부터 소등이에요. 서버 시계를 한국 시간으로 읽어요. | 완성 | `?time=night` 또는 `?clockShift=분` | `src/ward/time-of-day.ts`, `src/ward/lighting.ts`, `src/ward/sky.ts`, `shared/daily.ts` |
| 소등 안내 | 22시가 되면 "소등 시간이에요. 오늘 밤 함께 잠드는 분 n명"이 떠요. | 완성 | 21:59쯤으로 `?clockShift` 맞추기 | `shared/daily.ts`(lightsOutText), `src/scene.ts`(refreshSlot) |
| 겨울 선물 | 귤·홍시·호빵은 11월~2월에만 놓을 수 있어요. 서버가 한국 날짜로 판단해요. | 완성 | 3월이면 버튼이 흐리고, 보내도 서버가 거절해요 | `shared/ward-rules.ts`(seasonalGiftsAllowed) |
| 하루가 바뀌면 정리 | 한국 날짜가 바뀌면 놓인 선물·불빛·오늘의 집계가 새로 시작해요. | 완성 | 자정 넘기기 | `worker/ward-room.ts`(tidy), `shared/safety-rules.ts`(deleteExpired) |
| 눈과 김 | 병동 둘레에 눈이 내리고 협탁 위 차에서 김이 올라요. | 일부만 | 들어가서 창밖 보기 | `src/ward/winter.ts` — **빠진 것: 계절을 따지지 않아서 여름에도 눈이 와요. 서버 날짜(겨울 여부)와 이어지지 않았어요** |

## 8. 안전과 개인정보

| 기능 이름 | 사용자가 보는 모습 | 상태 | 어떻게 해보나 | 관련 코드 파일 |
| --- | --- | --- | --- | --- |
| 닉네임 검사 | 2~10자, 금칙어, 숫자 4개 이상, URL·이메일이면 이유를 알려 주고 들어가지 못해요. 화면과 서버가 같은 규칙을 써요. | 완성 | 닉네임에 `1234`나 `a.com` 넣어 보기 | `shared/nickname.ts`, `shared/bannedWords.ts` |
| 닉네임 가리기 | 서로 다른 세 분이 신고하면 다른 사람 화면에서 그분 닉네임이 "조용한 토끼"처럼 보여요. | 완성 | 세 계정으로 같은 분 신고 | `shared/safety-rules.ts`(publicNickname), `worker/ward-room.ts`(hide) |
| 요청 제한 | 너무 빨리 누르면 "조금 천천히 눌러 주세요"가 떠요. 계속 몰아 보내면 연결이 닫혀요. | 완성 | 같은 버튼을 빠르게 여러 번 | `shared/safety-rules.ts`(rateStep), `shared/ward-rules.ts`(actionReady) |
| 새 버전 안내 | 열 때 `/api/health`의 버전을 먼저 견주고, 다르면 "새 버전이 나왔어요. 새로고침해 주세요"와 [새로고침]이 떠요. `index.html`은 매번 새로 확인하고 빌드 파일은 오래 보관해요(`public/_headers`). | 완성 | 배포 직후 열린 창 | `shared/ward-rules.ts`(readVersion), `src/net/ward-client.ts`(outdated), `src/scene.ts`(showOutdated), `public/_headers` |
| 힘들 때 안내 | 설정 안에 109 상담전화 안내와 [109에 전화하기]가 있어요. | 완성 | [설정] 아래쪽 | `src/ui/settings.ts` |
| 글자 크게 | 설정에서 켜면 모든 글자가 1.2배로 커져요. 입장 화면부터 적용돼요. | 완성 | [설정] → [글자 크게] | `src/ui/view-prefs.ts`, `src/style.css`(html.large-text) |
| 화면 낭독기 안내 | 나에게 온 평안·선물, 같은 병실의 한마디를 보이지 않는 `aria-live="polite"` 영역에 넣어 읽어 줘요. 같은 글은 1.5초 안에 한 번만이에요. | 완성 | VoiceOver를 켜고 다른 창에서 평안 빌기 | `src/ui/announcer.ts`, `src/scene.ts`(announce) |
| 버튼 크기와 키보드 | 모든 버튼과 링크가 44px 이상이에요. Tab으로 옮겨 다니며 포커스 테두리가 보이고, Esc로 설정과 메뉴를 닫아요. | 완성 | Tab, Esc 눌러 보기 | `src/style.css`, `src/ui/settings.ts`, `src/ui/action-bar.ts` |
| 3D 위 글자 대비 | 머리 위 이름, 상단 이름표, 안내, 버튼 배경이 흰 벽·낮 하늘 위에서도 4.5:1 이상이에요. | 완성 | `tests/a11y.test.ts` | `src/style.css`, `src/ui/contrast.ts` |
| 움직임 줄이기 | `prefers-reduced-motion`이면 눈이 1/3로 줄어 천천히 내리고, 별은 반짝이지 않고, 카메라와 빛 효과가 약해요. | 완성 | 운영체제에서 동작 줄이기 켜기 | `src/ward/quality.ts`(snowFraction, snowSpeed), `src/scene.ts` |
| 개인정보 처리방침 | 지금은 내려 두었어요(서빙하지 않음). 설정의 링크도 주석 처리했어요. | 꺼 둠 | — | `docs/disabled/privacy.html`, `src/ui/settings.ts` — 다시 켤 때 방명록 보관 항목을 더해 주세요 |

## 9. 운영자

화면은 없고 `Authorization: Bearer <ADMIN_KEY>` 헤더로 부르는 API만 있어요(README에 curl 예시가 있어요).

| 기능 이름 | 사용자가 보는 모습 | 상태 | 어떻게 해보나 | 관련 코드 파일 |
| --- | --- | --- | --- | --- |
| 날짜별 지표 보기 | 하루 입장 수, 서로 다른 사람 수, 다시 온 비율, 평균 머문 시간, 평안 빌기 수, 방명록 링크로 문병 온 수를 날짜별로 받아요. 숫자만 있어요. | 완성 | `GET /admin/metrics?days=30` | `shared/metrics-rules.ts`, `worker/directory.ts`(metrics_daily), `worker/admin.ts` |
| 신고 목록 보기 | 최근 신고를 해시·닉네임·사유·병실·처리 여부와 함께 받아요. | 완성 | `GET /admin/reports?limit=50` | `worker/admin.ts`, `worker/directory.ts`(listReports) |
| 입장 막기 | 막힌 분은 "지금은 들어올 수 없어요"만 보고, 지금 병실에 있으면 바로 나가요. 30일 뒤 풀려요. | 완성 | `POST /admin/block` (guestHash나 ipHash) | `worker/directory.ts`(adminBlock, tellRooms), `worker/ward-room.ts`(moderate) |
| 닉네임 되돌리기 | 그분 닉네임이 자동 닉네임으로 바뀌고, 같은 닉네임으로는 다시 바꿀 수 없어요. | 완성 | `POST /admin/reset-nickname` | `worker/directory.ts`, `shared/safety-rules.ts`(enforceBannedNickname) |
| 방명록 링크 끄기 | 그분의 방명록 링크가 더 열리지 않아요(사과 달기·문병 모두). | 완성 | `POST /admin/revoke-guestbook-link` | `worker/directory.ts`(adminRevokeGuestbookLink) |
| 사과 숨기기 | 사과 하나를 바로 지워요. audit_log에 사과 번호와 사유만 남아요. | 완성 | `POST /admin/hide-apple` | `worker/admin.ts`, `worker/directory.ts`(adminHideApple) |
| 가림 풀기 | 살펴보니 문제가 없으면 원래 닉네임이 다시 보여요. | 완성 | `POST /admin/clear-flag` | `worker/directory.ts`(adminClearFlag) |
| 키를 계속 틀리면 잠그기 | 한 시간에 10번 틀리면 그 IP 해시는 한 시간 동안 429예요. | 완성 | 틀린 키로 11번 부르기 | `worker/security.ts`(checkAdminKey), `worker/directory.ts`(adminLocked) |
| 작업 기록 보기 | 운영자가 한 일은 모두 `audit_log`에 남아요. | 일부만 | — | `worker/directory.ts`(audit) — **빠진 것: 기록을 쓰기만 하고 읽는 API가 없어요** |
| 차단 풀기 | 실수로 막은 분을 바로 풀어 드릴 방법이 없어요. | 없음 | — | 30일 보관 기간이 지나야 풀려요 |

---

## 아직 없는 것

CLAUDE.md, README, 코드 주석을 함께 보고 모았어요. 코드에 `TODO`/`FIXME` 주석은 없어요.

| 항목 | 근거 | 지금 상태 |
| --- | --- | --- |
| 계절에 따른 풍경 | CLAUDE.md "계절은 서버의 한국 시간 기준" | 겨울 선물만 서버 날짜를 따르고, 눈과 김은 일 년 내내 보여요 |
| 개인정보 문의처 | `docs/disabled/privacy.html` | `[문의 이메일]` 자리 표시가 그대로 있어요 |
| 병동 고르는 화면 | `worker/index.ts`는 1~99병동을 받아요 | 주소의 `?ward=`로만 바꿀 수 있어요 |
| 오늘 켠 불빛 수 표시 | 프로토콜의 `stats.lamps` | 서버는 세서 보내는데 화면이 쓰지 않아요 |
| `audit_log` 조회, 차단 풀기 API | README "운영자 작업은 모두 audit_log에 남고…" | 쓰기만 있고 읽기·되돌리기는 없어요 |
| 운영자 화면 | README "화면은 없고 API만 있어요" | 일부러 뺀 것이에요. curl로만 다뤄요 |
| 오래된 주석 정리 | `src/ward/time-of-day.ts`의 "지금은 브라우저 시계를 쓰고…" | 이미 서버 시계를 써요. 주석만 예전 그대로예요 |
| Durable Object 통합 테스트 | CLAUDE.md "방 로직은 순수 함수로 분리하고 테스트" | 순수 함수는 테스트가 있지만, `worker/*.ts`를 실제로 돌리는 테스트는 없어요(아래 참고) |

---

## 기술 요약 (면접과 README용)

### 구성

- Vite + TypeScript + Three.js(React 없음), Cloudflare Worker 하나가 정적 에셋·API·WebSocket을 모두 맡아요.
- Durable Object 두 종류(모두 `new_sqlite_classes`, SQLite 저장소):
  - **WardRoom**: `ward-{병동}-{인스턴스}`마다 하나. 건물 1채, 병실 6개, 침대 36개, 정원 30명.
  - **Directory**: 이름이 `directory` 하나뿐인 공용 객체. 병동을 넘나드는 평안 주소, 받은 평안, 방명록 링크와 사과, 신고, 차단, 다녀간 날 수를 맡아요.
- 화면과 서버가 같은 `shared/` 코드를 써요(프로토콜 스키마, 닉네임 규칙, 방 규칙).
- 프로토콜 버전 `v = 5`, 화면이 보내는 메시지 최대 1KB, 서버가 보내는 메시지는 화면이 64KB까지 읽어요. 모든 메시지를 zod로 검사하고, 맞지 않으면 말없이 버려요.

### 클라이언트 → 서버 메시지 (WebSocket `/ws?ward=&instance=`)

| 이름 | 한 줄 설명 |
| --- | --- |
| `hello` | 들어오기, 또는 들어온 뒤 고양이·안아 주기 받기 바꾸기. 8초 안에 답이 없으면 화면이 다시 이어요. 서명된 토큰·동물·옷·닉네임·고양이·문병 토큰·안아 주기 받지 않기 |
| `walk-to` | 이 좌표로 걸어가요. 서버가 걸을 수 있는 곳으로 바로잡아요 |
| `lie-down` | 이 침대에 눕고 싶어요 |
| `get-up` | 침대에서 일어나요 |
| `bless` | 사람(`targetId`)이나 침대(`bedId`) 가운데 하나에 평안 빌기 |
| `bow` | 목례와 한마디(번호 0~5. 5번은 아침에만) |
| `gift` | 머리맡 선물(번호 0~4)을 사람이나 침대에 |
| `lamp` | 지금 병실 창가에 불빛 켜기 |
| `leave-for` | 자리에 없는 사람의 평안 주소로 평안이나 선물 남기기 |
| `inbox-ack` | 내가 없는 동안 도착한 평안을 받았어요(그 시각까지 서버가 지워요) |
| `guestbook` | 내 방명록 `info` / `create`(새 링크) / `off`(링크 끄기). 답은 나에게만 와요 |
| `hide-apple` | 내 나무의 사과 하나 숨기기(바로 지움) |
| `sleep` | 수면 모드 켜기/끄기 |
| `hug-request` | 안아 주기 요청 |
| `hug-answer` | 받은 요청에 답하기 |
| `discharge` | 오늘 퇴원하기(방명록 링크도 끌지) |
| `ping` | 연결 유지용 글자. 서버가 깨지 않고 자동으로 `pong` |

### 서버 → 클라이언트 메시지

| 이름 | 한 줄 설명 |
| --- | --- |
| `snapshot` | 들어오면 한 번: 나의 공개 번호, 사람들, 선물, 불빛, 고양이 방문, 받은 평안, 오늘의 집계, 문병 정보, 반김 여부, 아침 창문, 화분 |
| `event` | 바뀐 것 하나(아래 이벤트 종류) |
| `position-corrected` | 갈 수 없는 곳이라 바로잡은 좌표 |
| `bed-granted` / `bed-unavailable` | 침대를 받았는지 |
| `left-blessings` | 받은 침대에 남아 있던 평안 카드 |
| `left-saved` | 자리에 없는 분께 잘 남겼어요 |
| `nickname-rejected` | 닉네임이 규칙에 맞지 않아요(이유 번호) |
| `nickname-reset` | 운영자가 닉네임을 되돌렸어요 |
| `room-full` | 정원이 찼어요. 다음 인스턴스 번호 |
| `guestbook` | 내 방명록(주인에게만): 링크 상태, 사과 수, 보이는 사과 40개의 내용. 토큰은 새로 만든 순간에만 |
| `my-tree` | 들어올 때 주인에게만: 침대 옆 작은 나무를 그릴지(링크 켜짐, 사과 수) |
| `visit-denied` | 방명록 링크가 닫혔거나(`closed`) 문병객이 많아요(`busy`) |
| `visitor-arrived` | 내 침대로 문병객이 왔어요(주인에게만) |
| `guest-token` | 서버가 새로 서명한 게스트 토큰(이 브라우저에만) |
| `entry-denied` | 들어올 수 없어요(`blocked` / `limited`) |
| `hug-offer` / `hug-declined` | 안아 주기 요청이 왔어요 / 상대가 다음에 하재요 |
| `discharge-started` / `farewell-count` | 퇴원 시작(배웅 끝 시각) / 지금까지 배웅 수(본인에게만) |
| `action-denied` | 서버가 받지 않은 동작과 이유 번호 |
| `version-mismatch` | 버전이 달라요. 새로고침이 필요해요 |
| `entry-failed` | 서버가 들어오는 일을 처리하지 못했어요. 화면은 잠시 뒤 다시 이어요 |

`event` 종류: `join`, `update`, `leave`, `walk`, `lie`, `get-up`, `bless`, `bow`, `gift`, `lamp`, `stats`, `cat-visit`, `hug`, `window-open`, `planter`, `discharge`.

### HTTP API

| 경로 | 설명 |
| --- | --- |
| `GET /api/health` | SQLite가 살아 있는지 |
| `GET /api/guestbook/{토큰}` | 링크로 온 사람의 방명록: 주인 닉네임·동물·병동, 사과 수, `X-Apple-Writer` 열쇠로 단 내 사과만. `no-store`, `noindex`, `no-referrer` |
| `POST /api/guestbook/{토큰}/apples` | 사과 달기. 토큰·꺼짐·시간당 10개·이름·짧은 글을 서버가 살펴요. 다른 사이트(Origin)에서 온 요청은 403 |
| `GET /admin/metrics`, `GET /admin/reports`, `POST /admin/block`·`reset-nickname`·`revoke-guestbook-link`·`clear-flag`·`hide-apple` | 운영자 API |
| `/guestbook/{토큰}` | 방명록 링크 화면(index.html이 열고, 토큰은 탭으로 옮긴 뒤 주소창을 `/guestbook`으로 바꿔요) |
| `/credits` | 만든 사람과 출처(정적 페이지) |
| `GET /api/stats` | 공개 접속자 수 `{v, online, wards, updatedAt}`. 숫자만 있고 60초 캐시, GET에만 CORS `*` |

### 서버에 저장하는 데이터

사람은 모두 **guestId 해시**(SHA-256)로만 가리키고, IP는 **소금 섞은 HMAC 해시**로만 둬요. guestId 원문, 평안 주소 원문, 방명록 토큰 원문, 사과 열쇠 원문은 저장하지 않아요.

**WardRoom (병동 인스턴스마다)**

| 테이블 | 저장하는 항목 | 보관 기간 |
| --- | --- | --- |
| `gifts` | 협탁 번호, 칸, 선물 번호, 순서, 날짜 | 그날 하루(한국 날짜) |
| `lamps` | 병실별 불빛 수, 날짜 | 그날 하루 |
| `gift_counts` | guestId 해시별 오늘 놓은 선물 수 | 그날 하루 |
| `away` | 잠시 끊긴 사람의 기록(guestId는 비우고 해시로 키), 유예 끝 시각 | 30초 |
| `left_blessing` | 침대, 남긴 사람 닉네임·동물, 종류, 선물 번호, 시각, 보낸 사람 해시 | 7일, 침대마다 5개, 누우면 바로 지움 |
| `daily_visitors` | 오늘 다녀간 guestId 해시 | 그날 하루 |
| `daily_stats` | 오늘 모인 평안 수, 불빛 수 | 그날 하루 |
| `cat_visits` | 병실별 마지막으로 알린 고양이 방문 | 바뀔 때 덮어씀 |
| `place` | 이 객체가 맡은 병동·인스턴스 번호 | 계속 |
| `retention` | 다음 정리 예정 시각 | 계속(한 줄) |
| `planter` | 병실별 평안 누적 수 | 계속(줄지 않음) |
| `morning_open` | 오늘 아침 창문이 열린 병실 | 그날 하루 |
| `hug_sent` | 안아 주기를 보낸 짝(해시)과 시각 | 10분 |
| `hug_pending` | 답을 기다리는 요청 | 10초(+여유) |

**Directory (공용 하나)**

| 테이블 | 저장하는 항목 | 보관 기간 |
| --- | --- | --- |
| `address_book` | 평안 주소 해시 → 주인 해시 | 7일 |
| `inbox` | 자리에 없는 사람에게 남긴 평안 | 7일, 받는 사람마다 10개, 화면이 받았다고 알리면(`inbox-ack`) 지움 |
| `inbox_daily` | 오늘 남긴 짝(같은 분께 하루 한 번) | 그날 하루 |
| `gift_daily` | 하루 한 번 선물(오잎클로버) 쓴 날 | 그날 하루 |
| `guestbook_link` | 토큰 해시, 주인 해시, 주소 해시, 주인 닉네임·동물, 병동 위치, 꺼짐 여부, 문병 횟수 | 켜진 링크는 끌 때까지, 꺼진 링크는 만든 날부터 7일 |
| `apple` | 주인 해시, 이름, 한마디 번호, 짧은 글, 시각, 링크 토큰 해시, 쓴 브라우저 열쇠 해시, 자리 번호 | 1년. 주인이나 운영자가 숨기면 바로 지움 |
| `apple_seq` | 주인 해시마다 다음 사과 순번(자리 번호용) | 마지막 사과부터 1년 |
| `visit_attempt` | 링크별 들어온 시각 | 1시간 |
| `visit_session` | 지금 들어와 있는 문병객 | 나가면 지움, 최대 12시간 |
| `report` | 신고 시각·병실·사유·닉네임, 신고자·대상의 공개 번호와 해시, 대상 IP 해시, 처리 여부 | 30일 |
| `hidden_guest` | 닉네임을 가린 사람 해시 | 30일(운영자가 처리하면 지움) |
| `nickname_reset` | 되돌린 닉네임 | 30일 |
| `block` | 차단한 guestId 해시나 IP 해시 | 30일 |
| `guest_issue` | IP 해시별 새 게스트를 만든 시각 | 하루 |
| `admin_fail` | IP 해시별 운영자 키를 틀린 시각 | 하루 |
| `audit_log` | 운영자 작업 시각·종류·대상·사유 | 1년(고치거나 지우는 API 없음) |
| `guest_days` | guestId 해시별 다녀간 날 수, 마지막 날 | 마지막으로 다녀간 뒤 180일 |
| `discharged` | 퇴원한 사람 해시 | 다시 들어오면 지움, 최대 180일 |

**브라우저(localStorage)**: `onward.token`(서명된 토큰), `onward.profile`, `onward.met`(오늘 만난 분), `onward.nights`(함께한 밤), `onward.myGuestbookLink`(내 방명록 링크), `onward.appleWriter`(내가 단 사과를 알아보는 무작위 열쇠), `onward.view`(가볍게 보기·글자 크게·잰 품질). 방명록 토큰은 sessionStorage에 잠깐 둬요(`onward.guestbook`, `onward.visiting`).

### 무료 한도를 아끼는 장치

- **WebSocket Hibernation API만 써요**(`ctx.acceptWebSocket`). 연결 정보는 `serializeAttachment`에 붙여 두어서, 객체가 잠들었다 깨도 메모리 없이 다시 만들어요.
- **`ping`/`pong` 자동 응답**(`setWebSocketAutoResponse`). 30초마다 오는 연결 유지 글자에 객체를 깨우지 않아요.
- **주기적 방송이 없어요.** 서버에 `setInterval`이 없고, 바뀐 것이 있을 때만 `event` 하나를 보내요. 걷기는 목적지 좌표만 보내고 움직임은 각 화면이 그려요.
- **타이머 대신 시각 비교**: 안아 주기 10초, 배웅 1분은 답이 올 때 시각을 견줘서 판단하고, 남은 시간은 화면이 세요.
- **alarm 하나를 같이 써요**: 재접속 유예(30초)와 보관 기간 정리를 같은 alarm에 맞추고, 지울 것이 있을 때만 하루에 많아야 한 번 깨요. 아무도 기다리지 않으면 alarm을 지워요.
- **필요할 때만 정리**: 날짜가 바뀐 선물·불빛·집계는 요청이 올 때 `tidy()`로 함께 지워요.
- **고양이도 방송 없이**: 고양이 방문은 들고 나기·눕기·일어나기·병실 옮기기 때만 다시 계산하고, 바뀐 병실만 알려요. 움직임은 서버 시각을 함께 쓰는 결정적 경로라 화면마다 같아요.
- **바뀔 때만 집계 알림**: 오늘의 집계는 새 사람이 처음 오거나 평안이 모일 때만 보내요. 수면 상태도 안아 주기 가능 여부가 바뀔 때만 알려요.
- **15분 동안 입력이 없으면 화면이 연결을 닫아요**(수면 모드는 예외).
- **메시지 크기 1KB 제한**, 정원 30명, 인스턴스 20개까지.
- 화면 쪽: Three.js를 따로 불러오고, 휴대폰에서는 눈 입자·나무·별 수와 해상도를 줄이고, 수면 모드에서는 초당 4번만 그려요.

### 보안·개인정보 장치

- **게스트 토큰 서명**: 서버가 무작위 guestId(16바이트)를 만들고 `TOKEN_SECRET`으로 HMAC-SHA256 서명해요. 비교는 상수 시간이에요. 서명이 틀리면 새 게스트예요.
- **publicId**: 다른 사람에게는 접속마다 새로 만든 8자 공개 번호만 보내요. guestId와 그 해시는 남에게 보내지 않아요.
- **평안 주소**: 입장할 때마다 새로 만드는 무작위 값이에요. 서버에는 해시만 있어서, 주소를 알아도 누구인지 이어 붙일 수 없어요.
- **IP 해시**: Worker가 `CF-Connecting-IP`를 받자마자 `IP_SALT`로 HMAC 해시하고, 원본은 어디에도 넘기지 않아요. 내부 헤더는 Worker가 항상 덮어써서 화면이 바꿀 수 없어요.
- **비밀값 확인**: 세 비밀값이 없거나 32자보다 짧으면 그 기능을 멈춰요. 값은 로그나 오류 문구에 담지 않아요.
- **닉네임 검사**: 2~10자, 금칙어, 숫자 4개 이상 연속, URL·이메일 거절. 화면과 서버가 같은 `shared/nickname.ts`를 쓰고, 화면에는 `textContent`로만 넣어요.
- **한마디·선물은 번호만**: 사용자가 쓰는 글자는 닉네임뿐이에요.
- **서버 권위**: 침대 경쟁, 걸을 수 있는 범위, 선물 하루 10개, 오잎클로버 하루 1번(모든 병동 합쳐서), 창가 불빛 12개, 계절 선물, 아침 인사 시간, 안아 주기 거리·횟수를 모두 서버가 정해요.
- **요청 제한**: 연결마다 1초에 10개. 넘으면 읽지 않고, 넘친 초가 3번 이어지면 연결을 닫아요(4008). 같은 동작은 1초에 한 번. IP 해시마다 새 게스트는 1시간에 20명.
- **신고**: 한 사람당 하루 5번, 같은 대상은 한 번. 서로 다른 세 사람이 신고하면 닉네임을 "조용한 ○○"로 가려요.
- **운영자 API**: `ADMIN_KEY`를 SHA-256으로 길이를 맞춘 뒤 상수 시간 비교. 1시간에 10번 틀리면 그 IP 해시는 1시간 잠겨요. 본문 2KB 제한, 응답은 `no-store`·`noindex`. 모든 작업은 사유와 함께 `audit_log`에 남아요.
- **방명록 링크**: 토큰(128비트)은 해시로만 저장하고, 원본은 만든 순간 주인에게만 보내요. 주소와 미리보기에 닉네임·병실 정보가 없어요. 한 사람당 링크 하나, 문병은 동시에 3명·1시간에 30번, 사과는 1시간에 10개. 응답은 캐시·검색·리퍼러를 막아요.
- **사과는 주인만**: 사과 내용과 개수는 주인의 연결(`guestbook`, `my-tree`)에만 보내요. snapshot·event에는 사과를 담을 자리가 없어요. 링크로 온 사람은 자기 사과만 볼 수 있어요.
- **받지 않는 정보**: 건강 정보·나이·연락처는 받지 않아요. 사과의 이름과 짧은 글도 닉네임과 같은 검사(금칙어·주소·이메일·숫자 4개 연속)를 거쳐요. 109 안내를 설정에 둬요.
- **보관 기간**: 표마다 기간을 정해 alarm이 지워요(위 표 참고).

알아 둘 점: `leave-for`로 자리에 없는 분께 남긴 선물은 "하루 10개" 선물 수에 들어가지 않아요. 같은 분께 하루 한 번, 받는 사람마다 10개라서 무한히 쌓이지는 않아요.

### 테스트

`npm test` 결과: 테스트 파일 20개, 테스트 246개가 모두 통과해요(2026-11-09). 모두 Node에서 순수 함수만 돌려요(`vitest.config.ts`).

| 테스트가 있는 부분 | 파일 |
| --- | --- |
| 프로토콜 검사(v, 사람/침대 하나만, 서버 메시지) | `tests/ward-rules.test.ts` |
| 정원·침대 경쟁·재접속 유예·고양이 방문·선물 칸 등 방 규칙 | `tests/ward-rules.test.ts` |
| 남겨진 평안(침대 5개, 받는 사람 10개, 7일, 전하는 순서) | `tests/left-blessings.test.ts` |
| 문병(열림/닫힘, 교체, 인원·시간 제한, 문병객 자리) | `tests/visit-rules.test.ts` |
| 방명록(남에게 가는 메시지에 사과 없음, 토큰·꺼진 링크·새 링크, 남의 사과 내용 막기, 시간당 10개, 이름·짧은 글, 문병객 권한, 사과 자리) | `tests/guestbook.test.ts` |
| 안아 주기, 퇴원과 배웅, 다녀간 날 수, 아침 창문, 화분 | `tests/hug-rules.test.ts`, `tests/discharge-rules.test.ts`, `tests/return-rules.test.ts`, `tests/morning.test.ts`, `tests/planter.test.ts` |
| 요청 제한, 신고 판단, 닉네임 되돌림, 보관 기간 계산 | `tests/safety-rules.test.ts` |
| 토큰 서명·검증, 상수 시간 비교, 해시 | `tests/security.test.ts` |
| 닉네임 규칙 | `tests/nickname.test.ts` |
| 한국 시간·소등·함께한 밤 | `tests/daily.test.ts`, `tests/time-of-day.test.ts` |
| 화면 쪽 순수 로직: 이동 경로, 침대로 가기, 카메라 가림, 고양이 경로, 아바타 모양, 저장된 프로필 읽기, 재연결 간격 | `tests/movement.test.ts`, `tests/bed-flow.test.ts`, `tests/camera-view.test.ts`, `tests/cat.test.ts`, `tests/avatar.test.ts`, `tests/profile.test.ts`, `tests/ward-client.test.ts` |

| 테스트가 없는 부분 | 설명 |
| --- | --- |
| `worker/ward-room.ts`, `worker/directory.ts` | Durable Object와 SQLite를 실제로 돌리는 통합 테스트가 없어요. SQL 문, 하이버네이션 뒤 복원, alarm 흐름은 손으로만 확인했어요 |
| `worker/index.ts`, `worker/admin.ts` | 라우팅, 운영자 API 응답 코드, 키 잠금 흐름 |
| 화면 DOM | `src/ui/*`(입장·설정·동작 버튼·수면 모드·카드·순간 안내)와 `src/scene.ts`의 메시지 연결 |
| 3D 그리기 | `src/ward/*`의 조명·풍경·눈·화분 등 그리는 코드 |
| 여러 사람 시나리오 | 두 창 이상이 동시에 침대를 누르거나 문병·배웅하는 끝에서 끝까지의 테스트 |
