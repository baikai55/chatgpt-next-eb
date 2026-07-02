import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";

const IMAGE_PROXY_HEADER_TIMEOUT_MS = 55_000;
const IMAGE_PROXY_BROWSER_CACHE_SECONDS = 86_400;
const IMAGE_PROXY_STALE_WHILE_REVALIDATE_SECONDS = 604_800;
const IMAGE_PROXY_MEMORY_CACHE_TTL_MS = 10 * 60 * 1_000;
const IMAGE_PROXY_MAX_CACHE_ENTRY_BYTES = 10 * 1024 * 1024;
const IMAGE_PROXY_MAX_CACHE_BYTES = 64 * 1024 * 1024;
const IMAGE_PROXY_MAX_CACHE_ENTRIES = 64;

const IMAGE_PROXY_HEADERS = {
  Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

function jsonError(
  error: string,
  status: number,
  details?: Record<string, unknown>,
) {
  return NextResponse.json(
    { error, ...details },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}

type CachedImage = {
  body: Uint8Array;
  contentType: string;
  contentLength: number;
  etag: string;
  lastModified?: string;
  expiresAt: number;
};

type ImageProxyCacheStore = {
  entries: Map<string, CachedImage>;
  totalBytes: number;
};

function getCacheStore() {
  const globalStore = globalThis as typeof globalThis & {
    __imageProxyCacheStore?: ImageProxyCacheStore;
  };

  if (!globalStore.__imageProxyCacheStore) {
    globalStore.__imageProxyCacheStore = {
      entries: new Map(),
      totalBytes: 0,
    };
  }

  return globalStore.__imageProxyCacheStore;
}

function removeCacheEntry(url: string) {
  const store = getCacheStore();
  const cached = store.entries.get(url);

  if (!cached) return;

  store.totalBytes -= cached.contentLength;
  store.entries.delete(url);
}

function getCachedImage(url: string) {
  const store = getCacheStore();
  const cached = store.entries.get(url);

  if (!cached) return null;

  if (cached.expiresAt <= Date.now()) {
    removeCacheEntry(url);
    return null;
  }

  // Refresh LRU order.
  store.entries.delete(url);
  store.entries.set(url, cached);
  return cached;
}

function setCachedImage(url: string, cached: CachedImage) {
  if (cached.contentLength > IMAGE_PROXY_MAX_CACHE_ENTRY_BYTES) {
    removeCacheEntry(url);
    return;
  }

  const store = getCacheStore();
  removeCacheEntry(url);
  store.entries.set(url, cached);
  store.totalBytes += cached.contentLength;

  while (
    store.entries.size > IMAGE_PROXY_MAX_CACHE_ENTRIES ||
    store.totalBytes > IMAGE_PROXY_MAX_CACHE_BYTES
  ) {
    const oldestKey = store.entries.keys().next().value;
    if (!oldestKey) break;
    removeCacheEntry(oldestKey);
  }
}

function makeEtag(body: Uint8Array) {
  return `"${createHash("sha1").update(body).digest("base64url")}"`;
}

function createImageHeaders(
  cached: Pick<CachedImage, "contentType" | "etag"> & {
    contentLength?: number;
    lastModified?: string;
  },
) {
  const headers = new Headers({
    "Content-Type": cached.contentType,
    "Cache-Control": `public, max-age=${IMAGE_PROXY_BROWSER_CACHE_SECONDS}, s-maxage=${IMAGE_PROXY_BROWSER_CACHE_SECONDS}, stale-while-revalidate=${IMAGE_PROXY_STALE_WHILE_REVALIDATE_SECONDS}, immutable`,
    ETag: cached.etag,
    "Access-Control-Allow-Origin": "*",
  });

  if (typeof cached.contentLength === "number") {
    headers.set("Content-Length", String(cached.contentLength));
  }

  if (cached.lastModified) {
    headers.set("Last-Modified", cached.lastModified);
  }

  return headers;
}

function isNotModified(req: NextRequest, cached: CachedImage) {
  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch) {
    return ifNoneMatch
      .split(",")
      .map((item) => item.trim())
      .includes(cached.etag);
  }

  const ifModifiedSince = req.headers.get("if-modified-since");
  if (ifModifiedSince && cached.lastModified) {
    const since = Date.parse(ifModifiedSince);
    const lastModified = Date.parse(cached.lastModified);
    return (
      !Number.isNaN(since) &&
      !Number.isNaN(lastModified) &&
      since >= lastModified
    );
  }

  return false;
}

function isBlockedHostname(hostname: string) {
  const host = hostname.toLowerCase();
  const firstTwoOctets = host.match(/^172\.(\d+)\./);
  const secondOctet = firstTwoOctets ? Number(firstTwoOctets[1]) : -1;

  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80") ||
    host === "0.0.0.0" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.startsWith("169.254.") ||
    (secondOctet >= 16 && secondOctet <= 31)
  );
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  if (!url) {
    return jsonError("Missing url", 400);
  }

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return jsonError("Invalid url", 400);
  }

  if (!["http:", "https:"].includes(target.protocol)) {
    return jsonError("Unsupported protocol", 400);
  }

  if (
    isBlockedHostname(target.hostname) &&
    !target.pathname.startsWith("/api/")
  ) {
    return jsonError("Blocked host", 400);
  }

  try {
    const targetUrl = target.toString();
    const cachedImage = getCachedImage(targetUrl);

    if (cachedImage) {
      if (isNotModified(req, cachedImage)) {
        return new Response(null, {
          status: 304,
          headers: createImageHeaders(cachedImage),
        });
      }

      return new Response(cachedImage.body.slice(), {
        status: 200,
        headers: createImageHeaders(cachedImage),
      });
    }

    // Timeout only while waiting for headers; slow image bodies should stream.
    const controller = new AbortController();
    const headerTimeout = setTimeout(() => {
      controller.abort();
    }, IMAGE_PROXY_HEADER_TIMEOUT_MS);

    const upstream = await fetch(targetUrl, {
      headers: {
        ...IMAGE_PROXY_HEADERS,
        Referer: `${target.origin}/`,
      },
      redirect: "follow",
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(headerTimeout);
    });

    if (!upstream.ok || !upstream.body) {
      return jsonError("Image fetch failed", upstream.status || 502, {
        upstreamStatus: upstream.status,
        upstreamStatusText: upstream.statusText,
      });
    }

    const contentType =
      upstream.headers.get("content-type") || "application/octet-stream";

    if (
      !contentType.startsWith("image/") &&
      !contentType.startsWith("application/octet-stream")
    ) {
      return jsonError("Remote content is not an image", 415, {
        contentType,
      });
    }

    // Buffer once so repeated preview opens can hit in-process cache
    // instead of re-fetching the origin image.
    const body = new Uint8Array(await upstream.arrayBuffer());
    const cached: CachedImage = {
      body,
      contentType,
      contentLength: body.byteLength,
      etag: upstream.headers.get("etag") || makeEtag(body),
      lastModified: upstream.headers.get("last-modified") || undefined,
      expiresAt: Date.now() + IMAGE_PROXY_MEMORY_CACHE_TTL_MS,
    };

    setCachedImage(targetUrl, cached);

    return new Response(body.slice(), {
      status: 200,
      headers: createImageHeaders(cached),
    });
  } catch (error) {
    console.error("[Image Proxy]", error);
    if (error instanceof DOMException && error.name === "AbortError") {
      return jsonError("Image fetch timed out", 504, {
        timeoutMs: IMAGE_PROXY_HEADER_TIMEOUT_MS,
      });
    }

    return jsonError("Image proxy failed", 502);
  }
}

export const runtime = "nodejs";
export const maxDuration = 60;
