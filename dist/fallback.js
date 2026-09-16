/**
 * A panelist that hands off to the next candidate when the current one fails for a
 * non-recoverable reason (usage limit reached, model unavailable, auth). The switch is
 * permanent for the rest of the run, and `id`/`model`/`billing` follow the model that is
 * actually answering so usage and cost are attributed correctly. Aborts are never retried.
 */
export function withFallbacks(candidates, onSwitch) {
    if (candidates.length === 0)
        throw new Error("withFallbacks needs at least one candidate");
    if (candidates.length === 1)
        return candidates[0];
    let i = 0;
    const cur = () => candidates[i];
    const p = {
        get id() { return cur().id; },
        get provider() { return cur().provider; },
        get model() { return cur().model; },
        get effort() { return cur().effort; },
        get persona() { return cur().persona; },
        get billing() { return cur().billing; },
        effortApplied: (e) => cur().effortApplied?.(e) ?? e,
        async complete(req) {
            for (;;) {
                try {
                    return await cur().complete(req);
                }
                catch (err) {
                    if (req.signal?.aborted || i >= candidates.length - 1)
                        throw err;
                    const from = cur();
                    i++;
                    onSwitch?.(from, cur(), err instanceof Error ? err.message.split("\n")[0] : String(err));
                }
            }
        },
    };
    return p;
}
