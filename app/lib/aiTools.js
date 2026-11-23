/**
 * AI tools a merchant can connect with their own API key. Client-safe
 * metadata only; the API adapters live in app/services/ai/. `domain` is the
 * site whose favicon is the tool's logo in the UI. Order matters:
 * new prompts are written by the first connected tool, so slow Cursor is last.
 */
export const AI_TOOLS = [
  {
    id: "openai",
    name: "ChatGPT",
    company: "OpenAI",
    domain: "chatgpt.com",
    description: "ChatGPT answers with web search.",
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-...",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    company: "Perplexity",
    domain: "perplexity.ai",
    description: "Perplexity answers with its own web search.",
    keyUrl: "https://www.perplexity.ai/account/api/keys",
    keyPlaceholder: "pplx-...",
  },
  {
    id: "gemini",
    name: "Gemini",
    company: "Google",
    domain: "gemini.google.com",
    description: "Gemini answers grounded with Google Search.",
    keyUrl: "https://aistudio.google.com/apikey",
    keyPlaceholder: "AIza...",
  },
  {
    id: "anthropic",
    name: "Claude",
    company: "Anthropic",
    domain: "claude.ai",
    description: "Claude answers with web search.",
    keyUrl: "https://platform.claude.com/settings/keys",
    keyPlaceholder: "sk-ant-...",
  },
  {
    id: "cursor",
    name: "Cursor",
    company: "Cursor",
    domain: "cursor.com",
    description:
      "A Cursor cloud agent answers. Slower than the others. Needs a paid Cursor plan with storage on (not Privacy Mode (Legacy)).",
    keyUrl: "https://cursor.com/dashboard/api",
    keyPlaceholder: "Cursor API key",
    modelDetails:
      "Each answer runs a Cursor cloud agent with this model and can take a few minutes. Links in its answers count as sources.",
  },
];

export const AI_TOOL_IDS = AI_TOOLS.map((tool) => tool.id);

export function getAiTool(id) {
  return AI_TOOLS.find((tool) => tool.id === id) ?? null;
}
