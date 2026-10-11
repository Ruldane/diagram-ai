import { describe, expect, it } from "vitest";

import { matchScore, rank } from "./palette-search";

const TITLES = ["Select", "Duplicate", "Select all", "Align left", "Distribute horizontally", "Zoom to selection", "Auto-arrange diagram", "Export…"];
const found = (search: string): string[] => rank(TITLES, search, (title) => title).map(({ item }) => item);

describe("matchScore", () => {
  it("matches everything for an empty search and nothing for punctuation alone", () => {
    expect(matchScore("", "Align left")).toBe(1);
    expect(matchScore("  ", "Align left")).toBe(1);
    expect(matchScore("?!", "Align left")).toBe(0);
  });

  it("requires every typed word to match", () => {
    expect(matchScore("zoom sel", "Zoom to selection")).toBeGreaterThan(0);
    expect(matchScore("zoom left", "Zoom to selection")).toBe(0);
  });

  it("does not match letters scattered across words", () => {
    expect(matchScore("data", "Distribute horizontally")).toBe(0);
    expect(matchScore("data", "Duplicate")).toBe(0);
    expect(matchScore("stock", "Send to back")).toBe(0);
  });

  it("matches inside a word only from three letters on", () => {
    expect(matchScore("al", "Distribute horizontally")).toBe(0);
    expect(matchScore("zont", "Distribute horizontally")).toBeGreaterThan(0);
  });

  it("splits on punctuation and ignores case", () => {
    expect(matchScore("ARRANGE", "Auto-arrange diagram")).toBeGreaterThan(0);
    expect(matchScore("export", "Export…")).toBeGreaterThan(0);
    expect(matchScore("stock", "In stock?")).toBeGreaterThan(0);
  });

  it("counts keywords for less than the text itself", () => {
    const viaKeyword = matchScore("arrange", "Bring to front", ["Arrange"]);
    expect(viaKeyword).toBeGreaterThan(0);
    expect(viaKeyword).toBeLessThan(matchScore("arrange", "Auto-arrange diagram", ["Arrange"]));
    expect(matchScore("arrange", "Bring to front")).toBe(0);
  });
});

describe("rank", () => {
  it("puts whole-word and leading-word matches first", () => {
    expect(found("select")).toEqual(["Select", "Select all", "Zoom to selection"]);
    expect(found("al")).toEqual(["Align left", "Select all"]);
    expect(found("sel")).toEqual(["Select", "Select all", "Zoom to selection"]);
  });

  it("keeps the original order for an empty search", () => {
    expect(found("")).toEqual(TITLES);
  });
});
