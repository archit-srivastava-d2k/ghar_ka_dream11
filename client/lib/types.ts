export type PlayerRole = 'BAT' | 'BOWL' | 'AR' | 'WK';

export interface Player {
  id: string; name: string; team: string; role: PlayerRole;
}

export interface TeamSelection {
  userId: string; userName: string;
  players: string[]; captain: string; viceCaptain: string; submitted: boolean;
}

export interface PlayerStats {
  runs: number; ballsFaced: number; fours: number; sixes: number; isOut: boolean;
  wickets: number; oversBowled: number; runsConceded: number; maidens: number; lbwBowledCount: number;
  catches: number; stumpings: number; runoutDirect: number; runoutIndirect: number; playingXI: boolean;
}

export interface Member { id: string; name: string; }

export interface Room {
  id: string;
  joinCode: string;
  matchName: string;
  apiMatchId?: string;    // external match ID for live score fetch
  team1: string;
  team2: string;
  adminId: string;
  members: Member[];
  players: Player[];      // actual squad from API, or static fallback
  teams: { [userId: string]: TeamSelection };
  scores: { [playerId: string]: PlayerStats };
  locked: boolean;
  createdAt: string;
}

export interface LeaderboardEntry {
  userId: string; userName: string; totalPoints: number; rank: number;
  breakdown: {
    [playerId: string]: { playerName: string; basePoints: number; finalPoints: number; isC: boolean; isVC: boolean; };
  };
}

export interface LocalUser {
  userId: string; userName: string; roomId: string; adminId?: string;
}

/** Live match from /api/matches endpoint */
export interface LiveMatch {
  id: string;
  name: string;
  status: string;
  team1: string;
  team2: string;
  dateTime?: string;
  source: 'cricapi' | 'espn';
}

export function emptyStats(): PlayerStats {
  return {
    runs: 0, ballsFaced: 0, fours: 0, sixes: 0, isOut: false,
    wickets: 0, oversBowled: 0, runsConceded: 0, maidens: 0, lbwBowledCount: 0,
    catches: 0, stumpings: 0, runoutDirect: 0, runoutIndirect: 0, playingXI: true,
  };
}
