/** Combine system + messages into one prompt for providers with no system role. */
export function flattenMessages(system, messages) {
    return [system, ...messages.map((m) => `${m.role.toUpperCase()}:\n${m.content}`)].join("\n\n");
}
