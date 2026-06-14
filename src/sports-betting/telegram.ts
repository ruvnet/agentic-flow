import TelegramBot from 'node-telegram-bot-api';
import type { FormAnalysis, BetPick, BettingAlert } from './types.js';
import type { OddsParlay } from './odds-picker.js';
import type { LegResearch } from './research.js';

/** Convert decimal odds to American moneyline format (+150, -154, etc.) */
function toAmerican(decimal: number): string {
  if (decimal <= 1) return '—';
  const american = decimal >= 2
    ? Math.round((decimal - 1) * 100)
    : Math.round(-100 / (decimal - 1));
  return american > 0 ? `+${american}` : `${american}`;
}

export class TelegramNotifier {
  private bot: TelegramBot | null = null;
  private chatId: string;

  constructor(token?: string, chatId?: string) {
    this.chatId = chatId ?? '';
    if (token && chatId) {
      this.bot = new TelegramBot(token, { polling: false });
      console.log('📱 Telegram notifications: enabled');
    } else {
      console.log('📱 Telegram notifications: disabled (set TELEGRAM_TOKEN + TELEGRAM_CHAT_ID)');
    }
  }

  async sendPick(pick: BetPick, analysis: FormAnalysis): Promise<void> {
    const pickLabel = pick.pick === '1' ? '🏠 Home Win' : pick.pick === '2' ? '✈️ Away Win' : '🤝 Draw';
    const stars = pick.confidence >= 80 ? '⭐⭐⭐' : pick.confidence >= 70 ? '⭐⭐' : '⭐';
    const valueTag = pick.edge !== undefined
      ? pick.edge >= 15 ? '🔥 GREAT VALUE' : pick.edge >= 5 ? '✅ GOOD VALUE' : '📌 LOW VALUE'
      : '';
    const header = pick.pickType === 'prematch' ? `🗓️ PRE-MATCH PICK ${stars}` : `💰 LIVE PICK ${stars}`;

    const kickoffLine = pick.kickoffTime
      ? `⏰ Kickoff: ${new Date(pick.kickoffTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : '';

    const lines = [
      header,
      ``,
      `🏆 ${pick.league}`,
      `⚽ ${pick.match}`,
      kickoffLine,
      `📌 Pick: ${pickLabel}`,
      `📊 Confidence: ${pick.confidence}%`,
      pick.odds ? `💵 Odds: ${pick.odds} decimal (${toAmerican(pick.odds)} American)` : '',
      pick.edge !== undefined ? `📈 Edge: +${pick.edge}% ${valueTag}` : '',
      pick.suggestedStake ? `💼 Suggested stake: $${pick.suggestedStake} (2% unit rule)` : '',
      ``,
      `🔍 Analysis:`,
      ...analysis.reasoning.map((r) => `  • ${r}`),
      ``,
      `⚠️ Bet responsibly. Singles only. Never chase losses.`,
    ].filter(Boolean);

    await this.send(lines.join('\n'));
  }

  async sendKickoffReminder(pick: BetPick, minutesUntilKickoff: number): Promise<void> {
    const pickLabel = pick.pick === '1' ? '🏠 Home Win' : pick.pick === '2' ? '✈️ Away Win' : '🤝 Draw';
    const minsStr = minutesUntilKickoff <= 5 ? 'NOW' : `${Math.round(minutesUntilKickoff)} min`;
    const kickoffStr = pick.kickoffTime
      ? new Date(pick.kickoffTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'soon';

    const lines = [
      `⏰ KICKOFF REMINDER — ${minsStr}`,
      ``,
      `🏆 ${pick.league}`,
      `⚽ ${pick.match}`,
      `🕐 Kicks off at ${kickoffStr}`,
      `📌 Pick: ${pickLabel}`,
      `📊 Confidence: ${pick.confidence}%`,
      pick.odds ? `💵 Odds: ${pick.odds} (${toAmerican(pick.odds)})` : '',
      pick.suggestedStake ? `💼 Suggested stake: $${pick.suggestedStake}` : '',
      pick.edge !== undefined ? `📈 Edge: +${pick.edge}%` : '',
      ``,
      `🎯 Place your bet now before kick-off!`,
    ].filter(Boolean);

    await this.send(lines.join('\n'));
  }

  async sendAlert(alert: BettingAlert): Promise<void> {
    const ICONS: Record<string, string> = {
      score_change: '⚽',
      odds_movement: '📊',
      value_bet: '💰',
      event_ended: '🏁',
      new_event: '🆕',
      high_confidence_pick: '💡',
    };
    await this.send(`${ICONS[alert.type] ?? '•'} ${alert.message}`);
  }

  async sendResolution(
    pick: BetPick,
    finalScore: { home: number; away: number },
    bankroll?: { initial: number; current: number }
  ): Promise<void> {
    const won = pick.status === 'won';
    const header = won ? `✅ BET WON` : `❌ BET LOST`;
    const pickLabel = pick.pick === '1' ? '🏠 Home Win' : pick.pick === '2' ? '✈️ Away Win' : '🤝 Draw';

    let plLine = '';
    if (pick.suggestedStake) {
      if (won && pick.odds) {
        const profit = +(pick.suggestedStake * (pick.odds - 1)).toFixed(2);
        plLine = `💰 Stake: $${pick.suggestedStake} → Profit: +$${profit}`;
      } else if (!won) {
        plLine = `💰 Stake: $${pick.suggestedStake} → Loss: -$${pick.suggestedStake}`;
      }
    }

    let bankrollLine = '';
    if (bankroll && bankroll.initial > 0) {
      const pnl = +(bankroll.current - bankroll.initial).toFixed(2);
      const sign = pnl >= 0 ? '+' : '';
      bankrollLine = `📊 Bankroll: $${bankroll.current} (${sign}$${pnl} overall)`;
    }

    const lines = [
      header,
      ``,
      `🏆 ${pick.league}`,
      `⚽ ${pick.match}`,
      `🏁 Final: ${finalScore.home}–${finalScore.away}`,
      `📌 Your pick: ${pickLabel}`,
      pick.odds ? `📈 Odds: ${pick.odds}` : '',
      plLine,
      bankrollLine,
    ].filter(Boolean);

    await this.send(lines.join('\n'));
  }

  async sendStats(summary: string): Promise<void> {
    await this.send(summary);
  }

  async sendParlays(parlays: OddsParlay[], date: string, research?: Map<string, LegResearch>): Promise<void> {
    if (parlays.length === 0) {
      await this.send(`📅 *Daily Parlays — ${date}*\n\nNo qualifying picks today (odds too low or no odds available).`);
      return;
    }

    const sportIcon = (sport: string) => {
      const s = sport.toLowerCase();
      if (s.includes('baseball') || s.includes('mlb')) return '⚾';
      if (s.includes('basketball') || s.includes('nba')) return '🏀';
      if (s.includes('football') || s.includes('soccer')) return '⚽';
      if (s.includes('american')) return '🏈';
      return '🎯';
    };

    const lines: string[] = [
      `🎰 *TODAY'S PARLAY PICKS — ${date}*`,
      ``,
      `Picks based on bookmaker-implied probability.`,
      `Moneylines only — book-favored teams.`,
      ``,
    ];

