import { NextResponse } from "next/server";

import { proxySolanaRpc, solanaRpcUrls } from "@/lib/solana/rpcProxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const result = await proxySolanaRpc(body, {
    fetchImpl: fetch,
    upstreams: solanaRpcUrls(process.env),
  });
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
