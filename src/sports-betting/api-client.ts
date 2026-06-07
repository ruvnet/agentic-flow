import axios, { AxiosInstance } from 'axios';
import type {
  BotConfig,
  SofaEvent,
  OddsMarket,
  AllScoresRawResponse,
  AllScoresRawMatch,
} from './types.js';
import { ALLSCORES_SPORT_IDS } from './types.js';

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
