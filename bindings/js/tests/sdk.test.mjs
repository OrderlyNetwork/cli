import assert from "node:assert/strict";
import test from "node:test";
import {
  MemorySigner,
  OrderlyClient,
  crypto,
  prepare,
} from "../dist/index.js";

const PRIVATE_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const ACCOUNT_ID = "0xabc";

test("builds the exact place-order body", () => {
  const request = prepare("place_order", {
    symbol: "perp_btc_usdc",
    side: "buy",
    orderType: "MARKET",
    quantity: "0.002",
    reduceOnly: true,
  });
  assert.equal(request.method, "POST");
  assert.equal(request.path, "/v1/order");
  assert.equal(request.requiresAuth, true);
  assert.equal(
    request.body,
    '{"symbol":"PERP_BTC_USDC","order_type":"MARKET","side":"BUY","order_quantity":"0.002","reduce_only":true}',
  );
});

test("builds a reduce-only close body", () => {
  const request = prepare("close_position", {
    symbol: "PERP_BTC_USDC",
    positionQty: -0.002,
    partialQuantity: 0.001,
  });
  assert.equal(
    request.body,
    '{"symbol":"PERP_BTC_USDC","order_type":"MARKET","side":"BUY","order_quantity":"0.001","reduce_only":true}',
  );
});

test("signs and verifies a request message", () => {
  const message = "1700000000000POST/v1/order{}";
  const publicKey = crypto.publicKeyFromPrivateKey(PRIVATE_KEY);
  const signature = crypto.sign(message, PRIVATE_KEY);
  assert.equal(crypto.verify(message, signature, publicKey), true);
  assert.equal(crypto.verify(`${message}x`, signature, publicKey), false);
});

test("memory signer exposes the derived public key", async () => {
  const signer = new MemorySigner({ accountId: ACCOUNT_ID, privateKey: PRIVATE_KEY });
  assert.equal(signer.accountId, ACCOUNT_ID);
  assert.equal(signer.publicKey, crypto.publicKeyFromPrivateKey(PRIVATE_KEY));
  const message = "hello";
  assert.equal(
    crypto.verify(message, await signer.sign(message), signer.publicKey),
    true,
  );
});

test("authenticated requests require a signer before fetching", async () => {
  const client = new OrderlyClient({ network: "testnet" });
  await assert.rejects(() => client.request("balance"), /requires a signer/);
});
