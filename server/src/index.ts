import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

import {
  createRoom, getRoom, getRoomByCode,
  addMember, submitTeam, lockRoom,
  updateScores, updateInnScores, updateRoomPlayers,
} from './store';
import { buildLeaderboard } from './scoring';
import { IPL_TEAMS } from './players';
import { PlayerStats, TeamSelection } from './types';
import {
  fetchLiveMatches,
  fetchMatchSquad,
  fetchLiveScorecard,
  autoMapStats,
} from './cricapi';
import { parseMatchJSON } from './cricapi';

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

// ─── REST Endpoints ───────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', message: '🏏 IPL Fantasy Server running!' });
});

/** Team codes for dropdowns */
app.get('/api/teams', (_req, res) => {
  res.json({ teams: IPL_TEAMS });
});

/**
 * GET /api/matches
 * Live + upcoming IPL matches from CricAPI (if key set) or ESPN scraping.
 * Used by the home page to auto-fill match name / team codes.
 */
app.get('/api/matches', async (_req, res) => {
  try {
    const matches = await fetchLiveMatches();
    res.json({ matches });
  } catch {
    res.json({ matches: [] });
  }
});

/**
 * POST /api/rooms
 * Create a room. If apiMatchId is provided, asynchronously fetches
 * the actual playing squad and replaces the static player list.
 */
app.post('/api/rooms', async (req, res) => {
  const { matchName, team1, team2, userName, apiMatchId } = req.body;

  if (!matchName || !team1 || !team2 || !userName)
    return res.status(400).json({ error: 'matchName, team1, team2, userName are required' });
  if (team1 === team2)
    return res.status(400).json({ error: 'team1 and team2 must be different' });

  const adminId = uuidv4();
  const roomId  = uuidv4();
  let room      = createRoom(roomId, matchName, team1, team2, { id: adminId, name: userName }, apiMatchId);

  // Fetch squad synchronously so players are ready when user reaches the team builder
  if (apiMatchId) {
    try {
      const squad = await fetchMatchSquad(apiMatchId);
      if (squad.length > 0) {
        room = updateRoomPlayers(roomId, squad) ?? room;
        console.log(`[squad] ${squad.length} players loaded for room ${roomId}`);
      } else {
        console.warn('[squad] API returned empty squad — using static fallback');
      }
    } catch (err) {
      console.warn('[squad] fetch failed, using static fallback:', (err as Error).message);
    }
  }

  return res.json({ room, adminId, players: room.players });
});

/** POST /api/rooms/join */
app.post('/api/rooms/join', (req, res) => {
  const { joinCode, userName } = req.body;
  if (!joinCode || !userName)
    return res.status(400).json({ error: 'joinCode and userName are required' });

  const room = getRoomByCode(joinCode);
  if (!room)
    return res.status(404).json({ error: 'Room not found. Check the code and try again.' });

  const userId  = uuidv4();
  const updated = addMember(room.id, { id: userId, name: userName });
  return res.json({ room: updated, userId, players: updated?.players ?? [] });
});

/** GET /api/rooms/:roomId */
app.get('/api/rooms/:roomId', (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  return res.json({ room, players: room.players });
});

/** GET /api/rooms/:roomId/leaderboard */
app.get('/api/rooms/:roomId/leaderboard', (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  return res.json({ leaderboard: buildLeaderboard(room) });
});

/**
 * POST /api/rooms/:roomId/fetch-scores
 * Admin triggers a one-time live score fetch + auto-map.
 */
app.post('/api/rooms/:roomId/fetch-scores', async (req, res) => {
  const { adminId, matchId } = req.body;
  const room = getRoom(req.params.roomId);

  if (!room)    return res.status(404).json({ error: 'Room not found' });
  if (room.adminId !== adminId) return res.status(403).json({ error: 'Only admin can fetch scores' });
  if (!matchId) return res.status(400).json({ error: 'matchId is required' });

  const scorecard = await fetchLiveScorecard(matchId);
  if (!scorecard) return res.status(502).json({ error: 'Failed to fetch scorecard. Check matchId or try again.' });

  const mappedScores = autoMapStats(scorecard, room.players);
  const updated      = updateScores(room.id, mappedScores);
  if (updated) {
    const leaderboard = buildLeaderboard(updated);
    io.to(room.id).emit('room-state', updated);
    io.to(room.id).emit('leaderboard-update', leaderboard);
  }

  return res.json({ success: true, message: `Scores fetched! ${scorecard.playingXI.length} players found.`, scores: mappedScores });
});

/**
 * POST /api/rooms/:roomId/score-from-json
 * Admin pastes innings JSON → parses stats → scores update live.
 * Body: { adminId, matchData, innings: 1 | 2 }
 * Each call fully replaces that innings' data — safe to call multiple times.
 * Combined leaderboard = inn1 + inn2 automatically.
 */
