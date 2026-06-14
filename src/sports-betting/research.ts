/**
 * Live research layer — fetches real-world data before every parlay is sent.
 * All sources are free / no-key-required (except OpenWeather which is optional).
 *
 * Sources:
 *   - MLB Stats API (official, free, no key)  → probable pitchers
 *   - ESPN Site API (free, no key)            → team records, last-5 form, back-to-back
 *   - ESPN News API (free, no key)            → injury/news headlines (all sports)
 *   - OpenWeather API (free tier, key opt.)   → weather at all outdoor stadiums
 *                                               (MLB, NFL, Premier League, La Liga,
 *                                                Serie A, Bundesliga, Ligue 1, MLS)
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
  weather?: WeatherRisk;     // outdoor venues only (MLB/NFL/soccer)
  newsHeadlines: string[];   // injury / roster news (all sports)
  form?: TeamForm;           // season record + last 5 games (all sports)
  isBackToBack?: boolean;    // NBA only — played last night
}

// ── Outdoor stadium coordinates ──────────────────────────────────────────────
// Dome / retractable-roof venues are OMITTED — fetchWeather returns undefined for
// any team not present in this table, so those get no weather check.

const OUTDOOR_STADIUMS: Record<string, { lat: number; lon: number }> = {
  // ── MLB ──────────────────────────────────────────────────────────────────
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

  // ── NFL (outdoor / open-air stadiums only) ───────────────────────────────
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

  // ── Premier League ───────────────────────────────────────────────────────
  'Arsenal':                { lat: 51.5549, lon: -0.1084 },
  'Aston Villa':            { lat: 52.5090, lon: -1.8847 },
  'Bournemouth':            { lat: 50.7352, lon: -1.8381 },
  'Brentford':              { lat: 51.4882, lon: -0.3087 },
  'Brighton':               { lat: 50.8618, lon: -0.0837 },
  'Chelsea':                { lat: 51.4817, lon: -0.1910 },
  'Crystal Palace':         { lat: 51.3983, lon: -0.0855 },
  'Everton':                { lat: 53.4389, lon: -2.9661 },
  'Fulham':                 { lat: 51.4749, lon: -0.2217 },
  'Ipswich':                { lat: 52.0553, lon: 1.1450 },
  'Leicester':              { lat: 52.6204, lon: -1.1422 },
  'Liverpool':              { lat: 53.4308, lon: -2.9608 },
  'Manchester City':        { lat: 53.4831, lon: -2.2004 },
  'Manchester United':      { lat: 53.4631, lon: -2.2913 },
  'Newcastle':              { lat: 54.9754, lon: -1.6217 },
  'Nottingham Forest':      { lat: 52.9400, lon: -1.1323 },
  'Southampton':            { lat: 50.9058, lon: -1.3914 },
  'Tottenham':              { lat: 51.6042, lon: -0.0665 },
  'West Ham':               { lat: 51.5387, lon: 0.0164 },
  'Wolves':                 { lat: 52.5900, lon: -2.1303 },

  // ── La Liga ──────────────────────────────────────────────────────────────
  'Real Madrid':            { lat: 40.4531, lon: -3.6883 },
  'Barcelona':              { lat: 41.3809, lon: 2.1228 },
  'Atletico Madrid':        { lat: 40.4361, lon: -3.5995 },
  'Sevilla':                { lat: 37.3841, lon: -5.9705 },
  'Valencia':               { lat: 39.4745, lon: -0.3583 },
  'Athletic Bilbao':        { lat: 43.2640, lon: -2.9494 },
  'Real Sociedad':          { lat: 43.3015, lon: -1.9735 },
  'Villarreal':             { lat: 39.9445, lon: -0.1036 },
  'Real Betis':             { lat: 37.3562, lon: -5.9820 },
  'Osasuna':                { lat: 42.7969, lon: -1.6367 },
  'Getafe':                 { lat: 40.3255, lon: -3.7186 },
  'Girona':                 { lat: 41.9646, lon: 2.8175 },
  'Las Palmas':             { lat: 28.1000, lon: -15.4333 },
  'Mallorca':               { lat: 39.5898, lon: 2.6640 },
  'Rayo Vallecano':         { lat: 40.3920, lon: -3.6567 },

  // ── Serie A ──────────────────────────────────────────────────────────────
  'Juventus':               { lat: 45.1096, lon: 7.6414 },
  'AC Milan':               { lat: 45.4781, lon: 9.1239 },
  'Inter Milan':            { lat: 45.4781, lon: 9.1239 },
  'Napoli':                 { lat: 40.8279, lon: 14.1932 },
  'Roma':                   { lat: 41.9342, lon: 12.4547 },
  'Lazio':                  { lat: 41.9342, lon: 12.4547 },
  'Fiorentina':             { lat: 43.7802, lon: 11.2822 },
  'Atalanta':               { lat: 45.7092, lon: 9.6734 },
  'Bologna':                { lat: 44.4924, lon: 11.3095 },
  'Torino':                 { lat: 45.0400, lon: 7.6538 },
  'Monza':                  { lat: 45.6167, lon: 9.2833 },
  'Udinese':                { lat: 46.0818, lon: 13.2044 },

  // ── Bundesliga ───────────────────────────────────────────────────────────
  'Bayern Munich':          { lat: 48.2188, lon: 11.6247 },
  'Borussia Dortmund':      { lat: 51.4926, lon: 7.4518 },
  'RB Leipzig':             { lat: 51.3456, lon: 12.3484 },
  'Bayer Leverkusen':       { lat: 51.0378, lon: 7.0022 },
  'Eintracht Frankfurt':    { lat: 50.0692, lon: 8.6451 },
  'Freiburg':               { lat: 48.0221, lon: 7.8327 },
  'Union Berlin':           { lat: 52.4573, lon: 13.5676 },
  'Wolfsburg':              { lat: 52.4325, lon: 10.8024 },
  'Borussia Mönchengladbach': { lat: 51.1743, lon: 6.3852 },
  'Werder Bremen':          { lat: 53.0663, lon: 8.8375 },
  'VfB Stuttgart':          { lat: 48.7922, lon: 9.2319 },
  'Augsburg':               { lat: 48.3241, lon: 10.8858 },

  // ── Ligue 1 ──────────────────────────────────────────────────────────────
  'Paris Saint-Germain':    { lat: 48.8414, lon: 2.2530 },
  'PSG':                    { lat: 48.8414, lon: 2.2530 },
  'Marseille':              { lat: 43.2697, lon: 5.3959 },
  'Lyon':                   { lat: 45.7653, lon: 4.9822 },
  'Monaco':                 { lat: 43.7279, lon: 7.4164 },
  'Nice':                   { lat: 43.7079, lon: 7.1929 },
  'Lille':                  { lat: 50.6116, lon: 3.1304 },
  'Rennes':                 { lat: 48.1073, lon: -1.7130 },
  'Lens':                   { lat: 50.4344, lon: 2.8136 },
  'Strasbourg':             { lat: 48.5640, lon: 7.7490 },
  'Nantes':                 { lat: 47.2557, lon: -1.5264 },
  'Brest':                  { lat: 48.4072, lon: -4.4175 },

  // ── MLS ──────────────────────────────────────────────────────────────────
  'LA Galaxy':              { lat: 33.8644, lon: -118.2606 },
  'LAFC':                   { lat: 34.0134, lon: -118.2854 },
  'Seattle Sounders':       { lat: 47.5952, lon: -122.3316 },
  'Portland Timbers':       { lat: 45.5212, lon: -122.6917 },
  'Atlanta United':         { lat: 33.7553, lon: -84.4006 },
  'New York Red Bulls':     { lat: 40.7368, lon: -74.1504 },
  'NYCFC':                  { lat: 40.8296, lon: -73.9262 },
  'Orlando City':           { lat: 28.5376, lon: -81.3894 },
  'Inter Miami':            { lat: 25.7782, lon: -80.2197 },
  'Chicago Fire':           { lat: 41.8786, lon: -87.6319 },
  'Columbus Crew':          { lat: 39.9689, lon: -82.9966 },
  'DC United':              { lat: 38.8685, lon: -77.0122 },
  'Philadelphia Union':     { lat: 39.8327, lon: -75.3818 },
  'New England Revolution': { lat: 42.0909, lon: -71.2643 },
  'Nashville SC':           { lat: 36.1665, lon: -86.7713 },
  'Charlotte FC':           { lat: 35.2258, lon: -80.8528 },
  'FC Dallas':              { lat: 33.1540, lon: -97.0815 },
  'Houston Dynamo':         { lat: 29.7528, lon: -95.3514 },
  'Sporting Kansas City':   { lat: 39.1212, lon: -94.8322 },
  'Minnesota United':       { lat: 44.9531, lon: -93.1643 },
  'Colorado Rapids':        { lat: 39.8056, lon: -104.8920 },
  'Real Salt Lake':         { lat: 40.5831, lon: -111.8922 },
  'San Jose Earthquakes':   { lat: 37.3529, lon: -121.9255 },
  'Vancouver Whitecaps':    { lat: 49.2781, lon: -123.1117 },
  'St. Louis City':         { lat: 38.6319, lon: -90.2045 },
  'Austin FC':              { lat: 30.3874, lon: -97.7197 },
};

// ── ESPN API slugs per sport ─────────────────────────────────────────────────

const ESPN_API: Record<string, { sport: string; league: string }> = {
  baseball:            { sport: 'baseball',   league: 'mlb'   },
  basketball:          { sport: 'basketball', league: 'nba'   },
  'american-football': { sport: 'football',   league: 'nfl'   },
  football:            { sport: 'soccer',     league: 'usa.1' },
  soccer:              { sport: 'soccer',     league: 'usa.1' },
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

// ── ESPN recent form (last 5 results) ────────────────────────────────────────

async function fetchRecentForm(sport: string, teamName: string): Promise<TeamForm | undefined> {
  const cfg = ESPN_API[sport.toLowerCase()];
  if (!cfg) return undefined;
  const short = shortTeamName(teamName);

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

// ── Weather (any outdoor venue — MLB, NFL, soccer) ───────────────────────────

export async function fetchWeather(
  teamName: string,
  apiKey: string,
): Promise<WeatherRisk | undefined> {
  const stadium = OUTDOOR_STADIUMS[teamName];
  if (!stadium) return undefined;  // indoor arena or unknown venue — skip

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

  const [news, weather, form, isBackToBack] = await Promise.all([
    fetchESPNHeadlines(sport, teamName),
    // Weather runs for ANY sport when the API key is set — fetchWeather returns
    // undefined automatically if the team's venue isn't in the outdoor table.
    weatherApiKey ? fetchWeather(teamName, weatherApiKey) : Promise.resolve(undefined),
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
