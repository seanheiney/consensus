import { type Panelist } from "../types.js";
import type { ProviderFactoryOptions } from "./types.js";
export interface CompatOptions extends ProviderFactoryOptions {
    provider: string;
    baseURL: string;
    /** Send `reasoning_effort` (xAI, OpenRouter reasoning models). */
    reasoning?: boolean;
    /** SDK retries on 429/5xx, honouring Retry-After (default 2). Groq's per-minute token limits need more. */
    maxRetries?: number;
}
/**
 * Any OpenAI-compatible chat-completions endpoint: xAI (Grok), OpenRouter,
 * Ollama, vLLM, LM Studio, etc.
 */
export declare function createCompatPanelist(opts: CompatOptions): Panelist;
