import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import type { TrackerData, BetPick } from './types.js';

const FILE = process.env.BET_DATA_FILE ?? './betting-data.json';

function load(): TrackerData | null {
  if (!existsSync(FILE)) {
    console.log(`No betting data found at ${FILE}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(FILE, 'utf-8')) as TrackerData;
  } catch {
    console.error('Failed to parse betting data');
    return null;
  }
}

function save(data: TrackerData): void {
  writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function recalcStats(data: TrackerData): void {
  const resolved = data.picks.filter((p) => p.status !== 'pending' && p.status !== 'void');
  const won = resolved.filter((p) => p.status === 'won').length;
  data.stats = {
    total: data.picks.length,
    won,
    lost: resolved.filter((p) => p.status === 'lost').length,
    pending: data.picks.filter((p) => p.status === 'pending').length,
    winRate: resolved.length ? won / resolved.length : 0,
  };
}

function fmt(p: BetPick): string {
  const outcome = p.pick === '1' ? 'Home' : p.pick === '2' ? 'Away' : 'Draw';
  const type = p.pickType === 'prematch' ? '[PRE]' : '[LIVE]';
  const icon = p.status === 'won' ? '✅' : p.status === 'lost' ? '❌' : p.status === 'void' ? '⚫' : '⏳';
  const edge = p.edge !== undefined ? ` +${p.edge}%` : '';
  const odds = p.odds ? ` @${p.odds}` : '';
  const stake = p.suggestedStake ? ` $${p.suggestedStake}` : '';
  const kickoff = p.kickoffTime
    ? ` (${new Date(p.kickoffTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
    : '';
  return `  ${icon} ${type} ${p.match}${kickoff} → ${outcome}${odds}${edge}${stake}  [${p.confidence}%]`;
}

const [, , cmd, ...rest] = process.argv;

// ── --resolve <eventId> <1|X|2> ──────────────────────────────────────────────
if (cmd === '--resolve') {
  const eventId = Number(rest[0]);
  const outcome = rest[1] as '1' | 'X' | '2' | undefined;
  if (!eventId || !outcome || !['1', 'X', '2'].includes(outcome)) {
    console.error('Usage: npm run betting-stats -- --resolve <eventId> <1|X|2>');
    process.exit(1);
  }
  const data = load();
  if (!data) process.exit(1);

  let found = false;
  for (const pick of data.picks) {
    if (pick.eventId === eventId && pick.status === 'pending') {
      pick.status = pick.pick === outcome ? 'won' : 'lost';
      pick.resolvedAt = new Date().toISOString();
      found = true;
      const icon = pick.status === 'won' ? '✅ WON' : '❌ LOST';
      console.log(`${icon}: ${pick.match}  (picked ${pick.pick}, actual ${outcome})`);
    }
  }
  if (!found) {
    console.error(`No pending pick found for event ID ${eventId}`);
    process.exit(1);
  }
  recalcStats(data);
  save(data);
  console.log(`Saved. Overall win rate: ${(data.stats.winRate * 100).toFixed(1)}%`);

// ── --void <eventId> ─────────────────────────────────────────────────────────
} else if (cmd === '--void') {
  const eventId = Number(rest[0]);
  if (!eventId) {
    console.error('Usage: npm run betting-stats -- --void <eventId>');
    process.exit(1);
  }
  const data = load();
  if (!data) process.exit(1);

  let found = false;
  for (const pick of data.picks) {
    if (pick.eventId === eventId && pick.status === 'pending') {
      pick.status = 'void';
      pick.resolvedAt = new Date().toISOString();
      found = true;
      console.log(`⚫ Voided: ${pick.match}`);
    }
  }
  if (!found) {
    console.error(`No pending pick found for event ID ${eventId}`);
    process.exit(1);
  }
  recalcStats(data);
  save(data);
  console.log('Saved.');

// ── --unblacklist <league name> ──────────────────────────────────────────────
} else if (cmd === '--unblacklist') {
  const league = rest.join(' ');
  if (!league) {
    console.error('Usage: npm run betting-stats -- --unblacklist "League Name"');
    process.exit(1);
  }
  const data = load();
  if (!data) process.exit(1);

  const before = (data.leagueBlacklist ?? []).length;
  data.leagueBlacklist = (data.leagueBlacklist ?? []).filter((l) => l !== league);
  if (before === data.leagueBlacklist.length) {
    console.log(`"${league}" was not in the blacklist.`);
    console.log(`Current blacklist: ${(data.leagueBlacklist).join(', ') || '(empty)'}`);
  } else {
    save(data);
    console.log(`✅ Removed "${league}" from blacklist.`);
  }

// ── --blacklist-add <league name> ────────────────────────────────────────────
} else if (cmd === '--blacklist-add') {
  const league = rest.join(' ');
  if (!league) {
    console.error('Usage: npm run betting-stats -- --blacklist-add "League Name"');
    process.exit(1);
  }
  const data = load();
  if (!data) process.exit(1);

  if (!(data.leagueBlacklist ?? []).includes(league)) {
    data.leagueBlacklist = [...(data.leagueBlacklist ?? []), league];
    save(data);
    console.log(`🚫 Manually blacklisted "${league}".`);
  } else {
    console.log(`"${league}" is already blacklisted.`);
  }

// ── Default / --all: show full dashboard ─────────────────────────────────────
} else {
  const data = load();
  if (!data) process.exit(0);

  const showAll = cmd === '--all';
  const s = data.stats;
  const w = data.weights;
  const bar = '═'.repeat(60);

  console.log(`\n${bar}`);
  console.log('  🤖 Sports Betting Bot — Dashboard');
  console.log(bar);

  // Stats
  console.log(`  Picks   : ${s.total}  (Won: ${s.won}  Lost: ${s.lost}  Pending: ${s.pending})`);
  console.log(`  Win rate: ${(s.winRate * 100).toFixed(1)}%`);
  console.log(`  Confidence threshold : ${w.minConfidenceThreshold}% (self-adjusted)`);
  console.log(`  Signal weights       : form ${w.formWeight}  h2h ${w.h2hWeight}  goals ${w.goalsWeight}`);

  const bl = data.leagueBlacklist ?? [];
  if (bl.length > 0) {
    console.log(`  Blacklisted leagues  : ${bl.join(' | ')}`);
  }

  // Pending picks
  const pending = data.picks.filter((p) => p.status === 'pending');
  console.log(`\n  ⏳ Pending picks (${pending.length}):`);
  if (pending.length === 0) {
    console.log('     (none)');
  } else {
    pending.forEach((p) => console.log(fmt(p)));
    console.log('');
    console.log('  To resolve manually:');
    pending.forEach((p) =>
      console.log(`    npm run betting-stats -- --resolve ${p.eventId} <1|X|2>`)
    );
  }

  // Recent resolved picks
  const resolved = [...data.picks]
    .filter((p) => p.status !== 'pending')
    .sort((a, b) =>
      new Date(b.resolvedAt ?? b.timestamp).getTime() - new Date(a.resolvedAt ?? a.timestamp).getTime()
    )
    .slice(0, showAll ? 100 : 10);

  const resolvedTotal = data.picks.filter((p) => p.status !== 'pending').length;
  if (resolved.length > 0) {
    console.log(`\n  ${showAll ? 'All' : 'Last 10'} resolved picks (${resolvedTotal} total):`);
    resolved.forEach((p) => console.log(fmt(p)));
  }

  // Per-league breakdown
  const ls = data.leagueStats ?? {};
  const leagueRows = Object.entries(ls)
    .filter(([, stat]) => stat.total >= 3)
    .sort(([, a], [, b]) => b.total - a.total)
    .slice(0, 10);

  if (leagueRows.length > 0) {
    console.log('\n  League performance (≥3 picks):');
    for (const [league, stat] of leagueRows) {
      const wr = ((stat.won / stat.total) * 100).toFixed(0);
      const blFlag = bl.includes(league) ? ' 🚫' : '';
      const bar2 = '█'.repeat(Math.round(stat.won / stat.total * 10)) + '░'.repeat(10 - Math.round(stat.won / stat.total * 10));
      console.log(`    ${bar2} ${wr}%  ${league}${blFlag}  (${stat.won}/${stat.total})`);
    }
  }

  // Commands reference
  console.log(`\n  Commands:`);
  console.log(`    npm run betting-stats                                   # this view`);
  console.log(`    npm run betting-stats -- --all                          # all picks`);
  console.log(`    npm run betting-stats -- --resolve <eventId> <1|X|2>   # mark result`);
  console.log(`    npm run betting-stats -- --void <eventId>               # cancel pick`);
  console.log(`    npm run betting-stats -- --unblacklist "League Name"    # re-allow league`);
  console.log(`    npm run betting-stats -- --blacklist-add "League Name"  # block league`);
  console.log(`${bar}\n`);
}
