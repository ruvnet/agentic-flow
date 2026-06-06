import type { LiveStream, BettingAlert } from './types.js';

export class BettingAnalyzer {
  private knownEvents = new Map<string, LiveStream>();

  analyze(current: LiveStream[]): BettingAlert[] {
    const alerts: BettingAlert[] = [];
    const now = new Date().toISOString();

    for (const event of current) {
      const key = event.id ?? `${event.homeTeam}-${event.awayTeam}`;
      const previous = this.knownEvents.get(key);

      if (!previous) {
        alerts.push({
          type: 'new_match',
          timestamp: now,
          event,
          message: `NEW LIVE: ${event.homeTeam} vs ${event.awayTeam} [${event.sport} / ${event.league}]`,
        });
      } else if (previous.status !== event.status) {
        const ended = /finish|end|final/i.test(event.status ?? '');
        alerts.push({
          type: ended ? 'match_ended' : 'live_event',
          timestamp: now,
          event,
          message: ended
            ? `ENDED: ${event.homeTeam} vs ${event.awayTeam} — Status: ${event.status}`
            : `STATUS CHANGE: ${event.homeTeam} vs ${event.awayTeam} → ${event.status}`,
        });
      }

      this.knownEvents.set(key, event);
    }

    // detect removed events (ended without status change)
    for (const [key, prev] of this.knownEvents.entries()) {
      const stillLive = current.some(
        (e) => (e.id ?? `${e.homeTeam}-${e.awayTeam}`) === key
      );
      if (!stillLive) {
        alerts.push({
          type: 'match_ended',
          timestamp: now,
          event: prev,
          message: `REMOVED FROM LIVE: ${prev.homeTeam} vs ${prev.awayTeam}`,
        });
        this.knownEvents.delete(key);
      }
    }

    return alerts;
  }

  get trackedCount(): number {
    return this.knownEvents.size;
  }
}
