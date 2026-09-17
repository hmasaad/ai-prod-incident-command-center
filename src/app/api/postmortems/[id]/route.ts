import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const pm = getStore().postmortem(id);
  if (!pm) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(pm);
}
