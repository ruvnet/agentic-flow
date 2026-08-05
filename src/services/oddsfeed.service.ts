import type { OddsResponse, Event, SportKey, BookmakerOdds, Market, Outcome } from '../types/betting';

const API_KEY = import.meta.env.VITE_RAPIDAPI_KEY as string;
const HOST = 'odds-feed.p.rapidapi.com';
const BASE = `https://${HOST}`;

const getHeaders = (): Record<string, string> => ({
  'x-rapidapi-host': HOST,
  'x-rapidapi-key': API_KEY,
});

// ─── Response normaliser ──────────────────────────────────────────────────────

interface FeedRow {
  event_id?: number | string;
  id?: number | string;
  home_team?: string;
  away_team?: string;
  home?: string;
  away?: string;
  event_name?: string;
  event?: string;
  bookmaker_name?: string;
  bookmaker?: string;
  provider?: string;
  outcome?: string;
  selection?: string;
  odds?: number | string;
  price?: number | string;
  market_name?: string;
  market?: string;
  start_time?: string;
  start?: string;
  date?: string;
  sport?: string;
  league?: string;
  tournament?: string;
}

type EventMap = Map<string, {
  home: string; away: string; league: string; startTime: string;
  bms: Map<string, Map<string, number>>;  // bmName → outcomeName → odds
}>;

function buildEventMap(rows: FeedRow[]): EventMap {
  const em: EventMap = new Map();

  for (const r of rows) {
    const eid = String(r.event_id ?? r.id ?? '');
    if (!eid) continue;

    if (!em.has(eid)) {
      // Parse teams from event_name "Home vs Away" if not provided separately
      let home = String(r.home_team ?? r.home ?? '');
      let away = String(r.away_team ?? r.away ?? '');
      const name = String(r.event_name ?? r.event ?? '');
      if (!home && !away && name) {
        const parts = name.split(/\s+vs\.?\s+/i);
        home = parts[0]?.trim() ?? name;
        away = parts[1]?.trim() ?? '';
      }
      em.set(eid, {
        home: home || 'Home',
        away: away || 'Away',
        league: String(r.league ?? r.tournament ?? ''),
        startTime: String(r.start_time ?? r.start ?? r.date ?? new Date().toISOString()),
        bms: new Map(),
      });
    }

    const ev = em.get(eid)!;
    const bmName = String(r.bookmaker_name ?? r.bookmaker ?? r.provider ?? 'Unknown');
    const outcomeName = String(r.outcome ?? r.selection ?? '');
    const odds = Number(r.odds ?? r.price ?? 0);
    if (!outcomeName || odds <= 0) continue;

    if (!ev.bms.has(bmName)) ev.bms.set(bmName, new Map());
    ev.bms.get(bmName)!.set(outcomeName, odds);
  }

  return em;
}

function eventMapToOddsResponses(em: EventMap, sport: string): OddsResponse[] {
  const results: OddsResponse[] = [];
  for (const [eid, ev] of em) {
    const bookmakers: BookmakerOdds[] = [];
    for (const [bmName, outcomes] of ev.bms) {
      const outcomeArr: Outcome[] = Array.from(outcomes.entries()).map(([name, odds]) => ({ name, odds }));
      const market: Market = { name: '1X2', outcomes: outcomeArr };
      bookmakers.push({ name: bmName, markets: [market] });
    }
    if (bookmakers.length === 0) continue;
    results.push({
      eventId: eid,
      sport,
      league: ev.league,
      home: ev.home,
      away: ev.away,
      startTime: ev.startTime,
      bookmakers,
    });
  }
  return results;
}

// Unwrap common envelope shapes into a flat FeedRow array
function unwrapRows(json: unknown): FeedRow[] {
  if (Array.isArray(json)) return json as FeedRow[];
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    for (const key of ['data', 'results', 'markets', 'feed', 'events', 'items']) {
      if (Array.isArray(obj[key])) return obj[key] as FeedRow[];
    }
  }
  return [];
}

// ─── Public API ───────────────────────────────────────────────────────────────

// Fetch all live 1X2 markets — no specific event IDs needed
export async function fetchLiveMarkets(sport: SportKey = 'soccer'): Promise<OddsResponse[]> {
  const params = new URLSearchParams({
    placing: 'LIVE',
    market_name: '1X2',
    bet_type: 'BACK',
    page: '0',
    period: 'FULL_TIME_AND_OT',
  });

  try {
    const res = await fetch(`${BASE}/api/v1/markets/feed?${params.toString()}`, {
      method: 'GET',
      headers: getHeaders(),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as unknown;
    const rows = unwrapRows(json);
    if (rows.length === 0) return [];
    const em = buildEventMap(rows);
    return eventMapToOddsResponses(em, sport);
  } catch {
    return [];
  }
}

// Try to find odds for a specific event ID from the live feed
export async function fetchEventOddsFromFeed(eventId: string): Promise<OddsResponse | null> {
  const params = new URLSearchParams({
    placing: 'LIVE',
    market_name: '1X2',
    bet_type: 'BACK',
    page: '0',
    event_ids: eventId,
    period: 'FULL_TIME_AND_OT',
  });

  try {
    const res = await fetch(`${BASE}/api/v1/markets/feed?${params.toString()}`, {
      method: 'GET',
      headers: getHeaders(),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    const rows = unwrapRows(json);
    if (rows.length === 0) return null;
    const em = buildEventMap(rows);
    const results = eventMapToOddsResponses(em, '');
    return results[0] ?? null;
  } catch {
    return null;
  }
}

// Convert live market responses to Event[] for the events list
export async function fetchEventsFromFeed(sport: SportKey): Promise<Event[]> {
  const odds = await fetchLiveMarkets(sport);
  return odds.map(o => ({
    eventId: o.eventId,
    sport: o.sport || sport,
    league: o.league,
    home: o.home,
    away: o.away,
    startTime: o.startTime,
    status: 'live',
  }));
}
