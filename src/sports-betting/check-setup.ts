/**
 * Run this to diagnose why the bot isn't working:
 *   npx tsx src/sports-betting/check-setup.ts
 */
import 'dotenv/config';
import axios from 'axios';

const OK = '✅';
const FAIL = '❌';
const WARN = '⚠️ ';

function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? OK : FAIL} ${label}: ${detail}`);
  return ok;
}

async function main() {
  console.log('\n══════════════════════════════════════════');
  console.log('   Sports Betting Bot — Setup Diagnostics');
  console.log('══════════════════════════════════════════\n');

  let allGood = true;

  // ── 1. Required env vars ────────────────────────────────────────────────────
  console.log('── .env values ─────────────────────────────\n');

  const apiKey = process.env.RAPIDAPI_KEY;
  const apiHost = process.env.RAPIDAPI_HOST;
  const tgToken = process.env.TELEGRAM_TOKEN;
  const tgChat = process.env.TELEGRAM_CHAT_ID;

  allGood = check('RAPIDAPI_KEY', !!apiKey && apiKey !== 'your_rapidapi_key_here', apiKey ? `set (${apiKey.slice(0, 6)}…)` : 'MISSING') && allGood;
  allGood = check('RAPIDAPI_HOST', !!apiHost, apiHost ?? 'MISSING') && allGood;
  allGood = check('TELEGRAM_TOKEN', !!tgToken && tgToken !== 'your_telegram_bot_token', tgToken ? `set (${tgToken.slice(0, 10)}…)` : 'MISSING — Telegram disabled') && allGood;
  allGood = check('TELEGRAM_CHAT_ID', !!tgChat && tgChat !== 'your_telegram_chat_id', tgChat ?? 'MISSING — Telegram disabled') && allGood;

  const sports = (process.env.SPORTS ?? 'football,basketball,tennis').split(',').map(s => s.trim());
  console.log(`${OK} SPORTS: ${sports.join(', ')}`);
  console.log(`${OK} POLL_INTERVAL_MS: ${process.env.POLL_INTERVAL_MS ?? '30000 (default)'}`);
  console.log(`${OK} MIN_CONFIDENCE: ${process.env.MIN_CONFIDENCE ?? '65 (default)'}`);
  console.log(`${OK} BANKROLL: ${process.env.BANKROLL ?? '0 (not set)'}`);

  // ── 2. Test RapidAPI ────────────────────────────────────────────────────────
  console.log('\n── RapidAPI connectivity ────────────────────\n');

  if (apiKey && apiHost && apiKey !== 'your_rapidapi_key_here') {
    for (const sport of sports.slice(0, 1)) {
      try {
        const res = await axios.get<{ events?: unknown[] }>(
          `https://${apiHost}/api/v1/sport/${sport}/events/live`,
          {
            headers: { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': apiHost },
            timeout: 10_000,
          }
        );
        const count = res.data.events?.length ?? 0;
        console.log(`${OK} SofaScore API: reachable — ${count} live ${sport} events right now`);
        if (count === 0) {
          console.log(`   ${WARN} 0 live events — this is normal outside peak hours (evenings/weekends)`);
        }
      } catch (err) {
        const status = (err as { response?: { status?: number } }).response?.status;
        if (status === 401 || status === 403) {
          console.log(`${FAIL} SofaScore API: 401/403 — API key is wrong or expired`);
          allGood = false;
        } else if (status === 429) {
          console.log(`${WARN} SofaScore API: 429 — rate-limited (key works but over quota)`);
        } else {
          console.log(`${FAIL} SofaScore API: ${String(err)}`);
          allGood = false;
        }
      }
    }
  } else {
    console.log(`${FAIL} Skipped — RAPIDAPI_KEY not set`);
  }

  // ── 3. Test Telegram ────────────────────────────────────────────────────────
  console.log('\n── Telegram connectivity ────────────────────\n');

  if (tgToken && tgChat && tgToken !== 'your_telegram_bot_token' && tgChat !== 'your_telegram_chat_id') {
    try {
      // Test getMe
      const meRes = await axios.get<{ ok: boolean; result: { username: string } }>(
        `https://api.telegram.org/bot${tgToken}/getMe`,
        { timeout: 8_000 }
      );
      if (meRes.data.ok) {
        console.log(`${OK} Telegram token: valid — bot is @${meRes.data.result.username}`);
      }

      // Test send a message
      const sendRes = await axios.post<{ ok: boolean; description?: string }>(
        `https://api.telegram.org/bot${tgToken}/sendMessage`,
        { chat_id: tgChat, text: '🔧 Bot diagnostics check — connection confirmed!' },
        { timeout: 8_000 }
      );
      if (sendRes.data.ok) {
        console.log(`${OK} Telegram message sent to chat ID ${tgChat} — check your phone!`);
      } else {
        console.log(`${FAIL} Telegram send failed: ${sendRes.data.description}`);
        allGood = false;
      }
    } catch (err) {
      const status = (err as { response?: { status?: number; data?: { description?: string } } }).response;
      if (status?.status === 401) {
        console.log(`${FAIL} Telegram: 401 — TELEGRAM_TOKEN is wrong`);
      } else if (status?.data?.description?.includes('chat not found')) {
        console.log(`${FAIL} Telegram: chat not found — TELEGRAM_CHAT_ID is wrong`);
        console.log(`   How to get your correct chat ID: send /start to your bot, then visit:`);
        console.log(`   https://api.telegram.org/bot${tgToken}/getUpdates`);
        console.log(`   Look for "chat":{"id": <number>} in the result`);
      } else {
        console.log(`${FAIL} Telegram error: ${String(err)}`);
      }
      allGood = false;
    }
  } else {
    console.log(`${WARN} Skipped — TELEGRAM_TOKEN or TELEGRAM_CHAT_ID not configured`);
    console.log(`   Bot will still work but won't send phone notifications`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  if (allGood) {
    console.log('✅ All checks passed — run the bot:');
    console.log('   npx tsx src/sports-betting/bot.ts');
  } else {
    console.log('❌ Fix the issues above, then re-run this check.');
    console.log('   Edit your .env file: notepad .env  (Windows)');
  }
  console.log('══════════════════════════════════════════\n');
}

main().catch(console.error);
