# AI 음성 주문·추천 설계 (2026-11-10)

구상안(`AI_보이스크_프로젝트_구상안.md`)을 실제 저장소 상태에 맞춰 구현한 설계입니다.
구상안과 다르게 정한 부분은 "구상안과 다른 결정"에 이유와 함께 적었습니다.

## 1. 구상안 대비 빠졌던 부분과 이번 구현

| 구상안 항목 | 이전 상태 | 이번 구현 |
|---|---|---|
| 호출어 "말로야 주문" | 없음 | Kotlin 음성 엔진: Porcupine(키·.ppn 있을 때) / STT 키워드 감지 대체 / 끄기 |
| 음성 인식·음성 안내 | 마이크 버튼만 있음 | 안드로이드 내장 SpeechRecognizer·TextToSpeech, 모드별 속도 |
| 자연어 주문 해석 | 없음 | 서버 중계 Claude Haiku(`claude-haiku-5-5`) 구조화 출력 → 서버가 메뉴·옵션 ID 재검증 |
| 상황 기반 추천·이유 | 없음 | Haiku가 적합도·이유 산출, 순위는 키오스크 추천 엔진(결정론) |
| 대화 상태 기계 | 없음 | 호출어 대기→청취→이해→추천/재질문/확인→실행→추가 제안→결제 안내, 오류 |
| 화면 연동 피드백 | 없음 | 음성 패널: 상태 아이콘, 인식 문장, 추천 카드 3개, 담기 결과, 메뉴 강조 |
| 시니어 모드 | 글자 크기 조절만 | 느린 음성, 큰 글씨, 확인 강화, 추가 제안 끔 |
| 추가 제안 1회 | 없음 | 점주 설정 ON 시 주문당 1회(음료·사이드) |
| 오프라인 동작 | 메뉴 실패 시 화면 오류 | 마지막 메뉴 캐시로 터치 주문, 주문 Outbox 저장 후 복구 시 순서대로 전송 |
| 실시간 동기화·메뉴 버전 | 점주 저장 시 버전 증가만 | WebSocket 변경 알림 + 30초 버전 확인, 주문 중이면 완료 후 반영 |
| 기기 인증 | 없음(로컬 요청만 허용) | 회사 관리자가 기기 토큰 발급, 키오스크는 토큰으로 LAN에서 API 사용 |
| 원가·추천 정책 | 없음 | 메뉴 원가율·추천 제외·매장 우선, 매장 정책 슬라이더·적합도 기준선 |
| 태그·동의어 | 없음 | 점주가 메뉴별 상황 태그·동의어 입력 |
| 음성 설정 | 없음 | 음성 주문 사용, 호출어 방식·감도, 안내 속도, 추가 제안, 기본 모드 |
| 주문 방식 구분·추천 경유 | 없음 | `orders.order_channel`(touch/voice), `order_item.is_recommended` |
| 추천 로그·통계 | 없음 | 추천 노출·선택 로그, 점주 통계(음성 비율·추천 선택률·추천 경유 매출·인기 메뉴) |
| 기기 상태 | 마지막 접속만 | 키오스크 상태 보고(마지막 접속, 적용 메뉴 버전) |
| 키오스크 모드 | 없음 | 가로 고정, 화면 켜짐 유지, Lock Task(화면 고정), 관리자 PIN 설정 화면 |
| 프라이버시 안내 | 없음 | "호출어 이후 음성만 처리하며 저장하지 않습니다" 표시, 대기/듣는 중 아이콘 |

## 2. 구상안과 다른 결정

