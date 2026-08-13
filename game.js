const RANKS = [
  { name: '3', value: 3 },
  { name: '4', value: 4 },
  { name: '5', value: 5 },
  { name: '6', value: 6 },
  { name: '7', value: 7 },
  { name: '8', value: 8 },
  { name: '9', value: 9 },
  { name: '10', value: 10 },
  { name: 'J', value: 11 },
  { name: 'Q', value: 12 },
  { name: 'K', value: 13 },
  { name: 'A', value: 14 },
  { name: '2', value: 15 }
];

const SUITS = ['♣', '♦', '♥', '♠'];

function rankName(value) {
  return RANKS.find(r => r.value === value)?.name ?? '?';
}

function createDeck() {
  const deck = [];

  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push({
        id: `${rank.name}${suit}`,
        rank: rank.value,
        suit
      });
    }
  }

  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

function sortHand(hand) {
  hand.sort((a, b) =>
    b.rank - a.rank ||
    a.suit.localeCompare(b.suit)
  );
}

function nextIndex(game, index) {
  return (index + 1) % game.players.length;
}

function activeIndexes(game) {
  return game.players
    .map((p, i) => p.hand.length > 0 ? i : -1)
    .filter(i => i !== -1);
}

function nextActiveIndex(game, fromIndex) {
  if (game.players.length === 0) {
    return -1;
  }

  let i = fromIndex;

  for (let n = 0; n < game.players.length; n++) {
    i = nextIndex(game, i);

    if (game.players[i].hand.length > 0) {
      return i;
    }
  }

  return -1;
}

function createGame(players) {
  return {
    phase: 'lobby',

    players: players.map(p => ({
      id: p.id,
      name: p.name,
      hand: [],
      finishPosition: null
    })),

    // Only the cards from the MOST RECENT play.
    pile: [],
    pileRank: null,
    pileCount: 0,

    lastPlayerIndex: null,
    turnIndex: null,
    passed: new Set(),

    finishOrder: [],
    starterIndex: null,
    round: 0,

    // Used only during the President/Scum exchange phase.
    exchange: null,

    message: 'Waiting for at least 3 players.'
  };
}

/*
 * Deal a complete round.
 *
 * starterIndex is the player who receives the first card and
 * therefore starts the round.
 *
 * President/Scum exchange is handled separately after dealing,
 * because the President must choose which card to give.
 */
function dealRound(game, starterIndex) {
  const deck = shuffle(createDeck());

  game.players.forEach(p => {
    p.hand = [];
    p.finishPosition = null;
  });

  // Deal clockwise.
  for (let i = 0; i < deck.length; i++) {
    const playerIndex =
      (starterIndex + i) % game.players.length;

    game.players[playerIndex].hand.push(deck[i]);
  }

  game.players.forEach(p => sortHand(p.hand));

  game.pile = [];
  game.pileRank = null;
  game.pileCount = 0;
  game.lastPlayerIndex = null;
  game.turnIndex = starterIndex;
  game.passed.clear();
  game.finishOrder = [];
  game.starterIndex = starterIndex;
  game.exchange = null;
  game.phase = 'playing';

  game.round += 1;

  game.message =
    `${game.players[starterIndex].name} starts.`;
}

/*
 * President chooses ONE card to give the Scum.
 * Scum automatically gives their highest-ranked card.
 */
