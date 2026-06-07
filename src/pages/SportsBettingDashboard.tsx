import React, { useState, useEffect, useCallback } from 'react';
import OddsTable from '../components/betting/OddsTable';
import BankrollTracker from '../components/betting/BankrollTracker';
import { fetchOdds, fetchEvents, testConnection } from '../services/sportapi.service';
import type { OddsResponse, Event, SportKey } from '../types/betting';

type MainView = 'events' | 'odds' | 'bankroll';

// ─── League config ────────────────────────────────────────────────────────────

const LEAGUES: Record<SportKey, string[]> = {
  soccer: ['All', 'EPL', 'La Liga', 'Serie A', 'Bundesliga', 'UCL'],
  basketball: ['All', 'NBA', 'EuroLeague'],
};

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner({ size = 10 }: { size?: number }) {
  return (
    <svg
      className={`animate-spin w-${size} h-${size} text-blue-500`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function EventSkeleton() {
  return (
    <div className="bg-gray-900 border-l-4 border-l-gray-700 border border-gray-800 rounded-2xl p-4 animate-pulse">
      <div className="flex justify-between mb-3">
        <div className="h-3 w-24 bg-gray-800 rounded" />
        <div className="h-3 w-16 bg-gray-800 rounded" />
      </div>
      <div className="flex justify-between items-center py-3">
        <div className="h-5 w-28 bg-gray-800 rounded" />
        <div className="h-4 w-6 bg-gray-800 rounded mx-3" />
        <div className="h-5 w-28 bg-gray-800 rounded" />
      </div>
      <div className="h-3 w-20 bg-gray-800 rounded ml-auto mt-2" />
    </div>
  );
}

// ─── Event card ───────────────────────────────────────────────────────────────

function EventCard({ event, onSelect }: { event: Event; onSelect: (e: Event) => void }) {
  const isLive = event.status === 'live' || event.status === 'inprogress';
  const sportIcon = event.sport === 'basketball' ? '🏀' : '⚽';
  const dateLabel = isLive
    ? null
    : event.startTime
    ? new Date(event.startTime).toLocaleString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'TBD';

  return (
    <button
      onClick={() => onSelect(event)}
      className="w-full text-left bg-gray-900 border border-gray-800 border-l-4 border-l-blue-600 active:border-l-blue-400 rounded-2xl p-4 transition-all hover:bg-gray-800/60 hover:border-gray-700"
    >
      {/* Top row */}
      <div className="flex items-start justify-between mb-2">
        <span className="text-blue-400 text-xs font-bold uppercase tracking-widest flex items-center gap-1">
          <span>{sportIcon}</span>
          {event.league ?? event.sport}
        </span>
        {isLive ? (
          <span className="flex items-center gap-1 text-red-400 text-xs font-bold">
            <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse" />
            LIVE
          </span>
        ) : (
          <span className="text-gray-500 text-xs">{dateLabel}</span>
        )}
      </div>

      {/* Teams row */}
      <div className="flex items-center justify-between py-2">
        <span className="text-white font-bold text-base flex-1 text-left leading-tight">
          {event.home ?? 'Home'}
        </span>
        <span className="text-gray-600 text-sm font-bold mx-3 shrink-0">vs</span>
        <span className="text-white font-bold text-base flex-1 text-right leading-tight">
          {event.away ?? 'Away'}
        </span>
      </div>

      {/* Bottom row */}
      <div className="flex items-center justify-end mt-1.5 gap-2">
        <span className="text-blue-400 text-xs font-semibold">View Odds →</span>
      </div>
    </button>
  );
}

// ─── Debug panel ──────────────────────────────────────────────────────────────

function DebugPanel() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setResult(null);
    try {
      const raw = await testConnection();
      setResult(raw);
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); void run(); }}
        className="text-gray-500 hover:text-gray-300 text-xs underline underline-offset-2 transition-colors"
      >
        🔧 Test API
      </button>
    );
  }

  return (
    <div className="mt-3 bg-gray-900 border border-gray-700 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-400 text-xs font-semibold">🔧 API Debug</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void run()}
            disabled={loading}
            className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40 font-semibold"
          >
            {loading ? 'Testing…' : 'Re-test'}
          </button>
          <button
            onClick={() => setOpen(false)}
            className="text-gray-600 hover:text-gray-400 text-xs"
          >
            ✕
          </button>
        </div>
      </div>
      {loading && (
        <div className="flex items-center gap-2 py-3">
          <Spinner size={4} />
          <span className="text-gray-500 text-xs">Testing 5 endpoints…</span>
        </div>
      )}
      {result && (
        <pre className="text-xs text-green-300 font-mono whitespace-pre-wrap break-all overflow-auto max-h-48 leading-relaxed">
          {result}
        </pre>
      )}
    </div>
  );
}

