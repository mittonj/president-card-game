const socket = io();

let roomCode =
  localStorage.getItem(
    'presidentRoom'
  ) || '';

let playerId =
  localStorage.getItem(
    'presidentPlayerId'
  ) || '';

let state = null;

let selected =
  new Set();

let exchangeSelectedId = null;

const $ = id =>
  document.getElementById(id);

function show(id, visible) {
  const element = $(id);

  if (element) {
    element.classList.toggle(
      'hidden',
      !visible
    );
  }
}

function error(message) {
  $('homeError').textContent =
    message || '';
}

function name() {
  return $('nameInput')
    .value
    .trim();
}

/*
 * CREATE ROOM
 */
$('createBtn').onclick = () => {
  error('');

  socket.emit(
    'createRoom',
    {
      name: name(),
      playerId
    }
  );
};

/*
 * JOIN ROOM
 */
$('joinBtn').onclick = () => {
  error('');

  socket.emit(
    'joinRoom',
    {
      name: name(),
      roomCode:
        $('roomInput').value,
      playerId
    }
  );
};

/*
 * START GAME
 */
$('startBtn').onclick = () => {
  socket.emit(
    'startGame',
    {
      roomCode,
      playerId
    }
  );
};

/*
 * PLAY CARDS
 */
$('playBtn').onclick = () => {
  socket.emit(
    'playCards',
    {
      roomCode,
      playerId,
      cardIds: [...selected]
    }
  );
};

/*
 * PASS
 */
$('passBtn').onclick = () => {
  socket.emit(
    'pass',
    {
      roomCode,
      playerId
    }
  );
};

/*
 * NEXT ROUND
 */
$('nextRoundBtn').onclick = () => {
  socket.emit(
    'nextRound',
    {
      roomCode,
      playerId
    }
  );
};
/*
 * Continue after the exchange.
 * Only the President will see this enabled.
 */
$('continueExchangeBtn').onclick = () => {
  socket.emit(
    'continueExchange',
    {
      roomCode,
      playerId
    }
  );
};

/*
 * LEAVE GAME
 */
$('leaveBtn').onclick = () => {
  const confirmed =
    confirm(
      'Are you sure you want to leave the game?'
    );

  if (!confirmed) {
    return;
  }

  socket.emit(
    'leaveRoom',
    {
      roomCode,
      playerId
    }
  );
};

/*
 * Server tells us that we successfully
 * joined/rejoined a room.
 */
socket.on(
  'joined',
  data => {
    roomCode =
      data.roomCode;

    playerId =
      data.playerId;

    localStorage.setItem(
      'presidentRoom',
      roomCode
    );

    localStorage.setItem(
      'presidentPlayerId',
      playerId
    );

    $('roomCode')
      .textContent =
      roomCode;

    $('roomInput')
      .value =
      roomCode;

    show(
      'home',
      false
    );

    show(
      'game',
      true
    );
  }
);

/*
 * Successfully left a room.
 * Return to the main screen.
 */
socket.on(
  'leftRoom',
  () => {
    localStorage.removeItem(
      'presidentRoom'
    );

    localStorage.removeItem(
      'presidentPlayerId'
    );

    roomCode = '';
    playerId = '';
    state = null;
    selected.clear();
    exchangeSelectedId = null;

    $('nameInput').value = '';
    $('roomInput').value = '';
    $('roomCode').textContent = '';

    show(
      'game',
      false
    );

    show(
      'home',
      true
    );

    error('');
  }
);

/*
 * Receive updated game state.
 */
socket.on(
  'state',
  nextState => {
    state =
      nextState;

    selected.clear();
    exchangeSelectedId = null;

    render();
  }
);

/*
 * Errors from server.
 */
socket.on(
  'errorMessage',
  message => {
    error(message);

    if (state) {
      $('message')
        .textContent =
        message;
    }
  }
);

/*
 * Socket.IO automatically reconnects.
 * When it reconnects, try to rejoin.
 */
socket.on(
  'connect',
  () => {
    if (
      roomCode &&
      playerId
    ) {
      socket.emit(
        'rejoinRoom',
        {
          roomCode,
          playerId
        }
      );
    }
  }
);

/*
 * Render everything.
 */
function render() {
  if (!state) {
    return;
  }

  $('status')
    .textContent =
      state.phase === 'playing'
        ? `Round ${state.round}`
        : state.phase;

  renderLobby();

  if (
    state.phase !== 'lobby'
  ) {
    renderGame();
  } else {
    show('playArea', false);
  }
}

/*
 * Lobby
 */
function renderLobby() {
  show(
    'lobby',
    state.phase === 'lobby'
  );

  if (
    state.phase !== 'lobby'
  ) {
    return;
  }

  $('lobbyPlayers')
    .innerHTML =
      state.players
        .map(
          (p, i) => `
            <div class="player ${
              p.id === playerId
                ? 'me'
                : ''
            }">
              <div class="name">
                ${escapeHtml(p.name)}
                ${
                  i === 0
                    ? ' 👑'
                    : ''
                }
              </div>

              <div class="meta">
                ${
                  i === 0
                    ? 'Room creator'
                    : 'Joined'
                }
              </div>
            </div>
          `
        )
        .join('');

  $('lobbyMessage')
    .textContent =
      `${state.players.length}/4 players. ${
        state.players.length >= 3
          ? 'Ready to start.'
          : 'Need at least 3 players.'
      }`;

  show(
    'startBtn',
    state.canStart &&
    state.players[0]?.id === playerId
  );
}

