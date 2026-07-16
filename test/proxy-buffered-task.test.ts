/** @jest-environment node */

import { NextRequest } from "next/server";
import { jest } from "@jest/globals";
import { handle } from "../app/api/proxy";
import { getProxyTask } from "../app/api/proxy-task-store";

describe("buffered proxy tasks", () => {
  const requestContextSymbol = Symbol.for("@vercel/request-context");
  const originalFetch = global.fetch;
  const originalRequestContext = (globalThis as any)[requestContextSymbol];

  afterEach(() => {
    global.fetch = originalFetch;
    (globalThis as any)[requestContextSymbol] = originalRequestContext;
  });

  it("returns immediately and completes the image task in waitUntil", async () => {
    const taskId = `edge-image-${Date.now()}`;
    const pendingTasks: Promise<unknown>[] = [];
    (globalThis as any)[requestContextSymbol] = {
      get: () => ({
        waitUntil: (promise: Promise<unknown>) => pendingTasks.push(promise),
      }),
    };
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: "result" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const request = new NextRequest(
      "http://localhost/api/proxy/v1/images/generations",
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
          "x-base-url": "https://api.example.com",
          "x-proxy-task-id": taskId,
          "x-proxy-task-mode": "buffered",
        },
        body: JSON.stringify({ model: "image-model", prompt: "test" }),
      },
    );

    const response = await handle(request, {
      params: { path: ["v1", "images", "generations"] },
    });

    expect(response.status).toBe(202);
    expect(response.headers.get("x-proxy-task-enabled")).toBe("true");
    expect(pendingTasks).toHaveLength(1);
    expect(await getProxyTask(taskId)).toMatchObject({ status: "pending" });

    await Promise.all(pendingTasks);

    expect(await getProxyTask(taskId)).toMatchObject({
      status: "complete",
      contentType: "application/json",
      body: JSON.stringify({ data: [{ b64_json: "result" }] }),
    });
  });

  it("stores an upstream rejection as a task error", async () => {
    const taskId = `edge-image-error-${Date.now()}`;
    const pendingTasks: Promise<unknown>[] = [];
    (globalThis as any)[requestContextSymbol] = {
      get: () => ({
        waitUntil: (promise: Promise<unknown>) => pendingTasks.push(promise),
      }),
    };
    global.fetch = jest.fn().mockResolvedValue(
      new Response("<!DOCTYPE html>", {
        status: 403,
        statusText: "Forbidden",
        headers: { "content-type": "text/html" },
      }),
    );

    const request = new NextRequest(
      "http://localhost/api/proxy/v1/images/edits",
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
          "x-base-url": "https://api.example.com",
          "x-proxy-task-id": taskId,
          "x-proxy-task-mode": "buffered",
        },
        body: JSON.stringify({ model: "image-model", prompt: "test" }),
      },
    );

    const response = await handle(request, {
      params: { path: ["v1", "images", "edits"] },
    });

    expect(response.status).toBe(202);
    await Promise.all(pendingTasks);
    expect(await getProxyTask(taskId)).toMatchObject({
      status: "error",
      error: "Upstream request failed: 403 Forbidden",
    });
  });
});
