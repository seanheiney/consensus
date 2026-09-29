export interface RunKeyParts {
    prompt: string;
    context?: string;
    /** Seat ids, in any order. */
    seats: string[];
    rounds: number;
    effort: string;
}
export declare function runKey(p: RunKeyParts): string;
