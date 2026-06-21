import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import { SofaScoreClient, AllScoresClient, XBetClient } from './api-client.js';
import { BettingAnalyzer } from './analyzer.js';
import { FormAnalyzer } from './form-analyzer.js';
import { fetchMLBProbablePitchers, researchLeg, type LegResearch } from './research.js';
import { BetTracker } from './bet-tracker.js';
import { scanOddsParlays, scanAllOddsLegs, type OddsParlay, type MoneylineLeg } from './odds-picker.js';
import { TelegramNotifier } from './telegram.js';
import { BettingStrategy } from './strategy.js';
import type { BotConfig, BettingAlert, OddsMarket, SofaEvent } from './types.js';

function loadConfig(): BotConfig {
  const apiKey = process.env.RAPIDAPI_KEY;
  const apiHost = process.env.RAPIDAPI_HOST;
  if (!apiKey || !apiHost) throw new Error('RAPIDAPI_KEY and RAPIDAPI_HOST must be set in .env');

  return {
    apiKey,
    apiHost,
    fallbackApiKey: process.env.FALLBACK_RAPIDAPI_KEY ?? apiKey,
    fallbackApiHost: process.env.FALLBACK_RAPIDAPI_HOST ?? 'allscores.p.rapidapi.com',
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 30_000),
    oddsMovementThresholdPct: Number(process.env.ODDS_MOVEMENT_PCT ?? 5),
    sports: (process.env.SPORTS ?? 'baseball,basketball,football').split(',').map((s) => s.trim()),
    timezone: process.env.TIMEZONE ?? 'America/Chicago',
    minConfidence: Number(process.env.MIN_CONFIDENCE ?? 65),
    telegramToken: process.env.TELEGRAM_TOKEN ?? process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    betDataFile: process.env.BET_DATA_FILE ?? './betting-data.json',
    bankroll: Number(process.env.BANKROLL ?? 0),
    unitPct: Number(process.env.UNIT_PCT ?? 2),
    maxPicksPerDay: Number(process.env.MAX_PICKS_PER_DAY ?? 6),
    minEdgePct: Number(process.env.MIN_EDGE_PCT ?? 5),
    antiChaseAfterLosses: Number(process.env.ANTI_CHASE_LOSSES ?? 3),
    dailyBriefingHour: Number(process.env.DAILY_BRIEFING_HOUR ?? 8),
    maxPreMatchEventsPerScan: Number(process.env.MAX_PREMATCH_EVENTS ?? 30),
    xbetApiKey: process.env.XBET_RAPIDAPI_KEY,
    xbetApiHost: process.env.XBET_RAPIDAPI_HOST ?? '1xbet12.p.rapidapi.com',
    openWeatherApiKey: process.env.OPENWEATHER_API_KEY,
    allowedLeagues: process.env.ALLOWED_LEAGUES
      ? process.env.ALLOWED_LEAGUES === '*'
        ? []           // '*' = allow all leagues
        : process.env.ALLOWED_LEAGUES.split(',').map((l) => l.trim())
      : [],            // empty = use built-in default list
  };
}

function toAmericanBot(decimal: number): string {
  if (decimal <= 1) return '—';
  const american = decimal >= 2
    ? Math.round((decimal - 1) * 100)
    : Math.round(-100 / (decimal - 1));
  return american > 0 ? `+${american}` : `${american}`;
}

const ALERT_ICONS: Record<BettingAlert['type'], string> = {
  new_event: '🆕',
  score_change: '⚽',
  odds_movement: '📊',
  value_bet: '💰',
  event_ended: '🏁',
  high_confidence_pick: '💡',
};

function printAlert(alert: BettingAlert): void {
  console.log(`${ALERT_ICONS[alert.type] ?? '•'} [${alert.timestamp}] ${alert.message}`);
}

function isRateLimitError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'response' in err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    return status === 429 || status === 403 || status === 401;
  }
  return false;
}

/** Extract the decimal odds for the pick from the market map */
function getPickOdds(
  markets: OddsMarket[] | undefined,
  pick: '1' | 'X' | '2'
): number | undefined {
  if (!markets) return undefined;
  const market = markets.find((m) =>
    m.marketName.toLowerCase().includes('1x2') ||
    m.marketName.toLowerCase().includes('match winner') ||
    m.marketName.toLowerCase().includes('full time result')
  );
  if (!market) return undefined;

  const nameMap: Record<string, string[]> = {
    '1': ['home', '1', 'home win'],
    'X': ['draw', 'x', 'tie'],
    '2': ['away', '2', 'away win'],
  };
  const targets = nameMap[pick];
  if (!targets) return undefined;
  const choice = market.choices.find((c) =>
    targets.some((t) => c.name.toLowerCase().includes(t))
  );
  return choice?.decimal;
}

type LiveClient = SofaScoreClient | AllScoresClient | XBetClient;

