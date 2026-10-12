# AI-Voisk 회사 관리자 웹

React + TypeScript + Vite 기반 회사 관리자 웹입니다. 같은 폴더의 기존 Flutter 관리자 앱을 대체했습니다. 키오스크·FastAPI·Azure MySQL·점주용 프로젝트는 전환 대상이 아닙니다.

## 실행

Node.js 22.12 이상과 npm이 필요합니다. Node 24.19.0에서 검증했습니다. 회사 관리자 폴더에서 실행합니다.

```powershell
npm install
npm run dev
```

브라우저: **http://127.0.0.1:8080** (또는 http://localhost:8080). 기존 FastAPI를 **http://127.0.0.1:8001**에서 별도로 실행해야 실제 주문이 조회됩니다. 서버 실행은 기존 서버 안내를 따릅니다. 이 앱은 DB에 직접 접속하지 않습니다.

개발/미리보기 포트는 8080으로 고정되며 이미 사용 중이면 종료합니다. 기존 FastAPI의 CORS 허용 주소와 일치하므로 서버나 프록시를 수정하지 않았습니다.

```powershell
npm run build       # TypeScript 검사 + dist 생성
npm run preview     # localhost:8080 (dev와 동시 실행하지 않음)
npm test            # 실제 DB 없는 자동 검증
npm run test:live   # 로컬 FastAPI 실행 시 GET 목록/상세/CORS 읽기 전용 검증
```

이 PC에는 npm이 PATH에 없어 `.tools/` 안에 공식 npm 패키지를 임시 준비했습니다. 이 도구는 Git에 포함되지 않으며 앱 의존성이 아닙니다. 일반 환경에는 npm이 포함된 Node.js 배포판을 설치하면 위 명령을 사용합니다. 현재 PC의 준비된 도구를 사용하려면 현재 PowerShell 세션에만 다음 경로를 추가합니다.

```powershell
$env:PATH = (Join-Path (Get-Location) '.tools') + ';' + $env:PATH
npm install
npm run dev
```

## 데이터 출처

- **주문 조회**: 기본적으로 실제 FastAPI를 호출합니다. GET만 사용하며 저장·결제 API를 호출하지 않습니다.
- **운영 요약·매장·점주·기기·장애/알림**: 기존 Flutter와 동일한 Mock 데이터/기능을 유지합니다. 대시보드 주문 지표도 Mock입니다.
- 알림 확인은 Repository 메모리에서만 반영됩니다. 화면 이동 시 유지되지만 새로고침하면 초기화됩니다. 기기 연결 상태나 장애 해소 여부를 변경하지 않습니다.
- API 오류를 Mock 데이터로 대체하지 않습니다.

공개 설정은 `.env.example`을 참고하세요. 주소를 변경하려면 개인 `.env.local`에 `VITE_ORDER_API_BASE_URL`을 지정하고 개발 서버를 재시작합니다. **VITE\_ 값은 브라우저에 포함되므로 비밀번호·DB 설정·인증 비밀을 넣지 마세요.**

Mock 주문 확인은 `VITE_ORDER_SOURCE=mock`을 명시합니다. 기본값은 `api`이며 주소를 생략해도 자동으로 Mock 전환하지 않습니다.

## 유지한 화면 기능

| 화면      | 기능                                                                                    |
| --------- | --------------------------------------------------------------------------------------- |
| 운영 요약 | 매장·점주·미연결 매장·최근 7일 주문, 기기/알림 현황, Mock 주문·매장 상세, 각 화면 이동  |
| 매장 관리 | 이름·대표자·사업자번호 검색, 업종·점주 연결 필터, 초기화, 기본 정보·담당자·점주 상세    |
| 점주 계정 | ID·로그인 ID 검색, 매장 연결 필터, 초기화, 계정별 연결 매장 상세                        |
| 주문 조회 | 실제 목록·상세, ID·매장·기간 필터, 새로고침, 복수 옵션·수량·유형, 기존/NULL 테이블 주문 |
| 기기 관리 | ID·매장 검색, 매장·연결 상태 필터, 연결 이력·버전·설치 주소·관련 알림 상세              |
| 장애/알림 | 검색, 유형·상태 필터, 상세, Mock 확인 처리와 실패 재시도                                |

공통: 5행 페이지, 검색어 지우기, 초기화, 로딩/오류/빈 결과, 모바일 메뉴와 표 가로 스크롤, 모달 Escape/초점 복귀.

## 주문 API

```text
GET /admin/orders?limit=200&offset=0
GET /admin/orders/{order_id}
```

목록의 `orders`/`total`을 읽고 기존 Flutter처럼 모든 페이지를 조회한 뒤 화면 필터를 적용합니다. 상세의 메뉴·수량·옵션과 주문 유형을 표시합니다. 날짜는 API 오프셋을 해석하여 브라우저 현지 시각으로 표시합니다.

명시적 `order_type=takeaway|dine_in`을 우선합니다. 이전 응답에 유형이 없으면 `table_no=0`은 포장, 양수는 매장 식사로 해석합니다. NULL 테이블 신규 주문에는 번호를 표시하지 않고 불명확한 유형은 미확인으로 표시합니다. 주문 당시 가격이 없으므로 과거 금액을 만들어 표시하지 않습니다.

요청 타임아웃 20초, 화면 이탈 시 취소. 정식 관리자 인증이 없는 기존 API이므로 로컬 시연으로 사용하며 외부 배포하지 않습니다.

## 구성

```text
src/
  App.tsx / main.tsx          # Repository 주입, 화면 선택
  components/ui.tsx          # 표·검색·필터·모달·카드·상태
  layout/AdminShell.tsx      # 사이드바·상단바·모바일 메뉴
  features/                  # 6개 화면과 상세
  data/
    models.ts / selectors.ts
    adminRepository.ts       # Mock 관리 Repository
    orderRepository.ts       # 실제 GET 주문 Repository
    mock/admin-fixture.json  # 등록 정보/주문 샘플
    mock/future-fixture.json # 미래 기기 상태·알림 샘플
  theme/tokens.css           # 색상·폰트·간격·크기
  theme/components.css      # 공통/반응형 스타일
  hooks/useAsync.ts
  test/                      # 기능/API 계약 검증
scripts/verify-live-api.mjs  # 읽기 전용 실연동 확인
```

기능 비교·검증 범위·미검증 항목: [MIGRATION.md](MIGRATION.md). `.env`, `node_modules`, `.tools`, `dist`, 화면 캡처는 Git에서 제외합니다.
