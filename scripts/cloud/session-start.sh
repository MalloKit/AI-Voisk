#!/usr/bin/env bash
# Claude Code 클라우드 세션 시작 때 서버와 관리자 웹 의존성을 설치한다.
# 로컬 PC에서는 아무것도 하지 않는다(CLAUDE_CODE_REMOTE는 클라우드에서만 "true").
# 실패해도 세션은 계속되므로, 단계별로 결과만 남기고 다음 단계로 넘어간다.
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
status=0

# 서버: README가 Python 3.14 + uv 기준이다. uv가 없으면 기본 python으로 대신한다.
if [ ! -x "$ROOT/server/.venv/bin/python" ]; then
  cd "$ROOT/server" || exit 1
  if command -v uv >/dev/null 2>&1; then
    uv venv --python 3.14 .venv >/dev/null 2>&1 || uv venv .venv >/dev/null 2>&1
    uv pip install --python .venv/bin/python -r requirements.txt >/dev/null 2>&1 \
      && echo "[cloud] server 의존성 설치 완료" \
      || { echo "[cloud] server 의존성 설치 실패"; status=1; }
  else
    python3 -m venv .venv \
      && .venv/bin/pip install -q -r requirements.txt \
      && echo "[cloud] server 의존성 설치 완료(uv 없음, python3 사용)" \
      || { echo "[cloud] server 의존성 설치 실패"; status=1; }
  fi
fi

# 관리자 웹: Vite 8은 Node 22.12 이상이 필요하다. 버전이 낮으면 알리기만 한다.
if [ ! -d "$ROOT/company_admin_web/node_modules" ]; then
  cd "$ROOT/company_admin_web" || exit 1
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)' \
    || echo "[cloud] Node $(node --version) 는 package.json 요구(>=22.12)보다 낮다"
  npm ci --no-audit --no-fund >/dev/null 2>&1 \
    && echo "[cloud] company_admin_web 의존성 설치 완료" \
    || { echo "[cloud] company_admin_web 의존성 설치 실패"; status=1; }
fi

exit $status
