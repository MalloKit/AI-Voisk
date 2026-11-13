# 키오스크 APK 릴리스 서명

어느 PC에서 빌드하든 **같은 키로 서명해야** 태블릿에 이미 깔린 앱 위에 덮어 설치됩니다.
서명이 다르면 안드로이드가 설치를 거부하고(`INSTALL_FAILED_UPDATE_INCOMPATIBLE`),
앱을 지우고 다시 깔면 관리자 설정(서버 주소·매장·기기 번호·기기 토큰·PIN)이 모두 지워집니다.

## 필요한 파일 (저장소에 올리지 않음)

| 파일 | 내용 |
|---|---|
| `voisk-release.jks` | 공용 서명 키(PKCS12, 별칭 `voisk`). 처음 만든 PC: `D:\Dev\Keys\ai-voisk\` |
| `kiosk_app/android/key.properties` | 키 위치와 비밀번호 |

두 파일은 `.gitignore`에 들어 있습니다. 메신저·USB 등으로 직접 옮기고 저장소에는 넣지 않습니다.
**키를 잃어버리면 같은 서명을 다시 만들 수 없습니다.** 키 파일을 한 군데 이상 백업해 두세요.

## 다른 PC에서 쓰는 법

1. 키를 만든 PC의 `D:\Dev\Keys\ai-voisk\` 폴더(`voisk-release.jks`, `key.properties`)를 새 PC로 복사합니다.
2. `key.properties`를 `kiosk_app/android/key.properties`에 두고, `storeFile=` 줄을 새 PC의 키 경로로 고칩니다(슬래시 `/`로 씁니다).
   ```
   storePassword=...
   keyPassword=...
   keyAlias=voisk
   storeFile=D:/Dev/Keys/ai-voisk/voisk-release.jks
   ```
3. 평소처럼 빌드합니다.
   ```
   flutter build apk --release
   ```
4. 서명을 확인합니다. `CN=AI-Voisk Kiosk`가 나오면 공용 키입니다.
   ```
   <Android SDK>\build-tools\<버전>\apksigner.bat verify --print-certs build\app\outputs\flutter-apk\app-release.apk
   ```

`key.properties`가 없으면 빌드는 되지만 그 PC의 디버그 키로 서명됩니다(`CN=Android Debug`).
`flutter build` 출력에는 이 경고가 보이지 않으니, 태블릿에 깔 APK는 4번으로 꼭 확인하세요.
디버그 키 APK는 공용 키로 깐 앱 위에 덮어 설치되지 않습니다.

## 처음 한 번: 기존 앱 바꾸기

공용 키 이전에 깐 앱(디버그 키 서명)은 공용 키 APK로 덮어 설치할 수 없습니다. 태블릿마다 **한 번만**
기존 앱을 지우고 새 APK를 설치한 뒤, 관리자 설정 화면에서 서버 주소·매장 ID·기기 ID·기기 토큰과 PIN을 다시 넣습니다.
그다음부터는 어느 PC에서 빌드해도 덮어 설치되고 설정이 남습니다.
