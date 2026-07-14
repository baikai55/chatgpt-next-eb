import {
  createProxyTaskId,
  hasStreamContent,
  shouldRecoverProxyTask,
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

  it("recovers gateway timeout responses for long-running proxy tasks", () => {
    expect(shouldRecoverProxyTask(524)).toBe(true);
    expect(shouldRecoverProxyTask(504)).toBe(true);
    expect(shouldRecoverProxyTask(400)).toBe(false);
  });
});
