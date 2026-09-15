import type { ConsensusEvent } from "./types.js";
/** Status glyphs with an ASCII fallback (CONSENSUS_ASCII=1, LANG=C, or TERM=dumb). Always pair with words. */
export declare const G: {
    ok: string;
    no: string;
    maybe: string;
    err: string;
    step: string;
};
export declare const dim: (s: string) => string;
export declare const bold: (s: string) => string;
export declare const green: (s: string) => string;
export declare const yellow: (s: string) => string;
export declare const red: (s: string) => string;
export declare const log: (msg: string) => void;
export declare function progressLogger(quiet?: boolean): (e: ConsensusEvent) => void;
