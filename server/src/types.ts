export type PlayerRole = 'BAT' | 'BOWL' | 'AR' | 'WK';

export interface Player {
  id: string;
  name: string;
  team: string;
  role: PlayerRole;
}

export interface TeamSelection {
  userId: string;
  userName: string;
  players: string[];
  captain: string;
  viceCaptain: string;
  submitted: boolean;
}

export interface PlayerStats {
  runs: number;
  ballsFaced: number;
  fours: number;
  sixes: number;
  isOut: boolean;
  wickets: number;
  oversBowled: number;
  runsConceded: number;
  maidens: number;
  lbwBowledCount: number;
  catches: number;
  stumpings: number;
  runoutDirect: number;
  runoutIndirect: number;
  playingXI: boolean;
}

export interface Member {
  id: string;
  name: string;
}

export interface Room {
  id: string;
  joinCode: string;
  matchName: string;
  apiMatchId?: string;   // CricAPI UUID or ESPN numeric ID — used for live fetch
  team1: string;
  team2: string;
  adminId: string;
  members: Member[];
  players: Player[];     // actual squad — overwritten by API when available
  teams: { [userId: string]: TeamSelection };
  scores: { [playerId: string]: PlayerStats };
  locked: boolean;
  createdAt: string;
}

export interface LeaderboardEntry {
  userId: string;
  userName: string;
  totalPoints: number;
  rank: number;
  breakdown: {
    [playerId: string]: {
      playerName: string;
      basePoints: number;
      finalPoints: number;
      isC: boolean;
      isVC: boolean;
    };
  };
}
