/**
 * Live research layer — fetches real-world data before every parlay is sent.
 * All sources are free / no-key-required (except OpenWeather which is optional).
 *
 * Sources:
 *   - MLB Stats API (official, free, no key)  → probable pitchers
 *   - ESPN Site API (free, no key)            → team records, last-5 form, back-to-back
 *   - ESPN News API (free, no key)            → injury/news headlines (all sports)
 *   - OpenWeather API (free tier, key opt.)   → weather at outdoor MLB + NFL stadiums
 */

export interface PitcherInfo {
  name: string;
  isConfirmed: boolean;
}

export interface WeatherRisk {
  condition: string;
  tempF: number;
  isRiskForGame: boolean;
  summary: string;
}

export interface TeamForm {
  record: string;   // season W-L, e.g. "34-18"
  last5: string;    // e.g. "W W L W W"
  streak: string;   // e.g. "W3" or "L2"
}

export interface LegResearch {
  pitcher?: PitcherInfo;     // baseball only
  weather?: WeatherRisk;     // outdoor MLB/NFL stadiums only
  newsHeadlines: string[];   // injury / roster news (all sports)
  form?: TeamForm;           // season record + last 5 games (all sports)
  isBackToBack?: boolean;    // NBA only — played last night
}

// ── Outdoor stadium coordinates (omit dome/retractable = no weather check) ──

const OUTDOOR_STADIUMS: Record<string, { lat: number; lon: number }> = {
  // MLB outdoor
  'New York Yankees':       { lat: 40.8296, lon: -73.9262 },
  'Boston Red Sox':         { lat: 42.3467, lon: -71.0972 },
  'Chicago Cubs':           { lat: 41.9484, lon: -87.6553 },
  'Chicago White Sox':      { lat: 41.8300, lon: -87.6339 },
  'Los Angeles Dodgers':    { lat: 34.0739, lon: -118.2400 },
  'Los Angeles Angels':     { lat: 33.8003, lon: -117.8827 },
  'San Francisco Giants':   { lat: 37.7786, lon: -122.3893 },
  'San Diego Padres':       { lat: 32.7076, lon: -117.1570 },
  'Philadelphia Phillies':  { lat: 39.9061, lon: -75.1665 },
  'Pittsburgh Pirates':     { lat: 40.4469, lon: -80.0057 },
  'Cincinnati Reds':        { lat: 39.0979, lon: -84.5072 },
  'Cleveland Guardians':    { lat: 41.4962, lon: -81.6852 },
  'Detroit Tigers':         { lat: 42.3390, lon: -83.0485 },
  'Kansas City Royals':     { lat: 39.0517, lon: -94.4803 },
  'Minnesota Twins':        { lat: 44.9817, lon: -93.2781 },
  'Baltimore Orioles':      { lat: 39.2838, lon: -76.6217 },
  'New York Mets':          { lat: 40.7571, lon: -73.8458 },
  'Washington Nationals':   { lat: 38.8730, lon: -77.0074 },
  'St. Louis Cardinals':    { lat: 38.6226, lon: -90.1928 },
  'Colorado Rockies':       { lat: 39.7559, lon: -104.9942 },
  'Atlanta Braves':         { lat: 33.8907, lon: -84.4678 },
  'Oakland Athletics':      { lat: 36.1699, lon: -115.1398 },
  'Texas Rangers':          { lat: 32.7512, lon: -97.0832 },
  // NFL outdoor (domes / retractable-roof stadiums omitted)
  'Buffalo Bills':          { lat: 42.7738, lon: -78.7870 },
  'New England Patriots':   { lat: 42.0909, lon: -71.2643 },
  'New York Jets':          { lat: 40.8135, lon: -74.0744 },
  'New York Giants':        { lat: 40.8135, lon: -74.0744 },
  'Baltimore Ravens':       { lat: 39.2780, lon: -76.6227 },
  'Pittsburgh Steelers':    { lat: 40.4468, lon: -80.0158 },
  'Cleveland Browns':       { lat: 41.5061, lon: -81.6995 },
  'Cincinnati Bengals':     { lat: 39.0954, lon: -84.5161 },
  'Jacksonville Jaguars':   { lat: 30.3240, lon: -81.6373 },
  'Tennessee Titans':       { lat: 36.1665, lon: -86.7713 },
  'Green Bay Packers':      { lat: 44.5013, lon: -88.0622 },
  'Chicago Bears':          { lat: 41.8623, lon: -87.6167 },
  'Kansas City Chiefs':     { lat: 39.0489, lon: -94.4839 },
  'Denver Broncos':         { lat: 39.7439, lon: -105.0201 },
  'Seattle Seahawks':       { lat: 47.5952, lon: -122.3316 },
  'San Francisco 49ers':    { lat: 37.4033, lon: -121.9700 },
  'Philadelphia Eagles':    { lat: 39.9008, lon: -75.1675 },
  'Washington Commanders':  { lat: 38.9077, lon: -76.8645 },
  'Carolina Panthers':      { lat: 35.2258, lon: -80.8528 },
  'Tampa Bay Buccaneers':   { lat: 27.9759, lon: -82.5033 },
};

