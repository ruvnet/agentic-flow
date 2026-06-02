import React from 'react';
import type { OddsResponse, ValueBet, ArbOpportunity } from '../../types/betting';

// ─── Pure calculation helpers ────────────────────────────────────────────────

function impliedProb(odds: number): number {
  return 1 / odds;
}

function pinnacleMarginForMarket(data: OddsResponse, marketName: string): number {
  const pin = data.bookmakers.find(b => b.name === 'Pinnacle');
  if (!pin) return 0;
  const m = pin.markets.find(m => m.name === marketName);
  if (!m) return 0;
  return m.outcomes.reduce((sum, o) => sum + impliedProb(o.odds), 0);
}

export function detectValueBets(data: OddsResponse): ValueBet[] {
  const values: ValueBet[] = [];
  const pinnacle = data.bookmakers.find(b => b.name === 'Pinnacle');
  if (!pinnacle) return values;

  for (const bm of data.bookmakers) {
    if (bm.name === 'Pinnacle') continue;
    for (const market of bm.markets) {
      const pinMarket = pinnacle.markets.find(m => m.name === market.name);
      if (!pinMarket) continue;
      const margin = pinnacleMarginForMarket(data, market.name);
      if (margin === 0) continue;
      for (const outcome of market.outcomes) {
        const pinOutcome = pinMarket.outcomes.find(o => o.name === outcome.name);
        if (!pinOutcome) continue;
        const fairOdds = 1 / (impliedProb(pinOutcome.odds) / margin);
        const edge = ((outcome.odds / fairOdds) - 1) * 100;
        if (edge > 1) {
          values.push({
            bookmaker: bm.name,
            market: market.name,
            outcome: outcome.name,
            odds: outcome.odds,
            fairOdds,
            edge,
          });
        }
      }
    }
  }
  return values.sort((a, b) => b.edge - a.edge);
}

