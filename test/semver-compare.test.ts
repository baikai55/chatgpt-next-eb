import { semverCompare } from "../app/utils";

describe("semverCompare", () => {
  test("should not throw when either version is missing", () => {
    expect(semverCompare(undefined, "v1.0.0")).toBe(0);
    expect(semverCompare("v1.0.0", undefined)).toBe(0);
    expect(semverCompare("", "v1.0.0")).toBe(0);
    expect(semverCompare("v1.0.0", "")).toBe(0);
  });

  test("should compare normal versions", () => {
    expect(semverCompare("v1.0.0", "v1.0.1")).toBeLessThan(0);
    expect(semverCompare("v1.0.1", "v1.0.0")).toBeGreaterThan(0);
    expect(semverCompare("v1.0.0", "v1.0.0")).toBe(0);
  });
});