async function fetchAllLive(client: LiveClient, sports: string[]): Promise<SofaEvent[]> {
  const results = await Promise.allSettled(sports.map((s) => client.getLiveEvents(s)));
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

async function fetchOddsForEvents(
  client: LiveClient,
  events: SofaEvent[]
): Promise<Map<number, OddsMarket[]>> {
  const pairs = await Promise.allSettled(
    events.map(async (e) => ({ id: e.id, markets: await client.getEventOdds(e.id) }))
  );
  const map = new Map<number, OddsMarket[]>();
  for (const r of pairs) {
    if (r.status === 'fulfilled' && r.value.markets.length > 0) {
      map.set(r.value.id, r.value.markets);
    }
  }
  return map;
}

/** Top leagues to analyze by default when ALLOWED_LEAGUES is not configured. */
const DEFAULT_TOP_LEAGUES = [
  // Football / Soccer
  'Premier League', 'La Liga', 'LaLiga', 'Serie A', 'Bundesliga', 'Ligue 1',
  'Champions League', 'Europa League', 'Conference League',
  'MLS', 'Championship', 'Eredivisie', 'Primeira Liga', 'Super Lig',
  'Serie B', 'La Liga 2', '2. Bundesliga',
  // Basketball — include both abbreviation and full name
  'NBA', 'National Basketball Association', 'EuroLeague',
  // Baseball — include both abbreviation and full name
  'MLB', 'Major League Baseball', 'American League', 'National League',
  // American Football
  'NFL', 'National Football League',
];

function isLeagueAllowed(league: string, allowedLeagues: string[]): boolean {
  const list = allowedLeagues.length > 0 ? allowedLeagues : DEFAULT_TOP_LEAGUES;
  const lower = league.toLowerCase();
  return list.some((l) => lower.includes(l.toLowerCase()));
}

async function runBot(): Promise<void> {
  const config = loadConfig();
  const primary = new SofaScoreClient(config);
  const fallback = new AllScoresClient(config);
  const xbet = new XBetClient(config);
  const liveAnalyzer = new BettingAnalyzer(config.oddsMovementThresholdPct);
  const formAnalyzer = new FormAnalyzer(primary);
  const tracker = new BetTracker(config.betDataFile, config.bankroll);
  const telegram = new TelegramNotifier(config.telegramToken, config.telegramChatId);
  const strategy = new BettingStrategy({
    bankroll: config.bankroll,
    unitPct: config.unitPct,
    maxPicksPerDay: config.maxPicksPerDay,
    minEdgePct: config.minEdgePct,
    antiChaseAfterLosses: config.antiChaseAfterLosses,
  });

  // Sync FormAnalyzer with weights learned in previous sessions
  formAnalyzer.updateWeights(tracker.formAnalyzerWeights);

  let activeName = 'SofaScore';
  let activeClient: LiveClient = primary;
  // Track which fallback tier we're on: 0=primary, 1=AllScores, 2=1xBet
  let fallbackTier = 0;
  let rateLimitedUntil = 0;
  let lastBriefingDate = '';
  // Parlays are built and sent once per calendar day only
  let lastParlayDate = '';
  // Cache last built parlays so /parlays command can re-send them
  let lastParlays: OddsParlay[] = [];
  let lastParlaysDate = '';
  let lastResearch = new Map<string, LegResearch>();
  // Shared across poll() and scheduleNextPoll() via closure
  let liveCount = 0;
  // Intraday leg tracker: legs already alerted today so we don't duplicate
  const intradayAlertedLegs = new Set<string>(); // key: `${teamName}|${dateStr}`

  // Seed from persisted picks so restarts don't produce duplicate picks
  const analyzedEventIds = tracker.pickedEventIds();
  // Track cache-based picks by team-pair key (source-agnostic, avoids cross-API ID collisions)
  const analyzedMatchKeys = new Set<string>();

  // Pre-match odds cache: team-name key → MoneylineLeg (used to match live events)
  const prematchLegsCache = new Map<string, MoneylineLeg>();

  // Normalize a team name to its last word (lowercase) for fuzzy matching:
  //   "Chicago Cubs" → "cubs", "CHI Cubs" → "cubs", "SF Giants" → "giants"
  const normTeam = (name: string) => name.trim().split(/\s+/).pop()?.toLowerCase() ?? name.toLowerCase();
  const teamPairKey = (home: string, away: string) => `${normTeam(home)}|${normTeam(away)}`;

  const prematchCacheFile = config.betDataFile.replace(/[^/\\]+$/, 'prematch-cache.json');

  function loadPrematchCache(): void {
    try {
      const raw = JSON.parse(readFileSync(prematchCacheFile, 'utf8')) as { date?: string; legs?: Record<string, MoneylineLeg> };
      const todayUTC = new Date().toISOString().slice(0, 10);
      if (raw.date !== todayUTC || !raw.legs) return;
      for (const [key, leg] of Object.entries(raw.legs)) {
        prematchLegsCache.set(key, leg);
      }
      // Parlays were already sent when this cache was built — suppress duplicate send on restart
      lastParlayDate = todayUTC;
      console.log(`[Pre-match] Restored ${prematchLegsCache.size} cached pre-match leg(s) from disk (${todayUTC}) — parlays already sent today`);
    } catch {
      // no cache file or parse error — start fresh
    }
  }

  function savePrematchCache(): void {
    try {
      const todayUTC = new Date().toISOString().slice(0, 10);
      writeFileSync(prematchCacheFile, JSON.stringify({ date: todayUTC, legs: Object.fromEntries(prematchLegsCache) }, null, 2));
    } catch {
      // non-fatal
    }
  }

  // CLV schedule: eventId → {leg, kickoffMs, sampled}
  const clvSchedule = new Map<number, { leg: MoneylineLeg; kickoffMs: number; sampled: boolean }>();

  // Parse decimal odds from a fractional string (duplicate of odds-picker helper — kept local)
  function fracToDecimalLocal(frac: string): number | undefined {
    const parts = frac.split('/').map(Number);
    const n = parts[0]; const d = parts[1];
    if (n === undefined || d === undefined || !d || isNaN(n) || isNaN(d)) return undefined;
    return +(n / d + 1).toFixed(3);
  }

  // Extract odds for a specific pick side ('1'=home, '2'=away) from live markets
  function extractPickOdds(markets: OddsMarket[], pick: '1' | '2'): number | undefined {
    const market = markets.find((m) => /1x2|match.?winner|full.?time|moneyline|to.?win/i.test(m.marketName));
    if (!market) return undefined;
    const choice = pick === '1'
      ? market.choices.find((c) => /\b(home|1)\b/i.test(c.name))
      : market.choices.find((c) => /\b(away|2)\b/i.test(c.name));
    if (!choice) return undefined;
    return choice.decimal ?? (choice.fractionalValue ? fracToDecimalLocal(choice.fractionalValue) : undefined);
  }

  // Fetch closing line odds for picks scheduled within the next 90 min (or up to 30 min past kickoff)
  async function checkClvSchedule(): Promise<void> {
    const now = Date.now();
    for (const [eventId, entry] of clvSchedule) {
      if (entry.sampled) { clvSchedule.delete(eventId); continue; }
      const msToKickoff = entry.kickoffMs - now;
      if (msToKickoff > 90 * 60 * 1_000) continue;    // too early — check later
      if (msToKickoff < -30 * 60 * 1_000) { clvSchedule.delete(eventId); continue; } // expired
      entry.sampled = true;
      try {
        const markets = await primary.getEventOdds(eventId);
        const closingOdds = extractPickOdds(markets, entry.leg.pick);
        if (closingOdds && closingOdds > 1) {
          const updated = tracker.updateClosingLine(eventId, closingOdds);
          if (updated?.clv !== undefined) {
            const sign = updated.clv >= 0 ? '+' : '';
            console.log(
              `[CLV] ${updated.match} | Entry: ${updated.odds} → Closing: ${closingOdds} | CLV: ${sign}${updated.clv}%` +
              (updated.clv >= 0 ? ' ✅ positive edge' : ' ⚠️ negative edge')
            );
          }
        }
      } catch { /* non-fatal — closing line unavailable for this event */ }
    }
  }

  console.log('🤖 Smart Sports Betting Bot');
  console.log(`   Primary   : ${config.apiHost}`);
  console.log(`   Fallback 1: ${config.fallbackApiHost}`);
  console.log(`   Fallback 2: ${config.xbetApiKey ? config.xbetApiHost : '(not configured)'}`);
  console.log(`   Sports    : ${config.sports.join(', ')}`);
  console.log(`   Poll      : ${config.pollIntervalMs / 1_000}s`);
  console.log(`   Min conf. : ${tracker.threshold}% (self-adjusting)`);
  console.log(`   Bankroll  : ${config.bankroll > 0 ? `$${config.bankroll}` : 'not set'}`);
  console.log(`   Max picks : ${config.maxPicksPerDay}/day`);
  console.log(`   Min edge  : ${config.minEdgePct}%`);
  console.log(`   Briefing  : ${config.dailyBriefingHour}:00 daily`);
  console.log('─'.repeat(60));
  console.log(tracker.getSummary());
  console.log('─'.repeat(60));

  // Send startup ping — immediately confirms Telegram is working
  await telegram.sendStartupMessage({
    sports: config.sports,
    pollIntervalSec: config.pollIntervalMs / 1_000,
    minConfidence: tracker.threshold,
    maxPicksPerDay: config.maxPicksPerDay,
    minEdgePct: config.minEdgePct,
    bankroll: config.bankroll > 0 ? config.bankroll : undefined,
    totalPicks: tracker.getStats().total,
    winRate: tracker.getStats().winRate,
  });

  // Interactive Telegram commands
  telegram.startListening(async (cmd, args) => {
    switch (cmd) {
      case 'status':
      case 'stats':
        return tracker.getSummary();

      case 'picks': {
        const pending = tracker.pendingPicks();
        if (pending.length === 0) return '⏳ No pending picks right now.';
        const lines = ['⏳ *Pending picks:*', ''];
        for (const p of pending) {
          const label = p.pick === '1' ? '🏠 Home' : p.pick === '2' ? '✈️ Away' : '🤝 Draw';
          const ko = p.kickoffTime
            ? ` @ ${new Date(p.kickoffTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : '';
          const oddsStr = p.odds
            ? ` | ${p.odds} (${toAmericanBot(p.odds)})`
            : '';
          const edgeStr = p.edge !== undefined ? ` | Edge: +${p.edge}%` : '';
          const clvStr = p.clv !== undefined
            ? ` | CLV: ${p.clv >= 0 ? '+' : ''}${p.clv}% ${p.clv >= 0 ? '✅' : '⚠️'}`
            : '';
          lines.push(`• ${p.match}${ko}`);
          lines.push(`  ${label} [${p.confidence}%]${oddsStr}${edgeStr}${clvStr}`);
          lines.push(`  ID: ${p.eventId} | ${p.league}`);
        }
        return lines.join('\n');
      }

      case 'bankroll': {
        const br = tracker.getBriefingData().bankroll;
        if (!br || br.initial === 0) return '💰 No bankroll configured (set BANKROLL in .env).';
        const pnl = +(br.current - br.initial).toFixed(2);
        const pct = +((pnl / br.initial) * 100).toFixed(1);
        const sign = pnl >= 0 ? '+' : '';
        const arrow = pnl >= 0 ? '▲' : '▼';
        return `💰 *Bankroll P&L*\n\nStart: $${br.initial}\nCurrent: $${br.current}\n${arrow} ${sign}$${pnl} (${sign}${pct}%)`;
      }

      case 'blacklist': {
        const briefing = tracker.getBriefingData();
        const bl = briefing.blacklistedLeagues;
        if (bl.length === 0) return '✅ No leagues blacklisted.';
        return `🚫 *Blacklisted leagues (${bl.length}):*\n${bl.map((l) => `• ${l}`).join('\n')}`;
      }

      case 'rules':
        return [
          '📋 *BETTING RULES & CHECKLIST — Sahil\'s Bet Log*',
          '',
          '🔒 *CORE RULES (NEVER BREAK THESE):*',
          '',
          '1️⃣  Double-check EVERY leg before placing',
          '2️⃣  Min 60% true win prob per leg — AIM for 70%+',
          '3️⃣  Target combined odds: +400 to +500',
          '4️⃣  Stake: $10–$70 per bet (NEVER all-in)',
          '5️⃣  All legs POSITIVELY correlated (same cause)',
          '6️⃣  No coinflips — explain each leg in 1 sentence',
          '7️⃣  Learn from every result — update the log',
          '8️⃣  Scan morning/evening/night — bet ONLY when a leg clears 60%',
          '     No forced quota. 0 picks on a quiet day beats 1 weak pick.',
          '',
          '✅ *DOUBLE-CHECK PROTOCOL (run before every bet):*',
          '',
          'STEP 1 — Confirm starters (MLB.com or ESPN, within 30 min of kickoff)',
          'STEP 2 — Injury report: pitcher + key batters, LAST 24 HOURS only',
          'STEP 3 — ERA + HOME/ROAD ERA split separately (season ERA alone is misleading)',
          '         e.g. Luzardo 4.85 season / 7.34 HOME / 1.55 road — ALWAYS check split',
          'STEP 4 — Last 3–4 starts form + K rate (for K props) + H2H vs this opponent',
          'STEP 5 — True win % from 2+ independent sources (Dimers, Kalshi, Polymarket)',
          '         Must be ≥60% on BOTH sources. One source is not enough.',
          'STEP 6 — Line movement: opening odds vs current — sharp money vs you = skip',
          'STEP 7 — Soccer group stage? → DOUBLE CHANCE (1X) ONLY. NO straight ML.',
          '         Only exception: Argentina (defending champion, extreme quality gap).',
          'STEP 8 — Confirm game NOT yet started and odds still open before placing',
          'STEP 9 — Any leg fails STEP 1–8? REPLACE the leg or cancel the whole bet',
          'STEP 10 — Player prop scan (soccer + other sports):',
          '  • "Anytime goalscorer" — 35-55% even for elite strikers. RARELY clears 60% bar.',
          '    Jonathan David +100 = ~50%, Embolo 11/8 = ~42%, Jiménez +162 = ~38%.',
          '    Only use if model AND market BOTH show ≥60%. Treat same as any other leg.',
          '  • "Shot on target (1+)" — 65-80% for active forwards vs weaker defenses.',
          '    This CAN clear 60%. Verify: player starting, last 3 games shot volume,',
          '    opposition defensive rating, average shots on target allowed per game.',
          '  • "Goal contribution (goal or assist)" — 55-65% for top 10 forwards. Borderline.',
          '  • Bypasses group-stage draw risk entirely — valid if prop itself clears 60%.',
          '  • Still run STEP 1–9 checks on the player: injury, starting, recent form.',
          '',
          '✅ *Per-leg verify checklist:*',
          '  • Starting pitcher / key player CONFIRMED starting (not scratched)',
          '  • No injury news in last 24h (pitcher + top 3 batters on both teams)',
          '  • HOME ERA checked separately from road ERA for pitching legs',
          '  • Line hasn\'t moved unfavourably since research (re-check current line)',
          '  • Weather OK for outdoor stadiums',
          '  • Opponent lineup — no surprise changes',
          '  • True win % > breakeven from ≥2 independent models',
          '  • Game time confirmed — odds not already closed',
          '',
          '🎯 *WHAT WORKS (Learning Log):*',
          '  ✅ Dominant pitcher + home team + opponent under runs',
          '  ✅ Non-marquee regular season games (softer lines)',
          '  ✅ Elite pitcher (ERA < 2.50) as anchor leg',
          '  ✅ CONFIRMED June 15 2026 — 2/2 bets, 5/5 legs hit:',
          '     Cubs ML (Imanaga vs 2-8 Lorenzen) won 5-4',
          '     Phillies ML (Wheeler 2.22 ERA vs Gusto 6.00 ERA) won 7-0 shutout',
          '     Reds SGP (ML + Burns 5+ Ks + Mets U3.5) won 12-0 sweep',
          '     Pattern: elite ERA vs bad ERA pitcher mismatch = highest hit rate',
          '     Pattern: book-favorite K props at -900+ are near-locks, stack them',
          '  ✅ CONFIRMED June 16 2026 — 2/2 bets hit:',
          '     Argentina ML 3-0 Algeria (Messi hat-trick, ML + Over 1.5 Goals both hit)',
          '     Brewers 2-1 Guardians (Brewers ML + Gasser Under 5.5 Ks)',
          '     Pattern: Defending WC champion vs qualifier with 8+ ranking gap =',
          '       draw risk shrinks to ~17-20%, ML justified (NOT same as Belgium/Spain)',
          '     Pattern: Pitcher averaging <5 Ks/start with 5+ ERA = reliable K Under',
          '  ✅ CONFIRMED June 17 2026 — BOTH bets fully hit (6/6 bets won June 15–17):',
          '     BET 1: England 4-2 Croatia ✅ (England ML -145 — Kane brace, Bellingham, Rashford)',
          '            Cubs 8-6 Rockies ✅ (Cubs ML -190 — Assad 5-1, Sullivan allowed 8 in 4IP)',
          '     BET 2: Yankees 5-1 White Sox ✅ (Yankees ML -190 — Goldschmidt + Rice both homered)',
          '            Medvedev 6-4 6-4 Atmane, Halle ATP ✅ (Medvedev ML — dominant straight sets)',
          '     BONUS: Colombia 3-1 Uzbekistan ✅ (Double Chance 1X hit — Muñoz, Díaz, Campaz)',
          '     Pattern: Top ATP grass seed vs ~90 ranked = near-lock. Straight sets, efficient.',
          '     Pattern: England 0-conceded in 9 straight → translated to dominant 4-2 win.',
          '     Pattern: Sullivan sick debut on road vs Assad = Cubs dominant, high-confidence.',
          '',
          '🚫 *WHAT TO AVOID (Loss Log):*',
          '  ❌ Playoff games — sharp money kills value',
          '  ❌ Three underdog legs — cumulative prob too low',
          '  ❌ Cross-game legs in same parlay (no correlation)',
          '  ❌ Feeling bets — every leg needs a data reason',
          '  ❌ Chasing losses by increasing stake',
          '  ❌ Soccer ML in World Cup group stage — DRAW KILLS THE BET',
          '     (Belgium -155 drew 1-1 vs Egypt, June 15 2026)',
          '     (Spain drew 0-0 vs Cape Verde, June 15 2026)',
          '     (Portugal -375 drew 1-1 vs DR Congo, June 17 2026 — 77% win prob, STILL drew)',
          '     Group stage teams play conservatively — a draw often suits both sides',
          '     REVISED RULE: NO group stage ML, period. Even 77% favorites draw.',
          '     Only exception: Argentina (defending champion, 18-1 goal diff in 8 games)',
          '       — that is an extreme outlier, do NOT generalise to other teams.',
          '     Use Double Chance (1X) or SKIP all other group stage soccer ML.',
          '  ❌ Trusting season ERA alone — check home/road split first',
          '     (June 16 2026: Luzardo 4.85 season ERA hid a 7.34 HOME / 1.55',
          '     ROAD split — Phillies were -190 favorites pitching him at HOME,',
          '     exactly the split where he is worst. Market price ignored it.)',
          '     (June 18 2026: Woo 3.02 season ERA hides 2.37 HOME / 5.93 ROAD.',
          '     Career-high 7 ER came at Camden Yards (road). Today pitches at home.',
          '     Home ERA 2.37 = ELITE. Correct call is Mariners ML ✅, not a skip.)',
          '     Always pull split ERA before trusting OR fading a moneyline.',
          '',
          '📊 *RUNNING RECORD (June 15–25 2026):*',
          '   June 15: 2/2 ✅ | June 16: 2/2 ✅ | June 17: 2/2 ✅ (Cubs, England, Yankees, Medvedev)',
          '   June 18: BET 1 ❌ (Yankees ML + Goldschmidt RBI — White Sox 5-1) | BET 2 ✅ (Mariners 3-0, Woo 9 Ks)',
          '   June 19: BET 1 ✅✅ Yankees 5-0 Reds | BET 2 ✅✅ Tigers 4-3 White Sox (Skubal 8 Ks)',
          '   June 20: BET 1 ✅✅ WIN — Phillies 15, Mets 3 (Sanchez 1 ER/6 IP, Harper cycle, Schwarber 3 HRs)',
          '              ⚠️ RECORD CORRECTION: "1-11" score user saw was AWAY-HOME format = Mets 1, Phillies 11.',
          '              Mets scored only 3 runs total → TT under 3.5 ✅. Both legs HIT.',
          '            BET 2 ❌❌ LOST — Orioles walk-off 4-3 (Yamamoto near no-no, pen blew 9th).',
          '   June 21: BET 1 🎯 PLACED — Wheeler vs Peterson (SNB 7:20 PM ET). Result pending user confirmation.',
          '              Wheeler 6-1, 2.01 ERA. Peterson 3-5, 5.91 ERA. Phillies -184, Duran/Kerkering pen ✅.',
          '   June 22: 0-pick day — all elite starters on IL or pitched June 20-21 (see June 22 section).',
          '   June 23: 0-pick day — rotation still cooling down; aces return June 25-26 (see June 23 section).',
          '   June 24: 0-pick day — Skubal fails ERA threshold + IP limit (see June 24 section).',
          '   June 25: BET 1 🔥 LOCKED — Phillies ML + Nationals TT under 3.5 (Sanchez 1.82 ERA, HIGH CONFIDENCE).',
          '              BET 2 🎯 CONDITIONAL — Braves ML + A\'s TT under 3.5 (Sale 2.30 ERA, pen check required).',
          '   June 20 AM: NOT PLACED — Cubs ML (Boyd, 2.79 ERA) morning pick.',
          '   June 20 PM: BET 1 ✅✅ WIN — Phillies 15, Mets 3. Sanchez 1 ER/6 IP (8-3 record, ERA now 1.80).',
          '              Bryce Harper hit for the cycle. Kyle Schwarber hit 3 homers. Mets TT = 3 (under 3.5 ✅).',
          '              [RECORD CORRECTED: previous session misread "1-11" as Mets 11, Phillies 1.',
          '               Correct reading: scoreboard Away-Home = Mets 1, Phillies 11. Never assume without checking.]',
          '              BET 2 ❌❌ LOST — Orioles 4-3 walk-off. Yamamoto near no-hitter thru 8 IP, pen blew it.',
          '              Treinen/Scott meltdown in 9th — Scott gave up walk-off with bases loaded. Orioles TT = 4.',
          '            LESSON #3: ALWAYS verify closer/bullpen ERA before trusting any ML SGP (June 18 ✦ June 20).',
          '            LESSON #4: Dodgers pen underperformed last 2 weeks per Covers — fade at -257 OR verify bullpen.',
          '            LESSON #7: Scoreboard "X-Y" shows Away-Home. Always confirm which team is home before concluding.',
          '   ✅ PATTERN CONFIRMED: ML + opponent TT under SGP hits when elite starter AND verified bullpen align.',
          '      BULLPEN CHECK is now mandatory before any ML bet. Name the closer, look up their ERA.',
          '      Skubal K prop near even money = top-tier edge. Watch for mispriced K props on dominant aces.',
          '⚠️  Priority sports: MLB · ATP Tennis · Player props (avoid soccer group stage ML)',
          '   Bullpen rule (added June 20): Must confirm closer ERA ≤2.50 before trusting ML SGP.',
          '   Player props rule: Anytime scorer rarely clears 60% (Embolo 42%). Shot-on-target 1+ = 65-80%.',
          '📅 *June 19 RESULTS — 2/2 bets ✅✅ ALL 4 LEGS HIT:*',
          '   BET 1 ✅✅: Yankees ML (-270) + Reds TT under 2.5 → Yankees 5-0 Reds',
          '     Schlittler career-high 13 Ks in 6 IP. Reds scored 0 runs (under 2.5 ✅). Dominant.',
          '   BET 2 ✅✅: Tigers ML (-235) + Skubal over 6.5 Ks (-102) → Tigers 4-3 White Sox',
          '     Skubal 8 Ks ✅. Tigers comeback on Carpenter walk-off bloop double. Both legs cash.',
          '📅 *June 20 picks — TONIGHT, 2 bets, full cross-sport screen:*',
          '   BET 1 🔥: Phillies ML + Mets TT under 3.5 runs (SGP, 7:15 PM ET, Citizens Bank Park)',
          '     Sanchez 8-3, 1.82 ERA, 1.09 WHIP — NL Pitcher of Month tier. Peralta (Mets) 5-5, 3.94 ERA.',
          '     Phillies bullpen ✅ CHECKED: Duran 1.90 ERA 18 saves, Kerkering 2.03 ERA — top-3 NL bullpen.',
          '     Phillies ML true prob: ~67% | Mets TT under 3.5 true prob: ~86% (Poisson λ=2.0 vs Sanchez).',
          '     P(X≤3 | λ=2.0) = e^(-2.0)×[1+2.0+2.0+1.333] = 0.1353×6.333 = 85.7%. Correlation ✓',
          '     SCREENED: WC Germany/Netherlands/Ecuador/Japan all group stage → skip.',
          '   BET 2 ⚠️: Dodgers ML + Orioles TT under 3.5 runs (SGP, 10:10 PM ET, Dodger Stadium)',
          '     Yamamoto 7-4, 2.52 ERA vs Rogers 3-7, 5.86 ERA. Massive pitching edge for LA.',
          '     ⚠️ BULLPEN WARNING: Covers.com explicitly fades Dodgers at -257 — pen underperformed 2 weeks.',
          '     Dodgers ML true prob: ~70% (adjusted for bullpen risk) | Orioles TT under 3.5: ~82% (λ=2.2).',
          '     P(X≤3 | λ=2.2) = e^(-2.2)×[1+2.2+2.42+1.775] = 0.1108×7.395 = 82%. Correlation ✓',
          '     Rationale: Rogers 5.86 ERA → Dodgers build big lead early → bullpen risk is manageable.',
          '     Confirm Dodgers closer ERA at book before placing. If unknown or >2.50 → skip BET 2.',
          '   ✅ June 20 BET 1 RESULT: WIN — Phillies 15, Mets 3. Sanchez 1 ER/6 IP (now 8-3, ERA 1.80).',
          '      Harper first-career cycle in 5 innings. Schwarber 3 HRs (28 on season, MLB lead).',
          '      Mets scored only 3 runs = TT under 3.5 ✅. BOTH LEGS HIT. Record corrected.',
          '   📉 June 20 BET 2 RESULT: ❌ LOST — Orioles 4, Dodgers 3 (walk-off). Bullpen imploded.',
          '      Yamamoto carried no-hit bid into 8th (1 hit allowed, 10 Ks). Pen gave up walk-off in 9th.',
          '      LESSON #5: When Covers/sharp-money sites warn "fade bullpen," ERA of closer is NOT enough.',
          '      Must check ALL high-leverage relievers (not just closer). Treinen failed BEFORE Scott entered.',
          '      Covers warned Dodgers pen for 2 weeks — that was the skip signal. Trust sharp consensus.',
          '      LESSON #6: Team pen 7-day ERA ≥6.00 is a conditional warning flag even if closer ERA ≤2.50.',
          '      Closer ERA passes the gate but team pen flags require day-of confirmation before BET 2 placed.',
          '      LESSON #8: AI search can surface old articles matching query keywords. Cross-check context',
          '      clues (team records, loss streaks, scores) to verify article date before logging any result.',
          '      A "7-game losing streak" is a falsification signal if the team won within the streak window.',
          '   🎯 June 21 BET 1: PLACED, result pending user confirmation.',
          '      Wheeler (6-1, 2.01 ERA, 0.85 WHIP) vs Peterson (3-5, 5.91 ERA). Sunday Night Baseball 7:20 PM ET.',
          '      Phillies bullpen: Duran 1.90 ERA, Kerkering 2.03 ERA ✅. Phillies -184 ML, Mets TT under 3.5.',
          '      NOTE: Earlier Wheeler vs Mets game this season ended 10-2 (Wheeler 5 IP 0 ER 8 Ks, Stott grand slam).',
          '      Confirm final score with user to log result for both ML and TT legs.',
          '📅 *June 21 picks — TODAY (1 qualifying bet — quality bar enforced):*',
          '   BET 1 🔥: Phillies ML + Mets TT under 3.5 runs (SGP, 7:20 PM ET Sunday Night Baseball)',
          '     Wheeler 6-1, 2.01 ERA, 0.85 WHIP, 8.97 K/9. Last 2 starts: 6 IP 0 ER 9 Ks each.',
          '     Peterson (Mets) 3-5, 5.91 ERA — massive pitching mismatch. Phillies -184.',
          '     Phillies bullpen ✅ VERIFIED: Duran 1.90 ERA 18 saves, Kerkering 2.03 ERA.',
          '     Mets TT under 3.5 vs Wheeler: Poisson λ=2.0 → P(X≤3) = 85.7%.',
          '     Phillies ML devigged: ~64.8% true prob. Sharp consensus: Phillies + Under.',
          '     PLACE at 1× standard unit. No chasing after June 20 losses.',
          '   BET 2: NO QUALIFYING PICK — 1-bet day (quality bar enforced, 0 > 1 weak pick)',
          '     Yankees ML SKIP: David Bednar ERA 3.64 (fails ≤2.50 closer rule) + Burns 8-1/2.01 ERA for Reds.',
          '     Braves ML SKIP: Grant Holmes ERA 3.59 (fails ≤2.50 starter quality threshold).',
          '     No other June 21 game clears all mandatory gates today.',
          '📅 *June 22 — Research complete:*',
          '   ⚠️ ALL elite starters unavailable June 22:',
          '     - Glasnow (Dodgers): 60-day IL (back) — out until post-All-Star break',
          '     - Fried (Yankees): 15-day IL (elbow bone bruise) — out until late June/July',
          '     - Yamamoto/Wheeler/Sanchez/Sale: pitched June 20-21 → next start June 25-26',
          '     - Dylan Cease (Blue Jays, 2.71 ERA): pitched June 21 → next start June 26',
          '     - Bieber (Blue Jays): 2026 debut post-TJS, rehab ERA 6.88 = high risk, SKIP',
          '     - Nola (Phillies vs Nationals): 5.86 season ERA — FAILS starter quality threshold',
          '     - Hunter Brown (Astros, 0.84 ERA in 2 starts): starts June 22 opener (not June 23)',
          '   ✅ June 22 STATUS: 0-pick day. Quality bar enforced.',
          '',
          '📅 *June 23 — Research complete:*',
          '   Checked every qualifying candidate — rotation gap continues:',
          '     - Sale (Braves, 2.30 ERA): pitched June 20 → June 25 ❌',
          '     - Yamamoto (Dodgers, 2.52 ERA): pitched June 20 → June 25 ❌',
          '     - Sanchez (Phillies, 1.82 ERA): pitched June 20 → June 25 ❌',
          '     - Wheeler (Phillies, 2.01 ERA): pitched June 21 → June 26 ❌',
          '     - Cease (Blue Jays, 2.71 ERA): pitched June 21 → June 26 ❌',
          '     - Skubal (Tigers, 3.02 ERA): pitched June 19 (5.2 IP, 3 ER) → June 24 ❌ (ERA above bar)',
          '     - Hunter Brown (Astros, 0.84 ERA/10.2 IP): starts June 22 game 1 vs Blue Jays → NOT June 23',
          '     - Paul Skenes (Pirates, 2.85 ERA): pitching June 21 at Coors → June 26 ❌ (Coors = skip)',
          '     - Hunter Greene (Reds, 2.76 ERA): 60-day IL (elbow surgery, back July) ❌',
          '     - Corbin Burnes (D-backs): IL setback, teres major strain, out until Sept ❌',
          '     - Lodolo (Reds): 6.12 ERA + IL blister ❌ double fail',
          '     - Gilbert (Mariners, 3.43 ERA): Mariners piggyback plan + ERA above threshold ❌',
          '     - Framber Valdez (Tigers): 4.21 ERA — fails threshold ❌',
          '   World Cup soccer (June 23 matches): Portugal vs Uzbekistan / England vs Ghana /\n' +
          '     Colombia vs DR Congo / Panama vs Croatia — ALL group stage, none Argentina/Brazil → SKIP per rule.',
          '   ✅ June 23 STATUS: 0-pick day. Rotation gap. 0 weak picks > 1 forced bet.',
          '',
          '📅 *June 24 research — SKIP:*',
          '   Skubal (Tigers, 3.02 ERA) vs Yankees at Comerica Park. ERA fails sub-3.00 threshold.',
          '   Last 2 starts: 4.2 IP (3 ER vs Guardians) + 5.2 IP (3 ER vs White Sox).',
          '   Pitch count capped ~80 (post-elbow surgery) → can\'t carry game 6+ IP.',
          '   Yankees have elite offense (Cole pitched June 22 — backend starters June 23-24).',
          '   Verdict: Skubal fails ERA bar + IP limit + opponent quality. 0-pick day June 24.',
          '',
          '📅 *June 24 — 0-pick day (confirmed):*',
          '   June 24 STATUS: 0 qualifying bets. Skubal fails ERA threshold + IP limit. (details in June 24 section above)',
          '',
          '📅 *June 25 — PICKS READY (2 bets, research pre-locked):*',
          '   TWO elite options return: Sale (Braves, 2.30 ERA) + Sanchez (Phillies, 1.82 ERA).',
          '   NOTE: Yamamoto starts June 26 NOT June 25 — Dodgers have an off day June 25 (travel MIN→SD).',
          '',
          '   🔥 BET 1 — HIGH CONFIDENCE: Phillies ML + Nationals TT under 3.5 (SGP, ~6:45 PM ET, Nationals Park)',
          '     Sanchez (Phillies, 1.82 ERA MLB-leading, 8-3, 116 Ks) vs Jake Irvin/backend (Nationals, ~5.50-6.00 ERA).',
          '     Josiah Gray on 60-day IL (flexor strain) — Nationals without their best arm.',
          '     Nationals offense ranks bottom-5 MLB in OPS against LHP. Sanchez dominates weak lineups.',
          '     Phillies bullpen ✅ VERIFIED: Duran 1.90 ERA 18 saves, Kerkering 2.03 ERA — both ≤2.50 ✅.',
          '     Nationals TT under 3.5: Poisson λ=2.0 vs Sanchez → P(X≤3) = 85.7%. Phillies ML true prob: ~70%.',
          '     PLACE at 1× standard unit.',
          '',
          '   🎯 BET 2 — CONDITIONAL: Braves ML + A\'s TT under 3.5 (SGP, ~7:20 PM ET, Truist Park)',
          '     Sale (Braves, 2.30 ERA, 8-5, 92 Ks) vs A\'s at home — 5-day rest from June 20 start.',
          '     Braves closer Iglesias: 1.08 ERA, 20:3 K:BB ratio ✅ — PASSES ≤2.50 threshold easily.',
          '     ⚠️ BULLPEN WARNING: Braves team pen ERA 6.75 over past 7 days (middle relievers dragging number).',
          '     A\'s offense: Langeliers 19 HRs, Bolte .310 — not a free pass, but Sale suppresses.',
          '     A\'s TT under 3.5: Poisson λ=2.2 vs Sale → P(X≤3) = 82%. Braves ML true prob: ~68%.',
          '     ✅ PLACE if day-of pen check shows Braves 7-day team ERA improved below 5.50.',
          '     ❌ SKIP if team pen ERA still ≥6.00 and no credible setup man available (per LESSON #5).',
          '',
          '📅 *June 26 — NEXT TARGET (preliminary):*',
          '   Yamamoto (Dodgers, 2.52 ERA) @ San Diego Padres — first start after June 20 (off day June 25).',
          '   Padres lineup: Tatis Jr. (79 H, 18 SB), Machado (12 HR, 36 RBI), Merrill (12 SB, 30 RBI) — not weak.',
          '   Randy Vasquez (Padres starter, 3.63 ERA) on other side — Dodgers offense should produce.',
          '   ⚠️ Dodgers pen still under scrutiny after June 20 walk-off. Full bullpen check REQUIRED day-of.',
          '   Status: DAY-OF RESEARCH REQUIRED. Will qualify only if Dodgers pen has stabilized.',
          '   Wheeler (Phillies, 2.01 ERA) also returns June 26 — check schedule for opponent.',
          '   Cease (Blue Jays, 2.71 ERA): returns June 26 — ERA at 2.71 is marginal, check opponent.',
          '',
          '⚙️  *Mobile delivery note:* User accesses picks on mobile only.',
          '   All picks delivered in this chat daily. Clear format, no tables, mobile-readable.',
          '   No laptop required — session picks up research automatically each day.',
        ].join('\n');

      case 'resolve': {
        // Usage: /resolve <eventId> <1|X|2>
        const eventId = Number(args[0]);
        const outcome = args[1] as '1' | 'X' | '2' | undefined;
        if (!eventId || !outcome || !['1', 'X', '2'].includes(outcome)) {
          return '❌ Usage: /resolve <eventId> <1|X|2>\nSee /picks for event IDs.';
        }
        const settled = tracker.resolvePick(eventId, outcome);
        if (settled.length === 0) {
          return `❌ No pending pick found for event ID ${eventId}`;
        }
        const lines: string[] = [];
        for (const p of settled) {
          const icon = p.status === 'won' ? '✅ WON' : '❌ LOST';
          const label = p.pick === '1' ? 'Home' : p.pick === '2' ? 'Away' : 'Draw';
          lines.push(`${icon}: ${p.match}  (${label} picked, actual: ${outcome})`);
        }
        const stats = tracker.getStats();
        lines.push('');
        lines.push(`📊 Win rate: ${(stats.winRate * 100).toFixed(1)}%  (${stats.won}W / ${stats.lost}L)`);
        const br = tracker.getBriefingData().bankroll;
        if (br && br.initial > 0) {
          const pnl = +(br.current - br.initial).toFixed(2);
          const sign = pnl >= 0 ? '+' : '';
          lines.push(`💰 Bankroll: $${br.current} (${sign}$${pnl})`);
        }
        return lines.join('\n');
      }

      case 'void': {
        // Usage: /void <eventId>
        const eventId = Number(args[0]);
        if (!eventId) return '❌ Usage: /void <eventId>\nSee /picks for event IDs.';
        const voided = tracker.voidPick(eventId);
        if (voided.length === 0) return `❌ No pending pick found for event ID ${eventId}`;
        return voided.map((p) => `⚫ Voided: ${p.match}`).join('\n');
      }

      case 'scan': {
        lastParlayDate = ''; // clear guard so scanPrematch will rebuild parlays
        void (async () => {
          await scanPrematch();
          await scanIntradayLegs();
        })();
        return '🔄 Full scan triggered — parlay picks + any new high-prob legs arriving shortly…';
      }

      case 'today': {
        const legs = [...prematchLegsCache.values()];
        if (legs.length === 0) {
          return '📋 No morning odds cached yet.\nTry /scan to build today\'s picks, or wait until 8 AM.';
        }
        const sorted = [...legs].sort((a, b) => b.impliedProb - a.impliedProb);
        const lines = [`📋 *Today's cached picks (${sorted.length}):*`, ''];
        for (const leg of sorted) {
          const ko = leg.kickoffTime
            ? new Date(leg.kickoffTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '–';
          lines.push(`  • ${leg.teamName} @ ${leg.decimalOdds} (${toAmericanBot(leg.decimalOdds)}) — ${leg.impliedProb}% prob`);
          lines.push(`    ${leg.league} | KO: ${ko}`);
        }
        return lines.join('\n');
      }

      case 'history': {
        const n = Math.min(Math.max(Number(args[0] ?? 10), 1), 20);
        const recent = tracker.recentPicks(n);
        if (recent.length === 0) return '📜 No settled picks yet.';
        const lines = [`📜 *Last ${recent.length} settled picks:*`, ''];
        for (const p of recent) {
          const icon = p.status === 'won' ? '✅' : p.status === 'lost' ? '❌' : '⚫';
          const label = p.pick === '1' ? 'Home' : p.pick === '2' ? 'Away' : 'Draw';
          const date = p.resolvedAt ? new Date(p.resolvedAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '–';
          const oddsStr = p.odds ? ` @ ${p.odds} (${toAmericanBot(p.odds)})` : '';
          const clvStr = p.clv !== undefined ? ` | CLV ${p.clv >= 0 ? '+' : ''}${p.clv}%` : '';
          lines.push(`${icon} ${p.match}`);
          lines.push(`   ${label}${oddsStr}${clvStr} — ${date}`);
        }
        return lines.join('\n');
      }

      case 'parlays': {
        if (lastParlays.length === 0) {
          return '🎰 No parlays built yet today.\nRun /scan to build today\'s parlay picks.';
        }
        await telegram.sendParlays(lastParlays, lastParlaysDate, lastResearch);
        return '';  // sendParlays already sends the message
      }

      case 'live': {
        // Show what's currently live and cached
        const liveEvts: import('./types.js').SofaEvent[] = [];
        for (const sport of config.sports) {
          try { liveEvts.push(...await activeClient.getLiveEvents(sport)); } catch { /* ok */ }
        }
        if (liveEvts.length === 0) return '⚽ No live events found right now.';
        const lines: string[] = [`🔴 *${liveEvts.length} live event(s):*`, ''];
        for (const e of liveEvts) {
          const cacheKey = teamPairKey(e.homeTeam.name, e.awayTeam.name);
          const leg = prematchLegsCache.get(cacheKey);
          const scoreStr = e.homeScore?.current !== undefined
            ? ` ${e.homeScore.current}–${e.awayScore?.current ?? 0}` : '';
          const oddsInfo = leg ? ` | 📈 ${leg.teamName} fav @ ${leg.decimalOdds} (${leg.impliedProb}%)` : '';
          lines.push(`• ${e.homeTeam.name} vs ${e.awayTeam.name}${scoreStr}${oddsInfo}`);
          if (!leg) lines.push(`  _(no cached odds — run at 8 AM for pre-match prices)_`);
        }
        return lines.join('\n');
      }

      case 'help':
        return [
          '🤖 *Available commands:*',
          '',
          '/status — win rate & stats summary',
          '/picks — pending picks with odds, edge, CLV',
          '/parlays — re-send today\'s parlay recommendations',
          '/today — today\'s cached morning odds legs',
          '/live — live games with cached odds',
          '/history [n] — last N settled picks (default 10)',
          '/rules — full betting rules & double-check protocol',
          '/scan — force new odds scan (parlays + intraday legs)',
          '/resolve <id> <1|X|2> — mark a bet result',
          '/void <id> — cancel a pick',
          '/bankroll — P&L vs starting bankroll',
          '/blacklist — auto-blacklisted leagues',
          '/help — this message',
          '',
          '🔁 *Auto-scan schedule:*',
          '  • Morning scan: 8 AM (parlays + full research)',
          '  • Intraday: every 2 h (new legs + research alert)',
          '  • Live polling: every 30 s when games are on',
        ].join('\n');

      default:
        return `Unknown command /${cmd}. Try /help`;
    }
  });

  const poll = async () => {
    const now = Date.now();

    // Daily briefing — send once when the clock reaches the configured hour
    const localNow = new Date();
    const todayStr = localNow.toISOString().slice(0, 10);
    if (localNow.getHours() >= config.dailyBriefingHour && lastBriefingDate !== todayStr) {
      lastBriefingDate = todayStr;
      const briefing = tracker.getBriefingData();
      await telegram.sendDailyBriefing({
        date: todayStr,
        yesterdayWon: briefing.yesterday.won,
        yesterdayLost: briefing.yesterday.lost,
        yesterdayPending: briefing.yesterday.pending,
        totalPicks: briefing.overall.total,
        totalWon: briefing.overall.won,
        winRate: briefing.overall.winRate,
        picksToday: tracker.picksToday(),
        maxPicksPerDay: config.maxPicksPerDay,
        bankroll: briefing.bankroll,
        blacklistedLeagues: briefing.blacklistedLeagues,
        avgClv: briefing.avgClv,
      });
    }

    // Retry primary after cooldown expires
    if (fallbackTier > 0 && now > rateLimitedUntil) {
      fallbackTier = 0;
      activeClient = primary;
      activeName = 'SofaScore';
      console.log(`[${new Date().toISOString()}] 🔄 Retrying primary API (SofaScore)…`);
    }

    try {
      const liveEvents = await fetchAllLive(activeClient, config.sports);
      liveCount = liveEvents.length;

      // When primary returns nothing, probe fallbacks for cache-based matching only.
      // SofaScore has patchy live coverage for some sports (e.g. MLB on US evening times).
      let cacheLiveEvents = liveEvents;
      if (liveEvents.length === 0 && fallbackTier === 0) {
        try {
          const fbEvents = await fetchAllLive(fallback, config.sports);
          if (fbEvents.length > 0) {
            console.log(`[${new Date().toISOString()}] [Probe] SofaScore empty — ${fbEvents.length} live via AllScores`);
            cacheLiveEvents = fbEvents;
          } else if (config.xbetApiKey) {
            const xbEvents = await fetchAllLive(xbet, config.sports);
            if (xbEvents.length > 0) {
              console.log(`[${new Date().toISOString()}] [Probe] SofaScore empty — ${xbEvents.length} live via 1xBet`);
              cacheLiveEvents = xbEvents;
            }
          }
        } catch { /* non-fatal — cache matching will just skip */ }
      }

      const oddsMap = await fetchOddsForEvents(activeClient, liveEvents);
      const alerts = liveAnalyzer.analyzeEvents(liveEvents, oddsMap);

      if (alerts.length > 0) alerts.forEach(printAlert);
      else {
        console.log(
          `[${new Date().toISOString()}] [${activeName}] No changes — ${liveAnalyzer.liveCount} live event(s) tracked`
        );
      }

      // ── Cache-based live picks (works for ANY source including AllScores) ──────
      // Match live events against pre-match odds cached at 8 AM by team names.
      for (const event of cacheLiveEvents) {
        const matchKey = teamPairKey(event.homeTeam.name, event.awayTeam.name);
        if (analyzedMatchKeys.has(matchKey)) continue;
        const league = event.tournament?.name ?? '';
        if (!isLeagueAllowed(league, config.allowedLeagues)) continue;

        const cacheKey = matchKey;
        const cachedLeg = prematchLegsCache.get(cacheKey);
        if (!cachedLeg) continue;

        // Found a cached pre-match pick for this live game
        analyzedMatchKeys.add(matchKey);
        console.log(`[Live] 🎯 Matched live game "${event.homeTeam.name} vs ${event.awayTeam.name}" to pre-match odds`);

        if (tracker.isLeagueBlacklisted(league || cachedLeg.league)) continue;

        const liveAnalysis: import('./types.js').FormAnalysis = {
          eventId: event.id,
          match: `${event.homeTeam.name} vs ${event.awayTeam.name}`,
          sport: cachedLeg.sport,
          league: league || cachedLeg.league,
          homeConfidence: cachedLeg.pick === '1' ? cachedLeg.impliedProb : Math.round(100 - cachedLeg.impliedProb),
          awayConfidence: cachedLeg.pick === '2' ? cachedLeg.impliedProb : Math.round(100 - cachedLeg.impliedProb),
          pick: cachedLeg.pick,
          confidence: cachedLeg.impliedProb,
          reasoning: [
            `${cachedLeg.teamName} is the bookmakers' moneyline favorite`,
            `Implied probability: ${cachedLeg.impliedProb}% at odds ${cachedLeg.decimalOdds}`,
            `Based on pre-match bookmaker prices`,
          ],
          signals: { formScore: 0, h2hScore: 0, goalsScore: 0 },
        };

        const decision = strategy.evaluate(
          liveAnalysis,
          tracker.picksToday(),
          tracker.recentPicks(),
          cachedLeg.decimalOdds
        );

        const stars = decision.starRating === 3 ? '⭐⭐⭐' : decision.starRating === 2 ? '⭐⭐' : '⭐';
        console.log(`\n💡 LIVE ODDS PICK ${stars}`);
        console.log(`   Match: ${liveAnalysis.match} | Pick: ${cachedLeg.teamName} | ${cachedLeg.impliedProb}% @ ${cachedLeg.decimalOdds}`);
        decision.reasons.forEach((r) => console.log(`   ↳ ${r}`));

        if (!decision.approved) {
          console.log(`   ❌ Rejected\n`);
          continue;
        }
        console.log(`   ✅ Approved — stake: $${decision.stake}\n`);
        const pick = tracker.recordPick(liveAnalysis, cachedLeg.decimalOdds, decision.stake, decision.edge, 'live');
        await telegram.sendPick(pick, liveAnalysis);
        // Schedule CLV check: fetch closing line ≤90 min before kickoff
        if (cachedLeg.kickoffTime) {
          clvSchedule.set(cachedLeg.eventId, {
            leg: cachedLeg,
            kickoffMs: new Date(cachedLeg.kickoffTime).getTime(),
            sampled: false,
          });
        }
      }

      // ── Form-based live picks (SofaScore events only — requires real event IDs) ─
      const newEvents = liveEvents.filter(
        (e) => e._source === 'sofascore' &&
               !analyzedEventIds.has(e.id) &&
               isLeagueAllowed(e.tournament?.name ?? '', config.allowedLeagues)
      );

      for (const event of newEvents) {
        analyzedEventIds.add(event.id);
        const analysis = await formAnalyzer.analyze(event);
        if (!analysis) continue;

        // League blacklist check
        if (tracker.isLeagueBlacklisted(analysis.league)) {
          console.log(`[Form] ${analysis.match} — league "${analysis.league}" is blacklisted (poor win rate), skipping`);
          continue;
        }

        const threshold = tracker.threshold;
        if (analysis.confidence < threshold) {
          console.log(
            `[Form] ${analysis.match} — confidence ${analysis.confidence}% (below ${threshold}% threshold, skipping)`
          );
          continue;
        }

        // Strategy evaluation
        const markets = oddsMap.get(event.id);
        const oddsDecimal = getPickOdds(markets, analysis.pick);
        const decision = strategy.evaluate(
          analysis,
          tracker.picksToday(),
          tracker.recentPicks(),
          oddsDecimal
        );

        const pickLabel = analysis.pick === '1' ? 'Home Win' : analysis.pick === '2' ? 'Away Win' : 'Draw';
        const stars = decision.starRating === 3 ? '⭐⭐⭐' : decision.starRating === 2 ? '⭐⭐' : '⭐';

        console.log(`\n💡 PICK CANDIDATE ${stars}`);
        console.log(`   Match      : ${analysis.match}`);
        console.log(`   League     : ${analysis.league}`);
        console.log(`   Pick       : ${pickLabel}`);
        console.log(`   Confidence : ${analysis.confidence}%`);
        if (oddsDecimal) console.log(`   Odds       : ${oddsDecimal} (decimal)`);
        if (decision.edge !== 0) console.log(`   Edge       : +${decision.edge}%`);
        analysis.reasoning.forEach((r) => console.log(`   • ${r}`));

        // Print strategy verdict
        console.log(`\n   Strategy verdict:`);
        decision.reasons.forEach((r) => console.log(`   ↳ ${r}`));
        if (decision.warnings.length > 0) {
          decision.warnings.forEach((w) => console.log(`   ${w}`));
        }

        if (!decision.approved) {
          console.log(`   ❌ Pick REJECTED — skipping\n`);
          continue;
        }

        console.log(`   ✅ Pick APPROVED — stake: $${decision.stake}\n`);

        const pick = tracker.recordPick(analysis, oddsDecimal, decision.stake, decision.edge, 'live');
        await telegram.sendPick(pick, analysis);
      }

      // Resolve picks for events that just ended
      const endedAlerts = alerts.filter((a) => a.type === 'event_ended');
      for (const alert of endedAlerts) {
        const event = liveEvents.find((e) => e.id === alert.eventId);
        if (!event) continue;
        const homeG = event.homeScore?.current ?? 0;
        const awayG = event.awayScore?.current ?? 0;
        const actual = homeG > awayG ? '1' : awayG > homeG ? '2' : 'X';
        const settled = tracker.resolvePick(alert.eventId, actual as '1' | 'X' | '2');
        console.log(`[Tracker] Resolved event ${alert.eventId} → ${actual} (${alert.match})`);
        // Sync any self-learned weights back to the form analyzer
        formAnalyzer.updateWeights(tracker.formAnalyzerWeights);
        // Notify Telegram for each settled pick
        for (const pick of settled) {
          const icon = pick.status === 'won' ? '✅ WON' : '❌ LOST';
          console.log(`[Tracker] ${icon}: ${pick.match}  (picked ${pick.pick}, actual ${actual})`);
          await telegram.sendResolution(
            pick,
            { home: homeG, away: awayG },
            tracker.getBriefingData().bankroll
          );
        }
      }

      // Check CLV schedule — non-fatal, errors swallowed inside
      await checkClvSchedule();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isRateLimitError(err)) {
        rateLimitedUntil = Date.now() + 5 * 60 * 1_000;
        if (fallbackTier === 0) {
          fallbackTier = 1;
          activeClient = fallback;
          activeName = 'AllScores';
          console.warn(`[${new Date().toISOString()}] ⚠️  SofaScore rate-limited — switching to AllScores for 5 min`);
        } else if (fallbackTier === 1 && config.xbetApiKey) {
          fallbackTier = 2;
          activeClient = xbet;
          activeName = '1xBet';
          console.warn(`[${new Date().toISOString()}] ⚠️  AllScores rate-limited — switching to 1xBet for 5 min`);
        } else {
          console.warn(`[${new Date().toISOString()}] ⚠️  All APIs rate-limited — waiting for cooldown`);
        }
      } else {
        console.error(`❌ Poll error [${activeName}]: ${msg}`);
      }
    }
  };

  // ── Pre-match scanner ────────────────────────────────────────────────────────

  const scanPrematch = async () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    console.log(`\n[Pre-match] Scanning today's scheduled events (${dateStr})…`);

    // ── Step 1: Odds-based parlays — built and sent ONCE per calendar day ─────
    if (lastParlayDate === dateStr) {
      console.log(`[Pre-match] Parlays already sent today (${dateStr}) — skipping`);
    } else {
      const parlayOpts = {
        sports: config.sports,
        // First priority: MLB, NBA, Soccer — only scan other sports if these don't
        // yield enough qualifying legs for 3 parlays.
        prioritySports: ['baseball', 'basketball', 'football'],
        allowedLeagues: config.allowedLeagues,
        isLeagueAllowed,
        minImpliedProb: 60,    // Sahil's rule: ≥60% true win probability per leg
        legsPerParlay: 3,      // 3-leg parlays target +350–+450 combined at 60% per leg
        parlayCount: 3,
        maxEventsPerSport: 20,
      };

      let parlays: OddsParlay[] = [];
      console.log(`[Pre-match] Building odds-based moneyline parlays (primary)…`);
      try {
        parlays = await scanOddsParlays(primary, parlayOpts);
      } catch (err) {
        console.error(`[Pre-match] Primary odds scan error: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Fall back to 1xBet when primary returns nothing (rate-limited or no data)
      if (parlays.length === 0 && config.xbetApiKey) {
        console.log(`[Pre-match] Primary returned 0 parlays — trying 1xBet API…`);
        try {
          parlays = await scanOddsParlays(xbet, parlayOpts);
        } catch (err) {
          console.error(`[Pre-match] 1xBet odds scan error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (parlays.length > 0) {
        console.log(`[Pre-match] ✅ ${parlays.length} parlay(s) built — sending to Telegram`);
        parlays.forEach((p) => {
          console.log(`  Parlay ${p.id}: ${p.legs.map((l) => l.teamName).join(' + ')} @ ${p.combinedOdds} (${p.combinedProb}%)`);
        });
      } else {
        console.log(`[Pre-match] No odds-based parlays today (no odds available or all below threshold)`);
      }

      // ── Research: probable pitchers + ESPN headlines + weather ────────────
      const researchMap = new Map<string, LegResearch>();
      try {
        const pitcherMap = await fetchMLBProbablePitchers(dateStr);
        const allLegsToResearch = parlays.flatMap((p) => p.legs);
        await Promise.all(
          allLegsToResearch.map(async (leg) => {
            const research = await researchLeg(
              leg.teamName,
              leg.sport,
              pitcherMap,
              config.openWeatherApiKey,
            );
            researchMap.set(leg.teamName, research);
          })
        );
        const pitcherCount = [...researchMap.values()].filter((r) => r.pitcher?.isConfirmed).length;
        const newsCount = [...researchMap.values()].reduce((n, r) => n + r.newsHeadlines.length, 0);
        console.log(`[Research] Pitchers confirmed: ${pitcherCount} | News headlines: ${newsCount}`);
      } catch (err) {
        console.warn(`[Research] Non-fatal error: ${err instanceof Error ? err.message : String(err)}`);
      }

      await telegram.sendParlays(parlays, dateStr, researchMap);
      lastParlayDate = dateStr;
      lastParlays = parlays;
      lastParlaysDate = dateStr;
      lastResearch = researchMap;

      // ── Populate live-match cache from ALL qualifying legs (wider than parlay picks) ──
      // This allows live event matching even when the API is rate-limited during polling.
      const oddsClient = parlays.length === 0 && config.xbetApiKey ? xbet : primary;
      try {
        const allLegs = await scanAllOddsLegs(oddsClient, parlayOpts);
        prematchLegsCache.clear();
        for (const leg of allLegs) {
          const parts = leg.match.split(' vs ');
          const home = parts[0] ?? '';
          const away = parts[1] ?? '';
          prematchLegsCache.set(teamPairKey(home, away), leg);
        }
        console.log(`[Pre-match] Cached ${prematchLegsCache.size} pre-match leg(s) for live match lookup`);
        savePrematchCache();
        // Mark morning legs as already alerted so intraday scan doesn't duplicate them
        for (const leg of allLegs) {
          intradayAlertedLegs.add(`${leg.teamName}|${dateStr}`);
        }
      } catch {
        // cache population failure is non-fatal
      }
    }

    // ── Step 2: Form-based individual picks (bonus, when data available) ───
    const scheduled: SofaEvent[] = [];
    for (const sport of config.sports) {
      try {
        const events = await primary.getScheduledEvents(sport);
        scheduled.push(...events);
      } catch {
        // ignore per-sport failures
      }
    }

    const toAnalyze = scheduled
      .filter((e) => !analyzedEventIds.has(e.id))
      .filter((e) => isLeagueAllowed(e.tournament?.name ?? '', config.allowedLeagues))
      .slice(0, config.maxPreMatchEventsPerScan);

    console.log(`[Pre-match] ${toAnalyze.length} match(es) to form-analyze`);

    for (const event of toAnalyze) {
      analyzedEventIds.add(event.id);

      const analysis = await formAnalyzer.analyze(event);
      if (!analysis) continue;

      if (tracker.isLeagueBlacklisted(analysis.league)) continue;
      if (analysis.confidence < tracker.threshold) continue;

      const markets = await primary.getEventOdds(event.id);
      const oddsDecimal = getPickOdds(markets.length > 0 ? markets : undefined, analysis.pick);
      const decision = strategy.evaluate(
        analysis,
        tracker.picksToday(),
        tracker.recentPicks(),
        oddsDecimal
      );

      if (!decision.approved) continue;

      const pick = tracker.recordPick(analysis, oddsDecimal, decision.stake, decision.edge, 'prematch');
      await telegram.sendPick(pick, analysis);
    }
  };

  // Kickoff reminders — check every 5 minutes for pre-match picks kicking off within the hour
  const checkKickoffReminders = async () => {
    const duePicks = tracker.pendingPreMatchNearKickoff(5, 60);
    for (const pick of duePicks) {
      const minsUntil = (new Date(pick.kickoffTime!).getTime() - Date.now()) / 60_000;
      console.log(`[Reminder] ⏰ ${pick.match} kicks off in ~${Math.round(minsUntil)} min — sending alert`);
      await telegram.sendKickoffReminder(pick, minsUntil);
      tracker.markReminderSent(pick.id);
    }
  };
  setInterval(checkKickoffReminders, 5 * 60 * 1_000);

  // Print stats every hour
  setInterval(async () => {
    const summary = tracker.getSummary();
    console.log(summary);
    await telegram.sendStats(summary);
  }, 60 * 60 * 1_000);

  // ── Smart scheduler ─────────────────────────────────────────────────────────
  //
  // Active window : 8:00 AM – 1:00 AM (local time) — covers all MLB, NBA,
  //                 European football, and MLS kick-off times.
  // Dead window   : 1:00 AM – 8:00 AM — zero API calls, bot sleeps.
  //
  // During active window:
  //   • Live events found  → poll every 30 s (normal interval)
  //   • No live events     → poll every 10 min (just watching for kick-offs)
  // ─────────────────────────────────────────────────────────────────────────────

  const ACTIVE_START_HOUR = 8;   // 8:00 AM
  const ACTIVE_END_HOUR   = 25;  // 1:00 AM next day (25 = 24 + 1)

  /** Returns ms until the next active window starts, or 0 if already active. */
  const msUntilActiveWindow = (): number => {
    const now = new Date();
    const h = now.getHours() + now.getMinutes() / 60;
    const adjustedH = h < ACTIVE_START_HOUR ? h + 24 : h; // treat post-midnight as 24+

    if (adjustedH >= ACTIVE_START_HOUR && adjustedH < ACTIVE_END_HOUR) {
      return 0; // currently active
    }

    // Calculate ms until 8:00 AM today (or tomorrow)
    const wakeUp = new Date(now);
    wakeUp.setHours(ACTIVE_START_HOUR, 0, 0, 0);
    if (wakeUp.getTime() <= now.getTime()) {
      wakeUp.setDate(wakeUp.getDate() + 1); // already past 8 AM today → tomorrow
    }
    return wakeUp.getTime() - now.getTime();
  };

  let prematchScanned = false;

  const scheduleNextPoll = (hadLiveEvents: boolean) => {
    const sleepMs = msUntilActiveWindow();

    if (sleepMs > 0) {
      // Outside active window — sleep until 8 AM, no API calls
      const wakeStr = new Date(Date.now() + sleepMs).toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit',
      });
      console.log(`[Scheduler] 🌙 No active matches window — sleeping until ${wakeStr} (0 API calls until then)`);
      prematchScanned = false;       // re-scan when we wake up
      lastParlayDate = '';           // allow fresh parlay build on new day
      intradayAlertedLegs.clear();   // reset intraday tracker for the new day
      setTimeout(adaptivePoll, sleepMs);
      return;
    }

    // Inside active window — adaptive interval
    const nextMs = hadLiveEvents ? config.pollIntervalMs : 10 * 60 * 1_000;
    if (!hadLiveEvents) {
      console.log(`[Scheduler] ⏳ No live events — checking again in 10 min`);
    }
    setTimeout(adaptivePoll, nextMs);
  };

  // ── Intraday leg scanner ─────────────────────────────────────────────────────
  // Runs every 2 hours during the active window. Finds any NEW qualifying
  // moneyline legs (≥60% implied prob) that weren't in the morning parlay scan,
  // runs full research on each, and fires a Telegram alert.
  const scanIntradayLegs = async () => {
    if (msUntilActiveWindow() !== 0) return; // only during active window
    const dateStr = new Date().toISOString().slice(0, 10);
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    console.log(`\n[Intraday] Scanning for high-prob legs @ ${timeStr}…`);

    const opts = {
      sports: config.sports,
      prioritySports: ['baseball', 'basketball', 'football'],
      allowedLeagues: config.allowedLeagues,
      isLeagueAllowed,
      minImpliedProb: 60,
      maxEventsPerSport: 20,
    };

    let allLegs: import('./odds-picker.js').MoneylineLeg[] = [];
    try {
      allLegs = await scanAllOddsLegs(primary, opts);
    } catch {
      if (config.xbetApiKey) {
        try { allLegs = await scanAllOddsLegs(xbet, opts); } catch { /* noop */ }
      }
    }

    const newLegs = allLegs.filter((leg) => !intradayAlertedLegs.has(`${leg.teamName}|${dateStr}`));

    if (newLegs.length === 0) {
      console.log(`[Intraday] No new qualifying legs since last scan`);
      return;
    }

    console.log(`[Intraday] ${newLegs.length} new leg(s) found — researching…`);
    let pitcherMap: Awaited<ReturnType<typeof fetchMLBProbablePitchers>>;
    try {
      pitcherMap = await fetchMLBProbablePitchers(dateStr);
    } catch {
      pitcherMap = new Map();
    }

    for (const leg of newLegs) {
      // Mark before async ops to prevent duplicate alerts on concurrent runs
      intradayAlertedLegs.add(`${leg.teamName}|${dateStr}`);
      try {
        const research = await researchLeg(leg.teamName, leg.sport, pitcherMap, config.openWeatherApiKey);
        await telegram.sendLegOpportunity(leg, research, dateStr);
        console.log(`[Intraday] ✅ Alert sent: ${leg.teamName} (${leg.impliedProb}% @ ${leg.decimalOdds})`);
      } catch (err) {
        console.warn(`[Intraday] Error for ${leg.teamName}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  const adaptivePoll = async () => {
    // Run pre-match scan once at the start of each active window
    if (!prematchScanned) {
      prematchScanned = true;
      await scanPrematch();
      // Immediately check for any evening legs the morning scan may have missed
      await scanIntradayLegs();
    }
    await poll();
    scheduleNextPoll(liveCount > 0);
  };

  // Re-run pre-match form analysis every 4 h during the active window
  setInterval(async () => {
    if (msUntilActiveWindow() === 0) await scanPrematch();
  }, 4 * 60 * 60 * 1_000);

  // Check for new high-prob legs every 2 h during the active window
  setInterval(async () => {
    if (msUntilActiveWindow() === 0) await scanIntradayLegs();
  }, 2 * 60 * 60 * 1_000);

  loadPrematchCache();
  await adaptivePoll();
}

runBot().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
