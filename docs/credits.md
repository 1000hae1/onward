# 음원·에셋 출처

2026-11-09 기준으로 저장소 전체(`node_modules`, `dist` 제외)를 확인했어요.

- 찾아본 파일 형식: mp3/ogg/wav/m4a/flac, woff/woff2/ttf/otf, png/jpg/jpeg/webp/gif/svg/ico, ktx2/hdr/glb/gltf
- 찾아본 외부 주소: `http(s)://`, `@font-face`, `data:` URI

**결과: 저장소에 들어 있는 소리 파일, 글꼴 파일, 이미지·텍스처 파일, 외부 이미지 주소는 하나도 없어요.**
화면에 나오는 소리와 그림은 모두 코드로 그때그때 만들어요. 이 페이지 내용은 화면용 `/credits`(`public/credits.html`)와 같아요.

## 소리

| 파일 경로 | 출처 URL | 라이선스 | 상업적 이용 가능 여부 |
| --- | --- | --- | --- |
| `src/ui/sleep-mode.ts` (수면 모드 바람결 소리) | 없음. Web Audio로 잡음을 걸러 직접 만들어요 | 이 프로젝트 코드 | 가능 |

## 텍스처·그림

| 파일 경로 | 출처 URL | 라이선스 | 상업적 이용 가능 여부 |
| --- | --- | --- | --- |
| `src/ward/soft-texture.ts` (눈·김·그림자용 둥근 번짐) | 없음. Canvas 그라데이션으로 만들어요 | 이 프로젝트 코드 | 가능 |
| `src/ward/room.ts` (병실 문패) | 없음. Canvas에 글자를 그려요 | 이 프로젝트 코드 | 가능 |
| `src/ward/hospital.ts` (병원 간판) | 없음. Canvas에 글자를 그려요 | 이 프로젝트 코드 | 가능 |
| `src/ward/facilities.ts` (시설 안내판) | 없음. Canvas에 글자를 그려요 | 이 프로젝트 코드 | 가능 |
| `src/avatar/portraits.ts` (동물 고르기 카드 그림) | 없음. 아바타 3D 부품을 그 자리에서 렌더링해요 | 이 프로젝트 코드 | 가능 |
| `src/avatar/*`, `src/cat/*`, `src/ward/*` (동물·고양이·병동 3D 모양) | 없음. Three.js 기본 도형을 조합해요 | 이 프로젝트 코드 | 가능 |

## 글꼴

| 파일 경로 | 출처 URL | 라이선스 | 상업적 이용 가능 여부 |
| --- | --- | --- | --- |
| `src/style.css`, `public/*.html`, Canvas 글자 (`"Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui`) | 없음. 보는 분 기기에 깔린 글꼴을 이름으로 부르기만 해요 | 배포하지 않아요(글꼴 파일 없음) | 해당 없음 |

> 나중에 글꼴 파일을 직접 넣게 되면(예: Noto Sans KR, SIL OFL 1.1) 이 표에 파일 경로와 라이선스를 더해 주세요.

## 함께 배포되는 라이브러리

| 파일 경로 | 출처 URL | 라이선스 | 상업적 이용 가능 여부 |
| --- | --- | --- | --- |
| `node_modules/three` (0.187.0) | https://github.com/mrdoob/three.js | MIT (Copyright © 2010-2026 three.js authors) | 가능. 저작권·라이선스 고지를 남겨야 해요 |
| `node_modules/zod` (4.6.7) | https://github.com/colinhacks/zod | MIT (Copyright (c) 2025 Colin McDonnell) | 가능. 저작권·라이선스 고지를 남겨야 해요 |

개발할 때만 쓰는 도구(Vite, TypeScript, Wrangler, Vitest, Playwright)는 화면에 함께 배포되지 않아요.

## 확인 필요

없어요.

## 새 에셋을 넣을 때

1. CC0 또는 상업적 이용이 되는 라이선스인지 먼저 확인해요.
2. 이 문서 표와 `public/credits.html`에 같은 줄을 더해요.
3. 출처 페이지 주소와 내려받은 날짜를 함께 적어요.
