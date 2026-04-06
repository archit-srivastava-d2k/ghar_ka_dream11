/**
 * cricapi.ts — Live match data via CricAPI (cricketdata.org)
 *
 * Flow:
 *  1. Search /series for "Indian Premier League 2026" → get series ID
 *  2. /series_info → get full match list, pick next 2 upcoming
 *  3. /match_info  → get squad (players) for a specific match
 *  4. /match_scorecard → live scorecard for score auto-fill
 *
 * Set CRICAPI_KEY in server/.env
 */

import axios from 'axios';
import stringSimilarity from 'string-similarity';
import { Player, PlayerStats } from './types';

const CRICAPI_KEY = process.env.CRICAPI_KEY || '';
const BASE        = 'https://api.cricapi.com/v1';

// IPL 2026 series ID — hardcoded as fallback (found via /series search)
const IPL_2026_SERIES_ID = '87c62aac-bc3c-4738-ab93-19da0690488f';

// Runtime cache — updated if search finds a newer series
let cachedSeriesId: string | null = IPL_2026_SERIES_ID;

// Match list cache — 5 minute TTL to avoid burning API quota on page refreshes
let matchesCache: { data: LiveMatch[]; at: number } | null = null;
const MATCHES_CACHE_TTL = 5 * 60 * 1000; // 5 min

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface LiveMatch {
  id: string;
  name: string;
  status: string;
  team1: string;
  team2: string;
  dateTime?: string;
  source: 'cricapi';
}

export interface ScorecardData {
  batters:   BatterLine[];
  bowlers:   BowlerLine[];
  fielding:  FielderLine[];
  playingXI: string[];
}

