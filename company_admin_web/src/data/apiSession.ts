export const SESSION_EXPIRED = "voisk:admin-session-expired";

export class AdminApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "AdminApiError";
  }
}

/** 개발용 loopback 별칭을 페이지 호스트와 맞춰 SameSite 쿠키를 유지합니다. */
export function localAdminBaseUrl(value: string): string {
  const url = new URL(value);
  if (typeof window !== "undefined" && window.location.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(window.location.hostname) &&
      url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) {
    url.hostname = window.location.hostname;
  }
  return url.toString().replace(/\/$/, "");
}

export async function adminRequest(
  transport: typeof fetch, input: string, init: RequestInit,
): Promise<Response> {
  const response = await transport(input, { ...init, credentials: "include", cache: "no-store" });
  if (response.status === 401) {
    if (!init.signal?.aborted && typeof window !== "undefined")
      window.dispatchEvent(new Event(SESSION_EXPIRED));
    throw new AdminApiError(401, "관리자 세션이 만료되었습니다. 다시 로그인해 주세요.");
  }
  if (response.status === 403)
    throw new AdminApiError(403, "관리자 접근 권한 또는 서버의 로컬 접속 제한을 확인해 주세요.");
  return response;
}
