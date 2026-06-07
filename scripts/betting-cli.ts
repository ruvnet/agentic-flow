#!/usr/bin/env tsx
/**
 * Betting CLI — fetch live odds, detect value bets & arbitrage from the terminal.
 *
 * Usage:
 *   npx tsx scripts/betting-cli.ts events [soccer|basketball]
 *   npx tsx scripts/betting-cli.ts odds <eventId>
 *   npx tsx scripts/betting-cli.ts analyze <eventId>
 *
 * Reads VITE_RAPIDAPI_KEY and VITE_RAPIDAPI_HOST from .env
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

// ─── Types (mirrors src/types/betting.ts) ────────────────────────────────────

interface Outcome { name: string; odds: number }
interface Market { name: string; outcomes: Outcome[] }
interface BookmakerOdds { name: string; markets: Market[] }
interface Event {
  eventId: string; sport: string; league: string;
  home: string; away: string; startTime: string; status?: string;
}
interface OddsResponse {
  eventId: string; sport: string; league: string;
  home: string; away: string; startTime: string;
  bookmakers: BookmakerOdds[];
}
interface ValueBet {
  bookmaker: string; market: string; outcome: string;
  odds: number; fairOdds: number; edge: number;
}
interface ArbCombo { bookmaker: string; outcome: string; odds: number; stake: number }
interface ArbOpportunity { market: string; combinations: ArbCombo[]; profit: number }

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

const bold = (s: string) => `${c.bold}${s}${c.reset}`;
const green = (s: string) => `${c.green}${s}${c.reset}`;
const yellow = (s: string) => `${c.yellow}${s}${c.reset}`;
const cyan = (s: string) => `${c.cyan}${s}${c.reset}`;
const dim = (s: string) => `${c.dim}${s}${c.reset}`;
const red = (s: string) => `${c.red}${s}${c.reset}`;
const magenta = (s: string) => `${c.magenta}${s}${c.reset}`;

function pad(s: string, n: number, right = false): string {
  const plain = s.replace(/\x1b\[[0-9;]*m/g, '');
  const spaces = Math.max(0, n - plain.length);
  return right ? ' '.repeat(spaces) + s : s + ' '.repeat(spaces);
}

function hr(char = '─', width = 72): string {
  return dim(char.repeat(width));
}

// ─── API layer ────────────────────────────────────────────────────────────────

const API_KEY = process.env.VITE_RAPIDAPI_KEY ?? '';
const SPORT_HOST = process.env.VITE_SPORTAPI_HOST ?? 'sportapi7.p.rapidapi.com';
const BASE_URL = `https://${SPORT_HOST}`;
const SPORT_IDS: Record<string, number> = { soccer: 1, basketball: 2 };

if (!API_KEY) {
  console.error(red('✗ VITE_RAPIDAPI_KEY not set in .env'));
  process.exit(1);
}

const apiHeaders = () => ({
  'x-rapidapi-host': SPORT_HOST,
  'x-rapidapi-key': API_KEY,
});

function unwrapArray(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    for (const key of ['events', 'data', 'results', 'matches', 'items', 'list']) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  return [];
}

function normEvent(raw: Record<string, unknown>, sport: string): Event {
  const id = String(raw.id ?? raw.eventId ?? Math.random());
  const homeTeam = raw.homeTeam as Record<string, unknown> | undefined;
  const awayTeam = raw.awayTeam as Record<string, unknown> | undefined;
  const home = String(homeTeam?.name ?? raw.home ?? 'Home');
  const away = String(awayTeam?.name ?? raw.away ?? 'Away');
  const tournament = raw.tournament as Record<string, unknown> | undefined;
  const league = String(tournament?.name ?? raw.league ?? '');
  const ts = raw.startTimestamp as number | undefined;
  const startTime = ts
    ? new Date(ts * 1000).toISOString()
    : String(raw.startTime ?? raw.date ?? new Date().toISOString());
  const statusObj = raw.status as Record<string, unknown> | undefined;
  const statusType = String(statusObj?.type ?? raw.status ?? 'notstarted');
  const status = statusType === 'inprogress' ? 'live' : statusType;
  return { eventId: id, sport, league, home, away, startTime, status };
}

function normOdds(raw: unknown, info: OddsResponse): OddsResponse {
  const obj = raw as Record<string, unknown>;
  const bms: BookmakerOdds[] = [];

  if (Array.isArray(obj.bookmakers)) {
    return { ...info, bookmakers: obj.bookmakers as BookmakerOdds[] };
  }

  const back = obj.back as Record<string, unknown> | undefined;
  if (back?.choices && Array.isArray(back.choices)) {
    const map = new Map<string, Record<string, number>>();
    for (const c of back.choices as Record<string, unknown>[]) {
      const prov = (c.provider as Record<string, unknown> | undefined)?.name ?? 'Unknown';
      const bName = String(prov);
      if (!map.has(bName)) map.set(bName, {});
      map.get(bName)![String(c.name)] = Number(c.odds);
    }
    for (const [name, odds] of map) {
      bms.push({ name, markets: [{ name: 'Full Time Result', outcomes: Object.entries(odds).map(([n, o]) => ({ name: n, odds: o })) }] });
    }
    if (bms.length) return { ...info, bookmakers: bms };
  }

  if (Array.isArray(obj.markets)) {
    const bm: BookmakerOdds = { name: 'SportAPI7', markets: [] };
    for (const mkt of obj.markets as Record<string, unknown>[]) {
      const choices = mkt.choices as Record<string, unknown>[] | undefined;
      if (!choices) continue;
      const outcomes = choices.filter(c => Number(c.odds) > 0).map(c => ({ name: String(c.name ?? ''), odds: Number(c.odds) }));
      if (outcomes.length) bm.markets.push({ name: String(mkt.marketName ?? mkt.name ?? 'Market'), outcomes });
    }
    if (bm.markets.length) return { ...info, bookmakers: [bm] };
  }

  return { ...info, bookmakers: [] };
}

async function fetchEvents(sport: string): Promise<Event[]> {
  const sportId = SPORT_IDS[sport] ?? 1;
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const all: Event[] = [];

  for (const date of [today, tomorrow]) {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/sport/${sportId}/scheduled-events/${date}`, {
        method: 'GET', headers: apiHeaders(),
      });
      if (!res.ok) continue;
      const json = await res.json() as unknown;
      all.push(...(unwrapArray(json) as Record<string, unknown>[]).map(r => normEvent(r, sport)));
    } catch { /* try next */ }
  }

  if (!all.length) {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/sport/${sportId}/events/live`, {
        method: 'GET', headers: apiHeaders(),
      });
      if (res.ok) {
        const json = await res.json() as unknown;
        all.push(...(unwrapArray(json) as Record<string, unknown>[]).map(r => normEvent(r, sport)));
      }
    } catch {}
  }

  return all;
}

async function fetchOdds(eventId: string): Promise<OddsResponse> {
  const info: OddsResponse = { eventId, sport: '', league: '', home: '', away: '', startTime: new Date().toISOString(), bookmakers: [] };

  try {
    const res = await fetch(`${BASE_URL}/api/v1/event/${eventId}`, { method: 'GET', headers: apiHeaders() });
    if (res.ok) {
      const json = await res.json() as Record<string, unknown>;
      const ev = (json.event ?? json) as Record<string, unknown>;
      const homeTeam = ev.homeTeam as Record<string, unknown> | undefined;
      const awayTeam = ev.awayTeam as Record<string, unknown> | undefined;
      const tournament = ev.tournament as Record<string, unknown> | undefined;
      const ts = ev.startTimestamp as number | undefined;
      info.league = String(tournament?.name ?? ev.league ?? '');
      info.home = String(homeTeam?.name ?? ev.home ?? '');
      info.away = String(awayTeam?.name ?? ev.away ?? '');
      info.startTime = ts ? new Date(ts * 1000).toISOString() : String(ev.startTime ?? info.startTime);
    }
  } catch {}

  for (const path of [`/api/v1/event/${eventId}/odds/1`, `/api/v1/event/${eventId}/oddscomparison/1/1`, `/api/v1/event/${eventId}/oddssummary`]) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, { method: 'GET', headers: apiHeaders() });
      if (!res.ok) continue;
      const json = await res.json() as unknown;
      const result = normOdds(json, info);
      if (result.bookmakers.length) return result;
    } catch {}
  }

  return info;
}

// ─── Analysis logic (ported from src/components/betting/OddsTable.tsx) ────────

function detectValueBets(data: OddsResponse): ValueBet[] {
  const values: ValueBet[] = [];
  const pinnacle = data.bookmakers.find(b => b.name === 'Pinnacle');
  if (!pinnacle) return values;

  for (const bm of data.bookmakers) {
    if (bm.name === 'Pinnacle') continue;
    for (const market of bm.markets) {
      const pinMarket = pinnacle.markets.find(m => m.name === market.name);
      if (!pinMarket) continue;
      const margin = pinMarket.outcomes.reduce((s, o) => s + 1 / o.odds, 0);
      if (margin === 0) continue;
      for (const outcome of market.outcomes) {
        const pinOutcome = pinMarket.outcomes.find(o => o.name === outcome.name);
        if (!pinOutcome) continue;
        const fairOdds = 1 / ((1 / pinOutcome.odds) / margin);
        const edge = (outcome.odds / fairOdds - 1) * 100;
        if (edge > 2) {
          values.push({ bookmaker: bm.name, market: market.name, outcome: outcome.name,
            odds: outcome.odds, fairOdds, edge });
        }
      }
    }
  }
  return values.sort((a, b) => b.edge - a.edge);
}

function detectArbitrage(data: OddsResponse): ArbOpportunity[] {
  const arbs: ArbOpportunity[] = [];
  const marketNames = data.bookmakers[0]?.markets.map(m => m.name) ?? [];

  for (const marketName of marketNames) {
    const markets = data.bookmakers
      .map(bm => ({ bm: bm.name, market: bm.markets.find(m => m.name === marketName) }))
      .filter(x => x.market != null);

    const outcomes = markets[0]?.market?.outcomes.map(o => o.name) ?? [];
    const combos: ArbCombo[] = [];
    let totalInverse = 0;

    for (const outcome of outcomes) {
      let bestOdds = 0;
      let bestBm = '';
      for (const { bm, market } of markets) {
        const o = market?.outcomes.find(o => o.name === outcome);
        if (o && o.odds > bestOdds) { bestOdds = o.odds; bestBm = bm; }
      }
      if (bestOdds > 0) {
        totalInverse += 1 / bestOdds;
        combos.push({ bookmaker: bestBm, outcome, odds: bestOdds, stake: 0 });
      }
    }

    if (totalInverse < 1) {
      const profit = (1 / totalInverse - 1) * 100;
      const staked = combos.map(c => ({
        ...c, stake: Math.round((1 / (c.odds * totalInverse)) * 100),
      }));
      arbs.push({ market: marketName, combinations: staked, profit });
    }
  }
  return arbs;
}

// ─── Sub-commands ──────────────────────────────────────────────────────────────

async function cmdEvents(sport = 'soccer') {
  const valid = ['soccer', 'basketball'];
  if (!valid.includes(sport)) {
    console.error(red(`✗ Unknown sport "${sport}". Use: soccer | basketball`));
    process.exit(1);
  }

  console.log(`\n${bold('⚡ BetEdge CLI')} — ${cyan(sport)} events\n${hr()}`);
  process.stdout.write(dim('Fetching events…'));

  let events: Event[];
  try {
    events = await fetchEvents(sport);
  } catch (e) {
    process.stdout.write('\r');
    console.error(red(`\n✗ ${e instanceof Error ? e.message : String(e)}`));
    process.exit(1);
  }

  process.stdout.write('\r' + ' '.repeat(30) + '\r');

  if (!events.length) {
    console.log(yellow('No upcoming events found.'));
    return;
  }

  const header = [
    pad(bold('#'), 4),
    pad(bold('Match'), 38),
    pad(bold('League'), 18),
    pad(bold('Start (UTC)'), 20),
    pad(bold('ID'), 14),
  ].join('');
  console.log(header);
  console.log(hr());

  events.slice(0, 30).forEach((ev, i) => {
    const match = `${ev.home} vs ${ev.away}`;
    const dt = new Date(ev.startTime).toISOString().replace('T', ' ').slice(0, 16);
    const live = ev.status === 'live' ? green(' ●LIVE') : '';
    const row = [
      pad(dim(String(i + 1)), 4),
      pad(match.length > 36 ? match.slice(0, 35) + '…' : match, 38),
      pad(dim(ev.league.slice(0, 16)), 18),
      pad(dim(dt), 20),
      cyan(ev.eventId),
    ].join('') + live;
    console.log(row);
  });

  console.log(hr());
  console.log(dim(`${events.length} event(s) total  •  to analyse: ${cyan('npx tsx scripts/betting-cli.ts analyze <ID>')}`) );
}

async function cmdOdds(eventId: string) {
  if (!eventId) { console.error(red('✗ Provide an eventId')); process.exit(1); }

  console.log(`\n${bold('⚡ BetEdge CLI')} — odds for ${cyan(eventId)}\n${hr()}`);
  process.stdout.write(dim('Fetching odds…'));

  let data: OddsResponse;
  try {
    data = await fetchOdds(eventId);
  } catch (e) {
    process.stdout.write('\r');
    console.error(red(`\n✗ ${e instanceof Error ? e.message : String(e)}`));
    process.exit(1);
  }

  process.stdout.write('\r' + ' '.repeat(30) + '\r');
  console.log(`${bold(data.home)} vs ${bold(data.away)}  |  ${dim(data.league)}`);
  console.log(dim(new Date(data.startTime).toUTCString()));
  console.log('');

  const allMarkets = Array.from(new Set(data.bookmakers.flatMap(bm => bm.markets.map(m => m.name))));

  for (const marketName of allMarkets) {
    console.log(bold(marketName));
    const outcomes = data.bookmakers[0]?.markets.find(m => m.name === marketName)?.outcomes.map(o => o.name) ?? [];
    const bestOdds: Record<string, number> = {};
    for (const out of outcomes) {
      for (const bm of data.bookmakers) {
        const o = bm.markets.find(m => m.name === marketName)?.outcomes.find(o => o.name === out);
        if (o && o.odds > (bestOdds[out] ?? 0)) bestOdds[out] = o.odds;
      }
    }

    const outCols = outcomes.map(o => pad(bold(o.slice(0, 8)), 10));
    console.log('  ' + pad(dim('Bookmaker'), 24) + outCols.join('') + dim('  Margin'));
    console.log('  ' + hr('·', 70));

    for (const bm of data.bookmakers) {
      const market = bm.markets.find(m => m.name === marketName);
      if (!market) continue;
      const margin = (market.outcomes.reduce((s, o) => s + 1 / o.odds, 0) - 1) * 100;
      const marginStr = margin < 3 ? green(`${margin.toFixed(1)}%`) :
        margin < 6 ? yellow(`${margin.toFixed(1)}%`) : red(`${margin.toFixed(1)}%`);
      const oddsStrs = outcomes.map(out => {
        const o = market.outcomes.find(o => o.name === out);
        if (!o) return pad(dim('—'), 10);
        const s = o.odds.toFixed(2);
        return pad(o.odds === bestOdds[out] ? green(bold(s)) : s, 10);
      });
      console.log('  ' + pad(bm.name.slice(0, 22), 24) + oddsStrs.join('') + '  ' + marginStr);
    }
    console.log('');
  }
}

async function cmdAnalyze(eventId: string) {
  if (!eventId) { console.error(red('✗ Provide an eventId')); process.exit(1); }

  console.log(`\n${bold('⚡ BetEdge CLI')} — analysis for ${cyan(eventId)}\n${hr()}`);
  process.stdout.write(dim('Fetching odds…'));

  let data: OddsResponse;
  try {
    data = await fetchOdds(eventId);
  } catch (e) {
    process.stdout.write('\r');
    console.error(red(`\n✗ ${e instanceof Error ? e.message : String(e)}`));
    process.exit(1);
  }

  process.stdout.write('\r' + ' '.repeat(30) + '\r');
  console.log(`${bold(data.home)} vs ${bold(data.away)}  |  ${dim(data.league)}`);
  console.log('');

  const valueBets = detectValueBets(data);
  const arbs = detectArbitrage(data);

  // ── Value Bets ──
  console.log(bold('🎯 Value Bets') + '  ' + dim('(edge vs Pinnacle fair odds, >2%)'));
  console.log(hr('─', 72));
  if (valueBets.length === 0) {
    console.log(dim('  No value bets detected'));
  } else {
    const hdr = '  ' + pad(dim('Bookmaker'), 24) + pad(dim('Outcome'), 12) +
      pad(dim('Odds'), 8) + pad(dim('Fair'), 8) + dim('Edge');
    console.log(hdr);
    for (const vb of valueBets) {
      const edge = green(bold(`+${vb.edge.toFixed(1)}%`));
      const b = vb.odds - 1;
      const quarterKelly = b > 0 ? ((vb.edge / 100) / b * 100 / 4).toFixed(1) : '0.0';
      console.log('  ' + pad(vb.bookmaker.slice(0, 22), 24) +
        pad(vb.outcome.slice(0, 10), 12) +
        pad(vb.odds.toFixed(2), 8) +
        pad(dim(vb.fairOdds.toFixed(2)), 8) +
        edge + dim(`  ¼ Kelly: ${quarterKelly}%`));
    }
  }

  console.log('');

  // ── Arbitrage ──
  console.log(bold('🔒 Arbitrage Opportunities') + '  ' + dim('(guaranteed profit)'));
  console.log(hr('─', 72));
  if (arbs.length === 0) {
    console.log(dim('  No arbitrage opportunities'));
  } else {
    for (const arb of arbs) {
      console.log(`  ${magenta(bold(`+${arb.profit.toFixed(2)}% profit`))}  ${dim(arb.market)}`);
      for (const combo of arb.combinations) {
        console.log(`    ${pad(combo.outcome.slice(0, 10), 12)}` +
          `${pad(combo.bookmaker.slice(0, 20), 22)}` +
          `@ ${yellow(combo.odds.toFixed(2))}  ` +
          `${green(`£${combo.stake} stake`)}`);
      }
      console.log('');
    }
  }

  if (valueBets.length === 0 && arbs.length === 0) {
    console.log(red(bold('\n  ⛔ DO NOT BET — no edge found on this event')));
    console.log(dim('  Odds are fairly priced. Betting here puts you at a mathematical disadvantage.'));
    console.log(dim('  Patience is profit. Move on and wait for genuine value.'));
  }

  console.log(hr());
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const [,, cmd, arg] = process.argv;

const HELP = `
${bold('⚡ BetEdge CLI')}

  ${cyan('events')} [soccer|basketball]   List upcoming events
  ${cyan('odds')} <eventId>               Show bookmaker odds table
  ${cyan('analyze')} <eventId>            Detect value bets + arbitrage

  ${dim('Credentials read from .env (VITE_RAPIDAPI_KEY)')}
`;

switch (cmd) {
  case 'events':  await cmdEvents(arg ?? 'soccer'); break;
  case 'odds':    await cmdOdds(arg); break;
  case 'analyze': await cmdAnalyze(arg); break;
  default:        console.log(HELP);
}
