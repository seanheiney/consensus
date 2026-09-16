import Anthropic from "@anthropic-ai/sdk";
import { type Panelist } from "../types.js";
import type { ProviderFactoryOptions } from "./types.js";
export declare function createAnthropicPanelist(opts: ProviderFactoryOptions & {
    client?: Anthropic;
}): Panelist;
