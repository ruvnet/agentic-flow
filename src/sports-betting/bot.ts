import 'dotenv/config';
import { SofaScoreClient, AllScoresClient, XBetClient } from './api-client.js';
import { BettingAnalyzer } from './analyzer.js';
import { FormAnalyzer } from './form-analyzer.js';
import { BetTracker } from './bet-tracker.js';
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
    sports: (process.env.SPORTS ?? 'football,basketball,tennis').split(',').map((s) => s.trim()),
    timezone: process.env.TIMEZONE ?? 'America/Chicago',
    minConfidence: Number(process.env.MIN_CONFIDENCE ?? 65),
    telegramToken: process.env.TELEGRAM_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    betDataFile: process.env.BET_DATA_FILE ?? './betting-data.json',
    bankroll: Number(process.env.BANKROLL ?? 0),
    unitPct: Number(process.env.UNIT_PCT ?? 2),
    maxPicksPerDay: Number(process.env.MAX_PICKS_PER_DAY ?? 3),
    minEdgePct: Number(process.env.MIN_EDGE_PCT ?? 5),
    antiChaseAfterLosses: Number(process.env.ANTI_CHASE_LOSSES ?? 3),
    dailyBriefingHour: Number(process.env.DAILY_BRIEFING_HOUR ?? 8),
    maxPreMatchEventsPerScan: Number(process.env.MAX_PREMATCH_EVENTS ?? 30),
    xbetApiKey: process.env.XBET_RAPIDAPI_KEY,
    xbetApiHost: process.env.XBET_RAPIDAPI_HOST ?? '1xbet12.p.rapidapi.com',
    allowedLeagues: process.env.ALLOWED_LEAGUES
      ? process.env.ALLOWED_LEAGUES === '*'
        ? []           // '*' = allow all leagues
        : process.env.ALLOWED_LEAGUES.split(',').map((l) => l.trim())
      : [],            // empty = use built-in default list
  };
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
  // Football
  'Premier League', 'La Liga', 'LaLiga', 'Serie A', 'Bundesliga', 'Ligue 1',
  'Champions League', 'Europa League', 'Conference League',
  'MLS', 'Championship', 'Eredivisie', 'Primeira Liga', 'Super Lig',
  'Serie B', 'La Liga 2', '2. Bundesliga',
  // Basketball
  'NBA', 'EuroLeague',
  // Baseball
  'MLB',
  // American Football
  'NFL',
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
  // Shared across poll() and scheduleNextPoll() via closure
  let liveCount = 0;

  // Seed from persisted picks so restarts don't produce duplicate picks
  const analyzedEventIds = tracker.pickedEventIds();

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
          const label = p.pick === '1' ? 'Home' : p.pick === '2' ? 'Away' : 'Draw';
          const ko = p.kickoffTime
            ? ` @ ${new Date(p.kickoffTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : '';
          lines.push(`• ${p.match}${ko} → ${label} [${p.confidence}%]`);
          lines.push(`  Event ID: ${p.eventId}`);
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

      case 'help':
        return [
          '🤖 *Available commands:*',
          '',
          '/status — win rate & stats summary',
          '/picks — list pending picks with event IDs',
          '/resolve <id> <1|X|2> — mark a bet result',
          '/void <id> — cancel a pick',
          '/bankroll — P&L vs starting bankroll',
          '/blacklist — leagues blocked by auto-blacklist',
          '/help — this message',
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
      const oddsMap = await fetchOddsForEvents(activeClient, liveEvents);
      const alerts = liveAnalyzer.analyzeEvents(liveEvents, oddsMap);

      if (alerts.length > 0) alerts.forEach(printAlert);
      else {
        console.log(
          `[${new Date().toISOString()}] [${activeName}] No changes — ${liveAnalyzer.liveCount} live event(s) tracked`
        );
      }

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

    const leagueMode = config.allowedLeagues.length > 0
      ? `custom list (${config.allowedLeagues.length} leagues)`
      : `top leagues only`;
    console.log(`[Pre-match] ${toAnalyze.length} match(es) to analyze — ${leagueMode}, cap: ${config.maxPreMatchEventsPerScan}`);

    for (const event of toAnalyze) {
      analyzedEventIds.add(event.id); // prevent re-pick when it goes live

      const analysis = await formAnalyzer.analyze(event);
      if (!analysis) continue;

      if (tracker.isLeagueBlacklisted(analysis.league)) {
        console.log(`[Pre-match] ${analysis.match} — league blacklisted, skipping`);
        continue;
      }

      if (analysis.confidence < tracker.threshold) {
        console.log(
          `[Pre-match] ${analysis.match} — confidence ${analysis.confidence}% (below ${tracker.threshold}%, skipping)`
        );
        continue;
      }

      const markets = await primary.getEventOdds(event.id);
      const oddsDecimal = getPickOdds(markets.length > 0 ? markets : undefined, analysis.pick);
      const decision = strategy.evaluate(
        analysis,
        tracker.picksToday(),
        tracker.recentPicks(),
        oddsDecimal
      );

      const pickLabel = analysis.pick === '1' ? 'Home Win' : analysis.pick === '2' ? 'Away Win' : 'Draw';
      const stars = decision.starRating === 3 ? '⭐⭐⭐' : decision.starRating === 2 ? '⭐⭐' : '⭐';
      const kickoffStr = analysis.kickoffTime
        ? new Date(analysis.kickoffTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'TBD';

      console.log(`\n🗓️  PRE-MATCH CANDIDATE ${stars}`);
      console.log(`   Match      : ${analysis.match}`);
      console.log(`   Kickoff    : ${kickoffStr}`);
      console.log(`   League     : ${analysis.league}`);
      console.log(`   Pick       : ${pickLabel}`);
      console.log(`   Confidence : ${analysis.confidence}%`);
      if (oddsDecimal) console.log(`   Odds       : ${oddsDecimal} (decimal)`);
      if (decision.edge !== 0) console.log(`   Edge       : +${decision.edge}%`);
      decision.reasons.forEach((r) => console.log(`   ↳ ${r}`));
      if (decision.warnings.length > 0) {
        decision.warnings.forEach((w) => console.log(`   ${w}`));
      }

      if (!decision.approved) {
        console.log(`   ❌ Pick REJECTED\n`);
        continue;
      }

      console.log(`   ✅ Pick APPROVED — stake: $${decision.stake}\n`);
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

  // Run pre-match scan at startup then every 4 hours (re-scans pick up late additions)
  await scanPrematch();
  setInterval(scanPrematch, 4 * 60 * 60 * 1_000);

  /**
   * Adaptive poll scheduling — saves API quota when nothing is happening.
   *
   * Dead hours  (2–8 AM local): poll every 15 min  (no top leagues active)
   * No live events:             poll every 5 min   (check for kick-offs)
   * Live events active:         poll at normal interval (default 30 s)
   */
  const scheduleNextPoll = (hadLiveEvents: boolean) => {
    const hour = new Date().getHours();
    const isDeadHours = hour >= 2 && hour < 8;

    let nextMs: number;
    let reason: string;
    if (isDeadHours) {
      nextMs = 15 * 60 * 1_000;
      reason = 'dead hours (2–8 AM) — next poll in 15 min';
    } else if (!hadLiveEvents) {
      nextMs = 5 * 60 * 1_000;
      reason = 'no live events — next poll in 5 min';
    } else {
      nextMs = config.pollIntervalMs;
      reason = '';
    }

    if (reason) {
      console.log(`[Scheduler] 💤 ${reason}`);
    }

    setTimeout(adaptivePoll, nextMs);
  };

  const adaptivePoll = async () => {
    await poll();
    // liveCount is set inside poll() via closure
    scheduleNextPoll(liveCount > 0);
  };

  await adaptivePoll();
}

runBot().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