function exchangePresidentScum(
  game,
  presidentIndex,
  scumIndex,
  presidentCardId
) {
  if (
    presidentIndex < 0 ||
    scumIndex < 0 ||
    presidentIndex === scumIndex
  ) {
    return {
      ok: false,
      error: 'Could not determine President and Scum.'
    };
  }

  const president = game.players[presidentIndex];
  const scum = game.players[scumIndex];

  const presidentCard =
    president.hand.find(card => card.id === presidentCardId);

  if (!presidentCard) {
    return {
      ok: false,
      error: 'You do not have that card.'
    };
  }

  if (scum.hand.length === 0) {
    return {
      ok: false,
      error: 'The Scum has no cards to exchange.'
    };
  }

  // Highest-ranked card in the Scum's hand.
  const scumCard = scum.hand.reduce(
    (best, card) =>
      card.rank > best.rank ? card : best
  );

  // Remove the selected President card.
  president.hand.splice(
    president.hand.indexOf(presidentCard),
    1
  );

  // Remove the Scum's best card.
  scum.hand.splice(
    scum.hand.indexOf(scumCard),
    1
  );

  // Exchange the cards.
  president.hand.push(scumCard);
  scum.hand.push(presidentCard);

  sortHand(president.hand);
  sortHand(scum.hand);

  return {
    ok: true,

    completed: true,

    president: {
      id: president.id,
      name: president.name,
      gave: presidentCard,
      received: scumCard
    },

    scum: {
      id: scum.id,
      name: scum.name,
      gave: scumCard,
      received: presidentCard
    }
  };
}

/*
 * First round:
 * there is no President yet, so choose a random starter.
 */
function startFirstRound(game) {
  const starterIndex =
    Math.floor(
      Math.random() * game.players.length
    );

  dealRound(game, starterIndex);
}

/*
 * Later rounds:
 * the President starts.
 *
 * The new round is dealt first. Then the game enters the
 * exchange phase so the President can choose one card.
 */
function startNextRound(game) {
  const presidentIndex =
    game.players.findIndex(
      p => p.finishPosition === 1
    );

  if (presidentIndex < 0) {
    throw new Error('No President found.');
  }

  const scumIndex =
    game.players.findIndex(
      p => p.finishPosition === game.players.length
    );

  if (scumIndex < 0) {
    throw new Error('No Scum found.');
  }

  // Deal without performing an automatic exchange.
  dealRound(game, presidentIndex);

  game.phase = 'exchange';
  game.turnIndex = null;

  game.exchange = {
    completed: false,

    president: {
      id: game.players[presidentIndex].id,
      name: game.players[presidentIndex].name
    },

    scum: {
      id: game.players[scumIndex].id,
      name: game.players[scumIndex].name
    }
  };

  game.message =
    `${game.players[presidentIndex].name} must choose a card to give the Scum.`;
}

/*
 * Perform the President's selected-card exchange.
 */
function performExchange(game, presidentCardId) {
  if (game.phase !== 'exchange') {
    return {
      ok: false,
      error: 'It is not currently the exchange phase.'
    };
  }

  if (game.exchange?.completed) {
    return {
      ok: false,
      error: 'The exchange has already been completed.'
    };
  }

  const presidentIndex =
    game.players.findIndex(
      p => p.id === game.exchange?.president?.id
    );

  const scumIndex =
    game.players.findIndex(
      p => p.id === game.exchange?.scum?.id
    );

  if (
    presidentIndex < 0 ||
    scumIndex < 0
  ) {
    return {
      ok: false,
      error: 'Could not determine President and Scum.'
    };
  }

  const result =
    exchangePresidentScum(
      game,
      presidentIndex,
      scumIndex,
      presidentCardId
    );

  if (!result.ok) {
    return result;
  }

  game.exchange = result;

  game.message =
    `${result.president.name} and ${result.scum.name} exchanged cards.`;

  return {
    ok: true
  };
}

/*
 * Validate a proposed play.
 */
