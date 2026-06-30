import { NextRequest, NextResponse } from "next/server";

const IMAGE_PROXY_HEADER_TIMEOUT_MS = 25_000;

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

  if (isBlockedHostname(target.hostname)) {
    return jsonError("Blocked host", 400);
  }

  try {
    // Timeout only while waiting for headers; slow image bodies should stream.
    const controller = new AbortController();
    const headerTimeout = setTimeout(() => {
      controller.abort();
    }, IMAGE_PROXY_HEADER_TIMEOUT_MS);

    const upstream = await fetch(target.toString(), {
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

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("[Image Proxy]", error);
    return jsonError("Image proxy failed", 502);
  }
}

export const runtime = "nodejs";
export const maxDuration = 60;
