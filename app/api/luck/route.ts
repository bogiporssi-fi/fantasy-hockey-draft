import { loadLuckPayload } from "@/lib/moneypuck";

/** Completed 2024–25 MoneyPuck snapshot — weekly ISR (must be a numeric literal). */
export const revalidate = 604800;
export const maxDuration = 60;

export async function GET() {
  try {
    const data = await loadLuckPayload();
    const count = Object.keys(data.players).length;
    if (count === 0) {
      return Response.json({ error: "MoneyPuck returned no luck stats" }, { status: 502 });
    }
    return Response.json(data, {
      headers: {
        "Cache-Control": "s-maxage=604800, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "MoneyPuck fetch failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
