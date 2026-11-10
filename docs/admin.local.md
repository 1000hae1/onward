# 운영자 메모 (로컬 전용, git에 올리지 않아요)

## 운영자 API

화면은 없고 API만 있어요. `Authorization: Bearer <ADMIN_KEY>` 헤더로 들어와요.
키를 1시간에 10번 틀리면 그 IP 해시에서는 1시간 동안 `429`예요.
모든 POST 본문에는 프로토콜 버전 `v`(지금은 `5`)와 `reason`(1~200자, audit_log에만 남아요)을 담아요.
운영자 작업은 모두 `audit_log`에 남고, 이 기록을 고치거나 지우는 API는 없어요(1년 뒤 자동 삭제).

```sh
export ONWARD=https://<배포 주소>        # 개발이면 http://localhost:5173
read -rs ADMIN_KEY && export ADMIN_KEY  # 키를 화면에 보이지 않게 입력해요
```

### 날짜별 지표 보기

```sh
curl -s "$ONWARD/admin/metrics?days=30" -H "Authorization: Bearer $ADMIN_KEY"
```

답의 `metrics[]`는 최근 날짜부터예요. 하루 입장 수(`entries`), 서로 다른 사람 수(`uniqueGuests`),
다시 온 사람 비율(`returningRate`), 평균 머문 시간(`avgStayMinutes`), 평안 빌기 수(`blessings`),
방명록 링크로 문병 온 수(`visitEntries`)만 있어요. 사람을 알 수 있는 값은 없어요.

### 최근 신고 보기

```sh
curl -s "$ONWARD/admin/reports?limit=50" -H "Authorization: Bearer $ADMIN_KEY"
```

답의 `reports[]`에는 `targetHash`(guestId 해시), `targetIp`(IP 해시), `nickname`(신고 당시 닉네임),
`reason`(`nickname` · `repeat` · `other`), `room`, `handled`, `targetHidden`이 있어요.

### 입장 막기 (guestId 해시나 IP 해시 가운데 하나)

```sh
curl -s -X POST "$ONWARD/admin/block" \
  -H "Authorization: Bearer $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"v":6,"guestHash":"<64자 해시>","reason":"불편한 닉네임을 반복해서 써요"}'

curl -s -X POST "$ONWARD/admin/block" \
  -H "Authorization: Bearer $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"v":6,"ipHash":"<64자 해시>","reason":"새 게스트를 계속 만들어 신고해요"}'
```

막힌 사람에게는 "지금은 들어올 수 없어요"만 보여요. 지금 병실에 있으면 바로 내보내요. 차단은 30일 뒤에 풀려요.

### 닉네임을 자동 닉네임으로 되돌리기

```sh
curl -s -X POST "$ONWARD/admin/reset-nickname" \
  -H "Authorization: Bearer $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"v":6,"guestHash":"<64자 해시>","reason":"닉네임이 불편하다는 신고 3건"}'
```

가림도 함께 풀려요. 같은 닉네임으로 다시 바꾸면 서버가 또 자동 닉네임으로 바꿔요. 신고된 적이 있는 사람에게만 할 수 있어요.

### 방명록 링크 끄기

```sh
curl -s -X POST "$ONWARD/admin/revoke-guestbook-link" \
  -H "Authorization: Bearer $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"v":6,"guestHash":"<64자 해시>","reason":"링크가 여러 곳에 퍼졌어요"}'
```

사과 달기와 문병이 모두 막혀요. 이미 달린 사과는 그대로예요.

### 사과 숨기기

```sh
curl -s -X POST "$ONWARD/admin/hide-apple" \
  -H "Authorization: Bearer $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"v":6,"appleId":123,"reason":"주인이 불편하다고 알려 왔어요"}'
```

사과를 바로 지우고 audit_log에 사과 번호와 사유만 남겨요. 사과 번호는 주인 화면의 WS 메시지(`guestbook`의 `apples[].id`)에 있어요.

### 가림 풀기 (살펴보니 문제가 없을 때)

```sh
curl -s -X POST "$ONWARD/admin/clear-flag" \
  -H "Authorization: Bearer $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"v":6,"guestHash":"<64자 해시>","reason":"확인해 보니 문제없어요"}'
```

