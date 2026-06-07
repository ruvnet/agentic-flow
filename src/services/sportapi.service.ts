import type { OddsResponse, Event, SportKey, BookmakerOdds } from '../types/betting';

const API_KEY = import.meta.env.VITE_RAPIDAPI_KEY as string;
const HOST = (import.meta.env.VITE_SPORTAPI_HOST as string) || 'sportapi7.p.rapidapi.com';
const BASE = `https://${HOST}`;

const SPORT_IDS: Record<SportKey, number> = { soccer: 1, basketball: 2 };

const getHeaders = (): Record<string, string> => ({
  'x-rapidapi-host': HOST,
  'x-rapidapi-key': API_KEY,
});

// Unwrap common API envelope shapes
function unwrapArray(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    for (const key of ['events', 'data', 'results', 'matches', 'items', 'list']) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  return [];
}

function normEvent(raw: Record<string, unknown>, sport: SportKey): Event {
  const id = String(raw.id ?? raw.eventId ?? raw.event_id ?? Math.random());
  const homeTeam = raw.homeTeam as Record<string, unknown> | undefined;
  const awayTeam = raw.awayTeam as Record<string, unknown> | undefined;
  const home = String(homeTeam?.name ?? raw.home ?? raw.home_team ?? 'Home');
  const away = String(awayTeam?.name ?? raw.away ?? raw.away_team ?? 'Away');
  const tournament = raw.tournament as Record<string, unknown> | undefined;
  const league = String(tournament?.name ?? raw.league ?? raw.competition ?? '');
  const ts = raw.startTimestamp as number | undefined;
  const startTime = ts
    ? new Date(ts * 1000).toISOString()
    : String(raw.startTime ?? raw.start_time ?? raw.date ?? new Date().toISOString());
  const statusObj = raw.status as Record<string, unknown> | undefined;
  const statusType = String(statusObj?.type ?? raw.status ?? 'notstarted');
  const status = statusType === 'inprogress' ? 'live' : statusType;
  return { eventId: id, sport, league, home, away, startTime, status };
}

function normOdds(raw: unknown, base: OddsResponse): OddsResponse {
  const obj = raw as Record<string, unknown>;
  const bms: BookmakerOdds[] = [];

  // Format 1: already has bookmakers array
  if (Array.isArray(obj.bookmakers)) {
    return { ...base, bookmakers: obj.bookmakers as BookmakerOdds[] };
  }

  // Format 2: SofaScore back/lay {back:{choices:[{name,odds,provider:{name}}]}}
  const back = obj.back as Record<string, unknown> | undefined;
  if (back?.choices && Array.isArray(back.choices)) {
    const map = new Map<string, Record<string, number>>();
    for (const c of back.choices as Record<string, unknown>[]) {
      const prov = (c.provider as Record<string, unknown> | undefined)?.name ?? 'Unknown';
      const bName = String(prov);
      if (!map.has(bName)) map.set(bName, {});
      map.get(bName)![String(c.name)] = Number(c.odds);
    }
    for (const [name, odds] of map) {
      bms.push({
        name,
        markets: [{
          name: 'Full Time Result',
          outcomes: Object.entries(odds).map(([n, o]) => ({ name: n, odds: o })),
        }],
      });
    }
    if (bms.length > 0) return { ...base, bookmakers: bms };
  }

  // Format 3: {markets:[{marketName,choices:[{name,odds}]}]}
  if (Array.isArray(obj.markets)) {
    const bm: BookmakerOdds = { name: 'SportAPI7', markets: [] };
    for (const mkt of obj.markets as Record<string, unknown>[]) {
      const choices = mkt.choices as Record<string, unknown>[] | undefined;
      if (!choices) continue;
      const outcomes = choices
        .filter(c => Number(c.odds) > 0)
        .map(c => ({ name: String(c.name ?? ''), odds: Number(c.odds) }));
      if (outcomes.length > 0) {
        bm.markets.push({ name: String(mkt.marketName ?? mkt.name ?? 'Market'), outcomes });
      }
    }
    if (bm.markets.length > 0) return { ...base, bookmakers: [bm] };
  }

  // Format 4: {currentOdds:{choices:[...]}}
  const cur = obj.currentOdds as Record<string, unknown> | undefined;
  if (cur?.choices && Array.isArray(cur.choices)) {
    const outcomes = (cur.choices as Record<string, unknown>[])
      .filter(c => Number(c.odds) > 0)
      .map(c => ({ name: String(c.name ?? ''), odds: Number(c.odds) }));
    if (outcomes.length > 0) {
      return { ...base, bookmakers: [{ name: 'SportAPI7', markets: [{ name: 'Full Time Result', outcomes }] }] };
    }
  }

  return { ...base, bookmakers: [] };
}

