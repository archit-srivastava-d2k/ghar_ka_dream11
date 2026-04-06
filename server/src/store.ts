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

/** Called after API squad fetch — replaces static player list with actual match squad */
export function updateRoomPlayers(roomId: string, players: Player[]): Room | null {
  const room = rooms.get(roomId);
  if (!room || !players.length) return null;
  room.players = players;
  saveRooms();
  console.log(`📋 Room ${roomId} — squad updated: ${players.length} players`);
  return room;
}
