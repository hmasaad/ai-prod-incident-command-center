import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  const stack = getStore().snapshot().stack;
  if (!stack) return NextResponse.json({ error: "stack not ready" }, { status: 503 });
  return NextResponse.json(stack);
}
