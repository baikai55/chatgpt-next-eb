import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getServerSideConfig } from "@/app/config/server";
import { cloudflareAIGatewayUrl } from "@/app/utils/cloudflare";
import {
  completeProxyTask,
  createProxyTask,
  failProxyTask,
  getProxyTask,
} from "./proxy-task-store";

const DEFAULT_PROXY_TIMEOUT_MS = 10 * 60 * 1000;
const BUFFERED_PROXY_TASK_TIMEOUT_MS = 290 * 1000;

async function runBufferedProxyTask(
  taskId: string,
  fetchUrl: string,
  fetchOptions: RequestInit,
  timeoutId: ReturnType<typeof setTimeout>,
) {
  try {
    const response = await fetch(fetchUrl, fetchOptions);
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `Upstream request failed: ${response.status} ${response.statusText}`,
      );
    }
    await completeProxyTask(
      taskId,
      body,
      response.headers.get("content-type") ?? "application/json",
    );
  } catch (error) {
    try {
      await failProxyTask(taskId, error);
    } catch (taskError) {
      console.error("[Proxy Task] failed to store task error", taskError);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

function joinBaseUrlPath(baseUrl: string, path: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");
  const pathSegments = normalizedPath.split("/");
  const baseLastSegment = normalizedBaseUrl.split("/").filter(Boolean).pop();

  if (baseLastSegment && pathSegments[0] === baseLastSegment) {
    pathSegments.shift();
  }

  return [normalizedBaseUrl, pathSegments.join("/")].filter(Boolean).join("/");
}

function buildFetchUrl(req: NextRequest, baseUrl: string, subpath: string) {
  const fetchUrl = cloudflareAIGatewayUrl(joinBaseUrlPath(baseUrl, subpath));
  const searchParams = new URLSearchParams(req.nextUrl.searchParams);
  searchParams.delete("path");
  searchParams.delete("provider");

  const query = searchParams.toString();

  if (!query) return fetchUrl;

  return `${fetchUrl}${fetchUrl.includes("?") ? "&" : "?"}${query}`;
}

function shouldSkipHeader(name: string) {
  const lowerName = name.toLowerCase();
  const skipHeaders = new Set([
    "connection",
    "accept-encoding",
    "host",
    "origin",
    "referer",
    "cookie",
    "x-base-url",
    "x-real-ip",
  ]);

  return (
    skipHeaders.has(lowerName) ||
    lowerName.startsWith("sec-") ||
    lowerName.startsWith("x-forwarded-") ||
    lowerName.startsWith("x-vercel-") ||
    lowerName === "x-proxy-task-id" ||
    lowerName === "x-proxy-task-mode"
  );
}

export async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  console.log("[Proxy Route] params ", params);

  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }
  const recoveryTaskId = req.nextUrl.searchParams.get("proxy_task_id");
  if (recoveryTaskId) {
    const task = await getProxyTask(recoveryTaskId);
    if (!task) {
      return NextResponse.json({ status: "missing" }, { status: 404 });
    }
    if (task.status === "pending") {
      return NextResponse.json({ status: "pending" }, { status: 202 });
    }
    if (task.status === "error") {
      return NextResponse.json(
        { status: "error", error: task.error },
        { status: 502 },
      );
    }
    return new Response(task.body, {
      status: 200,
      headers: {
        "content-type": task.contentType || "text/event-stream",
        "cache-control": "no-store",
      },
    });
  }
  const serverConfig = getServerSideConfig();

  const baseUrl = req.headers.get("x-base-url");
  if (!baseUrl) {
    return NextResponse.json(
      { error: "Missing x-base-url header" },
      { status: 400 },
    );
  }
  const subpath = params.path.join("/");
  const fetchUrl = buildFetchUrl(req, baseUrl, subpath);
  const taskId = req.headers.get("x-proxy-task-id");
  const bufferProxyTask =
    taskId && req.headers.get("x-proxy-task-mode") === "buffered";
  let proxyTaskEnabled = false;
  if (taskId) {
    try {
      await createProxyTask(taskId, "");
      proxyTaskEnabled = true;
    } catch (error) {
      console.error("[Proxy Task] failed to initialize", error);
    }
  }
  const headers = new Headers(
    Array.from(req.headers.entries()).filter((item) => {
      return !shouldSkipHeader(item[0]);
    }),
  );
  headers.set("Accept-Encoding", "identity");

  // if dalle3 use openai api key
  if (baseUrl.includes("api.openai.com") && !headers.has("Authorization")) {
    if (!serverConfig.apiKey) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 },
      );
    }
    headers.set("Authorization", `Bearer ${serverConfig.apiKey}`);
  }

  const controller = new AbortController();
  // A background task must not retain the incoming request stream. Vercel closes
  // that stream once the 202 response is sent, so materialize it first.
  const requestBody =
    bufferProxyTask && req.body ? await req.arrayBuffer() : req.body;
  const fetchOptions: RequestInit = {
    headers,
    method: req.method,
    body: requestBody,
    // to fix #2485: https://stackoverflow.com/questions/55920957/cloudflare-worker-typeerror-one-time-use-body
    redirect: "manual",
    signal: controller.signal,
  };
  if (!bufferProxyTask) {
    // @ts-ignore
    fetchOptions.duplex = "half";
  }

  const timeoutId = setTimeout(
    () => {
      controller.abort();
    },
    bufferProxyTask && proxyTaskEnabled
      ? BUFFERED_PROXY_TASK_TIMEOUT_MS
      : DEFAULT_PROXY_TIMEOUT_MS,
  );

  if (bufferProxyTask && taskId && proxyTaskEnabled) {
    waitUntil(runBufferedProxyTask(taskId, fetchUrl, fetchOptions, timeoutId));
    return NextResponse.json(
      { status: "pending" },
      {
        status: 202,
        headers: {
          "cache-control": "no-store",
          "x-proxy-task-enabled": "true",
        },
      },
    );
  }

  try {
    const res = await fetch(fetchUrl, fetchOptions);
    // to prevent browser prompt for credentials
    const newHeaders = new Headers(res.headers);
    newHeaders.delete("www-authenticate");
    // to disable nginx buffering
    newHeaders.set("X-Accel-Buffering", "no");

    // The latest version of the OpenAI API forced the content-encoding to be "br" in json response
    // So if the streaming is disabled, we need to remove the content-encoding header
    // Because Vercel uses gzip to compress the response, if we don't remove the content-encoding header
    // The browser will try to decode the response with brotli and fail
    newHeaders.delete("content-encoding");

    let responseBody = res.body;
    if (taskId && responseBody && proxyTaskEnabled) {
      const contentType = newHeaders.get("content-type") ?? "";
      newHeaders.set("x-proxy-task-enabled", "true");
      try {
        const [clientBody, cacheBody] = responseBody.tee();
        responseBody = clientBody;
        const reader = cacheBody.getReader();
        reader
          .read()
          .then(async function collect(result): Promise<void> {
            const chunks: Uint8Array[] = [];
            let current = result;
            while (!current.done) {
              chunks.push(current.value);
              current = await reader.read();
            }
            const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const body = new Uint8Array(length);
            let offset = 0;
            chunks.forEach((chunk) => {
              body.set(chunk, offset);
              offset += chunk.length;
            });
            await completeProxyTask(
              taskId,
              new TextDecoder().decode(body),
              contentType,
            );
          })
          .catch((error) => void failProxyTask(taskId, error));
      } catch (error) {
        newHeaders.set("x-proxy-task-enabled", "false");
        console.error("[Proxy Task] failed to initialize", error);
      }
    }

    if (taskId && !proxyTaskEnabled) {
      newHeaders.set("x-proxy-task-enabled", "false");
    }

    return new Response(responseBody, {
      status: res.status,
      statusText: res.statusText,
      headers: newHeaders,
    });
  } catch (error) {
    if (taskId && proxyTaskEnabled) await failProxyTask(taskId, error);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
