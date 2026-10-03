import { LiveClient } from "./live-client";
import { getLivePipelineData } from "@/lib/data/live";

export const dynamic = "force-dynamic";

function validIntentParam(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export default async function LivePage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string | string[] }>;
}) {
  const pinnedIntentId = validIntentParam((await searchParams).intent);
  const data = await getLivePipelineData(pinnedIntentId);

  return (
    <LiveClient
      key={data.selectedIntentId ?? "no-intent"}
      initial={data}
      pinnedIntentId={pinnedIntentId}
    />
  );
}
