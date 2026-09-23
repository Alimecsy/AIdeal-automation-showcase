import { env } from "@aideal/env";

export type AiProvider = "gemini" | "openrouter";

export type AiCompletion = {
  provider: AiProvider;
  model: string;
  text: string;
};

function requireApiKey(provider: AiProvider) {
  const key = provider === "gemini" ? env.GEMINI_API_KEY : env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(`${provider} API key is not configured`);
  }
  return key;
}

async function readJson(response: Response) {
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof body.error === "string" ? body.error : `AI request failed with ${response.status}`;
    throw new Error(message);
  }
  return body;
}

async function generateGemini(prompt: string, model: string): Promise<string> {
  const key = requireApiKey("gemini");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    },
  );
  const body = await readJson(response);
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  const first = candidates[0];
  const content = first && typeof first === "object" ? (first as Record<string, unknown>).content : null;
  const parts = content && typeof content === "object" ? (content as Record<string, unknown>).parts : null;
  const text = Array.isArray(parts)
    ? parts.map((part) => (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string" ? (part as Record<string, unknown>).text : "")).join("\n").trim()
    : "";
  if (!text) {
    throw new Error("Gemini returned no text");
  }
  return text;
}

async function generateOpenRouter(prompt: string, model: string): Promise<string> {
  const key = requireApiKey("openrouter");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const body = await readJson(response);
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const first = choices[0];
  const message = first && typeof first === "object" ? (first as Record<string, unknown>).message : null;
  const content = message && typeof message === "object"
    ? (message as Record<string, unknown>).content
    : null;
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) {
    throw new Error("OpenRouter returned no text");
  }
  return text;
}

export async function generateText(input: {
  prompt: string;
  provider?: string;
  model?: string;
}): Promise<AiCompletion> {
  const provider = (input.provider ?? env.AI_DEFAULT_PROVIDER) as AiProvider;
  if (provider !== "gemini" && provider !== "openrouter") {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }

  const model = input.model ?? (provider === "gemini" ? env.GEMINI_DEFAULT_MODEL : env.OPENROUTER_DEFAULT_MODEL);
  const text = provider === "gemini"
    ? await generateGemini(input.prompt, model)
    : await generateOpenRouter(input.prompt, model);

  return { provider, model, text };
}
