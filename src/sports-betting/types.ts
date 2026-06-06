export interface LiveStream {
  id: string;
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  status: string;
  streamUrl?: string;
  [key: string]: unknown;
}

export interface BettingAlert {
  type: 'live_event' | 'new_match' | 'match_ended';
  timestamp: string;
  event: LiveStream;
  message: string;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
}

export interface BotConfig {
  apiKey: string;
  apiHost: string;
  pollIntervalMs: number;
  oddsChangeThreshold: number;
}
