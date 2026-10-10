# AI-Voisk 회사 관리자 Web

회사 관리자용 Material 3 기반 UI입니다. 모든 데이터는 Mock이며 서버/API 요청과 DB 저장은 없습니다. 알림 확인 처리는 Mock Data Source의 메모리에만 반영됩니다.

## 실행

```powershell
cd company_admin_web
flutter pub get
flutter run -d chrome
```

## 확인

```powershell
flutter analyze
flutter test
flutter build web
```

## 화면

- 운영 요약: 등록 매장, 점주 계정, 미연결 매장, 최근 7일 주문, 최근 주문 상세
- 매장 관리: 검색, 업종/점주 연결 필터, 페이지 이동, 기본 정보 상세
- 점주 계정: ID 검색, 연결 여부 필터, 연결 매장 상세
- 주문 조회: 주문 ID 검색, 매장/기간 필터, 품목/옵션/수량 상세
- 기기 관리: 기기 ID/매장 검색, 설치 매장/연결 상태 필터, 마지막 연결/앱 버전 조회, 기기 상세 및 관련 알림
- 장애/알림: 오프라인/연결 오류/업데이트 필요 목록, 유형/확인 상태 필터, 상세 및 확인 완료 처리

시연 기준일은 2026-10-03으로 고정합니다. 최근 N일은 기준일을 포함합니다. 메뉴와 옵션 이름은 현재 등록 정보이며 주문 당시 정보의 보존을 의미하지 않습니다.

## 구조

- `lib/theme/`: 브랜드 색상, 시스템 폰트, 간격/크기 토큰과 Material 3 테마
- `lib/widgets/admin_widgets.dart`: 공통 카드, 버튼, 입력/필터, 표, 상세 다이얼로그
- `lib/layout/`: 사이드바, 상단바, 반응형 앱 레이아웃
- `lib/features/`: 화면 및 화면별 필터 상태
- `lib/data/models.dart`: 기존 DB 필드의 조회용 모델 (비밀번호 제외)
- `lib/data/mock/mock_data.dart`: 시연 데이터와 기준일
- `lib/data/admin_data.dart`: Repository 결과의 조회 및 ID 관계 해석 (Mock에 직접 의존하지 않음)
- `lib/data/admin_snapshot.dart`: 기존 데이터와 향후 데이터의 변경 불가능한 조회 결과
- `lib/data/repositories/admin_repository.dart`: 비동기 조회/알림 확인 인터페이스
- `lib/data/repositories/mock_admin_repository.dart`: Mock Repository 구현
- `lib/data/sources/admin_data_source.dart`: Data Source 인터페이스
- `lib/data/sources/mock_admin_data_source.dart`: 기존/향후 샘플 데이터를 조합하고 메모리에서 확인 상태를 관리
- `lib/data/future/models/`: 현재 DB에 없는 기기/알림의 향후 프론트 계약 (DB/API 확정 명세 아님)
- `lib/data/future/mock/future_mock_data.dart`: 현재 DB에 없는 데이터의 시연 샘플만 별도 보관

## Repository 교체

`CompanyAdminApp(repository: ...)`에 `AdminRepository` 구현체를 주입합니다. 기본 구현은 앱 시작점 `app.dart`에서 구성한 `MockAdminRepository(MockAdminDataSource())`입니다. 화면은 Mock 파일을 직접 참조하지 않습니다.

향후 API Repository가 `load()`로 `AdminSnapshot`을 반환하고 `acknowledgeAlert()`를 구현하면 같은 화면 흐름을 사용할 수 있습니다. 실제 엔드포인트, 인증, 권한과 DB 확장은 서버/DB 담당자와 별도로 합의해야 합니다. 초기 데이터 로딩, 실패/재시도, 확인 처리 중/실패 UI를 포함합니다.

## 기기/알림 시연 규칙

기기 상태는 2026-10-03 15:00의 고정 관측 샘플이며 실시간 접속 판정이 아닙니다. 마지막 연결 시각이 없는 기기도 포함합니다.

알림의 `미확인 → 확인 완료`는 검토 표시이며 기기 상태나 장애 해소를 바꾸지 않습니다. `해소됨`은 샘플 이력으로만 제공합니다. 확인 시각은 처리한 로컬 시각입니다. 확인 결과는 같은 실행 중 화면을 이동해도 유지되며 브라우저 새로고침 시 초기화됩니다. DB 저장, 원격 업데이트/재시작은 수행하지 않습니다.

최종 브랜드 통일 시 `theme/`와 공통 위젯에서 스타일을 조정합니다. 외부 폰트 다운로드 없이 시스템 한글 폰트를 사용합니다. 1000px 미만에서는 사이드바가 드로어로 바뀌며 표는 가로 스크롤됩니다.

매출, 결제, AI 성과, 메뉴/가격 수정은 포함하지 않습니다. 점주용 `admin_web` 및 다른 프로젝트에는 의존하지 않습니다. 기존 SQL과 DB 스키마는 수정하지 않습니다.
# 중간 시연 실제 주문 조회

`ORDER_API_BASE_URL`을 지정하면 주문 조회만 실제 FastAPI와 연결됩니다. 나머지 관리 화면은 Mock으로 유지합니다.
실행 방법·중복 방지·테스트·DB 제약은 [서버 시연 안내](../server/MIDTERM_DEMO.md)를 참고하세요.
