/**
 * Betting strategy rules encoded from:
 * - Bob (Harlabos Vulgaras): exploit inefficiencies, data over emotion
 * - Mistakes video: value > win rate, no chasing, selective betting
 * - Bankroll management: 2% unit size, max 3 picks/day, singles only
 * - +EV video: bet only when confidence > implied odds probability
 * - Line shopping: always compare odds, find the best price
 */

import type { FormAnalysis, BetPick } from './types.js';

export interface StrategyConfig {
  bankroll: number;
  unitPct: number;        // recommended: 2 (2% per bet)
  maxPicksPerDay: number; // recommended: 3
  minEdgePct: number;     // min difference between our confidence and implied odds %
  antiChaseAfterLosses: number; // pause picks after N consecutive losses
}

export interface StrategyDecision {
  approved: boolean;
  stake: number;         // suggested stake in $
  edge: number;          // our confidence % minus implied odds %
  valueRating: 'great' | 'good' | 'low' | 'none';
  starRating: 1 | 2 | 3;
  reasons: string[];     // why approved/rejected
  warnings: string[];
}

/** Convert fractional odds string "5/2" to decimal */
export function fracToDecimal(frac?: string): number | undefined {
  if (!frac) return undefined;
  const parts = frac.split('/');
  if (parts.length !== 2) return undefined;
  const nums = parts.map(Number);
  const n = nums[0] as number;
  const d = nums[1] as number;
  if (!d || isNaN(n) || isNaN(d)) return undefined;
  return +(n / d + 1).toFixed(3);
}

/** Convert decimal odds to implied probability % */
export function impliedProbability(decimalOdds: number): number {
  if (decimalOdds <= 0) return 0;
  return +(1 / decimalOdds * 100).toFixed(1);
}

/** Remove bookmaker's vig from two-sided market to get fair probability */
export function noVigProbability(decOdds1: number, decOdds2: number): { p1: number; p2: number } {
  const raw1 = 1 / decOdds1;
  const raw2 = 1 / decOdds2;
  const total = raw1 + raw2;
  return { p1: +(raw1 / total * 100).toFixed(1), p2: +(raw2 / total * 100).toFixed(1) };
}

export class BettingStrategy {
  constructor(private config: StrategyConfig) {}

  evaluate(
    analysis: FormAnalysis,
    picksToday: number,
    recentPicks: BetPick[],
    oddsDecimal?: number
  ): StrategyDecision {
    const reasons: string[] = [];
    const warnings: string[] = [];
    let approved = true;

    // ── Rule 1: Daily pick limit (bankroll management — max 1-3 bets/day) ──
    if (picksToday >= this.config.maxPicksPerDay) {
      approved = false;
      reasons.push(`Daily limit reached (${picksToday}/${this.config.maxPicksPerDay} picks today)`);
    }

    // ── Rule 2: Anti-chase (mistakes video — stop after N consecutive losses) ──
    const consecutiveLosses = this.countConsecutiveLosses(recentPicks);
    if (consecutiveLosses >= this.config.antiChaseAfterLosses) {
      approved = false;
      reasons.push(
        `Anti-chase: ${consecutiveLosses} consecutive losses — pausing picks to protect bankroll`
      );
      warnings.push('⚠️  Never chase losses. Take a break, review your strategy.');
    }

    // ── Rule 3: Value edge check (+EV video — only bet when confidence > implied odds) ──
    let edge = 0;
    let valueRating: StrategyDecision['valueRating'] = 'none';
    if (oddsDecimal) {
      const implied = impliedProbability(oddsDecimal);
      edge = +(analysis.confidence - implied).toFixed(1);
      valueRating = edge >= 15 ? 'great' : edge >= 5 ? 'good' : edge >= 1 ? 'low' : 'none';

      if (edge < this.config.minEdgePct) {
        approved = false;
        reasons.push(
          `No value: confidence ${analysis.confidence}% vs implied ${implied}% (edge ${edge}% < min ${this.config.minEdgePct}%)`
        );
        reasons.push('Book is pricing this correctly — no edge here, skip it.');
      } else {
        reasons.push(
          `Value found: confidence ${analysis.confidence}% vs implied ${implied}% → +${edge}% edge`
        );
      }
    } else {
      // No odds available — still use confidence as filter
      if (analysis.confidence < 70) {
        warnings.push('No odds data — confidence-only pick (higher risk without value confirmation)');
      }
    }

    // ── Rule 4: Minimum confidence ──
    if (analysis.confidence < 65) {
      approved = false;
      reasons.push(`Confidence too low: ${analysis.confidence}% (min 65%)`);
    }

    // ── Rule 5: Avoid heavy favourites with no value ──
    if (oddsDecimal && oddsDecimal < 1.3 && edge < 10) {
      warnings.push(
        'Heavy favourite — payout is very low vs risk. Skip unless edge is very large.'
      );
    }

    // ── Stake calculation (2% of bankroll, scaled by confidence) ──
    // Higher confidence → up to max unit, lower → base unit
    const baseUnit = this.config.bankroll * (this.config.unitPct / 100);
    const confidenceMultiplier = Math.min(analysis.confidence / 80, 1.25); // max 1.25x at 80%+
    const stake = +Math.min(baseUnit * confidenceMultiplier, this.config.bankroll * 0.05).toFixed(2);

    // ── Star rating ──
    const starRating: StrategyDecision['starRating'] =
      analysis.confidence >= 80 || edge >= 15 ? 3 :
      analysis.confidence >= 70 || edge >= 5  ? 2 : 1;

    if (approved) {
      reasons.push(`✅ Pick approved — ${this.config.bankroll > 0 ? `suggested stake: $${stake}` : 'configure BANKROLL in .env for stake sizing'}`);
    }

    return { approved, stake, edge, valueRating, starRating, reasons, warnings };
  }

  updateConfig(partial: Partial<StrategyConfig>): void {
    Object.assign(this.config, partial);
  }

  private countConsecutiveLosses(picks: BetPick[]): number {
    const resolved = picks
      .filter((p) => p.status === 'won' || p.status === 'lost')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    let count = 0;
    for (const p of resolved) {
      if (p.status === 'lost') count++;
      else break;
    }
    return count;
  }
}
