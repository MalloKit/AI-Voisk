# AI 보이스크 (AI-Voisk)

> 말로 주문하고, 상황에 맞는 메뉴를 추천받는 AI 음성 키오스크
> 2026-2 캡스톤디자인 · Team Mallo(말로) · 5인 팀

고객은 태블릿 키오스크에서 터치나 음성("말로야 주문")으로 주문하고, 회사·점주는 웹 관리자 화면에서 매장·주문·기기를 관리하는 것을 목표로 합니다.
전체 기획(배경, 사용자 시나리오, 호출어 설계, 기능 목록)은 [프로젝트 구상안](docs/AI_보이스크_프로젝트_구상안.md)에 있습니다.

## 현재 진행 상황

중간 시연 기준으로 **터치 주문 → 서버 저장 → 회사 관리자 주문 조회** 흐름이 동작합니다.

| 영역 | 구현됨 | 아직 없음 |
| --- | --- | --- |
| 키오스크 앱 | 포장/매장 식사 선택, 카테고리·메뉴·옵션 선택, 장바구니 수정, 글자 크기 조절, DB 메뉴 조회, 주문 전송과 재시도 | 음성 주문(STT/TTS), 호출어, AI 추천, 실제 결제, 실제 태블릿 검증 |
| 서버 | 매장·메뉴·옵션 조회, 주문 저장(중복 방지·DB 가격 계산), 관리자 주문 목록·상세 | 인증, HTTPS, 점주 메뉴 관리, 매장 관리 API |
| 회사 관리자 웹 | 주문 조회(실제 API), 운영 요약·매장·점주·기기·장애/알림 화면(Mock 데이터) | 로그인·권한, 주문 외 화면의 실제 API 연결 |
| 점주 관리자 웹, AI 모델, 음성 엔진, 하드웨어 | — | 폴더만 있음 |

## 구성

```text
kiosk_app (Flutter, Android 태블릿)  ─┐
                                      ├─ HTTP ─→  server (FastAPI) ─ TLS ─→  Azure MySQL (팀 공용 DB)
company_admin_web (React, 브라우저)  ─┘
```

키오스크 앱과 관리자 웹은 DB에 직접 접속하지 않고 항상 서버 API를 거칩니다.

## 폴더 구조

| 폴더 | 내용 | 안내 문서 |
| --- | --- | --- |
| [`server/`](server/) | FastAPI 메뉴·주문 API (Python 3.14, PyMySQL) | [README](server/README.md), [중간 시연](server/MIDTERM_DEMO.md), [주문 유형 변경안](server/ORDER_TYPE_MIGRATION.md) |
| [`kiosk_app/`](kiosk_app/) | Flutter 고객용 키오스크 앱 (Android) | [시작 화면](kiosk_app/lib/home/README.md), [주문 화면](kiosk_app/lib/service/README.md) |
| [`company_admin_web/`](company_admin_web/) | 회사 관리자 웹 (React 19 + TypeScript + Vite) | [README](company_admin_web/README.md), [Flutter→React 전환 기록](company_admin_web/MIGRATION.md) |
| `admin_web/` | 점주 관리자 웹 (예정) | |
| `ml/` | AI 추천·자연어 처리 모델 (예정) | |
| `packages/voice_engine/`, `packages/shared/` | 음성 엔진, 공통 코드 (예정) | |
| `hardware/` | 키오스크 케이스 등 하드웨어 (예정) | |
| [`docs/`](docs/) | 구상안, 테이블 정의서 `AlVoisk.xlsx`, 초기 DDL `Voisk_DB.txt` | |
| `scripts/cloud/` | Claude Code 클라우드 세션용 설치 스크립트 | |

## 기술 스택

| 영역 | 사용 기술 |
| --- | --- |
| 키오스크 | Flutter (Dart SDK ^3.13), `http` 패키지, 대상 기기 갤럭시 탭 A9+ |
| 서버 | Python 3.14, FastAPI, Uvicorn, PyMySQL, python-dotenv, uv |
| 회사 관리자 웹 | Node.js 22.12 이상, React 19, TypeScript, Vite, Vitest, Testing Library |
| DB | Azure Database for MySQL 8.4 (TLS 접속, 시간대 UTC) |

## 빠른 시작

아래 명령은 Windows PowerShell 기준입니다. 저장소 위치가 `C:\AI-Voisk`라고 가정합니다.

### 1. 서버

처음 한 번은 가상 환경을 만들고 의존성을 설치합니다.

```powershell
cd C:\AI-Voisk\server
uv venv --python 3.14 .venv
uv pip install --python .venv/Scripts/python.exe -r requirements.txt
```

`server/.env`에 DB 접속 설정을 넣습니다. 이 파일은 각자 PC에만 두고 **커밋하지 않습니다.**

```text
DB_HOST=...
DB_PORT=...
DB_NAME=...
DB_USER=...
DB_PASSWORD=...
# 선택: 별도 신뢰 인증서가 필요한 환경
DB_SSL_CA=...
```

서버를 실행합니다.

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001
```

http://127.0.0.1:8001/docs 에서 API를 시험할 수 있습니다. `check_db.py`를 실행하면 비밀번호를 출력하지 않고 DB 연결만 확인합니다.

### 2. 키오스크 앱 (Android 에뮬레이터)

서버를 켜 둔 채 다른 터미널에서 실행합니다. `10.0.2.2`는 에뮬레이터에서 PC의 서버로 접속하는 주소입니다.

```powershell
cd C:\AI-Voisk\kiosk_app
flutter run -t lib/main_preview.dart `
  --dart-define=MENU_API_BASE_URL=http://10.0.2.2:8001 `
  --dart-define=ORDER_API_BASE_URL=http://10.0.2.2:8001 `
  --dart-define=STORE_ID=1 --dart-define=DEVICE_ID=1
