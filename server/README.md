# AI 보이스크 서버

FastAPI 서버 하나가 키오스크 앱, 점주 웹, 회사 관리자 웹의 API를 모두 맡습니다. DB는 팀 공용 Azure MySQL 8.4(`voisk`, TLS, UTC)입니다. 음성 주문 해석은 서버가 Claude Haiku를 불러 처리하고, 키오스크와 웹에는 API 키나 DB 비밀번호가 없습니다.

## API 구성

| 경로 | 쓰는 쪽 | 인증 | 문서 |
| --- | --- | --- | --- |
| `/kiosk/*` | 키오스크 앱 | 기기 토큰(`X-Device-Id` + `Authorization: Bearer`) | 아래 "키오스크 API" |
| `/owner/*`, `/auth/owner/*` | 점주 웹 | 점주 세션 쿠키 + CSRF, loopback만 | [OWNER_API.md](OWNER_API.md) |
| `/admin/*`, `/auth/admin/*` | 회사 관리자 웹 | 관리자 세션 쿠키 + CSRF, loopback만 | [AUTH.md](AUTH.md) |
| `/stores/*`, `/orders`, `/menus` | 이전 키오스크 화면(중간 시연용) | 없음 | [MIDTERM_DEMO.md](MIDTERM_DEMO.md) |
| `/media/menu/*` | 키오스크·점주 웹 | 없음(메뉴 사진만 공개) | |

### 키오스크 API

| 메서드 | 경로 | 내용 |
| --- | --- | --- |
| GET | `/kiosk/bootstrap` | 매장 정보, 메뉴·옵션·태그·동의어·사진, AI 설정, 메뉴 버전 |
| GET | `/kiosk/menu-version` | 현재 메뉴 버전(가벼운 확인용) |
| POST | `/kiosk/heartbeat` | 적용한 메뉴 버전, 앱 버전, 상태 기록 |
| WS | `/kiosk/ws` | 메뉴가 바뀌면 `{"type":"menu_changed"}` 알림 |
| POST | `/kiosk/orders` | 주문 저장(`client_order_id`로 중복 방지, `order_channel` voice/touch) |
| POST | `/kiosk/payments/demo/{method}`(card·naverpay), `/kiosk/payments/cash/pending` | 시연 결제·현금 주문 저장(환경변수로 켬) |
| POST | `/kiosk/staff-call` | 직원 호출. 점주 웹에 알림 |
| POST | `/kiosk/voice/interpret` | 음성 인식 문장 → 주문 의도(JSON). 발화 원문은 저장·기록하지 않음 |
| POST | `/kiosk/rec-logs` | 추천 노출·선택 기록(통계용) |

- `/kiosk/bootstrap`에는 최근 30일 많이 팔린 메뉴 `popular_menu_ids`가 있습니다. 상황에 맞는 메뉴를 못 찾으면 키오스크가 이 메뉴부터 보여 줍니다.
- 주문 거절은 `detail: {code, message}`로 보냅니다. `amount_mismatch`(결제 중 가격 변경), `menu_unavailable`, `option_unavailable`, `option_required`면 키오스크가 최신 메뉴로 장바구니를 다시 계산하게 안내합니다.
- 기기 토큰은 회사 관리자 웹의 기기 상세에서 발급합니다(`POST /admin/devices/{id}/token`). DB에는 SHA-256 해시만 저장하고, 원문은 발급 화면에서 한 번만 보입니다. 다시 발급하면 이전 토큰은 바로 무효입니다.
- 인증 실패는 접속 주소·기기 번호 조합마다 60초에 10회까지이고, 넘으면 429입니다. 음성 해석은 기기당 분당 30회입니다.
- `/kiosk/*` POST 본문은 64KB 이하이고, 크기를 밝히지 않은 요청은 인증 전에 413입니다. 응답은 모두 `no-store`입니다.

## 환경 변수 (`server/.env`, 커밋하지 않음)

