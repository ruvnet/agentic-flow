import React from 'react';
import type { OddsResponse, ValueBet, ArbOpportunity } from '../../types/betting';

// ─── Pure calculation helpers ─────────────────────────────────────────────────

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
        if (o && o.odds > bestOdds) {
          bestOdds = o.odds;
          bestBm = bm;
        }
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

// ─── Alert components ─────────────────────────────────────────────────────────

function ValueBetAlerts({ bets }: { bets: ValueBet[] }) {
  if (bets.length === 0) return null;
  return (
    <div className="space-y-2">
      {bets.map((vb, i) => {
        const b = vb.odds - 1;
        const kelly = b > 0 ? ((vb.edge / 100) / b) * 100 : 0;
        return (
          <div key={i} className="bg-amber-950/60 border border-amber-600/40 rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-amber-300 font-bold text-sm leading-snug">
                  🎯 VALUE BET: {vb.bookmaker}
                </p>
                <p className="text-amber-200/80 text-sm mt-0.5">
                  {vb.outcome}{' '}
                  <span className="font-mono font-bold">@ {vb.odds.toFixed(2)}</span>
                </p>
                <p className="text-gray-400 text-xs mt-1.5">
                  Fair price (Pinnacle):{' '}
                  <span className="font-mono">{vb.fairOdds.toFixed(2)}</span>
                  {' · '}Market: {vb.market}
                </p>
                <p className="text-amber-400/70 text-xs mt-0.5">
                  Kelly stake: {kelly.toFixed(1)}% of bankroll
                </p>
              </div>
              <div className="shrink-0 text-right">
                <span className="text-green-400 font-extrabold text-xl">+{vb.edge.toFixed(1)}%</span>
                <p className="text-gray-500 text-xs">edge</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ArbAlerts({ arbs }: { arbs: ArbOpportunity[] }) {
  if (arbs.length === 0) return null;
  return (
    <div className="space-y-2">
      {arbs.map((arb, i) => (
        <div key={i} className="bg-green-950/60 border border-green-600/40 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-green-300 font-bold text-sm">🔒 GUARANTEED PROFIT</p>
              <p className="text-gray-400 text-xs mt-0.5">{arb.market}</p>
            </div>
            <span className="text-green-400 font-extrabold text-xl">+{arb.profit.toFixed(2)}%</span>
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(arb.combinations.length, 3)}, 1fr)` }}>
            {arb.combinations.map((c, j) => (
              <div key={j} className="bg-gray-800/70 rounded-xl p-3 text-xs">
                <div className="text-gray-400 mb-1 truncate">{c.outcome}</div>
                <div className="text-white font-semibold truncate">{c.bookmaker}</div>
                <div className="text-yellow-400 font-mono mt-1">@ {c.odds.toFixed(2)}</div>
                <div className="text-green-300 font-semibold">£{c.stake} stake</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Market tabs ──────────────────────────────────────────────────────────────

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
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
      {markets.map(m => (
        <button
          key={m}
          onClick={() => onSelect(m)}
          className={`shrink-0 px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
            selected === m
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700 active:bg-gray-600'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

// ─── Odds grid ────────────────────────────────────────────────────────────────

function OddsGrid({
  data,
  marketName,
}: {
  data: OddsResponse;
  marketName: string;
}) {
  const outcomes =
    data.bookmakers[0]?.markets.find(m => m.name === marketName)?.outcomes.map(o => o.name) ?? [];

  const getBestOdds = (outcomeName: string): number => {
    let best = 0;
    for (const bm of data.bookmakers) {
      const o = bm.markets
        .find(m => m.name === marketName)
        ?.outcomes.find(o => o.name === outcomeName);
      if (o && o.odds > best) best = o.odds;
    }
    return best;
  };

  const bestMap = Object.fromEntries(outcomes.map(o => [o, getBestOdds(o)]));

  // Shorten outcome names for mobile
  const shortLabel = (name: string): string => {
    if (name === 'Home') return '1';
    if (name === 'Draw') return 'X';
    if (name === 'Away') return '2';
    if (name.length > 12) return name.slice(0, 11) + '…';
    return name;
  };

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm" style={{ minWidth: '320px' }}>
        <thead>
          <tr className="border-b border-gray-800">
            <th className="text-left py-2 px-2 text-gray-600 font-medium text-xs w-28">Bookmaker</th>
            {outcomes.map(o => (
              <th key={o} className="text-center py-2 px-1 text-gray-500 font-medium text-xs">
                {shortLabel(o)}
              </th>
            ))}
            <th className="text-center py-2 px-2 text-gray-600 font-medium text-xs">Margin</th>
          </tr>
        </thead>
        <tbody>
          {data.bookmakers.map(bm => {
            const market = bm.markets.find(m => m.name === marketName);
            if (!market) return null;
            const margin = (market.outcomes.reduce((s, o) => s + 1 / o.odds, 0) - 1) * 100;
            const marginColor =
              margin < 3 ? 'text-green-400' : margin < 6 ? 'text-yellow-400' : 'text-red-400';
            const marginBg =
              margin < 3
                ? 'bg-green-900/30'
                : margin < 6
                ? 'bg-yellow-900/20'
                : 'bg-red-900/20';
            return (
              <tr key={bm.name} className="border-b border-gray-800/50">
                <td className="py-3 px-2 font-semibold text-gray-300 text-xs leading-tight w-28">
                  {bm.name}
                </td>
                {outcomes.map(outcomeName => {
                  const o = market.outcomes.find(o => o.name === outcomeName);
                  const isBest = o != null && o.odds === bestMap[outcomeName];
                  return (
                    <td key={outcomeName} className="text-center py-2 px-1">
                      {o ? (
                        <span
                          className={`inline-block px-2 py-1.5 rounded-lg font-mono text-sm font-bold ${
                            isBest
                              ? 'bg-green-700/40 text-green-300 ring-1 ring-green-600/40'
                              : 'text-gray-300'
                          }`}
                        >
                          {o.odds.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-gray-700 text-lg">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="text-center py-2 px-2">
                  <span className={`inline-block px-2 py-1 rounded-lg text-xs font-bold ${marginColor} ${marginBg}`}>
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

// ─── Summary row: best odds per outcome ──────────────────────────────────────

function BestOddsSummary({
  data,
  marketName,
}: {
  data: OddsResponse;
  marketName: string;
}) {
  const outcomes =
    data.bookmakers[0]?.markets.find(m => m.name === marketName)?.outcomes.map(o => o.name) ?? [];

  if (outcomes.length === 0) return null;

  const bests = outcomes.map(outcomeName => {
    let bestOdds = 0;
    let bestBm = '';
    for (const bm of data.bookmakers) {
      const o = bm.markets
        .find(m => m.name === marketName)
        ?.outcomes.find(o => o.name === outcomeName);
      if (o && o.odds > bestOdds) {
        bestOdds = o.odds;
        bestBm = bm.name;
      }
    }
    return { outcome: outcomeName, odds: bestOdds, bookmaker: bestBm };
  });

  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(bests.length, 3)}, 1fr)` }}>
      {bests.map(({ outcome, odds, bookmaker }) => (
        <div key={outcome} className="bg-gray-800 rounded-2xl p-3 text-center">
          <p className="text-gray-500 text-xs mb-1">{outcome}</p>
          <p className="text-white font-extrabold text-2xl font-mono">{odds.toFixed(2)}</p>
          <p className="text-blue-400 text-xs mt-1 truncate">{bookmaker}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function MarginLegend() {
  return (
    <div className="flex gap-3 text-xs text-gray-600 pt-1 flex-wrap">
      <span>
        <span className="text-green-400 font-bold">■</span> Best odds
      </span>
      <span>
        <span className="text-green-400">Margin &lt;3%</span> = sharp
      </span>
      <span>
        <span className="text-yellow-400">Margin &lt;6%</span> = ok
      </span>
      <span>
        <span className="text-red-400">Margin &gt;6%</span> = avoid
      </span>
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
    <div className="space-y-4">
      {/* Alerts */}
      <ValueBetAlerts bets={valueBets} />
      <ArbAlerts arbs={arbs} />

      {/* No alerts message */}
      {valueBets.length === 0 && arbs.length === 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 text-center">
          <p className="text-gray-500 text-sm">No value bets or arb opportunities found</p>
          <p className="text-gray-700 text-xs mt-0.5">Comparing across all bookmakers</p>
        </div>
      )}

      {/* Best odds summary */}
      {selectedMarket && <BestOddsSummary data={data} marketName={selectedMarket} />}

      {/* Market tabs */}
      {marketNames.length > 1 && (
        <MarketTabs markets={marketNames} selected={selectedMarket} onSelect={setSelectedMarket} />
      )}

      {/* Odds table */}
      {selectedMarket && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <OddsGrid data={data} marketName={selectedMarket} />
          <div className="mt-3">
            <MarginLegend />
          </div>
        </div>
      )}
    </div>
  );
}
