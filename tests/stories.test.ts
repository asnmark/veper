import { describe, expect, it } from "vitest";
import { findStoryMatch, headlineSimilarity } from "../src/server/stories.js";

describe("conservative story matching", () => {
  it("matches closely reported headlines despite Slovenian inflection and diacritics", () => {
    const score = headlineSimilarity(
      "Občina Vrhnika bo do petka zaprla stari most",
      "Obcina Vrhnika do petka zapira stari most",
    );

    expect(score).toBeGreaterThanOrEqual(0.55);
  });

  it("does not merge unrelated stories that share only generic words", () => {
    const match = findStoryMatch("Vlada danes sprejela nov zakon", [
      { id: "earlier", title: "Sodišče danes zavrnilo nov predlog" },
    ]);

    expect(match).toBeNull();
  });

  it("selects the strongest matching story deterministically", () => {
    const match = findStoryMatch("Vrhnika bo do petka zaprla stari most", [
      { id: "other", title: "Ljubljana jutri odpira nov most" },
      { id: "vrhnika", title: "Občina Vrhnika zapira stari most do petka" },
    ]);

    expect(match?.id).toBe("vrhnika");
    expect(match?.score).toBeGreaterThanOrEqual(0.55);
  });
});
