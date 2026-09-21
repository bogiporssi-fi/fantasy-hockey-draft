import { loadYahooPlayers } from "@/lib/yahooPlayers";

/** Cache Yahoo public player+ADP snapshot for about a day. */
export const revalidate = 86400;
export const maxDuration = 60;

export async function GET() {
  try {
    const data = await loadYahooPlayers();
    if (data.players.length === 0) {
      return Response.json(
        { error: "Yahoo-pelaajalista ei latautunut. Yritä hetken päästä uudelleen." },
        { status: 502 },
      );
    }
    return Response.json(data, {
      headers: {
        "Cache-Control": "s-maxage=86400, stale-while-revalidate=3600",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Yahoo fetch failed";
    return Response.json(
      {
        error: "Yahoo-pelaajalista ei latautunut. Yritä hetken päästä uudelleen.",
        detail: message,
      },
      { status: 502 },
    );
  }
}
