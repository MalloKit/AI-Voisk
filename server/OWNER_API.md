# 점주 API 계약

점주 웹(`owner_web`)이 쓰는 인증과 업무 API입니다. 구현은 `owner_auth.py`(로그인·비밀번호 변경), `owner_router.py`, `owner_portal_service.py`, `owner_menu_write_service.py`입니다. 회사 관리자 API(`/admin/*`, `/auth/admin/*`)와 키오스크 API(`/stores/*`, `/orders`)의 동작은 바꾸지 않았고, `admin_auth.py`는 수정 없이 import해서 씁니다. AI 기능(추천 설정, 메뉴 태그·동의어, 통계, 직원 호출, 메뉴 사진)은 `owner_ai_service.py`, `menu_image_service.py`에 있고, 필요한 테이블·열은 `AI_MIGRATION.md`로 추가합니다.

## 공통 규칙

- `/owner/*`, `/auth/owner/*`는 `/admin/*`처럼 loopback 요청만 받습니다. 그 밖의 주소는 403입니다.
- 모든 응답은 `Cache-Control: no-store`입니다. 시각은 UTC ISO 8601(`+00:00`)입니다.
- 모든 쓰기는 허용된 `Origin`과 `X-CSRF-Token`이 필요합니다. 토큰은 `GET /auth/owner/csrf`로 받습니다.
- 브라우저는 `credentials: "include"`로 요청합니다.
- `store.owner_id`가 로그인한 점주가 아닌 매장·메뉴·옵션·주문은 없는 항목과 똑같이 404입니다. 소유는 요청마다 DB에서 확인하므로 매장 연결이 바뀌면 다음 요청부터 반영됩니다.

| 상태 | 뜻 | 점주 웹 처리 |
| --- | --- | --- |
| 401 | 세션 없음·만료, 로그인 실패, 비밀번호 변경 때 현재 비밀번호 틀림 | 로그인 화면으로 이동(현재 비밀번호 틀림은 `me`로 세션을 확인해 구분하고 화면에 남음) |
| 403 | Origin·CSRF·역할·원격 접속, 임시 비밀번호 세션의 `/owner/*` | 오류 문구, 로그인 유지 |
| 404 | 없거나 다른 점주의 항목 | 오류 문구 |
| 409 | 메뉴가 남은 카테고리 삭제, FK 충돌 | 서버 문구 표시, 전체 롤백됨 |
| 413 | 본문 크기 초과(인증 8KB, 업무 1MB) | 오류 문구 |
| 422 | 입력 형식·범위. 입력값을 응답에 반사하지 않음 | 서버 문구 표시 |
| 429 | 로그인·비밀번호 변경 시도 제한(접속 주소별 60초 5회, 둘이 같은 제한을 씀) | 오류 문구 |
| 503 | DB 오류·커밋 결과 불명. 내부 정보 없음 | 서버 문구와 다시 시도 |

## 인증 `/auth/owner`

세션·CSRF·Argon2id 검증·시도 제한은 `admin_auth.py` 구현을 재사용합니다. 세션 저장소, 시도 제한 인스턴스, 쿠키는 회사 관리자와 분리합니다. 쿠키 이름은 `voisk_owner_local`(local 모드), `__Host-voisk_owner`(https 모드)이고, 점주 세션으로 `/admin/*`을, 관리자 세션으로 `/owner/*`를 쓸 수 없습니다. 세션은 메모리에 있으므로 서버는 worker 1개로 실행하고 재시작하면 다시 로그인합니다. 수명은 비활동 30분, 절대 8시간이고 `me` 확인만으로는 연장되지 않습니다.

| 메서드 | 경로 | 요청 | 성공 |
| --- | --- | --- | --- |
| GET | `/csrf` | 없음 | `{ "csrf_token": "…" }` 익명 세션 또는 현재 세션의 토큰 |
| POST | `/login` | `{ "login_id", "password" }`만 허용, CSRF | 점주 객체. 세션과 CSRF를 새로 발급 |
| GET | `/me` | 세션 | 점주 객체. 매장 목록은 매번 DB에서 읽음 |
| POST | `/logout` | CSRF | 204, 세션 폐기·쿠키 삭제 |
| POST | `/password` | `{ "current_password", "new_password" }`만 허용, 로그인 세션, CSRF | 점주 객체. 다른 세션을 끊고 현재 세션을 새로 발급 |

```json
{ "owner": { "owner_id": 7, "login_id": "kim.owner", "role": "owner",
             "stores": [{ "store_id": 1, "store_name": "본점" }],
             "password_change_required": false } }
```

