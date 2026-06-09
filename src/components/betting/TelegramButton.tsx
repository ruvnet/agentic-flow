import React, { useState } from 'react';
import type { OddsResponse, ValueBet, ArbOpportunity } from '../../types/betting';
import {
  getTelegramConfig,
  saveTelegramConfig,
  sendTelegramMessage,
  type TelegramConfig,
} from '../../services/telegram.service';

interface Props {
  data: OddsResponse;
  valueBets: ValueBet[];
  arbs: ArbOpportunity[];
}

function buildMessage(data: OddsResponse, valueBets: ValueBet[], arbs: ArbOpportunity[]): string {
  const dt = data.startTime
    ? new Date(data.startTime).toLocaleString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
      }) + ' UTC'
    : '';

  const lines: string[] = [
    `⚡ <b>BetEdge Analysis</b>`,
    ``,
    `⚽ <b>${data.home} vs ${data.away}</b>`,
    ...(data.league ? [`🏆 ${data.league}`] : []),
    ...(dt ? [`🕐 ${dt}`] : []),
    ``,
    `━━━━━━━━━━━━━━━━━━━`,
  ];

  if (valueBets.length > 0) {
    for (const vb of valueBets) {
      const b = vb.odds - 1;
      const kelly = b > 0 ? ((vb.edge / 100) / b) * 100 / 4 : 0;
      lines.push(
        ``,
        `🎯 <b>VALUE BET FOUND</b>`,
        `${vb.bookmaker} — ${vb.outcome} @ <b>${vb.odds.toFixed(2)}</b>`,
        `Edge: <b>+${vb.edge.toFixed(1)}%</b>  |  ¼ Kelly: ${kelly.toFixed(1)}% of bankroll`,
        `Market: <i>${vb.market}</i>`,
      );
    }
    lines.push(``);
  }

  if (arbs.length > 0) {
    for (const arb of arbs) {
      lines.push(
        `🔒 <b>ARB +${arb.profit.toFixed(2)}%</b> — ${arb.market}`,
      );
      for (const c of arb.combinations) {
        lines.push(`  • ${c.outcome} → ${c.bookmaker} @ ${c.odds.toFixed(2)} (£${c.stake} stake)`);
      }
      lines.push(``);
    }
  }

  if (valueBets.length === 0 && arbs.length === 0) {
    lines.push(`⛔ <b>DO NOT BET</b> — no edge found`);
    lines.push(`<i>Odds are fairly priced. Wait for genuine value.</i>`);
    lines.push(``);
  }

  lines.push(`━━━━━━━━━━━━━━━━━━━`);
  lines.push(`<i>via BetEdge</i>`);

  return lines.join('\n');
}

// ─── Setup form ───────────────────────────────────────────────────────────────

function SetupForm({ onDone, onCancel }: { onDone: (cfg: TelegramConfig) => void; onCancel: () => void }) {
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');

  const save = () => {
    if (!botToken.trim() || !chatId.trim()) return;
    const cfg = { botToken: botToken.trim(), chatId: chatId.trim() };
    saveTelegramConfig(cfg);
    onDone(cfg);
  };

  return (
    <div className="bg-gray-900 border border-blue-800/50 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-blue-300 text-sm font-bold">🔔 Setup Telegram Alerts</p>
        <button onClick={onCancel} className="text-gray-600 hover:text-gray-300 text-sm">✕</button>
      </div>

      <div className="text-gray-400 text-xs space-y-1 bg-gray-800/60 rounded-lg p-3">
        <p className="font-semibold text-gray-300 mb-1.5">Quick setup (2 min):</p>
        <p>1. Open Telegram → message <span className="text-blue-300 font-mono">@BotFather</span></p>
        <p>2. Send <span className="font-mono bg-gray-700 px-1 rounded">/newbot</span> and follow prompts → copy the <b>Bot Token</b></p>
        <p>3. Start your bot, then visit <span className="font-mono break-all text-blue-300/80">api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</span> to find your <b>Chat ID</b></p>
      </div>

      <input
        value={botToken}
        onChange={e => setBotToken(e.target.value)}
        placeholder="Bot Token — e.g. 1234567890:AAFxxxxxxx"
        className="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 text-xs font-mono placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <input
        value={chatId}
        onChange={e => setChatId(e.target.value)}
        placeholder="Chat ID — e.g. 123456789"
        className="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 text-xs font-mono placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <button
        onClick={save}
        disabled={!botToken.trim() || !chatId.trim()}
        className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg text-sm font-semibold transition-colors"
      >
        Save &amp; Send Test Alert
      </button>
    </div>
  );
}

// ─── Main button ──────────────────────────────────────────────────────────────

export default function TelegramButton({ data, valueBets, arbs }: Props) {
  const [phase, setPhase] = useState<'idle' | 'setup' | 'sending' | 'sent' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState('');

  const send = async (cfg: TelegramConfig) => {
    setPhase('sending');
    setErrMsg('');
    try {
      await sendTelegramMessage(buildMessage(data, valueBets, arbs), cfg);
      setPhase('sent');
      setTimeout(() => setPhase('idle'), 3500);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Send failed');
      setPhase('error');
    }
  };

  const handleClick = () => {
    const cfg = getTelegramConfig();
    if (!cfg) { setPhase('setup'); return; }
    void send(cfg);
  };

  if (phase === 'setup') {
    return (
      <SetupForm
        onDone={cfg => void send(cfg)}
        onCancel={() => setPhase('idle')}
      />
    );
  }

  if (phase === 'error') {
    return (
      <div className="flex items-center gap-2 bg-red-950/60 border border-red-700/40 rounded-xl px-4 py-3">
        <span className="text-red-300 text-xs flex-1 break-all">{errMsg}</span>
        <button
          onClick={() => setPhase('idle')}
          className="text-gray-500 hover:text-gray-300 text-sm shrink-0"
        >
          ✕
        </button>
      </div>
    );
  }

  const hasAlert = valueBets.length > 0 || arbs.length > 0;
  const configured = Boolean(getTelegramConfig());

  return (
    <button
      onClick={handleClick}
      disabled={phase === 'sending'}
      className={`w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50 ${
        phase === 'sent'
          ? 'bg-green-700 text-white'
          : hasAlert
          ? 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white'
          : 'bg-gray-800 hover:bg-gray-700 text-gray-400'
      }`}
    >
      {phase === 'sending' ? (
        <>
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Sending…
        </>
      ) : phase === 'sent' ? (
        '✓ Sent to Telegram'
      ) : (
        <>
          📨 {hasAlert ? 'Send Alert to Telegram' : 'Send Analysis to Telegram'}
          {!configured && (
            <span className="text-xs opacity-60 ml-1">(tap to setup)</span>
          )}
        </>
      )}
    </button>
  );
}
