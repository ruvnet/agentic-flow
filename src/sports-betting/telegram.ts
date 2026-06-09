import TelegramBot from 'node-telegram-bot-api';
import type { FormAnalysis, BetPick, BettingAlert } from './types.js';

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
      pick.odds ? `💵 Odds: ${pick.odds} (decimal)` : '',
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

  async sendStats(summary: string): Promise<void> {
    await this.send(summary);
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

    const lines = [
      `📅 *Daily Briefing — ${data.date}*`,
      ``,
      `📊 *Yesterday's Results:*`,
      yesterdayLine,
      ``,
      `📈 *Overall Performance:*`,
      `  Total picks: ${data.totalPicks} | Won: ${data.totalWon} | Win rate: ${winPct}%`,
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
