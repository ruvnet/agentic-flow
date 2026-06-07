import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import type { BetPick, TrackerData, PickOutcome, FormAnalysis } from './types.js';

const DEFAULT_DATA: TrackerData = {
  picks: [],
  stats: { total: 0, won: 0, lost: 0, pending: 0, winRate: 0 },
  weights: { formWeight: 0.4, h2hWeight: 0.3, goalsWeight: 0.3, minConfidenceThreshold: 65 },
};

export class BetTracker {
  private data: TrackerData;

  constructor(private filePath: string) {
    this.data = this.load();
  }

  get threshold(): number {
    return this.data.weights.minConfidenceThreshold;
  }

  get weights(): TrackerData['weights'] {
    return { ...this.data.weights };
  }

  recordPick(analysis: FormAnalysis, odds?: number): BetPick {
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
      status: 'pending',
    };
    this.data.picks.push(pick);
    this.recalcStats();
    this.save();
    return pick;
  }

  resolvePick(eventId: number, actualOutcome: PickOutcome): void {
    let changed = false;
    for (const pick of this.data.picks) {
      if (pick.eventId === eventId && pick.status === 'pending') {
        pick.status = pick.pick === actualOutcome ? 'won' : 'lost';
        pick.resolvedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) {
      this.recalcStats();
      this.maybeSelfLearn();
      this.save();
    }
  }

  getStats(): TrackerData['stats'] & { threshold: number } {
    return { ...this.data.stats, threshold: this.data.weights.minConfidenceThreshold };
  }

  getSummary(): string {
    const s = this.data.stats;
    const t = this.data.weights.minConfidenceThreshold;
    return (
      `📊 Bot Stats | Picks: ${s.total} | Won: ${s.won} | Lost: ${s.lost} | ` +
      `Win rate: ${(s.winRate * 100).toFixed(1)}% | Min confidence: ${t}%`
    );
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
   * Self-learning: after every 20 resolved picks, check accuracy per confidence
   * bucket and raise/lower the minimum confidence threshold accordingly.
   */
  private maybeSelfLearn(): void {
    const resolved = this.data.picks.filter((p) => p.status === 'won' || p.status === 'lost');
    if (resolved.length < 20 || resolved.length % 10 !== 0) return;

    // Bucket picks by confidence range and calculate accuracy
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
      buckets[key].total++;
      if (pick.status === 'won') buckets[key].won++;
    }

    // Find the lowest confidence bucket with >= 55% accuracy
    let newThreshold = 80;
    for (const [range, b] of Object.entries(buckets)) {
      if (b.total >= 5) {
        const acc = b.won / b.total;
        const lower = parseInt(range.replace('+', ''));
        if (acc >= 0.55 && lower < newThreshold) newThreshold = lower;
      }
    }

    // Cap between 55 and 80
    const clamped = Math.max(55, Math.min(80, newThreshold));
    if (clamped !== this.data.weights.minConfidenceThreshold) {
      console.log(
        `🧠 [Self-learn] Adjusting min confidence: ${this.data.weights.minConfidenceThreshold}% → ${clamped}%`
      );
      this.data.weights.minConfidenceThreshold = clamped;
    }
  }

  private load(): TrackerData {
    if (!existsSync(this.filePath)) return { ...DEFAULT_DATA };
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf-8')) as TrackerData;
    } catch {
      return { ...DEFAULT_DATA };
    }
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }
}
