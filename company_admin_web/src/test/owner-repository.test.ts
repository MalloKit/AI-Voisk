import { describe, expect, it, vi } from "vitest";
import { ApiOwnerRepository, parseOwner, parseOwnerDetail } from "../data/ownerRepository";

const raw = { owner_id: 1, login_id: "real-owner", store_count: 0 };
describe("owner API contract", () => {
  it("accepts an unlinked account and rejects invalid counts and detail relationships", () => {
    expect(parseOwner(raw)).toEqual({ id: 1, loginId: "real-owner", storeCount: 0 });
    expect(parseOwnerDetail({ ...raw, stores: [] }).stores).toEqual([]);
    expect(() => parseOwner({ ...raw, store_count: -1 })).toThrow();
    expect(() => parseOwnerDetail({ ...raw, store_count: 1, stores: [] })).toThrow();
  });
  it("uses independent admin GET endpoints", async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ owners: [raw], total: 1 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...raw, stores: [] })));
    const repository = new ApiOwnerRepository("http://localhost:8001", transport);
    await repository.load();
    await repository.detail(1);
    expect(transport.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:8001/admin/owners", "http://localhost:8001/admin/owners/1",
    ]);
    for (const [, init] of transport.mock.calls) expect(init?.method).toBe("GET");
  });
  it("rejects API errors and mismatched detail IDs", async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...raw, stores: [] })));
    const repository = new ApiOwnerRepository("http://localhost:8001", transport);
    await expect(repository.load()).rejects.toThrow();
    await expect(repository.detail(1)).rejects.toThrow("점주 계정이 없습니다.");
    await expect(repository.detail(2)).rejects.toThrow();
  });
});
