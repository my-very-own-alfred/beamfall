// Beamfall — match-stats scoring weights and helpers.
// Centralized so balance tweaks don't sprawl across every system.
//
// Score formula:
//   score =  ULT_KILL_PTS  * ultKills
//         +  LASER_KILL_PTS* laserKills
//         +  CAPTURE_PTS   * captures
//         +  THIEF_PTS     * thiefSteals
//         +  SHOCK_PTS     * shockHits
//         +  ROUND_WIN_PTS * roundsWon
//         +  DEATH_PTS     * deaths    (DEATH_PTS is negative)
//
// All weights are integers so the leaderboard ranks cleanly without ties from
// float imprecision.

import type { Player, PlayerStats } from '@/types';

export const ULT_KILL_PTS = 5;
export const LASER_KILL_PTS = 2;
export const CAPTURE_PTS = 1;
export const THIEF_PTS = 2;
export const SHOCK_PTS = 1;
export const ROUND_WIN_PTS = 4;
export const DEATH_PTS = -1;

export function emptyStats(): PlayerStats {
  return {
    ultKills: 0,
    laserKills: 0,
    deaths: 0,
    captures: 0,
    thiefSteals: 0,
    shockHits: 0,
    roundsWon: 0,
  };
}

export function statsScore(s: PlayerStats): number {
  return (
    ULT_KILL_PTS * s.ultKills +
    LASER_KILL_PTS * s.laserKills +
    CAPTURE_PTS * s.captures +
    THIEF_PTS * s.thiefSteals +
    SHOCK_PTS * s.shockHits +
    ROUND_WIN_PTS * s.roundsWon +
    DEATH_PTS * s.deaths
  );
}

export interface RankedPlayer {
  player: Player;
  score: number;
  rank: number; // 1-based, with ties sharing rank
}

/**
 * Rank players highest-score-first. Ties share the same rank (standard
 * competition ranking — 1, 2, 2, 4 — so the leaderboard ranks the next
 * unique player accordingly).
 */
export function rankPlayers(players: readonly Player[]): RankedPlayer[] {
  const scored = players.map((p) => ({ player: p, score: statsScore(p.stats), rank: 0 }));
  scored.sort((a, b) => b.score - a.score);
  let lastScore = Number.NaN;
  let lastRank = 0;
  for (let i = 0; i < scored.length; i++) {
    const entry = scored[i]!;
    if (entry.score === lastScore) {
      entry.rank = lastRank;
    } else {
      entry.rank = i + 1;
      lastRank = entry.rank;
      lastScore = entry.score;
    }
  }
  return scored;
}
