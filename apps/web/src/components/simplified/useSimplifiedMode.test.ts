import { describe, expect, it } from "vite-plus/test";
import { parseSimplifiedSearch, resolveSimplifiedMode } from "./useSimplifiedMode";

describe("parseSimplifiedSearch", () => {
  it("parses truthy values", () => {
    expect(parseSimplifiedSearch(true)).toBe(true);
    expect(parseSimplifiedSearch("true")).toBe(true);
    expect(parseSimplifiedSearch("1")).toBe(true);
  });
  it("parses falsy values", () => {
    expect(parseSimplifiedSearch(false)).toBe(false);
    expect(parseSimplifiedSearch("false")).toBe(false);
    expect(parseSimplifiedSearch("0")).toBe(false);
  });
  it("returns undefined for absent/unknown values", () => {
    expect(parseSimplifiedSearch(undefined)).toBeUndefined();
    expect(parseSimplifiedSearch("banana")).toBeUndefined();
  });
});

describe("resolveSimplifiedMode", () => {
  it("prefers the explicit param over the setting", () => {
    expect(resolveSimplifiedMode(true, false)).toBe(true);
    expect(resolveSimplifiedMode(false, true)).toBe(false);
  });
  it("falls back to the setting when param is undefined", () => {
    expect(resolveSimplifiedMode(undefined, true)).toBe(true);
    expect(resolveSimplifiedMode(undefined, false)).toBe(false);
  });
});
