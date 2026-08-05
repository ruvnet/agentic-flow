export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

const CONFIG_KEY = 'betedge_telegram';

export function getTelegramConfig(): TelegramConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TelegramConfig;
  } catch (_e) { return null; }
}

export function saveTelegramConfig(config: TelegramConfig): void {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); } catch (_e) { /* storage full */ }
}

export function clearTelegramConfig(): void {
  try { localStorage.removeItem(CONFIG_KEY); } catch (_e) { /* ignore */ }
}

export async function sendTelegramMessage(text: string, config: TelegramConfig): Promise<void> {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: config.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Telegram ${res.status}: ${body.slice(0, 120)}`);
  }
}