/*
 * Main game screen.
 */
function renderGame() {
  show(
    'playArea',
    true
  );

  /*
   * Players
   */
  $('players')
    .innerHTML =
      state.players
        .map(p => {
          const isCurrent =
            p.id ===
            state.turnPlayerId;

          const title =
            p.title
              ? ` · ${p.title}`
              : '';

          const position =
            p.finishPosition
              ? ` · #${p.finishPosition}`
              : '';

          return `
            <div class="player
              ${isCurrent ? 'current' : ''}
              ${p.id === playerId ? 'me' : ''}
            ">
              <div class="name">
                ${escapeHtml(p.name)}
                ${
                  p.id === playerId
                    ? ' (you)'
                    : ''
                }
              </div>

              <div class="meta">
                ${p.cardCount}
                card${
                  p.cardCount === 1
                    ? ''
                    : 's'
                }

                ${title}
                ${position}
              </div>
            </div>
          `;
        })
        .join('');

  /*
   * Current play.
   *
   * This is ONLY the latest play, not a history.
   */
  if (state.pile.length === 0) {
    $('pile').innerHTML = '—';
  } else {
    $('pile').innerHTML =
      state.pile
        .map(card => renderPlayedCard(card))
        .join('');
  }

  $('message')
    .textContent =
      state.message || '';

  /*
   * Turn text.
   */
  $('turnText')
    .textContent =
      state.phase === 'playing'
        ? (
            state.turnPlayerId === playerId
              ? 'YOUR TURN'
              : `Waiting for ${
                  playerName(
                    state.turnPlayerId
                  )
                }...`
          )
        : '';

  renderRoundResults();

  const myPlayer =
    state.players.find(
      p => p.id === playerId
    );

  show(
    'nextRoundBtn',
    state.phase === 'roundOver' &&
    myPlayer?.finishPosition === 1
  );

  /*
   * Normal hand controls are visible only
   * during actual play.
   */
  show(
    'handPanel',
    state.phase === 'playing'
  );

  if (
    state.phase === 'playing'
  ) {
    renderHand();
    hideExchange();
  } else if (
    state.phase === 'exchange'
  ) {
    renderExchange();
  } else {
    hideExchange();
    hideExchangeHand();
  }
}

/*
 * Render the player's normal hand.
 */
function renderHand() {
  $('hand')
    .innerHTML =
      state.yourHand
        .map(card => {
          const isSelected =
            selected.has(card.id);

          return `
            <button
              class="card ${
                isSelected
                  ? 'selected'
                  : ''
              } ${
                isRed(card.suit)
                  ? 'red'
                  : ''
              }"
              data-id="${card.id}"
            >
              ${rankName(card.rank)}
              ${card.suit}
            </button>
          `;
        })
        .join('');

  document
    .querySelectorAll('#hand .card')
    .forEach(button => {
      button.onclick = () => {
        const id =
          button.dataset.id;

        if (selected.has(id)) {
          selected.delete(id);
        } else {
          selected.add(id);
        }

        renderHand();
      };
    });

  const myTurn =
    state.turnPlayerId ===
    playerId;

  $('playBtn').disabled =
    !myTurn ||
    selected.size === 0;

  $('passBtn').disabled =
    !myTurn ||
    state.pileCount === 0;
}

/*
 * President/Scum exchange UI.
 */
function renderExchange() {
  show(
    'exchangePanel',
    true
  );

  const exchange =
    state.exchange;

  if (!exchange) {
    return;
  }

  const isPresident =
    exchange.president?.id ===
    playerId;

  /*
   * Exchange has not happened yet.
   */
  if (!exchange.completed) {
    $('exchangePanel')
      .innerHTML = `
        <h2>
          Round ${state.round}
        </h2>

        <h3>
          President / Scum Exchange
        </h3>

        <p>
          👑
          <strong>
            ${escapeHtml(exchange.president.name)}
          </strong>
          — choose ONE card to give the Scum.
        </p>

        <p>
          💀
          ${escapeHtml(exchange.scum.name)}
          will automatically give you their
          highest-ranked card.
        </p>
      `;

    show(
      'continueExchangeBtn',
      false
    );

    if (isPresident) {
      renderExchangeHand();
    } else {
      hideExchangeHand();
    }

    return;
  }

  /*
   * Exchange is complete.
   */
  hideExchangeHand();

  $('exchangePanel')
    .innerHTML = `
      <h2>
        Round ${state.round}
      </h2>

      <h3>
        Exchange complete
      </h3>

      <div class="exchange">
        <div class="exchange-player">
          <strong>
            👑
            ${escapeHtml(exchange.president.name)}
          </strong>

          <div>Gave:</div>
          ${renderPlayedCard(
            exchange.president.gave
          )}

          <div>Received:</div>
          ${renderPlayedCard(
            exchange.president.received
          )}
        </div>

        <div class="exchange-arrow">
          ⇄
        </div>

        <div class="exchange-player">
          <strong>
            💀
            ${escapeHtml(exchange.scum.name)}
          </strong>

          <div>Gave:</div>
          ${renderPlayedCard(
            exchange.scum.gave
          )}

          <div>Received:</div>
          ${renderPlayedCard(
            exchange.scum.received
          )}
        </div>
      </div>

      ${
        isPresident
          ? '<p>You can now start the round.</p>'
          : `<p>Waiting for ${escapeHtml(
              exchange.president.name
            )} to start the round...</p>`
      }
    `;

  show(
    'continueExchangeBtn',
    isPresident
  );
}

