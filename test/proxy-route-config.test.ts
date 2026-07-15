/** @jest-environment node */

import {
  maxDuration,
  runtime,
} from "../app/api/proxy/[...path]/route";
import vercelConfig from "../vercel.json";

describe("custom proxy route configuration", () => {
  it("uses the long-running Node.js runtime for image generation", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(300);
  });

  it("runs Node.js functions near the upstream image provider", () => {
    expect(vercelConfig.regions).toEqual(["sin1"]);
  });
});