export async function fetchEvents(sport: SportKey, league?: string): Promise<Event[]> {
  const sportId = SPORT_IDS[sport];
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const all: Event[] = [];

  for (const date of [today, tomorrow]) {
    try {
      const res = await fetch(
        `${BASE}/api/v1/sport/${sportId}/scheduled-events/${date}`,
        { method: 'GET', headers: getHeaders() },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as unknown;
      all.push(...(unwrapArray(json) as Record<string, unknown>[]).map(r => normEvent(r, sport)));
    } catch { /* try next date */ }
  }

  // Fallback to live events
  if (all.length === 0) {
    try {
      const res = await fetch(
        `${BASE}/api/v1/sport/${sportId}/events/live`,
        { method: 'GET', headers: getHeaders() },
      );
      if (res.ok) {
        const json = (await res.json()) as unknown;
        all.push(...(unwrapArray(json) as Record<string, unknown>[]).map(r => normEvent(r, sport)));
      }
    } catch { /* no live events */ }
  }

  if (league) {
    const lower = league.toLowerCase();
    return all.filter(e => e.league.toLowerCase().includes(lower));
  }
  return all;
}

export async function fetchOdds(eventId: string): Promise<OddsResponse> {
  const base: OddsResponse = {
    eventId,
    sport: '',
    league: '',
    home: '',
    away: '',
    startTime: new Date().toISOString(),
    bookmakers: [],
  };

  // Get event details first
  try {
    const res = await fetch(`${BASE}/api/v1/event/${eventId}`, { method: 'GET', headers: getHeaders() });
    if (res.ok) {
      const json = (await res.json()) as Record<string, unknown>;
      const ev = (json.event ?? json) as Record<string, unknown>;
      const homeTeam = ev.homeTeam as Record<string, unknown> | undefined;
      const awayTeam = ev.awayTeam as Record<string, unknown> | undefined;
      const tournament = ev.tournament as Record<string, unknown> | undefined;
      const ts = ev.startTimestamp as number | undefined;
      base.league = String(tournament?.name ?? ev.league ?? '');
      base.home = String(homeTeam?.name ?? ev.home ?? '');
      base.away = String(awayTeam?.name ?? ev.away ?? '');
      base.startTime = ts ? new Date(ts * 1000).toISOString() : String(ev.startTime ?? base.startTime);
    }
  } catch { /* event info optional */ }

  // Try odds endpoints in order
  const oddsPaths = [
    `/api/v1/event/${eventId}/odds/1`,
    `/api/v1/event/${eventId}/oddscomparison/1/1`,
    `/api/v1/event/${eventId}/oddssummary`,
    `/api/v1/event/${eventId}/odds`,
  ];

  for (const path of oddsPaths) {
    try {
      const res = await fetch(`${BASE}${path}`, { method: 'GET', headers: getHeaders() });
      if (!res.ok) continue;
      const json = (await res.json()) as unknown;
      const result = normOdds(json, base);
      if (result.bookmakers.length > 0) return result;
    } catch { /* try next path */ }
  }

  return base;
}

export async function testConnection(): Promise<string> {
  const lines: string[] = [`SPORTAPI7 (${HOST})`, ''];
  const today = new Date().toISOString().slice(0, 10);
  const paths = [
    `/api/v1/sport/1/scheduled-events/${today}`,
    `/api/v1/sport/1/events/live`,
    `/api/v1/sport/2/scheduled-events/${today}`,
    `/api/v1/event/15508283`,
    `/api/v1/event/15508283/odds/1`,
  ];

  for (const path of paths) {
    try {
      const res = await fetch(`${BASE}${path}`, { method: 'GET', headers: getHeaders() });
      const body = await res.text().catch(() => '');
      const icon = res.ok ? '✅' : res.status === 429 ? '⚡quota' : '❌';
      const snippet = body.length > 100 ? `${body.slice(0, 100)}…` : body;
      lines.push(`${icon} ${path}  →  ${res.status}  ${snippet}`);
    } catch (e) {
      lines.push(`❌ ${path}  →  ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return lines.join('\n');
}