    for (const parlay of parlays) {
      lines.push(`📋 *PARLAY ${parlay.id}* — Combined odds: ${parlay.combinedOdds} (~${parlay.combinedProb}% prob)`);
      for (const leg of parlay.legs) {
        const icon = sportIcon(leg.sport);
        const ko = leg.kickoffTime
          ? ` @ ${new Date(leg.kickoffTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
          : '';
        const us = toAmerican(leg.decimalOdds);
        lines.push(`  ${icon} ${leg.teamName} ML${ko}`);
        lines.push(`      ${leg.league} | ${leg.impliedProb}% implied | ${leg.decimalOdds} (${us})`);

        const res = research?.get(leg.teamName);
        if (res) {
          if (res.pitcher) {
            const pitcherStatus = res.pitcher.isConfirmed
              ? `✅ Pitcher: ${res.pitcher.name}`
              : `⚠️ Pitcher: TBD — verify before betting`;
            lines.push(`      ${pitcherStatus}`);
          }
          if (res.weather) {
            lines.push(`      ${res.weather.summary}`);
          }
          if (res.form) {
            const recordPart = res.form.record ? `${res.form.record} | ` : '';
            const streakPart = res.form.streak ? ` | ${res.form.streak}` : '';
            const last5Part = res.form.last5 ? `L5: ${res.form.last5}` : '';
            if (recordPart || last5Part) {
              lines.push(`      📊 ${recordPart}${last5Part}${streakPart}`);
            }
          }
          if (res.isBackToBack) {
            lines.push(`      ⚠️ B2B game — played last night (fatigue risk)`);
          }
          for (const headline of res.newsHeadlines) {
            lines.push(`      📰 ${headline}`);
          }
        }
      }
      lines.push(``);
    }

    lines.push(`📋 *BEFORE PLACING — verify each leg:*`);
    lines.push(`  ✅ Starter/key player confirmed (30 min before game)`);
    lines.push(`  ✅ No injury news in last 24 hours`);
    lines.push(`  ✅ Line hasn't moved against you since research`);
    lines.push(`  ✅ True win % > breakeven probability`);
    lines.push(`  ✅ Weather OK for outdoor stadiums`);
    lines.push(``);
    lines.push(`⚠️ Stake $10–$70 per bet. Never chase losses.`);
    lines.push(`📌 Place bets before kickoff of the first leg.`);

    await this.send(lines.join('\n'));
  }

  async sendStartupMessage(data: {
    sports: string[];
    pollIntervalSec: number;
    minConfidence: number;
    maxPicksPerDay: number;
    minEdgePct: number;
    bankroll?: number;
    totalPicks: number;
    winRate: number;
  }): Promise<void> {
    const winPct = data.totalPicks > 0 ? ` | Win rate: ${(data.winRate * 100).toFixed(1)}%` : '';
    const bankrollLine = data.bankroll ? `💰 Bankroll: $${data.bankroll}` : '';
    const lines = [
      `🤖 *Sports Betting Bot — Online*`,
      ``,
      `⚽ Sports: ${data.sports.join(', ')}`,
      `🔄 Poll: every ${data.pollIntervalSec}s`,
      `🎯 Min confidence: ${data.minConfidence}%`,
      `📈 Min edge: ${data.minEdgePct}%`,
      `🗓️ Max picks/day: ${data.maxPicksPerDay}`,
      bankrollLine,
      ``,
      `📊 All-time: ${data.totalPicks} picks${winPct}`,
      ``,
      `✅ Telegram connected — notifications active`,
    ].filter(Boolean);
    await this.send(lines.join('\n'));
  }

  async sendDailyBriefing(data: {
    date: string;
    yesterdayWon: number;
    yesterdayLost: number;
    yesterdayPending: number;
    totalPicks: number;
    totalWon: number;
    winRate: number;
    picksToday: number;
    maxPicksPerDay: number;
    bankroll?: { initial: number; current: number };
    blacklistedLeagues: string[];
    avgClv?: number;
  }): Promise<void> {
    const winPct = (data.winRate * 100).toFixed(1);
    const yesterdayLine =
      data.yesterdayWon + data.yesterdayLost + data.yesterdayPending === 0
        ? '  No picks yesterday'
        : `  ✅ Won: ${data.yesterdayWon}  ❌ Lost: ${data.yesterdayLost}  ⏳ Pending: ${data.yesterdayPending}`;

    let bankrollLine = '';
    if (data.bankroll && data.bankroll.initial > 0) {
      const { initial, current } = data.bankroll;
      const pnl = +(current - initial).toFixed(2);
      const pct = +((pnl / initial) * 100).toFixed(1);
      const sign = pnl >= 0 ? '+' : '';
      bankrollLine = `  💰 Bankroll: $${current} (${sign}$${pnl} / ${sign}${pct}% vs $${initial} start)`;
    }

    const clvLine = data.avgClv !== undefined
      ? `  📐 Avg CLV: ${data.avgClv >= 0 ? '+' : ''}${data.avgClv}% (${data.avgClv >= 0 ? 'beating' : 'behind'} closing line)`
      : '';

    const lines = [
      `📅 *Daily Briefing — ${data.date}*`,
      ``,
      `📊 *Yesterday's Results:*`,
      yesterdayLine,
      ``,
      `📈 *Overall Performance:*`,
      `  Total picks: ${data.totalPicks} | Won: ${data.totalWon} | Win rate: ${winPct}%`,
      clvLine,
      ``,
      `🎯 *Today's Quota:*`,
      `  Picks used: ${data.picksToday}/${data.maxPicksPerDay}`,
      bankrollLine,
      data.blacklistedLeagues.length > 0
        ? `  🚫 Blacklisted leagues: ${data.blacklistedLeagues.join(', ')}`
        : '',
      ``,
      `⚠️ Quality over quantity. Bet only when you have an edge.`,
    ].filter(Boolean);

    await this.send(lines.join('\n'));
  }

  /**
   * Start listening for incoming Telegram commands from the configured chat.
   * handler receives the command name (without /) and returns the reply text.
   */
  startListening(handler: (cmd: string, args: string[]) => Promise<string>): void {
    if (!this.bot) return;
    this.bot.startPolling({ restart: false });
    // Suppress 409 spam — happens when two bot instances run simultaneously.
    // The user should kill the old instance; this prevents log flooding.
    this.bot.on('polling_error', (err: Error) => {
      if (err.message?.includes('409')) {
        console.warn('⚠️  [Telegram] 409 Conflict — another bot instance is running. Kill the old one with Ctrl+C and restart.');
        return;
      }
      console.error(`[Telegram] Polling error: ${err.message}`);
    });
    this.bot.on('message', async (msg) => {
      const text = msg.text?.trim() ?? '';
      if (!text.startsWith('/')) return;
      if (msg.chat.id.toString() !== this.chatId) return; // only respond to owner

      const [rawCmd, ...args] = text.split(/\s+/);
      const cmdName = (rawCmd ?? '').slice(1).toLowerCase();
      try {
        const reply = await handler(cmdName, args);
        if (reply) await this.send(reply);
      } catch (err) {
        console.error(`[Telegram] Command error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    console.log('📱 Telegram commands: /status /picks /parlays /today /live /history /rules /scan /resolve /void /bankroll /blacklist /help');
  }

  private async send(text: string): Promise<void> {
    if (!this.bot || !this.chatId) {
      console.log(`[Telegram] ${text}`);
      return;
    }
    try {
      await this.bot.sendMessage(this.chatId, text, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error(`Telegram send failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
