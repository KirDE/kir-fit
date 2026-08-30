import { describe, expect, it } from "vitest";
import { paddedDomain } from "./chart";

describe("paddedDomain", () => {
  it("keeps a body-weight chart close to its recorded values", () => {
    expect(paddedDomain([79.8, 80.2, 80])).toEqual([79.3, 80.7]);
  });

  it("adds visible space around a single value", () => {
    expect(paddedDomain([80])).toEqual([79.5, 80.5]);
  });

  it("ignores invalid values and handles empty data", () => {
    expect(paddedDomain([Number.NaN, 75])).toEqual([74.5, 75.5]);
    expect(paddedDomain([])).toBeUndefined();
  });
});
