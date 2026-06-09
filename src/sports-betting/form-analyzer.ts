import type { SofaEvent, SofaScore, FormAnalysis, PickOutcome } from './types.js';
import type { SofaScoreClient } from './api-client.js';

interface MatchResult {
  win: boolean;
  draw: boolean;
  goalsFor: number;
  goalsAgainst: number;
}

function scoreVal(s?: SofaScore): number {
  return s?.current ?? 0;
}

function toResult(event: SofaEvent, teamId: number): MatchResult | null {
  if (event.status.type !== 'finished') return null;
  const isHome = event.homeTeam.id === teamId;
  const isAway = event.awayTeam.id === teamId;
  if (!isHome && !isAway) return null;
  const myG = isHome ? scoreVal(event.homeScore) : scoreVal(event.awayScore);
  const theirG = isHome ? scoreVal(event.awayScore) : scoreVal(event.homeScore);
  return { win: myG > theirG, draw: myG === theirG, goalsFor: myG, goalsAgainst: theirG };
}

function formScore(results: MatchResult[]): number {
  if (results.length === 0) return 50;
  const pts = results.reduce((s, r) => s + (r.win ? 3 : r.draw ? 1 : 0), 0);
  return Math.round((pts / (results.length * 3)) * 100);
}

function avgGoals(results: MatchResult[], dir: 'for' | 'against'): number {
  if (results.length === 0) return 0;
  return results.reduce((s, r) => s + (dir === 'for' ? r.goalsFor : r.goalsAgainst), 0) / results.length;
}

const FORM_TTL = 10 * 60 * 1_000;
const formCache = new Map<number, { data: SofaEvent[]; at: number }>();
const h2hCache = new Map<number, { data: SofaEvent[]; at: number }>();

export class FormAnalyzer {
  constructor(
    private client: SofaScoreClient,
    private weights = { form: 0.4, h2h: 0.3, goals: 0.3 }
  ) {}

  async analyze(event: SofaEvent): Promise<FormAnalysis | null> {
    if (event._source !== 'sofascore' || !event.homeTeam.id || !event.awayTeam.id) {
      return null;
    }

    try {
      const [homePast, awayPast, h2hEvents] = await Promise.all([
        this.cachedForm(event.homeTeam.id),
        this.cachedForm(event.awayTeam.id),
        this.cachedH2H(event.id),
      ]);

      const homeResults = homePast.map((e) => toResult(e, event.homeTeam.id)).filter((r): r is MatchResult => r !== null).slice(0, 5);
      const awayResults = awayPast.map((e) => toResult(e, event.awayTeam.id)).filter((r): r is MatchResult => r !== null).slice(0, 5);
      const homeH2HResults = h2hEvents.map((e) => toResult(e, event.homeTeam.id)).filter((r): r is MatchResult => r !== null).slice(0, 5);
      const awayH2HResults = h2hEvents.map((e) => toResult(e, event.awayTeam.id)).filter((r): r is MatchResult => r !== null).slice(0, 5);

      const homeForm = formScore(homeResults);
      const awayForm = formScore(awayResults);
      const homeH2H = formScore(homeH2HResults);
      const awayH2H = formScore(awayH2HResults);

      const homeAttack = Math.min(avgGoals(homeResults, 'for') / 2.5, 1) * 100;
      const awayAttack = Math.min(avgGoals(awayResults, 'for') / 2.5, 1) * 100;
      const homeDefense = Math.max(0, 1 - avgGoals(homeResults, 'against') / 2.5) * 100;
      const awayDefense = Math.max(0, 1 - avgGoals(awayResults, 'against') / 2.5) * 100;
      const homeGoalScore = (homeAttack + homeDefense) / 2;
      const awayGoalScore = (awayAttack + awayDefense) / 2;

      const homeTotal = homeForm * this.weights.form + homeH2H * this.weights.h2h + homeGoalScore * this.weights.goals + 5; // home advantage
      const awayTotal = awayForm * this.weights.form + awayH2H * this.weights.h2h + awayGoalScore * this.weights.goals;

      const homeConfidence = Math.round(Math.min(homeTotal, 100));
      const awayConfidence = Math.round(Math.min(awayTotal, 100));
      const diff = homeConfidence - awayConfidence;

      let pick: PickOutcome;
      let confidence: number;
      if (diff > 10) {
        pick = '1';
        confidence = homeConfidence;
      } else if (diff < -10) {
        pick = '2';
        confidence = awayConfidence;
      } else {
        pick = 'X';
        confidence = Math.round((homeConfidence + awayConfidence) / 2);
      }

      const reasoning = [
        `Home form: ${homeForm}/100 over ${homeResults.length} matches`,
        `Away form: ${awayForm}/100 over ${awayResults.length} matches`,
        `H2H (home/away): ${homeH2H}/${awayH2H} over ${h2hEvents.length} matches`,
        `Avg goals — home: ${avgGoals(homeResults, 'for').toFixed(1)} scored / ${avgGoals(homeResults, 'against').toFixed(1)} conceded`,
        `Avg goals — away: ${avgGoals(awayResults, 'for').toFixed(1)} scored / ${avgGoals(awayResults, 'against').toFixed(1)} conceded`,
      ];

      // Capture raw signal scores for the predicted side (used for weight tuning)
      const signals =
        pick === '1'
          ? { formScore: homeForm, h2hScore: homeH2H, goalsScore: Math.round(homeGoalScore) }
          : pick === '2'
          ? { formScore: awayForm, h2hScore: awayH2H, goalsScore: Math.round(awayGoalScore) }
          : {
              formScore: Math.round((homeForm + awayForm) / 2),
              h2hScore: Math.round((homeH2H + awayH2H) / 2),
              goalsScore: Math.round((homeGoalScore + awayGoalScore) / 2),
            };

      return {
        eventId: event.id,
        match: `${event.homeTeam.name} vs ${event.awayTeam.name}`,
        sport: event.sport?.name ?? 'Unknown',
        league: event.tournament?.name ?? 'Unknown',
        homeConfidence,
        awayConfidence,
        pick,
        confidence,
        reasoning,
        signals,
      };
    } catch {
      return null;
    }
  }

  updateWeights(weights: { form: number; h2h: number; goals: number }): void {
    this.weights = weights;
  }

  private async cachedForm(teamId: number): Promise<SofaEvent[]> {
    const now = Date.now();
    const hit = formCache.get(teamId);
    if (hit && now - hit.at < FORM_TTL) return hit.data;
    const data = await this.client.getTeamLastEvents(teamId);
    formCache.set(teamId, { data, at: now });
    return data;
  }

  private async cachedH2H(eventId: number): Promise<SofaEvent[]> {
    const now = Date.now();
    const hit = h2hCache.get(eventId);
    if (hit && now - hit.at < FORM_TTL) return hit.data;
    const data = await this.client.getEventH2H(eventId);
    h2hCache.set(eventId, { data, at: now });
    return data;
  }
}