```

- `dart-define` 없이 `flutter run -t lib/main_preview.dart`로 실행하면 서버 없이 임시 메뉴로 동작합니다.
- `STORE_ID=1`, `DEVICE_ID=1`은 공용 DB에 등록된 시연 매장·기기입니다.

### 3. 회사 관리자 웹

```powershell
cd C:\AI-Voisk\company_admin_web
npm install
npm run dev
```

http://127.0.0.1:8080 으로 접속합니다. 주문 화면은 8001번 서버에서 실제 주문을 가져옵니다.
주소를 바꾸려면 `.env.example`을 참고해 개인 `.env.local`에 `VITE_ORDER_API_BASE_URL`을 넣습니다. Mock 주문을 보려면 `VITE_ORDER_SOURCE=mock`을 넣습니다.

## API 요약

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/health` | 서버 상태 (DB 연결과는 무관) |
| GET | `/menus` | 임시 메뉴 14개 (`category`로 필터) |
| GET | `/db/health` | DB 접속 확인 |
| GET | `/stores` | 매장 목록 |
| GET | `/stores/{store_id}/menus` | 매장의 활성 메뉴와 옵션 (품절 포함) |
| POST | `/orders` | 주문 저장 (로컬 요청만 허용) |
| GET | `/admin/orders?limit=&offset=` | 주문 목록, 최대 200건씩 (로컬 요청만 허용) |
| GET | `/admin/orders/{order_id}` | 주문 상세: 메뉴·수량·옵션 (로컬 요청만 허용) |

주문 API의 동작은 [server/MIDTERM_DEMO.md](server/MIDTERM_DEMO.md)에 자세히 있습니다.

- 가격은 서버가 DB에서 계산합니다. 요청에 가격을 넣으면 거절합니다.
- 키오스크가 만든 UUID `client_order_id`로 같은 주문이 두 번 저장되지 않게 막습니다.

현재 서버에는 인증이 없습니다. 그래서 주문·관리자 API는 `127.0.0.1`에서 온 요청만 받고, CORS도 `localhost:8080`만 허용합니다. **공인 주소나 터널로 공개하지 마세요.**

## 데이터베이스

초기 9개 테이블 설계는 [`docs/Voisk_DB.txt`](docs/Voisk_DB.txt)와 [`docs/AlVoisk.xlsx`](docs/AlVoisk.xlsx)에 있습니다. 대상 테이블은 `admin`, `owner`, `store`, `category`, `menu`, `menu_option`, `menu_img`, `orders`, `order_item`입니다.
운영 DB는 그 뒤에 바뀌었습니다.

- `kiosk_device`, `device_alert`, `order_item_option` 테이블이 추가됐습니다.
- `orders`에 `device_id`, `client_order_id`, `order_type` 컬럼이 추가됐습니다.

현재 서버는 `orders.order_type` 컬럼이 있고 `table_no`가 NULL을 허용해야만 주문을 저장합니다. 조건이 맞지 않으면 503을 돌려주고 저장하지 않습니다. 변경 절차와 확인 SQL은 [ORDER_TYPE_MIGRATION.md](server/ORDER_TYPE_MIGRATION.md)에 있습니다.
실제 구조는 서버 코드(`server/database.py`, `server/order_service.py`)를 기준으로 봅니다.

**팀 공용 DB 사용 규칙**

- 공용 DB에 시연 주문과 메뉴 데이터가 이미 들어 있습니다. 주문 생성, 데이터 수정·삭제, `ALTER`·`DROP`·`TRUNCATE`는 팀 승인 뒤에만 합니다.
- 스키마 변경은 먼저 검토 문서로 제안합니다.
- FK에 ON DELETE 규칙이 없어서, 자식 행이 있는 행은 삭제되지 않습니다. 판매 중지는 `is_active = FALSE`로 처리합니다.
- 개발과 테스트는 SQLite 메모리 DB나 Mock으로 합니다. 실제 MySQL 동작을 확인해야 하면 로컬 MySQL 8.4 컨테이너를 씁니다.

## 테스트

아래 테스트는 모두 실제 DB 없이 돕니다. 서버 테스트는 외부 DB 접속을 막고 SQLite 메모리 DB로 검증합니다.

```powershell
# 서버
cd server
.\.venv\Scripts\python.exe -m unittest discover -v

# 키오스크
cd kiosk_app
flutter analyze
flutter test test lib/home/tests lib/service/tests

# 회사 관리자 웹
cd company_admin_web
npm test
npm run build
```

서버와 키오스크를 HTTP로 실제로 연결해 보는 테스트도 있습니다. 메모리 서버 `server/test_demo_server.py`를 쓰므로 DB에 기록하지 않습니다. 실행 순서는 [MIDTERM_DEMO.md](server/MIDTERM_DEMO.md#db에-쓰지-않는-검증)에 있습니다.
같은 문서의 관리자 웹 명령은 Flutter 시절 기준입니다. 지금 관리자 웹에서 실제 API를 확인할 때는 `npm run test:live`를 씁니다. 이 명령은 로컬 서버가 켜져 있어야 하고 GET만 호출합니다.

## 협업 규칙

- `main`에 직접 push하지 않고, 작업 브랜치에서 PR을 엽니다.
- 다른 팀원의 브랜치(`feature/*`, `integration/*`, `codex/*`)는 허락 없이 수정하거나 force push하지 않습니다.
- `.env`, 비밀번호, DB 접속 정보는 코드·로그·PR 본문에 쓰지 않습니다. 관리자 웹의 `VITE_` 값은 브라우저에 노출되므로 비밀값을 넣지 않습니다.
- 코드 주석, 문서, 커밋 메시지는 한국어로 씁니다.
