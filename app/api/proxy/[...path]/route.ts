import { NextRequest } from "next/server";
import { handle as proxyHandler } from "@/app/api/proxy";

function handle(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxyHandler(req, { params });
}

export const GET = handle;
export const POST = handle;

// Image generation commonly takes longer than the Edge runtime's 25-second
// time-to-first-byte limit. Keep only the custom proxy on the Node.js runtime
// so the other provider routes can continue using Edge.
export const runtime = "nodejs";
export const maxDuration = 300;
