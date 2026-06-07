import type {
  SofaEvent,
  OddsMarket,
  OddsChoice,
  BettingAlert,
} from './types.js';

// fractional "5/2" → decimal 3.5
function fracToDecimal(frac?: string): number | undefined {
  if (!frac) return undefined;
  const [n, d] = frac.split('/').map(Number);
  if (!d || isNaN(n) || isNaN(d)) return undefined;
  return +(n / d + 1).toFixed(3);
}

function matchLabel(e: SofaEvent): string {
  return `${e.homeTeam.name} vs ${e.awayTeam.name}`;
}

function scoreLabel(e: SofaEvent): string {
  const h = e.homeScore?.current ?? 0;
  const a = e.awayScore?.current ?? 0;
  return `${h}–${a}`;
}

interface TrackedEvent {
  event: SofaEvent;
  scoreSnapshot: string;
  odds: Map<string, OddsChoice>; // key = "marketName|choiceName"
}

export class BettingAnalyzer {
  private tracked = new Map<number, TrackedEvent>();
  private readonly oddsThresholdPct: number;

  constructor(oddsMovementThresholdPct: number) {
    this.oddsThresholdPct = oddsMovementThresholdPct;
  }

  analyzeEvents(
    incoming: SofaEvent[],
    oddsMap: Map<number, OddsMarket[]>
  ): BettingAlert[] {
    const alerts: BettingAlert[] = [];
    const now = new Date().toISOString();
    const seenIds = new Set<number>();

    for (const event of incoming) {
      seenIds.add(event.id);
      const sport = event.sport?.name ?? 'Unknown';
      const league = event.tournament?.name ?? 'Unknown';
      const match = matchLabel(event);
      const score = scoreLabel(event);
      const markets = oddsMap.get(event.id) ?? [];

      const previous = this.tracked.get(event.id);

      if (!previous) {
        // Brand-new live event
        alerts.push({
          type: 'new_event',
          timestamp: now,
          eventId: event.id,
          match,
          sport,
          league,
          message: `🆕 LIVE NOW: ${match} [${league}] — ${score}`,
        });

        this.tracked.set(event.id, {
          event,
          scoreSnapshot: score,
          odds: this.buildOddsSnapshot(markets),
        });
        continue;
      }

      // Score change
      if (score !== previous.scoreSnapshot) {
        alerts.push({
          type: 'score_change',
          timestamp: now,
          eventId: event.id,
          match,
          sport,
          league,
          message: `⚽ GOAL: ${match} — now ${score} (was ${previous.scoreSnapshot})`,
        });
        previous.scoreSnapshot = score;
      }

      // Odds movement
      if (markets.length > 0) {
        const oddsAlerts = this.checkOddsMovement(
          event,
          sport,
          league,
          match,
          now,
          markets,
          previous.odds
        );
        alerts.push(...oddsAlerts);
        // Refresh snapshot with latest odds
        previous.odds = this.buildOddsSnapshot(markets);
      }

      previous.event = event;
    }

    // Events that dropped off the live feed
    for (const [id, tracked] of this.tracked.entries()) {
      if (!seenIds.has(id)) {
        const e = tracked.event;
        const sport = e.sport?.name ?? 'Unknown';
        const league = e.tournament?.name ?? 'Unknown';
        alerts.push({
          type: 'event_ended',
          timestamp: now,
          eventId: id,
          match: matchLabel(e),
          sport,
          league,
          message: `🏁 ENDED: ${matchLabel(e)} — Final ${tracked.scoreSnapshot}`,
        });
        this.tracked.delete(id);
      }
    }

    return alerts;
  }

  private buildOddsSnapshot(markets: OddsMarket[]): Map<string, OddsChoice> {
    const snap = new Map<string, OddsChoice>();
    for (const market of markets) {
      for (const choice of market.choices) {
        const decimal = fracToDecimal(choice.fractionalValue);
        const initialDecimal = fracToDecimal(choice.initialFractionalValue);
        snap.set(`${market.marketName}|${choice.name}`, {
          ...choice,
          decimal,
          initialDecimal,
        });
      }
    }
    return snap;
  }

  private checkOddsMovement(
    event: SofaEvent,
    sport: string,
    league: string,
    match: string,
    now: string,
    markets: OddsMarket[],
    prevSnap: Map<string, OddsChoice>
  ): BettingAlert[] {
    const alerts: BettingAlert[] = [];

    for (const market of markets) {
      // Only look at the main 1X2 market
      if (!/full.?time|1x2|match.?winner/i.test(market.marketName)) continue;

      for (const choice of market.choices) {
        const key = `${market.marketName}|${choice.name}`;
        const prev = prevSnap.get(key);
        const currentDecimal = fracToDecimal(choice.fractionalValue);

        if (!currentDecimal || !prev?.decimal) continue;

        const changePct = ((currentDecimal - prev.decimal) / prev.decimal) * 100;
        const absPct = Math.abs(changePct);

        if (absPct >= this.oddsThresholdPct) {
          const direction = changePct > 0 ? '📈 DRIFTING' : '📉 SHORTENING';
          const isValue = changePct > 0; // price lengthened = potential value

          alerts.push({
            type: isValue ? 'value_bet' : 'odds_movement',
            timestamp: now,
            eventId: event.id,
            match,
            sport,
            league,
            message:
              `${direction} [${market.marketName}] ${choice.name}: ` +
              `${prev.decimal} → ${currentDecimal} (${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}%)` +
              ` | ${match}`,
            meta: {
              market: market.marketName,
              selection: choice.name,
              prevOdds: prev.decimal,
              currentOdds: currentDecimal,
              changePct: +changePct.toFixed(2),
            },
          });
        }
      }
    }

    return alerts;
  }

  get liveCount(): number {
    return this.tracked.size;
  }
}
