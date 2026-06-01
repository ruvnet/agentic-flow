import React, { useState } from 'react';
import OddsTable from '../components/betting/OddsTable';
import BankrollTracker from '../components/betting/BankrollTracker';
import { fetchOdds } from '../services/odds.service';
import type { OddsResponse } from '../types/betting';

type Tab = 'odds' | 'bankroll';

const POPULAR_LEAGUES = [
  { label: 'EPL', sport: 'soccer' as const },
  { label: 'La Liga', sport: 'soccer' as const },
  { label: 'Champions League', sport: 'soccer' as const },
  { label: 'NBA', sport: 'basketball' as const },
];

export default function SportsBettingDashboard() {
  const [tab, setTab] = useState<Tab>('odds');
  const [eventId, setEventId] = useState('');
  const [oddsData, setOddsData] = useState<OddsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadOdds = async () => {
    if (!eventId.trim()) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchOdds(eventId.trim());
      setOddsData(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch odds');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Sports Betting Dashboard</h1>
            <p className="text-xs text-gray-400 mt-0.5">Odds · Value Bets · Arbitrage · Bankroll</p>
          </div>
          <div className="flex gap-2">
            {(['odds', 'bankroll'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                  tab === t ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >{t === 'odds' ? 'Odds & Analysis' : 'Bankroll'}</button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        {tab === 'odds' && (
          <div className="space-y-6">
            {/* Event lookup */}
            <div className="bg-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-gray-300 mb-3">Load Event Odds</h2>
              <div className="flex gap-3">
                <input
                  value={eventId}
                  onChange={e => setEventId(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && loadOdds()}
                  placeholder="Enter event ID (e.g. 1607251724)"
                  className="flex-1 bg-gray-700 text-white rounded-lg px-4 py-2.5 text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={loadOdds}
                  disabled={loading}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {loading ? 'Loading...' : 'Fetch Odds'}
                </button>
              </div>

              {/* Quick league buttons */}
              <div className="flex gap-2 mt-3 flex-wrap">
                <span className="text-xs text-gray-500 self-center">Quick:</span>
                {POPULAR_LEAGUES.map(l => (
                  <button key={l.label}
                    className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-full text-xs transition-colors">
                    {l.label}
                  </button>
                ))}
              </div>

              {error && (
                <div className="mt-3 p-3 bg-red-900/40 border border-red-700/40 rounded-lg text-red-400 text-sm">
                  {error}
                </div>
              )}
            </div>

            {/* Odds table */}
            {oddsData ? (
              <div className="bg-gray-800 rounded-xl p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-bold text-white">
                      {oddsData.home} <span className="text-gray-400 font-normal">vs</span> {oddsData.away}
                    </h2>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {oddsData.league} · {new Date(oddsData.startTime).toLocaleString()}
                    </p>
                  </div>
                  <span className="text-xs px-2 py-1 bg-gray-700 rounded text-gray-300">{oddsData.sport}</span>
                </div>
                <OddsTable data={oddsData} />
              </div>
            ) : (
              <div className="bg-gray-800 rounded-xl p-12 text-center">
                <div className="text-4xl mb-3">⚽</div>
                <p className="text-gray-400 text-sm">Enter an event ID above to load odds</p>
                <p className="text-gray-600 text-xs mt-1">Compares Bet365 · Pinnacle · Betfair · Betsson · 1xbet</p>
              </div>
            )}
          </div>
        )}

        {tab === 'bankroll' && <BankrollTracker />}
      </main>
    </div>
  );
}
