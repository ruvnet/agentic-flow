import React, { useState, useEffect, useCallback } from 'react';
import OddsTable from '../components/betting/OddsTable';
import BankrollTracker from '../components/betting/BankrollTracker';
import { fetchOdds, fetchEvents } from '../services/odds.service';
import type { OddsResponse, Event, SportKey } from '../types/betting';

type MainView = 'events' | 'odds' | 'bankroll';

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function EventSkeleton() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 animate-pulse">
      <div className="flex justify-between mb-3">
        <div className="h-3 w-24 bg-gray-800 rounded" />
        <div className="h-3 w-16 bg-gray-800 rounded" />
      </div>
      <div className="h-5 w-48 bg-gray-800 rounded mx-auto mb-3" />
      <div className="h-3 w-20 bg-gray-800 rounded mx-auto" />
    </div>
  );
}

// ─── Event card ───────────────────────────────────────────────────────────────

function EventCard({ event, onSelect }: { event: Event; onSelect: (e: Event) => void }) {
  const isLive = event.status === 'live' || event.status === 'inprogress';
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
      className="w-full text-left bg-gray-900 border border-gray-800 active:border-blue-600 rounded-2xl p-4 transition-colors hover:bg-gray-800/60"
    >
      <div className="flex items-start justify-between mb-2">
        <span className="text-blue-400 text-xs font-semibold uppercase tracking-wide">
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
      <div className="text-center my-2">
        <span className="text-white font-bold text-base">
          {event.home ?? 'Home'}
        </span>
        <span className="text-gray-500 mx-2 font-normal">vs</span>
        <span className="text-white font-bold text-base">
          {event.away ?? 'Away'}
        </span>
      </div>
      <div className="text-right mt-2">
        <span className="text-gray-500 text-xs">View Odds →</span>
      </div>
    </button>
  );
}

// ─── Manual ID input ─────────────────────────────────────────────────────────

function ManualEventInput({
  onSubmit,
  loading,
}: {
  onSubmit: (id: string) => void;
  loading: boolean;
}) {
  const [value, setValue] = useState('1607251724');
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
      <p className="text-gray-400 text-xs mb-2 font-medium">Enter Event ID directly</p>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && value.trim() && onSubmit(value.trim())}
          placeholder="e.g. 1607251724"
          className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-3 text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={() => value.trim() && onSubmit(value.trim())}
          disabled={loading || !value.trim()}
          className="px-5 py-3 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-40 text-white rounded-xl text-sm font-semibold transition-colors"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Loading
            </span>
          ) : (
            'Load'
          )}
        </button>
      </div>
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

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchEvents(sport);
      setEvents(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [sport]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  return (
    <div className="space-y-4 pb-24">
      {/* Always-visible manual input */}
      <ManualEventInput onSubmit={onLoadOdds} loading={oddsLoading} />

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
            <p className="text-red-400 text-sm font-semibold mb-1">Could not load events list</p>
            <p className="text-red-300/70 text-xs font-mono break-all">{error}</p>
            <button
              onClick={() => void loadEvents()}
              className="mt-3 px-4 py-2 bg-red-800/50 hover:bg-red-700/50 text-red-300 rounded-lg text-xs font-semibold"
            >
              Retry
            </button>
          </div>
          <p className="text-gray-500 text-xs text-center">
            Use the Event ID input above to load odds directly
          </p>
        </div>
      ) : events.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
          <div className="text-4xl mb-3">{sport === 'soccer' ? '⚽' : '🏀'}</div>
          <p className="text-gray-400 text-sm">No upcoming events found</p>
          <p className="text-gray-600 text-xs mt-1">Use the Event ID input above to load odds directly</p>
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
        className="flex items-center gap-1.5 text-blue-400 text-sm font-semibold mb-4 active:opacity-60"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Matches
      </button>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <svg className="animate-spin w-10 h-10 text-blue-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <p className="text-gray-500 text-sm">Fetching odds…</p>
        </div>
      ) : error ? (
        <div className="space-y-3">
          <div className="bg-red-950/60 border border-red-700/50 rounded-2xl p-5">
            <p className="text-red-400 font-semibold text-sm mb-2">Failed to load odds</p>
            <p className="text-red-300/70 text-xs font-mono break-all leading-relaxed">{error}</p>
            <button
              onClick={() => void load()}
              className="mt-4 px-4 py-2 bg-red-800/50 hover:bg-red-700/50 text-red-300 rounded-lg text-xs font-semibold"
            >
              Retry
            </button>
          </div>
        </div>
      ) : data ? (
        <div className="space-y-4">
          {/* Match header card */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <div className="flex items-start justify-between mb-1">
              <span className="text-blue-400 text-xs font-semibold uppercase tracking-wide">
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
            <div className="text-center py-3">
              <span className="text-white font-bold text-xl">{data.home}</span>
              <span className="text-gray-500 mx-3 font-normal text-lg">vs</span>
              <span className="text-white font-bold text-xl">{data.away}</span>
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

  const handleManualLoad = async (id: string) => {
    setOddsLoading(true);
    setSelectedEventId(id);
    setView('odds');
    setOddsLoading(false);
  };

  const handleSportChange = (s: SportKey) => {
    setSport(s);
    setView('events');
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Sticky header */}
      <header className="sticky top-0 z-20 bg-gray-950/95 backdrop-blur-sm border-b border-gray-800/80">
        <div className="max-w-2xl mx-auto px-4 pt-4 pb-3">
          {/* Top row */}
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-xl font-extrabold tracking-tight">
              <span className="text-blue-400">⚡</span> BetEdge
            </h1>
            <button
              onClick={() => setView('bankroll')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                view === 'bankroll'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              <span>💰</span> Bankroll
            </button>
          </div>

          {/* Sport tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => handleSportChange('soccer')}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                sport === 'soccer' && view !== 'bankroll'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              ⚽ Football
            </button>
            <button
              onClick={() => handleSportChange('basketball')}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                sport === 'basketball' && view !== 'bankroll'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              🏀 Basketball
            </button>
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
          <OddsView
            eventId={selectedEventId}
            onBack={() => setView('events')}
          />
        )}

        {view === 'bankroll' && (
          <div className="pb-24">
            <button
              onClick={() => setView('events')}
              className="flex items-center gap-1.5 text-blue-400 text-sm font-semibold mb-4 active:opacity-60"
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
