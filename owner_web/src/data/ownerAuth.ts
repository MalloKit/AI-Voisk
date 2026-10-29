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
}
export interface OwnerLoginInput {
  loginId: string;
  password: string;
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

export class OwnerAuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "OwnerAuthError";
  }
}
export const isUnauthorized = (error: unknown) =>
  error instanceof OwnerAuthError && error.status === 401;

// 점주 데이터 API가 401을 받으면 이 이벤트를 보내 AppEntry가 로그인 화면으로 돌린다.
export const OWNER_SESSION_EXPIRED = "voisk:owner-session-expired";
export const notifySessionExpired = () =>
  window.dispatchEvent(new Event(OWNER_SESSION_EXPIRED));
