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

    const lines = [
      `💰 HIGH CONFIDENCE PICK ${stars}`,
      ``,
      `🏆 ${pick.league}`,
      `⚽ ${pick.match}`,
      `📌 Pick: ${pickLabel}`,
      `📊 Confidence: ${pick.confidence}%`,
      pick.odds ? `💵 Odds: ${pick.odds}` : '',
      ``,
      `📈 Analysis:`,
      ...analysis.reasoning.map((r) => `  • ${r}`),
      ``,
      `⚠️ Bet responsibly. This is a data-based suggestion, not a guarantee.`,
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
