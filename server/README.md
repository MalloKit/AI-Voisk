# 손님 메뉴 조회용 로컬 API

Python·FastAPI로 만든 메뉴 조회 서버입니다. Azure MySQL 조회 연결과 Android 에뮬레이터의 Flutter 요청까지 확인했습니다.
기본 화면은 임시 메뉴를 사용하고, API 연결 실행 명령을 지정하면 실제 DB 메뉴를 조회합니다.
Azure 배포·주문 저장·실제 옵션 조회·점주 메뉴 관리·관리자 매장 관리는 아직 구현하지 않았습니다.
팀 공통 API로 채택할지 담당자와 협의한 뒤 통합해야 합니다.

## 파일 역할

| 파일 | 역할 |
| --- | --- |
| main.py | 상태 확인·임시 메뉴·DB 매장 및 메뉴 조회 API |
| database.py | .env를 읽어 인증서를 검증하는 TLS 접속, 읽기 전용 조회 |
| check_db.py | 비밀번호를 출력하지 않고 연결·매장 번호·메뉴 개수 확인 |
| sample_menus.json | 임시 메뉴 14개, Flutter 메뉴와 자동 동기화되지 않음 |
| requirements.txt | 검증한 직접 의존성 버전 |
| test_api.py | 메뉴 형식·품절·카테고리·DB 응답 변환·오류 처리 검사 |
| .gitignore | .env·.venv·생성 파일 제외 |
| README.md | 실행 및 검증 안내 |

기존 .gitkeep은 변경하지 않았습니다. 실제 접속 설정은 server/.env에만 둡니다.
팀원이 코드를 받으면 자신의 PC에 접속 설정 파일을 별도로 준비해야 합니다.
현재 DB 설정 5개: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD.
선택 설정 DB_SSL_CA는 별도 신뢰 인증서 파일이 필요한 환경에서 사용할 수 있습니다.
비밀번호 값은 GitHub에 올리지 않습니다.

## 설치·실행

VS Code → 터미널 → 새 터미널에서 한 줄씩 실행합니다.
uv는 Python 환경 관리 도구입니다. 이 PC에는 설치되어 있습니다.
처음 설치할 때만 환경 생성과 도구 설치를 실행합니다.

```powershell
cd C:\AI-Voisk\server
uv venv --python 3.14 .venv
uv pip install --python .venv/Scripts/python.exe -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001
```

나중에는 마지막 실행 명령만 사용합니다. 종료는 해당 터미널에서 Ctrl + C입니다.
127.0.0.1은 현재 PC입니다. PC용 로컬 서버로 실행하며 Azure에는 아직 배포하지 않았습니다.
8001이 사용 중이면 기존 실행 터미널을 확인하세요. 번호를 바꾸면 앱의 API 주소도 함께 바꿔야 합니다.

## 브라우저 확인

- http://127.0.0.1:8001/docs : 요청 시험 화면
- /health : 임시 API 상태, DB 연결을 의미하지 않음
- /menus : 임시 메뉴 14개, category로 필터 가능
- /db/health : 실제 DB 접속 확인
- /stores : 실제 매장 번호·이름 조회
- /stores/{store_id}/menus : 해당 매장의 활성 메뉴, 품절 메뉴는 포함

/docs → 원하는 GET 항목 → Try it out → 필요한 값 입력 → Execute를 누릅니다.
Response body에 응답이 표시됩니다. JSON은 화면과 서버가 정보를 주고받는 글 형식입니다.
실제 DB에 메뉴가 없으면 빈 목록 []이 정상입니다.
메뉴 id는 Flutter와 맞추기 위해 문자열, 가격은 원 단위 정수, 품절은 isSoldOut으로 보냅니다.
매장 번호를 임의로 1로 시험할 수 있지만 실제 매장 1이 등록된 것은 아닙니다.

## Flutter 연결

Android 에뮬레이터에서 확인할 때는 API 터미널을 켜 둔 채 다른 터미널에서 실행합니다.

```powershell
cd C:\AI-Voisk\kiosk_app
flutter run -t lib/main_preview.dart --dart-define=MENU_API_BASE_URL=http://10.0.2.2:8001 --dart-define=STORE_ID=1
```

10.0.2.2는 Android 에뮬레이터가 PC의 서버에 접속하는 주소입니다.
실제 태블릿에는 별도 주소·네트워크 설정이 필요합니다.
STORE_ID는 매장 등록 후 /stores에 나온 실제 번호로 교체합니다.
API 모드에서는 임시 추가 옵션을 사용하지 않습니다. 실제 옵션 API 연결은 이후 작업입니다.
임시 메뉴 화면은 dart-define 없이 flutter run -t lib/main_preview.dart로 실행합니다.

## 검증 결과 (2026-10-09)

- Flutter 코드 검사 문제 없음, 전체 자동 테스트 13개 통과.
- 서버 자동 테스트 6개 통과. DB 응답 변환·빈 목록·오류 상세 숨김 포함.
- Azure TLS 접속 및 읽기 전용 조회 성공: 매장 0개, 메뉴 0개.
- Android 에뮬레이터에서 실제 메뉴 API 요청 200 응답과 빈 메뉴 안내 확인.
- 실제 DB 데이터가 없어서 등록된 음식·옵션·주문 저장의 통합 동작은 확인하지 못함.
- 실제 갤럭시 탭 및 Azure API 배포는 미검증.

서버 테스트 실행:

```powershell
cd C:\AI-Voisk\server
.\.venv\Scripts\python.exe -m unittest -v test_api
.\.venv\Scripts\python.exe check_db.py
```

현재 테스트 도구의 httpx 사용에 관한 폐기 예정 경고가 나오지만 6개 검사는 통과했습니다.
의존성 업그레이드 때 테스트 클라이언트 변경 여부를 확인해야 합니다.

## 공유·삭제

공유 대상은 위 표의 8개 파일입니다. .env·.venv·__pycache__는 제외합니다.
Commit·Push·병합·DB 데이터 추가·구조 변경은 하지 않았습니다.
추후 삭제 요청이 있으면 당시 파일 상태를 확인해 이번 작업 파일만 제거하고,
기존 .gitkeep·사용자가 저장한 .env·다른 팀원이 추가한 파일은 보존합니다.
정식 서비스 배포 전 기기 인증·HTTPS·운영 설정을 팀에서 연결해야 합니다.
