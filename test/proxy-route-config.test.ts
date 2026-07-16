/** @jest-environment node */

import { runtime } from "../app/api/proxy/[...path]/route";

describe("custom proxy route configuration", () => {
  it("uses Edge egress for upstream image compatibility", () => {
    expect(runtime).toBe("edge");
  });
});
