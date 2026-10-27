// 명시적 Node 실행용이며 Vitest 자동 수집 파일명이 아닙니다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiDeviceRepository, parseDevice } from "../src/data/deviceRepository.ts";

const row = {
  device_id: 1, device_code: "REAL-001", store_id: 1,
  store_name: "실제 매장", store_address: "부산", store_address_detail: null,
  is_active: true, registered_at: "2026-10-27T00:00:00+00:00",
  app_version: null, last_seen_at: null, last_synced_at: null,
};
test("정수 ID와 NULL, 오프셋 시각을 보존한다", () => {
  const result = parseDevice(row);
  assert.equal(typeof result.device_id, "number");
  assert.equal(result.app_version, null);
  assert.equal(result.last_seen_at, null);
  const offset = "2026-10-27T09:00:00+09:00";
  const parsed = parseDevice({ ...row, last_seen_at: offset });
  assert.equal(new Date(parsed.last_seen_at).getTime(), new Date(row.registered_at).getTime());
  for (const patch of [
    { device_id: "1" }, { is_active: 1 }, { app_version: undefined },
    { last_seen_at: "2026-10-27T09:00:00" }, { registered_at: null },
  ]) assert.throws(() => parseDevice({ ...row, ...patch }));
});
test("응답 모델에 불필요한 필드를 복사하지 않는다", () => {
  const result = parseDevice({ ...row, unexpected_private_field: "fixture-private" });
  assert.equal("unexpected_private_field" in result, false);
  assert.equal(JSON.stringify(result).includes("fixture-private"), false);
});
test("빈 목록·목록·상세에 기기 GET 경로만 사용한다", async () => {
  const calls = [], payloads = [
    { devices: [], total: 0 }, { devices: [row], total: 1 }, row,
  ];
  const repository = new ApiDeviceRepository("http://localhost:8001/base/", async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(payloads.shift()));
  });
  assert.deepEqual(await repository.load(), []);
  assert.equal((await repository.load())[0].device_id, 1);
  assert.equal((await repository.detail(1)).device_code, "REAL-001");
  assert.equal(calls[0].url, "http://localhost:8001/base/admin/devices");
  assert.equal(calls[2].url, "http://localhost:8001/base/admin/devices/1");
  assert(calls.every(({ init }) => init.method === "GET"));
});
test("HTTP 실패·불완전 목록·중복·상세 ID 불일치를 거부한다", async () => {
  for (const status of [403, 404, 503]) {
    const repository = new ApiDeviceRepository("http://localhost:8001", async () => new Response("", { status }));
    await assert.rejects(repository.load());
    await assert.rejects(repository.detail(1));
  }
  for (const payload of [
    { devices: [row], total: 2 }, { devices: [row, row], total: 2 },
  ]) await assert.rejects(new ApiDeviceRepository("http://localhost:8001",
    async () => new Response(JSON.stringify(payload))).load());
  const repository = new ApiDeviceRepository("http://localhost:8001",
    async () => new Response(JSON.stringify(row)));
  await assert.rejects(repository.detail(2));
});
test("위험한 주소와 잘못된 ID는 fetch 전에 거부한다", async () => {
  let calls = 0;
  const transport = async () => { calls++; throw new Error("unexpected"); };
  for (const url of ["file:///private", "http://user:secret@localhost:8001"])
    await assert.rejects(new ApiDeviceRepository(url, transport).load(), /기기 API 주소/);
  await assert.rejects(new ApiDeviceRepository("http://localhost:8001", transport).detail(0));
  assert.equal(calls, 0);
});
test("취소와 타임아웃을 전파한다", async () => {
  const transport = async (_url, init) => new Promise((_resolve, reject) => {
    if (init.signal.aborted) reject(new Error("aborted"));
    else init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  const controller = new AbortController();
  const request = new ApiDeviceRepository("http://localhost:8001", transport).load(controller.signal);
  controller.abort();
  await assert.rejects(request, /aborted/);
  await assert.rejects(new ApiDeviceRepository("http://localhost:8001", transport, 5).load(), /aborted/);
});