function validatePlay(game, playerIndex, cardIds) {
  if (game.phase !== 'playing') {
    return {
      ok: false,
      error: 'The game is not currently being played.'
    };
  }

  if (game.turnIndex !== playerIndex) {
    return {
      ok: false,
      error: 'It is not your turn.'
    };
  }

  if (
    !Array.isArray(cardIds) ||
    cardIds.length < 1
  ) {
    return {
      ok: false,
      error: 'Select at least one card.'
    };
  }

  if (
    new Set(cardIds).size !== cardIds.length
  ) {
    return {
      ok: false,
      error: 'You selected a card more than once.'
    };
  }

  const player = game.players[playerIndex];

  const selected =
    cardIds.map(id =>
      player.hand.find(card => card.id === id)
    );

  if (selected.some(card => !card)) {
    return {
      ok: false,
      error: 'You do not have one of those cards.'
    };
  }

  // All cards in a play must have the same rank.
  if (
    selected.some(
      card => card.rank !== selected[0].rank
    )
  ) {
    return {
      ok: false,
      error: 'All played cards must have the same rank.'
    };
  }

  // If there is an active play, match its card count.
  if (game.pileCount > 0) {
    if (selected.length !== game.pileCount) {
      return {
        ok: false,
        error:
          `You must play ${game.pileCount} card${
            game.pileCount > 1 ? 's' : ''
          }.`
      };
    }

    // The new rank must be higher.
    if (selected[0].rank <= game.pileRank) {
      return {
        ok: false,
        error:
          `You must play higher than ${rankName(game.pileRank)}.`
      };
    }
  }

  return {
    ok: true,
    selected
  };
}

/*
 * Play cards.
 *
 * IMPORTANT: game.pile is replaced with the latest play rather
 * than accumulating a history of every card played in the trick.
 */
function playCards(game, playerIndex, cardIds) {
  const result =
    validatePlay(
      game,
      playerIndex,
      cardIds
    );

  if (!result.ok) {
    return result;
  }

  const player = game.players[playerIndex];

  // The table shows ONLY the most recent play.
  game.pile = [];

  for (const card of result.selected) {
    player.hand.splice(
      player.hand.indexOf(card),
      1
    );

    game.pile.push(card);
  }

  game.pileRank =
    result.selected[0].rank;

  game.pileCount =
    result.selected.length;

  game.lastPlayerIndex =
    playerIndex;

  // A successful play resets the pass cycle.
  game.passed.clear();

  /*
   * Player has no cards left.
   * They have finished.
   */
  if (player.hand.length === 0) {
    player.finishPosition =
      game.finishOrder.length + 1;

    game.finishOrder.push(playerIndex);

    /*
     * Once all but one player have finished,
     * the final active player is automatically last.
     */
    if (
      game.finishOrder.length ===
      game.players.length - 1
    ) {
      const remaining = activeIndexes(game);

      if (remaining.length === 1) {
        const lastIndex = remaining[0];

        game.players[lastIndex].finishPosition =
          game.players.length;

        game.finishOrder.push(lastIndex);
      }

      game.phase = 'roundOver';
      game.turnIndex = null;

      game.message =
        `${player.name} finished. Round over!`;

      return {
        ok: true
      };
    }
  }

  game.turnIndex =
    nextActiveIndex(
      game,
      playerIndex
    );

  game.message =
    `${player.name} played ${
      result.selected.length
    } × ${
      rankName(result.selected[0].rank)
    }.`;

  return {
    ok: true
  };
}

/*
 * Pass.
 *
 * The last player who successfully played does NOT need to pass.
 * Once every other active player has passed, the trick is cleared.
 *
 * If the last player to play has already finished, the next active
 * player clockwise starts the new trick.
 */
