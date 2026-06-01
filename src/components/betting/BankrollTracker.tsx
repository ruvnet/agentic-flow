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

export default function BankrollTracker() {
  const [bets, setBets] = useState<BetRecord[]>(loadBets);
  const [form, setForm] = useState({
    event: '', market: '', outcome: '', bookmaker: 'Bet365', odds: '', stake: '',
  });
  const [bankroll, setBankroll] = useState<number>(() =>
    parseFloat(localStorage.getItem('betting_bankroll_start') ?? '1000')
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
      const profit = result === 'won' ? b.stake * (b.odds - 1) : result === 'lost' ? -b.stake : 0;
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

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Bankroll', value: `£${bankroll.toFixed(2)}`, color: 'text-white' },
          { label: 'Net P&L', value: `${totalProfit >= 0 ? '+' : ''}£${totalProfit.toFixed(2)}`, color: totalProfit >= 0 ? 'text-green-400' : 'text-red-400' },
          { label: 'ROI', value: `${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%`, color: roi >= 0 ? 'text-green-400' : 'text-red-400' },
          { label: 'Win Rate', value: `${winRate.toFixed(0)}%`, color: 'text-blue-400' },
        ].map(stat => (
          <div key={stat.label} className="bg-gray-800 rounded-lg p-3 text-center">
            <div className={`text-xl font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-gray-400 mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Kelly calculator */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Kelly Criterion Calculator</h3>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-400">Bankroll (£)</label>
            <input type="number" value={bankroll} onChange={e => setBankroll(parseFloat(e.target.value) || 0)}
              className="w-full mt-1 bg-gray-700 text-white rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-400">Odds (decimal)</label>
            <input type="number" step="0.01" value={kellyOdds} onChange={e => setKellyOdds(e.target.value)}
              placeholder="2.10" className="w-full mt-1 bg-gray-700 text-white rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-400">Your edge prob (%)</label>
            <input type="number" step="0.1" value={kellyProb} onChange={e => setKellyProb(e.target.value)}
              placeholder="52" className="w-full mt-1 bg-gray-700 text-white rounded px-3 py-2 text-sm" />
          </div>
        </div>
        {kellyAmount !== null && (
          <div className="mt-3 p-3 bg-blue-900/40 border border-blue-700/40 rounded">
            <span className="text-gray-400 text-sm">Recommended stake: </span>
            <span className="text-blue-300 font-bold text-lg">£{kellyAmount.toFixed(2)}</span>
            <span className="text-gray-500 text-xs ml-2">({((kellyAmount / bankroll) * 100).toFixed(1)}% of bankroll)</span>
          </div>
        )}
      </div>

      {/* Log bet */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Log a Bet</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { key: 'event', label: 'Event', placeholder: 'Arsenal vs Chelsea' },
            { key: 'market', label: 'Market', placeholder: 'Match Winner' },
            { key: 'outcome', label: 'Selection', placeholder: 'Arsenal' },
            { key: 'bookmaker', label: 'Bookmaker', placeholder: 'Bet365' },
            { key: 'odds', label: 'Odds', placeholder: '2.10' },
            { key: 'stake', label: 'Stake (£)', placeholder: '10.00' },
          ].map(f => (
            <div key={f.key}>
              <label className="text-xs text-gray-400">{f.label}</label>
              <input
                value={form[f.key as keyof typeof form]}
                onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="w-full mt-1 bg-gray-700 text-white rounded px-3 py-2 text-sm"
              />
            </div>
          ))}
        </div>
        <button onClick={addBet}
          className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
          Add Bet
        </button>
      </div>

      {/* Bet history */}
      {bets.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Bet History</h3>
          <div className="space-y-2">
            {bets.map(bet => (
              <div key={bet.id} className="bg-gray-800 rounded-lg p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-medium truncate">{bet.event}</div>
                  <div className="text-gray-400 text-xs">{bet.outcome} @ {bet.odds.toFixed(2)} · £{bet.stake} · {bet.bookmaker} · {bet.date}</div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {bet.result === 'pending' ? (
                    <>
                      <button onClick={() => setResult(bet.id, 'won')}
                        className="px-2 py-1 bg-green-700 hover:bg-green-600 text-white rounded text-xs">Won</button>
                      <button onClick={() => setResult(bet.id, 'lost')}
                        className="px-2 py-1 bg-red-700 hover:bg-red-600 text-white rounded text-xs">Lost</button>
                      <button onClick={() => setResult(bet.id, 'void')}
                        className="px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-xs">Void</button>
                    </>
                  ) : (
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      bet.result === 'won' ? 'bg-green-800 text-green-300' :
                      bet.result === 'lost' ? 'bg-red-800 text-red-300' :
                      'bg-gray-700 text-gray-400'
                    }`}>
                      {bet.result === 'won' ? `+£${bet.profit?.toFixed(2)}` : bet.result === 'lost' ? `-£${bet.stake.toFixed(2)}` : 'void'}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
