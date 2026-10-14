#!/usr/bin/env bash
# Claude Code 클라우드 환경의 Setup script 칸에서 부르는 스크립트(root로 실행, 결과는 약 7일 캐시).
# 환경 설정 칸에는 다음 한 줄만 넣는다:
#   bash scripts/cloud/setup.sh || true
# 키오스크 테스트용 Flutter SDK(stable)를 설치한다. Android SDK는 설치하지 않으므로
# flutter analyze / flutter test 까지만 되고 APK 빌드는 안 된다.
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

if ! command -v flutter >/dev/null 2>&1; then
  git clone --depth 1 --branch stable https://github.com/flutter/flutter.git /opt/flutter \
    && ln -sf /opt/flutter/bin/flutter /usr/local/bin/flutter \
    && ln -sf /opt/flutter/bin/dart /usr/local/bin/dart
fi

if command -v flutter >/dev/null 2>&1; then
  # 세션 사용자와 root가 같은 SDK를 쓰도록 git 소유자 검사를 끈다.
  git config --system --add safe.directory /opt/flutter
  flutter config --no-analytics >/dev/null 2>&1
  flutter --version
  (cd kiosk_app && flutter pub get)
fi
