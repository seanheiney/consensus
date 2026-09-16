/** Shared types for the consensus engine. */
/** Thrown by providers for failures worth one retry (rate limit, overload, network, timeout). */
export class TransientError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = "TransientError";
    }
}
