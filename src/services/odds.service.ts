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

/**
 * Test many path variants to discover which endpoint structure this API uses.
 * Shows status, rate-limit header (confirms key validity), and response body.
 */
export async function testConnection(): Promise<string> {
  const lines: string[] = [];

  // First: check key validity with a single request and show headers
  const probeUrl = `${BASE_URL}/`;
  try {
    const probe = await fetch(probeUrl, { method: 'GET', headers: getHeaders() });
    const remaining = probe.headers.get('x-ratelimit-requests-remaining');
    const limit = probe.headers.get('x-ratelimit-requests-limit');
    lines.push(
      `KEY CHECK: ${remaining !== null ? `✅ valid (${remaining}/${limit ?? '?'} requests remaining)` : '⚠️  no rate-limit header — key may be invalid or not subscribed'}`,
    );
  } catch {
    lines.push('KEY CHECK: ❌ network error');
  }

  lines.push('');

  const testPaths = [
    // Root — tells us the server is alive
    '/',
    // Version-prefixed sport-resource paths
    '/v2/sports',
    '/v1/sports',
    '/sports',
    // Version-prefixed events
    '/v2/events',
    '/v1/events',
    '/events',
    // Sport-nested events (The Odds API / odds-api.io style)
    '/v4/sports',
    '/v4/sports/soccer_epl/odds',
    '/v2/sports/soccer/events',
    '/v2/sports/football/events',
    '/v2/sports/basketball/events',
    // BetsAPI style
    '/v2/events/upcoming',
    '/v3/events',
    // Odds with known event
    '/v2/odds?eventId=1607251724&bookmakers=Bet365',
    '/v1/odds?eventId=1607251724',
  ];

  for (const path of testPaths) {
    const url = `${BASE_URL}${path}`;
    try {
      const res = await fetch(url, { method: 'GET', headers: getHeaders() });
      const body = await res.text().catch(() => '(no body)');
      const truncated = body.length > 150 ? `${body.slice(0, 150)}…` : body;
      const icon = res.ok ? '✅' : res.status === 401 || res.status === 403 ? '🔑' : '❌';
      lines.push(`${icon} ${path}\n   → ${res.status} ${res.statusText}\n   ${truncated}`);
    } catch (e) {
      lines.push(`❌ ${path}\n   → ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return lines.join('\n\n');
}
