import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { MockAdminRepository } from "../data/adminRepository";
import { ApiDeviceRepository, liveConnection } from "../data/deviceRepository";

const TOKEN = "Tq3".repeat(14) + "x";
const device = (lastSeen: string | null) => ({ device_id: 7, device_code: "K-7", store_id: 1, store_name: "실제 매장 1",
  store_address: "부산", store_address_detail: null, is_active: true, registered_at: "2026-10-29T00:00:00+00:00",
  app_version: "1.1.0+2", last_seen_at: lastSeen, last_synced_at: lastSeen });

function fixture(lastSeen: string | null = null) {
  const requests: { path: string; method: string; headers: Headers }[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const http = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname;
    const method = init?.method ?? "GET";
    requests.push({ path, method, headers: new Headers(init?.headers) });
    if (path === "/auth/admin/csrf") return json({ csrf_token: "c".repeat(43) });
    if (path === "/admin/devices/7/token" && method === "POST") return json({ device_id: 7, store_id: 1, token: TOKEN });
    if (path === "/admin/devices") return json({ devices: [device(lastSeen)], total: 1 });
    return json(device(lastSeen));
  });
  return { requests, repo: new ApiDeviceRepository("http://localhost:8001", http) };
}

async function open(f: ReturnType<typeof fixture>) {
  const other = () => ({ load: vi.fn().mockResolvedValue([]), detail: vi.fn() });
  render(<App repository={new MockAdminRepository()} orderRepository={other()} ownerRepository={other()}
    alertRepository={other()} storeRepository={null} deviceRepository={f.repo} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "전체 새로고침" })).toBeEnabled());
  const user = userEvent.setup();
  await user.click(within(screen.getByRole("navigation", { name: "주요 화면" })).getByRole("button", { name: "기기 관리" }));
  return user;
}

describe("키오스크 기기 토큰", () => {
  it("확인을 거쳐 새 토큰을 발급하고 원문을 한 번만 보여 준다", async () => {
    const f = fixture();
    const user = await open(f);
    await user.click(await screen.findByRole("button", { name: "기기 상세: K-7" }));
    const dialog = within(screen.getByRole("dialog"));
    await user.click(await dialog.findByRole("button", { name: "기기 토큰 발급" }));
    expect(dialog.getByText(/이전 토큰은 바로 쓸 수 없게 됩니다/)).toBeInTheDocument();
    expect(f.requests.some((r) => r.path.endsWith("/token"))).toBe(false);
    await user.click(dialog.getByRole("button", { name: "새 토큰 발급" }));
    expect(await dialog.findByLabelText("발급된 기기 토큰")).toHaveValue(TOKEN);
    const post = f.requests.find((r) => r.path === "/admin/devices/7/token")!;
    expect(post.method).toBe("POST");
    expect(post.headers.get("X-CSRF-Token")).toBe("c".repeat(43));
    expect(dialog.getByText(/매장 번호 1, 기기 번호 7/)).toBeInTheDocument();
  });

  it("응답 형식이 맞지 않는 토큰은 받지 않는다", async () => {
    const http = vi.fn<typeof fetch>().mockImplementation(async (input) =>
      String(input).endsWith("/csrf")
        ? new Response(JSON.stringify({ csrf_token: "c".repeat(43) }))
        : new Response(JSON.stringify({ device_id: 8, store_id: 1, token: TOKEN })),
    );
    await expect(new ApiDeviceRepository("http://localhost:8001", http).issueToken(7)).rejects.toThrow();
  });

  it("키오스크 상태 보고 시각으로 연결 상태를 표시한다", () => {
    const now = Date.parse("2026-11-11T03:00:00Z");
    expect(liveConnection("2026-11-11T02:59:00+00:00", now)).toBe("연결");
    expect(liveConnection("2026-11-11T02:50:00+00:00", now)).toBe("연결 끊김");
    expect(liveConnection(null, now)).toBe("미확인");
  });
});
