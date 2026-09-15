/** Tolerant extraction of a single JSON object from model output. */
export function extractJson(text: string): unknown {
  const candidates: string[] = [];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1]);
  candidates.push(text);

  for (const c of candidates) {
    const t = c.trim();
    try {
      return JSON.parse(t);
    } catch {
      /* fall through */
    }
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
  }
  throw new Error("No JSON object found in model output");
}
