export interface Outcome {
  name: string;
  odds: number;
}

export interface Market {
  name: string;
  outcomes: Outcome[];
}

export interface BookmakerOdds {
  name: string;
  markets: Market[];
}

export interface Event {
  eventId: string;
  sport: string;
  league: string;
  home: string;
  away: string;
  startTime: string;
  status?: string;
}

export interface OddsResponse {
  eventId: string;
  sport: string;
  league: string;
  home: string;
  away: string;
  startTime: string;
  bookmakers: BookmakerOdds[];
}

export interface ValueBet {
  bookmaker: string;
  market: string;
  outcome: string;
  odds: number;
  fairOdds: number;
  edge: number; // percentage
}

export interface ArbOpportunity {
  market: string;
  combinations: Array<{ bookmaker: string; outcome: string; odds: number; stake: number }>;
  profit: number; // percentage
}

export interface BetRecord {
  id: string;
  date: string;
  event: string;
  market: string;
  outcome: string;
  bookmaker: string;
  odds: number;
  stake: number;
  result: 'pending' | 'won' | 'lost' | 'void';
  profit?: number;
}
