import { NextRequest, NextResponse } from "next/server";

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
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  if (!["http:", "https:"].includes(target.protocol)) {
    return NextResponse.json(
      { error: "Unsupported protocol" },
      { status: 400 },
    );
  }

  if (isBlockedHostname(target.hostname)) {
    return NextResponse.json({ error: "Blocked host" }, { status: 400 });
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        "User-Agent": "NextChat image proxy",
      },
    });

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: "Image fetch failed" },
        { status: upstream.status || 502 },
      );
    }

    const contentType =
      upstream.headers.get("content-type") || "application/octet-stream";

    if (
      !contentType.startsWith("image/") &&
      !contentType.startsWith("application/octet-stream")
    ) {
      return NextResponse.json(
        { error: "Remote content is not an image" },
        { status: 415 },
      );
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
    return NextResponse.json({ error: "Image proxy failed" }, { status: 502 });
  }
}

export const runtime = "edge";
