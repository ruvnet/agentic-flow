import 'dotenv/config';
import { SofaScoreClient, AllScoresClient } from './api-client.js';
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

type LiveClient = SofaScoreClient | AllScoresClient;

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

async function runBot(): Promise<void> {
  const config = loadConfig();
  const primary = new SofaScoreClient(config);
  const fallback = new AllScoresClient(config);
  const liveAnalyzer = new BettingAnalyzer(config.oddsMovementThresholdPct);
  const formAnalyzer = new FormAnalyzer(primary);
  const tracker = new BetTracker(config.betDataFile);
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
  let rateLimitedUntil = 0;
  let lastBriefingDate = '';

  const analyzedEventIds = new Set<number>();

  console.log('🤖 Smart Sports Betting Bot');
  console.log(`   Primary   : ${config.apiHost}`);
  console.log(`   Fallback  : ${config.fallbackApiHost}`);
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
        bankroll: config.bankroll > 0 ? config.bankroll : undefined,
        blacklistedLeagues: briefing.blacklistedLeagues,
      });
    }

    if (activeClient !== primary && now > rateLimitedUntil) {
      activeClient = primary;
      activeName = 'SofaScore';
      console.log(`[${new Date().toISOString()}] 🔄 Retrying primary API (SofaScore)…`);
    }

    try {
      const liveEvents = await fetchAllLive(activeClient, config.sports);
      const oddsMap = await fetchOddsForEvents(activeClient, liveEvents);
      const alerts = liveAnalyzer.analyzeEvents(liveEvents, oddsMap);

      if (alerts.length > 0) alerts.forEach(printAlert);
      else {
        console.log(
          `[${new Date().toISOString()}] [${activeName}] No changes — ${liveAnalyzer.liveCount} live event(s) tracked`
        );
      }

      const newEvents = liveEvents.filter(
        (e) => e._source === 'sofascore' && !analyzedEventIds.has(e.id)
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

        const pick = tracker.recordPick(analysis, oddsDecimal, decision.stake, decision.edge);
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
        tracker.resolvePick(alert.eventId, actual as '1' | 'X' | '2');
        console.log(`[Tracker] Resolved event ${alert.eventId} → ${actual} (${alert.match})`);
        // Sync any self-learned weights back to the form analyzer
        formAnalyzer.updateWeights(tracker.formAnalyzerWeights);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (activeClient === primary && isRateLimitError(err)) {
        rateLimitedUntil = Date.now() + 5 * 60 * 1_000;
        activeClient = fallback;
        activeName = 'AllScores';
        console.warn(`[${new Date().toISOString()}] ⚠️  Rate-limited — switching to AllScores for 5 min`);
      } else {
        console.error(`❌ Poll error [${activeName}]: ${msg}`);
      }
    }
  };

  // Print stats every hour
  setInterval(async () => {
    const summary = tracker.getSummary();
    console.log(summary);
    await telegram.sendStats(summary);
  }, 60 * 60 * 1_000);

  await poll();
  setInterval(poll, config.pollIntervalMs);
}

runBot().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
