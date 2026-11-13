# AI 음성 주문·추천 설계와 구현 (2026-11-11)

구상안(`AI_보이스크_프로젝트_구상안.md`)을 실제 저장소에 맞춰 구현한 내용입니다.
구상안과 다르게 정한 부분은 2장에 이유와 함께 적었습니다.

## 1. 구상안 대비 구현 현황

| 구상안 항목 | 이전 상태 | 이번 구현 | 위치 |
|---|---|---|---|
| 음성 주문 시작 | 마이크 버튼(동작 없음) | "말로 주문하기" 버튼을 눌러야만 마이크가 켜짐. 호출어 없음 | `kiosk_app/lib/service/screens/order_screen.dart` |
| 음성 인식·음성 안내 | 없음 | 안드로이드 내장 SpeechRecognizer·TextToSpeech(Kotlin 플러그인) | `packages/voice_engine` |
| 자연어 주문 해석 | 없음 | 서버가 Claude Haiku(`claude-haiku-5-5`)를 호출하고, 결과를 매장 메뉴·옵션·장바구니와 다시 대조 | `server/voice_service.py` |
| 상황 기반 추천·이유 | 없음 | Haiku가 적합도·이유를 내고, 순위는 키오스크 추천 엔진이 정함 | `kiosk_app/lib/domain/recommendation_engine.dart` |
| 대화 상태 기계 | 없음 | 대기→청취→이해→추천/재질문/확인→실행→추가 제안→결제 안내, 반복 실패 시 오류 | `kiosk_app/lib/domain/conversation_controller.dart` |
| 주문 명령(Command) | 화면이 장바구니를 직접 변경 | 터치·음성 모두 `OrderCommandBus`를 거침. 음성 주문 여부와 추천 경유를 기록 | `kiosk_app/lib/domain/order_commands.dart` |
| 화면 연동 피드백 | 없음 | 음성 패널(상태 아이콘, 인식 문장, 안내, 추천 카드 3개, 네/아니요), 메뉴 강조 | `kiosk_app/lib/voice/voice_panel.dart` |
| 시니어 모드 | 글자 크기 조절만 | 큰 글씨, 느린 음성, 긴 무음 대기, 추가 제안 끔, 카드 결제 안내 | 주문 화면 "크게·천천히" |
| 추가 제안 1회 | 없음 | 점주 설정이 켜져 있으면 주문당 1회(음료·사이드·디저트) | 대화 상태 기계 |
| 오프라인 동작 | 서버 실패 시 메뉴 화면 오류 | 마지막 메뉴를 기기에 저장해 터치 주문 계속, 주문은 Outbox에 쌓았다가 순서대로 전송 | `kiosk_app/lib/data/` |
| 실시간 동기화·메뉴 버전 | 점주 저장 시 버전만 증가 | WebSocket 변경 알림과 30초 버전 확인. 주문 중이면 주문이 끝난 뒤 반영 | `server/sync_hub.py`, `kiosk_app/lib/data/sync_service.dart` |
| 기기 인증 | 없음(PC 로컬 요청만) | 회사 관리자가 기기 토큰 발급. 키오스크는 토큰으로 LAN에서 `/kiosk/*` 사용 | `server/device_auth.py` |
| 원가·추천 정책 | 없음 | 원가율, 추천 제외, 매장 우선, 정책 슬라이더, 적합도 기준선 | 점주 웹 "AI 추천·음성" |
| 태그·동의어 | 없음 | 점주가 메뉴별 상황 태그·동의어를 입력. 시연 매장 40개 메뉴는 미리 채움 | 점주 웹, `server/seed_demo_ai.py` |
| 음성 설정 | 없음 | 음성 주문 사용, 안내 속도, 추가 제안, 기본 사용자 모드 | 점주 웹 |
| 메뉴 사진 | 없음 | 점주 웹에서 업로드(800px로 줄여 전송). 서버 디스크에 해시 이름으로 저장하고, 키오스크는 바뀐 사진만 받아 캐시. 받는 중이던 카드도 다 받으면 사진으로 바뀜. 시연 메뉴 40개는 Wikimedia Commons 자유 라이선스 사진(`server/seed_menu_images.py`, 출처 `server/menu_image_credits.md`) | `server/menu_image_service.py`, `kiosk_app/lib/data/image_store.dart` |
| 주문 방식 구분·추천 경유 | 없음 | `orders.order_channel`(touch/voice), `order_item.is_recommended` | 서버·점주 웹 주문 내역 |
| 추천 로그·통계 | 없음 | 추천 노출·선택 로그. 점주 통계(주문 수, 음성 비율, 추천 선택률, 추천 경유 매출, 인기 메뉴) | 점주 웹 "통계" |
| 기기 관리 | 연결 상태 미확인 | 키오스크가 60초마다 상태 보고(마지막 접속, 적용 메뉴 버전, 앱 버전). 3분 기준 연결 판정 | 회사 관리자·점주 웹 |
| 키오스크 모드 | 없음 | 가로 고정, 화면 켜짐, 시스템 바 숨김, Lock Task(관리자 설정), 관리자 PIN 설정 화면 | `MainActivity.kt`, `lib/screens/settings_screen.dart` |
| 직원 호출 | 화면 안내만 | `device_alert`(STAFF_CALL)에 기록. 점주 웹이 5초마다 확인해 알리고 처리 | `server/kiosk_router.py`, 점주 웹 |
| 다국어 | Language 버튼만 있음 | 키오스크 화면 4개 언어(한국어·日本語·English·中文). 음성 주문은 한국어만 | `kiosk_app/lib/core/l10n*.dart` |
| 프라이버시 안내 | 없음 | "버튼을 누른 뒤의 음성만 처리하며 녹음·저장하지 않습니다" 상시 표시 | 음성 패널 |
| 검증 계획(15장) | 없음 | 발화 67개 평가 세트와 실행 스크립트, 정책별(적합 우선·균형·이익 우선) 비교가 든 결과 보고서 | `ml/voice_eval/` |
| 옵션 확인 대화(필수 옵션만 되묻기) | 옵션은 모두 자유 추가 | 옵션 그룹(맵기·사이즈 등)은 하나를 꼭 고름. 말하지 않으면 키오스크가 그 그룹만 되묻고 화면 버튼도 보여 줌. 터치 화면은 고르기 전 담기 버튼이 꺼짐. 서버도 주문 저장 때 확인 | `menu_option.option_group`, `conversation_controller.dart` |
| 인기 메뉴 + 되묻기(18장 리스크) | 없음 | 맞는 메뉴가 없으면 최근 30일 많이 팔린 메뉴부터 보여 주고 되묻기 | `kiosk_catalog.popular_menu_ids` |
| 주문 중 가격 변경(10장) | 결제가 422로 막힘 | 진행 중 주문은 시작 시점 메뉴로 보여 주고, 결제 때 서버가 `amount_mismatch` 등으로 거절하면 최신 메뉴로 장바구니를 다시 계산해 바뀐 금액을 알림 | `payment_screen.dart`, `order_screen.dart` |
| 사용성 측정(15장) | 없음 | 주문 완료마다 방식(터치/음성)·탭 수·소요 시간을 기기에만 기록하고 관리자 설정에서 평균을 봄. 메뉴·금액·발화는 남기지 않음 | `lib/data/usability_log.dart` |
| 기기 설정(7장: 배터리 최적화 제외) | 없음 | 관리자 설정에서 배터리 최적화 예외 요청 화면을 엶. 빅스비 호출은 기기 설정에서 끔 | `MainActivity.kt` |
| 다음 고객 준비 | 결제 후 같은 화면에 머묾 | 결제가 끝나거나 90초 동안 조작이 없으면(장바구니가 있으면 20초 동안 물어본 뒤) 처음 화면으로 돌아가 장바구니·대화를 비움 | `order_screen.dart` |
| 기기 관리(6장: 메뉴 버전) | 연결 상태만 | 회사 관리자·점주 웹에 적용 메뉴 버전/최신 버전, 마지막 동기화, 앱 버전 | 두 웹의 기기 화면 |

