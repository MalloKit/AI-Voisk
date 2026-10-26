// Explicit Node runner: this filename is deliberately outside Vitest's *.test.* pattern.
// node --experimental-transform-types --test scripts/verify-owner-contract.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiOwnerRepository, parseOwner, parseOwnerDetail } from "../src/data/ownerRepository.ts";

const owner = { owner_id: 1, login_id: "actual-owner", store_count: 0 };
const store = {
  store_id: 10, store_name: "actual-store", address: "부산",
  address_detail: null, admin_id: 7, admin_name: "actual-admin",
};
test("parses zero, one and multiple connected stores from actual response only", () => {
  assert.equal(parseOwner(owner).storeCount, 0);
  for (const count of [0, 1, 2]) {
    const stores = Array.from({ length: count }, (_, index) => ({ ...store, store_id: 10 + index }));
    const result = parseOwnerDetail({ ...owner, store_count: count, stores });
    assert.equal(result.storeCount, count);
    assert.equal(result.stores.length, count);
    if (count) assert.equal(result.stores[0].addressDetail, "");
  }
});
test("rejects malformed IDs, missing fields, duplicate stores and count mismatches", () => {
  for (const patch of [
    { owner_id: 0 }, { login_id: undefined }, { store_count: -1 }, { store_count: "1" },
  ]) assert.throws(() => parseOwner({ ...owner, ...patch }));
  for (const patch of [
    { stores: [] }, { store_count: 2, stores: [store, store] },
    { stores: [{ ...store, admin_name: undefined }] },
  ]) assert.throws(() => parseOwnerDetail({ ...owner, store_count: 1, ...patch }));
});
test("loads a normal empty list and only calls dedicated GET endpoints", async () => {
  const calls = [], responses = [
    { owners: [], total: 0 }, { owners: [owner], total: 1 }, { ...owner, stores: [] },
  ];
  const repository = new ApiOwnerRepository("http://localhost:8001/base/", async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(responses.shift()));
  });
  assert.deepEqual(await repository.load(), []);
  assert.equal((await repository.load())[0].storeCount, 0);
  assert.equal((await repository.detail(1)).id, 1);
  assert.equal(calls[0].url, "http://localhost:8001/base/admin/owners");
  assert.equal(calls[2].url, "http://localhost:8001/base/admin/owners/1");
  assert(calls.every(({ init }) => init.method === "GET"));
});
test("never substitutes errors with empty or Mock accounts", async () => {
  for (const status of [403, 404, 503]) {
    const repository = new ApiOwnerRepository("http://localhost:8001", async () => new Response("", { status }));
    await assert.rejects(repository.load());
    await assert.rejects(repository.detail(1));
  }
  for (const payload of [
    { owners: [owner], total: 2 }, { owners: [owner, owner], total: 2 },
    { owners: null, total: 0 },
  ]) {
    const repository = new ApiOwnerRepository("http://localhost:8001", async () => new Response(JSON.stringify(payload)));
    await assert.rejects(repository.load());
  }
  const repository = new ApiOwnerRepository("http://localhost:8001", async () => new Response(JSON.stringify({ ...owner, stores: [] })));
  await assert.rejects(repository.detail(2));
});
test("rejects invalid detail IDs and unsafe URLs before invoking transport", async () => {
  let called = false;
  const transport = async () => { called = true; throw new Error("unexpected fetch"); };
  const repository = new ApiOwnerRepository("http://localhost:8001", transport);
  await assert.rejects(repository.detail(0));
  for (const url of ["file:///private", "http://user:secret@localhost:8001"])
    await assert.rejects(new ApiOwnerRepository(url, transport).load(), /점주 API 주소/);
  assert.equal(called, false);
});
test("cancels pending requests on abort and timeout", async () => {
  const transport = async (_url, init) => new Promise((_resolve, reject) => {
    if (init.signal.aborted) reject(new Error("aborted"));
    else init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  const controller = new AbortController();
  const request = new ApiOwnerRepository("http://localhost:8001", transport).load(controller.signal);
  controller.abort();
  await assert.rejects(request, /aborted/);
  await assert.rejects(new ApiOwnerRepository("http://localhost:8001", transport, 5).load(), /aborted/);
});
