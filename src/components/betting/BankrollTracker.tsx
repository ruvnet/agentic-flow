import React, { useState, useEffect } from 'react';
import type { BetRecord } from '../../types/betting';

const STORAGE_KEY = 'betting_bankroll';

function loadBets(): BetRecord[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as BetRecord[];
  } catch {
    return [];
  }
}

function saveBets(bets: BetRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bets));
}

function kellyStake(odds: number, prob: number, bankroll: number): number {
  const b = odds - 1;
  const q = 1 - prob;
  const kelly = (b * prob - q) / b;
  return Math.max(0, kelly * bankroll);
}

const BOOKMAKERS = ['Bet365', 'Pinnacle', 'Betfair', 'Betsson', '1xbet', 'Other'];

export default function BankrollTracker() {
  const [bets, setBets] = useState<BetRecord[]>(loadBets);
  const [form, setForm] = useState({
    event: '', market: '', outcome: '', bookmaker: 'Bet365', odds: '', stake: '',
  });
  const [bankroll, setBankroll] = useState<number>(
    () => parseFloat(localStorage.getItem('betting_bankroll_start') ?? '1000')
  );
  const [kellyOdds, setKellyOdds] = useState('');
  const [kellyProb, setKellyProb] = useState('');

  useEffect(() => { saveBets(bets); }, [bets]);
  useEffect(() => { localStorage.setItem('betting_bankroll_start', String(bankroll)); }, [bankroll]);

  const addBet = () => {
    if (!form.event || !form.odds || !form.stake) return;
    const bet: BetRecord = {
      id: Date.now().toString(),
      date: new Date().toISOString().split('T')[0]!,
      event: form.event,
      market: form.market,
      outcome: form.outcome,
      bookmaker: form.bookmaker,
      odds: parseFloat(form.odds),
      stake: parseFloat(form.stake),
      result: 'pending',
    };
    setBets(prev => [bet, ...prev]);
    setForm({ event: '', market: '', outcome: '', bookmaker: 'Bet365', odds: '', stake: '' });
  };

  const setResult = (id: string, result: BetRecord['result']) => {
    setBets(prev => prev.map(b => {
      if (b.id !== id) return b;
      const profit = result === 'won' ? b.stake * (b.odds - 1)
        : result === 'lost' ? -b.stake : 0;
      return { ...b, result, profit };
    }));
  };

  const totalStaked = bets.filter(b => b.result !== 'pending').reduce((s, b) => s + b.stake, 0);
  const totalProfit = bets.reduce((s, b) => s + (b.profit ?? 0), 0);
  const roi = totalStaked > 0 ? (totalProfit / totalStaked) * 100 : 0;
  const wonBets = bets.filter(b => b.result === 'won').length;
  const settledBets = bets.filter(b => b.result !== 'pending').length;
  const winRate = settledBets > 0 ? (wonBets / settledBets) * 100 : 0;
  const kellyAmount = kellyOdds && kellyProb
    ? kellyStake(parseFloat(kellyOdds), parseFloat(kellyProb) / 100, bankroll)
    : null;

  const stats = [
    { label: 'Bankroll', value: `£${bankroll.toFixed(2)}`, color: 'text-white', sub: 'Starting capital' },
    { label: 'Net P&L', value: `${totalProfit >= 0 ? '+' : ''}£${totalProfit.toFixed(2)}`, color: totalProfit >= 0 ? 'text-green-400' : 'text-red-400', sub: `${bets.length} bets` },
    { label: 'ROI', value: `${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%`, color: roi >= 0 ? 'text-green-400' : 'text-red-400', sub: 'Return on invested' },
    { label: 'Win Rate', value: `${winRate.toFixed(0)}%`, color: 'text-blue-400', sub: `${wonBets}/${settledBets} settled` },
  ];

  return (
    <div className="space-y-5 pb-10">
      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        {stats.map(stat => (
          <div key={stat.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
            <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-white text-xs font-semibold mt-1">{stat.label}</div>
            <div className="text-gray-600 text-xs mt-0.5">{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* Kelly calculator */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-bold text-white mb-4">Kelly Criterion Calculator</h3>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <label className="text-xs text-gray-500 font-medium block mb-1">Bankroll (£)</label>
            <input
              type="number"
              value={bankroll}
              onChange={e => setBankroll(parseFloat(e.target.value) || 0)}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-medium block mb-1">Odds (decimal)</label>
            <input
              type="number" step="0.01" value={kellyOdds}
              onChange={e => setKellyOdds(e.target.value)}
              placeholder="2.10"
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-medium block mb-1">Edge prob (%)</label>
            <input
              type="number" step="0.1" value={kellyProb}
              onChange={e => setKellyProb(e.target.value)}
              placeholder="52"
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        {kellyAmount !== null && (
          <div className="p-3 bg-blue-900/30 border border-blue-700/40 rounded-lg flex items-center gap-3">
            <div>
              <div className="text-gray-400 text-xs">Recommended stake</div>
              <div className="text-blue-300 font-bold text-xl">£{kellyAmount.toFixed(2)}</div>
            </div>
            <div className="text-gray-500 text-xs">
              {((kellyAmount / bankroll) * 100).toFixed(1)}% of bankroll
            </div>
          </div>
        )}
      </div>

      {/* Log a bet */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-bold text-white mb-4">Log a Bet</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1">Event</label>
              <input
                value={form.event}
                onChange={e => setForm(p => ({ ...p, event: e.target.value }))}
                placeholder="Arsenal vs Chelsea"
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1">Market</label>
              <input
                value={form.market}
                onChange={e => setForm(p => ({ ...p, market: e.target.value }))}
                placeholder="Match Winner"
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1">Selection</label>
              <input
                value={form.outcome}
                onChange={e => setForm(p => ({ ...p, outcome: e.target.value }))}
                placeholder="Arsenal"
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1">Bookmaker</label>
              <select
                value={form.bookmaker}
                onChange={e => setForm(p => ({ ...p, bookmaker: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {BOOKMAKERS.map(b => <option key={b}>{b}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1">Odds</label>
              <input
                type="number" step="0.01" value={form.odds}
                onChange={e => setForm(p => ({ ...p, odds: e.target.value }))}
                placeholder="2.10"
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1">Stake (£)</label>
              <input
                type="number" step="0.50" value={form.stake}
                onChange={e => setForm(p => ({ ...p, stake: e.target.value }))}
                placeholder="10.00"
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
        <button
          onClick={addBet}
          className="mt-4 w-full py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-sm font-bold transition-colors"
        >
          + Add Bet
        </button>
      </div>

      {/* Bet history */}
      {bets.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-white px-1">Bet History</h3>
          {bets.map(bet => (
            <div key={bet.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="text-white text-sm font-semibold truncate">{bet.event}</div>
                  <div className="text-gray-500 text-xs mt-0.5">
                    {bet.outcome} · {bet.market} · {bet.bookmaker}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-white text-sm font-mono">@ {bet.odds.toFixed(2)}</div>
                  <div className="text-gray-500 text-xs">£{bet.stake.toFixed(2)}</div>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600 text-xs">{bet.date}</span>
                <div className="flex gap-1.5">
                  {bet.result === 'pending' ? (
                    <>
                      <button onClick={() => setResult(bet.id, 'won')}
                        className="px-3 py-1.5 bg-green-700/60 hover:bg-green-700 text-green-300 rounded-lg text-xs font-semibold">
                        Won
                      </button>
                      <button onClick={() => setResult(bet.id, 'lost')}
                        className="px-3 py-1.5 bg-red-700/60 hover:bg-red-700 text-red-300 rounded-lg text-xs font-semibold">
                        Lost
                      </button>
                      <button onClick={() => setResult(bet.id, 'void')}
                        className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-400 rounded-lg text-xs font-semibold">
                        Void
                      </button>
                    </>
                  ) : (
                    <span className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                      bet.result === 'won' ? 'bg-green-900/60 text-green-400' :
                      bet.result === 'lost' ? 'bg-red-900/60 text-red-400' :
                      'bg-gray-800 text-gray-500'
                    }`}>
                      {bet.result === 'won'
                        ? `+£${bet.profit?.toFixed(2)}`
                        : bet.result === 'lost'
                        ? `-£${bet.stake.toFixed(2)}`
                        : 'void'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
