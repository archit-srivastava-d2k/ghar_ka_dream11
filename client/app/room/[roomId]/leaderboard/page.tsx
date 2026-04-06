'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSocket } from '@/lib/socket';
import { LeaderboardEntry, LocalUser, Room } from '@/lib/types';

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:4000';
const MEDALS = ['🥇', '🥈', '🥉'];

export default function Leaderboard() {
  const { roomId } = useParams<{ roomId: string }>();
  const router = useRouter();

  const [entries, setEntries]     = useState<LeaderboardEntry[]>([]);
  const [room, setRoom]           = useState<Room | null>(null);
  const [user, setUser]           = useState<LocalUser | null>(null);
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem('fantasy_user');
    if (!raw) { router.push('/'); return; }
    setUser(JSON.parse(raw));
  }, [router]);

  useEffect(() => {
    if (!user) return;
    fetch(`${SERVER}/api/rooms/${roomId}/leaderboard`)
      .then(r => r.json()).then(d => { setEntries(d.leaderboard); setLastUpdated(new Date()); });
    fetch(`${SERVER}/api/rooms/${roomId}`)
      .then(r => r.json()).then(d => setRoom(d.room));
  }, [roomId, user]);

  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    socket.emit('join-room', roomId);
    socket.on('leaderboard-update', (lb: LeaderboardEntry[]) => { setEntries(lb); setLastUpdated(new Date()); });
    socket.on('room-state', (r: Room) => setRoom(r));
    return () => { socket.off('leaderboard-update'); socket.off('room-state'); };
  }, [user, roomId]);

  if (!user) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white">← Back</button>
        <h1 className="font-bold text-lg">🏆 Leaderboard</h1>
        <p className="text-xs text-gray-500">{lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}</p>
      </div>

      {room && (
        <p className="text-center text-gray-400 text-sm">{room.matchName} · {entries.length} participant{entries.length !== 1 ? 's' : ''}</p>
      )}

      {entries.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-4xl mb-3">⏳</p>
          <p className="text-gray-400 font-semibold">No scores yet</p>
          <p className="text-gray-600 text-sm mt-1">Ask the admin to enter match scores to see points here.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {entries.map(entry => {
            const isMe   = entry.userId === user.userId;
            const isOpen = expanded === entry.userId;

            return (
              <div key={entry.userId} className={`card border transition-all ${isMe ? 'border-ipl-orange' : 'border-gray-800'}`}>
                {/* Row */}
                <div className="flex items-center gap-3 cursor-pointer" onClick={() => setExpanded(isOpen ? null : entry.userId)}>
                  <div className="text-2xl w-8 text-center flex-shrink-0">
                    {entry.rank <= 3
                      ? MEDALS[entry.rank - 1]
                      : <span className="text-gray-500 font-bold text-base">{entry.rank}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold truncate">
                      {entry.userName}
                      {isMe && <span className="text-ipl-orange text-xs ml-1">(you)</span>}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-2xl font-black text-ipl-gold">{entry.totalPoints}</p>
                    <p className="text-xs text-gray-500">pts</p>
                  </div>
                  <span className="text-gray-500 text-xs">{isOpen ? '▲' : '▼'}</span>
                </div>

                {/* Breakdown */}
                {isOpen && (
                  <div className="mt-3 pt-3 border-t border-gray-800">
                    <p className="text-xs text-gray-500 mb-2">Player-by-player breakdown</p>
                    <div className="flex flex-col gap-1">
                      {Object.entries(entry.breakdown)
                        .sort((a, b) => b[1].finalPoints - a[1].finalPoints)
                        .map(([pid, bd]) => (
                          <div key={pid} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2 text-sm">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium truncate max-w-[160px]">{bd.playerName}</span>
                              {bd.isC  && <span className="bg-ipl-gold text-black text-xs font-black px-1.5 rounded">C</span>}
                              {bd.isVC && <span className="bg-gray-300 text-black text-xs font-black px-1.5 rounded">VC</span>}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {(bd.isC || bd.isVC) && (
                                <span className="text-xs text-gray-500">{bd.basePoints} ×{bd.isC ? '2' : '1.5'}</span>
                              )}
                              <span className="font-bold">{bd.finalPoints}</span>
                            </div>
                          </div>
                        ))}
                    </div>
                    <div className="flex justify-end mt-2 pt-2 border-t border-gray-700">
                      <span className="font-black text-ipl-gold">Total: {entry.totalPoints} pts</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