## 2. 구상안과 다른 결정

| 구상안 | 결정 | 이유 |
|---|---|---|
| 호출어 "말로야 주문"(Porcupine) | 제외. 화면 버튼으로만 시작 | 오너 결정(2026-11-11). 상시 청취가 없어 오작동·프라이버시 부담이 없음 |
| NLU·임베딩을 기기에서 ONNX로 추론 | 음성 해석·추천 적합도는 서버 중계 Claude Haiku | 오너 결정. 학습 데이터 없이 정정·상황 추천 품질 확보 |
| 고객 발화 원문은 서버로 보내지 않음 | 인식된 **텍스트**만 서버를 거쳐 Claude로 전달. 서버는 저장·로그하지 않음 | LLM 호출에 필요. 오디오는 여전히 Kotlin 밖으로 나가지 않음 |
| 오프라인에서도 음성 주문·추천 | 서버·LLM이 실패하면 "화면을 눌러 주문해 주세요" 안내 | 오너 결정. 터치 주문·Outbox는 오프라인에서도 동작 |
| sherpa-onnx STT | 안드로이드 내장 SpeechRecognizer | 오너 결정 |
| LLM 태그 자동 제안 | 점주 직접 입력 | 오너가 LLM 용도를 해석·추천으로 한정 |
| 추천 이유 문장은 태그 기반 템플릿 | 추천 이유는 Haiku가 메뉴 태그·설명에 근거해 생성. 나머지 안내 문장은 템플릿 | 오너가 "상황 추천 적합도·이유"를 LLM 역할로 선택 |
| Flutter Web 대시보드, PostgreSQL, Oracle Cloud | React 점주 웹·회사 관리자 웹, Azure MySQL, 노트북 LAN 서버 | 팀이 이미 구현한 스택 유지 |
| drift(SQLite) 로컬 DB, Riverpod | 앱 폴더 JSON 파일, 기존 ChangeNotifier | 데이터가 작고 코드 생성 없이 테스트 가능. 기존 화면·테스트 유지 |
| 변경분만 내려받기(메뉴 버전 기준) | 버전이 바뀌면 메뉴판 전체(40개 메뉴, 수십 KB)를 다시 받음 | 매장 하나의 메뉴판이 작아 변경분 계산보다 전체 교체가 단순하고 틀릴 일이 없음. 사진은 이름에 내용 해시가 있어 바뀐 것만 받음 |
| 점주 대시보드를 휴대폰에서도 | 서버 노트북에서만(loopback) | 오너 결정(2026-11-11). 시연 서버가 HTTP라 로그인 정보가 Wi-Fi에 평문으로 흐르지 않게 |
| 응답 2초(14장) | 모든 발화를 Haiku로 해석(짧은 예/아니요·옵션 선택지·결제/그만만 기기에서) | 오너 결정(2026-11-11). 구독 CLI 경유 평균 4초, 실제 API 키 경로는 키를 넣은 뒤 측정 |

