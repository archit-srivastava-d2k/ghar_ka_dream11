'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSocket } from '@/lib/socket';
import { Room, Player, LocalUser, TeamSelection } from '@/lib/types';

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:4000';
const ROLE_BADGE: Record<string, string> = { BAT: 'badge-bat', BOWL: 'badge-bowl', AR: 'badge-ar', WK: 'badge-wk' };

export default function TeamBuilder() {
  const { roomId } = useParams<{ roomId: string }>();
  const router = useRouter();

  const [room, setRoom]       = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [user, setUser]       = useState<LocalUser | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [captain, setCaptain]   = useState('');
  const [vc, setVc]             = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [teamFilter, setTeamFilter] = useState<string>('ALL');
  const [errors, setErrors]   = useState<string[]>([]);
  const [saved, setSaved]     = useState(false);
  const [viewOnly, setViewOnly] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem('fantasy_user');
    if (!raw) { router.push('/'); return; }
    setUser(JSON.parse(raw));
  }, [router]);

  useEffect(() => {
    if (!user) return;
    fetch(`${SERVER}/api/rooms/${roomId}`)
      .then(r => r.json())
      .then((res: any) => {
        const room = res.room;
        const players = res.players;
        if (!room) { router.push('/'); return; }
        setRoom(room);
        setPlayers(Array.isArray(players) ? players : room.players ?? []);
        setViewOnly(room.locked);
        const existing: TeamSelection = room.teams?.[user.userId];
        if (existing) {
          setSelected(new Set(existing.players));
          setCaptain(existing.captain);
          setVc(existing.viceCaptain);
        }
      });
  }, [roomId, user]);

  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    socket.emit('join-room', roomId);
    socket.on('room-state', (r: Room) => { setRoom(r); if (r.locked) setViewOnly(true); });
    return () => { socket.off('room-state'); };
  }, [user, roomId]);

  const togglePlayer = (id: string) => {
    if (viewOnly) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (captain === id) setCaptain('');
        if (vc === id) setVc('');
      } else {
        if (next.size >= 11) return prev;
        next.add(id);
      }
      return next;
    });
  };

  const validate = (): string[] => {
    const errs: string[] = [];
    const sel = players.filter(p => selected.has(p.id));
    if (selected.size !== 11)     errs.push(`Select exactly 11 players (${selected.size}/11 selected)`);
    if (!captain)                 errs.push('Select a Captain (C)');
    if (!vc)                      errs.push('Select a Vice Captain (VC)');
    if (captain && vc && captain === vc) errs.push('Captain and Vice Captain must be different players');
    const byTeam = sel.reduce((a, p) => ({ ...a, [p.team]: (a[p.team] || 0) + 1 }), {} as Record<string, number>);
    if (Object.values(byTeam).some(c => c > 7)) errs.push('Max 7 players from one team allowed');
    if (!sel.some(p => p.role === 'WK'))   errs.push('Must have at least 1 Wicket-Keeper');
    if (!sel.some(p => p.role === 'BAT'))  errs.push('Must have at least 1 Batsman');
    if (!sel.some(p => p.role === 'BOWL')) errs.push('Must have at least 1 Bowler');
    if (!sel.some(p => p.role === 'AR'))   errs.push('Must have at least 1 All-Rounder');
    return errs;
  };

  const handleSubmit = () => {
    const errs = validate();
    if (errs.length) { setErrors(errs); return; }
    setErrors([]);
    const selection: TeamSelection = {
      userId: user!.userId, userName: user!.userName,
      players: Array.from(selected), captain, viceCaptain: vc, submitted: true,
    };
    getSocket().emit('submit-team', { roomId, selection });
    setSaved(true);
    setTimeout(() => router.push(`/room/${roomId}`), 1200);
  };

  // If scores data has playingXI info, use it to filter the pool
  const playingXIKnown = room && Object.values(room.scores).some(s => s.playingXI !== undefined);
  const playingXIPool  = playingXIKnown
    ? players.filter(p => room!.scores[p.id]?.playingXI !== false)
    : players;

  const filtered = useMemo(() => playingXIPool.filter(p =>
    (roleFilter === 'ALL' || p.role === roleFilter) &&
    (teamFilter === 'ALL' || p.team === teamFilter)
  ), [playingXIPool, roleFilter, teamFilter]);

  const counts = useMemo(() => {
    const sel = players.filter(p => selected.has(p.id));
    return { WK: sel.filter(p => p.role === 'WK').length, BAT: sel.filter(p => p.role === 'BAT').length, BOWL: sel.filter(p => p.role === 'BOWL').length, AR: sel.filter(p => p.role === 'AR').length };
  }, [selected, players]);

  const teams = room ? [room.team1, room.team2] : [];

  if (!room || !user) return <div className="flex items-center justify-center min-h-[60vh]"><p className="text-gray-400 animate-pulse">Loading…</p></div>;

  return (
    <div className="flex flex-col gap-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white">← Back</button>
        <h1 className="font-bold text-lg">{viewOnly ? '👀 My Team' : '🏏 Pick Your Team'}</h1>
        <span className="text-ipl-gold font-bold">{selected.size}/11</span>
      </div>

      {viewOnly && (
        <div className="bg-yellow-900/30 border border-yellow-700 text-yellow-300 rounded-lg px-4 py-2 text-sm text-center">
          🔒 Room is locked — viewing team only
        </div>
      )}

      {playingXIKnown && (
        <div className="bg-green-900/30 border border-green-700 text-green-300 rounded-lg px-4 py-2 text-sm text-center">
          ✅ Showing live Playing XI ({playingXIPool.length} players) — fetched from CricAPI
        </div>
      )}

      {/* Role Summary Bar */}
      <div className="card flex justify-around text-center py-3">
        {(['WK','BAT','BOWL','AR'] as const).map(r => (
          <div key={r}>
            <div className="text-xl font-black">{counts[r]}</div>
            <span className={ROLE_BADGE[r]}>{r}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {['ALL','WK','BAT','BOWL','AR'].map(r => (
          <button key={r} onClick={() => setRoleFilter(r)}
            className={`px-3 py-1 rounded-full text-sm font-semibold transition-all ${roleFilter === r ? 'bg-ipl-orange text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
            {r}
          </button>
        ))}
        <span className="border-l border-gray-700 mx-1" />
        {['ALL', ...teams].map(t => (
          <button key={t} onClick={() => setTeamFilter(t)}
            className={`px-3 py-1 rounded-full text-sm font-semibold transition-all ${teamFilter === t ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Player Cards */}
      <div className="flex flex-col gap-2">
        {filtered.map(player => {
          const isSel = selected.has(player.id);
          const isC   = captain === player.id;
          const isVC  = vc === player.id;
          const canAdd = selected.size < 11 || isSel;

          return (
            <div key={player.id}
              className={`flex items-center justify-between rounded-xl px-4 py-3 border transition-all
                ${isSel ? 'bg-gray-800 border-ipl-orange' : 'bg-gray-900 border-gray-800'}
                ${!canAdd && !isSel ? 'opacity-40 pointer-events-none' : ''}`}>
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <button onClick={() => togglePlayer(player.id)}
                  className={`w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all
                    ${isSel ? 'bg-ipl-orange border-ipl-orange text-white text-xs font-bold' : 'border-gray-600 hover:border-ipl-orange'}`}>
                  {isSel && '✓'}
                </button>
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{player.name}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-xs text-gray-500">{player.team}</span>
                    <span className={ROLE_BADGE[player.role]}>{player.role}</span>
                  </div>
                </div>
              </div>

              {isSel && !viewOnly && (
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => { if (vc === player.id) setVc(''); setCaptain(player.id); }}
                    className={`w-8 h-8 rounded-full text-xs font-black transition-all ${isC ? 'bg-ipl-gold text-black' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
                    C
                  </button>
                  <button onClick={() => { if (captain === player.id) setCaptain(''); setVc(player.id); }}
                    className={`w-8 h-8 rounded-full text-xs font-black transition-all ${isVC ? 'bg-gray-300 text-black' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
                    VC
                  </button>
                </div>
              )}

              {isSel && viewOnly && (isC || isVC) && (
                <span className={`text-xs font-black px-2 py-1 rounded-full ${isC ? 'bg-ipl-gold text-black' : 'bg-gray-300 text-black'}`}>
                  {isC ? 'C' : 'VC'}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="bg-red-900/50 border border-red-700 rounded-lg p-4">
          <p className="text-red-300 font-semibold text-sm mb-2">Fix these before submitting:</p>
          <ul className="list-disc list-inside text-red-400 text-sm space-y-1">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {/* Submit */}
      {!viewOnly && (
        <button onClick={handleSubmit} disabled={saved}
          className="btn-primary text-lg py-4 fixed bottom-4 left-4 right-4 max-w-4xl mx-auto">
          {saved ? '✅ Team Saved! Going back…' : `Submit Team (${selected.size}/11)`}
        </button>
      )}
    </div>
  );
}