// ─── Event ID input row ────────────────────────────────────────────────────────

function EventIdRow({
  onSubmit,
  loading,
}: {
  onSubmit: (id: string) => void;
  loading: boolean;
}) {
  const [value, setValue] = useState('');

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
      <p className="text-gray-400 text-xs mb-0.5 font-semibold uppercase tracking-wide">
        Direct Event ID
      </p>
      <p className="text-gray-600 text-xs mb-2">
        Paste an event ID from the RapidAPI test console or from the events list above
      </p>
      <div className="flex gap-2 items-center">
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && value.trim() && onSubmit(value.trim())}
          placeholder="e.g. 1234567890"
          className="flex-1 bg-gray-800 text-white rounded-xl px-3 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={() => value.trim() && onSubmit(value.trim())}
          disabled={loading || !value.trim()}
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-40 text-white rounded-xl text-sm font-semibold transition-colors shrink-0"
        >
          {loading ? (
            <span className="flex items-center gap-1.5">
              <Spinner size={3} />
              Loading
            </span>
          ) : (
            'Load'
          )}
        </button>
        <DebugPanel />
      </div>
    </div>
  );
}

// ─── League tabs ──────────────────────────────────────────────────────────────

function LeagueTabs({
  sport,
  selected,
  onSelect,
}: {
  sport: SportKey;
  selected: string;
  onSelect: (league: string) => void;
}) {
  const leagues = LEAGUES[sport];
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
      {leagues.map(league => (
        <button
          key={league}
          onClick={() => onSelect(league)}
          className={`shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${
            selected === league
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          {league}
        </button>
      ))}
    </div>
  );
}

// ─── Events view ──────────────────────────────────────────────────────────────

function EventsView({
  sport,
  onSelectEvent,
  onLoadOdds,
  oddsLoading,
}: {
  sport: SportKey;
  onSelectEvent: (e: Event) => void;
  onLoadOdds: (id: string) => void;
  oddsLoading: boolean;
}) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLeague, setSelectedLeague] = useState('All');

  const loadEvents = useCallback(
    async (league?: string) => {
      setLoading(true);
      setError(null);
      try {
        const leagueArg = league && league !== 'All' ? league : undefined;
        const data = await fetchEvents(sport, leagueArg);
        setEvents(Array.isArray(data) ? data : []);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load events');
        setEvents([]);
      } finally {
        setLoading(false);
      }
    },
    [sport]
  );

  // Reload when sport changes
  useEffect(() => {
    setSelectedLeague('All');
    void loadEvents();
  }, [sport, loadEvents]);

  const handleLeagueSelect = (league: string) => {
    setSelectedLeague(league);
    const leagueArg = league !== 'All' ? league : undefined;
    void loadEvents(leagueArg);
  };

  return (
    <div className="space-y-3 pb-24">
      {/* Event ID + debug row */}
      <EventIdRow onSubmit={onLoadOdds} loading={oddsLoading} />

      {/* League tabs */}
      <LeagueTabs sport={sport} selected={selectedLeague} onSelect={handleLeagueSelect} />

      {/* Events list */}
      {loading ? (
        <div className="space-y-3">
          <EventSkeleton />
          <EventSkeleton />
          <EventSkeleton />
        </div>
      ) : error ? (
        <div className="space-y-3">
          <div className="bg-red-950/60 border border-red-700/50 rounded-2xl p-4">
            <p className="text-red-400 text-sm font-semibold mb-1">Could not load events</p>
            <p className="text-red-300/70 text-xs font-mono break-all whitespace-pre-wrap leading-relaxed">
              {error}
            </p>
            <p className="text-gray-500 text-xs mt-2">
              Try selecting a league tab above, or enter an Event ID directly below.
            </p>
            <button
              onClick={() => void loadEvents(selectedLeague !== 'All' ? selectedLeague : undefined)}
              className="mt-3 px-4 py-2 bg-red-800/50 hover:bg-red-700/50 text-red-300 rounded-xl text-xs font-semibold"
            >
              Retry
            </button>
          </div>
        </div>
      ) : events.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
          <div className="text-4xl mb-3">{sport === 'soccer' ? '⚽' : '🏀'}</div>
          <p className="text-gray-400 text-sm">No upcoming events found</p>
          <p className="text-gray-600 text-xs mt-1">Try another league or enter an Event ID directly</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-gray-500 text-xs px-1">{events.length} upcoming matches</p>
          {events.map(ev => (
            <EventCard key={ev.eventId} event={ev} onSelect={onSelectEvent} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Odds view ────────────────────────────────────────────────────────────────

function OddsView({
  eventId,
  onBack,
}: {
  eventId: string;
  onBack: () => void;
}) {
  const [data, setData] = useState<OddsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const result = await fetchOdds(eventId);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch odds');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="pb-24">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-blue-400 text-sm font-semibold mb-4 active:opacity-60 hover:text-blue-300 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Matches
      </button>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <Spinner size={10} />
          <p className="text-gray-500 text-sm">Fetching odds…</p>
        </div>
      ) : error ? (
        <div className="space-y-3">
          <div className="bg-red-950/60 border border-red-700/50 rounded-2xl p-5">
            <p className="text-red-400 font-semibold text-sm mb-2">Failed to load odds</p>
            <p className="text-red-300/70 text-xs font-mono break-all leading-relaxed whitespace-pre-wrap">
              {error}
            </p>
            <button
              onClick={() => void load()}
              className="mt-4 px-4 py-2 bg-red-800/50 hover:bg-red-700/50 text-red-300 rounded-xl text-xs font-semibold"
            >
              Retry
            </button>
          </div>
        </div>
      ) : data ? (
        <div className="space-y-4">
          {/* Match header card */}
          <div className="bg-gray-900 border border-gray-800 border-l-4 border-l-blue-600 rounded-2xl p-4">
            <div className="flex items-start justify-between mb-1">
              <span className="text-blue-400 text-xs font-bold uppercase tracking-widest">
                {data.league ?? data.sport}
              </span>
              <span className="text-gray-500 text-xs">
                {data.startTime
                  ? new Date(data.startTime).toLocaleString('en-GB', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : ''}
              </span>
            </div>
            <div className="flex items-center justify-between py-3">
              <span className="text-white font-bold text-xl flex-1 text-left leading-tight">
                {data.home}
              </span>
              <span className="text-gray-600 font-bold text-base mx-4 shrink-0">vs</span>
              <span className="text-white font-bold text-xl flex-1 text-right leading-tight">
                {data.away}
              </span>
            </div>
          </div>

          {/* Odds analysis */}
          <OddsTable data={data} />
        </div>
      ) : null}
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function SportsBettingDashboard() {
  const [sport, setSport] = useState<SportKey>('soccer');
  const [view, setView] = useState<MainView>('events');
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [oddsLoading, setOddsLoading] = useState(false);

  const handleSelectEvent = (event: Event) => {
    setSelectedEventId(event.eventId);
    setView('odds');
  };

  const handleManualLoad = (id: string) => {
    setOddsLoading(true);
    setSelectedEventId(id);
    setView('odds');
    setOddsLoading(false);
  };

  const handleSportChange = (s: SportKey) => {
    setSport(s);
    if (view !== 'bankroll') setView('events');
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Sticky header */}
      <header className="sticky top-0 z-20 bg-gradient-to-b from-[#0f1729] to-gray-950 border-b border-gray-800/80 backdrop-blur-sm">
        <div className="max-w-2xl mx-auto px-4 pt-4 pb-3">
          {/* Top row */}
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
              <span className="text-white">⚡ BetEdge</span>
              <span className="text-xs font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded-md tracking-wider">
                BETA
              </span>
            </h1>
            <button
              onClick={() => setView('bankroll')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                view === 'bankroll'
                  ? 'bg-green-700 text-white'
                  : 'bg-green-700/20 border border-green-700/40 text-green-400 hover:bg-green-700/30'
              }`}
            >
              <span>💰</span> Bankroll
            </button>
          </div>

          {/* Sport tabs */}
          <div className="flex gap-2">
            {(['soccer', 'basketball'] as SportKey[]).map(s => (
              <button
                key={s}
                onClick={() => handleSportChange(s)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                  sport === s && view !== 'bankroll'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {s === 'soccer' ? '⚽ Football' : '🏀 Basketball'}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-2xl mx-auto px-4 pt-5">
        {view === 'events' && (
          <EventsView
            sport={sport}
            onSelectEvent={handleSelectEvent}
            onLoadOdds={handleManualLoad}
            oddsLoading={oddsLoading}
          />
        )}

        {view === 'odds' && selectedEventId && (
          <OddsView eventId={selectedEventId} onBack={() => setView('events')} />
        )}

        {view === 'bankroll' && (
          <div className="pb-24">
            <button
              onClick={() => setView('events')}
              className="flex items-center gap-1.5 text-blue-400 text-sm font-semibold mb-4 active:opacity-60 hover:text-blue-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Matches
            </button>
            <BankrollTracker />
          </div>
        )}
      </main>
    </div>
  );
}
