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
  /** which API sourced this event */
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

/** Maps SofaScore sport slug → AllScores sport ID */
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
  /** Decimal odds derived on our side */
  decimal?: number;
  /** Decimal odds at first fetch */
  initialDecimal?: number;
}

export interface OddsMarket {
  marketName: string;
  choices: OddsChoice[];
}

// ── Alerts ──────────────────────────────────────────────────────────────────

export type AlertType =
  | 'new_event'
  | 'score_change'
  | 'odds_movement'
  | 'value_bet'
  | 'event_ended';

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
  /** Fallback API credentials (AllScores) */
  fallbackApiKey?: string;
  fallbackApiHost?: string;
  pollIntervalMs: number;
  /** % change in decimal odds that triggers a value-bet alert */
  oddsMovementThresholdPct: number;
  /** Sport slugs to track e.g. "football,basketball,tennis" */
  sports: string[];
  /** IANA timezone for AllScores API e.g. "America/Chicago" */
  timezone: string;
}
