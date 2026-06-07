// ── SofaScore (sportapi7) domain types ──────────────────────────────────────

export interface SofaTeam {
  id: number;
  name: string;
  shortName?: string;
}

export interface SofaScore {
  current?: number;
  period1?: number;
  period2?: number;
  overtime?: number;
  normaltime?: number;
}

export interface SofaStatus {
  code: number;
  description: string;
  type: 'notstarted' | 'inprogress' | 'finished' | 'postponed' | 'canceled' | string;
}

export interface SofaTournament {
  id: number;
  name: string;
  category?: { name: string; flag?: string };
}

export interface SofaEvent {
  id: number;
  slug?: string;
  sport?: { name: string; slug: string };
  homeTeam: SofaTeam;
  awayTeam: SofaTeam;
  homeScore?: SofaScore;
  awayScore?: SofaScore;
  status: SofaStatus;
  tournament?: SofaTournament;
  startTimestamp?: number;
  time?: { played?: number; periodLength?: number };
  _source?: 'sofascore' | 'allscores';
}

// ── AllScores (allscores) raw types ──────────────────────────────────────────

export interface AllScoresRawMatch {
  id?: string | number;
  homeTeam?: { name?: string; id?: string | number } | string;
  awayTeam?: { name?: string; id?: string | number } | string;
  home?: string;
  away?: string;
  homeScore?: string | number;
  awayScore?: string | number;
  score?: string;
  status?: string | { name?: string };
  league?: string | { name?: string };
  tournament?: string | { name?: string };
  sport?: string | { name?: string };
  startTime?: string | number;
  [key: string]: unknown;
}

export interface AllScoresRawResponse {
  data?: AllScoresRawMatch[] | { matches?: AllScoresRawMatch[] } | { events?: AllScoresRawMatch[] };
  matches?: AllScoresRawMatch[];
  events?: AllScoresRawMatch[];
  [key: string]: unknown;
}

export const ALLSCORES_SPORT_IDS: Record<string, number> = {
  football: 1,
  basketball: 2,
  tennis: 3,
  baseball: 4,
  'american-football': 5,
  'ice-hockey': 6,
  volleyball: 7,
  handball: 8,
};

// ── Odds ────────────────────────────────────────────────────────────────────

export interface OddsChoice {
  name: string;
  fractionalValue?: string;
  initialFractionalValue?: string;
  winning?: boolean | null;
  decimal?: number;
  initialDecimal?: number;
}

export interface OddsMarket {
  marketName: string;
  choices: OddsChoice[];
}

// ── Form / Prediction types ──────────────────────────────────────────────────

export type PickOutcome = '1' | 'X' | '2';

export interface FormAnalysis {
  eventId: number;
  match: string;
  sport: string;
  league: string;
  homeConfidence: number;
  awayConfidence: number;
  pick: PickOutcome;
  confidence: number;
  reasoning: string[];
}

export interface BetPick {
  id: string;
  timestamp: string;
  eventId: number;
  match: string;
  sport: string;
  league: string;
  pick: PickOutcome;
  confidence: number;
  odds?: number;
  status: 'pending' | 'won' | 'lost' | 'void';
  resolvedAt?: string;
}

export interface TrackerData {
  picks: BetPick[];
  stats: {
    total: number;
    won: number;
    lost: number;
    pending: number;
    winRate: number;
  };
  weights: {
    formWeight: number;
    h2hWeight: number;
    goalsWeight: number;
    minConfidenceThreshold: number;
  };
}

// ── Alerts ──────────────────────────────────────────────────────────────────

export type AlertType =
  | 'new_event'
  | 'score_change'
  | 'odds_movement'
  | 'value_bet'
  | 'event_ended'
  | 'high_confidence_pick';

export interface BettingAlert {
  type: AlertType;
  timestamp: string;
  eventId: number;
  match: string;
  sport: string;
  league: string;
  message: string;
  meta?: Record<string, unknown>;
}

// ── Config ───────────────────────────────────────────────────────────────────

export interface BotConfig {
  apiKey: string;
  apiHost: string;
  fallbackApiKey?: string;
  fallbackApiHost?: string;
  pollIntervalMs: number;
  oddsMovementThresholdPct: number;
  sports: string[];
  timezone: string;
  minConfidence: number;
  telegramToken?: string;
  telegramChatId?: string;
  betDataFile: string;
}
