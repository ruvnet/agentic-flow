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

/**
 * Try multiple endpoint variants in sequence; return the first that succeeds.
 * If all fail, throw an error listing every path and its status code.
 */
export async function fetchEvents(sport: SportKey, league?: string): Promise<Event[]> {
  const paths = league
    ? [`/v2/events?sport=${sport}&league=${encodeURIComponent(league)}`]
    : [
        `/v2/events?sport=${sport}`,
        `/v2/${sport}/events`,
        `/v2/fixtures?sport=${sport}`,
        `/v2/upcoming?sport=${sport}`,
      ];

  const errors: string[] = [];

  for (const path of paths) {
    try {
      const url = `${BASE_URL}${path}`;
      const res = await fetch(url, { method: 'GET', headers: getHeaders() });
      if (!res.ok) {
        const body = await res.text().catch(() => '(no body)');
        const truncated = body.length > 200 ? `${body.slice(0, 200)}…` : body;
        errors.push(`${path} → ${res.status} ${res.statusText}: ${truncated}`);
        continue;
      }
      const json = (await res.json()) as { data?: Event[] } & Event[];
      return (json.data ?? json) as Event[];
    } catch (e) {
      errors.push(`${path} → ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  throw new Error(
    `All event endpoints failed:\n${errors.map((e, i) => `[${i + 1}] ${e}`).join('\n')}`
  );
}

/**
 * Fetch events filtered by league.
 */
export async function fetchEventsByLeague(sport: SportKey, league: string): Promise<Event[]> {
  const path = `/v2/events?sport=${sport}&league=${encodeURIComponent(league)}`;
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { method: 'GET', headers: getHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => '(no body)');
    const truncated = body.length > 300 ? `${body.slice(0, 300)}…` : body;
    throw new Error(`API ${res.status} ${res.statusText}: ${truncated}`);
  }
  const json = (await res.json()) as { data?: Event[] } & Event[];
  return (json.data ?? json) as Event[];
}

/**
 * Test the connection by fetching a known event and returning raw JSON.
 */
export async function testConnection(): Promise<string> {
  const url = `${BASE_URL}/v2/odds?eventId=1607251724&bookmakers=Bet365`;
  const res = await fetch(url, { method: 'GET', headers: getHeaders() });
  const body = await res.text().catch(() => '(no body)');
  return `HTTP ${res.status} ${res.statusText}\n\n${body}`;
}
