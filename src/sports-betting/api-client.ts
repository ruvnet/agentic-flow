import axios, { AxiosInstance } from 'axios';
import type { LiveStream, BotConfig } from './types.js';

export class SportsBettingApiClient {
  private client: AxiosInstance;

  constructor(private config: BotConfig) {
    this.client = axios.create({
      baseURL: `https://${config.apiHost}`,
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-host': config.apiHost,
        'x-rapidapi-key': config.apiKey,
      },
      timeout: 10_000,
    });
  }

  async fetchLiveStreams(): Promise<LiveStream[]> {
    const response = await this.client.get<LiveStream[] | { data: LiveStream[] }>(
      '/api/v2/br/all-live-stream'
    );

    const raw = response.data;
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray((raw as { data: LiveStream[] }).data)) {
      return (raw as { data: LiveStream[] }).data;
    }
    return [];
  }
}