function pass(game, playerIndex) {
  if (game.phase !== 'playing') {
    return {
      ok: false,
      error: 'The game is not currently being played.'
    };
  }

  if (game.turnIndex !== playerIndex) {
    return {
      ok: false,
      error: 'It is not your turn.'
    };
  }

  if (game.pileCount === 0) {
    return {
      ok: false,
      error: 'You cannot pass when starting a new trick.'
    };
  }

  game.passed.add(playerIndex);

  const active =
    activeIndexes(game);

  const lastPlayerIsActive =
    active.includes(game.lastPlayerIndex);

  const requiredPasses =
    active.length -
    (lastPlayerIsActive ? 1 : 0);

  /*
   * Everyone except the last player to play has passed.
   */
  if (game.passed.size >= requiredPasses) {
    const previous =
      game.lastPlayerIndex;

    // Clear the current play.
    game.pile = [];
    game.pileRank = null;
    game.pileCount = 0;
    game.passed.clear();

    /*
     * Normally the last player who played starts the
     * next trick and can play anything.
     */
    if (
      previous !== null &&
      game.players[previous]?.hand.length > 0
    ) {
      game.turnIndex = previous;

      game.message =
        `${game.players[previous].name} wins the trick and can play anything.`;
    } else {
      /*
       * The last player has finished. Find the next player
       * clockwise who still has cards.
       */
      game.turnIndex =
        nextActiveIndex(
          game,
          previous ?? playerIndex
        );

      if (game.turnIndex >= 0) {
        game.message =
          `${game.players[game.turnIndex].name} starts the new trick.`;
      }
    }
  } else {
    game.turnIndex =
      nextActiveIndex(
        game,
        playerIndex
      );

    game.message =
      `${game.players[playerIndex].name} passed.`;
  }

  return {
    ok: true
  };
}

function titleForPosition(position, playerCount) {
  if (position === 1) {
    return 'President';
  }

  if (position === playerCount) {
    return 'Scum';
  }

  if (position === 2) {
    return 'Vice President';
  }

  if (position === playerCount - 1) {
    return 'Vice Scum';
  }

  return `${position}th`;
}

/*
 * Send only information a particular player is allowed to see.
 */
function publicState(game, viewerId) {
  const viewer =
    game.players.find(
      p => p.id === viewerId
    );

  return {
    phase: game.phase,

    round: game.round,

    message: game.message,

    turnPlayerId:
      game.turnIndex === null
        ? null
        : game.players[game.turnIndex]?.id ?? null,

    pile:
      game.pile.map(c => ({
        id: c.id,
        rank: c.rank,
        suit: c.suit
      })),

    pileRank: game.pileRank,
    pileCount: game.pileCount,

    starterPlayerId:
      game.starterIndex === null
        ? null
        : game.players[game.starterIndex]?.id ?? null,

    players:
      game.players.map(p => ({
        id: p.id,
        name: p.name,
        cardCount: p.hand.length,
        finishPosition: p.finishPosition,

        title:
          p.finishPosition
            ? titleForPosition(
                p.finishPosition,
                game.players.length
              )
            : null
      })),

    yourHand:
      viewer?.hand ?? [],

    /*
     * Before the exchange is completed, no exchange cards are
     * exposed. After completion, everyone can see what was traded.
     */
    exchange:
      game.exchange
        ? {
            completed:
              game.exchange.completed === true,

            president: game.exchange.president
              ? {
                  id: game.exchange.president.id,
                  name: game.exchange.president.name,
                  ...(game.exchange.completed
                    ? {
                        gave: game.exchange.president.gave,
                        received:
                          game.exchange.president.received
                      }
                    : {})
                }
              : null,

            scum: game.exchange.scum
              ? {
                  id: game.exchange.scum.id,
                  name: game.exchange.scum.name,
                  ...(game.exchange.completed
                    ? {
                        gave: game.exchange.scum.gave,
                        received:
                          game.exchange.scum.received
                      }
                    : {})
                }
              : null
          }
        : null,

    canStart:
      game.phase === 'lobby' &&
      game.players.length >= 3,

    roundResults:
      game.phase === 'roundOver'
        ? game.finishOrder.map(i => ({
            id: game.players[i].id,
            name: game.players[i].name,
            position:
              game.players[i].finishPosition,
            title:
              titleForPosition(
                game.players[i].finishPosition,
                game.players.length
              )
          }))
        : []
  };
}

module.exports = {
  createGame,
  startFirstRound,
  startNextRound,
  performExchange,
  playCards,
  pass,
  publicState
};
