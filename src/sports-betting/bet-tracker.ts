import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import type { BetPick, TrackerData, PickOutcome, FormAnalysis } from './types.js';

const DEFAULT_DATA: TrackerData = {
  picks: [],
  stats: { total: 0, won: 0, lost: 0, pending: 0, winRate: 0 },
  weights: { formWeight: 0.4, h2hWeight: 0.3, goalsWeight: 0.3, minConfidenceThreshold: 65 },
  leagueStats: {},
  leagueBlacklist: [],
};

export class BetTracker {
  private data: TrackerData;

  constructor(private filePath: string, initialBankroll = 0) {
    this.data = this.load();
    if (initialBankroll > 0 && !this.data.bankroll) {
      this.data.bankroll = { initial: initialBankroll, current: initialBankroll };
      this.save();
    }
  }

  get threshold(): number {
    return this.data.weights.minConfidenceThreshold;
  }

  get weights(): TrackerData['weights'] {
    return { ...this.data.weights };
  }

  /** Weights in FormAnalyzer format — sync after each self-learning cycle */
  get formAnalyzerWeights(): { form: number; h2h: number; goals: number } {
    return {
      form: this.data.weights.formWeight,
      h2h: this.data.weights.h2hWeight,
      goals: this.data.weights.goalsWeight,
    };
  }