export function detectArbitrage(data: OddsResponse): ArbOpportunity[] {
  const arbs: ArbOpportunity[] = [];
  const marketNames = data.bookmakers[0]?.markets.map(m => m.name) ?? [];

  for (const marketName of marketNames) {
    const markets = data.bookmakers
      .map(bm => ({ bm: bm.name, market: bm.markets.find(m => m.name === marketName) }))
      .filter(x => x.market != null);

    const outcomes = markets[0]?.market?.outcomes.map(o => o.name) ?? [];
    const combinations: ArbOpportunity['combinations'] = [];
    let totalInverse = 0;

    for (const outcome of outcomes) {
      let bestOdds = 0;
      let bestBm = '';
      for (const { bm, market } of markets) {
        const o = market?.outcomes.find(o => o.name === outcome);
        if (o && o.odds > bestOdds) { bestOdds = o.odds; bestBm = bm; }
      }
      if (bestOdds > 0) {
        totalInverse += 1 / bestOdds;
        combinations.push({ bookmaker: bestBm, outcome, odds: bestOdds, stake: 0 });
      }
    }

    if (totalInverse < 1) {
      const profit = (1 / totalInverse - 1) * 100;
      const staked = combinations.map(c => ({
        ...c,
        stake: Math.round((1 / (c.odds * totalInverse)) * 100),
      }));
      arbs.push({ market: marketName, combinations: staked, profit });
    }
  }
  return arbs;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ValueBetAlert({ bets }: { bets: ValueBet[] }) {
  if (bets.length === 0) return null;
  return (
    <div className="space-y-2">
      {bets.map((vb, i) => {
        const kelly = ((vb.edge / 100) / (vb.odds - 1)) * 100;
        return (
          <div key={i} className="bg-amber-900/40 border border-amber-600/50 rounded-xl p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-amber-300 font-bold text-sm">
                  🎯 VALUE BET: {vb.bookmaker} — {vb.outcome} @ {vb.odds.toFixed(2)}
                </p>
                <p className="text-gray-400 text-xs mt-1">
                  Fair price from Pinnacle: {vb.fairOdds.toFixed(2)} | Your edge: +{vb.edge.toFixed(1)}%
                </p>
                <p className="text-amber-400/80 text-xs mt-0.5">
                  Kelly stake: Bet {kelly.toFixed(1)}% of bankroll
                </p>
              </div>
              <span className="shrink-0 text-green-400 font-bold text-lg">+{vb.edge.toFixed(1)}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ArbAlert({ arbs }: { arbs: ArbOpportunity[] }) {
  if (arbs.length === 0) return null;
  return (
    <div className="space-y-2">
      {arbs.map((arb, i) => (
        <div key={i} className="bg-green-900/40 border border-green-600/50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-green-300 font-bold text-sm">
              🔒 GUARANTEED PROFIT: +{arb.profit.toFixed(2)}% — {arb.market}
            </p>
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${arb.combinations.length}, 1fr)` }}>
            {arb.combinations.map((c, j) => (
              <div key={j} className="bg-gray-800/80 rounded-lg p-3 text-xs">
                <div className="text-gray-400 mb-1">{c.outcome}</div>
                <div className="text-white font-semibold">{c.bookmaker}</div>
                <div className="text-yellow-400 mt-1">@ {c.odds.toFixed(2)}</div>
                <div className="text-green-300 font-medium">£{c.stake} stake</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MarketTabs({
  markets,
  selected,
  onSelect,
}: {
  markets: string[];
  selected: string;
  onSelect: (m: string) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
      {markets.map(m => (
        <button
          key={m}
          onClick={() => onSelect(m)}
          className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            selected === m
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 text-gray-400 active:bg-gray-700'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

function OddsGrid({
  data,
  marketName,
}: {
  data: OddsResponse;
  marketName: string;
}) {
  const outcomes = data.bookmakers[0]?.markets
    .find(m => m.name === marketName)?.outcomes.map(o => o.name) ?? [];

  const getBestOdds = (outcomeName: string): number => {
    let best = 0;
    for (const bm of data.bookmakers) {
      const o = bm.markets.find(m => m.name === marketName)?.outcomes.find(o => o.name === outcomeName);
      if (o && o.odds > best) best = o.odds;
    }
    return best;
  };

  const bestMap = Object.fromEntries(outcomes.map(o => [o, getBestOdds(o)]));

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm min-w-[340px]">
        <thead>
          <tr className="border-b border-gray-800">
            <th className="text-left py-2 px-2 text-gray-500 font-medium text-xs">Bookmaker</th>
            {outcomes.map(o => (
              <th key={o} className="text-center py-2 px-2 text-gray-500 font-medium text-xs">{o}</th>
            ))}
            <th className="text-center py-2 px-2 text-gray-500 font-medium text-xs">Margin</th>
          </tr>
        </thead>
        <tbody>
          {data.bookmakers.map(bm => {
            const market = bm.markets.find(m => m.name === marketName);
            if (!market) return null;
            const margin = (market.outcomes.reduce((s, o) => s + 1 / o.odds, 0) - 1) * 100;
            const marginColor = margin < 3 ? 'text-green-400' : margin < 6 ? 'text-yellow-400' : 'text-red-400';
            return (
              <tr key={bm.name} className="border-b border-gray-800/60 active:bg-gray-800/40">
                <td className="py-3 px-2 font-medium text-white text-xs leading-tight">{bm.name}</td>
                {outcomes.map(outcomeName => {
                  const o = market.outcomes.find(o => o.name === outcomeName);
                  const isBest = o != null && o.odds === bestMap[outcomeName];
                  return (
                    <td key={outcomeName} className="text-center py-3 px-2">
                      {o ? (
                        <span className={`inline-block px-2 py-1 rounded font-mono text-sm ${
                          isBest
                            ? 'bg-green-700/50 text-green-300 font-bold'
                            : 'text-gray-300'
                        }`}>
                          {o.odds.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-gray-700">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="text-center py-3 px-2">
                  <span className={`text-xs font-medium ${marginColor}`}>
                    {margin.toFixed(1)}%
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  data: OddsResponse;
}

export default function OddsTable({ data }: Props) {
  const marketNames = Array.from(
    new Set(data.bookmakers.flatMap(bm => bm.markets.map(m => m.name)))
  );
  const [selectedMarket, setSelectedMarket] = React.useState(marketNames[0] ?? '');

  const valueBets = detectValueBets(data);
  const arbs = detectArbitrage(data);

  return (
    <div className="space-y-5">
      {/* Alerts */}
      <ValueBetAlert bets={valueBets} />
      <ArbAlert arbs={arbs} />

      {/* Market tabs */}
      {marketNames.length > 1 && (
        <MarketTabs markets={marketNames} selected={selectedMarket} onSelect={setSelectedMarket} />
      )}

      {/* Odds grid */}
      <OddsGrid data={data} marketName={selectedMarket} />

      {/* Legend */}
      <div className="flex gap-4 text-xs text-gray-600 pt-1">
        <span><span className="text-green-400">■</span> Best odds</span>
        <span><span className="text-green-400">Margin</span> &lt;3% good</span>
        <span><span className="text-yellow-400">Margin</span> &lt;6% ok</span>
        <span><span className="text-red-400">Margin</span> &gt;6% poor</span>
      </div>
    </div>
  );
}
