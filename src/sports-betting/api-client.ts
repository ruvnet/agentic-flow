import axios, { AxiosInstance } from 'axios';
import type {
  BotConfig,
  SofaEvent,
  OddsMarket,
  AllScoresRawResponse,
  AllScoresRawMatch,
} from './types.js';
import { ALLSCORES_SPORT_IDS } from './types.js';

// Sport slug → 1xbet sport name mappings
const XBET_SPORT_NAMES: Record<string, string> = {
  football: 'Soccer',
  basketball: 'Basketball',
  baseball: 'Baseball',
  tennis: 'Tennis',
  'american-football': 'American Football',
  'ice-hockey': 'Ice Hockey',
};

// ── SofaScore client ─────────────────────────────────────────────────────────

export class SofaScoreClient {
  private http: AxiosInstance;

  constructor(config: BotConfig) {
    this.http = axios.create({
      baseURL: `https://${config.apiHost}`,
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-host': config.apiHost,
        'x-rapidapi-key': config.apiKey,
      },
      timeout: 10_000,
    });
  }

  async getLiveEvents(sport: string): Promise<SofaEvent[]> {
    const res = await this.http.get<{ events?: SofaEvent[] }>(
      `/api/v1/sport/${sport}/events/live`
    );
    return (res.data.events ?? []).map((e) => ({ ...e, _source: 'sofascore' as const }));
  }

  async getEventOdds(eventId: number): Promise<OddsMarket[]> {
    try {
      const res = await this.http.get<{ markets?: OddsMarket[] }>(
        `/api/v1/event/${eventId}/odds`
      );
      return res.data.markets ?? [];
    } catch {
      return [];
    }
  }

  /** Last N finished events for a team (page 0 = most recent 10) */
  async getTeamLastEvents(teamId: number, page = 0): Promise<SofaEvent[]> {
    try {
      const res = await this.http.get<{ events?: SofaEvent[] }>(
        `/api/v1/team/${teamId}/events/last/${page}`
      );
      return res.data.events ?? [];
    } catch {
      return [];
    }
  }

  /** Today's (or the given YYYY-MM-DD date's) scheduled not-yet-started events */
  async getScheduledEvents(sport: string, date?: string): Promise<SofaEvent[]> {
    const d = date ?? new Date().toISOString().slice(0, 10);
    try {
      const res = await this.http.get<{ events?: SofaEvent[] }>(
        `/api/v1/sport/${sport}/scheduled-events/${d}`
      );
      return (res.data.events ?? [])
        .filter((e) => e.status.type === 'notstarted')
        .map((e) => ({ ...e, _source: 'sofascore' as const }));
    } catch {
      return [];
    }
  }

  /** Head-to-head last events between the two teams in this event */
  async getEventH2H(eventId: number): Promise<SofaEvent[]> {
    try {
      const res = await this.http.get<{
        teamDuel?: { previousEvents?: SofaEvent[] };
        events?: SofaEvent[];
      }>(`/api/v1/event/${eventId}/h2h`);
      return (
        res.data.teamDuel?.previousEvents ??
        res.data.events ??
        []
      );
    } catch {
      return [];
    }
  }
}

// ── AllScores client (fallback) ───────────────────────────────────────────────

function strOf(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && 'name' in v)
    return String((v as { name: unknown }).name);
  return String(v);
}

function parseScore(v: string | number | undefined): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

let _allscoresIdCounter = 9_000_000;

