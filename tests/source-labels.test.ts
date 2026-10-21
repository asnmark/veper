import { describe, expect, it } from "vitest";
import { publicSourceCountLabel, sourceCountLabel, sourceStateLabel } from "../src/client/format.js";

describe("source labels", () => {
  it("uses correct Slovenian dual and plural forms for expanded coverage", () => {
    expect(sourceCountLabel(1)).toBe("1 vir");
    expect(sourceCountLabel(2)).toBe("2 vira");
    expect(sourceCountLabel(3)).toBe("3 viri");
    expect(sourceCountLabel(6)).toBe("6 virov");
    expect(publicSourceCountLabel(3)).toBe("3 javni viri");
    expect(publicSourceCountLabel(6)).toBe("6 javnih virov");
  });

  it("explains a recent source-check failure without marking it online", () => {
    expect(sourceStateLabel("degraded")).toBe("zadnji pregled ni uspel");
  });
});
