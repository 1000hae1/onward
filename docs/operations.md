# 운영 문서

온기병동을 배포하고, 문제가 생기면 되돌리고, 비밀값과 무료 한도를 관리하는 방법이에요.
명령은 모두 저장소 루트에서 실행해요. `npx wrangler login`이 되어 있어야 해요.

| 환경 | Worker 이름 | 빌드 | 배포 |
| --- | --- | --- | --- |
| production | `onward` | `npm run build` | `npm run deploy` |
| preview | `onward-preview` | `npm run build:preview` | `npm run deploy:preview` |

두 환경은 **이름이 다른 별도 Worker**예요. Durable Object(병실과 directory의 SQLite 데이터), 비밀값, 로그가 모두 따로예요.
preview에서 무엇을 해도 production 데이터에는 닿지 않아요.

- 환경 설정: `wrangler.jsonc`의 맨 위가 production, `env.preview`가 preview예요. Cloudflare Vite 플러그인을 쓰므로 `wrangler deploy --env`가 아니라 **빌드할 때** `CLOUDFLARE_ENV=preview`로 환경을 골라요. `npm run deploy:preview`가 이것을 해 줘요.
- 방문 통계(Web Analytics) 비콘은 production 빌드에만 들어가요. preview와 개발 서버에는 들어가지 않아요.
- GitHub Actions는 아직 쓰지 않아요. 배포는 손으로 해요.

---

## 1. 처음 한 번 준비하기

### 비밀값 넣기

비밀값은 환경마다 따로 넣어요. 값은 32자 이상의 무작위 문자열이에요(`openssl rand -base64 48`).
**production과 preview에 같은 값을 쓰지 마세요.**

```sh
# production
npx wrangler secret put TOKEN_SECRET --name onward
npx wrangler secret put IP_SALT      --name onward
npx wrangler secret put ADMIN_KEY    --name onward

# preview
npx wrangler secret put TOKEN_SECRET --name onward-preview
npx wrangler secret put IP_SALT      --name onward-preview
npx wrangler secret put ADMIN_KEY    --name onward-preview
```

Worker가 아직 없으면 `secret put`이 Worker를 먼저 만들지 물어봐요. 만들어도 괜찮아요. 처음 배포 전에 넣어 두면 첫 접속부터 바로 동작해요.
비밀값이 없거나 32자보다 짧으면 그 기능이 멈춰요(입장, IP 해시, 운영자 API).

### 방문 통계 토큰

1. Cloudflare 대시보드 → **Analytics & Logs → Web Analytics → Add a site**
2. **"Manage site" → JS snippet**의 `token` 값(32자리)을 복사해요.
3. `.env.production`의 `VITE_CF_ANALYTICS_TOKEN=[여기에 토큰]`을 그 값으로 바꿔요. 화면에 그대로 보이는 공개 값이라 git에 올려도 괜찮아요.

> **자동 설치(Automatic setup)는 켜지 마세요.** 자동 설치는 비콘을 `<head>`에 먼저 넣어요. 그러면 화면이 주소창의 방명록 토큰(`/guestbook/{토큰}`)을 지우기 전에 비콘이 주소를 읽을 수 있어요. 지금은 비콘을 화면 스크립트 뒤에 두어서, 토큰을 먼저 지운 다음 통계를 보내요.

---

## 2. 배포 순서

1. **확인**: `npm test`와 `npm run e2e`를 돌려요. 화면을 바꿨으면 `docs/qa-checklist.md`의 **꼭** 항목도 확인해요.
2. **preview에 배포**: `npm run deploy:preview`
   - 테스트 → preview 빌드 → `onward-preview`에 배포 순서로 진행돼요.
   - 배포 주소는 출력의 `https://onward-preview.<계정>.workers.dev`예요.