`owner.own_login_id`, `owner.own_pw`로 검증합니다. 없는 ID와 틀린 비밀번호는 같은 401입니다. 평문 등 정책에 맞지 않는 저장값은 로그인되지 않고, 로그인 때 재해시나 DB 쓰기는 없습니다.

### 비밀번호 변경 `POST /auth/owner/password`

로그인한 점주가 자기 비밀번호를 바꿉니다. 회사 관리자의 비밀번호 초기화(`PATCH /admin/owners/{id}/password`)는 그대로입니다.

1. 로그인 세션과 CSRF를 미들웨어에서 먼저 확인합니다. 로그인하지 않았으면 본문과 상관없이 401, Origin·CSRF가 틀리면 403입니다.
2. 본문은 `current_password`, `new_password`(각 1~1024자)만 받습니다. 다른 필드(예: 새 비밀번호 확인 값)가 있으면 422이고, 응답에 입력값을 싣지 않습니다. 확인 값 비교는 점주 웹 화면에서만 합니다.
3. 새 비밀번호는 회사 관리자의 점주 비밀번호 정책(`owner_write_service.OwnerPassword`: 8~128자, 공백만·제어 문자 금지)을 그대로 씁니다. 어기면 422입니다. 현재 비밀번호와 같아도 422입니다.
4. 여기까지 통과한 요청만 로그인과 같은 시도 제한(`owner_auth.attempts`, 접속 주소별 60초 5회)에 셉니다. 넘으면 429와 `Retry-After: 60`입니다.
5. 해시는 회사 관리자와 같은 `owner_write_service._password_hash`(Argon2id)로 만듭니다.
6. `credential_lock` 안에서 트랜잭션을 열고 `owner` 행을 `FOR UPDATE`로 읽어 `admin_auth.verify_password`로 현재 비밀번호를 확인합니다. 틀리면 401 "현재 비밀번호가 올바르지 않습니다."이고 세션은 유지됩니다. 새 비밀번호가 연결 매장의 전화번호 초기화 값과 같으면 422입니다(바꾼 뒤에도 임시 비밀번호로 판정되는 것을 막음).
7. `UPDATE owner SET own_pw = %s WHERE owner_id = %s`만 실행하고 영향 행이 1개가 아니면 롤백하고 503입니다. 테이블 구조와 다른 열은 바꾸지 않습니다.
8. 커밋 뒤 이 점주의 세션을 모두 끊고(`revoke_matching`, 다른 기기 포함) 현재 브라우저에 새 세션 쿠키를 발급합니다. 새 세션은 `password_change_required: false`입니다. CSRF 토큰도 새 세션 것으로 바뀌므로 다음 쓰기 전에 `/csrf`를 다시 받습니다.

계정이 그사이 삭제됐으면 401, DB 오류·커밋 실패는 503이며 비밀번호는 그대로입니다.

### 임시 비밀번호 판단

`owner` 테이블에 임시 여부 칸이 없으므로 테이블을 바꾸지 않고 로그인할 때 판단합니다.

- 로그인 비밀번호 검증이 성공하면, 입력한 비밀번호가 그 점주에게 연결된 매장 중 하나의 `phone_password(store_phone)`(전화번호 숫자 마지막 8자리, 회사 관리자의 '매장 전화번호로 초기화'와 같은 함수) 값과 같은지 비교합니다. 숫자가 8자리 미만인 번호는 건너뜁니다. 다른 점주 매장의 번호는 보지 않습니다.
- 같으면 세션의 `Owner.password_change_required`를 `True`로 둡니다. 세션과 로그에는 이 결과만 남기고 비밀번호 원문은 남기지 않습니다. login·me 응답의 `password_change_required`가 이 값입니다.
- 이 세션으로 `/owner/*`를 요청하면 미들웨어와 라우터 모두 403 "임시 비밀번호를 먼저 변경해 주세요."를 돌려줍니다. `/auth/owner/password`, `/me`, `/csrf`, `/logout`은 쓸 수 있습니다.
- 비밀번호를 바꾸면 새 세션은 `False`이므로 바로 `/owner/*`를 쓸 수 있습니다.
- 점주가 직접 고른 비밀번호가 우연히 연결 매장 전화번호 끝 8자리와 같아도 임시로 봅니다. 그런 값은 비밀번호 변경에서 받지 않습니다.

## 조회

