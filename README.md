# Luistin — Yahoo Fantasy Hockey draft overlap

Personal hobby app for an H2H **category** league with **daily lineups**. During the Yahoo draft, it shows how a candidate’s NHL game nights overlap your current roster so you do not stack too many games on the same nights (active slots full → bench waste) while other nights leave slots empty.

UI is Finnish by default, with FI/EN toggle. Everything is local-first (no login). Roster and named league (“kimppa”) profiles live in `localStorage`.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). First load fetches the current NHL regular-season schedule and club rosters from the public NHL Web API (`api-web.nhle.com`). That can take a few seconds, then it is cached on the server.

```bash
npm test    # overlap scoring + name matching
npm run lint
```

## Draft-night workflow (Yahoo)

1. **Settings** — confirm active slots. Default (editable, saved as named profiles):
   - Active: 2 C, 2 LW, 2 RW, 4 D, 2 G
   - Bench: 4
   - Optional UTIL (default 0)
   - H2H week start: Monday (or Sunday)
2. **Build the roster as you draft** — search NHL names, or paste a list.
3. **Pick candidates** — search adds them to the bottom **Vertailu** tray (several at once, not only A vs B). Each card shows useful nights / bench / complementarity vs the current roster. **Tyhjennä** clears the tray. Tap a card for the heatmap + H2H week table.
4. **Yahoo eligibility** — search opens a **Yahoo-pelipaikat** sheet (C/LW/RW/D/G multi-select). NHL primary is only the default, not locked. Every roster row and compare card also has a **Yahoo-kelpoisuus** box + **Muokkaa**. Overlap scoring uses those buttons (e.g. C/LW).
5. If you draft them, **Lisää kokoonpanoon** copies those Yahoo positions onto the roster.

No Yahoo OAuth, no passwords. Category scoring projections are out of scope — schedule and slot utilization only.

### Paste / CSV (no Yahoo login)

Yahoo does not need to be connected. Copy names from the draft room, a watchlist, or an export and paste:

```
Auston Matthews
Connor McDavid
Cale Makar
```

Also accepted:

- `Matthews, Auston`
- `Auston Matthews (TOR - C)`
- CSV with a header row (`Player`, `Name`, …). Ambiguous last names (several Johnsons) are left unmatched so you can search them.

If you export from Yahoo (league → players / draft results → CSV when available), strip extra columns or paste the player column. Never put account passwords into this app.

## How overlap is scored

Each NHL **game date** (`gameDate` from the API — the hockey night Yahoo uses):

1. Players already on your roster who have a game that night fill active slots **greedily**: fewest eligible positions first, then the tightest remaining slot. UTIL is last.
2. The **candidate is placed after** the current roster. They get a useful night only if an eligible slot (or UTIL) is still open. They never bump someone you already drafted.
3. Regular season only (`gameType` 2). Preseason is ignored.

This matches the “don’t stack the same nights” question. It is not a lineup optimizer and does not predict scratches or goalie starts. For goalies, a “game night” is **the team’s game**, not a confirmed start.

Hypothesis check (in `lib/overlap.test.ts`): with two Toronto centers already rostered, a third Leaf is fully benched on shared nights; a Montreal center keeps the nights Toronto does not play. Frozen 2026–27 dates from the NHL API.

## Data

- Players: `GET https://api-web.nhle.com/v1/roster/{TEAM}/current`
- Schedule: `GET https://api-web.nhle.com/v1/club-schedule-season/{TEAM}/now`
- Season bounds: `GET https://api-web.nhle.com/v1/schedule/now`

No invented games. If the API is missing a team, the footer/status line lists it.

Yahoo eligibility is **manual** (not locked to NHL) and **fully used in scoring**. Search opens a **Yahoo-pelipaikat** sheet; each roster/compare row has a **Yahoo-kelpoisuus** box and **Muokkaa**. Nightly greedy fill may only start a player in a slot they marked (C/LW/RW/D/G). UTIL is used only if the kimppa profile still has UTIL. LW-only never takes a C slot.

## Stack

Next.js (App Router) + TypeScript + Tailwind. No auth. Switch kimppa profiles in the header/settings for different league slot configs.

## Deploy (phone / HTTPS)

Roster and kimppa profiles stay in **this browser’s `localStorage`**. HTTPS does not change that — no Yahoo OAuth, no server login. Data is per device and per origin (a new Vercel URL is a new empty roster).

This repo is not linked to a Vercel project from CI. One-click on the **bogiporssi-fi** Vercel account (GitHub already connected):

1. Open [Import this GitHub repo on Vercel](https://vercel.com/new/clone?repository-url=https://github.com/bogiporssi-fi/fantasy-hockey-draft).
2. Sign in as the same account that owns `bogiporssi-fi` (Google/GitHub/email — whatever you already use on Vercel).
3. Import **fantasy-hockey-draft**, Framework Preset **Next.js**, Root **./**
4. Deploy **Production** from `main`. Leave Deployment Protection / SSO **off** so the phone can open the URL without a Vercel login.
5. Open the `*.vercel.app` URL on the phone. First NHL load can take a few seconds.

CLI (if you have a token): `npm i -g vercel && vercel login && vercel --prod --yes`

No env vars are required.