| 구상안 | 결정 | 이유 |
|---|---|---|
| NLU·임베딩을 기기에서 ONNX로 추론, LLM은 태그 제안에만 | 음성 해석·추천 적합도는 서버 중계 Claude Haiku | 오너 결정. 학습 데이터 없이 자연어 정정·상황 추천 품질 확보 |
| 고객 발화 원문은 서버로 보내지 않음 | 인식된 **텍스트**만 서버를 거쳐 Claude로 전달. 서버는 저장·로그하지 않음 | LLM 호출에 필요. 오디오는 여전히 Kotlin 밖으로 나가지 않음 |
| 오프라인에서도 음성 주문·추천 | 오프라인·LLM 실패 시 "화면으로 주문해 주세요" 안내 | 오너 결정. 터치 주문·Outbox는 오프라인에서 동작 |
| sherpa-onnx STT | 안드로이드 내장 SpeechRecognizer | 오너 결정 |
| Flutter Web 대시보드, PostgreSQL, Oracle Cloud | React 점주 웹·회사 관리자 웹, Azure MySQL, 노트북 LAN 서버 | 이미 팀이 구현한 스택 유지 |
| drift(SQLite) 로컬 DB | 앱 문서 폴더의 JSON 파일(메뉴 캐시·Outbox) | 데이터가 작고 코드 생성 없이 테스트 가능 |
| Riverpod | 기존 ChangeNotifier 유지 | 기존 화면 구조와 테스트 유지 |
| 태그 자동 제안(LLM) | 점주 직접 입력 | 오너가 LLM 용도를 해석·추천으로 한정 |

## 3. DB 변경 (추가형만, `server/AI_MIGRATION.md`)

- `menu`: `cost_rate TINYINT UNSIGNED NULL`(원가율 %), `is_rec_excluded BOOLEAN`, `is_store_pick BOOLEAN`
- `menu_tag(menu_id, tag_nm)`, `menu_synonym(menu_id, synonym_nm)`
- `store_ai_setting(store_id PK, policy_profit, pick_weight, fit_threshold, upsell_enabled, default_mode, speech_rate, wake_mode, wake_sensitivity, voice_enabled, updated_at)`
- `orders.order_channel ENUM('touch','voice') NULL`, `order_item.is_recommended BOOLEAN`
- `recommendation_log(rec_log_id, store_id, device_id, client_log_id, situation, shown_menu_ids, selected_menu_id, policy_profit, created_at)` + `UNIQUE(device_id, client_log_id)`
- `kiosk_device.applied_menu_version INT NULL`

서버는 컬럼·테이블이 없으면 AI 기능만 503으로 끄고 기존 메뉴·주문 기능은 그대로 동작합니다.

## 4. API 계약

### 기기 인증
- `POST /admin/devices/{device_id}/token` (회사 관리자 세션·CSRF): 새 토큰을 한 번만 응답 `{device_id, store_id, token}`. DB에는 SHA-256 해시만 저장. 다시 발급하면 이전 토큰 무효.
- 키오스크 요청 헤더: `Authorization: Bearer <token>`, `X-Device-Id: <device_id>`. 활성 기기이고 해시가 일치해야 통과(상수 시간 비교).

### 키오스크 API (`/kiosk/*`, 기기 토큰 필수, LAN 허용)
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/kiosk/bootstrap` | 메뉴(옵션·태그·동의어·원가율·추천 제외·매장 우선)·AI 설정·메뉴 버전 |
| GET | `/kiosk/menu-version` | `{menu_version}` |
| POST | `/kiosk/heartbeat` | `{applied_menu_version}` → last_seen_at 갱신 |
| WS | `/kiosk/ws?device_id=&token=` | `{"type":"menu_changed","menu_version":n}` 알림 |
| POST | `/kiosk/orders` | 기존 주문 본문 + `order_channel`, 품목별 `is_recommended` |
| POST | `/kiosk/payments/demo/{method}`, `/kiosk/payments/cash/pending` | 기존 시연 결제의 기기 인증판 |
| POST | `/kiosk/voice/interpret` | 아래 |
| POST | `/kiosk/rec-logs` | 추천 노출·선택 로그(멱등 `client_log_id`) |

`POST /kiosk/voice/interpret` 요청:
```json
{"text": "제육 두 개랑 콜라", "state": "listening|recommending|confirming|upsell",
 "viewing_menu_id": 12, "cart": [{"entry_id": "12:3", "menu_id": 12, "quantity": 1, "option_ids": [3]}],
 "recommended_menu_ids": [10, 11, 15], "mode": "normal|senior"}
