# AI-Voisk 점주 관리자 웹

React + TypeScript + Vite 기반 점주 관리자 웹입니다. 회사 관리자 웹(`company_admin_web`)과 같은 스택을 쓰지만 코드를 import하지 않고 필요한 테마·공통 컴포넌트를 복사해 독립적으로 동작합니다.

## 실행

Node.js 22.12 이상과 npm이 필요합니다.

```powershell
cd owner_web
npm install
npm run dev
```

브라우저: **http://127.0.0.1:8081**. 8080은 회사 관리자 웹이 쓰므로 8081에 고정했고, 이미 사용 중이면 종료합니다.

```powershell
npm run build   # TypeScript 검사 + dist 생성
npm run preview # 127.0.0.1:8081 (dev와 동시 실행하지 않음)
npm test        # 실제 서버·DB 없는 자동 검증
```

## 데이터 출처

- 지금은 모든 화면이 **시연 데이터(Mock)** 입니다. 서버에 점주용 API가 아직 없어서 서버와 DB에 접속하지 않습니다.
- 화면은 `OwnerRepository` 인터페이스만 사용합니다. 실제 API가 생기면 구현체를 만들어 `App.tsx`의 기본 Repository 한 곳만 바꿉니다.
- `MockOwnerRepository`는 메모리에만 저장합니다. 새로고침하면 처음 상태로 돌아갑니다.
- 메뉴·옵션은 `server/seed_test_menus.sql`, `server/seed_test_options.sql`의 T0001 매장과 같습니다. id 값은 공용 DB와 무관한 Mock 값이고, 시드에는 없는 점주 연결(`ownerId`)을 Mock에서 붙였습니다.
- 주문은 시연 기준 시각(`src/data/demoClock.ts`의 `DEMO_NOW`, 2026-10-29 12:00 한국 시간) 전 30일 동안 20건이고, 그중 4건이 오늘 주문입니다. 서버와 같이 `order_type`은 `takeaway` | `dine_in`, 신규 주문처럼 `table_no`는 NULL이며 한 품목에 옵션 여러 개(`order_item_option`)를 둡니다.
- '오늘'은 브라우저 시간대가 아니라 매장 시간대(Asia/Seoul) 기준입니다.
- 키오스크 연결 상태(`connection`, `lastSeenAt`)는 아직 DB에 없는 Mock 계약입니다.
- 로그인은 아직 없습니다. 회사 관리자 웹의 인증이 main에 합쳐지면 그것을 씁니다.

## 메뉴 관리

- 왼쪽(약 40%)은 편집 패널, 오른쪽(약 60%)은 태블릿 미리보기입니다. 1150px보다 좁으면 미리보기를 위에 두고 위아래로 쌓습니다.
- 미리보기는 `kiosk_app/lib/service/screens/order_screen.dart`를 1280×800 논리 픽셀로 그린 뒤 폭에 맞춰 줄인 것입니다. 서버 `GET /stores/{id}/menus`와 같이 `is_active` 메뉴만 `category_sort, category_id, menu_sort, menu_id` 순서로 보여 줍니다. 아이콘은 Material 대신 비슷한 lucide 아이콘이라 실제 화면과 조금 다릅니다.
- 판매 중인 메뉴가 없는 카테고리는 실제 키오스크에 보이지 않습니다. 미리보기에서는 편집할 수 있게 흐리게 표시합니다. 카테고리 레일 아래 점선 ＋ 버튼은 편집용입니다.
- **품절**(메뉴·저장된 옵션)은 누르는 즉시 Repository에 반영합니다. 나머지 편집(이름, 가격, 설명, 카테고리, 판매 여부, 옵션, 카테고리 추가·이름·삭제)은 화면 초안에만 있고, 저장 바가 생기는 3단계 전까지는 다른 화면으로 이동하면 사라집니다.
- 메뉴가 남은 카테고리는 삭제할 수 없습니다(판매 중지 메뉴 포함). DB FK에 ON DELETE 규칙이 없어 실제로도 거부됩니다. 저장된 옵션 삭제는 주문 기록을 지키기 위해 판매 중지(`is_active = FALSE`)로 처리합니다.

## 구성

```text
src/
  App.tsx / main.tsx            # Repository 주입, 화면 선택
  layout/OwnerShell.tsx         # 사이드바·상단 바·좁은 화면 메뉴
  components/ui.tsx             # 표·검색·필터·모달·배지 등 (회사 관리자 웹에서 복사)
  features/                     # 오늘 현황, 주문 내역, 매장 정보
  features/menus/               # 메뉴 관리: 미리보기, 메뉴·옵션·카테고리 편집, 초안 상태
  data/
    models.ts                   # DB 행 기준 모델
    ownerRepository.ts          # OwnerRepository와 MockOwnerRepository
    selectors.ts                # 품절 개수, 매장 날짜 계산
    menuDraft.ts                # 메뉴 초안 순수 함수, 키오스크 노출 규칙
    validation.ts               # 길이·가격 검증 (DB 제약 기준)
    demoClock.ts                # 시연 기준 시각
    mock/t0001-fixture.json     # T0001 매장 Mock 데이터
  theme/tokens.css              # 색·글자·간격 토큰 (점주 웹 + 키오스크 미리보기)
  theme/components.css          # 공통·반응형·편집 패널 스타일
  theme/preview.css             # 키오스크 미리보기 (--kiosk-* 토큰만 사용)
  hooks/useAsync.ts
  test/                         # 레이아웃·Mock 데이터·메뉴 관리 검증
```

## 색 규칙

- 사이드바와 바탕은 흰색과 밝은 회색입니다. 초록(`--brand`)은 주요 버튼, 선택된 메뉴, 강조 표시에만 씁니다.
- 상태 색은 따로 씁니다. 오류·연결 끊김은 빨강(`--error`), 저장하지 않은 변경은 주황(`--unsaved`), 정상은 연한 초록(`--ok`)입니다.
- 키오스크 미리보기는 `--kiosk-*` 토큰만 씁니다(`kiosk_app/lib/service/screens/order_screen.dart`의 색). 관리자 화면 색과 섞지 않습니다. 편집용 표시(선택된 카드 테두리, 점선 ＋ 버튼)만 예외입니다.
