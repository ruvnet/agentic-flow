---
name: betting
description: Fetch live sports odds, detect value bets and arbitrage opportunities directly in the terminal
---

# /betting — Live Odds & Edge Detection

Run sports betting analysis directly in Claude Code — no browser needed. Uses the same RapidAPI credentials as the web dashboard.

## Prerequisites

`.env` file must exist in the project root with:
```
VITE_RAPIDAPI_KEY=<your-rapidapi-key>
VITE_RAPIDAPI_HOST=odds-api-io-real-time-sports-betting-odds-api.p.rapidapi.com
```

## Usage

When the user invokes `/betting`, run the CLI script using the arguments they provide:

```bash
# List upcoming football events
npx tsx scripts/betting-cli.ts events soccer

# List upcoming basketball events
npx tsx scripts/betting-cli.ts events basketball

# Show full odds table for a specific event
npx tsx scripts/betting-cli.ts odds <eventId>

# Analyse an event for value bets and arbitrage
npx tsx scripts/betting-cli.ts analyze <eventId>
```

## Workflow

1. Start with `events soccer` or `events basketball` to get a list with Event IDs
2. Copy an Event ID from the output
3. Run `analyze <eventId>` to see value bets (edge vs Pinnacle) and any arbitrage
4. Use `odds <eventId>` for the full bookmaker comparison table

## What the output means

- **Value bet**: your bookmaker is offering more than Pinnacle's implied fair price by >1%. Edge % = how much above fair odds. Kelly % = suggested fraction of bankroll.
- **Arbitrage**: back all outcomes across different bookmakers, guaranteed profit regardless of result. Stake amounts are shown per £100 total.
- **Margin**: bookmaker's overround. <3% = sharp, <6% = acceptable, >6% = avoid.

## Notes

- The free BASIC RapidAPI plan has a daily quota. Use `analyze` only on events you're serious about — don't run it repeatedly.
- If you see HTTP 429, the daily quota is exhausted; it resets at midnight UTC.
- The script reads from `.env` automatically — no need to export environment variables.
