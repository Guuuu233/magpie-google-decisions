import assert from "node:assert/strict";
import test from "node:test";
import { GoogleDecisionsPlugin } from "../index.mjs";

test("registers a decision-only provider without replacing the built-in Google provider", async () => {
  const plugin = await GoogleDecisionsPlugin();
  const config = { provider: { google: { name: "Existing Google" } } };
  await plugin.config(config);
  assert.equal(config.provider.google.name, "Existing Google");
  assert.equal(config.provider["google-decisions"].decide, true);
  assert.equal(config.provider["google-decisions"].models["gemini-decision-1"].decides, true);
  assert.equal(Object.keys(await plugin.provider.models())[0], "gemini-decision-1");
  assert.equal(plugin.auth.provider, "google-decisions");
});

test("account key stays inside selected Magpie plugin auth and is refreshed per request", async () => {
  const plugin = await GoogleDecisionsPlugin();
  let auth = { type: "api", key: "key-1" };
  const options = await plugin.auth.loader(async () => auth);
  assert.equal(options.baseURL, "https://generativelanguage.googleapis.com/v1beta");
  assert.equal(typeof options.fetch, "function");
  auth = { type: "api", key: "" };
  const response = await options.fetch("https://generativelanguage.googleapis.com/v1beta/systemone", {
    method: "POST",
    body: JSON.stringify({ model: "gemini-decision-1", state: "foo", questions: { ok: { type: "noul", instructions: "Is it okay?" } } }),
  });
  assert.equal(response.status, 503);
});