| 경로 | 응답 |
| --- | --- |
| `GET /owner/stores/{id}` | `store_id, store_name, address, address_detail, store_code, phone, business_no, representative, store_type, admin_id, owner_id, owner_login_id` |
| `GET /owner/stores/{id}/menu-board` | 아래 메뉴판. `is_active=false` 포함 |
| `GET /owner/stores/{id}/orders?limit=100&offset=0` | `{ orders, total, limit, offset }`. limit 1~200, 최신순 |
| `GET /owner/stores/{id}/orders/{order_id}` | 주문 하나. 이 매장의 주문이 아니면 404 |
| `GET /owner/stores/{id}/devices` | `{ devices: [{ device_id, device_code, is_active, last_seen_at, app_version, last_synced_at, current_menu_version, applied_menu_version }] }`. 열이 없는 DB에서는 뒤의 넷이 null |

메뉴판:

```json
{
  "categories": [{ "category_id": 1, "store_id": 1, "category_name": "식사", "category_sort": 1 }],
  "menus": [{ "menu_id": 10, "category_id": 1, "menu_name": "덮밥", "menu_price": 9000, "menu_description": null,
              "is_active": true, "is_sold_out": false, "menu_sort": 1 }],
  "options": [{ "option_id": 100, "menu_id": 10, "option_name": "곱빼기", "extra_price": 1000,
                "is_active": true, "is_sold_out": false, "menu_option_sort": 1 }]
}
```

주문:

```json
{
  "order_id": 1000, "store_id": 1, "ordered_at": "2026-10-29T01:00:00+00:00", "table_no": null,
  "order_type": "takeaway", "device_id": 70, "client_order_id": "…", "quantity": 2,
  "items": [{ "item_id": 5000, "menu_id": 10, "menu_name": "덮밥", "quantity": 2, "legacy_option_id": null,
              "options": [{ "option_id": 100, "name": "곱빼기", "extra_price": 1000 }] }]
}
```

- `options`는 `order_item_option`에서 읽습니다. 이전 단일 옵션 열 `order_item.option_id`는 `legacy_option_id`로 따로 내려 주고, 점주 웹이 둘을 합쳐 표시합니다.
- `order_type`이 NULL인 이전 주문은 `order_service`와 같이 `table_no`로 해석합니다.
- `device_token_hash`는 SQL로 읽지 않고 응답 모델에도 없습니다. `last_seen_at`은 온라인 여부를 뜻하지 않으므로 점주 웹은 연결 상태를 "미확인"으로 표시합니다(`company_admin_web/DEVICE_API.md`와 같은 기준).

## 메뉴판 저장 `PATCH /owner/stores/{id}/menu-board`

저장 바의 변경 묶음을 한 트랜잭션으로 저장합니다. 모르는 필드는 422입니다. 음수 id는 같은 묶음에서 새로 만드는 행의 임시 id이며 `category_id`, `menu_id`가 이를 가리킬 수 있습니다.

```json
{
  "categories": {
    "create": [{ "temp_id": -1, "name": "신규", "sort": 1 }],
    "update": [{ "id": 2, "name": "음료", "sort": 2 }],
    "remove": [3]
  },
  "menus": {
    "create": [{ "temp_id": -2, "category_id": -1, "name": "새 메뉴", "price": 1000, "description": null,
                 "is_active": true, "is_sold_out": false, "sort": 1 }],
    "update": [{ "id": 10, "category_id": -1, "name": "덮밥", "price": 9000, "description": null,
                 "is_active": false, "sort": 2 }]
  },
  "options": {
    "create": [{ "temp_id": -3, "menu_id": -2, "name": "곱빼기", "extra_price": 0, "is_sold_out": false, "sort": 1 }],
    "update": [{ "id": 100, "name": "곱빼기", "extra_price": 1000, "is_active": false, "sort": 1 }]
  }
}
```

성공 응답은 저장 뒤 전체 메뉴판과 임시 id 대응표입니다.

```json
{ "board": { "categories": [], "menus": [], "options": [] }, "ids": { "-1": 12, "-2": 55, "-3": 301 }, "devices_updated": 2 }
```

검증: 이름은 앞뒤 공백을 지운 뒤 카테고리 1~100자, 메뉴·옵션 1~50자이고 제어 문자는 받지 않습니다. 설명은 500자 이하입니다. 메뉴 가격은 1~1,000,000, 옵션 추가 금액은 0~1,000,000, sort는 1 이상의 정수입니다. 숫자·불리언은 엄격하게 검사합니다(`"9000"`, `1`은 422). 같은 항목을 두 번 바꾸거나, 삭제하는 카테고리를 수정하거나, 없는 임시 id를 가리키면 422입니다. 저장 뒤 매장 안에 같은 이름의 카테고리가 남으면 422입니다. 키오스크가 카테고리를 이름으로 묶기 때문입니다. 다른 매장 또는 없는 행을 가리키면 404입니다.

