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

// sport=soccer returns plain 404 — try alternate names/IDs the API may recognise
const SPORT_VARIANTS: Record<SportKey, string[]> = {
  soccer: ['football', 'soccer', '1'],
  basketball: ['basketball', '18', '2'],
};

/**
 * Try multiple endpoint + sport-name variants in sequence.
 * Returns the first successful response.
 */
export async function fetchEvents(sport: SportKey, league?: string): Promise<Event[]> {
  const variants = SPORT_VARIANTS[sport];
  const paths: string[] = [];

  if (league) {
    for (const v of variants) {
      paths.push(`/v2/events?sport=${v}&league=${encodeURIComponent(league)}`);
    }
  } else {
    // No-param first — may return all upcoming events
    paths.push('/v2/events');
    for (const v of variants) {
      paths.push(`/v2/events?sport=${v}`);
      paths.push(`/v2/events?sportId=${v}`);
    }
  }

  const errors: string[] = [];

  for (const path of paths) {
    try {
      const url = `${BASE_URL}${path}`;
      const res = await fetch(url, { method: 'GET', headers: getHeaders() });
      if (!res.ok) {
        const body = await res.text().catch(() => '(no body)');
        const truncated = body.length > 150 ? `${body.slice(0, 150)}…` : body;
        errors.push(`${path} → ${res.status}: ${truncated}`);
        continue;
      }
      const json = (await res.json()) as { data?: Event[] } & Event[];
      return (json.data ?? json) as Event[];
    } catch (e) {
      errors.push(`${path} → ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  throw new Error(errors.map((e, i) => `[${i + 1}] ${e}`).join('\n'));
}

/**
 * Test the events endpoint with every variant and return full raw responses.
 * This is the debug tool — shows which paths work and what they return.
 */
export async function testConnection(): Promise<string> {
  const lines: string[] = [];
  const testPaths = [
    '/v2/events',
    '/v2/events?sport=football',
    '/v2/events?sport=soccer',
    '/v2/events?sportId=1',
    '/v2/odds?eventId=1607251724&bookmakers=Bet365',
  ];
  for (const path of testPaths) {
    const url = `${BASE_URL}${path}`;
    try {
      const res = await fetch(url, { method: 'GET', headers: getHeaders() });
      const body = await res.text().catch(() => '(no body)');
      const truncated = body.length > 200 ? `${body.slice(0, 200)}…` : body;
      lines.push(`${path}\n  → ${res.status} ${res.statusText}\n  ${truncated}`);
    } catch (e) {
      lines.push(`${path}\n  → ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return lines.join('\n\n');
}
