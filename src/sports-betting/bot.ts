import 'dotenv/config';
import { SofaScoreClient } from './api-client.js';
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
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 30_000),
    oddsMovementThresholdPct: Number(process.env.ODDS_MOVEMENT_PCT ?? 5),
    sports: (process.env.SPORTS ?? 'football,basketball,tennis').split(',').map((s) => s.trim()),
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

async function fetchAllLive(
  client: SofaScoreClient,
  sports: string[]
): Promise<SofaEvent[]> {
  const results = await Promise.allSettled(sports.map((s) => client.getLiveEvents(s)));
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

async function fetchOddsForEvents(
  client: SofaScoreClient,
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
  const client = new SofaScoreClient(config);
  const analyzer = new BettingAnalyzer(config.oddsMovementThresholdPct);

  console.log('🤖 Sports Betting Bot (SofaScore)');
  console.log(`   Sports  : ${config.sports.join(', ')}`);
  console.log(`   Poll    : ${config.pollIntervalMs / 1_000}s`);
  console.log(`   Odds Δ  : ≥${config.oddsMovementThresholdPct}% triggers alert`);
  console.log('─'.repeat(60));

  const poll = async () => {
    try {
      const liveEvents = await fetchAllLive(client, config.sports);
      const oddsMap = await fetchOddsForEvents(client, liveEvents);
      const alerts = analyzer.analyzeEvents(liveEvents, oddsMap);

      if (alerts.length > 0) {
        alerts.forEach(printAlert);
      } else {
        console.log(
          `[${new Date().toISOString()}] No changes — ${analyzer.liveCount} live event(s) tracked`
        );
      }
    } catch (err) {
      console.error(`❌ Poll error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  await poll();
  setInterval(poll, config.pollIntervalMs);
}

runBot().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
