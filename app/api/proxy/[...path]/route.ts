import { NextRequest } from "next/server";
import { handle as proxyHandler } from "@/app/api/proxy";

function handle(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxyHandler(req, { params });
}

export const GET = handle;
export const POST = handle;

// Buffered image tasks return 202 immediately and continue through waitUntil,
// preserving the Edge egress path while avoiding the 25-second TTFB limit.
export const runtime = "edge";
