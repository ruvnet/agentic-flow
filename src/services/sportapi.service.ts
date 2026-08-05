import type { OddsResponse, Event, SportKey, BookmakerOdds } from '../types/betting';
import { fetchEventsFromFeed, fetchEventOddsFromFeed } from './oddsfeed.service';

const API_KEY = import.meta.env.VITE_RAPIDAPI_KEY as string;
const HOST = (import.meta.env.VITE_SPORTAPI_HOST as string) || 'sportapi7.p.rapidapi.com';
const BASE = `https://${HOST}`;

const SPORT_IDS: Record<SportKey, number> = { soccer: 1, basketball: 2 };

const getHeaders = (): Record<string, string> => ({
  'x-rapidapi-host': HOST,
  'x-rapidapi-key': API_KEY,
});

// ─── Cache (localStorage, quota-preserving) ───────────────────────────────────

const TTL_EVENTS = 60 * 60 * 1000;  // 1 hour — events don't change often
const TTL_ODDS   = 30 * 60 * 1000;  // 30 min  — odds shift closer to kickoff

interface CacheEntry<T> { value: T; expires: number }

function cacheGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`betedge_${key}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() > entry.expires) { localStorage.removeItem(`betedge_${key}`); return null; }
    return entry.value;
  } catch { return null; }
}

function cacheSet<T>(key: string, value: T, ttl: number): void {
  try {
    localStorage.setItem(`betedge_${key}`, JSON.stringify({ value, expires: Date.now() + ttl }));
  } catch { /* storage full — skip */ }
}

export function cacheInfo(): string {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('betedge_')) keys.push(k.replace('betedge_', ''));
    }
  } catch { /* ignore */ }
  if (keys.length === 0) return 'Cache: empty';
  return `Cache: ${keys.length} entr${keys.length === 1 ? 'y' : 'ies'} — ${keys.join(', ')}`;
}

// ─── Response normalisers ─────────────────────────────────────────────────────

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

  if (Array.isArray(obj.bookmakers)) {
    return { ...base, bookmakers: obj.bookmakers as BookmakerOdds[] };
  }

  // SofaScore back/lay {back:{choices:[{name,odds,provider:{name}}]}}
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
      bms.push({ name, markets: [{ name: 'Full Time Result', outcomes: Object.entries(odds).map(([n, o]) => ({ name: n, odds: o })) }] });
    }
    if (bms.length > 0) return { ...base, bookmakers: bms };
  }

  // {markets:[{marketName,choices:[{name,odds}]}]}
  if (Array.isArray(obj.markets)) {
    const bm: BookmakerOdds = { name: 'SportAPI7', markets: [] };
    for (const mkt of obj.markets as Record<string, unknown>[]) {
      const choices = mkt.choices as Record<string, unknown>[] | undefined;
      if (!choices) continue;
      const outcomes = choices
        .filter(c => Number(c.odds) > 0)
        .map(c => ({ name: String(c.name ?? ''), odds: Number(c.odds) }));
      if (outcomes.length > 0) bm.markets.push({ name: String(mkt.marketName ?? mkt.name ?? 'Market'), outcomes });
    }
    if (bm.markets.length > 0) return { ...base, bookmakers: [bm] };
  }

  // {currentOdds:{choices:[...]}}
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

// ─── Public API ───────────────────────────────────────────────────────────────

export async function fetchEvents(sport: SportKey, league?: string): Promise<Event[]> {
  // Cache keyed by sport only — filter league in-memory to preserve quota
  const cacheKey = `events_${sport}`;
  const cached = cacheGet<Event[]>(cacheKey);
  if (cached) {
    if (league) {
      const lower = league.toLowerCase();
      return cached.filter(e => e.league.toLowerCase().includes(lower));
    }
    return cached;
  }

  const sportId = SPORT_IDS[sport];
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const all: Event[] = [];
  let quotaExceeded = false;

  for (const date of [today, tomorrow]) {
    try {
      const res = await fetch(
        `${BASE}/api/v1/sport/${sportId}/scheduled-events/${date}`,
        { method: 'GET', headers: getHeaders() },
      );
      if (res.status === 429) { quotaExceeded = true; break; }
      if (!res.ok) continue;
      const json = (await res.json()) as unknown;
      all.push(...(unwrapArray(json) as Record<string, unknown>[]).map(r => normEvent(r, sport)));
    } catch { /* try next date */ }
  }

  // Fallback 1: live events from sportapi7
  if (all.length === 0 && !quotaExceeded) {
    try {
      const res = await fetch(
        `${BASE}/api/v1/sport/${sportId}/events/live`,
        { method: 'GET', headers: getHeaders() },
      );
      if (res.ok) {
        const json = (await res.json()) as unknown;
        all.push(...(unwrapArray(json) as Record<string, unknown>[]).map(r => normEvent(r, sport)));
      }
    } catch { /* no events available */ }
  }

  // Fallback 2: odds-feed live markets when sportapi7 quota is exceeded
  if (all.length === 0 && quotaExceeded) {
    try {
      const feedEvents = await fetchEventsFromFeed(sport);
      all.push(...feedEvents);
    } catch { /* odds-feed also unavailable */ }
  }

  if (all.length > 0) cacheSet(cacheKey, all, TTL_EVENTS);

  if (league) {
    const lower = league.toLowerCase();
    return all.filter(e => e.league.toLowerCase().includes(lower));
  }
  return all;
}

export async function fetchOdds(eventId: string): Promise<OddsResponse> {
  const cacheKey = `odds_${eventId}`;
  const cached = cacheGet<OddsResponse>(cacheKey);
  if (cached) return cached;

  const base: OddsResponse = {
    eventId, sport: '', league: '', home: '', away: '',
    startTime: new Date().toISOString(), bookmakers: [],
  };

  // 1 call: event details
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

  // Try odds endpoints until one works
  const oddsPaths = [
    `/api/v1/event/${eventId}/odds/1`,
    `/api/v1/event/${eventId}/oddscomparison/1/1`,
    `/api/v1/event/${eventId}/oddssummary`,
    `/api/v1/event/${eventId}/odds`,
  ];

  let sportapi7QuotaHit = false;
  for (const path of oddsPaths) {
    try {
      const res = await fetch(`${BASE}${path}`, { method: 'GET', headers: getHeaders() });
      if (res.status === 429) { sportapi7QuotaHit = true; break; }
      if (!res.ok) continue;
      const json = (await res.json()) as unknown;
      const result = normOdds(json, base);
      if (result.bookmakers.length > 0) {
        cacheSet(cacheKey, result, TTL_ODDS);
        return result;
      }
    } catch { /* try next path */ }
  }

  // Fallback: odds-feed.p.rapidapi.com when sportapi7 quota is exceeded
  if (sportapi7QuotaHit || base.bookmakers.length === 0) {
    try {
      const feedResult = await fetchEventOddsFromFeed(eventId);
      if (feedResult) {
        // Merge event info from sportapi7 if we got it, keep odds from feed
        const merged = { ...feedResult, ...base, bookmakers: feedResult.bookmakers };
        if (merged.home) {
          cacheSet(cacheKey, merged, TTL_ODDS);
          return merged;
        }
      }
    } catch { /* odds-feed unavailable */ }
  }

  return base;
}

// Single-request connection test — preserves quota, shows cache status first
export async function testConnection(): Promise<string> {
  const lines: string[] = [`SPORTAPI7 (${HOST})`, ''];

  // Show cache status (costs 0 API calls)
  lines.push(cacheInfo());

  const soccerCached = cacheGet<Event[]>('events_soccer');
  const basketCached = cacheGet<Event[]>('events_basketball');
  if (soccerCached) lines.push(`  ⚡ ${soccerCached.length} soccer events cached — no API call needed`);
  if (basketCached) lines.push(`  ⚡ ${basketCached.length} basketball events cached — no API call needed`);

  if (soccerCached || basketCached) {
    lines.push('');
    lines.push('Cache is fresh. Quota preserved. No test call made.');
    lines.push('Reload the page or wait for cache to expire (1h) to refresh.');
    return lines.join('\n');
  }

  // Only fire 1 request if cache is empty
  lines.push('');
  lines.push('Cache empty — making 1 test request…');
  const today = new Date().toISOString().slice(0, 10);
  const path = `/api/v1/sport/1/scheduled-events/${today}`;
  try {
    const res = await fetch(`${BASE}${path}`, { method: 'GET', headers: getHeaders() });
    const body = await res.text().catch(() => '');
    if (res.ok) {
      lines.push(`✅ ${path}  →  ${res.status}  ${body.slice(0, 120)}`);
    } else if (res.status === 429) {
      lines.push(`⚡ QUOTA EXCEEDED (429) — sportapi7 hourly limit hit`);
      lines.push('');
      lines.push('Fallback: odds-feed.p.rapidapi.com will be used for live odds.');
      lines.push('Wait ~1 hour for quota to reset for scheduled events.');
    } else {
      lines.push(`❌ ${path}  →  ${res.status}  ${body.slice(0, 120)}`);
    }
  } catch (e) {
    lines.push(`❌ Network error: ${e instanceof Error ? e.message : String(e)}`);
  }

  return lines.join('\n');
}
