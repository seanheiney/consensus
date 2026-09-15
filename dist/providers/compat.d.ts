import type { Panelist } from "../types.js";
import type { ProviderFactoryOptions } from "./types.js";
export interface CompatOptions extends ProviderFactoryOptions {
    provider: string;
    baseURL: string;
    /** Send `reasoning_effort` (xAI, OpenRouter reasoning models). */
    reasoning?: boolean;
}
/**
 * Any OpenAI-compatible chat-completions endpoint: xAI (Grok), OpenRouter,
 * Ollama, vLLM, LM Studio, etc.
 */
export declare function createCompatPanelist(opts: CompatOptions): Panelist;
