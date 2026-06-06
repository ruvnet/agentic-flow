import 'dotenv/config';
import { SportsBettingApiClient } from './api-client.js';
import { BettingAnalyzer } from './analyzer.js';
import type { BotConfig, BettingAlert } from './types.js';

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
    oddsChangeThreshold: Number(process.env.ODDS_CHANGE_THRESHOLD ?? 5),
  };
}

function printAlert(alert: BettingAlert): void {
  const prefix =
    alert.type === 'new_match'
      ? '🆕'
      : alert.type === 'match_ended'
        ? '🏁'
        : '⚡';
  console.log(`${prefix} [${alert.timestamp}] ${alert.message}`);
}

async function runBot(): Promise<void> {
  const config = loadConfig();
  const client = new SportsBettingApiClient(config);
  const analyzer = new BettingAnalyzer();

  console.log(`🤖 Sports Betting Bot started`);
  console.log(`   Host : ${config.apiHost}`);
  console.log(`   Poll : ${config.pollIntervalMs / 1000}s interval`);
  console.log('─'.repeat(60));

  const poll = async () => {
    try {
      const streams = await client.fetchLiveStreams();
      const alerts = analyzer.analyze(streams);

      if (alerts.length > 0) {
        alerts.forEach(printAlert);
      } else {
        console.log(
          `[${new Date().toISOString()}] No changes — tracking ${analyzer.trackedCount} live event(s)`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`❌ Fetch error: ${msg}`);
    }
  };

  // immediate first fetch, then poll
  await poll();
  setInterval(poll, config.pollIntervalMs);
}

runBot().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
