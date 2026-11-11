# AI 보이스크 (AI-Voisk)

> 말로 주문하고, 상황에 맞는 메뉴를 추천받는 AI 음성 키오스크
> 2026-2 캡스톤디자인 · Team Mallo(말로) · 5인 팀

고객은 태블릿 키오스크에서 터치나 음성으로 주문합니다. 음성 주문은 화면의 **"말로 주문하기" 버튼을 누른 뒤에만** 마이크가 켜집니다(호출어 없음). "해장할 만한 거 추천해 줘"처럼 상황을 말하면 매장 메뉴 중 맞는 것을 이유와 함께 3개 추천합니다. 점주는 점주 웹에서 메뉴·추천 정책·사진·통계를, 회사는 회사 관리자 웹에서 매장·점주·기기를 관리합니다.

전체 기획은 [프로젝트 구상안](docs/AI_보이스크_프로젝트_구상안.md), AI 기능의 설계와 구현 결정은 [AI 음성 주문 설계](docs/AI_VOICE_DESIGN.md)에 있습니다.

## 현재 상태 (2026-11-11)

| 영역 | 구현됨 | 남은 일 |
| --- | --- | --- |
| 키오스크 앱 | 터치 주문, 음성 주문(안드로이드 내장 STT·TTS), 필수 옵션(맵기·사이즈) 되묻기, 상황 추천(맞는 메뉴가 없으면 인기 메뉴)과 추가 제안, 시니어 모드, 4개 언어 화면(음성은 한국어), 메뉴 사진, 오프라인 메뉴 캐시와 주문 Outbox, 실시간 메뉴 동기화, 결제 중 가격 변경 시 재계산, 직원 호출, 무조작 시 처음 화면 복귀, 관리자 PIN 설정 화면, 사용성 측정 기록, 키오스크 모드(가로 고정·화면 켜짐·Lock Task·배터리 최적화 제외) | 실제 갤럭시 탭 마이크로 시연 검증, 실제 결제 |
| 음성 엔진 | Kotlin Flutter 플러그인(`SpeechRecognizer`, `TextToSpeech`), 버튼을 누른 동안만 청취 | |
| 서버 | 기기 토큰 인증 `/kiosk/*`, 음성 주문 해석(Claude Haiku), WebSocket 동기화, 주문 저장(음성/터치 구분, 추천 경유 기록), 추천 로그, 점주·회사 관리자 API | HTTPS(실매장 배치 시) |
| 점주 웹 | 매장·메뉴판·품절·주문 내역, 옵션 그룹(필수 선택), AI 추천·음성 설정(정책 프리셋), 메뉴 태그·동의어·원가율, 메뉴 사진, 통계, 직원 호출 알림, 기기 메뉴 버전 | |
| 회사 관리자 웹 | 매장·점주·기기·주문·장애 알림, 기기 토큰 발급, 기기 연결 상태·메뉴 버전 | |
| 평가 | 발화 67개 평가 세트, 추천 정책별 비교([결과](ml/voice_eval/REPORT.md)) | 실제 API 키 경로의 응답 시간 측정, 사용자 테스트 |
| 하드웨어 | | 케이스(팀원 담당) |

## 구성

```text
kiosk_app (Flutter, 태블릿) ──LAN, 기기 토큰──┐
owner_web (React, 노트북) ──────────────────┼─→ server (FastAPI) ─TLS─→ Azure MySQL (팀 공용)
company_admin_web (React, 노트북) ──────────┘          │
                                                      └─→ Claude Haiku (음성 주문 해석·추천 적합도)
```

- 키오스크와 웹은 DB에 직접 접속하지 않습니다. DB 비밀번호와 Claude API 키는 서버의 `server/.env`에만 있습니다.
- 음성은 태블릿 안에서 텍스트로 바뀌고, 서버로는 인식된 문장만 갑니다. 녹음 파일을 만들거나 발화 원문을 저장·기록하지 않습니다.
- 추천 순위는 키오스크의 추천 엔진이 정합니다. Haiku는 메뉴별 상황 적합도와 추천 이유만 내고, 엔진이 점주의 정책(고객 만족 ↔ 매장 수익), 원가율, 매장 추천, 품절·추천 제외를 반영해 3개를 고릅니다.
- 서버가 꺼지거나 LLM이 실패하면 터치 주문으로 안내합니다. 메뉴는 기기에 저장돼 있어 터치 주문은 계속되고, 주문은 서버가 돌아오면 순서대로 전송합니다.