처리 순서:

1. 별도 읽기 트랜잭션에서 소유를 확인합니다.
2. 이 매장 `kiosk_device` 행, `store` 행 순서로 잠급니다. `POST /orders`가 기기 → 메뉴 → (FK로) 매장 순서이므로 교착을 피하는 순서입니다.
3. 카테고리 생성·수정 → 메뉴 생성·수정 → 옵션 생성·수정 → 카테고리 삭제. 메뉴를 옮긴 뒤 빈 카테고리를 같은 묶음에서 지울 수 있습니다.
4. `category_sort`, 카테고리별 `menu_sort`, 메뉴별 `menu_option_sort`를 서버에서 1부터 다시 매깁니다. 클라이언트 값은 순서를 정하는 데만 씁니다. 판매 중지 행도 번호에 포함합니다.
5. 이 매장 모든 기기의 `current_menu_version`을 1 올리고 커밋합니다.

어느 단계든 실패하면 전부 롤백합니다. 변경이 하나도 없는 묶음은 쓰지 않고 버전도 올리지 않습니다.

삭제 규칙: 메뉴·옵션은 삭제하지 않고 `is_active=false`로만 처리합니다. `is_active=true`로 다시 보내면 다시 판매합니다. 카테고리는 판매 중지 메뉴까지 포함해 메뉴가 하나도 없을 때만 삭제하며, 남아 있으면 409입니다. `orders`, `order_item`, `order_item_option`, `owner`, `store`에는 쓰지 않습니다.

### 옵션 그룹(필수 선택)

메뉴판의 옵션에는 `option_group`(문자열 또는 null)이 있습니다. 저장할 때 옵션 `create`·`update`에 `group`(앞뒤 공백 제거, 20자 이하, 빈 값은 null)을 보냅니다. `update`에서 `group`을 아예 보내지 않으면 기존 값을 유지합니다.

- 같은 메뉴에서 그룹 이름이 같은 옵션들은 **하나를 꼭 고르는** 필수 선택입니다(예: 맵기 순한맛/보통맛/매운맛, 사이즈 레귤러/라지).
- 그룹이 null인 옵션은 여러 개를 자유롭게 더하는 추가 옵션입니다(곱빼기, 치즈 추가).
- 주문 저장은 그룹마다 정확히 하나를 골랐는지 확인하고, 아니면 422 `option_required`입니다. 그룹의 선택지가 모두 품절이면 키오스크는 그 메뉴를 품절로 보여 줍니다.
- `option_group` 열이 없는 DB(`AI_MIGRATION.md` 13단계 전)에서는 그룹을 보내면 503입니다.

## 품절 즉시 변경

`PATCH /owner/menus/{id}/sold-out`, `PATCH /owner/options/{id}/sold-out`

요청 `{ "is_sold_out": true }`, 응답 `{ "menu_id": 10, "is_sold_out": true }`(옵션은 `option_id`). 같은 값을 다시 보내도 200입니다.

값이 바뀌면 그 매장 키오스크의 `current_menu_version`을 올리고 WebSocket(`/kiosk/ws`)으로 알립니다. 키오스크는 메뉴를 캐시해 오프라인에서도 쓰므로, 버전을 올려야 품절이 바로 반영됩니다. 잠금 순서는 주문 저장과 같은 기기 → 메뉴입니다(MySQL 교착 방지).

## AI 설정 `/owner/stores/{id}/ai-settings`

`GET`은 `{ "ai_ready": true, "settings": {...} }`, `PATCH`는 아래 7개 필드를 모두 보내야 합니다(그 밖의 필드는 422).

| 필드 | 범위 | 뜻 |
| --- | --- | --- |
| `policy_profit` | 0~100 | 추천 정책. 0은 고객 만족(상황 적합도), 100은 매장 수익(원가율 기준 이익) |
| `pick_weight` | 0~100 | 점주 추천 메뉴(`is_store_pick`) 가산점 |
| `fit_threshold` | 0~100 | 이 적합도 미만인 메뉴는 추천하지 않음 |
| `upsell_enabled` | bool | 장바구니에 담은 뒤 함께 먹기 좋은 메뉴 제안 |
| `default_mode` | `normal`·`senior` | 키오스크 첫 화면 모드 |
| `speech_rate` | 50~150 | 음성 안내 속도(%) |
| `voice_enabled` | bool | 음성 주문 버튼 표시 |

