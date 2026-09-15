import { loadNhlData } from "@/lib/nhl";

export const revalidate = 21600;

export async function GET() {
  try {
    const data = await loadNhlData();
    if (data.players.length === 0) {
      return Response.json(
        { error: "NHL API returned no players" },
        { status: 502 },
      );
    }
    return Response.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "NHL fetch failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
