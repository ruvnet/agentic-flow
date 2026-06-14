/**
 * Live research layer — fetches real-world data before every parlay is sent.
 * All sources are free / no-key-required (except OpenWeather which is optional).
 *
 * Sources:
 *   - MLB Stats API (official, free, no key)  → probable pitchers
 *   - ESPN news API (unofficial, free, no key) → injury/news headlines
 *   - OpenWeather API (free tier, key optional) → weather at outdoor stadiums
 */

export interface PitcherInfo {
  name: string;
  isConfirmed: boolean; // false = TBD, true = named starter
}

export interface WeatherRisk {
  condition: string;
  tempF: number;
  isRiskForGame: boolean; // true = rain / snow / thunderstorm
  summary: string;
}

export interface LegResearch {
  pitcher?: PitcherInfo;  // baseball legs only
  weather?: WeatherRisk;  // outdoor baseball stadiums only
  newsHeadlines: string[];
}

// ── MLB stadium → location lookup (outdoor flag determines weather check) ────

const MLB_STADIUMS: Record<string, { lat: number; lon: number; outdoor: boolean }> = {
  'New York Yankees':      { lat: 40.8296, lon: -73.9262, outdoor: true },
  'Boston Red Sox':        { lat: 42.3467, lon: -71.0972, outdoor: true },
  'Chicago Cubs':          { lat: 41.9484, lon: -87.6553, outdoor: true },
  'Chicago White Sox':     { lat: 41.8300, lon: -87.6339, outdoor: true },
  'Los Angeles Dodgers':   { lat: 34.0739, lon: -118.2400, outdoor: true },
  'Los Angeles Angels':    { lat: 33.8003, lon: -117.8827, outdoor: true },
  'San Francisco Giants':  { lat: 37.7786, lon: -122.3893, outdoor: true },
  'San Diego Padres':      { lat: 32.7076, lon: -117.1570, outdoor: true },
  'Philadelphia Phillies': { lat: 39.9061, lon: -75.1665, outdoor: true },
  'Pittsburgh Pirates':    { lat: 40.4469, lon: -80.0057, outdoor: true },
  'Cincinnati Reds':       { lat: 39.0979, lon: -84.5072, outdoor: true },
  'Cleveland Guardians':   { lat: 41.4962, lon: -81.6852, outdoor: true },
  'Detroit Tigers':        { lat: 42.3390, lon: -83.0485, outdoor: true },
  'Kansas City Royals':    { lat: 39.0517, lon: -94.4803, outdoor: true },
  'Minnesota Twins':       { lat: 44.9817, lon: -93.2781, outdoor: true },
  'Baltimore Orioles':     { lat: 39.2838, lon: -76.6217, outdoor: true },
  'New York Mets':         { lat: 40.7571, lon: -73.8458, outdoor: true },
  'Washington Nationals':  { lat: 38.8730, lon: -77.0074, outdoor: true },
  'St. Louis Cardinals':   { lat: 38.6226, lon: -90.1928, outdoor: true },
  'Colorado Rockies':      { lat: 39.7559, lon: -104.9942, outdoor: true },
  'Atlanta Braves':        { lat: 33.8907, lon: -84.4678, outdoor: true },
  'Oakland Athletics':     { lat: 36.1699, lon: -115.1398, outdoor: true },
  'Texas Rangers':         { lat: 32.7512, lon: -97.0832, outdoor: true },
  // Retractable / indoor — weather check skipped
  'Houston Astros':        { lat: 29.7572, lon: -95.3555, outdoor: false },
  'Seattle Mariners':      { lat: 47.5914, lon: -122.3326, outdoor: false },
  'Tampa Bay Rays':        { lat: 27.7682, lon: -82.6534, outdoor: false },
  'Toronto Blue Jays':     { lat: 43.6414, lon: -79.3894, outdoor: false },
  'Miami Marlins':         { lat: 25.7781, lon: -80.2197, outdoor: false },
  'Milwaukee Brewers':     { lat: 43.0280, lon: -87.9712, outdoor: false },
  'Arizona Diamondbacks':  { lat: 33.4453, lon: -112.0667, outdoor: false },
};

const ESPN_SPORT_SLUG: Record<string, string> = {
  baseball: 'baseball/mlb',
  basketball: 'basketball/nba',
  football: 'football/nfl',
  soccer: 'soccer/usa.1',
};

