import fs   from 'fs';
import path from 'path';
import { Room, TeamSelection, PlayerStats, Member, Player } from './types';
import { getPlayersForMatch } from './players';

// ─── File-backed In-Memory Store ─────────────────────────────────────────────
// Rooms are kept in RAM for speed, but persisted to data/rooms.json on every
// mutation. On server restart the file is read back — rooms survive redeploys.

const DATA_DIR  = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'rooms.json');

const rooms = new Map<string, Room>();

// Load existing rooms from disk at startup
function loadRooms(): void {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw  = fs.readFileSync(DATA_FILE, 'utf-8');
    const list: Room[] = JSON.parse(raw);
    for (const room of list) rooms.set(room.id, room);
    console.log(`💾 Loaded ${rooms.size} room(s) from disk`);
  } catch (e) {
    console.warn('⚠️  Could not load rooms from disk:', (e as Error).message);
  }
}

// Persist current rooms to disk (called after every mutation)
function saveRooms(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify([...rooms.values()], null, 2));
  } catch (e) {
    console.warn('⚠️  Could not save rooms to disk:', (e as Error).message);
  }
}

loadRooms();

function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1 (ambiguous)
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  if ([...rooms.values()].some(r => r.joinCode === code)) return generateJoinCode();
  return code;
}

export function createRoom(
  id: string,
  matchName: string,
  team1: string,
  team2: string,
  admin: Member,
  apiMatchId?: string
): Room {
  const room: Room = {
    id,
    joinCode:   generateJoinCode(),
    matchName,
    apiMatchId,                         // stored for live score polling
    team1,
    team2,
    adminId:    admin.id,
    members:    [admin],
    players:    getPlayersForMatch(team1, team2), // static fallback; overwritten by API squad
    teams:      {},
    scores:     {},
    inn1Scores: {},
    inn2Scores: {},
    locked:     false,
    createdAt:  new Date().toISOString(),
  };
  rooms.set(id, room);
  saveRooms();
  return room;
}

export function getRoom(id: string): Room | undefined {
  return rooms.get(id);
}

export function getRoomByCode(code: string): Room | undefined {
  return [...rooms.values()].find(r => r.joinCode === code.toUpperCase());
}

export function addMember(roomId: string, member: Member): Room | null {
  const room = rooms.get(roomId);
  if (!room) return null;
  if (!room.members.find(m => m.id === member.id)) room.members.push(member);
  saveRooms();
  return room;
}

export function submitTeam(roomId: string, selection: TeamSelection): Room | null {
  const room = rooms.get(roomId);
  if (!room || room.locked) return null;
  room.teams[selection.userId] = selection;
  saveRooms();
  return room;
}

export function lockRoom(roomId: string): Room | null {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.locked = true;
  saveRooms();
  return room;
}

export function updateScores(
  roomId: string,
  scores: { [playerId: string]: PlayerStats }
): Room | null {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.scores = { ...room.scores, ...scores };
  saveRooms();
  return room;
}

/**
 * Store per-innings scores. Each call fully replaces that innings' data (safe to call
 * multiple times mid-innings). Combined scores are recalculated automatically.
 */
export function updateInnScores(
  roomId: string,
  innings: 1 | 2,
  scores: { [playerId: string]: PlayerStats }
): Room | null {
  const room = rooms.get(roomId);
  if (!room) return null;
  if (innings === 1) room.inn1Scores = scores;
  else               room.inn2Scores = scores;
  room.scores = combineInnings(room.inn1Scores, room.inn2Scores);
  saveRooms();
  return room;
}

function combineInnings(
  inn1: { [pid: string]: PlayerStats },
  inn2: { [pid: string]: PlayerStats }
): { [pid: string]: PlayerStats } {
  const combined: { [pid: string]: PlayerStats } = {};
  const allPids = new Set([...Object.keys(inn1), ...Object.keys(inn2)]);
  for (const pid of allPids) {
    const s1 = inn1[pid];
    const s2 = inn2[pid];
    if (s1 && s2) {
      combined[pid] = {
        runs:           s1.runs           + s2.runs,
        ballsFaced:     s1.ballsFaced     + s2.ballsFaced,
        fours:          s1.fours          + s2.fours,
        sixes:          s1.sixes          + s2.sixes,
        isOut:          s1.isOut          || s2.isOut,
        wickets:        s1.wickets        + s2.wickets,
        oversBowled:    s1.oversBowled    + s2.oversBowled,
        runsConceded:   s1.runsConceded   + s2.runsConceded,
        maidens:        s1.maidens        + s2.maidens,
        lbwBowledCount: s1.lbwBowledCount + s2.lbwBowledCount,
        catches:        s1.catches        + s2.catches,
        stumpings:      s1.stumpings      + s2.stumpings,
        runoutDirect:   s1.runoutDirect   + s2.runoutDirect,
        runoutIndirect: s1.runoutIndirect + s2.runoutIndirect,
        playingXI:      s1.playingXI      || s2.playingXI,
      };
    } else {
      combined[pid] = { ...(s1 ?? s2) };
    }
  }
  return combined;
}

/** Called after API squad fetch — replaces static player list with actual match squad */
export function updateRoomPlayers(roomId: string, players: Player[]): Room | null {
  const room = rooms.get(roomId);
  if (!room || !players.length) return null;
  room.players = players;
  saveRooms();
  console.log(`📋 Room ${roomId} — squad updated: ${players.length} players`);
  return room;
}