app.post('/api/rooms/:roomId/score-from-json', (req, res) => {
  const { adminId, matchData, innings = 1 } = req.body;
  const room = getRoom(req.params.roomId);

  if (!room)    return res.status(404).json({ error: 'Room not found' });
  if (room.adminId !== adminId) return res.status(403).json({ error: 'Only admin can update scores' });
  if (!matchData) return res.status(400).json({ error: 'matchData is required' });
  if (innings !== 1 && innings !== 2) return res.status(400).json({ error: 'innings must be 1 or 2' });

  try {
    const scorecard = parseMatchJSON(matchData);
    const mapped    = autoMapStats(scorecard, room.players);
    const updated   = updateInnScores(room.id, innings as 1 | 2, mapped);

    if (updated) {
      io.to(room.id).emit('room-state', updated);
      io.to(room.id).emit('leaderboard-update', buildLeaderboard(updated));
    }

    return res.json({
      success: true,
      message: `Innings ${innings} loaded — ${scorecard.batters.length} batters, ${scorecard.bowlers.length} bowlers. Leaderboard updated!`,
    });
  } catch (e) {
    console.error('[json-score] parse error:', e);
    return res.status(400).json({ error: `Invalid match JSON: ${(e as Error).message}` });
  }
});

// ─── Auto-Poll (every 2 min, admin-controlled) ────────────────────────────────

const activePolls = new Map<string, NodeJS.Timeout>();

function startAutoPoll(roomId: string, matchId: string) {
  if (activePolls.has(roomId)) return;
  console.log(`⏱️  Auto-poll started — room ${roomId}`);

  const tick = async () => {
    const room = getRoom(roomId);
    if (!room) { stopAutoPoll(roomId); return; }

    const scorecard = await fetchLiveScorecard(matchId);
    if (!scorecard) return;

    const mapped  = autoMapStats(scorecard, room.players);
    const updated = updateScores(roomId, mapped);
    if (updated) {
      const lb = buildLeaderboard(updated);
      io.to(roomId).emit('room-state', updated);
      io.to(roomId).emit('leaderboard-update', lb);
      console.log(`🔄 Auto-poll updated — room ${roomId}`);
    }
  };

  activePolls.set(roomId, setInterval(tick, 2 * 60 * 1000)); // every 2 min
  tick(); // fire immediately on start
}

function stopAutoPoll(roomId: string) {
  const t = activePolls.get(roomId);
  if (t) { clearInterval(t); activePolls.delete(roomId); }
  console.log(`🛑 Auto-poll stopped — room ${roomId}`);
}

// ─── Socket.io ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`🔌 Connected: ${socket.id}`);

  socket.on('join-room', (roomId: string) => {
    socket.join(roomId);
    const room = getRoom(roomId);
    if (room) socket.emit('room-state', room);
  });

  socket.on('submit-team', (data: { roomId: string; selection: TeamSelection }) => {
    const room = submitTeam(data.roomId, data.selection);
    if (!room) { socket.emit('error', 'Room not found or is locked'); return; }
    io.to(data.roomId).emit('room-state', room);
  });

  socket.on('lock-room', (data: { roomId: string; adminId: string }) => {
    const room = getRoom(data.roomId);
    if (!room) { socket.emit('error', 'Room not found'); return; }
    if (room.adminId !== data.adminId) { socket.emit('error', 'Only admin can lock'); return; }
    const updated = lockRoom(data.roomId);
    io.to(data.roomId).emit('room-state', updated);
    io.to(data.roomId).emit('room-locked', { message: '🔒 Room locked! No more team changes.' });
  });

  socket.on('update-scores', (data: { roomId: string; adminId: string; scores: Record<string, PlayerStats> }) => {
    const room = getRoom(data.roomId);
    if (!room) { socket.emit('error', 'Room not found'); return; }
    if (room.adminId !== data.adminId) { socket.emit('error', 'Only admin can update scores'); return; }
    const updated = updateScores(data.roomId, data.scores);
    if (!updated) return;
    const lb = buildLeaderboard(updated);
    io.to(data.roomId).emit('room-state', updated);
    io.to(data.roomId).emit('leaderboard-update', lb);
  });

  socket.on('toggle-auto-poll', (data: { roomId: string; adminId: string; matchId: string; enabled: boolean }) => {
    const room = getRoom(data.roomId);
    if (!room || room.adminId !== data.adminId) return;
    if (data.enabled) startAutoPoll(data.roomId, data.matchId);
    else              stopAutoPoll(data.roomId);
    io.to(data.roomId).emit('auto-poll-status', data.enabled);
  });

  socket.on('disconnect', () => console.log(`🔌 Disconnected: ${socket.id}`));
});

// ─── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`\n🏏 IPL Fantasy Server → http://localhost:${PORT}`);
  console.log(`📡 Socket.io ready`);
  if (process.env.CRICAPI_KEY)    console.log(`✅ CricAPI key loaded — IPL live scores active`);
  else console.log(`⚠️  No CRICAPI_KEY — add it to server/.env for live IPL data`);
  console.log();
});
