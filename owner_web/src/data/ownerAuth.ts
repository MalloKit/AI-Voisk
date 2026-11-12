// 점주 인증 공통 정의. 계정 정책은 feature/company-admin-v2의 OWNER_WRITES.md(점주 계정 생성)와 같다.

export interface OwnerStore {
  storeId: number;
  storeName: string;
}
// 서버 세션으로 확인한 점주. 화면은 이 값으로만 로그인 여부와 매장 목록을 정한다.
export interface AuthOwner {
  ownerId: number;
  loginId: string;
  stores: OwnerStore[];
  // 회사 관리자가 매장 전화번호로 초기화한 임시 비밀번호로 로그인했으면 true.
  // 이 동안 서버는 /owner/* 데이터 API를 403으로 막으므로 비밀번호 변경 화면만 보인다.
  passwordChangeRequired: boolean;
}
export interface OwnerLoginInput {
  loginId: string;
  password: string;
}
// 새 비밀번호 확인 값은 화면에서만 비교하고 서버에는 보내지 않는다.
export interface OwnerPasswordChangeInput {
  currentPassword: string;
  newPassword: string;
}

export const OWNER_LOGIN_ID_MIN = 4;
export const OWNER_LOGIN_ID_MAX = 100;
export const OWNER_PASSWORD_MIN = 8;
export const OWNER_PASSWORD_MAX = 128;

// 소문자 영문·숫자·마침표·밑줄·하이픈 4~100자. 앞뒤 공백도 고치지 않고 거부한다.
export const validOwnerLoginId = (value: string) =>
  value.length >= OWNER_LOGIN_ID_MIN &&
  value.length <= OWNER_LOGIN_ID_MAX &&
  /^[a-z0-9._-]+$/.test(value);

// Unicode 코드 포인트 8~128자. 전부 공백이거나 제어 문자·고립 surrogate가 있으면 거부한다.
export function validOwnerPassword(value: string) {
  const characters = Array.from(value);
  return (
    !!value.replace(/[\s\u0085]/gu, "") &&
    characters.length >= OWNER_PASSWORD_MIN &&
    characters.length <= OWNER_PASSWORD_MAX &&
    !characters.some((c) => {
      const code = c.codePointAt(0)!;
      return code < 32 || code === 127 || (code >= 0xd800 && code <= 0xdfff);
    })
  );
}

// 아이디가 틀렸는지 비밀번호가 틀렸는지 구분하지 않는다.
export const LOGIN_FAILED = "로그인 ID 또는 비밀번호가 올바르지 않습니다.";

// 비밀번호 변경 실패 문구. 서버 상태 코드별로 나눈다.
export const PASSWORD_CHANGE_MESSAGES = {
  // 현재 비밀번호가 틀림(세션은 그대로)
  401: "현재 비밀번호가 올바르지 않습니다.",
  403: "요청을 확인할 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.",
  422: `새 비밀번호를 확인해 주세요. ${OWNER_PASSWORD_MIN}~${OWNER_PASSWORD_MAX}자이고, 현재 비밀번호나 매장 전화번호와 달라야 합니다.`,
  429: "비밀번호 확인 시도가 많습니다. 1분 뒤 다시 시도해 주세요.",
} as const;
export const PASSWORD_CHANGED = "비밀번호를 변경했습니다.";

export class OwnerAuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
    // "current_password": 401이지만 로그인 만료가 아니라 현재 비밀번호가 틀린 경우
    readonly reason?: "current_password",
  ) {
    super(message);
    this.name = "OwnerAuthError";
  }
}
// 로그인 만료(다시 로그인해야 함)만 true. 현재 비밀번호가 틀린 401은 제외한다.
export const isUnauthorized = (error: unknown) =>
  error instanceof OwnerAuthError &&
  error.status === 401 &&
  error.reason !== "current_password";

// 점주 데이터 API가 401을 받으면 이 이벤트를 보내 AppEntry가 로그인 화면으로 돌린다.
export const OWNER_SESSION_EXPIRED = "voisk:owner-session-expired";
export const notifySessionExpired = () =>
  window.dispatchEvent(new Event(OWNER_SESSION_EXPIRED));
