/**
 * Odds-based parlay builder.
 *
 * Scans today's scheduled events, pulls moneyline odds from the bookmaker API,
 * ranks teams by implied probability (= how strongly the book backs them),
 * and builds 3 two-leg parlays from the highest-confidence picks.
 *
 * No historical form data required — works purely from bookmaker prices.
 */
import type { SofaEvent, OddsMarket } from './types.js';

/** Minimal interface required by the odds parlay scanner. */
interface OddsDataClient {
  getScheduledEvents(sport: string, date?: string): Promise<SofaEvent[]>;
  getEventOdds(eventId: number): Promise<OddsMarket[]>;
}

export interface MoneylineLeg {
  eventId: number;
  match: string;
  sport: string;
  league: string;
  pick: '1' | '2';
  teamName: string;
  decimalOdds: number;
  impliedProb: number; // percentage
  kickoffTime?: string;
}

export interface OddsParlay {
  id: number;
  legs: [MoneylineLeg, MoneylineLeg];
  combinedOdds: number;
  combinedProb: number; // percentage
}

// ── helpers ──────────────────────────────────────────────────────────────────

function fracToDecimal(frac?: string): number | undefined {
  if (!frac) return undefined;
  const parts = frac.split('/').map(Number);
  const n = parts[0];
  const d = parts[1];
  if (n === undefined || d === undefined || !d || isNaN(n) || isNaN(d)) return undefined;
  return +(n / d + 1).toFixed(3);
}

function resolveOdds(choice: { fractionalValue?: string; decimal?: number }): number | undefined {
  return fracToDecimal(choice.fractionalValue) ?? choice.decimal;
}

/**
 * Find the moneyline market and return the book-favored team (lowest odds).
 * Returns null if no qualifying odds found or favorite is below MIN_IMPLIED_PROB.
 */
function extractFavorite(
  event: SofaEvent,
  markets: OddsMarket[],
  minImpliedProb: number,
): MoneylineLeg | null {
  // Match 1X2 / Match Winner / Moneyline markets
  const market = markets.find((m) =>
    /1x2|match.?winner|full.?time|moneyline|to.?win/i.test(m.marketName)
  );
  if (!market) return null;

  // Identify home and away choices by name
  const homeChoice = market.choices.find((c) => /\b(home|1)\b/i.test(c.name));
  const awayChoice = market.choices.find((c) => /\b(away|2)\b/i.test(c.name));
  if (!homeChoice || !awayChoice) return null;

  const homeOdds = resolveOdds(homeChoice);
  const awayOdds = resolveOdds(awayChoice);
  if (!homeOdds || !awayOdds || homeOdds <= 1 || awayOdds <= 1) return null;

  const isFavoriteHome = homeOdds <= awayOdds;
  const favOdds = isFavoriteHome ? homeOdds : awayOdds;
  const favTeam = isFavoriteHome ? event.homeTeam.name : event.awayTeam.name;
  const impliedProb = Math.round((1 / favOdds) * 1000) / 10; // 1 decimal place

  if (impliedProb < minImpliedProb) return null;

  return {
    eventId: event.id,
    match: `${event.homeTeam.name} vs ${event.awayTeam.name}`,
    sport: event.sport?.name ?? 'Unknown',
    league: event.tournament?.name ?? 'Unknown',
    pick: isFavoriteHome ? '1' : '2',
    teamName: favTeam,
    decimalOdds: favOdds,
    impliedProb,
    kickoffTime: event.startTimestamp
      ? new Date(event.startTimestamp * 1000).toISOString()
      : undefined,
  };
}

/** Group a sorted list of picks into N two-leg parlays (no event duplication). */
function buildParlays(legs: MoneylineLeg[], count: number): OddsParlay[] {
  const parlays: OddsParlay[] = [];
  const usedIds = new Set<number>();
  let pool = legs.filter((l) => !usedIds.has(l.eventId));

  for (let i = 0; i < count; i++) {
    // Pick two legs that haven't been used yet
    const available = legs.filter((l) => !usedIds.has(l.eventId));
    if (available.length < 2) break;

    const leg1 = available[0]!;
    const leg2 = available[1]!;
    usedIds.add(leg1.eventId);
    usedIds.add(leg2.eventId);

    const combinedOdds = +(leg1.decimalOdds * leg2.decimalOdds).toFixed(2);
    const combinedProb = Math.round(leg1.impliedProb * leg2.impliedProb / 100 * 10) / 10;

    parlays.push({
      id: i + 1,
      legs: [leg1, leg2],
      combinedOdds,
      combinedProb,
    });

    // suppress unused variable warning
    void pool;
    pool = legs.filter((l) => !usedIds.has(l.eventId));
  }

  return parlays;
}

