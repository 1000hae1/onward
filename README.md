# onward (온기병동)

환자복 입은 동물들이 6인 병실에 머물며 서로의 평안을 빌어 주는 3D 웹 공간이에요. 의료 서비스가 아니에요.

## 실행

```sh
npm install
cp .dev.vars.example .dev.vars   # 아래 '비밀값'을 채워 주세요
npm run dev                      # http://localhost:5173
npm test
npm run typecheck
```

## 비밀값

Worker는 비밀값 세 개가 있어야 돌아가요. 모두 32자 이상의 무작위 문자열이어야 하고, 없거나 짧으면 그 기능은 멈춰요.

| 이름 | 쓰는 곳 |
| --- | --- |
| `TOKEN_SECRET` | 게스트 토큰 서명(HMAC-SHA256). 바꾸면 모든 사람이 새 게스트가 돼요. |
| `IP_SALT` | IP 해시에 섞는 소금. 바꾸면 IP 차단과 요청 제한 기록이 이어지지 않아요. |
| `ADMIN_KEY` | 운영자 API 키 |

```sh
# 개발: .dev.vars (git에 올라가지 않아요)
openssl rand -base64 48   # 값 만들기

# 배포: 환경마다 따로 넣어요(production은 onward, 미리보기는 onward-preview)
npx wrangler secret put TOKEN_SECRET --name onward
npx wrangler secret put IP_SALT --name onward
npx wrangler secret put ADMIN_KEY --name onward
```

배포는 `npm run deploy:preview`로 미리보기에서 확인한 뒤 `npm run deploy`로 해요.
