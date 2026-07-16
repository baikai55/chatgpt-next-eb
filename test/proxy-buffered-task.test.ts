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
    const requestPayload = JSON.stringify({
      model: "image-model",
      prompt: "test",
    });
    const pendingTasks: Promise<unknown>[] = [];
    (globalThis as any)[requestContextSymbol] = {
      get: () => ({
        waitUntil: (promise: Promise<unknown>) => pendingTasks.push(promise),
      }),
    };
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: "result" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    global.fetch = fetchMock;

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
        body: requestPayload,
      },
    );

    const response = await handle(request, {
      params: { path: ["v1", "images", "generations"] },
    });

    expect(response.status).toBe(202);
    expect(response.headers.get("x-proxy-task-enabled")).toBe("true");
    expect(pendingTasks).toHaveLength(1);
    expect(await getProxyTask(taskId)).toMatchObject({ status: "pending" });
    const [, upstreamOptions] = fetchMock.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit,
    ];
    expect(upstreamOptions.body).toBeInstanceOf(ArrayBuffer);
    expect(
      new TextDecoder().decode(upstreamOptions.body as ArrayBuffer),
    ).toBe(requestPayload);
    expect((upstreamOptions as RequestInit & { duplex?: string }).duplex).toBe(
      undefined,
    );

    await Promise.all(pendingTasks);

    expect(await getProxyTask(taskId)).toMatchObject({
      status: "complete",
      contentType: "application/json",
      body: JSON.stringify({ data: [{ b64_json: "result" }] }),
    });
  });

  it("does not expose an upstream HTML rejection page", async () => {
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

  it("includes the upstream JSON error reason in the task error", async () => {
    const taskId = `edge-image-policy-error-${Date.now()}`;
    const pendingTasks: Promise<unknown>[] = [];
    const upstreamMessage =
      "非常抱歉，该提示可能违反了关于裸露、色情或情色内容的防护限制。";
    (globalThis as any)[requestContextSymbol] = {
      get: () => ({
        waitUntil: (promise: Promise<unknown>) => pendingTasks.push(promise),
      }),
    };
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: upstreamMessage }), {
        status: 400,
        statusText: "Bad Request",
        headers: { "content-type": "application/json" },
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
      error: `Upstream request failed: 400 Bad Request - ${upstreamMessage}`,
    });
  });
});
