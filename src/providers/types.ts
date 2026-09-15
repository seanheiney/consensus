import type { Effort, Panelist } from "../types.js";

export interface ProviderFactoryOptions {
  model: string;
  apiKey?: string;
  baseURL?: string;
  effort?: Effort;
}

export type ProviderFactory = (opts: ProviderFactoryOptions) => Panelist;

/** Combine system + messages into one prompt for providers with no system role. */
export function flattenMessages(system: string, messages: { role: string; content: string }[]): string {
  return [system, ...messages.map((m) => `${m.role.toUpperCase()}:\n${m.content}`)].join("\n\n");
}
