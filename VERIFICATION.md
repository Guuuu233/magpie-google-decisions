# Verification record

Date: 2026-11-13.

- **Offline:** Node.js 24.18.0, 11/11 tests passed; Bun 1.4.2, 11/11 tests passed; syntax checks and package dry-run succeeded.
- **Magpie sandbox:** installed plugin from the local directory using Magpie 0.1.4052. Plugin registry identified `google-decisions`, marked `decide: true`, and exposed `gemini-decision-1` as a decision-only model. A synthetic credential was used only for sandbox sign-in.
- **Security:** checked source tree for recognizable hard-coded credential patterns; no real API key is stored in the project.
- **Live, authenticated Magpie gateway:** on Magpie 0.1.4052, provider `google-decisions` reported `signedIn: true`. Two real requests through `http://127.0.0.1:3425/v1/systemone` returned HTTP 200. First returned a `noul` value of 0.99 and 100 input tokens. The second returned all three typed answers in one call: `noul: 0.99`, choice `billing` (probability ≈ 0.98994), and score ≈ 1.33675 / 2 with a complete probability distribution; input usage was 204 tokens.
- **Live gateway guardrails:** an unsupported `text` decision type returned HTTP 400; existing `/v1/models` returned HTTP 200; `magpie healthcheck` exited with status 0.
- **Error-path limits:** 401/429/503 pass-through, network failure, malformed responses, timeouts and cancellation passed in offline synthetic tests. They were **not** deliberately induced in the user's production Google account, avoiding unnecessary failures/quota usage.

Publication gate: **cleared for v0.1.0**: live noul, choice, and score responses have been verified through Magpie; error handling is covered with controlled fixtures. Recheck from a fresh GitHub install before declaring the GitHub distribution verified.
