import { getLivePipelineData } from "@/lib/data/live";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const data = await getLivePipelineData(url.searchParams.get("intent"));
    return Response.json(data, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live pipeline data is unavailable";
    const status = message === "not signed in" ? 401 : 500;
    return Response.json(
      { error: status === 401 ? "Not signed in" : "Live pipeline data is unavailable" },
      {
        status,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
        },
      },
    );
  }
}
