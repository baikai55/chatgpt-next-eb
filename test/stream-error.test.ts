import {
  createProxyTaskId,
  hasStreamContent,
  shouldRecoverProxyTask,
  waitForProxyTask,
} from "../app/utils/stream";
import { jest } from "@jest/globals";

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
    expect(shouldRecoverProxyTask(202)).toBe(true);
    expect(shouldRecoverProxyTask(524)).toBe(true);
    expect(shouldRecoverProxyTask(504)).toBe(true);
    expect(shouldRecoverProxyTask(400)).toBe(false);
  });

  it("reports the stored upstream error instead of parsing an HTML body", async () => {
    const originalFetch = window.fetch;
    window.fetch = jest.fn().mockResolvedValue(
      {
        ok: false,
        status: 502,
        json: async () => ({
          status: "error",
          error: "Upstream request failed: 403 Forbidden",
        }),
      } as Response,
    );

    try {
      await expect(
        waitForProxyTask("failed-task", "/api/proxy/v1/images/edits", 1000),
      ).rejects.toThrow("Upstream request failed: 403 Forbidden");
    } finally {
      window.fetch = originalFetch;
    }
  });

  it("keeps polling after pending and reports a later task failure", async () => {
    const originalFetch = window.fetch;
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        text: async () => JSON.stringify({ status: "pending" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => ({
          status: "error",
          error: "Upstream request failed: 400 Bad Request",
        }),
      } as Response);
    window.fetch = fetchMock;

    try {
      await expect(
        waitForProxyTask("pending-task", "/api/proxy/v1/images/edits", 3000),
      ).rejects.toThrow("Upstream request failed: 400 Bad Request");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      window.fetch = originalFetch;
    }
  });
});