| 이름 | 필수 | 뜻 |
| --- | --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | 예 | Azure MySQL 접속 |
| `DB_SSL_CA` | | 별도 CA 파일이 필요한 환경 |
| `ANTHROPIC_API_KEY` | 음성 주문 | Claude API 키. 없으면 음성 해석이 503(`voice_unavailable`)이고 키오스크는 터치 주문으로 안내 |
| `VOICE_LLM_MODEL` | | 기본 `claude-haiku-5-5` |
| `VOICE_LLM_BACKEND` | | 기본 `api`. `claude_cli`는 개발 PC의 Claude Code 구독으로 같은 프롬프트를 돌리는 테스트 전용 |
| `CLAUDE_CLI_PATH` | | `claude_cli`일 때 `claude.exe` 경로(없으면 npm 전역 설치 위치에서 찾음) |
| `KIOSK_SAVE_DEMO_PAYMENTS=1` | 시연 | 카드·네이버페이 시연 결제를 주문으로 저장 |
| `KIOSK_SAVE_CASH_ORDERS=1` | 시연 | 현금 주문 저장과 관리자 현금 수령 확인 |
| `ADMIN_AUTH_ALLOWED_ORIGINS` | 웹 | 관리자·점주 웹 주소(쉼표 구분). [OWNER_API.md](OWNER_API.md#허용-출처) |
| `ADMIN_AUTH_MODE` | | `local`(기본) 또는 `https` |
| `VOISK_MEDIA_ROOT` | | 메뉴 사진 저장 위치(기본 `server/media`) |

## 설치·실행 (Windows PowerShell)

```powershell
cd server
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe check_db.py
```

노트북 하나를 매장 서버로 쓰는 시연에서는 같은 Wi-Fi의 태블릿이 접속하도록 모든 주소에서 받습니다.

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8001 --workers 1
```

- 세션이 메모리에 있으므로 worker는 1개로 둡니다. 재시작하면 웹은 다시 로그인합니다.
- `/owner/*`, `/admin/*`와 기기 토큰 없는 이전 경로(`/orders`, `/stores/*`, `/payments/*`, `/db/health`)는 loopback 요청만 받습니다. 그래서 `0.0.0.0`으로 열어도 웹 관리 기능은 노트북에서만 쓸 수 있습니다. 이 경로들은 Host 헤더도 `127.0.0.1`·`localhost`·`10.0.2.2`(에뮬레이터)만 받아 DNS 리바인딩을 막습니다.
- 태블릿 접속을 위해 Windows 방화벽에서 8001 인바운드를 "개인 네트워크"에만 허용합니다. 공용 Wi-Fi에서는 열지 않습니다.
- 시연용 HTTP입니다. 실제 매장에 둘 때는 HTTPS(리버스 프록시)로 감싸야 기기 토큰이 평문으로 지나가지 않습니다.

## DB 변경과 시연 데이터

- AI 기능 테이블·열은 [AI_MIGRATION.md](AI_MIGRATION.md)에 있습니다(2026-11-11 공용 DB에 적용, 백업 후 추가만). `ai_migration.py --backup`, `--apply`로 다른 DB에도 같은 순서로 적용합니다.
- `seed_demo_ai.py`는 시연 매장에 메뉴 40개, 태그, 동의어, 원가율을 넣습니다. 여러 번 실행해도 같은 결과입니다.
- 주문 방식 열 `orders.order_type`은 [ORDER_TYPE_MIGRATION.md](ORDER_TYPE_MIGRATION.md)를 봅니다.
- FK에 ON DELETE 규칙이 없으므로 판매 중지는 `is_active = FALSE`로 합니다.

## 음성 주문 해석

`voice_service.py`가 매장 메뉴 목록(이름, 동의어, 옵션, 태그)과 장바구니를 시스템 프롬프트로 주고, 구조화 출력(JSON 스키마)으로 의도를 받습니다.

- 옵션 이름 뒤 `[그룹]`은 필수 옵션입니다. 고객이 말한 것만 담고, 같은 그룹에서 둘을 고르면 서버가 처음 것만 남깁니다. 말하지 않은 필수 그룹은 키오스크가 되묻습니다.
- 의도: `order`, `recommend`, `select`, `modify`, `remove`, `clear`, `confirm`, `deny`, `checkout`, `cancel`, `help`, `clarify`, `unknown`
- 서버가 결과를 다시 검사합니다. 매장에 없는 메뉴·옵션, 품절·추천 제외 메뉴, 범위 밖 수량은 버리고, 상황 태그는 매장 메뉴 태그에 있는 값만 남깁니다.
- LLM이 실패하거나 시간이 넘으면 503 `{ code: "voice_unavailable" }`를 돌려주고 키오스크는 터치 주문으로 안내합니다. 기기당 분당 30회를 넘으면 429입니다.
- 발화 원문은 DB와 로그에 남기지 않습니다.

평가 세트와 결과는 [`ml/voice_eval/REPORT.md`](../ml/voice_eval/REPORT.md)에 있습니다.

## 테스트

```powershell
cd server
.\.venv\Scripts\python.exe -m unittest discover
```

- Azure와 Claude API·CLI 접속을 막고, SQLite 메모리 DB와 Mock으로 실제 SQL을 실행해 검증합니다.
- SQLite는 MySQL의 행 잠금, 콜레이션, CHECK를 대신하지 않습니다.

## 파일

| 파일 | 역할 |
| --- | --- |
| `main.py` | 앱 조립, 공통 미들웨어(본문 크기, no-store, CORS), 이전 API |
| `kiosk_router.py` | `/kiosk/*` |
| `device_auth.py` | 기기 토큰 발급·검증, 실패 제한 |
| `kiosk_catalog.py` | 키오스크용 메뉴판·설정 읽기와 캐시 |
| `voice_service.py` | 음성 주문 해석(Claude) |
| `sync_hub.py` | 매장별 WebSocket 알림 |
| `owner_router.py`, `owner_*_service.py`, `owner_auth.py` | 점주 API |
| `owner_ai_service.py`, `menu_image_service.py` | 점주 AI 설정·통계·직원 호출, 메뉴 사진 |
| `admin_auth.py`, `*_service.py`, `*_write_service.py` | 회사 관리자 API |
| `order_service.py` | 주문 저장·조회 |
| `ai_db.py`, `ai_migration.py`, `seed_demo_ai.py` | AI 스키마 확인, DB 변경, 시연 데이터 |
| `database.py`, `check_db.py` | TLS 접속, 접속 확인(비밀번호 출력 안 함) |
| `test_*.py`, `*_test_support.py` | 자동 테스트 |