`ai_ready=false`(DB 변경 미적용)면 GET은 기본값을, PATCH는 503 `{ code: "ai_schema_missing" }`를 돌려줍니다. 저장하면 메뉴 버전을 올립니다.

## 메뉴 AI 정보 `/owner/stores/{id}/menu-ai`

`GET`은 메뉴마다 `menu_id, menu_name, menu_price, is_active, is_sold_out, cost_rate, is_rec_excluded, is_store_pick, tags, synonyms`를 줍니다. `PATCH` 본문은 `{ "menus": [{ menu_id, cost_rate(0~100 또는 null), is_rec_excluded, is_store_pick, tags(최대 10개, 20자), synonyms(최대 10개, 30자) }] }`이고 보낸 메뉴의 태그·동의어를 통째로 바꿉니다. 대소문자만 다른 태그는 하나로 저장합니다(MySQL 비교 규칙이 같은 값으로 봄). 다른 매장 메뉴가 섞이면 전체 404입니다.

## 통계 `GET /owner/stores/{id}/stats?days=7`

`days`는 1~90, 날짜 구분은 한국 시간입니다. 응답은 `orders, voice_orders, voice_ratio, revenue_estimate, rec_revenue_estimate, rec_impressions, rec_selections, rec_selection_rate, top_menus(5개), daily[]`입니다. 주문 당시 가격을 저장하지 않으므로 매출은 현재 메뉴·옵션 가격으로 계산한 추정치입니다.

## 직원 호출

- `GET /owner/stores/{id}/staff-calls`: `{ open: [...], recent: [...] }`. `open`은 처리하지 않은 호출(최대 50건), `recent`는 최근 처리한 10건이고 항목은 `alert_id, device_id, device_code, message, status, occurred_at, resolved_at`입니다. 점주 웹이 5초마다 읽어 알림을 띄웁니다.
- `PATCH /owner/stores/{id}/staff-calls/{alert_id}/resolve`: `{ alert_id, status: "RESOLVED" }`. 이미 처리된 호출도 200입니다.

키오스크는 `POST /kiosk/staff-call`로 호출합니다. 처리되지 않은 호출이 있으면 새로 만들지 않습니다.

## 메뉴 사진

- `PUT /owner/menus/{id}/image`: 본문은 이미지 바이트 그대로, `Content-Type: image/jpeg|png|webp`, 900KB 이하. 형식은 파일 시그니처로 다시 확인합니다(다르면 415). 응답 `{ menu_id, image_url }`.
- `DELETE /owner/menus/{id}/image`: 대표 사진을 지웁니다.
- 파일은 `server/media/menu/<menu_id>_<해시>.<확장자>`에 저장하고 `/media/menu/...`로 공개합니다(`VOISK_MEDIA_ROOT`로 위치 변경). 이름에 내용 해시가 있어 키오스크는 바뀐 사진만 다시 받습니다.
- 소유 확인을 파일 쓰기보다 먼저 합니다. DB 저장이 실패하면 새로 만든 파일만 지우고, 이미 쓰이던 파일은 남깁니다.

## 허용 출처

점주 웹은 8081에서 뜨는데 서버 기본 허용 출처는 8080뿐입니다. `server/.env`에 아래 한 줄을 넣습니다. 이 값은 기본값을 덮어쓰므로 회사 관리자 웹이 쓰는 8080도 같이 적어야 합니다.

```
ADMIN_AUTH_ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080,http://localhost:8081,http://127.0.0.1:8081
```

CORS `allow_methods`에 메뉴 사진용 `PUT`, `DELETE`를 추가했습니다. 쿠키가 SameSite=Strict이므로 웹과 API의 호스트를 맞춥니다. 웹을 `http://127.0.0.1:8081`로 열면 API 주소도 `http://127.0.0.1:8001`입니다.

## 검증 범위

- `test_owner_auth.py`, `test_owner_portal.py`: 메모리 SQLite에서 실제 SQL과 Argon2id로 권한, 입력 검증, 롤백을 검증합니다. 테스트 커서는 MySQL처럼 UPDATE 영향 행을 0으로 돌려줍니다.
- `test_ai_features.py`: AI 설정·메뉴 AI·통계·직원 호출·사진 업로드와 리뷰 회귀(잠금 순서, 사진 보존, 태그 중복)를 검증합니다.
- SQLite 테스트는 MySQL의 행 잠금, 콜레이션, CHECK 동작을 대신하지 않습니다. 잠금 순서는 실행된 SQL 순서로만 확인합니다.
