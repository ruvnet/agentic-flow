import 'dotenv/config';
import { SofaScoreClient, AllScoresClient } from './api-client.js';
import { BettingAnalyzer } from './analyzer.js';
import type { BotConfig, BettingAlert, OddsMarket, SofaEvent } from './types.js';

function loadConfig(): BotConfig {
  const apiKey = process.env.RAPIDAPI_KEY;
  const apiHost = process.env.RAPIDAPI_HOST;

  if (!apiKey || !apiHost) {
    throw new Error('RAPIDAPI_KEY and RAPIDAPI_HOST must be set in .env');
  }

  return {
    apiKey,
    apiHost,
    fallbackApiKey: process.env.FALLBACK_RAPIDAPI_KEY ?? apiKey,
    fallbackApiHost: process.env.FALLBACK_RAPIDAPI_HOST ?? 'allscores.p.rapidapi.com',
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 30_000),
    oddsMovementThresholdPct: Number(process.env.ODDS_MOVEMENT_PCT ?? 5),
    sports: (process.env.SPORTS ?? 'football,basketball,tennis').split(',').map((s) => s.trim()),
    timezone: process.env.TIMEZONE ?? 'America/Chicago',
  };
}

const ALERT_ICONS: Record<BettingAlert['type'], string> = {
  new_event: '🆕',
  score_change: '⚽',
  odds_movement: '📊',
  value_bet: '💰',
  event_ended: '🏁',
};

function printAlert(alert: BettingAlert): void {
  const icon = ALERT_ICONS[alert.type] ?? '•';
  console.log(`${icon} [${alert.timestamp}] ${alert.message}`);
}

/** Returns true for HTTP status codes that mean "rate limited or blocked" */
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
  const analyzer = new BettingAnalyzer(config.oddsMovementThresholdPct);

  let activeName = 'SofaScore';
  let activeClient: LiveClient = primary;
  let rateLimitedUntil = 0;

  console.log('🤖 Sports Betting Bot');
  console.log(`   Primary  : ${config.apiHost}`);
  console.log(`   Fallback : ${config.fallbackApiHost}`);
  console.log(`   Sports   : ${config.sports.join(', ')}`);
  console.log(`   Poll     : ${config.pollIntervalMs / 1_000}s`);
  console.log(`   Odds Δ   : ≥${config.oddsMovementThresholdPct}% triggers alert`);
  console.log('─'.repeat(60));

  const poll = async () => {
    const now = Date.now();

    // If primary was rate-limited, try switching back after 5 minutes
    if (activeClient !== primary && now > rateLimitedUntil) {
      activeClient = primary;
      activeName = 'SofaScore';
      console.log(`[${new Date().toISOString()}] 🔄 Retrying primary API (SofaScore)…`);
    }

    try {
      const liveEvents = await fetchAllLive(activeClient, config.sports);
      const oddsMap = await fetchOddsForEvents(activeClient, liveEvents);
      const alerts = analyzer.analyzeEvents(liveEvents, oddsMap);

      if (alerts.length > 0) {
        alerts.forEach(printAlert);
      } else {
        console.log(
          `[${new Date().toISOString()}] [${activeName}] No changes — ${analyzer.liveCount} live event(s) tracked`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (activeClient === primary && isRateLimitError(err)) {
        rateLimitedUntil = Date.now() + 5 * 60 * 1_000;
        activeClient = fallback;
        activeName = 'AllScores';
        console.warn(
          `[${new Date().toISOString()}] ⚠️  Primary API rate-limited — switching to AllScores fallback for 5 min`
        );
      } else {
        console.error(`❌ Poll error [${activeName}]: ${msg}`);
      }
    }
  };

  await poll();
  setInterval(poll, config.pollIntervalMs);
}

runBot().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