### 답의 모양

| 상태 | 본문 |
| --- | --- |
| 200 | `{"v":6,"ok":true,"affected":<지금 병실에서 바로 반영된 사람 수>}` |
| 400 | `{"v":6,"error":"bad_request"}` |
| 401 | `{"v":6,"error":"unauthorized"}` |
| 404 | `{"v":6,"ok":false,"error":"unknown_guest"}` 또는 `{"v":6,"error":"not_found"}` |
| 429 | `{"v":6,"error":"too_many"}` |

## 안전장치 요약

- 게스트 토큰: 서버가 만들고 `TOKEN_SECRET`으로 서명해요. 서명이 틀리면 새 게스트예요. 비교는 상수 시간이에요.
- 요청 제한: 연결마다 1초에 10개. 넘으면 읽지 않고, 넘친 초가 3번 이어지면 연결을 닫아요(코드 4008).
  IP 해시마다 새 게스트는 1시간에 20명까지예요.
- 신고: 한 사람당 하루 5번. 서로 다른 세 사람이 신고하면 그 사람 닉네임이 다른 사람 화면에서 '조용한 ○○'로 보여요.
- 15분 동안 입력이 없으면 화면이 연결을 닫아요(수면 모드는 예외).
- 수면 모드는 서버가 알아요. 누워 있을 때만 잠들 수 있고, 같은 병동 사람에게 한 번 알려요(snapshot에도 들어가요).
  잠든 동안 목례·한마디·안아 주기는 가지 않고, 평안과 선물은 `sleep_kept`(guestId 해시)에 쌓았다가 깨어날 때 숫자로만 전해요.
  잠든 지 8시간이 지나면 alarm이 연결을 닫아요(코드 4009). 그 뒤로는 끊긴 사람과 같아서 30초 뒤 침대를 반납해요.
- 보관 기간이 지난 데이터는 Durable Object alarm이 지워요. 지울 게 있을 때만, 하루에 많아야 한 번 깨어나요.
- 다녀간 날 수와 퇴원 표시는 directory에 guestId 해시로만 두고, 마지막으로 다녀간 뒤 180일이 지나면 지워요.
  다녀간 날 수는 누구에게도 숫자로 보내지 않아요. 본인에게도 "반겨 줄지(greet)"만 보내요.

## 다시 들르고 싶은 순간들 (프로토콜 v4)

| 기능 | 화면 → 서버 | 서버 → 화면 | 서버가 정하는 것 |
| --- | --- | --- | --- |
| 안아 주기 | `hug-request {targetId}`, `hug-answer {requestId, accept}`, `sleep {sleeping}`, hello의 `hugsOff` | `hug-offer`(받는 사람만), `hug-declined`(보낸 사람만), 이벤트 `hug {a, b, bed}` | 2m 안, 같은 상대 10분에 1번(guestId 해시 기준), 잠든 사람·받지 않기·퇴원 중 제외, 10초 지난 답은 조용히 버림. 공개 정보에는 `hugOk` 하나만 |
| 고양이가 알아보기 | – | snapshot `greet` | 한국 날짜로 3일 이상 다녀가면 true. 고양이 방문은 오래 누운 사람 → 자주 온 사람 순 |
| 아침 창문 | 한마디 `bow {phrase: 5}` | 이벤트 `window-open {room}`, snapshot `morningRooms` | 한국 시간 06:30~09:00에 그날 처음 병실에 들어오면 한 번. 5번 한마디는 이 시간에만 |
| 창가 화분 | – | 이벤트 `planter {room, total}`, snapshot `planters` | 평안 빌기·남겨진 평안·배웅을 병실별로 누적(줄지 않음). 단계는 0/30/100/300/1000/3000 |
| 퇴원하기 | `discharge {closeLink}` | `discharge-started {until}`, `farewell-count`(본인만), 이벤트 `discharge {id}`(같은 병실만) | 1분 안의 배웅을 사람마다 한 번 세요. 퇴원한 연결은 유예 없이 바로 나가요. 다시 오면 snapshot `welcomeBack`만 |

서버에는 타이머가 없어요. 10초와 1분은 답이나 배웅이 올 때 시각을 견줘서 판단하고, 남은 시간은 화면이 세요.