// ── ESPN API slugs per sport ─────────────────────────────────────────────────

const ESPN_API: Record<string, { sport: string; league: string }> = {
  baseball:          { sport: 'baseball',    league: 'mlb'   },
  basketball:        { sport: 'basketball',  league: 'nba'   },
  'american-football': { sport: 'football', league: 'nfl'   },
  football:          { sport: 'soccer',      league: 'usa.1' }, // "football" = soccer in bot
  soccer:            { sport: 'soccer',      league: 'usa.1' },
};

const ESPN_NEWS_SLUG: Record<string, string> = {
  baseball:            'baseball/mlb',
  basketball:          'basketball/nba',
  'american-football': 'football/nfl',
  football:            'soccer/usa.1',
  soccer:              'soccer/usa.1',
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

function shortTeamName(name: string): string {
  return (name.split(' ').pop() ?? name).toLowerCase();
}

/** Return YYYYMMDD string for N days ago (used by ESPN scoreboard dates param). */
function espnDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');
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
      const teams = game.teams as Record<string, {
        team?: { name?: string };
        probablePitcher?: { fullName?: string };
      }> | undefined;
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

// ── ESPN team season record (W-L) ────────────────────────────────────────────

async function fetchTeamRecord(sport: string, teamName: string): Promise<string> {
  const cfg = ESPN_API[sport.toLowerCase()];
  if (!cfg) return '';
  const short = shortTeamName(teamName);
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}/teams`;
    const data = (await safeFetch(url, 5_000)) as Record<string, unknown>;
    const sports = (data?.sports as Array<{
      leagues?: Array<{ teams?: Array<{ team?: Record<string, unknown> }> }>;
    }>) ?? [];
    const teams = sports[0]?.leagues?.[0]?.teams ?? [];
    const match = teams.find((t) => {
      const n = String(t.team?.displayName ?? t.team?.name ?? '').toLowerCase();
      return n.includes(short) || n.includes(teamName.toLowerCase());
    });
    const items = (match?.team?.record as { items?: Array<{ summary?: string }> })?.items ?? [];
    return items[0]?.summary ?? '';
  } catch {
    return '';
  }
}

// ── ESPN recent form (last 5 results) ───────────────────────────────────────

async function fetchRecentForm(sport: string, teamName: string): Promise<TeamForm | undefined> {
  const cfg = ESPN_API[sport.toLowerCase()];
  if (!cfg) return undefined;
  const short = shortTeamName(teamName);

  // Fetch last 7 days of scoreboard + season record all in parallel
  const scoreboardUrls = Array.from({ length: 7 }, (_, i) =>
    `https://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}/scoreboard?dates=${espnDate(i + 1)}`
  );

  const [recordRes, ...scoreboardRes] = await Promise.allSettled([
    fetchTeamRecord(sport, teamName),
    ...scoreboardUrls.map((url) => safeFetch(url, 4_000)),
  ]);

  const record = recordRes.status === 'fulfilled' ? String(recordRes.value ?? '') : '';

  const results: Array<'W' | 'L'> = [];
  for (const res of scoreboardRes) {
    if (res.status !== 'fulfilled') continue;
    const data = res.value as Record<string, unknown>;
    const events = (data?.events as Array<Record<string, unknown>>) ?? [];
    for (const event of events) {
      type Competitor = { winner?: boolean; team?: { displayName?: string; name?: string } };
      const comps = (event.competitions as Array<{ competitors?: Competitor[] }>)?.[0]?.competitors ?? [];
      const found = comps.find((c) => {
        const n = `${c.team?.displayName ?? ''} ${c.team?.name ?? ''}`.toLowerCase();
        return n.includes(short) || n.includes(teamName.toLowerCase());
      });
      if (found !== undefined) {
        results.push(found.winner ? 'W' : 'L');
        break;
      }
    }
  }

  if (results.length === 0 && !record) return undefined;

  const last5 = results.slice(0, 5).join(' ');
  const dir = results[0];
  let streakCount = 0;
  if (dir) {
    for (const r of results) {
      if (r !== dir) break;
      streakCount++;
    }
  }
  const streak = dir ? `${dir}${streakCount}` : '';

  return { record, last5, streak };
}

