import type { OddsResponse, Event, SportKey } from '../types/betting';

const API_KEY = import.meta.env.VITE_RAPIDAPI_KEY as string;
const API_HOST = import.meta.env.VITE_RAPIDAPI_HOST as string;
const BASE_URL = `https://${API_HOST}`;

const BOOKMAKERS = 'Bet365,Pinnacle,Betfair Sportsbook,Betfair Exchange,Betsson,1xbet';

// No Content-Type on GET — it triggers a CORS preflight and is wrong for GET requests
const getHeaders = (): Record<string, string> => ({
  'x-rapidapi-host': API_HOST,
  'x-rapidapi-key': API_KEY,
});

async function apiFetch<T>(path: string): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { method: 'GET', headers: getHeaders() });

  if (!res.ok) {
    const body = await res.text().catch(() => '(no body)');
    const truncated = body.length > 300 ? `${body.slice(0, 300)}…` : body;
    throw new Error(`API ${res.status} ${res.statusText}: ${truncated}`);
  }

  const json = (await res.json()) as { data?: T } & T;
  // Handle both wrapped { data: T } and flat T responses
  return (json.data ?? json) as T;
}

export async function fetchOdds(eventId: string): Promise<OddsResponse> {
  const bms = encodeURIComponent(BOOKMAKERS);
  return apiFetch<OddsResponse>(`/v2/odds?eventId=${eventId}&bookmakers=${bms}`);
}

// Confirmed valid sport names for this API (v2 endpoints only)
const SPORT_NAMES: Record<SportKey, string> = {
  soccer: 'soccer',
  basketball: 'basketball',
};

export async function fetchEvents(sport: SportKey, league?: string): Promise<Event[]> {
  const sportName = SPORT_NAMES[sport];
  const path = league
    ? `/v2/events?sport=${sportName}&league=${encodeURIComponent(league)}`
    : `/v2/events?sport=${sportName}`;

  return apiFetch<Event[]>(path);
}

export async function testConnection(): Promise<string> {
  const lines: string[] = [`OLD ODDS API (${API_HOST})`, ''];

  // Key check
  try {
    const probe = await fetch(`${BASE_URL}/`, { method: 'GET', headers: getHeaders() });
    const remaining = probe.headers.get('x-ratelimit-requests-remaining');
    const limit = probe.headers.get('x-ratelimit-requests-limit');
    lines.push(
      `KEY: ${remaining !== null ? `✅ ${remaining}/${limit ?? '?'} requests left` : '⚠️  no rate-limit header'}`,
    );
  } catch {
    lines.push('KEY: ❌ network error');
  }

  for (const path of ['/v2/events?sport=soccer', '/v2/odds?eventId=1']) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, { method: 'GET', headers: getHeaders() });
      const body = await res.text().catch(() => '');
      const icon = res.ok ? '✅' : res.status === 429 ? '⚡quota' : '❌';
      lines.push(`${icon} ${path}  →  ${res.status}  ${body.slice(0, 80)}`);
    } catch (e) {
      lines.push(`❌ ${path}  →  ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return lines.join('\n');
}