interface BatterLine  { name: string; runs: number; balls: number; fours: number; sixes: number; isOut: boolean; dismissal: string; }
interface BowlerLine  { name: string; overs: number; maidens: number; runs: number; wickets: number; lbwBowled: number; }
interface FielderLine { name: string; catches: number; stumpings: number; runoutDirect: number; runoutIndirect: number; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function api(endpoint: string, params: Record<string, any> = {}): Promise<any> {
  const { data } = await axios.get(`${BASE}/${endpoint}`, {
    params: { apikey: CRICAPI_KEY, ...params },
    timeout: 10000,
  });
  return data;
}

const TEAM_SHORT: Record<string, string> = {
  'chennai super kings': 'CSK', 'mumbai indians': 'MI',
  'royal challengers bengaluru': 'RCB', 'royal challengers bangalore': 'RCB',
  'kolkata knight riders': 'KKR', 'sunrisers hyderabad': 'SRH',
  'rajasthan royals': 'RR', 'delhi capitals': 'DC',
  'punjab kings': 'PBKS', 'gujarat titans': 'GT', 'lucknow super giants': 'LSG',
};

function toShort(full: string): string {
  return TEAM_SHORT[full.toLowerCase().trim()] ?? full.toUpperCase().slice(0, 4);
}

function normName(n: string): string {
  return n.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

function num(v: any): number { return parseInt(String(v ?? '0'), 10) || 0; }

function pushUnique(arr: string[], name: string) { if (!arr.includes(name)) arr.push(name); }

function inferRole(role: string): Player['role'] {
  const r = role.toLowerCase();
  if (r.includes('wicket') || r.includes('keeper') || r.includes('wk')) return 'WK';
  if (r.includes('all') || r.includes('rounder')) return 'AR';
  if (r.includes('bowl')) return 'BOWL';
  return 'BAT';
}

function parseOvers(s: string): number {
  const [ov, balls] = s.split('.');
  return parseInt(ov || '0') + (parseInt(balls || '0') / 6);
}

// ─── 1. Find IPL Series ID ────────────────────────────────────────────────────

async function findIPLSeriesId(): Promise<string> {
  if (cachedSeriesId) return cachedSeriesId;

  // Try searching up to 8 pages (200 series)
  for (const offset of [0, 25, 50, 75, 100, 125, 150, 175]) {
    try {
      const data = await api('series', { offset });
      if (data?.status !== 'success') continue;
      for (const s of data.data ?? []) {
        const name: string = (s.name ?? '').toLowerCase();
        if (name.includes('indian premier league') && name.includes('2026')) {
          console.log(`[cricapi] IPL series found: "${s.name}" (${s.id})`);
          cachedSeriesId = s.id;
          return s.id;
        }
      }
    } catch { break; }
  }

  // Fall back to hardcoded known ID
  console.log(`[cricapi] Using hardcoded IPL 2026 series ID: ${IPL_2026_SERIES_ID}`);
  cachedSeriesId = IPL_2026_SERIES_ID;
  return IPL_2026_SERIES_ID;
}

// ─── 2. LIVE / UPCOMING MATCHES ───────────────────────────────────────────────

export async function fetchLiveMatches(): Promise<LiveMatch[]> {
  // Serve from cache if fresh
  if (matchesCache && Date.now() - matchesCache.at < MATCHES_CACHE_TTL) {
    return matchesCache.data;
  }

  if (!CRICAPI_KEY) return [];
  try {
    const seriesId = await findIPLSeriesId();
    if (!seriesId) return [];

    const data = await api('series_info', { id: seriesId });
    if (data?.status !== 'success') throw new Error(data?.reason ?? 'series_info failed');

    const matchList: any[] = data.data?.matchList ?? [];

    const now = Date.now();

    const byDate = (a: any, b: any) => {
      const ta = new Date(a.dateTimeGMT ?? a.date ?? 0).getTime();
      const tb = new Date(b.dateTimeGMT ?? b.date ?? 0).getTime();
      return ta - tb;
    };

    // Live = started and not ended
    const live = matchList
      .filter(m => m.matchStarted && !m.matchEnded)
      .sort(byDate);

    // Upcoming = not started yet, but sort by date so we get the NEXT one first
    const upcoming = matchList
      .filter(m => !m.matchStarted && !m.matchEnded)
      .filter(m => new Date(m.dateTimeGMT ?? m.date ?? 0).getTime() >= now)
      .sort(byDate);

    console.log(`[cricapi] total:${matchList.length} live:${live.length} upcoming:${upcoming.length}`);
    [...live, ...upcoming].slice(0, 3).forEach(m =>
      console.log(`  → "${m.name}" | date:${m.dateTimeGMT ?? m.date}`)
    );

    const selected = [...live, ...upcoming].slice(0, 2);

    const result = selected.map(m => ({
      id:       m.id,
      name:     m.name,
      status:   m.matchStarted ? (m.matchEnded ? 'Result' : 'Live') : 'Upcoming',
      team1:    toShort(m.teams?.[0] ?? ''),
      team2:    toShort(m.teams?.[1] ?? ''),
      dateTime: m.dateTimeGMT ?? m.date ?? undefined,
      source:   'cricapi' as const,
    }));

    matchesCache = { data: result, at: Date.now() };
    return result;
  } catch (e) {
    console.warn('[cricapi] fetchLiveMatches failed:', (e as Error).message);
    // Return stale cache rather than empty on rate-limit errors
    return matchesCache?.data ?? [];
  }
}

// ─── 3. MATCH SQUAD ───────────────────────────────────────────────────────────

export async function fetchMatchSquad(matchId: string): Promise<Player[]> {
  if (!CRICAPI_KEY) return [];
  try {
    const data = await api('match_info', { id: matchId });
    if (data?.status !== 'success') throw new Error(data?.reason ?? 'match_info failed');

    const players: any[]  = data.data?.players  ?? [];
    const teamInfo: any[] = data.data?.teamInfo  ?? [];

    if (!players.length) {
      console.warn(`[cricapi] Squad not yet uploaded for match ${matchId}`);
      return [];
    }

    // Build teamId → short code map
    const teamMap: Record<string, string> = {};
    for (const t of teamInfo) {
      teamMap[t.id] = toShort(t.name ?? '');
    }

    return players.map(p => ({
      id:   `api-${p.id ?? normName(p.name)}`,
      name: p.name,
      team: teamMap[p.teamId] ?? toShort(p.teamName ?? ''),
      role: inferRole(p.role ?? p.battingStyle ?? ''),
    }));
  } catch (e) {
    console.warn('[cricapi] fetchMatchSquad failed:', (e as Error).message);
    return [];
  }
}

// ─── 4. LIVE SCORECARD ────────────────────────────────────────────────────────

// Cricbuzz HTTP client — mimics their Android app headers
const CB_HTTP = axios.create({
  baseURL: 'https://www.cricbuzz.com',
  timeout: 12000,
  headers: {
    'User-Agent':      'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36',
    'Referer':         'https://www.cricbuzz.com/',
    'Accept':          'application/json, text/html, */*',
    'Accept-Language': 'en-IN,en;q=0.9',
    'cb-loc':          'IN',
    'X-Requested-With':'XMLHttpRequest',
  },
});

async function scorecardViaCricbuzz(matchId: string): Promise<ScorecardData | null> {
  // Try multiple known endpoint variants (live-cricket-scores is the correct base)
  const endpoints = [
    `/api/cricket-match/${matchId}/full-scorecard`,
    `/api/cricket-scorecard/${matchId}`,
    `/api/html/cricket-scorecard/${matchId}`,
  ];

  let data: any = null;
  for (const ep of endpoints) {
    try {
      const res = await CB_HTTP.get(ep);
      const d   = res.data;
      if (d?.scoreCard?.length || d?.scorecard?.length || d?.innings?.length) {
        data = d;
        console.log(`[cricbuzz] ✅ working endpoint: ${ep}`);
        break;
      }
      console.warn(`[cricbuzz] ${ep} → 200 but no scorecard data`);
    } catch (e: any) {
      console.warn(`[cricbuzz] ${ep} → ${e.response?.status ?? e.message}`);
    }
  }

  if (!data) {
    console.warn('[cricbuzz] All endpoints failed — use JSON paste in admin panel');
    return null;
  }

  const innings: any[] = data?.scoreCard ?? data?.scorecard ?? data?.innings ?? [];
  if (!innings.length) return null;

  const result: ScorecardData = { batters: [], bowlers: [], fielding: [], playingXI: [] };
  const fieldMap: Record<string, FielderLine> = {};

  for (const inn of innings) {
    // Batting — Cricbuzz stores as object { bat_1: {...}, bat_2: {...} }
    const batsmenData = inn.batTeamDetails?.batsmenData ?? {};
    for (const key of Object.keys(batsmenData)) {
      const b    = batsmenData[key];
      const name = b.batName ?? b.batShortName;
      if (!name) continue;
      pushUnique(result.playingXI, name);
      const dismissal = b.outDesc ?? '';
      result.batters.push({
        name,
        runs:  num(b.runs),
        balls: num(b.balls),
        fours: num(b.fours),
        sixes: num(b.sixes),
        isOut: !!b.isDismissed && b.isDismissed !== 0,
        dismissal,
      });
      parseDismissal(dismissal, fieldMap);
    }

    // Bowling — same object pattern { bowl_1: {...}, bowl_2: {...} }
    const bowlersData = inn.bowlTeamDetails?.bowlersData ?? {};
    for (const key of Object.keys(bowlersData)) {
      const bw   = bowlersData[key];
      const name = bw.bowlName ?? bw.bowlShortName;
      if (!name) continue;
      pushUnique(result.playingXI, name);
      result.bowlers.push({
        name,
        overs:     parseOvers(String(bw.totalOvers ?? bw.overs ?? '0')),
        maidens:   num(bw.maidens),
        runs:      num(bw.runs),
        wickets:   num(bw.wickets),
        lbwBowled: 0, // derived from dismissal strings
      });
    }
  }

  // Derive lbwBowled from dismissal texts
  for (const bw of result.bowlers) {
    bw.lbwBowled = result.batters.filter(b => {
      const d = b.dismissal.toLowerCase();
      const n = normName(bw.name);
      return d.includes(n) && (d.startsWith('lbw') || /^b\s/.test(d));
    }).length;
  }

  result.fielding = Object.values(fieldMap);
  console.log(`[cricbuzz] scorecard: ${result.batters.length} batters, ${result.bowlers.length} bowlers`);
  return result;
}

export async function fetchLiveScorecard(matchId: string): Promise<ScorecardData | null> {
  // If numeric ID → try Cricbuzz internal API first (free, no key)
  if (/^\d+$/.test(matchId)) {
    try {
      const result = await scorecardViaCricbuzz(matchId);
      if (result) return result;
    } catch (e) {
      console.warn('[cricbuzz] scorecard failed:', (e as Error).message);
    }
  }

  if (!CRICAPI_KEY) return null;
  try {
    const data = await api('match_scorecard', { id: matchId });
    if (data?.status !== 'success' || !data.data?.scorecard?.length) return null;

    const result: ScorecardData = { batters: [], bowlers: [], fielding: [], playingXI: [] };
    const fieldMap: Record<string, FielderLine> = {};

    for (const inn of data.data.scorecard as any[]) {
      for (const b of inn.batting ?? []) {
        const name = b.batsman?.name ?? b.name;
        if (!name) continue;
        pushUnique(result.playingXI, name);
        const dismissal = b['dismissal-text'] ?? b.outDesc ?? '';
        result.batters.push({
          name, runs: num(b.r ?? b.runs), balls: num(b.b ?? b.balls),
          fours: num(b['4s'] ?? b.fours), sixes: num(b['6s'] ?? b.sixes),
          isOut: !!dismissal && !dismissal.toLowerCase().includes('not out') && dismissal !== 'dnb',
          dismissal,
        });
        parseDismissal(dismissal, fieldMap);
      }
      for (const bw of inn.bowling ?? []) {
        const name = bw.bowler?.name ?? bw.name;
        if (!name) continue;
        pushUnique(result.playingXI, name);
        result.bowlers.push({
          name, overs: parseOvers(String(bw.o ?? bw.overs ?? '0')),
          maidens: num(bw.m ?? bw.maidens), runs: num(bw.r ?? bw.runs),
          wickets: num(bw.w ?? bw.wickets),
          lbwBowled: countLBWBowled(inn.batting ?? [], name),
        });
      }
    }

    result.fielding = Object.values(fieldMap);
    return result;
  } catch (e) {
    console.warn('[cricapi] fetchLiveScorecard failed:', (e as Error).message);
    return null;
  }
}

// ─── 5. PARSE USER-PROVIDED MATCH JSON ───────────────────────────────────────

export function parseMatchJSON(data: any): ScorecardData {
  const result: ScorecardData = { batters: [], bowlers: [], fielding: [], playingXI: [] };
  const fieldMap: Record<string, FielderLine> = {};

  for (const b of data.batting ?? []) {
    const name      = String(b.player ?? b.name ?? '');
    const dismissal = String(b.dismissal ?? b.wicket ?? '');
    if (!name) continue;
    pushUnique(result.playingXI, name);
    result.batters.push({
      name,
      runs:  num(b.runs),
      balls: num(b.balls),
      fours: num(b.fours),
      sixes: num(b.sixes),
      isOut: dismissal.toLowerCase() !== 'not out' && dismissal !== '',
      dismissal,
    });
    parseDismissal(dismissal, fieldMap);
  }

  for (const bw of data.bowling ?? []) {
    const name = String(bw.player ?? bw.name ?? '');
    if (!name) continue;
    pushUnique(result.playingXI, name);
    const overs = typeof bw.overs === 'string' ? parseOvers(bw.overs) : Number(bw.overs ?? 0);
    result.bowlers.push({
      name,
      overs,
      maidens:   num(bw.maidens),
      runs:      num(bw.runs),
      wickets:   num(bw.wickets),
      lbwBowled: countLBWBowled(data.batting ?? [], name),
    });
  }

  for (const name of data.did_not_bat ?? []) {
    if (name) pushUnique(result.playingXI, String(name));
  }

  result.fielding = Object.values(fieldMap);
  return result;
}

// ─── 6. AUTO-MAP STATS → player IDs ──────────────────────────────────────────

export function autoMapStats(scorecard: ScorecardData, players: Player[]): Record<string, PlayerStats> {
  const result: Record<string, PlayerStats> = {};
  for (const p of players) {
    result[p.id] = emptyStats(scorecard.playingXI.some(n => stringSimilarity.compareTwoStrings(normName(n), normName(p.name)) > 0.72));
  }

  const findPid = (apiName: string): string | null => {
    if (!apiName || !players.length) return null;
    const names = players.map(p => normName(p.name));
    const { bestMatch, bestMatchIndex } = stringSimilarity.findBestMatch(normName(apiName), names);
    if (bestMatch.rating < 0.60) return null;
    return players[bestMatchIndex].id;
  };

  for (const b of scorecard.batters) {
    const pid = findPid(b.name);
    if (!pid) continue;
    result[pid] = { ...result[pid], runs: b.runs, ballsFaced: b.balls, fours: b.fours, sixes: b.sixes, isOut: b.isOut, playingXI: true };
  }
  for (const bw of scorecard.bowlers) {
    const pid = findPid(bw.name);
    if (!pid) continue;
    result[pid] = { ...result[pid], wickets: bw.wickets, oversBowled: bw.overs, runsConceded: bw.runs, maidens: bw.maidens, lbwBowledCount: bw.lbwBowled, playingXI: true };
  }
  for (const f of scorecard.fielding) {
    const pid = findPid(f.name);
    if (!pid) continue;
    result[pid] = { ...result[pid], catches: result[pid].catches + f.catches, stumpings: result[pid].stumpings + f.stumpings, runoutDirect: result[pid].runoutDirect + f.runoutDirect, runoutIndirect: result[pid].runoutIndirect + f.runoutIndirect, playingXI: true };
  }
  return result;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function emptyStats(playingXI = false): PlayerStats {
  return { runs: 0, ballsFaced: 0, fours: 0, sixes: 0, isOut: false, wickets: 0, oversBowled: 0, runsConceded: 0, maidens: 0, lbwBowledCount: 0, catches: 0, stumpings: 0, runoutDirect: 0, runoutIndirect: 0, playingXI };
}

function countLBWBowled(batting: any[], bowlerName: string): number {
  let count = 0;
  const bNorm = normName(bowlerName);
  for (const b of batting) {
    const d = (b['dismissal-text'] ?? b.outDesc ?? b.dismissal ?? '').toLowerCase();
    if (d.includes(bNorm) && (d.startsWith('lbw') || /^b\s/.test(d))) count++;
  }
  return count;
}

function parseDismissal(dismissal: string, map: Record<string, FielderLine>) {
  if (!dismissal) return;
  const ensure = (name: string) => {
    const n = name.trim();
    if (!map[n]) map[n] = { name: n, catches: 0, stumpings: 0, runoutDirect: 0, runoutIndirect: 0 };
    return n;
  };
  const cMatch = dismissal.match(/^c\s+(.+?)\s+b\s+/i);
  if (cMatch?.[1] && !cMatch[1].toLowerCase().includes('&')) map[ensure(cMatch[1])].catches++;
  const stMatch = dismissal.match(/^st\s+(.+?)\s+b\s+/i);
  if (stMatch?.[1]) map[ensure(stMatch[1])].stumpings++;
  const roMatch = dismissal.match(/run out\s*\((.+?)\)/i);
  if (roMatch?.[1]) {
    const parts = roMatch[1].split('/').map(s => s.trim()).filter(Boolean);
    if (parts.length === 1) map[ensure(parts[0])].runoutDirect++;
    else parts.forEach(p => { map[ensure(p)].runoutIndirect++; });
  }
}
