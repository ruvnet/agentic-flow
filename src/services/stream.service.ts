import type { Event } from '../types/betting';

const API_KEY = import.meta.env.VITE_RAPIDAPI_KEY as string;
const HOST = (import.meta.env.VITE_STREAM_HOST as string) || 'all-sport-live-stream.p.rapidapi.com';
const BASE = `https://${HOST}`;

const headers = (): Record<string, string> => ({
  'x-rapidapi-host': HOST,
  'x-rapidapi-key': API_KEY,
});

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface StreamLink {
  url: string;
  quality?: string;
  name?: string;
}

export interface LiveEvent extends Event {
  streams: StreamLink[];
  thumbnail?: string;
}

// ─── Response normaliser ───────────────────────────────────────────────────────

function unwrapArray(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    for (const key of ['data', 'result', 'results', 'events', 'streams', 'matches', 'live']) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  return [];
}

function parseStreams(raw: unknown): StreamLink[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return (arr as Record<string, unknown>[])
    .filter(s => s.url || s.link || s.stream || s.src)
    .map(s => ({
      url: String(s.url ?? s.link ?? s.stream ?? s.src ?? ''),
      quality: s.quality ? String(s.quality) : s.hd ? 'HD' : undefined,
      name: s.name ? String(s.name) : s.channel ? String(s.channel) : undefined,
    }));
}

function normaliseLiveEvent(r: Record<string, unknown>): LiveEvent {
  const id = String(r.id ?? r.eventId ?? r.event_id ?? r.matchId ?? r.match_id ?? Math.random());
  const title = String(r.title ?? r.name ?? r.match ?? r.event ?? '');
  let home = String(r.home ?? r.homeTeam ?? r.home_team ?? r.team1 ?? '');
  let away = String(r.away ?? r.awayTeam ?? r.away_team ?? r.team2 ?? '');

  // If only a "title" field like "Arsenal vs Chelsea" — split on vs
  if (!home && !away && title) {
    const parts = title.split(/\s+vs\.?\s+/i);
    home = parts[0]?.trim() ?? title;
    away = parts[1]?.trim() ?? '';
  }

  const sport = String(r.sport ?? r.sportName ?? r.sport_name ?? r.category ?? 'football').toLowerCase();
  const league = String(r.league ?? r.leagueName ?? r.competition ?? r.tournament ?? r.category ?? '');
  const rawTime = r.startTime ?? r.start_time ?? r.time ?? r.date ?? r.kickoff ?? '';
  const startTime = rawTime ? new Date(String(rawTime)).toISOString() : new Date().toISOString();
  const streams = parseStreams(r.streams ?? r.streamLinks ?? r.links ?? r.urls);
  const thumbnail = r.thumbnail ? String(r.thumbnail) : r.image ? String(r.image) : undefined;

  return {
    eventId: id,
    sport,
    league,
    home: home || 'Home',
    away: away || 'Away',
    startTime,
    status: 'live',
    streams,
    thumbnail,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

const LIVE_PATHS = [
  '/api/v2/br/all-live-stream',
  '/api/v2/all-live-stream',
  '/api/v1/all-live-stream',
  '/api/live',
  '/live',
];

export async function fetchLiveStreams(): Promise<LiveEvent[]> {
  for (const path of LIVE_PATHS) {
    try {
      const res = await fetch(`${BASE}${path}`, { method: 'GET', headers: headers() });
      if (!res.ok) continue;
      const json = await res.json() as unknown;
      const arr = unwrapArray(json);
      if (arr.length > 0) {
        return (arr as Record<string, unknown>[]).map(normaliseLiveEvent);
      }
    } catch {
      // try next
    }
  }
  return [];
}

export async function testStreamAPI(): Promise<string> {
  const lines = [`HOST: ${HOST}`, ''];
  const paths = [
    '/api/v2/br/all-live-stream',
    '/api/v2/all-live-stream',
    '/api/v1/all-live-stream',
    '/api/live',
    '/live',
    '/',
  ];
  for (const path of paths) {
    try {
      const res = await fetch(`${BASE}${path}`, { method: 'GET', headers: headers() });
      const body = await res.text().catch(() => '');
      const icon = res.ok ? '✅' : res.status === 429 ? '⚡quota' : '❌';
      lines.push(`${icon} ${path}\n   ${res.status}  ${body.slice(0, 120)}`);
    } catch (e) {
      lines.push(`❌ ${path}\n   ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return lines.join('\n\n');
}
