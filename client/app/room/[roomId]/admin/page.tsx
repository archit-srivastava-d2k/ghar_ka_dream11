'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSocket } from '@/lib/socket';
import { Room, Player, PlayerStats, LocalUser, emptyStats } from '@/lib/types';

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || 'https://gharkadream11-production.up.railway.app';

function NumInput({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-400">{label}</label>
      <input type="number" min={0} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="input text-center text-sm py-1.5" />
    </div>
  );
}

export default function AdminScores() {
  const { roomId } = useParams<{ roomId: string }>();
  const router     = useRouter();

  const [room, setRoom]           = useState<Room | null>(null);
  const [players, setPlayers]     = useState<Player[]>([]);
  const [user, setUser]           = useState<LocalUser | null>(null);
  const [stats, setStats]         = useState<{ [pid: string]: PlayerStats }>({});
  const [activePlayer, setActive] = useState<string | null>(null);
  const [search, setSearch]       = useState('');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [saving, setSaving]       = useState(false);

  // CricAPI live fetch
  const [matchId, setMatchId]         = useState('');
  const [fetching, setFetching]       = useState(false);
  const [fetchMsg, setFetchMsg]       = useState('');
  const [autoPoll, setAutoPoll]       = useState(false);
  const [autoPollStatus, setAutoPollStatus] = useState('');

  // JSON scorecard
  const [jsonInput, setJsonInput]     = useState('');
  const [jsonMsg, setJsonMsg]         = useState('');
  const [jsonLoading, setJsonLoading] = useState(false);
  const [innings, setInnings]         = useState<1 | 2>(1);

  // Guard: only admin
  useEffect(() => {
    const raw = localStorage.getItem('fantasy_user');
    if (!raw) { router.push('/'); return; }
    const u: LocalUser = JSON.parse(raw);
    if (!u.adminId) { router.push(`/room/${roomId}`); return; }
    setUser(u);
  }, [roomId, router]);

  useEffect(() => {
    if (!user) return;
    fetch(`${SERVER}/api/rooms/${roomId}`)
      .then(r => r.json())
      .then((res: any) => {
        const room: Room        = res.room;
        const players: Player[] = res.players;
        if (!room) { router.push('/'); return; }   // room gone (server restart)
        setRoom(room);
        setPlayers(Array.isArray(players) ? players : room.players ?? []);
        if (room.apiMatchId) setMatchId(room.apiMatchId);
        const list = Array.isArray(players) ? players : room.players ?? [];
        const init: { [pid: string]: PlayerStats } = {};
        list.forEach((p: Player) => { init[p.id] = room.scores?.[p.id] ?? emptyStats(); });
        setStats(init);
      });
  }, [roomId, user]);

  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    socket.emit('join-room', roomId);
    socket.on('room-state', (r: Room) => {
      setRoom(r);
      // Merge updated scores into local state (don't overwrite unsaved edits for unchanged players)
      setStats(prev => {
        const next = { ...prev };
        Object.entries(r.scores).forEach(([pid, s]) => { next[pid] = s; });
        return next;
      });
    });
    socket.on('auto-poll-status', (enabled: boolean) => {
      setAutoPoll(enabled);
      setAutoPollStatus(enabled ? '⏱️ Auto-poll active — scores update every 2 min' : '🛑 Auto-poll stopped');
    });
    return () => { socket.off('room-state'); socket.off('auto-poll-status'); };
  }, [user, roomId]);

  const updateStat = useCallback((pid: string, field: keyof PlayerStats, value: number | boolean) => {
    setStats(prev => ({ ...prev, [pid]: { ...prev[pid], [field]: value } }));
  }, []);

  const saveScores = useCallback(() => {
    if (!user?.adminId) return;
    setSaving(true);
    getSocket().emit('update-scores', { roomId, adminId: user.adminId, scores: stats });
    setLastSaved(new Date());
    setSaving(false);
  }, [roomId, user, stats]);

  // ── CricAPI: one-time fetch ───────────────────────────────────────────────
  const fetchLiveScores = async () => {
    if (!matchId.trim() || !user?.adminId) return;
    setFetching(true);
    setFetchMsg('');
    try {
      const res  = await fetch(`${SERVER}/api/rooms/${roomId}/fetch-scores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId: user.adminId, matchId: matchId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setFetchMsg(`❌ ${data.error}`); return; }
      setFetchMsg(`✅ ${data.message}`);
    } catch {
      setFetchMsg('❌ Could not reach server');
    } finally {
      setFetching(false);
    }
  };

  // ── JSON scorecard submit ─────────────────────────────────────────────────
  const handleJsonScore = async () => {
    if (!jsonInput.trim() || !user?.adminId) return;
    setJsonLoading(true);
    setJsonMsg('');
    try {
      // Normalize smart/curly quotes that get substituted by some apps
      const cleaned = jsonInput.trim()
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"');

      let matchData: any;
      try {
        matchData = JSON.parse(cleaned);
      } catch (parseErr: any) {
        setJsonMsg(`❌ JSON parse error: ${parseErr.message}. Make sure you're pasting raw JSON (straight quotes, no extra text).`);
        return;
      }

      const res  = await fetch(`${SERVER}/api/rooms/${roomId}/score-from-json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId: user.adminId, matchData, innings }),
      });
      const data = await res.json();
      if (!res.ok) { setJsonMsg(`❌ ${data.error ?? 'Server error'}`); return; }
      setJsonMsg(`✅ ${data.message}`);
      setJsonInput('');
    } catch (e: any) {
      setJsonMsg(`❌ Network error — ${e.message}`);
    } finally {
      setJsonLoading(false);
    }
  };

  // ── CricAPI: toggle auto-poll ─────────────────────────────────────────────
  const toggleAutoPoll = () => {
    if (!user?.adminId || !matchId.trim()) return;
    const next = !autoPoll;
    getSocket().emit('toggle-auto-poll', {
      roomId, adminId: user.adminId, matchId: matchId.trim(), enabled: next,
    });
    setAutoPoll(next);
  };

  const filtered = (players ?? []).filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.team.toLowerCase().includes(search.toLowerCase())
  );

  if (!user) return null;

  return (
    <div className="flex flex-col gap-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white">← Back</button>
        <h1 className="font-bold text-lg">📊 Admin Panel</h1>
        <button onClick={saveScores} disabled={saving} className="btn-primary text-sm py-1.5 px-4">
          {saving ? 'Saving…' : '💾 Save'}
        </button>
      </div>

      {lastSaved && (
        <div className="bg-green-900/30 border border-green-700 text-green-300 rounded-lg px-4 py-2 text-sm text-center">
          ✅ Saved & leaderboard updated — {lastSaved.toLocaleTimeString()}
        </div>
      )}

      {/* ── CricAPI Live Score Section ── */}
      <div className="card border border-blue-800 bg-blue-950/30">
        <h2 className="font-bold text-blue-300 mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse inline-block" />
          Live Score Automation (CricAPI)
        </h2>

        <div className="flex gap-2 mb-2">
          <input
            className="input flex-1 text-sm font-mono"
            placeholder="Cricbuzz match ID  e.g. 149699"
            value={matchId}
            onChange={e => setMatchId(e.target.value)}
          />
        </div>

        <p className="text-xs text-gray-500 mb-3">
          Find the ID in the Cricbuzz URL:
          <br />
          <code className="text-blue-400 break-all">cricbuzz.com/live-cricket-scores/<span className="text-yellow-400">149695</span>/mi-vs-dc…</code>
          <br />
          Paste the highlighted number above. Works for live &amp; completed matches.
        </p>

        <div className="flex gap-2">
          <button
            onClick={fetchLiveScores}
            disabled={fetching || !matchId.trim()}
            className="btn-primary flex-1 py-2 text-sm"
          >
            {fetching ? '⏳ Fetching…' : '🔄 Fetch Now'}
          </button>

          <button
            onClick={toggleAutoPoll}
            disabled={!matchId.trim()}
            className={`flex-1 py-2 text-sm rounded-lg font-semibold transition-all border ${
              autoPoll
                ? 'bg-red-900/40 border-red-700 text-red-300 hover:bg-red-900/60'
                : 'bg-green-900/40 border-green-700 text-green-300 hover:bg-green-900/60'
            }`}
          >
            {autoPoll ? '🛑 Stop Auto-Poll' : '⏱️ Start Auto-Poll (2m)'}
          </button>
        </div>

        {fetchMsg && (
          <p className={`text-xs mt-2 ${fetchMsg.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>
            {fetchMsg}
          </p>
        )}
        {autoPollStatus && (
          <p className="text-xs mt-1 text-blue-400">{autoPollStatus}</p>
        )}

        <p className="text-xs text-gray-600 mt-2">
          Fetch pulls live scorecard from CricAPI (key required) or ESPN scraping (free fallback).
          Auto-poll updates every 2 minutes automatically.
        </p>
      </div>

      {/* ── JSON Scorecard Input ── */}
      <div className="card border border-purple-800 bg-purple-950/30">
        <h2 className="font-bold text-purple-300 mb-1 flex items-center gap-2">
          📋 Paste Match JSON
        </h2>
        <p className="text-xs text-gray-400 mb-3">
          Paste innings JSON and hit Calculate. Select which innings this data belongs to — you can re-upload any innings anytime without double-counting.
        </p>

        <textarea
          className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs text-gray-200 font-mono resize-none focus:outline-none focus:border-purple-500"
          rows={8}
          placeholder={'{\n  "batting": [...],\n  "bowling": [...]\n}'}
          value={jsonInput}
          onChange={e => setJsonInput(e.target.value)}
          spellCheck={false}
        />

        <div className="flex items-center justify-between mt-2 gap-2">
          {/* Innings selector */}
          <div className="flex rounded-lg overflow-hidden border border-gray-700 flex-shrink-0">
            <button
              onClick={() => setInnings(1)}
              className={`px-3 py-1.5 text-xs font-semibold transition-all ${innings === 1 ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
            >
              Innings 1
            </button>
            <button
              onClick={() => setInnings(2)}
              className={`px-3 py-1.5 text-xs font-semibold transition-all ${innings === 2 ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
            >
              Innings 2
            </button>
          </div>

          <button
            onClick={handleJsonScore}
            disabled={jsonLoading || !jsonInput.trim()}
            className="btn-primary py-2 px-5 text-sm disabled:opacity-50"
          >
            {jsonLoading ? 'Calculating…' : '⚡ Calculate Scores'}
          </button>
        </div>

        {jsonMsg && (
          <p className={`text-xs mt-2 ${jsonMsg.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>
            {jsonMsg}
          </p>
        )}
      </div>

      <p className="text-gray-500 text-sm text-center">
        Or enter stats manually below → hit <strong className="text-white">Save</strong> to push live.
      </p>

      <input className="input" placeholder="Search player or team…" value={search} onChange={e => setSearch(e.target.value)} />

      <div className="flex flex-col gap-2">
        {filtered.map(player => {
          const st       = stats[player.id];
          const isActive = activePlayer === player.id;
          const hasData  = st && (st.runs > 0 || st.wickets > 0 || st.catches > 0 || st.stumpings > 0);

          return (
            <div key={player.id} className={`card border transition-all ${isActive ? 'border-ipl-orange' : 'border-gray-800'}`}>
              {/* Player row */}
              <div className="flex items-center gap-3 cursor-pointer" onClick={() => setActive(isActive ? null : player.id)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold truncate">{player.name}</span>
                    <span className="text-xs text-gray-500">{player.team}</span>
                    <span className={`badge-${player.role.toLowerCase()}`}>{player.role}</span>
                    {hasData && <span className="text-green-400 text-xs">● filled</span>}
                  </div>
                  {st && (st.runs > 0 || st.wickets > 0) && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {st.runs > 0 && `🏏 ${st.runs}(${st.ballsFaced}) `}
                      {st.wickets > 0 && `🎳 ${st.wickets}/${st.runsConceded} `}
                      {st.catches > 0 && `🤾 ${st.catches}c`}
                    </p>
                  )}
                </div>

                {/* Playing XI toggle */}
                <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                  <span className="text-xs text-gray-400">XI</span>
                  <button onClick={() => updateStat(player.id, 'playingXI', !st?.playingXI)}
                    className={`w-10 h-6 rounded-full transition-all relative flex-shrink-0 ${st?.playingXI ? 'bg-green-600' : 'bg-gray-700'}`}>
                    <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${st?.playingXI ? 'left-4' : 'left-0.5'}`} />
                  </button>
                </div>

                <span className="text-gray-500 text-sm">{isActive ? '▲' : '▼'}</span>
              </div>

              {/* Stat form */}
              {isActive && st && (
                <div className="mt-4 pt-4 border-t border-gray-800 flex flex-col gap-5">

                  {/* Batting */}
                  <div>
                    <h3 className="text-sm font-bold text-blue-400 mb-2">🏏 Batting</h3>
                    <div className="grid grid-cols-3 gap-2">
                      <NumInput label="Runs"    value={st.runs}       onChange={v => updateStat(player.id, 'runs', v)} />
                      <NumInput label="Balls"   value={st.ballsFaced} onChange={v => updateStat(player.id, 'ballsFaced', v)} />
                      <NumInput label="Fours"   value={st.fours}      onChange={v => updateStat(player.id, 'fours', v)} />
                      <NumInput label="Sixes"   value={st.sixes}      onChange={v => updateStat(player.id, 'sixes', v)} />
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-400">Dismissed?</label>
                        <button onClick={() => updateStat(player.id, 'isOut', !st.isOut)}
                          className={`py-1.5 rounded-lg text-sm font-semibold transition-all ${st.isOut ? 'bg-red-700 text-white' : 'bg-gray-700 text-gray-400'}`}>
                          {st.isOut ? 'OUT' : 'NOT OUT'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Bowling */}
                  <div>
                    <h3 className="text-sm font-bold text-green-400 mb-2">🎳 Bowling</h3>
                    <div className="grid grid-cols-3 gap-2">
                      <NumInput label="Wickets"          value={st.wickets}        onChange={v => updateStat(player.id, 'wickets', v)} />
                      <NumInput label="Overs"            value={st.oversBowled}    onChange={v => updateStat(player.id, 'oversBowled', v)} step={0.1} />
                      <NumInput label="Runs Conceded"    value={st.runsConceded}   onChange={v => updateStat(player.id, 'runsConceded', v)} />
                      <NumInput label="Maidens"          value={st.maidens}        onChange={v => updateStat(player.id, 'maidens', v)} />
                      <NumInput label="LBW/Bowled Wkts"  value={st.lbwBowledCount} onChange={v => updateStat(player.id, 'lbwBowledCount', v)} />
                    </div>
                  </div>

                  {/* Fielding */}
                  <div>
                    <h3 className="text-sm font-bold text-yellow-400 mb-2">🤾 Fielding</h3>
                    <div className="grid grid-cols-3 gap-2">
                      <NumInput label="Catches"     value={st.catches}        onChange={v => updateStat(player.id, 'catches', v)} />
                      <NumInput label="Stumpings"   value={st.stumpings}      onChange={v => updateStat(player.id, 'stumpings', v)} />
                      <NumInput label="Direct RO"   value={st.runoutDirect}   onChange={v => updateStat(player.id, 'runoutDirect', v)} />
                      <NumInput label="Indirect RO" value={st.runoutIndirect} onChange={v => updateStat(player.id, 'runoutIndirect', v)} />
                    </div>
                  </div>

                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Sticky Save */}
      <button onClick={saveScores} disabled={saving}
        className="btn-primary text-lg py-4 fixed bottom-4 left-4 right-4 max-w-4xl mx-auto">
        {saving ? '💾 Saving…' : '💾 Save & Update Live Leaderboard'}
      </button>
    </div>
  );
}