```
응답(서버가 모든 ID를 DB 메뉴와 대조한 결과):
```json
{"intent": "order|recommend|modify|remove|clear|confirm|deny|select|checkout|cancel|help|unknown",
 "items": [{"menu_id": 12, "quantity": 2, "option_ids": [], "entry_id": null}],
 "missing_options": [{"menu_id": 12, "question": "맵기는 어떻게 할까요?"}],
 "situation": ["해장"],
 "recommendations": [{"menu_id": 31, "fit": 88, "reason": "국물이 있어 속 풀기 좋아요"}],
 "select_index": null, "reply": "제육덮밥 두 개, 콜라 하나 맞으세요?"}
```
- 가격·합계는 응답에 없습니다. 장바구니 금액은 키오스크 `CartController`와 서버 주문 저장이 계산합니다.
- LLM 키가 없거나 호출이 실패하면 503 `{"code": "voice_unavailable"}` → 키오스크는 터치 주문을 안내합니다.
- 발화 텍스트 최대 200자, 기기당 분당 30회 제한.

### 점주 API (점주 세션·CSRF)
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET/PATCH | `/owner/stores/{id}/ai-settings` | 추천 정책·음성 설정 |
| GET/PATCH | `/owner/stores/{id}/menu-ai` | 메뉴별 원가율·태그·동의어·추천 제외·매장 우선 |
| GET | `/owner/stores/{id}/stats?days=7` | 주문 수, 음성 비율, 추천 노출·선택률, 추천 경유 매출, 인기 메뉴 |

PATCH는 저장 후 해당 매장 기기의 메뉴 버전을 올리고 WebSocket으로 알립니다.

## 5. 추천 엔진 (키오스크, 결정론)

1. 후보 필터: 품절·비활성·추천 제외 메뉴 제거
2. 적합도: 서버(Haiku)가 준 `fit`(0~100). 받은 후보만 사용
3. 기준선 컷: `fit < fit_threshold`면 제외(이익이 높아도 추천 안 함)
4. 점수: `fit × w1 + profit × w2 + pick × w3`
   - `w2 = policy_profit/100 × 0.5`, `w3 = pick_weight/100 × 0.3`, `w1 = 1 − w2 − w3`
   - `profit` = 매장 내 원가율을 정규화해 낮을수록 100(원가율 없는 메뉴는 50)
   - `pick` = 매장 우선이면 100, 아니면 0
5. 상위 3개 카드 표시, 1순위를 음성으로 소개

정책 슬라이더는 적합한 후보끼리의 순서만 바꿉니다. 고객이 메뉴를 직접 말하면 추천 엔진을 거치지 않습니다.

## 6. 음성 엔진 (packages/voice_engine, Kotlin)

- MethodChannel `voice_engine/methods`: `initialize`, `startWakeWord`, `stopWakeWord`, `startListening`, `stopListening`, `cancelListening`, `speak`, `stopSpeaking`, `isRecognitionAvailable`
- EventChannel `voice_engine/events`: `wake`, `listening`, `partial`, `final`, `error`, `speechStart`, `speechDone`, `level`
- 오디오는 Kotlin 안에서만 처리하고 Dart에는 텍스트·상태만 전달합니다. 파일 저장이나 전송 코드는 없습니다.
- 호출어: Porcupine은 `PICOVOICE_ACCESS_KEY`와 `assets/wakeword/` 아래 `.ppn`·`porcupine_params_ko.pv`가 있을 때만 사용합니다. 없으면 STT 키워드 감지("말로야")로 대체하고, `off`면 버튼만 씁니다.
- 마이크 충돌을 막기 위해 STT 청취 중에는 호출어 감지를 멈추고 끝나면 다시 시작합니다.
- 무음 8초가 지나면 호출어 대기로 돌아갑니다.

## 7. 프라이버시

- 서버 `voice/interpret`는 요청 본문을 로그·DB에 남기지 않습니다. 접근 로그에도 경로만 남습니다.
- 추천 로그에는 발화 원문 대신 추출된 상황 태그만 저장합니다.
- Claude API로는 발화 텍스트, 매장 메뉴 정보, 장바구니만 보냅니다.