// ── NBA back-to-back detection ────────────────────────────────────────────────

async function checkNBABackToBack(teamName: string): Promise<boolean> {
  const short = shortTeamName(teamName);
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${espnDate(1)}`;
    const data = (await safeFetch(url, 5_000)) as Record<string, unknown>;
    const events = (data?.events as Array<Record<string, unknown>>) ?? [];
    return events.some((event) => {
      type Competitor = { team?: { displayName?: string; name?: string } };
      const comps = (event.competitions as Array<{ competitors?: Competitor[] }>)?.[0]?.competitors ?? [];
      return comps.some((c) => {
        const n = `${c.team?.displayName ?? ''} ${c.team?.name ?? ''}`.toLowerCase();
        return n.includes(short) || n.includes(teamName.toLowerCase());
      });
    });
  } catch {
    return false;
  }
}

// ── Weather (MLB + NFL outdoor venues) ──────────────────────────────────────

export async function fetchWeather(
  teamName: string,
  apiKey: string,
): Promise<WeatherRisk | undefined> {
  const stadium = OUTDOOR_STADIUMS[teamName];
  if (!stadium) return undefined;

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

// ── ESPN injury / news headlines ─────────────────────────────────────────────

export async function fetchESPNHeadlines(
  sport: string,
  teamName: string,
): Promise<string[]> {
  const slug = ESPN_NEWS_SLUG[sport.toLowerCase()] ?? 'baseball/mlb';
  const short = shortTeamName(teamName);
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${slug}/news?limit=30`;
    const data = (await safeFetch(url)) as Record<string, unknown>;
    const articles = (data?.articles as Array<{ headline?: string; description?: string }>) ?? [];
    return articles
      .filter((a) => {
        const text = `${a.headline ?? ''} ${a.description ?? ''}`.toLowerCase();
        return text.includes(short) || text.includes(teamName.toLowerCase());
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
  const sportLower = sport.toLowerCase();
  const isMlb = /baseball/i.test(sportLower);
  const isNba = /basketball/i.test(sportLower);
  const isNfl = /american.?football/i.test(sportLower);
  const needsWeather = (isMlb || isNfl) && !!weatherApiKey;

  const [news, weather, form, isBackToBack] = await Promise.all([
    fetchESPNHeadlines(sport, teamName),
    needsWeather ? fetchWeather(teamName, weatherApiKey!) : Promise.resolve(undefined),
    fetchRecentForm(sport, teamName),
    isNba ? checkNBABackToBack(teamName) : Promise.resolve(false),
  ]);

  return {
    pitcher: isMlb ? pitcherMap.get(teamName.toLowerCase()) : undefined,
    weather,
    newsHeadlines: news,
    form: form ?? undefined,
    isBackToBack: isNba ? isBackToBack : undefined,
  };
}