## 폴더 구조

| 폴더 | 내용 | 안내 문서 |
| --- | --- | --- |
| [`server/`](server/) | FastAPI API (Python 3.14, PyMySQL, Anthropic SDK) | [README](server/README.md), [점주 API](server/OWNER_API.md), [AI DB 변경](server/AI_MIGRATION.md), [관리자 인증](server/AUTH.md) |
| [`kiosk_app/`](kiosk_app/) | Flutter 고객용 키오스크 앱 (Android) | [주문 화면](kiosk_app/lib/service/README.md) |
| [`packages/voice_engine/`](packages/voice_engine/) | 음성 엔진 Flutter 플러그인 (Kotlin) | [README](packages/voice_engine/README.md) |
| [`owner_web/`](owner_web/) | 점주 웹 (React 19 + TypeScript + Vite, 8081) | [README](owner_web/README.md) |
| [`company_admin_web/`](company_admin_web/) | 회사 관리자 웹 (React 19 + TypeScript + Vite, 8080) | [README](company_admin_web/README.md) |
| [`ml/voice_eval/`](ml/voice_eval/) | 음성 주문·추천 평가 세트와 결과 | [REPORT](ml/voice_eval/REPORT.md) |
| [`docs/`](docs/) | 구상안, AI 설계, 테이블 정의서 `AlVoisk.xlsx`, 초기 DDL `Voisk_DB.txt` | |
| `hardware/`, `admin_web/` | 케이스(팀원 담당), 이전 자리 | |
| `scripts/cloud/` | Claude Code 클라우드 세션용 설치 스크립트 | |

## 기술 스택

| 영역 | 사용 기술 |
| --- | --- |
| 키오스크 | Flutter 3.47 / Dart 3.13, `http`, `web_socket_channel`, `flutter_secure_storage`, 대상 기기 갤럭시 탭 A9+ |
| 음성 | Android `SpeechRecognizer`(ko-KR), `TextToSpeech`, Kotlin MethodChannel·EventChannel |
| 서버 | Python 3.14, FastAPI, Uvicorn, PyMySQL, Anthropic Python SDK, Argon2 |
| LLM | Claude Haiku (`claude-haiku-5-5`), 구조화 출력(JSON 스키마) |
| 웹 | Node.js 22.12 이상, React 19, TypeScript, Vite, Vitest, Testing Library |
| DB | Azure Database for MySQL 8.4 (TLS, UTC) |

## 시연 준비 (노트북 서버 + 태블릿)

명령은 Windows PowerShell 기준이고 저장소 최상위에서 시작합니다.

### 1. 서버

```powershell
cd server
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

`server/.env`를 만듭니다. **커밋하지 않습니다.** 전체 목록은 [server/README.md](server/README.md#환경-변수-serverenv-커밋하지-않음)에 있습니다.

```text
DB_HOST=...
DB_PORT=...
DB_NAME=...
DB_USER=...
DB_PASSWORD=...
ANTHROPIC_API_KEY=...        # 음성 주문. 없으면 키오스크가 터치 주문으로 안내
KIOSK_SAVE_DEMO_PAYMENTS=1   # 시연 결제를 주문으로 저장
KIOSK_SAVE_CASH_ORDERS=1     # 현금 주문 저장
ADMIN_AUTH_ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080,http://localhost:8081,http://127.0.0.1:8081
```

```powershell
.\.venv\Scripts\python.exe check_db.py
.\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8001 --workers 1
```

- 태블릿이 같은 Wi-Fi에서 접속하도록 `0.0.0.0`으로 엽니다. Windows 방화벽에서 8001 인바운드를 **개인 네트워크에만** 허용합니다.
- 점주·관리자 API는 노트북 자신(loopback)의 요청만 받으므로 웹은 노트북에서 엽니다.
- 시연용 HTTP입니다. 실제 매장에 둘 때는 HTTPS로 감싸야 합니다.

### 2. 웹

```powershell
cd company_admin_web; npm install; npm run dev   # http://127.0.0.1:8080
cd owner_web; npm install; npm run dev           # http://127.0.0.1:8081
```

회사 관리자 웹 → 기기 → 기기 상세에서 **기기 토큰 발급**을 누릅니다. 토큰은 그때 한 번만 보이니 바로 키오스크에 입력합니다. 다시 발급하면 이전 토큰은 무효입니다.

### 3. 키오스크 앱

```powershell
cd kiosk_app
flutter pub get
flutter run --release
```

앱의 주문 화면 왼쪽 아래 설정 메뉴 → **키오스크 설정**에서 처음에 관리자 PIN(숫자 4~8자리)을 만들고, 서버 주소(`http://<노트북 IP>:8001`), 매장 번호, 기기 번호, 기기 토큰을 넣습니다. 토큰은 안드로이드 Keystore로 암호화한 저장소에 둡니다. 이미 토큰이 있는 기기에서 PIN을 처음 만들 때는 그 토큰을 함께 입력해야 하고, 서버 주소를 바꾸면 토큰도 다시 입력해야 합니다.