3. **preview에서 확인**
   - `curl https://onward-preview.<계정>.workers.dev/api/health` → `{"v":…,"ok":true,"sqlite":true}`
   - 창 두 개로 들어가 서로 보이는지, 평안 빌기가 도착하는지 확인해요.
   - 프로토콜(`PROTOCOL_VERSION`)이나 SQL 표를 바꿨으면 특히 꼼꼼히 봐요(아래 4장).
   - `GET /admin/metrics`와 `GET /api/stats`가 답하는지 확인해요.
4. **production에 배포**: `npm run deploy`
   - 배포가 끝나면 이미 열려 있던 화면은 다음 메시지를 주고받을 때 새 서버와 이어져요. 프로토콜 버전이 바뀌었으면 "새 버전이 나왔어요. 새로고침해 주세요"가 떠요.
5. **배포 직후 10분**: 대시보드 **Workers & Pages → onward → Observability**에서 오류 로그가 늘지 않는지 봐요. 늘면 바로 3장의 방법으로 되돌려요.

---

## 3. 이전 버전으로 되돌리기

### 코드 되돌리기

```sh
npx wrangler deployments list --name onward   # 최근 배포와 버전 ID
npx wrangler rollback --name onward           # 바로 이전 버전으로
npx wrangler rollback <버전 ID> --name onward  # 특정 버전으로
```

대시보드에서도 할 수 있어요. **Workers & Pages → onward → Deployments**에서 버전을 고르고 **Rollback**을 눌러요.
되돌린 뒤 문제를 고쳐 다시 배포할 때는 2장의 순서를 처음부터 밟아요.

### 되돌려도 돌아가지 않는 것: Durable Object 데이터

`wrangler rollback`은 **코드와 설정만** 되돌려요. 병실과 directory의 SQLite 데이터는 그대로예요.
그래서 새 버전이 표나 열을 바꿔 놓았다면, 옛 코드가 바뀐 데이터를 읽게 돼요.

지금 코드가 지키는 규칙이에요. 앞으로도 지켜 주세요.

- **표와 열은 더하기만 해요.** `CREATE TABLE IF NOT EXISTS`로 새 표를 만들고, 새 열은 `DEFAULT`를 붙인 `ALTER TABLE … ADD COLUMN`으로만 더해요. 그러면 옛 코드는 새 표나 열을 모른 채 그대로 돌아가요.
- **지우거나 이름을 바꾸지 않아요.** `DROP TABLE`, `DROP COLUMN`, 열 이름 바꾸기, 값의 뜻 바꾸기(예: 초 단위였던 열을 밀리초로)는 되돌릴 수 없어요. 꼭 해야 하면 새 열을 만들어 두 버전에 걸쳐 옮기고, 옛 열은 한참 뒤에 지워요.
- **연결 정보(`serializeAttachment`)와 `away` 표의 JSON에는 새 칸을 선택 항목(`?`)으로만 더해요.** 옛 코드가 읽어도 깨지지 않아요. 이번에 더한 `joinedAt`, `blessings`도 선택 항목이에요.
- **Durable Object 마이그레이션(`migrations`의 태그)은 되돌리지 마세요.** 클래스를 새로 만들거나(`new_sqlite_classes`), 이름을 바꾸거나 지우는 마이그레이션은 되돌릴 수 없어요. 마이그레이션이 다른 버전으로는 `wrangler rollback`이 막힐 수 있어요. **클래스를 지우는 마이그레이션(`deleted_classes`)은 그 클래스의 데이터를 모두 지워요.**
- **`PROTOCOL_VERSION`을 올린 배포를 되돌리면**, 새 버전으로 이미 새로고침한 화면이 옛 서버와 버전이 달라져요. 그러면 "새로고침해 주세요" 안내가 떠요. 사용자가 새로고침하면 옛 화면을 받아서 다시 맞춰져요.

---

## 4. 비밀값 바꾸기

### 절차

1. 새 값을 만들어요. `openssl rand -base64 48`
2. **preview에서 먼저** 바꾸고 확인해요. `npx wrangler secret put <이름> --name onward-preview`
3. production에서 바꿔요. `npx wrangler secret put <이름> --name onward`
   - 비밀값을 넣으면 그 자리에서 새 버전으로 배포돼요. 따로 `deploy`하지 않아도 돼요.
