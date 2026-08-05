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
  const kelly = b > 0 ? (b * prob - q) / b : 0;
  return Math.max(0, kelly * bankroll);
}

const BOOKMAKERS = ['Bet365', 'Pinnacle', 'Betfair', 'Betsson', '1xbet', 'Other'];

export default function BankrollTracker() {
  const [bets, setBets] = useState<BetRecord[]>(loadBets);
  const [form, setForm] = useState({
    event: '',
    market: '',
    outcome: '',
    bookmaker: 'Bet365',
    odds: '',
    stake: '',
  });
  const [bankroll, setBankroll] = useState<number>(
    () => parseFloat(localStorage.getItem('betting_bankroll_start') ?? '1000')
  );
  const [kellyOdds, setKellyOdds] = useState('');
  const [kellyProb, setKellyProb] = useState('');

  useEffect(() => {
    saveBets(bets);
  }, [bets]);

  useEffect(() => {
    localStorage.setItem('betting_bankroll_start', String(bankroll));
  }, [bankroll]);

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
    setBets(prev =>
      prev.map(b => {
        if (b.id !== id) return b;
        const profit =
          result === 'won'
            ? b.stake * (b.odds - 1)
            : result === 'lost'
            ? -b.stake
            : 0;
        return { ...b, result, profit };
      })
    );
  };

  const settledBets = bets.filter(b => b.result !== 'pending');
  const totalStaked = settledBets.reduce((s, b) => s + b.stake, 0);
  const totalProfit = bets.reduce((s, b) => s + (b.profit ?? 0), 0);
  const roi = totalStaked > 0 ? (totalProfit / totalStaked) * 100 : 0;
  const wonBets = settledBets.filter(b => b.result === 'won').length;
  const settledCount = settledBets.length;
  const winRate = settledCount > 0 ? (wonBets / settledCount) * 100 : 0;

  // Loss streak: how many of the last N settled bets were losses
  const lastSettled = bets.filter(b => b.result !== 'pending' && b.result !== 'void').slice(0, 5);
  const lossStreak = (() => {
    let n = 0;
    for (const b of lastSettled) { if (b.result === 'lost') n++; else break; }
    return n;
  })();
  const kellyAmount =
    kellyOdds && kellyProb
      ? kellyStake(parseFloat(kellyOdds), parseFloat(kellyProb) / 100, bankroll)
      : null;

  const inputClass =
    'w-full bg-gray-800 border border-gray-700/60 text-white rounded-xl px-3 py-3 text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';

  return (
    <div className="space-y-4">
      {/* Loss streak warning */}
      {lossStreak >= 3 && (
        <div className="bg-red-950/60 border border-red-700/50 rounded-xl p-4">
          <p className="text-red-400 font-bold text-sm">⚠️ {lossStreak} losses in a row — stop and review</p>
          <p className="text-red-300/70 text-xs mt-1">
            Do not increase stakes to chase losses. Every bet must still have genuine edge.
            Take a break before placing another bet.
          </p>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        {(
          [
            {
              label: 'Bankroll',
              value: `£${bankroll.toFixed(2)}`,
              color: 'text-white',
              sub: 'Starting capital',
            },
            {
              label: 'Net P&L',
              value: `${totalProfit >= 0 ? '+' : ''}£${totalProfit.toFixed(2)}`,
              color: totalProfit >= 0 ? 'text-green-400' : 'text-red-400',
              sub: `${bets.length} bets total`,
            },
            {
              label: 'ROI',
              value: `${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%`,
              color: roi >= 0 ? 'text-green-400' : 'text-red-400',
              sub: 'Return on invested',
            },
            {
              label: 'Win Rate',
              value: `${winRate.toFixed(0)}%`,
              color: 'text-blue-400',
              sub: `${wonBets}/${settledCount} settled${settledCount < 50 ? ' (small sample)' : ''}`,
            },
          ] as Array<{ label: string; value: string; color: string; sub: string }>
        ).map(stat => (
          <div
            key={stat.label}
            className="bg-gray-900 border border-gray-800 rounded-2xl p-4 text-center"
          >
            <div className={`text-2xl font-extrabold font-mono ${stat.color}`}>{stat.value}</div>
            <div className="text-white text-xs font-semibold mt-1">{stat.label}</div>
            <div className="text-gray-600 text-xs mt-0.5">{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* Kelly calculator */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <h3 className="text-sm font-bold text-white mb-4">Kelly Criterion Calculator</h3>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div>
            <label className="text-xs text-gray-500 font-medium block mb-1.5">Bankroll (£)</label>
            <input
              type="number"
              value={bankroll}
              onChange={e => setBankroll(parseFloat(e.target.value) || 0)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-medium block mb-1.5">Odds (decimal)</label>
            <input
              type="number"
              step="0.01"
              value={kellyOdds}
              onChange={e => setKellyOdds(e.target.value)}
              placeholder="2.10"
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-medium block mb-1.5">Win prob (%)</label>
            <input
              type="number"
              step="0.1"
              value={kellyProb}
              onChange={e => setKellyProb(e.target.value)}
              placeholder="52"
              className={inputClass}
            />
          </div>
        </div>
        {kellyAmount !== null && (
          <div className="p-4 bg-blue-950/50 border border-blue-700/40 rounded-xl space-y-2">
            <div className="flex items-center gap-4">
              <div>
                <div className="text-gray-400 text-xs mb-0.5">¼ Kelly (recommended)</div>
                <div className="text-blue-300 font-extrabold text-2xl font-mono">
                  £{(kellyAmount / 4).toFixed(2)}
                </div>
              </div>
              <div className="text-gray-500 text-sm font-semibold">
                {((kellyAmount / 4 / bankroll) * 100).toFixed(1)}%
                <span className="text-gray-600 text-xs block font-normal">of bankroll</span>
              </div>
              <div className="ml-auto text-right">
                <div className="text-gray-600 text-xs mb-0.5">Full Kelly</div>
                <div className="text-gray-500 font-mono text-sm">£{kellyAmount.toFixed(2)}</div>
              </div>
            </div>
            <p className="text-gray-600 text-xs">Professionals use ¼ Kelly to survive variance without risking ruin.</p>
          </div>
        )}
      </div>

      {/* Log a bet */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <h3 className="text-sm font-bold text-white mb-4">Log a Bet</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1.5">Event</label>
              <input
                value={form.event}
                onChange={e => setForm(p => ({ ...p, event: e.target.value }))}
                placeholder="Arsenal vs Chelsea"
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1.5">Market</label>
              <input
                value={form.market}
                onChange={e => setForm(p => ({ ...p, market: e.target.value }))}
                placeholder="Match Winner"
                className={inputClass}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1.5">Selection</label>
              <input
                value={form.outcome}
                onChange={e => setForm(p => ({ ...p, outcome: e.target.value }))}
                placeholder="Arsenal"
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1.5">Bookmaker</label>
              <select
                value={form.bookmaker}
                onChange={e => setForm(p => ({ ...p, bookmaker: e.target.value }))}
                className={inputClass}
              >
                {BOOKMAKERS.map(b => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1.5">Odds</label>
              <input
                type="number"
                step="0.01"
                value={form.odds}
                onChange={e => setForm(p => ({ ...p, odds: e.target.value }))}
                placeholder="2.10"
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1.5">Stake (£)</label>
              <input
                type="number"
                step="0.50"
                value={form.stake}
                onChange={e => setForm(p => ({ ...p, stake: e.target.value }))}
                placeholder="10.00"
                className={inputClass}
              />
            </div>
          </div>
        </div>
        <button
          onClick={addBet}
          disabled={!form.event || !form.odds || !form.stake}
          className="mt-4 w-full py-3.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-40 text-white rounded-xl text-sm font-bold transition-colors"
        >
          + Add Bet
        </button>
      </div>

      {/* Bet history */}
      {bets.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-white px-1">
            Bet History{' '}
            <span className="text-gray-600 font-normal">({bets.length})</span>
          </h3>
          {bets.map(bet => (
            <div key={bet.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="min-w-0">
                  <div className="text-white text-sm font-semibold truncate">{bet.event}</div>
                  <div className="text-gray-500 text-xs mt-0.5">
                    {[bet.outcome, bet.market, bet.bookmaker].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-white text-sm font-mono font-bold">@ {bet.odds.toFixed(2)}</div>
                  <div className="text-gray-500 text-xs">£{bet.stake.toFixed(2)}</div>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-700 text-xs">{bet.date}</span>
                <div className="flex gap-1.5">
                  {bet.result === 'pending' ? (
                    <>
                      <button
                        onClick={() => setResult(bet.id, 'won')}
                        className="px-3 py-1.5 bg-green-800/50 hover:bg-green-700/60 text-green-300 rounded-lg text-xs font-bold"
                      >
                        Won
                      </button>
                      <button
                        onClick={() => setResult(bet.id, 'lost')}
                        className="px-3 py-1.5 bg-red-800/50 hover:bg-red-700/60 text-red-300 rounded-lg text-xs font-bold"
                      >
                        Lost
                      </button>
                      <button
                        onClick={() => setResult(bet.id, 'void')}
                        className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-lg text-xs font-bold"
                      >
                        Void
                      </button>
                    </>
                  ) : (
                    <span
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                        bet.result === 'won'
                          ? 'bg-green-900/60 text-green-400'
                          : bet.result === 'lost'
                          ? 'bg-red-900/60 text-red-400'
                          : 'bg-gray-800 text-gray-500'
                      }`}
                    >
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
