/**
 * How to play, in plain English, straight from the rules the server
 * enforces. Shared so the phone, the store listing and a support page all
 * say the same thing. No trademarked names, no gambling words.
 */

export interface HowToPlaySection {
  heading: string;
  lines: string[];
}

export interface HowToPlay {
  id: 'fiverow' | 'courtpiece';
  name: string;
  tagline: string;
  /** One line for the card header, e.g. "2, 3 or 4 players". */
  players: string;
  sections: HowToPlaySection[];
}

const TIMEOUTS: HowToPlaySection = {
  heading: 'Time limits',
  lines: [
    'You have 30 seconds per turn. If time runs out, the game makes a legal move for you.',
    'Three timeouts in a row and your seat is treated as abandoned: it keeps being played automatically.',
    'If everyone on a side has abandoned, the other side wins.',
  ],
};

export const HOW_TO_PLAY: readonly HowToPlay[] = [
  {
    id: 'fiverow',
    name: 'Jack Streak',
    tagline: 'Five chips in a row on the 10x10 board. Jacks are wild.',
    players: '1 vs 1, 3 players, or 2 vs 2',
    sections: [
      {
        heading: 'The goal',
        lines: [
          'Make lines of five chips in a row: across, down or diagonally.',
          '1 vs 1 and 2 vs 2: the first side with two lines wins. 3 players: the first with one line wins.',
          'A line can share at most one chip with another line you already made.',
        ],
      },
      {
        heading: 'Setup',
        lines: [
          'The board shows card faces; every card appears twice. The four corners are free spaces that count for everyone.',
          'Two decks are shuffled together. 1 vs 1 deals 7 cards each; 3 players and 2 vs 2 deal 6.',
          'In 2 vs 2, partners sit opposite and share one colour of chips.',
        ],
      },
      {
        heading: 'Your turn',
        lines: [
          'Play a card from your hand and put a chip on one of its two spaces on the board, if one is free.',
          'Then draw a card. Play passes to the left.',
          'If both spaces of a card are already taken, it is dead: once per turn you may swap it for a new card before you play.',
        ],
      },
      {
        heading: 'Jacks',
        lines: [
          'The Jack of Diamonds and the Jack of Clubs show two eyes. They are wild: put a chip on any free space.',
          'The Jack of Hearts and the Jack of Spades show one eye. Play one to remove an opponent chip, unless that chip is already part of a finished line.',
        ],
      },
      TIMEOUTS,
    ],
  },
  {
    id: 'courtpiece',
    name: 'Court Piece',
    tagline: 'Rang. Four players, two teams, thirteen tricks.',
    players: '4 players, 2 vs 2',
    sections: [
      {
        heading: 'The goal',
        lines: [
          'Two teams of two; partners sit opposite. A standard deck, 13 cards each.',
          'Win 7 of the 13 tricks to win the deal. All 13 tricks is a kot (by the team that made trump) or a goon kot (by the other team). Each counts as one deal won.',
        ],
      },
      {
        heading: 'The opening',
        lines: ['Whoever holds the 2 of Clubs leads the first trick and must play it.'],
      },
      {
        heading: 'Trump is made blind',
        lines: [
          'Nobody names a trump suit at the start.',
          'The first time a player cannot follow suit and plays a card of another suit, that suit becomes trump for the rest of the deal. That player chose it, so choose well.',
          'The team that made trump is the team that "called" it.',
        ],
      },
      {
        heading: 'Tricks',
        lines: [
          'Follow suit if you can. The highest trump wins the trick; with no trump played, the highest card of the suit led wins.',
          'The winner of a trick leads the next one. All 13 tricks are played.',
        ],
      },
      {
        heading: 'Single Siri',
        lines: [
          'Until trump is made, won tricks wait in the middle.',
          'The trick that makes trump takes the whole pile. After that, every trick goes straight to its winner.',
        ],
      },
      {
        heading: 'Double Siri',
        lines: [
          'Tricks are banked only when the same player wins two in a row: the pair goes to their team.',
          'No banking before trump exists, and none on tricks 1, 2 or 12.',
          'Winning with an Ace right after winning with an Ace does not bank.',
          'The 13th trick takes everything still waiting in the middle.',
        ],
      },
      {
        heading: 'Series and rematch',
        lines: [
          'A lounge of four friends plays best of 1, 3 or 5 deals; the dealer moves one seat to the right each deal.',
          'A table with other players at it is one deal, then everyone votes on a rematch.',
        ],
      },
      TIMEOUTS,
    ],
  },
];

export function howToPlay(id: HowToPlay['id']): HowToPlay {
  const found = HOW_TO_PLAY.find((h) => h.id === id);
  if (!found) throw new Error(`no rules for ${id}`);
  return found;
}
