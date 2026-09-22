/**
 * The catalogue of games Gamenite offers. Shown in the lobby and used by
 * the server to know which room type to create.
 *
 * Player counts below are the traditional rules of each game. The product
 * limits we actually ship (for example, whether we allow three teams in Five Row)
 * are decided with the founder before they are used anywhere.
 */

export type GameId = 'fiverow' | 'court_piece';

export interface GameInfo {
  id: GameId;
  name: string;
  tagline: string;
  minPlayers: number;
  maxPlayers: number;
  teams: number[];
}

export const GAMES: readonly GameInfo[] = [
  {
    // Internal id is deliberately generic; the display name can change freely.
    id: 'fiverow',
    name: 'Jack Streak',
    tagline: 'Five chips in a row on the 10x10 board. Jacks are wild.',
    minPlayers: 2,
    maxPlayers: 12,
    teams: [2, 3],
  },
  {
    id: 'court_piece',
    name: 'Court Piece',
    tagline: 'Rang. Four players, two teams, thirteen tricks.',
    minPlayers: 4,
    maxPlayers: 4,
    teams: [2],
  },
];

export function getGame(id: GameId): GameInfo {
  const game = GAMES.find((g) => g.id === id);
  if (!game) {
    throw new Error(`Unknown game id: ${id}`);
  }
  return game;
}
