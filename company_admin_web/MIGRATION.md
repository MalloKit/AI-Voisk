# Flutter → React 마이그레이션 검증

2026-10-12 (한국 시각). 브랜치 `integration/midterm-demo`, 시작 HEAD `77eb18c`. 시작 Git 상태는 깨끗했습니다. 브랜치를 생성하거나 전환하지 않았습니다.

## 분석·보존·대체

Flutter의 lib 전체 화면·레이아웃·테마·위젯·데이터 모델·Mock Source/Repository·주문 API Repository와 4개 테스트 파일을 직접 읽고 비교했습니다. 기존 서버의 GET API와 CORS/로컬 접근 정책을 확인했습니다.

같은 폴더에 React 파일을 추가하면서 Flutter 파일을 유지했습니다. 빌드·기능 테스트·실제 API와 브라우저 검증 후 lib/test/web, pubspec, Flutter 메타데이터와 산출물을 제거했습니다. 영구적인 별도 프로젝트나 공통 라이브러리는 만들지 않았습니다. 이전 Flutter 소스는 기존 Git 커밋 `77eb18c`에서 비교/복구할 수 있습니다.

## 기능 대응

| Flutter 기능                    | React 구현                        | 검증                                                         |
| ------------------------------- | --------------------------------- | ------------------------------------------------------------ |
| AdminShell/Sidebar/TopBar       | layout/AdminShell.tsx             | 화면 이동, 출처 표시, 모바일 메뉴                            |
| Theme/Colors/Spacing/TextStyles | theme/tokens.css + components.css | 기존 색상·폰트·치수 기반 분리                                |
| AppTable                        | components/ui.tsx Table           | 5행 페이지, 결과 변경 시 페이지 초기화, 빈 결과, 가로 스크롤 |
| Search/Filter/Card              | 공통 UI 컴포넌트                  | 조합 필터·지우기·초기화                                      |
| showDetails/DetailField         | Modal/Field                       | 스크롤, Escape, 초점 복귀                                    |
| DashboardPage                   | features/DashboardPage.tsx        | 4개 지표·Mock 최근 주문·미연결 매장·기기/알림·화면 링크      |
| StoresPage                      | features/StoresPage.tsx           | 3개 필드 검색·업종·연결·상세·초기화                          |
| OwnersPage                      | features/OwnersPage.tsx           | 검색·연결 필터·다중/미연결 매장 상세                         |
| OrdersPage(Mock)                | OrdersPage + mockOrders           | 고정 기준일 1/7/30일·전체 기간, 단일 옵션                    |
| LiveOrdersPage                  | OrdersPage + LiveDetail           | 실제 목록·상세·기간·매장·ID·새로고침·다중 옵션               |
| ApiOrderRepository              | data/orderRepository.ts           | GET limit=200/offset, 20초 타임아웃, 빈/잘못된 응답          |
| 명시 유형/legacy table_no       | diningLabel                       | takeaway/dine_in, NULL 번호 없음, 기존 번호 유지             |
| DevicesPage                     | features/DevicesPage.tsx          | 검색·매장·상태·연결 이력 없음·관련 알림                      |
| AlertsPage/AlertDetails         | features/AlertsPage.tsx           | 검색·유형·상태·상세·Mock 확인·실패 재시도                    |
| Mock Source/Repository          | MockAdminRepository + JSON        | 동일 샘플, 불변 스냅샷, 화면 이동 시 확인 상태 유지          |
| 미래 기기/알림 데이터           | mock/future-fixture.json          | 기존 API 계약과 분리                                         |
| Repository 로딩/오류            | useAsync/Loading/ErrorState       | 로딩·실패·재시도·이탈 취소                                   |

기존에 없던 매장/점주 생성·수정·삭제, 실제 기기 제어/업데이트, 자동 장애 해소, 결제/매출, 인증은 새로 구현했다고 표시하지 않습니다. 회사 관리자 화면의 점주 **계정 조회**만 이식했고 점주용 웹 자체는 생성/설계/수정하지 않았습니다.

## API와 Mock 구분

이전 Flutter는 ORDER_API_BASE_URL 생략 시 Mock 주문이었습니다. 이번 앱은 실연동을 우선하여 기본 주소 `http://127.0.0.1:8001`을 사용합니다. 기존 Mock 주문 기능은 `VITE_ORDER_SOURCE=mock`으로 명시해서 확인합니다. API 실패를 Mock 성공으로 숨기지 않습니다.

대시보드가 실제 집계와 혼동되지 않게 Mock 표시를 명확히 했습니다. 기존 값은 Flutter에서 추출하여 매장6·점주4·주문8·품목9·기기6·알림6개를 유지했습니다. 기준일은 2026-10-03이며 알림 확인은 메모리에만 저장됩니다.

## 검증 결과

