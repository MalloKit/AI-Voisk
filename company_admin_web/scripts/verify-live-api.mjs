// Read-only verification. No POST/PUT/PATCH/DELETE and no DB credentials.
const base = (
  process.env.ORDER_API_BASE_URL || "http://127.0.0.1:8001"
).replace(/\/$/, "");
const url = new URL(base);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  !["http:", "https:"].includes(url.protocol)
)
  throw new Error("Live verification is restricted to a local server.");
const allowed = url.origin;
async function get(path) {
  const response = await fetch(`${base}${path}`, {
    method: "GET",
    headers: { Origin: "http://localhost:8080" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(
      `GET ${path.split("?")[0]} failed: HTTP ${response.status}`,
    );
  if (
    !["http://localhost:8080", "*"].includes(
      response.headers.get("access-control-allow-origin"),
    )
  )
    throw new Error("CORS does not allow the company admin browser origin.");
  return response.json();
}
const orders = [];
let total;
do {
  const result = await get(`/admin/orders?limit=200&offset=${orders.length}`);
  if (!Array.isArray(result.orders) || !Number.isInteger(result.total))
    throw new Error("Invalid order list response");
  total = result.total;
  orders.push(...result.orders);
  if (!result.orders.length) break;
} while (orders.length < total);
console.log(
  `Read-only list verified: ${orders.length} orders; CORS localhost:8080 allowed.`,
);
for (const order of orders.slice(0, 5)) {
  const detail = await get(`/admin/orders/${order.order_id}`);
  if (
    !Array.isArray(detail.items) ||
    detail.items.some((i) => !Array.isArray(i.options))
  )
    throw new Error("Invalid order detail response");
  console.log(
    `Order #${detail.order_id}: ${detail.order_type ?? "legacy type"}; ${detail.items.length} items; ${detail.items.reduce((n, i) => n + i.options.length, 0)} option links.`,
  );
}
console.log(`Verified local API ${allowed}; no data writes performed.`);