같은 화면에서 Lock Task(앱 고정), 배터리 최적화 제외, 최근 주문 내역(전송 대기 주문 다시 보내기), 사용성 측정 평균(터치·음성 주문별 탭 수·소요 시간)을 봅니다. 빅스비 호출은 태블릿 설정에서 꺼 둡니다.

- 에뮬레이터에서는 서버 주소가 `http://10.0.2.2:8001`입니다. `--dart-define=MENU_API_BASE_URL=... --dart-define=STORE_ID=1 --dart-define=DEVICE_ID=1 --dart-define=DEVICE_TOKEN=...`로 넘길 수도 있습니다(설정 화면 값이 우선).
- 서버 설정 없이 실행하면 임시 메뉴로 터치 주문만 동작합니다.
- Windows에서 pub 캐시가 프로젝트와 다른 드라이브에 있으면 Kotlin 증분 컴파일이 실패할 수 있어 `android/gradle.properties`에 `kotlin.incremental=false`를 두었습니다. 같은 드라이브에 `PUB_CACHE`를 두면 더 빠릅니다.

## 음성 주문 흐름

1. 고객이 "말로 주문하기"를 누르면 안내 음성 뒤 마이크가 켜집니다. 화면에 "버튼을 누른 뒤의 음성만 처리하며 녹음·저장하지 않습니다"가 늘 보입니다.
2. 인식된 문장을 서버 `/kiosk/voice/interpret`로 보내면, 서버가 매장 메뉴(이름·동의어·옵션·태그)와 장바구니를 넣어 Haiku로 의도를 해석하고, 결과를 매장 메뉴와 다시 대조합니다.
3. "네", "아니요", "결제할게요"처럼 짧은 대답은 서버를 거치지 않고 키오스크가 바로 처리합니다.
4. 맵기·사이즈처럼 꼭 골라야 하는 옵션을 말하지 않았으면 그 옵션만 되묻고, 선택지를 화면 버튼으로도 보여 줍니다.
5. 주문·변경은 터치와 같은 명령(`OrderCommandBus`)으로 장바구니에 반영되고, 화면의 메뉴가 강조됩니다. 담은 뒤에는 점주 설정에 따라 함께 먹기 좋은 메뉴를 한 번 제안합니다.
6. 알아듣지 못하면 다시 묻고, 반복해서 실패하면 터치 주문이나 직원 호출로 안내합니다. 그 뒤 20초 동안 아무 입력이 없으면 음성 주문을 닫습니다.

평가 결과(67개 발화, 로컬 Claude Code 구독의 Haiku): 의도 분류 100%, 품목·수량 100%, 옵션 100%, 추천 적합률 100%. 추천 정책을 '고객 적합 우선 → 균형 → 매장 이익 우선'으로 바꾸면 1순위 평균 원가율이 31.6% → 27.1% → 23.5%로 내려가고 적합률은 그대로입니다. 응답 시간은 CLI 경유 평균 4.06초(p90 6.94초)로 구상안 목표 2초보다 깁니다. CLI 실행 비용이 포함된 값이라 실제 API 키 경로의 시간은 따로 재야 합니다.

에뮬레이터(디버그 빌드)에서 실제 메뉴를 받은 뒤 앱 메모리는 PSS 약 320~360MB로 목표(600MB 이하) 안입니다.

## 데이터베이스

초기 9개 테이블 설계는 [`docs/Voisk_DB.txt`](docs/Voisk_DB.txt)와 [`docs/AlVoisk.xlsx`](docs/AlVoisk.xlsx)에 있고, 운영 DB는 그 뒤에 바뀌었습니다. 실제 구조는 서버 코드와 아래 문서를 기준으로 봅니다.

