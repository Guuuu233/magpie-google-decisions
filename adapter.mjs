export const MODEL = "gemini-decision-1";
const BASE = "https://generativelanguage.googleapis.com/v1beta";
const SYSTEM_ONE_URL = `${BASE}/systemone`;
const DECISIONS_URL = `${BASE}/decisions`;
const DEFAULT_INSTRUCTIONS = "Evaluate this question using the supplied state.";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const failUnless = (test, message) => { if (!test) throw new Error(message); };
const stringify = (value) => typeof value === "string" ? value : JSON.stringify(value);
const inRange = (n, lo, hi) => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;

function requireKeys(obj, allowed, label) {
  failUnless(isRecord(obj), `${label} must be an object`);
  failUnless(Object.keys(obj).every((key) => allowed.includes(key)), `${label} has unsupported fields`);
}

function toQuestion(question) {
  requireKeys(question, ["type", "instructions", "criteria", "choices"], "Question");
  failUnless(["noul", "choice", "score"].includes(question.type), "Question type must be noul, choice or score");
  const instructions = question.instructions == null || stringify(question.instructions).trim() === ""
    ? DEFAULT_INSTRUCTIONS : stringify(question.instructions);
  const common = { type: question.type, instructions };
  if (question.type === "noul") {
    failUnless(question.choices === undefined, "noul does not accept choices");
    if (question.criteria === undefined || question.criteria === null) return common;
    requireKeys(question.criteria, ["true", "false", "true_description", "false_description"], "Noul criteria");
    const trueDescription = question.criteria.true_description ?? question.criteria.true;
    const falseDescription = question.criteria.false_description ?? question.criteria.false;
    const criteria = {};
    if (trueDescription !== undefined) criteria.true_description = stringify(trueDescription);
    if (falseDescription !== undefined) criteria.false_description = stringify(falseDescription);
    return Object.keys(criteria).length ? { ...common, criteria } : common;
  }
  if (question.type === "choice") {
    failUnless(!(question.choices !== undefined && question.criteria !== undefined), "Use criteria or choices, not both");
    let criteria;
    if (question.choices !== undefined) {
      failUnless(Array.isArray(question.choices) &&
        question.choices.every((v) => typeof v === "string" && v.length > 0), "Invalid choice list");
      failUnless(new Set(question.choices).size === question.choices.length, "Choices must be unique");
      criteria = Object.fromEntries(question.choices.map((v) => [v, ""]));
    } else {
      failUnless(isRecord(question.criteria), "choice requires criteria");
      criteria = Object.fromEntries(Object.entries(question.criteria).map(([k, v]) => [k, v == null ? "" : stringify(v)]));
    }
    failUnless(Object.keys(criteria).length >= 2 && Object.keys(criteria).length <= 255, "choice requires 2–255 options");
    failUnless(Object.keys(criteria).every((v) => v.length > 0), "Empty choice ID");
    return { ...common, criteria };
  }
  failUnless(question.choices === undefined, "score does not accept choices");
  failUnless(Array.isArray(question.criteria) && question.criteria.length >= 2 &&
    question.criteria.length <= 255, "score requires 2–255 rubric levels");
  const criteria = question.criteria.map(stringify);
  failUnless(criteria.every((v) => typeof v === "string" && v.trim().length > 0), "Score rubric levels must be non-empty");
  return { ...common, criteria };
}

export function toGoogleRequest(body) {
  requireKeys(body, ["model", "state", "questions"], "System One request");
  failUnless(body.model === MODEL, `Only ${MODEL} is supported`);
  failUnless(Object.hasOwn(body, "state") && body.state != null, "state is required");
  failUnless(isRecord(body.questions), "questions must be an object");
  const entries = Object.entries(body.questions);
  failUnless(entries.length >= 1 && entries.length <= 1000, "Expected 1–1000 questions");
  failUnless(entries.every(([name]) => name.length > 0), "Question IDs cannot be empty");
  const questions = Object.fromEntries(entries.map(([id, question]) => [id, toQuestion(question)]));
  // System One's state may be arbitrary structured JSON. Google accepts text input.
  const input = stringify(body.state);
  failUnless(typeof input === "string" && input.length > 0, "state must serialize to non-empty text");
  return { model: MODEL, input, questions };
}

