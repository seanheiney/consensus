import type { ConsensusEvent, Critique, Revision } from "./types.js";
export declare function formatCritique(label: string, panelist: string, c: Critique): string;
export declare function formatRevision(label: string, panelist: string, r: Revision): string;
/** Markdown fragment for one event, or undefined if the event has no log body. */
export declare function eventToMarkdown(e: ConsensusEvent): string | undefined;
/** One-line terminal summaries for --verbose. */
export declare function eventToTerminal(e: ConsensusEvent): string[];
/** Streams events to `<dir>/debate.md` as they happen. Returns the file path and a listener. */
export declare function openDebateLog(dir: string): Promise<{
    path: string;
    onEvent: (e: ConsensusEvent) => void;
    close: () => Promise<void>;
}>;
