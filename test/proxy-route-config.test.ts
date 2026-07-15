/** @jest-environment node */

import {
  maxDuration,
  runtime,
} from "../app/api/proxy/[...path]/route";

describe("custom proxy route configuration", () => {
  it("uses the long-running Node.js runtime for image generation", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(300);
  });
});
