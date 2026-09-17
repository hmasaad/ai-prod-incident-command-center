import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  const store = getStore();
  const encoder = new TextEncoder();

  let unsub: (() => boolean) | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  let open = true;

  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        if (!open) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(store.payload())}\n\n`));
      };
      send();
      unsub = store.subscribe(send);
      ping = setInterval(() => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          open = false;
        }
      }, 15000);
    },
    cancel() {
      open = false;
      if (ping) clearInterval(ping);
      unsub?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text-event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
