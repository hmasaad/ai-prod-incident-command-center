import { PostmortemView } from "@/components/postmortem-view";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function PostmortemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pm = getStore().postmortem(id);
  if (!pm) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <p className="kicker">{id} has no postmortem yet.</p>
      </div>
    );
  }
  return <PostmortemView pm={pm} />;
}