  recordPick(
    analysis: FormAnalysis,
    odds?: number,
    suggestedStake?: number,
    edge?: number,
    pickType: 'prematch' | 'live' = 'live'
  ): BetPick {
    const pick: BetPick = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      eventId: analysis.eventId,
      match: analysis.match,
      sport: analysis.sport,
      league: analysis.league,
      pick: analysis.pick,
      confidence: analysis.confidence,
      odds,
      suggestedStake,
      edge,
      signals: analysis.signals,
      pickType,
      kickoffTime: analysis.kickoffTime,
      status: 'pending',
    };
    this.data.picks.push(pick);
    this.recalcStats();
    this.save();
    return pick;
  }

  /** Number of picks recorded today (UTC date) */
  picksToday(): number {
    const today = new Date().toISOString().slice(0, 10);
    return this.data.picks.filter((p) => p.timestamp.startsWith(today)).length;
  }

  /** Last N resolved picks (for anti-chase detection) */
  recentPicks(n = 10): BetPick[] {
    return [...this.data.picks]
      .filter((p) => p.status !== 'pending')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, n);
  }

  isLeagueBlacklisted(league: string): boolean {
    return (this.data.leagueBlacklist ?? []).includes(league);
  }

  resolvePick(eventId: number, actualOutcome: PickOutcome): void {
    let changed = false;
    for (const pick of this.data.picks) {
      if (pick.eventId === eventId && pick.status === 'pending') {
        pick.status = pick.pick === actualOutcome ? 'won' : 'lost';
        pick.resolvedAt = new Date().toISOString();
        this.updateLeagueStats(pick.league, pick.status === 'won');
        this.updateBankroll(pick);
        changed = true;
      }
    }
    if (changed) {
      this.recalcStats();
      this.maybeSelfLearn();
      this.maybeTuneWeights();
      this.maybeUpdateBlacklist();
      this.save();
    }
  }

  getStats(): TrackerData['stats'] & { threshold: number } {
    return { ...this.data.stats, threshold: this.data.weights.minConfidenceThreshold };
  }

  getSummary(): string {
    const s = this.data.stats;
    const t = this.data.weights.minConfidenceThreshold;
    const bl = (this.data.leagueBlacklist ?? []).length;
    let bankrollLine = '';
    if (this.data.bankroll && this.data.bankroll.initial > 0) {
      const { initial, current } = this.data.bankroll;
      const pnl = +(current - initial).toFixed(2);
      const pct = +((pnl / initial) * 100).toFixed(1);
      bankrollLine = ` | Bankroll: $${current} (${pnl >= 0 ? '+' : ''}$${pnl} / ${pct >= 0 ? '+' : ''}${pct}%)`;
    }
    return (
      `📊 Bot Stats | Picks: ${s.total} | Won: ${s.won} | Lost: ${s.lost} | ` +
      `Win rate: ${(s.winRate * 100).toFixed(1)}% | Min confidence: ${t}%` +
      bankrollLine +
      (bl > 0 ? ` | Blacklisted: ${bl} league(s)` : '')
    );
  }

  getBriefingData(): {
    yesterday: { won: number; lost: number; pending: number };
    overall: TrackerData['stats'];
    blacklistedLeagues: string[];
    bankroll?: { initial: number; current: number };
  } {
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    const dateStr = yest.toISOString().slice(0, 10);
    const yesterdayPicks = this.data.picks.filter(
      (p) => p.resolvedAt?.startsWith(dateStr) ||
             (p.status === 'pending' && p.timestamp.startsWith(dateStr))
    );
    return {
      yesterday: {
        won: yesterdayPicks.filter((p) => p.status === 'won').length,
        lost: yesterdayPicks.filter((p) => p.status === 'lost').length,
        pending: yesterdayPicks.filter((p) => p.status === 'pending').length,
      },
      overall: { ...this.data.stats },
      blacklistedLeagues: [...(this.data.leagueBlacklist ?? [])],
      bankroll: this.data.bankroll ? { ...this.data.bankroll } : undefined,
    };
  }

  private updateLeagueStats(league: string, won: boolean): void {
    if (!this.data.leagueStats) this.data.leagueStats = {};
    const stat = this.data.leagueStats[league] ?? { won: 0, total: 0 };
    stat.total++;
    if (won) stat.won++;
    this.data.leagueStats[league] = stat;
  }

  private updateBankroll(pick: BetPick): void {
    if (!this.data.bankroll || !pick.suggestedStake) return;
    const stake = pick.suggestedStake;
    if (pick.status === 'won' && pick.odds) {
      this.data.bankroll.current = +(this.data.bankroll.current + stake * (pick.odds - 1)).toFixed(2);
    } else if (pick.status === 'lost') {
      this.data.bankroll.current = +(this.data.bankroll.current - stake).toFixed(2);
    }
  }

  private maybeUpdateBlacklist(): void {
    if (!this.data.leagueStats) return;
    if (!this.data.leagueBlacklist) this.data.leagueBlacklist = [];
    for (const [league, stat] of Object.entries(this.data.leagueStats)) {
      if (stat.total >= 5 && stat.won / stat.total < 0.4 && !this.data.leagueBlacklist.includes(league)) {
        this.data.leagueBlacklist.push(league);
        const pct = ((stat.won / stat.total) * 100).toFixed(0);
        console.log(`🚫 [Auto-blacklist] "${league}" — win rate ${pct}% over ${stat.total} picks`);
      }
    }
  }

  private recalcStats(): void {
    const resolved = this.data.picks.filter((p) => p.status !== 'pending' && p.status !== 'void');
    const won = resolved.filter((p) => p.status === 'won').length;
    this.data.stats = {
      total: this.data.picks.length,
      won,
      lost: resolved.filter((p) => p.status === 'lost').length,
      pending: this.data.picks.filter((p) => p.status === 'pending').length,
      winRate: resolved.length ? won / resolved.length : 0,
    };
  }

  /**
   * Self-learning: after every 20 resolved picks, adjust the minimum confidence
   * threshold based on accuracy per confidence bucket.
   */
  private maybeSelfLearn(): void {
    const resolved = this.data.picks.filter((p) => p.status === 'won' || p.status === 'lost');
    if (resolved.length < 20 || resolved.length % 10 !== 0) return;

    const buckets: Record<string, { won: number; total: number }> = {
      '50-60': { won: 0, total: 0 },
      '60-70': { won: 0, total: 0 },
      '70-80': { won: 0, total: 0 },
      '80+': { won: 0, total: 0 },
    };

    for (const pick of resolved) {
      const key =
        pick.confidence < 60 ? '50-60' :
        pick.confidence < 70 ? '60-70' :
        pick.confidence < 80 ? '70-80' : '80+';
      const bucket = buckets[key];
      if (bucket) {
        bucket.total++;
        if (pick.status === 'won') bucket.won++;
      }
    }

    let newThreshold = 80;
    for (const [range, b] of Object.entries(buckets)) {
      if (b.total >= 5) {
        const acc = b.won / b.total;
        const lower = parseInt(range.replace('+', ''));
        if (acc >= 0.55 && lower < newThreshold) newThreshold = lower;
      }
    }

    const clamped = Math.max(55, Math.min(80, newThreshold));
    if (clamped !== this.data.weights.minConfidenceThreshold) {
      console.log(`🧠 [Self-learn] Min confidence: ${this.data.weights.minConfidenceThreshold}% → ${clamped}%`);
      this.data.weights.minConfidenceThreshold = clamped;
    }
  }

  /**
   * Weight tuning: after every 20 resolved picks that have signal data,
   * correlate each signal's dominance with wins. Shift weights toward
   * whichever signal has been most predictive (10% learning rate).
   */
  private maybeTuneWeights(): void {
    const resolved = this.data.picks.filter(
      (p) => (p.status === 'won' || p.status === 'lost') && p.signals
    );
    if (resolved.length < 20 || resolved.length % 10 !== 0) return;

    const sig = {
      form:  { wins: 0, total: 0 },
      h2h:   { wins: 0, total: 0 },
      goals: { wins: 0, total: 0 },
    };

    for (const pick of resolved) {
      if (!pick.signals) continue;
      const { formScore, h2hScore, goalsScore } = pick.signals;
      const max = Math.max(formScore, h2hScore, goalsScore);
      const dominant: 'form' | 'h2h' | 'goals' =
        formScore === max ? 'form' : h2hScore === max ? 'h2h' : 'goals';
      sig[dominant].total++;
      if (pick.status === 'won') sig[dominant].wins++;
    }

    const acc = {
      form:  sig.form.total  >= 3 ? sig.form.wins  / sig.form.total  : null,
      h2h:   sig.h2h.total   >= 3 ? sig.h2h.wins   / sig.h2h.total   : null,
      goals: sig.goals.total >= 3 ? sig.goals.wins / sig.goals.total : null,
    };

    const valid = (Object.keys(acc) as Array<'form' | 'h2h' | 'goals'>).filter((k) => acc[k] !== null);
    if (valid.length < 2) return;

    const totalAcc = valid.reduce((s, k) => s + (acc[k] as number), 0);
    if (totalAcc === 0) return;

    const ideal = {
      form:  acc.form  !== null ? acc.form  / totalAcc : this.data.weights.formWeight,
      h2h:   acc.h2h   !== null ? acc.h2h   / totalAcc : this.data.weights.h2hWeight,
      goals: acc.goals !== null ? acc.goals / totalAcc : this.data.weights.goalsWeight,
    };

    const idealSum = ideal.form + ideal.h2h + ideal.goals;
    ideal.form  /= idealSum;
    ideal.h2h   /= idealSum;
    ideal.goals /= idealSum;

    const RATE = 0.1;
    const clamp = (v: number) => Math.max(0.15, Math.min(0.60, v));
    let fw = clamp(+(this.data.weights.formWeight  + RATE * (ideal.form  - this.data.weights.formWeight)).toFixed(3));
    let hw = clamp(+(this.data.weights.h2hWeight   + RATE * (ideal.h2h   - this.data.weights.h2hWeight)).toFixed(3));
    let gw = clamp(+(this.data.weights.goalsWeight + RATE * (ideal.goals - this.data.weights.goalsWeight)).toFixed(3));

    // Renormalize to exactly 1.0
    const sum = fw + hw + gw;
    fw = +(fw / sum).toFixed(3);
    hw = +(hw / sum).toFixed(3);
    gw = +(1 - fw - hw).toFixed(3);

    if (fw !== this.data.weights.formWeight || hw !== this.data.weights.h2hWeight || gw !== this.data.weights.goalsWeight) {
      const old = this.data.weights;
      console.log(
        `🧠 [Weight tuning] form: ${old.formWeight}→${fw}, h2h: ${old.h2hWeight}→${hw}, goals: ${old.goalsWeight}→${gw}` +
        ` (accuracies: form ${acc.form !== null ? (acc.form * 100).toFixed(0) : '—'}%, h2h ${acc.h2h !== null ? (acc.h2h * 100).toFixed(0) : '—'}%, goals ${acc.goals !== null ? (acc.goals * 100).toFixed(0) : '—'}%)`
      );
      this.data.weights.formWeight  = fw;
      this.data.weights.h2hWeight   = hw;
      this.data.weights.goalsWeight = gw;
    }
  }

  private load(): TrackerData {
    if (!existsSync(this.filePath)) return { ...DEFAULT_DATA, leagueStats: {}, leagueBlacklist: [] };
    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf-8')) as TrackerData;
      data.leagueStats    = data.leagueStats    ?? {};
      data.leagueBlacklist = data.leagueBlacklist ?? [];
      return data;
    } catch {
      return { ...DEFAULT_DATA, leagueStats: {}, leagueBlacklist: [] };
    }
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }
}
