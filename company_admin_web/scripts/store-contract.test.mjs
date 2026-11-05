// Run with Node >=22.12: node --experimental-transform-types --test scripts/store-contract.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiStoreRepository, parseStore } from "../src/data/storeRepository.ts";

const row = {
  store_id: 1, store_name: "실제 매장", address: "부산", address_detail: null,
  store_code: "00123", phone: "051-123", business_no: "0000000001",
  representative: "대표자", store_type: "카페", admin_id: 2, admin_name: "관리자",
  owner_id: null, owner_login_id: null,
};

test("store response preserves strings and nullable relationships without inferring postcode", () => {
  const store = parseStore(row);
  assert.equal(store.storeCode, "00123");
  assert.equal(store.businessNo, "0000000001");
  assert.equal(store.ownerId, null);
  assert.equal(store.addressDetail, "");
  assert.equal("postcode" in store, false);
  for (const patch of [
    { store_id: 0 }, { store_code: 123 }, { admin_id: null }, { owner_id: undefined },
    { owner_id: null, owner_login_id: "contradiction" }, { admin_name: undefined },
  ]) assert.throws(() => parseStore({ ...row, ...patch }));
});

test("repository requests only admin GET endpoints and rejects incomplete data", async () => {
  const calls = [];
  const responses = [
    { stores: [row], total: 1 }, row,
    { stores: [row], total: 2 }, { stores: [row, row], total: 2 }, { ...row, store_id: 2 },
  ];
  const transport = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(responses.shift()));
  };
  const repository = new ApiStoreRepository("http://localhost:8001/base/", transport);
  assert.equal((await repository.load())[0].id, 1);
  assert.equal((await repository.detail(1)).storeCode, "00123");
  assert.equal(calls[0].url, "http://localhost:8001/base/admin/stores");
  assert.equal(calls[1].url, "http://localhost:8001/base/admin/stores/1");
  await assert.rejects(repository.load());
  await assert.rejects(repository.load());
  await assert.rejects(repository.detail(1));
  await assert.rejects(repository.detail(0));
  assert(calls.every(({ init }) => init.method === "GET"));
});

test("repository does not replace HTTP errors with Mock data", async () => {
  for (const status of [403, 404, 503]) {
    const repository = new ApiStoreRepository("http://localhost:8001", async () => new Response("", { status }));
    await assert.rejects(repository.load());
    await assert.rejects(repository.detail(1));
  }
  const repository = new ApiStoreRepository("http://localhost:8001", async () => new Response("invalid-json"));
  await assert.rejects(repository.load());
});

test("abort and timeout cancel transport; unsafe URLs never invoke fetch", async () => {
  const transport = async (_url, init) => new Promise((_resolve, reject) => {
    if (init.signal.aborted) reject(new Error("aborted"));
    else init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  const controller = new AbortController();
  const request = new ApiStoreRepository("http://localhost:8001", transport).load(controller.signal);
  controller.abort();
  await assert.rejects(request, /aborted/);
  await assert.rejects(new ApiStoreRepository("http://localhost:8001", transport, 5).load(), /aborted/);
  for (const url of ["file:///private", "http://user:secret@localhost:8001"]) {
    await assert.rejects(new ApiStoreRepository(url, () => { throw new Error("Must not fetch"); }).load(),
      /매장 API 주소/);
  }
});
