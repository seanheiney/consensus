import { describe, expect, it } from "vitest";
import { extractJson } from "../src/protocol/json.js";

describe("extractJson", () => {
  it("parses bare JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it("parses fenced JSON", () => {
    expect(extractJson('Sure:\n```json\n{"a": [1,2]}\n```\nDone')).toEqual({ a: [1, 2] });
  });
  it("parses JSON surrounded by prose", () => {
    expect(extractJson('Here you go {"answer":"x}"} thanks')).toEqual({ answer: "x}" });
  });
  it("throws when nothing parses", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});
