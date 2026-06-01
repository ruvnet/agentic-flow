import React from 'react';
import type { OddsResponse, ValueBet, ArbOpportunity } from '../../types/betting';

function impliedProb(odds: number) {
  return 1 / odds;
}

function pinnacleMargin(bookmakers: OddsResponse['bookmakers'], market: string): number {
  const pinnacle = bookmakers.find(b => b.name === 'Pinnacle');
  if (!pinnacle) return 0;
  const m = pinnacle.markets.find(m => m.name === market);
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
      const margin = pinnacleMargin(data.bookmakers, market.name);
      for (const outcome of market.outcomes) {
        const pinOutcome = pinMarket.outcomes.find(o => o.name === outcome.name);
        if (!pinOutcome) continue;
        const fairOdds = 1 / (impliedProb(pinOutcome.odds) / margin);
        const edge = ((outcome.odds / fairOdds) - 1) * 100;
        if (edge > 1) {
          values.push({ bookmaker: bm.name, market: market.name, outcome: outcome.name, odds: outcome.odds, fairOdds, edge });
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
    const markets = data.bookmakers.map(bm => ({
      bm: bm.name,
      market: bm.markets.find(m => m.name === marketName),
    })).filter(x => x.market);

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
      const staked = combinations.map(c => ({ ...c, stake: Math.round((1 / (c.odds * totalInverse)) * 100) }));
      arbs.push({ market: marketName, combinations: staked, profit });
    }
  }
  return arbs;
}

interface Props {
  data: OddsResponse;
}

export default function OddsTable({ data }: Props) {
  const marketNames = Array.from(new Set(
    data.bookmakers.flatMap(bm => bm.markets.map(m => m.name))
  ));
  const [selectedMarket, setSelectedMarket] = React.useState(marketNames[0] ?? '');
  const valueBets = detectValueBets(data);
  const arbs = detectArbitrage(data);

  const currentMarketOutcomes = data.bookmakers[0]?.markets
    .find(m => m.name === selectedMarket)?.outcomes.map(o => o.name) ?? [];

  const getBestOdds = (outcome: string) => {
    let best = 0;
    for (const bm of data.bookmakers) {
      const o = bm.markets.find(m => m.name === selectedMarket)?.outcomes.find(o => o.name === outcome);
      if (o && o.odds > best) best = o.odds;
    }
    return best;
  };

  return (
    <div className="space-y-6">
      {/* Market selector */}
      <div className="flex gap-2 flex-wrap">
        {marketNames.map(m => (
          <button
            key={m}
            onClick={() => setSelectedMarket(m)}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
              selectedMarket === m
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >{m}</button>
        ))}
      </div>

      {/* Odds grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left py-2 pr-4 text-gray-400 font-medium">Bookmaker</th>
              {currentMarketOutcomes.map(o => (
                <th key={o} className="text-center py-2 px-3 text-gray-400 font-medium">{o}</th>
              ))}
              <th className="text-center py-2 px-3 text-gray-400 font-medium">Margin</th>
            </tr>
          </thead>
          <tbody>
            {data.bookmakers.map(bm => {
              const market = bm.markets.find(m => m.name === selectedMarket);
              if (!market) return null;
              const margin = (market.outcomes.reduce((s, o) => s + 1 / o.odds, 0) - 1) * 100;
              return (
                <tr key={bm.name} className="border-b border-gray-800 hover:bg-gray-800/50">
                  <td className="py-3 pr-4 font-medium text-white">{bm.name}</td>
                  {currentMarketOutcomes.map(outcomeName => {
                    const o = market.outcomes.find(o => o.name === outcomeName);
                    const isBest = o && o.odds === getBestOdds(outcomeName);
                    return (
                      <td key={outcomeName} className="text-center py-3 px-3">
                        {o ? (
                          <span className={`px-2 py-1 rounded font-mono ${
                            isBest ? 'bg-green-700/60 text-green-300 font-bold' : 'text-gray-200'
                          }`}>
                            {o.odds.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="text-center py-3 px-3">
                    <span className={`text-xs ${margin < 3 ? 'text-green-400' : margin < 6 ? 'text-yellow-400' : 'text-red-400'}`}>
                      +{margin.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Value bets */}
      {valueBets.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-yellow-400 mb-2">Value Bets (vs Pinnacle fair odds)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {valueBets.map((vb, i) => (
              <div key={i} className="bg-yellow-900/30 border border-yellow-700/40 rounded-lg p-3">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-white font-medium">{vb.bookmaker}</span>
                    <span className="text-gray-400 text-xs ml-2">{vb.market} · {vb.outcome}</span>
                  </div>
                  <span className="text-green-400 font-bold">+{vb.edge.toFixed(1)}%</span>
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  Odds: <span className="text-white">{vb.odds.toFixed(2)}</span> · Fair: {vb.fairOdds.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Arb */}
      {arbs.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-green-400 mb-2">Arbitrage Opportunities</h3>
          {arbs.map((arb, i) => (
            <div key={i} className="bg-green-900/30 border border-green-700/40 rounded-lg p-3 mb-2">
              <div className="flex justify-between mb-2">
                <span className="text-white font-medium">{arb.market}</span>
                <span className="text-green-400 font-bold">+{arb.profit.toFixed(2)}% profit</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {arb.combinations.map((c, j) => (
                  <div key={j} className="text-xs bg-gray-800 rounded p-2">
                    <div className="text-gray-400">{c.outcome}</div>
                    <div className="text-white font-medium">{c.bookmaker}</div>
                    <div className="text-yellow-400">@ {c.odds.toFixed(2)}</div>
                    <div className="text-gray-300">Stake: £{c.stake}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
