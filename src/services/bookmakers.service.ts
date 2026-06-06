import type { Event, OddsResponse, BookmakerOdds, Market } from '../types/betting';

const API_KEY = import.meta.env.VITE_RAPIDAPI_KEY as string;
const HOST = (import.meta.env.VITE_BOOKMAKERS_HOST as string) || 'bookmakers-data-api.p.rapidapi.com';
const BASE = `https://${HOST}`;

const headers = (): Record<string, string> => ({
  'x-rapidapi-host': HOST,
  'x-rapidapi-key': API_KEY,
});

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'GET', headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const msg = body.length > 200 ? body.slice(0, 200) + '…' : body;
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  const json = await res.json() as unknown;
  return unwrap<T>(json);
}

// ─── Response normaliser ───────────────────────────────────────────────────────
// The API may wrap results in {data:[]}, {result:[]}, {events:[]}, etc.

function unwrap<T>(json: unknown): T {
  if (json == null) return [] as T;
  if (Array.isArray(json)) return json as T;
  if (typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    for (const key of ['data', 'result', 'results', 'events', 'games', 'matches', 'bookmakers', 'odds']) {
      if (obj[key] !== undefined) return obj[key] as T;
    }
  }
  return json as T;
}

// ─── Bookmakers ───────────────────────────────────────────────────────────────

export interface Bookmaker {
  id: number | string;
  name: string;
  country?: string;
}

export async function fetchBookmakers(): Promise<Bookmaker[]> {
  const raw = await get<unknown[]>('/GameData/getbookmakers');
  return (Array.isArray(raw) ? raw : []).map(r => {
    const b = r as Record<string, unknown>;
    return {
      id: (b.id ?? b.bookmakerId ?? b.bookmaker_id ?? 0) as number | string,
      name: String(b.name ?? b.bookmakerName ?? b.bookmaker_name ?? 'Unknown'),
      country: b.country as string | undefined,
    };
  });
}

// ─── Games / Events ───────────────────────────────────────────────────────────

// Raw shape from the API — we normalise into our Event type
interface RawGame {
  id?: unknown; gameId?: unknown; game_id?: unknown; matchId?: unknown; match_id?: unknown;
  title?: unknown; name?: unknown; matchTitle?: unknown; match_title?: unknown;
  home?: unknown; homeTeam?: unknown; home_team?: unknown; team1?: unknown;
  away?: unknown; awayTeam?: unknown; away_team?: unknown; team2?: unknown;
  sport?: unknown; sportName?: unknown; sport_name?: unknown;
  league?: unknown; leagueName?: unknown; league_name?: unknown; competition?: unknown;
  startTime?: unknown; start_time?: unknown; date?: unknown; time?: unknown; kickoff?: unknown;
  status?: unknown; state?: unknown;
}

function normaliseGame(r: RawGame): Event {
  const id = String(r.id ?? r.gameId ?? r.game_id ?? r.matchId ?? r.match_id ?? '');
  const home = String(r.home ?? r.homeTeam ?? r.home_team ?? r.team1 ?? 'Home');
  const away = String(r.away ?? r.awayTeam ?? r.away_team ?? r.team2 ?? 'Away');
  const sport = String(r.sport ?? r.sportName ?? r.sport_name ?? 'football').toLowerCase();
  const league = String(r.league ?? r.leagueName ?? r.league_name ?? r.competition ?? '');
  const rawTime = r.startTime ?? r.start_time ?? r.date ?? r.time ?? r.kickoff ?? '';
  const startTime = rawTime ? new Date(String(rawTime)).toISOString() : new Date().toISOString();
  const status = String(r.status ?? r.state ?? 'upcoming').toLowerCase();
  return { eventId: id, sport, league, home, away, startTime, status };
}

// Try several endpoint paths — we don't know the exact routes yet
const GAME_PATHS = [
  '/GameData/getgames',
  '/GameData/getmatches',
  '/GameData/getevents',
  '/GameData/getfixtures',
  '/GameData/getlivegames',
  '/api/games',
  '/api/events',
];

export async function fetchGames(sport?: string): Promise<Event[]> {
  for (const path of GAME_PATHS) {
    const url = sport ? `${path}?sport=${encodeURIComponent(sport)}` : path;
    try {
      const raw = await get<RawGame[]>(url);
      if (Array.isArray(raw) && raw.length > 0) return raw.map(normaliseGame);
    } catch {
      // try next path
    }
  }
  // None of the game paths worked — return empty so caller can fall back
  return [];
}

