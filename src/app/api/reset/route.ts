import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export function POST() {
  getStore().reset();
  return NextResponse.json({ ok: true, state: getStore().snapshot() });
}