function normalizeMatch(raw: AllScoresRawMatch, sportSlug: string): SofaEvent {
  const homeName = strOf(raw.homeTeam) || strOf(raw.home) || 'Home';
  const awayName = strOf(raw.awayTeam) || strOf(raw.away) || 'Away';
  const id = raw.id ? Number(raw.id) : ++_allscoresIdCounter;

  let homeGoals: number | undefined;
  let awayGoals: number | undefined;
  if (raw.score && typeof raw.score === 'string' && raw.score.includes('-')) {
    const parts = raw.score.split('-').map(Number);
    const h = parts[0];
    const a = parts[1];
    homeGoals = h === undefined || isNaN(h) ? undefined : h;
    awayGoals = a === undefined || isNaN(a) ? undefined : a;
  } else {
    homeGoals = parseScore(raw.homeScore);
    awayGoals = parseScore(raw.awayScore);
  }

  const statusStr = strOf(raw.status) || 'inprogress';
  const isFinished = /finish|ended|full.?time|ft/i.test(statusStr);
  const isLive = !isFinished && !/not.?started|scheduled|tbd/i.test(statusStr);

  return {
    id,
    _source: 'allscores',
    sport: { name: sportSlug, slug: sportSlug },
    homeTeam: { id: 0, name: homeName },
    awayTeam: { id: 0, name: awayName },
    homeScore: homeGoals !== undefined ? { current: homeGoals } : undefined,
    awayScore: awayGoals !== undefined ? { current: awayGoals } : undefined,
    status: {
      code: isFinished ? 100 : isLive ? 6 : 0,
      description: statusStr,
      type: isFinished ? 'finished' : isLive ? 'inprogress' : 'notstarted',
    },
    tournament: {
      id: 0,
      name: strOf(raw.league) || strOf(raw.tournament) || 'Unknown League',
    },
  };
}

function extractMatches(data: AllScoresRawResponse): AllScoresRawMatch[] {
  if (Array.isArray(data)) return data as AllScoresRawMatch[];
  if (Array.isArray(data.matches)) return data.matches;
  if (Array.isArray(data.events)) return data.events;
  if (data.data) {
    const d = data.data;
    if (Array.isArray(d)) return d;
    if (typeof d === 'object' && d !== null) {
      const inner = d as { matches?: AllScoresRawMatch[]; events?: AllScoresRawMatch[] };
      if (Array.isArray(inner.matches)) return inner.matches;
      if (Array.isArray(inner.events)) return inner.events;
    }
  }
  return [];
}

export class AllScoresClient {
  private http: AxiosInstance;
  private timezone: string;

  constructor(config: BotConfig) {
    const host = config.fallbackApiHost ?? 'allscores.p.rapidapi.com';
    const key = config.fallbackApiKey ?? config.apiKey;
    this.timezone = config.timezone;

    this.http = axios.create({
      baseURL: `https://${host}`,
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-host': host,
        'x-rapidapi-key': key,
      },
      timeout: 10_000,
    });
  }

  async getLiveEvents(sport: string): Promise<SofaEvent[]> {
    const sportId = ALLSCORES_SPORT_IDS[sport] ?? 1;
    const tz = encodeURIComponent(this.timezone);
    const res = await this.http.get<AllScoresRawResponse>(
      `/api/allscores/livescores?sport=${sportId}&timezone=${tz}&langId=1`
    );
    return extractMatches(res.data)
      .filter((m) => {
        const s = strOf(m.status);
        return /live|progress|half|quarter|period|playing/i.test(s) || !s;
      })
      .map((m) => normalizeMatch(m, sport));
  }

  async getEventOdds(_eventId: number): Promise<OddsMarket[]> {
    return [];
  }
}

// ── 1xBet client (second fallback) ───────────────────────────────────────────

interface XBetRawEvent {
  id?: string | number;
  homeTeam?: string | { name?: string };
  awayTeam?: string | { name?: string };
  home?: string;
  away?: string;
  score?: string;
  homeScore?: string | number;
  awayScore?: string | number;
  status?: string | { name?: string };
  league?: string | { name?: string };
  sport?: string | { name?: string };
  sportName?: string;
  leagueName?: string;
  tournament?: string | { name?: string };
  startTime?: string | number;
  [key: string]: unknown;
}

interface XBetRawResponse {
  events?: XBetRawEvent[];
  data?: XBetRawEvent[] | { events?: XBetRawEvent[] };
  result?: XBetRawEvent[] | { events?: XBetRawEvent[] };
  matches?: XBetRawEvent[];
  [key: string]: unknown;
}

let _xbetIdCounter = 8_000_000;

