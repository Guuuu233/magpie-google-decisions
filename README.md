# Google Decisions for Magpie

An independent provider plugin that exposes Google **Gemini Decision 1** through Magpie's existing **System One** endpoint. No Magpie core patch or custom proxy is needed. The upstream endpoint is Google's official `POST /v1beta/decisions`, **not** `generateContent`.

Provider: `google-decisions` · Model: `google-decisions/gemini-decision-1`.

## Install

In Magpie, add the plugin from `github:Guuuu233/magpie-google-decisions` or install the local checkout:

```sh
magpie plugin add github:Guuuu233/magpie-google-decisions
magpie plugin login google-decisions
```

Use the **Google AI Studio API key** for the project's quota; it is stored as a Magpie plugin account. A key saved under the built-in Google provider is **not automatically shared** with third-party plugins. Do not copy it into environment variables, source code or command history. The plugin never sends the client gateway token upstream.

To call it, send to the normal Magpie gateway `POST http://127.0.0.1:3425/v1/systemone` with your Magpie gateway authorization:

```json
{
  "model": "google-decisions/gemini-decision-1",
  "state": "I was charged twice. Please refund one payment.",
  "questions": {
    "refund": {"type": "noul", "instructions": "Is the customer asking for a refund?"},
    "team": {"type": "choice", "instructions": "Where should this go?", "criteria": {"billing": "Refunds and payments", "support": "Technical assistance"}},
    "urgency": {"type": "score", "instructions": "How urgent?", "criteria": ["Not urgent", "Normal", "High"]}
  }
}
```

The reply contains the corresponding typed `answers` with probabilities and confidence, plus upstream usage. Magpie can use this provider as a routing group's classifier. To assign it to a chat group, use `classifier=google-decisions/gemini-decision-1` with `effort=auto`; do not add this decision-only model to a chat model list.

## Supported inputs

- System One text and JSON `state` (objects are encoded as JSON text).
- 1–1,000 independent `noul`, `choice` and `score` questions per request.
- Choice criteria maps or simple `choices` arrays (2–255 options); ordered score criteria (2–255 levels).
- Optional `noul` criteria in System One's `true`/`false` form or Google's `true_description`/`false_description` form.
- HTTP 401/403/429/5xx pass through, including `Retry-After`; upstream failure, malformed answers and timeouts remain errors.

**Not supported in this initial release:** images/audio/video/PDF input, OpenAI's `/v1/decisions` protocol or ordinary chat; this plugin only implements Magpie `/v1/systemone`. Google advertises multimodal support upstream, but this adapter deliberately limits its `state` conversion to text and JSON rather than promising unverified behavior.

## Development

```sh
node --test test/*.test.mjs
```

Offline tests use synthetic keys and injected fetch implementations. On November 13, 2026, the live Magpie 0.1.4052 gateway successfully forwarded authenticated `noul`, `choice`, and `score` requests to Google and returned valid probability distributions. Live 401/429 failures were not deliberately induced; those paths are covered by controlled fixture tests. See [VERIFICATION.md](VERIFICATION.md).

References: [Google Decisions API specification](https://aistudio.google.com/docs/decisions-api), [Magpie plugin authoring](https://usemagpie.ai/docs/plugins), [Magpie community OpenAI Decisions plugin](https://github.com/magpie-community/plugins/tree/main/packages/openai-decisions). Independent MIT-licensed project; not affiliated with Google or Magpie.