4. 로컬 `.dev.vars`는 production 값과 다르게 둬요. 로컬에 production 비밀값을 두지 마세요.
5. 바꾼 날짜와 이유를 운영 기록에 적어요. 값 자체는 적지 마세요.

> 비밀값을 바꾼 뒤 `wrangler rollback`으로 되돌릴 때는, 되돌린 버전이 어떤 비밀값을 쓰는지 대시보드 **Settings → Variables and Secrets**에서 꼭 확인하세요.

### 바꾸면 생기는 일

| 비밀값 | 바꾸면 생기는 일 | 언제 바꾸나 |
| --- | --- | --- |
| `TOKEN_SECRET` | **모든 게스트 토큰이 무효가 돼요.** 모든 분이 다음 입장 때 새 사람으로 시작해요. 다녀간 날 수(고양이의 반김), 퇴원 뒤 "다시 들러 주셨네요", 방명록 링크와 사과의 주인 확인, 자리에 없을 때 받은 평안이 이전 사람과 이어지지 않아요. 남은 기록은 보관 기간이 지나면 지워져요. 새 게스트를 만드는 요청 제한(IP마다 1시간에 20명)에 걸리는 분이 생길 수 있어요. | 유출이 의심될 때만 |
| `IP_SALT` | IP 해시가 모두 바뀌어요. **IP 차단이 풀리고**, IP마다 세던 요청 제한(새 게스트, 운영자 키 틀림)이 처음부터 다시 세져요. 신고 기록에 남은 IP 해시로는 새로 차단할 수 없어요. guestId 차단은 그대로예요. | 유출이 의심될 때만. 바꾼 뒤 꼭 막아야 할 IP가 있으면 신고가 다시 들어올 때 새 해시로 막아요 |
| `ADMIN_KEY` | 운영자 API를 부를 때 새 키를 써야 해요. 사용자 화면에는 아무 영향이 없어요. | 정기적으로(예: 분기마다), 키를 아는 사람이 바뀔 때 |

---

## 5. 무료 한도

