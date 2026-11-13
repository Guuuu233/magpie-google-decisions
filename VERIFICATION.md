# Verification record

Date: 2026-11-13.

- **Offline:** Node.js 24.18.0, 11/11 tests passed; Bun 1.4.2, 11/11 tests passed; syntax checks and package dry-run succeeded.
- **Magpie sandbox:** installed plugin from the local directory using Magpie 0.1.4052. Plugin registry identified `google-decisions`, marked `decide: true`, and exposed `gemini-decision-1` as a decision-only model. A synthetic credential was used only for sandbox sign-in.
- **Security:** checked source tree for recognizable hard-coded credential patterns; no real API key is stored in the project.
- **Not yet verified:** A successful authenticated request through the live Magpie gateway to Google's Decisions endpoint. The existing built-in Google provider's key is not automatically available to this independent plugin; this needs explicit sign-in under `google-decisions`.

Publication gate: **not cleared** until a live authenticated request returns valid typed answers for noul, choice, and score via the Magpie gateway (and invalid-key and rate-limit handling have been verified or demonstrated with controlled fixtures).
