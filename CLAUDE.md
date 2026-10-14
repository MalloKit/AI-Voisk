# CLAUDE.md

AI 음성 키오스크(AI-Voisk) 캡스톤 저장소. 5인 팀 프로젝트다.

## 응답
- 채팅 응답은 한국어로 쓴다. 코드, 식별자, 경로, 명령은 원문 그대로 둔다.
- 코드 주석, 문서, 커밋 메시지는 저장소의 기존 스타일(한국어)을 따른다.

## 구조
| 폴더 | 내용 | 안내 문서 |
|---|---|---|
| `server/` | FastAPI 메뉴·주문 API (Python 3.14, PyMySQL) | `server/README.md`, `server/MIDTERM_DEMO.md`, `server/ORDER_TYPE_MIGRATION.md` |
| `kiosk_app/` | Flutter 키오스크 앱 (Android) | `kiosk_app/lib/service/README.md` |
| `company_admin_web/` | 회사 관리자 웹 (React 19 + TypeScript + Vite, Node 22.12 이상) | `company_admin_web/README.md`, `company_admin_web/MIGRATION.md` |
| `admin_web/`, `ml/`, `packages/`, `hardware/` | 아직 비어 있음 | |
| `docs/` | 구상안, 테이블 정의서(`AlVoisk.xlsx`), 초기 DDL(`Voisk_DB.txt`) | |

- `docs/Voisk_DB.txt`는 초기 9개 테이블 DDL이다. 운영 DB는 그 뒤에 `kiosk_device`, `device_alert`, `order_item_option`이 추가되고 `orders`에 `device_id`, `client_order_id`, `order_type`이 생겼다. 실제 구조는 서버 코드와 `server/ORDER_TYPE_MIGRATION.md`를 기준으로 본다.
- 문서의 실행 명령은 Windows PowerShell 기준이다. 리눅스(클라우드 세션)에서는 `.venv/bin/python`처럼 경로를 바꿔 쓴다.

## 검증 명령 (실제 DB 없이 돈다)
- 서버: `cd server && .venv/bin/python -m unittest discover -v`
  - 테스트는 Azure 접속을 막고 SQLite 메모리 DB와 Mock으로 검증한다.
- 관리자 웹: `cd company_admin_web && npm test && npm run build`
- 키오스크: `cd kiosk_app && flutter analyze && flutter test test lib/home/tests lib/service/tests`
  - Flutter가 없는 환경이면 실행하지 못했다고 보고한다. 통과했다고 쓰지 않는다.

## 팀 공용 DB (Azure MySQL)
- 운영 DB는 Azure Database for MySQL 8.4 (`voisk`)이고 팀 전체가 같이 쓴다. 이미 시연 주문과 메뉴 데이터가 들어 있다.
- **공용 DB에 쓰지 않는다.** 주문 생성, 데이터 수정·삭제, `ALTER`, `DROP`, `TRUNCATE`는 사람이 승인한 뒤에만 한다. 스키마 변경은 `server/ORDER_TYPE_MIGRATION.md`처럼 검토 문서로 먼저 제안한다.
- 개발과 테스트는 SQLite 메모리 DB나 Mock으로 한다. 실제 MySQL 동작을 봐야 하면 로컬 MySQL 8.4 컨테이너를 쓴다.
- 서버 동작에서 알아둘 점:
  - 시간대는 UTC다.
  - TLS 접속만 된다.
  - FK에 ON DELETE 규칙이 없어 자식 행이 있으면 삭제가 거부된다. 판매 중지는 `is_active = FALSE`로 처리한다.

## 비밀값
- **`.env`(DB 비밀번호)는 커밋하지 않는다.** `server/.env`는 각자 PC에만 둔다. 접속 설정 이름은 `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, 선택 `DB_SSL_CA`이다.
- 비밀번호를 코드, 로그, PR 본문, 명령 출력에 쓰지 않는다.
- 키오스크 앱과 관리자 웹은 DB에 직접 접속하지 않는다. 관리자 웹의 `VITE_` 값은 브라우저에 노출되므로 비밀값을 넣지 않는다.

## 브랜치와 PR
- `main`에 직접 push하지 않는다. 작업 브랜치에서 PR을 연다.
- 다른 팀원 브랜치(`feature/*`, `integration/*`, `codex/*`)는 허락 없이 수정하거나 force push하지 않는다.
