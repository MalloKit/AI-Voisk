import type { ComponentProps } from "react";
import { App } from "./App";
import { LoginPage } from "./features/LoginPage";

/** 별도 미리보기 경로입니다. 인증 가드나 로그인 성공 경로가 아닙니다. */
export function AppEntry(props: ComponentProps<typeof App>) {
  return window.location.pathname.replace(/\/+$/, "") === "/login"
    ? <LoginPage />
    : <App {...props} />;
}
