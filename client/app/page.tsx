'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LocalUser, LiveMatch } from '@/lib/types';

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || 'https://gharkadream11-production.up.railway.app';
const IPL_TEAMS = ['CSK','PBKS','MI','RCB','KKR','DC','RR','SRH','GT','LSG'];

export default function HomePage() {
  const router = useRouter();

  // Session restore
  const [existingUser, setExistingUser] = useState<LocalUser | null>(null);
  const [mounted, setMounted] = useState(false);

  // Live matches from API
  const [liveMatches, setLiveMatches] = useState<LiveMatch[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(true);

  // Tab
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Create form
  const [createName, setCreateName] = useState('');
  const [matchName, setMatchName]   = useState('');
  const [team1, setTeam1]           = useState('CSK');
  const [team2, setTeam2]           = useState('PBKS');
  const [apiMatchId, setApiMatchId] = useState('');

  // Join form
  const [joinName, setJoinName] = useState('');
  const [joinCode, setJoinCode] = useState('');

  // ── On mount: restore session + load matches ──────────────────────────────
  useEffect(() => {
    setMounted(true);
    try {
      const raw = localStorage.getItem('fantasy_user');
      if (raw) setExistingUser(JSON.parse(raw));
    } catch { localStorage.removeItem('fantasy_user'); }

    // Fetch live / upcoming matches
    fetch(`${SERVER}/api/matches`)
      .then(r => r.json())
      .then(d => { if (d.matches?.length) setLiveMatches(d.matches); })
      .catch(() => {}) // silently fail — user can pick teams manually
      .finally(() => setMatchesLoading(false));
  }, []);

  const clearSession = () => { localStorage.removeItem('fantasy_user'); setExistingUser(null); };

  // Format GMT datetime → "Today 7:30 PM IST" / "Tomorrow 7:30 PM IST" / "Apr 21, 7:30 PM IST"
  function formatMatchTime(dateTimeGMT?: string): string {
    if (!dateTimeGMT) return '';
    try {
      // Normalize "2026-04-05 14:00:00" → "2026-04-05T14:00:00Z"
      const normalized = dateTimeGMT.replace(' ', 'T').replace(/Z?$/, 'Z');
      const match = new Date(normalized);
      if (isNaN(match.getTime())) return '';

      const now = new Date();
      const IST_OFFSET = 5.5 * 60 * 60000;

      const mIST = new Date(match.getTime() + IST_OFFSET);
      const nIST = new Date(now.getTime()   + IST_OFFSET);

      const mDay = Math.floor(mIST.getTime() / 86400000);
      const nDay = Math.floor(nIST.getTime() / 86400000);
      const diff = mDay - nDay;

      const time = match.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric', minute: '2-digit', hour12: true,
      });

      if (diff === 0) return `Today, ${time} IST`;
      if (diff === 1) return `Tomorrow, ${time} IST`;
      const dateStr = match.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
      return `${dateStr}, ${time} IST`;
    } catch { return ''; }
  }

  // When a live match is selected from the dropdown, autofill everything
  function handleMatchSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    if (!id) return;
    const m = liveMatches.find(x => x.id === id);
    if (!m) return;
    setApiMatchId(m.id);
    setMatchName(m.name);
    // Try to map team codes; if we don't recognise them keep the dropdowns
    if (IPL_TEAMS.includes(m.team1)) setTeam1(m.team1);
    if (IPL_TEAMS.includes(m.team2)) setTeam2(m.team2);
  }

  // ── Create room ───────────────────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (team1 === team2) { setError('Both teams cannot be the same'); return; }
    setLoading(true);
    try {
      const res  = await fetch(`${SERVER}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchName: matchName || `${team1} vs ${team2}`,
          team1, team2, userName: createName, apiMatchId,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      const local: LocalUser = { userId: data.adminId, userName: createName, roomId: data.room.id, adminId: data.adminId };
      localStorage.setItem('fantasy_user', JSON.stringify(local));
      router.push(`/room/${data.room.id}`);
    } catch (e: any) { setError(`Network error: ${e.message} (server: ${SERVER})`); }
    finally  { setLoading(false); }
  }

  // ── Join room ─────────────────────────────────────────────────────────────
  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res  = await fetch(`${SERVER}/api/rooms/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joinCode: joinCode.trim().toUpperCase(), userName: joinName }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      const local: LocalUser = { userId: data.userId, userName: joinName, roomId: data.room.id };
      localStorage.setItem('fantasy_user', JSON.stringify(local));
      router.push(`/room/${data.room.id}`);
    } catch (e: any) { setError(`Network error: ${e.message} (server: ${SERVER})`); }
    finally  { setLoading(false); }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center gap-6 py-8">

      {/* Hero */}
      <div className="text-center">
        <div className="text-5xl mb-2">🏏</div>
        <h1 className="text-3xl font-extrabold text-white mb-1">IPL Fantasy</h1>
        <p className="text-gray-400">Play with your friends. No app. No hassle.</p>
      </div>

      {/* ── Return-to-room banner ── */}
      {mounted && existingUser && (
        <div className="card w-full max-w-md border border-ipl-orange">
          <p className="text-xs text-gray-400 mb-1">You already have an active room</p>
          <p className="font-bold text-lg">
            👋 Welcome back, {existingUser.userName}!
            {existingUser.adminId && (
              <span className="ml-2 text-xs text-ipl-gold border border-ipl-gold/40 px-2 py-0.5 rounded-full">Admin</span>
            )}
          </p>
          <div className="flex gap-2 mt-3">
            <button onClick={() => router.push(`/room/${existingUser.roomId}`)} className="btn-primary flex-1 py-2 text-sm">
              🏏 Return to My Room
            </button>
            <button onClick={clearSession} className="btn-secondary text-sm px-4 py-2">✕ Leave</button>
          </div>
        </div>
      )}

      {/* ── Live / Upcoming Matches strip ── */}
      {liveMatches.length > 0 && (
        <div className="w-full max-w-md">
          <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
            IPL — {liveMatches.length} match{liveMatches.length !== 1 ? 'es' : ''} found
            <span className="ml-auto text-gray-600">via {liveMatches[0]?.source === 'cricapi' ? 'CricAPI' : 'ESPN'}</span>
          </p>
          <div className="flex flex-col gap-2">
            {liveMatches.slice(0, 2).map(m => (
              <div key={m.id} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm text-white">{m.team1} <span className="text-gray-500">vs</span> {m.team2}</p>
                  <p className="text-xs text-gray-500 truncate max-w-[220px]">{m.name}</p>
                  {formatMatchTime(m.dateTime) && (
                    <p className="text-xs text-ipl-gold mt-0.5">🕐 {formatMatchTime(m.dateTime)}</p>
                  )}
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                  m.status.toLowerCase().includes('live') || m.status.toLowerCase().includes('progress')
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-600 text-gray-300'
                }`}>
                  {m.status.toLowerCase().includes('live') || m.status.toLowerCase().includes('progress') ? '🔴 LIVE' : '⏰ Soon'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {matchesLoading && (
        <p className="text-gray-600 text-xs animate-pulse">Fetching live matches…</p>
      )}

      {/* ── Create / Join card ── */}
      <div className="card w-full max-w-md">
        {/* Tabs */}
        <div className="flex mb-5 bg-gray-800 rounded-lg p-1">
          {(['create', 'join'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-md font-semibold transition-all ${tab === t ? 'bg-ipl-orange text-white' : 'text-gray-400 hover:text-white'}`}>
              {t === 'create' ? 'Create Room' : 'Join Room'}
            </button>
          ))}
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-lg px-4 py-2 mb-4 text-sm">{error}</div>
        )}

        {/* Create Form */}
        {tab === 'create' && (
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <div>
              <label className="text-sm text-gray-400 mb-1 block">Your Name</label>
              <input className="input" placeholder="e.g. Raj" value={createName}
                onChange={e => setCreateName(e.target.value)} required maxLength={30} />
            </div>

            {/* Live match selector — auto-fills everything */}
            {liveMatches.length > 0 && (
              <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3">
                <label className="text-xs font-bold text-ipl-orange mb-2 flex items-center gap-1 block">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
                  Auto-fill from Live Match
                </label>
                <select className="input text-sm" onChange={handleMatchSelect} defaultValue="">
                  <option value="" disabled>— select a match —</option>
                  {liveMatches.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.team1} vs {m.team2}
                      {m.status.toLowerCase().includes('live') || m.status.toLowerCase().includes('progress') ? ' 🔴' : ''}
                    </option>
                  ))}
                </select>
                {apiMatchId && (
                  <p className="text-xs text-green-400 mt-1">
                    ✅ Match linked — squad will auto-load from API
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="text-sm text-gray-400 mb-1 block">Match Name</label>
              <input className="input" placeholder="e.g. CSK vs PBKS" value={matchName}
                onChange={e => setMatchName(e.target.value)} maxLength={80} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-gray-400 mb-1 block">Team 1</label>
                <select className="input" value={team1} onChange={e => setTeam1(e.target.value)}>
                  {IPL_TEAMS.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-400 mb-1 block">Team 2</label>
                <select className="input" value={team2} onChange={e => setTeam2(e.target.value)}>
                  {IPL_TEAMS.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <button type="submit" className="btn-primary mt-1" disabled={loading || !createName}>
              {loading ? 'Creating…' : '🚀 Create Room'}
            </button>
          </form>
        )}

        {/* Join Form */}
        {tab === 'join' && (
          <form onSubmit={handleJoin} className="flex flex-col gap-4">
            <div>
              <label className="text-sm text-gray-400 mb-1 block">Your Name</label>
              <input className="input" placeholder="e.g. Priya" value={joinName}
                onChange={e => setJoinName(e.target.value)} required maxLength={30} />
            </div>
            <div>
              <label className="text-sm text-gray-400 mb-1 block">Room Code</label>
              <input className="input uppercase tracking-widest text-xl font-bold text-center"
                placeholder="K29X7F" value={joinCode} onChange={e => setJoinCode(e.target.value)}
                required maxLength={6} />
            </div>
            <button type="submit" className="btn-primary mt-1" disabled={loading || !joinName || !joinCode}>
              {loading ? 'Joining…' : '🎯 Join Room'}
            </button>
          </form>
        )}
      </div>

      <p className="text-gray-600 text-xs text-center">
        No login needed · Room data lives only during the match
      </p>
    </div>
  );
}