// ─── Odds ─────────────────────────────────────────────────────────────────────

interface RawOddsOutcome {
  name?: unknown; outcome?: unknown; selection?: unknown;
  odds?: unknown; price?: unknown; decimal?: unknown;
  bookmaker?: unknown; bookmakerId?: unknown; bookmakerName?: unknown;
}

const ODDS_PATHS = [
  (id: string) => `/GameData/getodds?gameId=${id}`,
  (id: string) => `/GameData/getodds?matchId=${id}`,
  (id: string) => `/GameData/getodds?eventId=${id}`,
  (id: string) => `/GameData/getgameodds?gameId=${id}`,
  (id: string) => `/api/odds?gameId=${id}`,
];

export async function fetchGameOdds(gameId: string, event?: Partial<Event>): Promise<OddsResponse | null> {
  for (const pathFn of ODDS_PATHS) {
    try {
      const raw = await get<unknown>(pathFn(gameId));
      if (!raw) continue;

      // Try to build an OddsResponse from whatever shape we got
      const oddsData = normaliseOdds(raw, gameId, event);
      if (oddsData.bookmakers.length > 0) return oddsData;
    } catch {
      // try next path
    }
  }
  return null;
}

function normaliseOdds(raw: unknown, gameId: string, event?: Partial<Event>): OddsResponse {
  const base: OddsResponse = {
    eventId: gameId,
    sport: event?.sport ?? 'football',
    league: event?.league ?? '',
    home: event?.home ?? 'Home',
    away: event?.away ?? 'Away',
    startTime: event?.startTime ?? new Date().toISOString(),
    bookmakers: [],
  };

  if (!raw || typeof raw !== 'object') return base;

  // If raw is an array it might be a flat list of outcome/bookmaker rows
  const rows = Array.isArray(raw) ? raw : [raw];

  // Group by bookmaker
  const bmMap = new Map<string, Map<string, Map<string, number>>>();

  for (const row of rows as RawOddsOutcome[]) {
    const bmName = String(row.bookmaker ?? row.bookmakerName ?? row.bookmakerId ?? 'Unknown');
    const marketName = String((row as Record<string, unknown>).market ?? (row as Record<string, unknown>).marketName ?? 'Match Winner');
    const outcomeName = String(row.name ?? row.outcome ?? row.selection ?? 'Outcome');
    const oddsVal = parseFloat(String(row.odds ?? row.price ?? row.decimal ?? '0'));

    if (!bmMap.has(bmName)) bmMap.set(bmName, new Map());
    const mktMap = bmMap.get(bmName)!;
    if (!mktMap.has(marketName)) mktMap.set(marketName, new Map());
    mktMap.get(marketName)!.set(outcomeName, oddsVal);
  }

  base.bookmakers = Array.from(bmMap.entries()).map(([bmName, mktMap]): BookmakerOdds => ({
    name: bmName,
    markets: Array.from(mktMap.entries()).map(([mktName, outcomeMap]): Market => ({
      name: mktName,
      outcomes: Array.from(outcomeMap.entries()).map(([oName, oOdds]) => ({ name: oName, odds: oOdds })),
    })),
  }));

  return base;
}

// ─── Discovery (debug panel) ──────────────────────────────────────────────────

export async function testBookmakersAPI(): Promise<string> {
  const lines: string[] = [`HOST: ${HOST}`, ''];

  const paths = [
    '/GameData/getbookmakers',
    '/GameData/getsports',
    '/GameData/getgames',
    '/GameData/getmatches',
    '/GameData/getevents',
    '/GameData/getfixtures',
    '/GameData/getodds',
    '/GameData/getlivegames',
    '/api/v1/bookmakers',
    '/api/bookmakers',
    '/',
  ];

  for (const path of paths) {
    try {
      const res = await fetch(`${BASE}${path}`, { method: 'GET', headers: headers() });
      const body = await res.text().catch(() => '');
      const truncated = body.length > 120 ? body.slice(0, 120) + '…' : body;
      const icon = res.ok ? '✅' : res.status === 429 ? '⚡quota' : res.status === 403 ? '🔑' : '❌';
      lines.push(`${icon} ${path}\n   ${res.status}  ${truncated}`);
    } catch (e) {
      lines.push(`❌ ${path}\n   ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return lines.join('\n\n');
}
