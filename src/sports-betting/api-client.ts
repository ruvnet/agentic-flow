import axios, { AxiosInstance } from 'axios';
import type { BotConfig, SofaEvent, OddsMarket } from './types.js';

export class SofaScoreClient {
  private http: AxiosInstance;

  constructor(config: BotConfig) {
    this.http = axios.create({
      baseURL: `https://${config.apiHost}`,
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-host': config.apiHost,
        'x-rapidapi-key': config.apiKey,
      },
      timeout: 10_000,
    });
  }

  /** All currently live events for a sport slug (e.g. "football") */
  async getLiveEvents(sport: string): Promise<SofaEvent[]> {
    const res = await this.http.get<{ events?: SofaEvent[] }>(
      `/api/v1/sport/${sport}/events/live`
    );
    return res.data.events ?? [];
  }

  /** 1X2 (full-time) odds for a specific event */
  async getEventOdds(eventId: number): Promise<OddsMarket[]> {
    try {
      const res = await this.http.get<{ markets?: OddsMarket[] }>(
        `/api/v1/event/${eventId}/odds`
      );
      return res.data.markets ?? [];
    } catch {
      // odds may not be available for every event
      return [];
    }
  }
}
