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
  /** Raw signal scores for the picked side — used for self-learning weight tuning */
  signals: { formScore: number; h2hScore: number; goalsScore: number };
  /** ISO timestamp of scheduled kickoff (set for pre-match events only) */
  kickoffTime?: string;
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
  /** Suggested stake in $ (2% of bankroll, scaled by confidence) */
  suggestedStake?: number;
  /** Our confidence % minus implied odds % */
  edge?: number;
  /** Signal scores stored for weight tuning after resolution */
  signals?: { formScore: number; h2hScore: number; goalsScore: number };
  /** Whether this pick was placed before or during the match */
  pickType?: 'prematch' | 'live';
  /** ISO timestamp of scheduled kickoff (pre-match picks only) */
  kickoffTime?: string;
  status: 'pending' | 'won' | 'lost' | 'void';
  resolvedAt?: string;
  /** ISO timestamp when a kickoff reminder was sent — prevents duplicate alerts */
  reminderSentAt?: string;
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
  /** Per-league win/loss counts for auto-blacklist */
  leagueStats?: Record<string, { won: number; total: number }>;
  /** Leagues automatically blacklisted due to consistently poor performance */
  leagueBlacklist?: string[];
  /** Running bankroll — initial set from config on first run, current updated as picks settle */
  bankroll?: { initial: number; current: number };
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
  /** Total betting bankroll in $ (used for unit sizing) */
  bankroll: number;
  /** Unit size as % of bankroll per bet (default 2) */
  unitPct: number;
  /** Max picks per day — discipline rule (default 3) */
  maxPicksPerDay: number;
  /** Min edge % (our confidence minus implied odds) to approve a pick */
  minEdgePct: number;
  /** Pause picks after N consecutive losses — anti-chase rule (default 3) */
  antiChaseAfterLosses: number;
  /** Hour (0–23, local time) to send daily Telegram briefing (default 8) */
  dailyBriefingHour: number;
  /** Max scheduled events to analyze per pre-match scan — limits API quota usage (default 30) */
  maxPreMatchEventsPerScan: number;
  /**
   * Leagues to include in pre-match scanning (case-insensitive substring match).
   * Empty array = use built-in top-leagues default. Set ALLOWED_LEAGUES=* to allow all.
   */
  allowedLeagues: string[];
}
