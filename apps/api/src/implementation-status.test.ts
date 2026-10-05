import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("remaining-work requirement traceability", () => {
  it("covers every current requirement exactly once, without inventing IDs", () => {
    const requirements = readFileSync(new URL("../../../docs/REQUIREMENTS.md", import.meta.url), "utf8");
    const status = readFileSync(new URL("../../../docs/IMPLEMENTATION_STATUS.md", import.meta.url), "utf8");
    const ids = [...requirements.matchAll(/^### ([A-Z]+-\d{3})$/gm)].map((match) => match[1]!);
    const rows = [...status.matchAll(/^\| ([A-Z]+-\d{3}) \|/gm)].map((match) => match[1]!);
    expect(ids.length).toBeGreaterThan(0);
    expect(rows.length).toBe(ids.length);
    expect(new Set(rows).size).toBe(rows.length);
    expect([...rows].sort()).toEqual([...ids].sort());
  });
});