## 3. DB 변경 (`server/AI_MIGRATION.md`)

추가형 변경만 했고, 2026-11-11에 공용 DB에 적용했습니다(적용 전 전체 백업).

- `menu`: `cost_rate`, `is_rec_excluded`, `is_store_pick`
- `menu_tag`, `menu_synonym`
- `store_ai_setting`: 정책·음성 설정(없으면 기본값)
- `orders.order_channel`, `order_item.is_recommended`, `orders(store_id, ordered_at)` 인덱스
- `recommendation_log`
- `kiosk_device.applied_menu_version`

서버는 컬럼·테이블이 없으면 AI 기능만 503으로 끄고 기존 메뉴·주문은 그대로 동작합니다.

## 4. API

### 기기 인증
- `POST /admin/devices/{device_id}/token`(회사 관리자 세션·CSRF): 새 토큰을 한 번만 응답합니다. DB에는 SHA-256만 저장하고 이전 토큰은 무효가 됩니다.
- 키오스크 헤더: `X-Device-Id`, `Authorization: Bearer <token>`. 활성 기기이고 해시가 맞아야 통과합니다(상수 시간 비교, 접속 주소별 1분 10회 실패 제한).

### 키오스크 (`/kiosk/*`, LAN 허용)
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/kiosk/bootstrap` | 메뉴(옵션·태그·동의어·원가율·추천 제외·매장 우선·사진 주소)·AI 설정·메뉴 버전 |
| GET | `/kiosk/menu-version` | `{menu_version}` |
| POST | `/kiosk/heartbeat` | `{applied_menu_version, app_version}` → 마지막 접속·동기화 시각 갱신 |
| WS | `/kiosk/ws` | 핸드셰이크 헤더로 인증. `{"type":"menu_changed","menu_version":n}` |
| POST | `/kiosk/orders` | 주문(+`order_channel`, 품목별 `is_recommended`). 인증된 기기·매장과 일치해야 함 |
| POST | `/kiosk/payments/demo/{card\|naverpay}`, `/kiosk/payments/cash/pending` | 시연 결제·현금 주문(서버 환경변수로 켬) |
| POST | `/kiosk/voice/interpret` | 발화 해석(아래) |
| POST | `/kiosk/rec-logs` | 추천 노출·선택 로그(`client_log_id`로 멱등) |
| POST | `/kiosk/staff-call` | 직원 호출(처리 전 호출이 있으면 새로 만들지 않음) |

`/kiosk/voice/interpret` 요청: `text`(200자 이하), `alternatives`(음성 인식의 다른 후보 문장, 4개·각 200자 이하, 선택), `state`, `viewing_menu_id`, `cart`, `recommended_menu_ids`, `mode`.
응답: `intent`(order·recommend·select·modify·remove·clear·confirm·deny·checkout·cancel·help·clarify·unknown), `items`, `situation`, `recommendations[{menu_id, fit, reason}]`, `select_index`, `question`, `sold_out_menu_ids`(담으려다 품절이라 뺀 메뉴).
- 음성 인식이 메뉴를 실제 낱말로 잘못 받아 적는 경우(식혜→"시계", 콜라→"골라", 계란말이→"계란 마리")를 위해, 서버가 발화를 자모 소리로 판매 중 메뉴 이름·동의어와 비교해 `sound_alike` 후보를 모델에 함께 보냅니다. 된소리·거센소리, ㄹ/ㄴ, 소리 없는 ㅇ·ㅎ, ㅐ/ㅔ, 받침 대표음을 같은 소리로 봅니다. 두 글자 이름은 소리가 완전히 같을 때만 후보로 넣습니다. 주문 문맥인지는 모델이 판단하고, 짐작한 메뉴는 키오스크가 손님에게 확인한 뒤 담습니다.
- 가격·합계는 응답에 없습니다. 금액은 키오스크 장바구니와 서버 주문 저장이 계산합니다.
- 키가 없거나 호출이 실패하면 503 `voice_unavailable`, 기기당 1분 30회를 넘으면 429입니다. 검증 오류(422)는 발화를 응답에 싣지 않습니다.

### 점주 (`/owner/*`, 점주 세션·CSRF)
`GET/PATCH /owner/stores/{id}/ai-settings`, `GET/PATCH /owner/stores/{id}/menu-ai`, `GET /owner/stores/{id}/stats?days=1..90`,
`GET /owner/stores/{id}/staff-calls`, `PATCH /owner/stores/{id}/staff-calls/{alert_id}/resolve`,
`PUT|DELETE /owner/menus/{menu_id}/image`(본문은 이미지 바이트, 900KB 이하, JPG·PNG·WEBP 시그니처 확인).
저장하면 해당 매장 기기의 메뉴 버전을 올리고 WebSocket으로 알립니다. 품절 변경도 같은 방식입니다.

## 5. 추천 엔진 (키오스크, 결정론)

1. 후보 필터: 품절·추천 제외·매장에 없는 메뉴 제거
2. 적합도: 서버(Haiku)가 준 `fit`(0~100)
3. 기준선 컷: `fit < fit_threshold`면 제외(이익이 높아도 추천하지 않음)
4. 점수: `fit × w1 + 이익 × w2 + 매장 우선 × w3`. `w2 = policy_profit/100 × 0.5`, `w3 = pick_weight/100 × 0.3`, `w1 = 1 − w2 − w3`
   - 이익 = 매장 메뉴 원가율을 정규화해 낮을수록 100(원가율이 없으면 50), 매장 우선 = 100 또는 0
5. 상위 3개 카드 표시, 1순위를 음성으로 소개. 후보가 없으면 매장 우선·이익 순 메뉴를 보여 주고 되묻습니다.

추가 제안은 장바구니에 없는 분류(음료·사이드·디저트) 중 이익·매장 우선 점수가 가장 높은 메뉴 하나입니다.

## 6. 음성 엔진 (`packages/voice_engine`, Kotlin)

- MethodChannel `voice_engine/methods`: `isRecognitionAvailable`, `hasPermission`, `requestPermission`, `initializeTts`, `startListening`, `stopListening`, `cancelListening`, `speak`, `stopSpeaking`
- EventChannel `voice_engine/events`: `listening`, `speechBegin`, `speechEnd`, `partial`, `final`, `error`, `level`, `speechStart`, `speechDone`
- 마이크는 `startListening` 동안만 쓰고, 오디오는 Dart·파일·네트워크로 내보내지 않습니다. 말하는 중에 듣기를 시작하면 안내를 멈춰 자기 목소리를 인식하지 않게 합니다.
- 무음 8초가 지나면 대기로 돌아갑니다.

## 7. 로컬 테스트용 LLM 백엔드

- `VOICE_LLM_BACKEND=api`(기본): `server/.env`의 `ANTHROPIC_API_KEY`로 Anthropic SDK 호출. 사고 끔, effort low, JSON 스키마 구조화 출력, 메뉴 정보는 프롬프트 캐시.
- `VOICE_LLM_BACKEND=claude_cli`: 개발 PC의 Claude Code CLI(`claude -p`)로 같은 프롬프트·스키마를 실행합니다. API 키 없이 구독으로 시험할 때만 씁니다. 창 없이 실행하고 셸을 거치지 않습니다.

## 8. 프라이버시

- 서버 `voice/interpret`는 발화를 DB·로그에 남기지 않습니다. 추천 로그에는 모델이 뽑은 상황 태그만 저장합니다.
- Claude로는 발화 텍스트, 매장 메뉴 정보, 장바구니만 보냅니다.
- 안드로이드 음성 인식 서비스(기기 제조사·Google)의 처리 방식은 기기 설정을 따릅니다. 가능하면 기기에서 한국어 오프라인 인식 팩을 설치합니다.