function xbetNormalize(raw: XBetRawEvent, sportSlug: string): SofaEvent {
  const homeName = strOf(raw.homeTeam) || strOf(raw.home) || 'Home';
  const awayName = strOf(raw.awayTeam) || strOf(raw.away) || 'Away';
  const id = raw.id ? Number(raw.id) : ++_xbetIdCounter;

  let homeGoals: number | undefined;
  let awayGoals: number | undefined;

  // 1xbet commonly uses "1:0" colon-separated score format
  const scoreStr = typeof raw.score === 'string' ? raw.score : '';
  if (scoreStr && /^\d+[:]\d+$|^\d+-\d+$/.test(scoreStr)) {
    const sep = scoreStr.includes(':') ? ':' : '-';
    const parts = scoreStr.split(sep).map(Number);
    const h = parts[0];
    const a = parts[1];
    homeGoals = h !== undefined && !isNaN(h) ? h : undefined;
    awayGoals = a !== undefined && !isNaN(a) ? a : undefined;
  } else {
    homeGoals = parseScore(raw.homeScore);
    awayGoals = parseScore(raw.awayScore);
  }

  const statusStr = strOf(raw.status) || 'inprogress';
  const isFinished = /finish|ended|full.?time|ft|completed/i.test(statusStr);
  const isLive = !isFinished && !/not.?started|scheduled|tbd|upcoming/i.test(statusStr);

  const leagueName =
    strOf(raw.leagueName) ||
    strOf(raw.league) ||
    strOf(raw.tournament) ||
    'Unknown League';

  return {
    id,
    _source: 'allscores', // reuse allscores tag so live-pick filter skips form analysis
    sport: { name: sportSlug, slug: sportSlug },
    homeTeam: { id: 0, name: homeName },
    awayTeam: { id: 0, name: awayName },
    homeScore: homeGoals !== undefined ? { current: homeGoals } : undefined,
    awayScore: awayGoals !== undefined ? { current: awayGoals } : undefined,
    status: {
      code: isFinished ? 100 : isLive ? 6 : 0,
      description: statusStr,
      type: isFinished ? 'finished' : isLive ? 'inprogress' : 'notstarted',
    },
    tournament: { id: 0, name: leagueName },
  };
}

function extractXBetEvents(data: XBetRawResponse): XBetRawEvent[] {
  if (Array.isArray(data)) return data as XBetRawEvent[];
  if (Array.isArray(data.events)) return data.events;
  if (Array.isArray(data.matches)) return data.matches;
  if (data.data) {
    const d = data.data;
    if (Array.isArray(d)) return d;
    if (typeof d === 'object' && d !== null && 'events' in d) {
      const inner = d as { events?: XBetRawEvent[] };
      if (Array.isArray(inner.events)) return inner.events;
    }
  }
  if (data.result) {
    const r = data.result;
    if (Array.isArray(r)) return r;
    if (typeof r === 'object' && r !== null && 'events' in r) {
      const inner = r as { events?: XBetRawEvent[] };
      if (Array.isArray(inner.events)) return inner.events;
    }
  }
  return [];
}

export class XBetClient {
  private http: AxiosInstance;

  constructor(config: BotConfig) {
    const host = config.xbetApiHost ?? '1xbet12.p.rapidapi.com';
    const key = config.xbetApiKey ?? config.apiKey;

    this.http = axios.create({
      baseURL: `https://${host}`,
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-host': host,
        'x-rapidapi-key': key,
      },
      timeout: 10_000,
    });
  }

  async getLiveEvents(sport: string): Promise<SofaEvent[]> {
    const sportName = XBET_SPORT_NAMES[sport] ?? sport;
    // Try known 1xbet live endpoints in order
    const endpoints = [
      `/api/1xbet/v1/live/events?sport=${encodeURIComponent(sportName)}&lang=en`,
      `/api/1xbet/v1/matches/live?sport=${encodeURIComponent(sportName)}&lang=en`,
      `/api/1xbet/v1/live/livescores?sport=${encodeURIComponent(sportName)}&lang=en`,
      `/api/1xbet/v1/sport/live?sport=${encodeURIComponent(sportName)}&lang=en`,
    ];

    for (const endpoint of endpoints) {
      try {
        const res = await this.http.get<XBetRawResponse>(endpoint);
        const events = extractXBetEvents(res.data);
        if (events.length > 0) {
          return events
            .filter((e) => {
              const s = strOf(e.status);
              return /live|progress|half|quarter|period|playing/i.test(s) || !s;
            })
            .map((e) => xbetNormalize(e, sport));
        }
      } catch {
        // try next endpoint
      }
    }
    return [];
  }

  async getEventOdds(_eventId: number): Promise<OddsMarket[]> {
    return [];
  }
}