function renderExchangeHand() {
  let existing =
    document.getElementById(
      'exchangeHand'
    );

  if (!existing) {
    existing =
      document.createElement(
        'div'
      );

    existing.id =
      'exchangeHand';

    existing.className =
      'panel';

    $('playArea')
      .insertBefore(
        existing,
        $('roundResults')
      );
  }

  existing.innerHTML = `
    <h3>
      Choose ONE card to give the Scum
    </h3>

    <div class="hand exchange-hand">
      ${
        state.yourHand
          .map(
            card => `
              <button
                class="card exchange-select-card ${
                  exchangeSelectedId === card.id
                    ? 'selected'
                    : ''
                } ${
                  isRed(card.suit)
                    ? 'red'
                    : ''
                }"
                data-id="${card.id}"
              >
                ${rankName(card.rank)}
                ${card.suit}
              </button>
            `
          )
          .join('')
      }
    </div>

    <div class="actions">
      <button
        id="giveCardBtnInternal"
        ${exchangeSelectedId ? '' : 'disabled'}
      >
        Give selected card
      </button>
    </div>
  `;

  existing
    .querySelectorAll(
      '.exchange-select-card'
    )
    .forEach(button => {
      button.onclick = () => {
        exchangeSelectedId =
          button.dataset.id;

        renderExchangeHand();
      };
    });

  $('giveCardBtnInternal').onclick = () => {
    if (!exchangeSelectedId) {
      return;
    }

    socket.emit(
      'exchangeCard',
      {
        roomCode,
        playerId,
        cardId:
          exchangeSelectedId
      }
    );
  };
}

function hideExchangeHand() {
  const hand =
    document.getElementById(
      'exchangeHand'
    );

  if (hand) {
    hand.remove();
  }

  exchangeSelectedId = null;
}

function hideExchange() {
  show(
    'exchangePanel',
    false
  );

  show(
    'continueExchangeBtn',
    false
  );
}

/*
 * Render a card as an actual playing card.
 */
function renderPlayedCard(card) {
  if (!card) {
    return '';
  }

  return `
    <div class="played-card ${
      isRed(card.suit)
        ? 'red'
        : ''
    }">
      <div class="played-card-rank">
        ${rankName(card.rank)}
      </div>

      <div class="played-card-suit">
        ${card.suit}
      </div>
    </div>
  `;
}

/*
 * Round results.
 */
function renderRoundResults() {
  show(
    'roundResults',
    state.phase === 'roundOver'
  );

  if (
    state.phase !== 'roundOver'
  ) {
    return;
  }

  $('roundResults')
    .innerHTML = `
      <h2>
        Round over
      </h2>

      ${
        state.roundResults
          .map(
            r => `
              <div>
                #${r.position}
                —
                <strong>
                  ${escapeHtml(r.name)}
                </strong>
                —
                ${r.title}
              </div>
            `
          )
          .join('')
      }
    `;
}

/*
 * Find a player name.
 */
function playerName(id) {
  return (
    state.players.find(
      p => p.id === id
    )?.name ||
    'player'
  );
}

/*
 * Convert rank number to display value.
 */
function rankName(value) {
  return {
    3: '3',
    4: '4',
    5: '5',
    6: '6',
    7: '7',
    8: '8',
    9: '9',
    10: '10',
    11: 'J',
    12: 'Q',
    13: 'K',
    14: 'A',
    15: '2'
  }[value] || '?';
}

/*
 * Red suits.
 */
function isRed(suit) {
  return (
    suit === '♥' ||
    suit === '♦'
  );
}

/*
 * Prevent player names from injecting HTML.
 */
function escapeHtml(value) {
  return String(value)
    .replace(
      /[&<>'"]/g,
      c =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          "'": '&#39;',
          '"': '&quot;'
        }[c])
    );
}

/*
 * If the browser already knows about a room,
 * try to reconnect.
 */
if (
  roomCode &&
  playerId
) {
  $('roomInput')
    .value =
    roomCode;

  socket.emit(
    'rejoinRoom',
    {
      roomCode,
      playerId
    }
  );
}
