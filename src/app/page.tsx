import { HomeClient } from "@/components/home-client";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return <HomeClient initial={getStore().payload()} />;
}
