import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getStore().payload());
}
