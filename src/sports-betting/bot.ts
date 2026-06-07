import 'dotenv/config';
import { SofaScoreClient, AllScoresClient } from './api-client.js';
import { BettingAnalyzer } from './analyzer.js';
import { FormAnalyzer } from './form-analyzer.js';
import { BetTracker } from './bet-tracker.js';
import { TelegramNotifier } from './telegram.js';
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

  let activeName = 'SofaScore';
  let activeClient: LiveClient = primary;
  let rateLimitedUntil = 0;

  // Track which events we've already run form analysis on
  const analyzedEventIds = new Set<number>();

  console.log('🤖 Smart Sports Betting Bot');
  console.log(`   Primary   : ${config.apiHost}`);
  console.log(`   Fallback  : ${config.fallbackApiHost}`);
  console.log(`   Sports    : ${config.sports.join(', ')}`);
  console.log(`   Poll      : ${config.pollIntervalMs / 1_000}s`);
  console.log(`   Min conf. : ${tracker.threshold}% (self-adjusting)`);
  console.log('─'.repeat(60));
  console.log(tracker.getSummary());
  console.log('─'.repeat(60));

  const poll = async () => {
    const now = Date.now();

    if (activeClient !== primary && now > rateLimitedUntil) {
      activeClient = primary;
      activeName = 'SofaScore';
      console.log(`[${new Date().toISOString()}] 🔄 Retrying primary API (SofaScore)…`);
    }

    try {
      const liveEvents = await fetchAllLive(activeClient, config.sports);
      const oddsMap = await fetchOddsForEvents(activeClient, liveEvents);
      const alerts = liveAnalyzer.analyzeEvents(liveEvents, oddsMap);

      // Print live alerts
      if (alerts.length > 0) alerts.forEach(printAlert);
      else {
        console.log(
          `[${new Date().toISOString()}] [${activeName}] No changes — ${liveAnalyzer.liveCount} live event(s) tracked`
        );
      }

      // Form analysis on new events only (SofaScore source required for team IDs)
      const newEvents = liveEvents.filter(
        (e) => e._source === 'sofascore' && !analyzedEventIds.has(e.id)
      );

      for (const event of newEvents) {
        analyzedEventIds.add(event.id);
        const analysis = await formAnalyzer.analyze(event);
        if (!analysis) continue;

        const threshold = tracker.threshold;
        if (analysis.confidence < threshold) {
          console.log(
            `[Form] ${analysis.match} — confidence ${analysis.confidence}% (below ${threshold}% threshold, skipping)`
          );
          continue;
        }

        const pickLabel = analysis.pick === '1' ? 'Home Win' : analysis.pick === '2' ? 'Away Win' : 'Draw';
        const stars = analysis.confidence >= 80 ? '⭐⭐⭐' : analysis.confidence >= 70 ? '⭐⭐' : '⭐';

        console.log(`\n💡 HIGH CONFIDENCE PICK ${stars}`);
        console.log(`   Match      : ${analysis.match}`);
        console.log(`   League     : ${analysis.league}`);
        console.log(`   Pick       : ${pickLabel}`);
        console.log(`   Confidence : ${analysis.confidence}%`);
        analysis.reasoning.forEach((r) => console.log(`   • ${r}`));
        console.log('');

        const pick = tracker.recordPick(analysis);
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
