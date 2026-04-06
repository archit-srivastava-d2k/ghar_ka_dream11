'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSocket } from '@/lib/socket';
import { Room, LocalUser } from '@/lib/types';

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:4000';

export default function RoomLobby() {
  const { roomId } = useParams<{ roomId: string }>();
  const router = useRouter();
  const [room, setRoom] = useState<Room | null>(null);
  const [user, setUser] = useState<LocalUser | null>(null);
  const [copied, setCopied] = useState(false);

  const isAdmin = !!(user?.adminId && user.adminId === room?.adminId);
  const myTeam  = user ? room?.teams[user.userId] : null;

  useEffect(() => {
    const raw = localStorage.getItem('fantasy_user');
    if (!raw) { router.push('/'); return; }
    const u: LocalUser = JSON.parse(raw);
    if (u.roomId !== roomId) { router.push('/'); return; }
    setUser(u);
  }, [roomId, router]);

  // Verify room exists via REST — redirect home if not found
  useEffect(() => {
    if (!user) return;
    fetch(`${SERVER}/api/rooms/${roomId}`)
      .then(r => r.json())
      .then(res => {
        if (!res.room) { router.push('/'); return; }
        setRoom(res.room);
      })
      .catch(() => router.push('/'));
  }, [user, roomId, router]);

  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    socket.emit('join-room', roomId);
    socket.on('room-state', (r: Room) => setRoom(r));
    socket.on('room-locked', () => setRoom(prev => prev ? { ...prev, locked: true } : prev));
    return () => { socket.off('room-state'); socket.off('room-locked'); };
  }, [user, roomId]);

  const copyCode = useCallback(() => {
    if (!room) return;
    navigator.clipboard.writeText(room.joinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [room]);

  const handleLock = useCallback(() => {
    if (!user?.adminId) return;
    getSocket().emit('lock-room', { roomId, adminId: user.adminId });
  }, [roomId, user]);

  if (!room || !user) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <p className="text-gray-400 animate-pulse text-lg">Connecting to room…</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">

      {/* Match Header */}
      <div className="card text-center">
        <p className="text-sm text-gray-500 mb-1">Today's Match</p>
        <h1 className="text-2xl font-extrabold mb-3">{room.matchName}</h1>
        <div className="flex items-center justify-center gap-4 mb-4">
          <span className="text-3xl font-black text-ipl-orange">{room.team1}</span>
          <span className="text-gray-500 text-xl font-bold">vs</span>
          <span className="text-3xl font-black text-ipl-orange">{room.team2}</span>
        </div>

        {/* Join Code */}
        <div className="bg-gray-800 rounded-xl p-4 inline-block">
          <p className="text-xs text-gray-500 mb-1">Share this code with friends</p>
          <p className="text-3xl font-black tracking-widest text-ipl-gold">{room.joinCode}</p>
          <button onClick={copyCode} className="mt-2 text-xs text-gray-400 hover:text-white transition-colors">
            {copied ? '✅ Copied!' : '📋 Copy Code'}
          </button>
        </div>

        {room.locked && (
          <div className="mt-3 bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-2 text-sm font-semibold">
            🔒 Room is locked — no more team changes
          </div>
        )}
      </div>

      {/* Members */}
      <div className="card">
        <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
          👥 Players in Room
          <span className="bg-gray-700 text-gray-300 text-xs px-2 py-0.5 rounded-full">{room.members.length}</span>
        </h2>
        <div className="flex flex-col gap-2">
          {room.members.map(m => (
            <div key={m.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-ipl-orange flex items-center justify-center font-bold text-sm">
                  {m.name[0].toUpperCase()}
                </div>
                <span className="font-medium">{m.name}</span>
                {m.id === room.adminId && (
                  <span className="text-xs bg-ipl-gold/20 text-ipl-gold border border-ipl-gold/30 px-2 py-0.5 rounded-full">Admin</span>
                )}
                {m.id === user.userId && <span className="text-xs text-gray-500">(you)</span>}
              </div>
              <span className={`text-sm font-semibold ${room.teams[m.id] ? 'text-green-400' : 'text-gray-500'}`}>
                {room.teams[m.id] ? '✅ Ready' : '⏳ Pending'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3">
        {!room.locked ? (
          <button onClick={() => router.push(`/room/${roomId}/team`)} className="btn-primary text-lg py-3 text-center">
            {myTeam ? '✏️ Edit My Team' : '🏏 Pick My Team'}
          </button>
        ) : (
          <button onClick={() => router.push(`/room/${roomId}/team`)} className="btn-secondary text-lg py-3 text-center">
            👀 View My Team
          </button>
        )}

        <button onClick={() => router.push(`/room/${roomId}/leaderboard`)} className="btn-secondary text-lg py-3 text-center">
          🏆 Live Leaderboard
        </button>

        {isAdmin && (
          <>
            <button onClick={() => router.push(`/room/${roomId}/admin`)}
              className="btn-secondary py-3 text-center border border-ipl-gold/30 text-ipl-gold">
              📊 Enter Match Scores (Admin)
            </button>
            {!room.locked && (
              <button onClick={handleLock}
                className="btn-secondary py-3 text-center border border-red-700 text-red-400">
                🔒 Lock Room (Stop Team Changes)
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