- npm install 성공, 의존성 검사 발견 사항 0건.
- npm run build: TypeScript strict 및 Vite 빌드 성공.
- npm test: 24개 통과. 모든 화면의 검색·필터·상세·이동·페이지·Mock 확인/오류·API 계약 검증.
- npm run dev: localhost:8080 실행 및 실제 브라우저 확인.
- npm run test:live: 기존 FastAPI→Azure GET 목록7건·상세·CORS localhost:8080 확인.
- React 브라우저: 실제 주문7건·페이지 이동·#7 다중 품목/복수 옵션·NULL 테이블 매장 식사·기존 #1 포장2개/#2 테이블3·1개 및 옵션 상세 확인.
- 390×844에서 모바일 메뉴→기기 관리 및 표 가로 스크롤 확인. 화면 크기 임시 설정은 검사 후 해제.
- 브라우저에서 발견한 native fetch 호출 컨텍스트 문제는 전역 fetch를 감싸 호출하도록 수정하고 회귀 테스트를 추가.

PC에 npm이 PATH에 없어 공식 npm 패키지를 `.tools/`에 임시 준비하여 표준 npm 명령을 검증했습니다. 이 도구는 앱 소스/커밋에 포함하지 않습니다.

실제 조회는 기존 개인 설정을 서버 프로세스 메모리에만 읽어 수행했습니다. 프론트에 DB 설정/비밀번호를 복사하지 않았으며 서버는 bytecode 생성도 끄고 실행했습니다. GET만 사용했고 주문 삽입·기존 데이터/스키마 변경은 하지 않았습니다.

## 미검증·한계

- 외부 배포·운영 인증·Safari/Firefox는 미검증. 기존 API에 인증이 없으며 공개 배포하지 않았습니다.
- 키오스크에서 **신규 주문을 생성하는** 전체 흐름은 이번 읽기 전용 검증에 포함하지 않았습니다. 기존 주문의 실제 조회는 검증했습니다.
- 매장/점주/기기/알림은 기존처럼 Mock입니다. 실제 관련 API·DB를 추가하지 않았습니다.
- 기존처럼 주문 모든 페이지 조회 후 클라이언트 필터를 적용하므로 대규모 운영은 서버 검색/필터가 필요합니다.
- 과거 가격/메뉴명 스냅샷은 기존 서버/DB 계약에 없습니다. 금액을 만들어 표시하지 않습니다.

## 변경 범위

`company_admin_web/`만 변경했습니다. kiosk_app/server/docs/점주용 웹/다른 브랜치의 파일은 수정하지 않았습니다. stage/commit/push/merge하지 않았습니다. node_modules/dist/.tools/개인 설정과 캡처는 Git에서 제외합니다.

## 최종 파일 목록

### 추가된 React 소스/설정/문서

```text
.env.example
MIGRATION.md
index.html
package.json
scripts/verify-live-api.mjs
src/App.tsx
src/components/ui.tsx
src/data/adminRepository.ts
src/data/mock/admin-fixture.json
src/data/mock/future-fixture.json
src/data/models.ts
src/data/orderRepository.ts
src/data/selectors.ts
src/features/AlertsPage.tsx
src/features/DashboardPage.tsx
src/features/DevicesPage.tsx
src/features/OrdersPage.tsx
src/features/OwnersPage.tsx
src/features/StoresPage.tsx
src/features/details.tsx
src/hooks/useAsync.ts
src/layout/AdminShell.tsx
src/main.tsx
src/test/app.test.tsx
src/test/repositories.test.ts
src/test/setup.ts
src/theme/components.css
src/theme/tokens.css
tsconfig.json
vite.config.ts
```

### 수정된 파일

```text
.gitignore
README.md
package-lock.json
```

### 대체한 Flutter 파일

```text
.metadata
analysis_options.yaml
lib/app.dart
lib/data/admin_data.dart
lib/data/admin_snapshot.dart
lib/data/future/mock/future_mock_data.dart
lib/data/future/models/device.dart
lib/data/future/models/device_alert.dart
lib/data/mock/mock_data.dart
lib/data/models.dart
lib/data/repositories/admin_repository.dart
lib/data/repositories/mock_admin_repository.dart
lib/data/repositories/order_repository.dart
lib/data/sources/admin_data_source.dart
lib/data/sources/mock_admin_data_source.dart
lib/features/alerts/alerts_page.dart
lib/features/dashboard/dashboard_page.dart
lib/features/devices/devices_page.dart
lib/features/orders/live_orders_page.dart
lib/features/orders/orders_page.dart
lib/features/owners/owners_page.dart
lib/features/stores/stores_page.dart
lib/layout/admin_shell.dart
lib/layout/sidebar.dart
lib/layout/top_bar.dart
lib/main.dart
lib/theme/app_colors.dart
lib/theme/app_spacing.dart
lib/theme/app_text_styles.dart
lib/theme/app_theme.dart
lib/widgets/admin_widgets.dart
lib/widgets/device_status.dart
pubspec.lock
pubspec.yaml
test/admin_ui_test.dart
test/device_alert_test.dart
test/live_orders_test.dart
test/local_order_flow_test.dart
web/favicon.png
web/icons/Icon-192.png
web/icons/Icon-512.png
web/icons/Icon-maskable-192.png
web/icons/Icon-maskable-512.png
web/index.html
web/manifest.json
```
