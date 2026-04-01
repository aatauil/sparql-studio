import { describe, expect, it } from "vitest";
import { isUri, toCsv } from "./query-utils";

describe("query-utils", () => {
  it("detects uri bindings", () => {
    expect(isUri({ type: "uri", value: "http://example.com" })).toBe(true);
    expect(isUri({ type: "literal", value: "https://example.com" })).toBe(true);
    expect(isUri({ type: "literal", value: "name" })).toBe(false);
  });

  it("exports csv with escaped values", () => {
    const csv = toCsv({
      head: { vars: ["name", "comment"] },
      results: {
        bindings: [
          {
            name: { type: "literal", value: "Alice" },
            comment: { type: "literal", value: "hello \"world\"" }
          }
        ]
      }
    });
    expect(csv).toContain("name,comment");
    expect(csv).toContain("\"hello \"\"world\"\"\"");
  });
});
