import { createDecisionFetch, MODEL } from "./adapter.mjs";

const ID = "google-decisions";
const BASE = "https://generativelanguage.googleapis.com/v1beta";
const decisionModel = {
  id: MODEL,
  name: "Gemini Decision 1",
  decides: true,
  tool_call: false,
  reasoning: false,
  limit: { context: 256000, output: 0 },
  modalities: { input: ["text"], output: [] },
  cost: { input: 0.1, output: 0 },
};

// A Magpie/OpenCode provider plugin: only the selected Magpie account supplies credentials.
export const GoogleDecisionsPlugin = async () => ({
  async config(config) {
    config.provider ??= {};
    config.provider[ID] ??= {
      name: "Google Decisions",
      npm: "@ai-sdk/openai-compatible",
      api: BASE,
      decide: true,
      models: { [MODEL]: decisionModel },
    };
  },
  auth: {
    provider: ID,
    methods: [{ type: "api", label: "Google AI Studio API key", placeholder: "AIza…" }],
    async loader(getAuth) {
      const auth = await getAuth();
      if (auth?.type !== "api" || typeof auth.key !== "string" || !auth.key.trim()) return {};
      return {
        baseURL: BASE,
        apiKey: auth.key,
        fetch: createDecisionFetch({
          getKey: async () => {
            const current = await getAuth();
            return current?.type === "api" ? current.key : undefined;
          },
        }),
      };
    },
  },
  provider: {
    id: ID,
    async models() {
      return { [MODEL]: decisionModel };
    },
  },
});
