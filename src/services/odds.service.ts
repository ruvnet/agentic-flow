import type { OddsResponse, Event } from '../types/betting';

const API_KEY = import.meta.env.VITE_RAPIDAPI_KEY as string;
const API_HOST = import.meta.env.VITE_RAPIDAPI_HOST as string;
const BASE_URL = `https://${API_HOST}`;

const BOOKMAKERS = 'Bet365,Pinnacle,Betfair Sportsbook,Betfair Exchange,Betsson,1xbet';

const headers = {
  'Content-Type': 'application/json',
  'x-rapidapi-host': API_HOST,
  'x-rapidapi-key': API_KEY,
};

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  const json = await res.json() as { data: T };
  return json.data;
}

export async function fetchOdds(eventId: string): Promise<OddsResponse> {
  return apiFetch<OddsResponse>(
    `/v2/odds?eventId=${eventId}&bookmakers=${encodeURIComponent(BOOKMAKERS)}`
  );
}

export async function fetchEvents(sport: 'soccer' | 'basketball', league?: string): Promise<Event[]> {
  const query = league ? `sport=${sport}&league=${league}` : `sport=${sport}`;
  return apiFetch<Event[]>(`/v2/events?${query}`);
}

export async function fetchLiveEvents(): Promise<Event[]> {
  return apiFetch<Event[]>('/v2/live/events');
}
