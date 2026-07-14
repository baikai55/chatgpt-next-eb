import {
  createProxyTaskId,
  hasStreamContent,
} from "../app/utils/stream";

describe("stream error handling", () => {
  it("keeps a response when rendered content arrived before disconnect", () => {
    expect(hasStreamContent("completed", "")).toBe(true);
  });

  it("keeps a response when buffered content arrived before disconnect", () => {
    expect(hasStreamContent("", "completed")).toBe(true);
  });

  it("still reports failures that contain no response content", () => {
    expect(hasStreamContent("", "")).toBe(false);
  });

  it("creates a unique task id for recoverable proxy requests", () => {
    expect(createProxyTaskId()).not.toBe(createProxyTaskId());
  });
});