온기병동은 Workers 무료 플랜 안에서 돌아가게 만들었어요. 한도는 바뀔 수 있으니 아래 숫자는 Cloudflare 문서([Workers 한도](https://developers.cloudflare.com/workers/platform/limits/), [Durable Objects 요금](https://developers.cloudflare.com/durable-objects/platform/pricing/))에서 다시 확인하세요(2026-11 기준으로 정리했어요).

| 무엇 | 무료 한도(하루, UTC 0시에 초기화) | 온기병동에서 많이 쓰는 곳 |
| --- | --- | --- |
| Workers 요청 | 10만 건 | 정적 파일, `/api/*`, WebSocket 연결 |
| Workers CPU | 요청마다 10ms | IP 해시, 토큰 서명 확인 |
| Durable Object 요청 | 10만 건 | WebSocket 메시지, 병실 → directory 호출 |
| Durable Object 시간 | 13,000 GB-s | 깨어 있는 병실. 하이버네이션 덕분에 조용하면 거의 쓰지 않아요 |
| SQLite 읽은 줄 / 쓴 줄 | 500만 줄 / 10만 줄 | 입장, 선물, 남겨진 평안, 지표 |
| SQLite 저장 | 5GB(전체) | 보관 기간이 지나면 지워져요 |
| Workers Logs | 하루 20만 건, 3일 보관 | `worker/log.ts`의 오류 로그 |

### 어디서 확인하나

- **Workers & Pages → onward → Metrics**: 요청 수, 오류율, CPU 시간
- **Workers & Pages → Durable Objects**: 객체별 요청, 시간, 저장량
- **계정 홈 → Usage**(또는 Billing → Usage): 오늘 쓴 양과 한도
- **Observability → Logs**: `{"level":"error","route":…}` 줄

### 넘으면 생기는 일

- Workers 요청을 넘으면 그날 남은 시간 동안 요청이 오류(1027 등)로 끝나요. 화면은 "병동 서버에 닿지 않아 혼자 머물러요"로 혼자 머무는 모드가 돼요.
- Durable Object 한도를 넘으면 병실과 directory 호출이 실패해요. 들어오기, 평안 남기기, 방명록(사과 달기·문병)이 막혀요.
- 한도는 UTC 0시(한국 오전 9시)에 초기화돼요.

### 대응

1. **무엇이 늘었는지 봐요.** Metrics에서 경로별 요청 수를 확인해요. `/api/stats`가 많으면 캐시가 동작하는지 보고(커스텀 도메인이 아니면 Cache API가 동작하지 않아요), `/ws`가 많으면 다시 잇기가 반복되는지 Observability 로그를 봐요.
2. **특정 IP나 사람이 원인이면** 운영자 API로 막아요. `POST /admin/block`에 `ipHash`나 `guestHash`를 보내요. 신고 목록(`GET /admin/reports`)에서 해시를 찾을 수 있어요.
3. **방명록 링크가 원인이면** `POST /admin/revoke-guestbook-link`로 그 링크를 꺼요. 사과 하나가 문제면 `POST /admin/hide-apple`로 지워요.
4. **급하면** 새 게스트 제한(`shared/safety-rules.ts`의 `NEW_GUESTS_PER_HOUR`)이나 정원·인스턴스 수를 낮춰 preview → production으로 배포해요.
5. 계속 넘는다면 그건 사람이 많이 온다는 뜻이에요. Workers Paid(월 $5)로 옮길지 정해요. 옮겨도 코드는 바꿀 필요가 없어요.

---

## 6. 로그와 지표

### 서버 로그

- `wrangler.jsonc`에서 **자동 요청 로그(`invocation_logs`)와 추적(`traces`)을 꺼 두었어요.** 요청 URL에 방명록 토큰(`/api/guestbook/{토큰}`)이 들어갈 수 있어서예요. 쿼리 문자열도 지워요(`redact_query_string`).
- 직접 남기는 로그는 `worker/log.ts`로만 써요. 남기는 것은 길 이름, 상태 코드, 오류 종류, 가린 오류 문구뿐이에요. guestId, IP, 닉네임, 해시, 토큰은 남기지 않아요.
- `worker/` 안에서 `console`을 직접 부르면 `tests/logging.test.ts`가 실패해요.

### 날짜별 지표 (`GET /admin/metrics`)

```sh
curl -H "Authorization: Bearer $ADMIN_KEY" "https://<배포 주소>/admin/metrics?days=30"
```

| 칸 | 뜻 |
| --- | --- |
| `entries` | 새로 들어온 횟수예요. 30초 안에 다시 이어진 것은 세지 않아요 |
| `uniqueGuests` | 그날 들어온 서로 다른 사람 수예요(guestId 해시 기준) |
| `returningRate` | 그날 온 사람 가운데 예전 날(최근 180일)에도 온 적 있는 사람의 비율(0~1)이에요 |
| `avgStayMinutes` | 그날 나간 사람의 평균 머문 시간(분)이에요. 한 사람은 12시간까지만 세요 |
| `blessings` | 그날 나간 사람들이 머무는 동안 평안을 빈 수예요 |
| `visitEntries` | 방명록 링크로 문병 온 횟수예요 |

- 날짜는 한국 날짜예요. 400일이 지나면 지워져요.
- 머문 시간과 평안 빌기 수는 사람이 **정말 나갈 때**(30초 유예 끝, 퇴원, 차단) 병실이 인원 보고에 실어 보내요. 그래서 directory 요청이 따로 늘지 않아요. 다만 배포나 재시작으로 병실이 갑자기 내려가면, 그때 머물던 사람의 숫자는 빠질 수 있어요.

### 방문 통계

Cloudflare 대시보드 **Analytics & Logs → Web Analytics**에서 봐요. 쿠키를 쓰지 않아서 "방문자"는 정확한 사람 수가 아니라 어림값이에요.