// ── helpers ──────────────────────────────────────────────────────────────────

async function safeFetch(url: string, timeoutMs = 6_000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Last word of team name, lowercase — "Chicago Cubs" → "cubs" */
function shortTeamName(name: string): string {
  return (name.split(' ').pop() ?? name).toLowerCase();
}

// ── MLB probable pitchers ────────────────────────────────────────────────────

export async function fetchMLBProbablePitchers(
  date: string // YYYY-MM-DD
): Promise<Map<string, PitcherInfo>> {
  const map = new Map<string, PitcherInfo>();
  try {
    const url =
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}` +
      `&hydrate=probablePitcher,team&fields=dates,games,teams,team,name,probablePitcher,fullName`;
    const data = (await safeFetch(url)) as Record<string, unknown>;
    const dates = (data?.dates as Array<{ games?: unknown[] }>) ?? [];
    const games = (dates[0]?.games ?? []) as Array<Record<string, unknown>>;

    for (const game of games) {
      const teams = game.teams as Record<string, { team?: { name?: string }; probablePitcher?: { fullName?: string } }> | undefined;
      if (!teams) continue;
      for (const side of ['home', 'away'] as const) {
        const teamName = teams[side]?.team?.name;
        const pitcherName = teams[side]?.probablePitcher?.fullName;
        if (teamName) {
          map.set(teamName.toLowerCase(), {
            name: pitcherName ?? 'TBD',
            isConfirmed: !!pitcherName && pitcherName !== 'TBD',
          });
        }
      }
    }
  } catch (err) {
    console.warn(`[Research] MLB pitchers fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return map;
}

// ── OpenWeather ──────────────────────────────────────────────────────────────

export async function fetchWeather(
  teamName: string,
  apiKey: string,
): Promise<WeatherRisk | undefined> {
  const stadium = MLB_STADIUMS[teamName];
  if (!stadium?.outdoor) return undefined;

  try {
    const url =
      `https://api.openweathermap.org/data/2.5/weather` +
      `?lat=${stadium.lat}&lon=${stadium.lon}&appid=${apiKey}&units=imperial`;
    const data = (await safeFetch(url)) as Record<string, unknown>;
    const weatherArr = (data?.weather as Array<{ main?: string; description?: string }>) ?? [];
    const main = weatherArr[0]?.main ?? '';
    const desc = weatherArr[0]?.description ?? main;
    const tempF = Math.round((data?.main as { temp?: number })?.temp ?? 70);
    const risky = /rain|thunderstorm|snow|sleet|drizzle|hail/i.test(main + ' ' + desc);
    return {
      condition: desc || main,
      tempF,
      isRiskForGame: risky,
      summary: risky
        ? `⚠️ ${desc} ${tempF}°F — WEATHER RISK`
        : `☀️ ${desc || main} ${tempF}°F — OK`,
    };
  } catch {
    return undefined;
  }
}

// ── ESPN news / injury headlines ─────────────────────────────────────────────

export async function fetchESPNHeadlines(
  sport: string,
  teamName: string,
): Promise<string[]> {
  const slug = ESPN_SPORT_SLUG[sport.toLowerCase()] ?? 'baseball/mlb';
  const short = shortTeamName(teamName);
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${slug}/news?limit=30`;
    const data = (await safeFetch(url)) as Record<string, unknown>;
    const articles = (data?.articles as Array<{ headline?: string; description?: string }>) ?? [];
    return articles
      .filter((a) => {
        const text = `${a.headline ?? ''} ${a.description ?? ''}`.toLowerCase();
        return text.includes(short);
      })
      .slice(0, 2)
      .map((a) => a.headline ?? '')
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function researchLeg(
  teamName: string,
  sport: string,
  pitcherMap: Map<string, PitcherInfo>,
  weatherApiKey?: string,
): Promise<LegResearch> {
  const isMlb = /baseball/i.test(sport);

  const [news, weather] = await Promise.all([
    fetchESPNHeadlines(sport, teamName),
    isMlb && weatherApiKey ? fetchWeather(teamName, weatherApiKey) : Promise.resolve(undefined),
  ]);

  return {
    pitcher: isMlb ? pitcherMap.get(teamName.toLowerCase()) : undefined,
    weather,
    newsHeadlines: news,
  };
}
