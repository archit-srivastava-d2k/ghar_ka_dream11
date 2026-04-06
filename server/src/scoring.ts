import { PlayerStats, LeaderboardEntry, Room } from './types';
import { getPlayerById as getStaticPlayerById } from './players';

const RULES = {
  playing:  { inPlayingXI: 4 },
  batting: {
    perRun: 1, perFour: 1, perSix: 2,
    milestone25: 4, milestone50: 8, milestone100: 16,
    duck: -2,
    strikeRate: {
      minBalls: 10,
      above170: 6, from150to170: 4, from130to150: 2,
      from60to70: -2, from50to60: -4, below50: -6,
    },
  },
  bowling: {
    perWicket: 25, lbwBowledBonus: 8,
    threeWickets: 4, fourWickets: 8, fiveWickets: 16,
    perMaiden: 8,
    economy: {
      minOvers: 2,
      below5: 6, from5to6: 4, from6to7: 2,
      from10to11: -2, from11to12: -4, above12: -6,
    },
  },
  fielding: {
    perCatch: 8, threeOrMoreCatchesBonus: 4,
    perStumping: 12, runoutDirect: 12, runoutIndirect: 6,
  },
  multipliers: { captain: 2.0, viceCaptain: 1.5 },
};

export function calculateBasePoints(stats: PlayerStats): number {
  let pts = 0;

  if (stats.playingXI) pts += RULES.playing.inPlayingXI;

  // Batting
  pts += stats.runs * RULES.batting.perRun;
  pts += stats.fours * RULES.batting.perFour;
  pts += stats.sixes * RULES.batting.perSix;
  if      (stats.runs >= 100) pts += RULES.batting.milestone100;
  else if (stats.runs >= 50)  pts += RULES.batting.milestone50;
  else if (stats.runs >= 25)  pts += RULES.batting.milestone25;
  if (stats.isOut && stats.runs === 0 && stats.ballsFaced > 0) pts += RULES.batting.duck;

  if (stats.ballsFaced >= RULES.batting.strikeRate.minBalls) {
    const sr = (stats.runs / stats.ballsFaced) * 100;
    if      (sr >= 170) pts += RULES.batting.strikeRate.above170;
    else if (sr >= 150) pts += RULES.batting.strikeRate.from150to170;
    else if (sr >= 130) pts += RULES.batting.strikeRate.from130to150;
    else if (sr < 50)   pts += RULES.batting.strikeRate.below50;
    else if (sr < 60)   pts += RULES.batting.strikeRate.from50to60;
    else if (sr < 70)   pts += RULES.batting.strikeRate.from60to70;
  }

  // Bowling
  pts += stats.wickets * RULES.bowling.perWicket;
  pts += stats.lbwBowledCount * RULES.bowling.lbwBowledBonus;
  pts += stats.maidens * RULES.bowling.perMaiden;
  if      (stats.wickets >= 5) pts += RULES.bowling.fiveWickets;
  else if (stats.wickets >= 4) pts += RULES.bowling.fourWickets;
  else if (stats.wickets >= 3) pts += RULES.bowling.threeWickets;

  if (stats.oversBowled >= RULES.bowling.economy.minOvers) {
    const eco = stats.runsConceded / stats.oversBowled;
    if      (eco < 5)  pts += RULES.bowling.economy.below5;
    else if (eco < 6)  pts += RULES.bowling.economy.from5to6;
    else if (eco < 7)  pts += RULES.bowling.economy.from6to7;
    else if (eco >= 12) pts += RULES.bowling.economy.above12;
    else if (eco >= 11) pts += RULES.bowling.economy.from11to12;
    else if (eco >= 10) pts += RULES.bowling.economy.from10to11;
  }

  // Fielding
  pts += stats.catches * RULES.fielding.perCatch;
  if (stats.catches >= 3) pts += RULES.fielding.threeOrMoreCatchesBonus;
  pts += stats.stumpings * RULES.fielding.perStumping;
  pts += stats.runoutDirect * RULES.fielding.runoutDirect;
  pts += stats.runoutIndirect * RULES.fielding.runoutIndirect;

  return pts;
}

export function applyMultiplier(base: number, isC: boolean, isVC: boolean): number {
  if (isC)  return Math.round(base * RULES.multipliers.captain);
  if (isVC) return Math.round(base * RULES.multipliers.viceCaptain);
  return base;
}

export function buildLeaderboard(room: Room): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = [];

  for (const userId of Object.keys(room.teams)) {
    const selection = room.teams[userId];
    let totalPoints = 0;
    const breakdown: LeaderboardEntry['breakdown'] = {};

    for (const playerId of selection.players) {
      const stats  = room.scores[playerId];
      // Look up from room's player list first (handles API-fetched squads), fall back to static
      const player = room.players?.find(p => p.id === playerId) ?? getStaticPlayerById(playerId);
      if (!stats || !player) continue;

      const isC  = selection.captain === playerId;
      const isVC = selection.viceCaptain === playerId;
      const base  = calculateBasePoints(stats);
      const final = applyMultiplier(base, isC, isVC);

      totalPoints += final;
      breakdown[playerId] = { playerName: player.name, basePoints: base, finalPoints: final, isC, isVC };
    }

    entries.push({ userId, userName: selection.userName, totalPoints, rank: 0, breakdown });
  }

  entries.sort((a, b) => b.totalPoints - a.totalPoints);
  entries.forEach((e, i) => (e.rank = i + 1));
  return entries;
}

export { RULES };
