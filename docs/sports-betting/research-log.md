# Sports Betting Research Log

Running log of daily research findings, tooling notes, and standing rules context.
Read this first in any new session to pick up where the last one left off.
The permanent win/loss learning log lives in `bot.ts` `/rules` command — this file
is the day-by-day research detail that's too verbose to keep in `/rules`.

## Standing rules (chosen by user, do not silently override)

- Every leg needs a real, verifiable data reason (pitcher ERA, recent form, H2H,
  injury). No coinflips, no "gut" picks.
- Minimum 60% true win probability per leg, aim for 70%+. Market-implied odds
  are a starting point, not proof — check for red flags (e.g. home/road ERA
  splits) before trusting a favorite's price.
- `maxPicksPerDay` = 6 (2 morning, 2 evening, 2 night) — this is a CEILING, not
  a quota. User explicitly chose "keep quality bar, flexible count" when asked
  whether to force bet counts. 0 picks on a quiet day beats 1 weak pick.
- All legs in a parlay must be positively correlated (same underlying cause).
- Update this log and `bot.ts` `/rules` whenever something is learned (win,
  loss, or market pattern) — standing instruction, not one-time.

## Tooling notes (environment-specific, re-discover cost is high)

- This repo runs in a remote cloud container with a network egress allowlist —
  Bash/curl can only reach `github.com` and `registry.npmjs.org`. Direct calls
  to ESPN, MLB Stats API, The Odds API, TheSportsDB, OpenWeather, etc. all
  return HTTP 403 "Host not in allowlist." Confirmed still true as of June 16
  2026 even after installing new MCP connectors/skills.
- **WebSearch and WebFetch tools bypass this allowlist** — they route through
  Anthropic's infrastructure, not the container's network. Use WebSearch as
  the primary live-data tool. WebFetch frequently gets blocked by anti-bot
  protection on sites like FanGraphs, MLB.com, FanDuel research pages, etc.
  — fall back to WebSearch (snippet results) when WebFetch 403s.
  Load via `ToolSearch` with `select:WebSearch,WebFetch` if not already loaded.
- The "Browser Use / Connected browsers" feature (real Chrome on the user's
  machine) is NOT wired into this remote cloud session — no browser-control
  tools are exposed here even when a browser is connected in settings. That
  feature only works from the local desktop app/claude.ai surface where the
  connection actually lives.

## Confirmed results log

- **June 15, 2026 — 2/2 bets, 5/5 legs hit:**
  - Cubs ML (Imanaga vs 2-8 Lorenzen) won 5-4
  - Phillies ML (Wheeler 2.22 ERA vs Gusto 6.00 ERA) won 7-0 shutout
  - Reds SGP (ML + Burns 5+ Ks + Mets U3.5) won 12-0 sweep
  - Pattern confirmed: elite ERA vs bad ERA pitcher mismatch = highest hit rate
  - Pattern confirmed: book-favorite K props at -900+ are near-locks
  - World Cup caveat: Belgium -155 drew 1-1 vs Egypt, Spain drew 0-0 vs Cape
    Verde — group-stage favorites draw often, avoid soccer ML in group stage

## June 16, 2026 — full slate research (in progress)

No leg has cleared the 60%+ true-probability bar with solid data backing as
of this entry. Logged for reference / to avoid re-researching the same dead
ends later in the day.

**MLB:**
| Game | Favorite (ML) | Favorite SP ERA | Underdog SP ERA | Note |
|---|---|---|---|---|
| Phillies vs Marlins | Phillies -190 (~60%) | Luzardo 4.85 season / **7.34 HOME** / 1.55 road | Tyler Phillips 1.20 ERA last 30IP (elite recent form) | Pitching tonight at home — exactly Luzardo's worst split. Red flag, market may be mispricing. SKIP. |
| Dodgers vs Rays | Dodgers -190 (~62%) | Wrobleski 2.95 | Rasmussen 2.71 | Too close, no clear mismatch. Team batting close too (LAD .320/.516 vs TB .302/.548). SKIP. |
| Diamondbacks vs Angels | Diamondbacks -144 | Kelly 5.46 | Detmers 4.00 | Favorite has the worse arm. SKIP. |
| Brewers vs Guardians | Brewers -154 | Gasser 0-3 record | Cecconi 3-5 | Model only 58.2% win prob, below bar. SKIP. |
| Nationals vs Royals | Nationals -138 | Griffin 7-2, 3.46 | Wacha 4-5, 3.58 | Modest edge, not clearly 60%+. SKIP. |
| Mets vs Reds | Mets -125 | Senga 9.00 ERA (0-4) | Singer 5.61 ERA | Favorite has far worse arm. SKIP. |
| Athletics vs Pirates | Athletics -137 | Perkins 6.25 | Keller 5.14 | Favorite has worse arm, model only 51.3%. SKIP. |
| Blue Jays vs Red Sox | Blue Jays -120 | Cease 2.91 | Tolle 2.70 | Both elite, coin flip. SKIP. |

**World Cup (June 16):** France vs Senegal, Iraq vs Norway, Argentina vs
Algeria — all group stage. Standing rule: avoid ML in group stage (draw risk).

**Tennis (ATP Queen's Club / WTA Nottingham):** Best signal found was De
Minaur -4.5 at +115, only 56.4% modeled win prob — below bar. Rublev/Hurkacz
Under 25.5 games also surfaced but not independently verified to 60%+.

**Cricket:** Only Women's T20 World Cup group matches today (NZ vs Sri Lanka,
England vs Ireland) — no usable odds data surfaced via WebSearch.

**Takeaway pattern for the day:** an unusual number of today's MLB favorites
are priced ahead of a starter with a _worse_ ERA than the opponent's (Mets,
Athletics, Diamondbacks, and arguably Phillies once you account for the home
split). This suggests today's lines are driven by lineup/bullpen/park factors
rather than starting-pitcher edge — the opposite of the pattern that won
2/2 on June 15. Forcing picks into this kind of slate is exactly what the
"no forced quota" rule exists to prevent.