function checkProbabilities(probs, expected) {
  failUnless(isRecord(probs), "Missing probability distribution");
  failUnless(Object.keys(probs).length === expected.length &&
    expected.every((key) => Object.hasOwn(probs, key) && inRange(probs[key], 0, 1)), "Invalid probability distribution");
  failUnless(Math.abs(Object.values(probs).reduce((sum, n) => sum + n, 0) - 1) <= 0.02, "Probabilities do not sum to one");
}

export function fromGoogleResponse(reply, source) {
  const sent = toGoogleRequest(source);
  failUnless(isRecord(reply) && isRecord(reply.answers), "Invalid Google decision response");
  const ids = Object.keys(sent.questions);
  failUnless(ids.length === Object.keys(reply.answers).length &&
    ids.every((id) => Object.hasOwn(reply.answers, id)), "Missing or unrequested Google decision answer");
  for (const id of ids) {
    const q = sent.questions[id];
    const answer = reply.answers[id];
    failUnless(isRecord(answer) && answer.type === q.type && inRange(answer.confidence, 0, 1),
      "Wrong answer type or confidence");
    if (q.type === "noul") {
      failUnless(inRange(answer.noul, 0, 1), "Invalid noul probability");
    } else if (q.type === "choice") {
      failUnless(Object.hasOwn(q.criteria, answer.choice), "Unknown choice");
      checkProbabilities(answer.probabilities, Object.keys(q.criteria));
    } else {
      failUnless(inRange(answer.score, 0, q.criteria.length - 1), "Invalid score");
      checkProbabilities(answer.probabilities, q.criteria.map((_, i) => String(i)));
    }
  }
  const usage = isRecord(reply.usage) ? { ...reply.usage } : {};
  if (Number.isInteger(usage.total_input_tokens) && usage.total_input_tokens >= 0)
    usage.input_tokens = usage.total_input_tokens;
  if (Number.isInteger(usage.total_output_tokens) && usage.total_output_tokens >= 0)
    usage.output_tokens = usage.total_output_tokens;
  return { ...reply, model: MODEL, usage };
}

function responseHeaders(response) {
  const headers = new Headers({ "content-type": response.headers.get("content-type") || "application/json" });
  for (const [key, value] of response.headers) {
    if (key === "retry-after" || key === "x-request-id" || key.startsWith("x-ratelimit-"))
      headers.set(key, value);
  }
  return headers;
}

function errorResponse(status, message, headers) {
  return Response.json({ error: { type: "api_error", message } }, { status, headers });
}

export function createDecisionFetch({ getKey, fetchImpl = globalThis.fetch }) {
  return async (url, init) => {
    let request, source, payload;
    try {
      request = new Request(url, init);
      failUnless(request.url === SYSTEM_ONE_URL && request.method === "POST", "Only POST /v1/systemone is supported");
      source = await request.json();
      payload = toGoogleRequest(source);
    } catch (error) {
      if (request?.signal.aborted) throw error;
      return errorResponse(400, error instanceof SyntaxError ? "Invalid JSON" : error.message);
    }
    request.signal.throwIfAborted();
    let key;
    try {
      key = await getKey();
      failUnless(typeof key === "string" && key.trim().length > 0 && !/[\r\n]/.test(key), "Missing API key");
    } catch {
      return errorResponse(503, "Google AI Studio credentials unavailable; sign in to the Google Decisions plugin");
    }
    const headers = new Headers({
      "content-type": "application/json",
      accept: "application/json",
      "x-goog-api-key": key,
    });
    const timeout = AbortSignal.timeout(30000);
    const signal = AbortSignal.any([request.signal, timeout]);
    let upstream;
    try {
      upstream = await fetchImpl(DECISIONS_URL, {
        method: "POST", headers, body: JSON.stringify(payload), signal, redirect: "error",
      });
    } catch (error) {
      if (request.signal.aborted) throw error;
      return errorResponse(timeout.aborted || error?.name === "TimeoutError" ? 504 : 502,
        timeout.aborted || error?.name === "TimeoutError" ? "Google Decisions request timed out" : "Could not reach Google Decisions");
    }
    const keptHeaders = responseHeaders(upstream);
    if (!upstream.ok) return new Response(upstream.body, { status: upstream.status, headers: keptHeaders });
    try {
      return Response.json(fromGoogleResponse(await upstream.json(), source), { status: 200, headers: keptHeaders });
    } catch (error) {
      if (request.signal.aborted) throw error;
      return errorResponse(502, "Google Decisions returned an invalid or incomplete answer", keptHeaders);
    }
  };
}