- 팀원 변경: `kiosk_device`, `device_alert`, `order_item_option` 테이블, `orders.device_id`, `client_order_id`, `order_type`([ORDER_TYPE_MIGRATION.md](server/ORDER_TYPE_MIGRATION.md)).
- AI 기능 변경(2026-11-11, 백업 후 추가만): `store_ai_setting`, `menu_tag`, `menu_synonym`, `recommendation_log` 테이블, 메뉴 원가율·추천 제외·매장 추천, `kiosk_device.applied_menu_version`, `orders.order_channel`, `order_item.is_recommended`, 통계용 인덱스, `menu_option.option_group`(필수 옵션 그룹). 내용과 되돌리는 방법은 [AI_MIGRATION.md](server/AI_MIGRATION.md)에 있습니다.
- 시연 매장(store 1)에는 메뉴 40개와 태그·동의어·원가율, 필수 옵션(떡볶이·라면 맵기, 아메리카노 사이즈)을 넣었습니다(`server/seed_demo_ai.py`).
- 시연 메뉴 40개에는 Wikimedia Commons의 자유 라이선스 사진을 한 장씩 넣었습니다(`server/seed_menu_images.py`, 출처 목록 `server/menu_image_sources.json`, 저작자·라이선스 `server/menu_image_credits.md`). 사진 파일은 `server/media/menu/`에 저장되고 커밋하지 않으므로, 서버를 돌리는 PC에서 `seed_menu_images.py`를 한 번 실행합니다(사진이 있는 메뉴는 건너뜀).

**팀 공용 DB 사용 규칙**

- 시연 주문과 메뉴 데이터가 들어 있습니다. 주문 생성, 데이터 수정·삭제, `ALTER`·`DROP`·`TRUNCATE`는 팀 승인 뒤에만 합니다. 스키마 변경은 먼저 검토 문서로 제안합니다.
- FK에 ON DELETE 규칙이 없어 자식 행이 있는 행은 삭제되지 않습니다. 판매 중지는 `is_active = FALSE`로 합니다.
- 개발과 테스트는 SQLite 메모리 DB나 Mock으로 합니다.

## 테스트

모두 실제 DB와 Claude 없이 돕니다. 각 줄은 저장소 최상위에서 시작합니다.

```powershell
cd server; .\.venv\Scripts\python.exe -m unittest discover
cd kiosk_app; flutter analyze; flutter test test lib/home/tests lib/service/tests
cd packages\voice_engine; flutter test
cd owner_web; npm test; npm run build
cd company_admin_web; npm test; npm run build
```

음성 평가는 `server/.env`가 있는 PC의 저장소 최상위에서 실행합니다. 공용 DB의 메뉴를 읽기만 하고 아무것도 쓰지 않으며, 결과는 `ml/voice_eval/REPORT.md`에 씁니다.

```powershell
server\.venv\Scripts\python.exe ml\voice_eval\run_eval.py --backend api          # ANTHROPIC_API_KEY 필요
server\.venv\Scripts\python.exe ml\voice_eval\run_eval.py --backend claude_cli   # 개발 PC의 Claude Code 구독
```

## 보안 메모

- `.env`, 비밀번호, API 키, 기기 토큰은 코드·로그·PR 본문에 쓰지 않습니다. 웹의 `VITE_` 값은 브라우저에 노출되므로 비밀값을 넣지 않습니다.
- 기기 토큰은 DB에 해시로만 저장하고 상수 시간으로 비교합니다. 인증 실패가 반복되면 잠시 막습니다.
- 다른 점주의 매장·메뉴·주문은 없는 항목과 같은 404입니다.
- 기기 토큰이 무효가 돼도(재발급·비활성) 대기 중인 주문은 버리지 않고 보류했다가, 새 토큰을 넣으면 같은 주문 번호(UUID)로 다시 보냅니다.
- 회사 관리자가 점주 비밀번호를 재설정하면 그 점주의 기존 로그인은 바로 끊깁니다.

## 협업 규칙

- `main`에 직접 push하지 않고, 작업 브랜치에서 PR을 엽니다.
- 다른 팀원의 브랜치(`feature/*`, `integration/*`, `codex/*`)는 허락 없이 수정하거나 force push하지 않습니다.
- 코드 주석, 문서, 커밋 메시지는 한국어로 씁니다.