// ── main exports ──────────────────────────────────────────────────────────────

export interface OddsPickerOptions {
  sports: string[];
  allowedLeagues: string[];
  isLeagueAllowed: (league: string, allowed: string[]) => boolean;
  /** Minimum implied probability % to consider a team (default 57 ≈ odds < 1.76) */
  minImpliedProb?: number;
  /** Number of two-leg parlays to build (default 3) */
  parlayCount?: number;
  /** Max events to fetch odds for per sport (saves quota) */
  maxEventsPerSport?: number;
}

/** Shared leg-collection logic used by both parlay builder and cache builder. */
async function collectLegs(client: OddsDataClient, opts: OddsPickerOptions): Promise<MoneylineLeg[]> {
  const {
    sports,
    allowedLeagues,
    isLeagueAllowed,
    minImpliedProb = 57,
    maxEventsPerSport = 20,
  } = opts;

  const legs: MoneylineLeg[] = [];

  const todayUTC = new Date().toISOString().slice(0, 10);
  const yesterdayUTC = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  for (const sport of sports) {
    let events: SofaEvent[] = [];
    try {
      events = await client.getScheduledEvents(sport, todayUTC);
      // MLB/NBA games in US time zones often start at 7-10 PM ET, which falls on the
      // previous UTC date early in the morning (e.g. 3 AM UTC = 11 PM previous day ET).
      // When today returns nothing, also check yesterday's UTC date.
      if (events.length === 0) {
        const yesterdayEvents = await client.getScheduledEvents(sport, yesterdayUTC);
        if (yesterdayEvents.length > 0) {
          console.log(`[OddsPicker] ${sport}: Using yesterday's UTC date (${yesterdayUTC}) — found ${yesterdayEvents.length} event(s) (US timezone overlap)`);
          events = yesterdayEvents;
        }
      }
    } catch {
      console.log(`[OddsPicker] Could not fetch scheduled ${sport} events`);
      continue;
    }

    const filtered = events
      .filter((e) => isLeagueAllowed(e.tournament?.name ?? '', allowedLeagues))
      .slice(0, maxEventsPerSport);

    if (events.length > 0 && filtered.length === 0) {
      // Show which leagues were seen but blocked — helps diagnose filter mismatches
      const seen = [...new Set(events.map((e) => e.tournament?.name ?? '(unknown)'))].slice(0, 5);
      console.log(`[OddsPicker] ${sport}: ${events.length} events found but 0 passed league filter. Seen leagues: ${seen.join(', ')}`);
    } else {
      console.log(`[OddsPicker] ${sport}: ${filtered.length} allowed events to check odds (${events.length} total today)`);
    }

    for (const event of filtered) {
      let markets: OddsMarket[] = [];
      try {
        markets = await client.getEventOdds(event.id);
      } catch {
        continue;
      }
      if (markets.length === 0) continue;

      const leg = extractFavorite(event, markets, minImpliedProb);
      if (leg) {
        console.log(`[OddsPicker] ✓ ${leg.teamName} (${leg.league}) — ${leg.impliedProb}% implied @ ${leg.decimalOdds}`);
        legs.push(leg);
      }
    }
  }

  legs.sort((a, b) => b.impliedProb - a.impliedProb);
  return legs;
}

/** Build 3 two-leg moneyline parlays from the most book-favored teams. */
export async function scanOddsParlays(
  client: OddsDataClient,
  opts: OddsPickerOptions,
): Promise<OddsParlay[]> {
  const parlayCount = opts.parlayCount ?? 3;
  const legs = await collectLegs(client, opts);

  if (legs.length === 0) {
    console.log(`[OddsPicker] No qualifying favorites found (min implied prob: ${opts.minImpliedProb ?? 57}%)`);
    return [];
  }

  console.log(`[OddsPicker] ${legs.length} qualifying pick(s) — building ${parlayCount} parlays`);
  return buildParlays(legs, parlayCount);
}

/**
 * Return ALL qualifying moneyline legs for today's events (sorted by implied prob).
 * Used to build a pre-match cache for live event matching.
 */
export async function scanAllOddsLegs(
  client: OddsDataClient,
  opts: OddsPickerOptions,
): Promise<MoneylineLeg[]> {
  return collectLegs(client, opts);
}
