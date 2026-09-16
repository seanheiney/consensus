import { GoogleGenAI } from "@google/genai";
import type { CompletionRequest, CompletionResult, Panelist } from "../types.js";
import type { ProviderFactoryOptions } from "./types.js";

/** Google Gemini via the official @google/genai SDK. */
export function createGooglePanelist(opts: ProviderFactoryOptions): Panelist {
  const ai = new GoogleGenAI(opts.apiKey ? { apiKey: opts.apiKey } : {});
  const model = opts.model;

  return {
    id: `google:${model}`,
    provider: "google",
    model,
    effort: opts.effort,
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const res = await ai.models.generateContent({
        model,
        contents: req.messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        config: {
          systemInstruction: req.system,
          maxOutputTokens: req.maxTokens ?? 32000,
          abortSignal: req.signal,
          ...(req.json ? { responseMimeType: "application/json", ...(req.jsonSchema ? { responseJsonSchema: req.jsonSchema } : {}) } : {}),
        },
      });
      const text = res.text ?? "";
      if (!text) {
        const reason = res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason;
        throw new Error(`Gemini returned no text${reason ? ` (${reason})` : ""}`);
      }
      const u = res.usageMetadata;
      return {
        text,
        usage: u
          ? { inputTokens: u.promptTokenCount ?? 0, outputTokens: u.candidatesTokenCount ?? 0 }
          : undefined,
      };
    },
  };
}
