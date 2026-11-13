import assert from "node:assert/strict";
import test from "node:test";
import { createDecisionFetch, fromGoogleResponse, toGoogleRequest } from "../adapter.mjs";

const requestBody = () => ({
  model: "gemini-decision-1",
  state: { ticket: "I was charged twice. Refund the second payment." },
  questions: {
    refund: { type: "noul", instructions: "Is a refund requested?", criteria: { true: "Refund requested", false: "No refund" } },
    department: { type: "choice", instructions: "Which department?", criteria: { billing: "Payments", support: "Troubleshooting" } },
    severity: { type: "score", instructions: "How severe?", criteria: ["No issue", "Minor", "Major"] },
  },
});

const upstreamReply = () => ({
  answers: {
    refund: { type: "noul", noul: 0.97, confidence: 0.94 },
    department: { type: "choice", choice: "billing", probabilities: { billing: 0.92, support: 0.08 }, confidence: 0.92 },
    severity: { type: "score", score: 1.6, legend: { 0: "No issue", 1: "Minor", 2: "Major" },
      probabilities: { 0: 0.1, 1: 0.2, 2: 0.7 }, confidence: 0.7 },
  },
  usage: { total_input_tokens: 123, total_output_tokens: 0, total_tokens: 123 },
});

function wrapper({ key = "fixture-key", upstream = upstreamReply(), fetchImpl } = {}) {
  const spy = { calls: [] };
  const fetcher = createDecisionFetch({
    getKey: async () => key,
    fetchImpl: fetchImpl ?? (async (url, init) => {
      spy.calls.push({ url, init });
      return Response.json(upstream);
    }),
  });
  return { fetcher, spy };
}
const run = (fetcher, body = requestBody(), extra = {}) => fetcher(
  "https://generativelanguage.googleapis.com/v1beta/systemone",
  { method: "POST", body: JSON.stringify(body), ...extra },
);

test("maps System One's mixed questions to Google's native Decisions schema", () => {
  const converted = toGoogleRequest(requestBody());
  assert.deepEqual(JSON.parse(converted.input), requestBody().state);
  assert.equal(converted.model, "gemini-decision-1");
  assert.deepEqual(converted.questions.refund.criteria,
    { true_description: "Refund requested", false_description: "No refund" });
  assert.deepEqual(converted.questions.department.criteria, requestBody().questions.department.criteria);
  assert.deepEqual(converted.questions.severity.criteria, ["No issue", "Minor", "Major"]);
});

test("accepts shorthand choices and arbitrary JSON state without mutating inputs", () => {
  const body = requestBody();
  body.questions.department = { type: "choice", choices: ["a", "b"] };
  const converted = toGoogleRequest(body);
  assert.deepEqual(converted.questions.department.criteria, { a: "", b: "" });
  assert.equal(converted.questions.department.instructions.length > 0, true);
  assert.deepEqual(body.questions.department.choices, ["a", "b"]);
});

test("validates answers and keeps native probabilities, confidence and token counts", () => {
  const reply = fromGoogleResponse(upstreamReply(), requestBody());
  assert.equal(reply.answers.refund.noul, 0.97);
  assert.equal(reply.answers.department.choice, "billing");
  assert.equal(reply.answers.severity.score, 1.6);
  assert.equal(reply.usage.total_input_tokens, 123);
  assert.equal(reply.usage.input_tokens, 123);
  assert.equal(reply.usage.output_tokens, 0);
  assert.equal(reply.model, "gemini-decision-1");
});

test("rejects unsupported requests and malformed upstream answers", () => {
  for (const invalid of [
    { ...requestBody(), model: "gemini-3.5-pro" },
    { ...requestBody(), questions: {} },
    { ...requestBody(), questions: { nope: { type: "chat", instructions: "Answer" } } },
    { ...requestBody(), questions: { nope: { type: "choice", choices: ["only"] } } },
    { ...requestBody(), questions: { nope: { type: "score", criteria: ["one"] } } },
    { ...requestBody(), stream: true },
  ]) assert.throws(() => toGoogleRequest(invalid));
  for (const modify of [
    (r) => { delete r.answers.refund; },
    (r) => { r.answers.refund.noul = 1.5; },
    (r) => { r.answers.department.choice = "other"; },
    (r) => { r.answers.department.probabilities.support = 0.9; },
    (r) => { r.answers.severity.score = 9; },
    (r) => { r.answers.severity.confidence = -1; },
  ]) {
    const reply = upstreamReply();
    modify(reply);
    assert.throws(() => fromGoogleResponse(reply, requestBody()));
  }
});

test("forwards only Google AI Studio key to fixed endpoint, never client headers", async () => {
  const { fetcher, spy } = wrapper();
  const response = await run(fetcher, requestBody(), { headers: { authorization: "Bearer client-key", "x-private": "secret" } });
  assert.equal(response.status, 200);
  assert.equal(spy.calls.length, 1);
  assert.equal(spy.calls[0].url, "https://generativelanguage.googleapis.com/v1beta/decisions");
  assert.equal(spy.calls[0].init.headers.get("x-goog-api-key"), "fixture-key");
  assert.equal(spy.calls[0].init.headers.has("authorization"), false);
  assert.equal(spy.calls[0].init.headers.has("x-private"), false);
  assert.equal(spy.calls[0].init.redirect, "error");
  assert.equal((await response.json()).answers.department.choice, "billing");
});

test("does not forward invalid endpoints or requests", async () => {
  let calls = 0;
  const { fetcher } = wrapper({ fetchImpl: async () => { calls++; return Response.json(upstreamReply()); } });
  assert.equal((await fetcher("https://elsewhere.invalid/systemone", { method: "POST", body: JSON.stringify(requestBody()) })).status, 400);
  assert.equal((await fetcher("https://generativelanguage.googleapis.com/v1beta/systemone", { method: "POST", body: "not-json" })).status, 400);
  assert.equal(calls, 0);
});

test("missing key is 503; upstream 401/429/503 retain status and retry headers", async () => {
  assert.equal((await run(wrapper({ key: "" }).fetcher)).status, 503);
  for (const status of [401, 429, 503]) {
    const { fetcher } = wrapper({ fetchImpl: async () => new Response('{"error":{"message":"refused"}}', {
      status, headers: { "retry-after": "7", "set-cookie": "private", "content-type": "application/json" },
    }) });
    const response = await run(fetcher);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("retry-after"), "7");
    assert.equal(response.headers.has("set-cookie"), false);
    assert.deepEqual(await response.json(), { error: { message: "refused" } });
  }
});

test("network failure is 502, timeout is 504 and invalid success is 502", async () => {
  const offline = wrapper({ fetchImpl: async () => { throw new Error("network down"); } });
  assert.equal((await run(offline.fetcher)).status, 502);
  const timeout = wrapper({ fetchImpl: async () => { throw new DOMException("timed out", "TimeoutError"); } });
  assert.equal((await run(timeout.fetcher)).status, 504);
  const malformed = wrapper({ upstream: { answers: {} } });
  assert.equal((await run(malformed.fetcher)).status, 502);
});

test("caller cancellation aborts upstream instead of fabricating a decision", async () => {
  const controller = new AbortController();
  const { fetcher } = wrapper({ fetchImpl: async (_url, init) => {
    assert.equal(init.signal.aborted, false);
    controller.abort();
    init.signal.throwIfAborted();
  } });
  await assert.rejects(run(fetcher, requestBody(), { signal: controller.signal }), { name: "AbortError" });
});
