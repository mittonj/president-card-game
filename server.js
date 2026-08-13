const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { randomBytes } = require('crypto');

const {
  createGame,
  startFirstRound,
  startNextRound,
  performExchange,
  playCards,
  pass,
  publicState
} = require('./game');

const app = express();

const server =
  http.createServer(app);

const io =
  new Server(server);

// Render supplies PORT.
// Locally we'll use 10000.
const PORT =
  process.env.PORT || 10000;

// All active rooms live here.
const rooms = new Map();

app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);

// Simple health check.
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size
  });
});

/*
 * Generate a room code such as:
 * A1F3C2
 */
function makeRoomCode() {
  let code;

  do {
    code =
      randomBytes(3)
        .toString('hex')
        .toUpperCase();
  } while (rooms.has(code));

  return code;
}

/*
 * Keep names reasonably short.
 */
function cleanName(name) {
  return String(name || '')
    .trim()
    .slice(0, 20);
}

/*
 * Send each player the version of the game state
 * they are allowed to see.
 */
function emitRoom(roomCode) {
  const room =
    rooms.get(roomCode);

  if (!room) {
    return;
  }

  for (const player of room.players) {
    io.to(player.socketId).emit(
      'state',
      publicState(
        room.game,
        player.id
      )
    );
  }
}

/*
 * Find a player in a room.
 */
function findPlayer(roomCode, playerId) {
  const room =
    rooms.get(roomCode);

  if (!room) {
    return null;
  }

  const player =
    room.players.find(
      p => p.id === playerId
    );

  return player
    ? { room, player }
    : null;
}

io.on('connection', socket => {
  /*
   * CREATE ROOM
   */
  socket.on(
    'createRoom',
    ({ name, playerId }) => {
      name = cleanName(name);

      if (!name) {
        return socket.emit(
          'errorMessage',
          'Enter your name.'
        );
      }

      const id =
        playerId ||
        randomBytes(8)
          .toString('hex');

      const roomCode =
        makeRoomCode();

      const player = {
        id,
        name,
        socketId: socket.id
      };

      const game =
        createGame([
          {
            id,
            name
          }
        ]);

      const room = {
        code: roomCode,
        game,
        players: [player]
      };

      rooms.set(
        roomCode,
        room
      );

      socket.join(roomCode);

      socket.emit(
        'joined',
        {
          roomCode,
          playerId: id
        }
      );

      emitRoom(roomCode);
    }
  );

  /*
   * JOIN ROOM
   */
  socket.on(
    'joinRoom',
    ({ roomCode, name, playerId }) => {
      roomCode =
        String(roomCode || '')
          .trim()
          .toUpperCase();

      name = cleanName(name);

      if (!name) {
        return socket.emit(
          'errorMessage',
          'Enter your name.'
        );
      }

      const room =
        rooms.get(roomCode);

      if (!room) {
        return socket.emit(
          'errorMessage',
          'Room not found.'
        );
      }

      /*
       * If this player already exists,
       * reconnect them.
       */
      const existing =
        playerId
          ? room.players.find(
              p => p.id === playerId
            )
          : null;

      if (existing) {
        existing.socketId =
          socket.id;

        existing.name =
          name;

        const gamePlayer =
          room.game.players.find(
            p => p.id === existing.id
          );

        if (gamePlayer) {
          gamePlayer.name = name;
        }

        socket.join(roomCode);

        socket.emit(
          'joined',
          {
            roomCode,
            playerId: existing.id
          }
        );

        emitRoom(roomCode);
        return;
      }

      if (
        room.game.phase !== 'lobby'
      ) {
        return socket.emit(
          'errorMessage',
          'This game has already started.'
        );
      }

      // Four players maximum.
      if (
        room.players.length >= 4
      ) {
        return socket.emit(
          'errorMessage',
          'This room is full.'
        );
      }

      const id =
        playerId ||
        randomBytes(8)
          .toString('hex');

      room.players.push({
        id,
        name,
        socketId: socket.id
      });

      room.game.players.push({
        id,
        name,
        hand: [],
        finishPosition: null
      });

      socket.join(roomCode);

      socket.emit(
        'joined',
        {
          roomCode,
          playerId: id
        }
      );

      emitRoom(roomCode);
    }
  );

  /*
   * RECONNECT
   *
   * Useful if someone refreshes their browser.
   */
  socket.on(
    'rejoinRoom',
    ({ roomCode, playerId }) => {
      const found =
        findPlayer(
          String(roomCode || '')
            .toUpperCase(),
          playerId
        );

      if (!found) {
        return socket.emit(
          'errorMessage',
          'Could not reconnect to that game.'
        );
      }

      found.player.socketId =
        socket.id;

      socket.join(
        found.room.code
      );

      socket.emit(
        'joined',
        {
          roomCode: found.room.code,
          playerId: found.player.id
        }
      );

      emitRoom(
        found.room.code
      );
    }
  );

  /*
   * PRESIDENT CHOOSES CARD TO GIVE SCUM
   */
  socket.on(
    'exchangeCard',
    ({
      roomCode,
      playerId,
      cardId
    }) => {
      const found =
        findPlayer(
          String(roomCode || '')
            .toUpperCase(),
          playerId
        );

      if (!found) {
        return socket.emit(
          'errorMessage',
          'Room not found.'
        );
      }

      const {
        room,
        player
      } = found;

      if (
        room.game.phase !== 'exchange'
      ) {
        return socket.emit(
          'errorMessage',
          'It is not currently the exchange phase.'
        );
      }

      const president =
        room.game.exchange?.president;

      if (
        !president ||
        president.id !== player.id
      ) {
        return socket.emit(
          'errorMessage',
          'Only the President can choose the card.'
        );
      }

      const result =
        performExchange(
          room.game,
          cardId
        );

      if (!result.ok) {
        return socket.emit(
          'errorMessage',
          result.error
        );
      }

      emitRoom(
        room.code
      );
    }
  );

  /*
   * CONTINUE AFTER EXCHANGE
   *
   * Only the President can click Continue,
   * and only after the exchange is complete.
   */
  socket.on(
    'continueExchange',
    ({
      roomCode,
      playerId
    }) => {
      const found =
        findPlayer(
          String(roomCode || '')
            .toUpperCase(),
          playerId
        );

      if (!found) {
        return socket.emit(
          'errorMessage',
          'Room not found.'
        );
      }

      const {
        room,
        player
      } = found;

      if (
        room.game.phase !== 'exchange'
      ) {
        return;
      }

      if (
        !room.game.exchange?.completed
      ) {
        return socket.emit(
          'errorMessage',
          'The President must choose a card first.'
        );
      }

      if (
        room.game.exchange.president.id !==
        player.id
      ) {
        return socket.emit(
          'errorMessage',
          'Only the President can continue.'
        );
      }

      const presidentIndex =
        room.game.players.findIndex(
          p => p.id === player.id
        );

      room.game.phase =
        'playing';

      room.game.turnIndex =
        presidentIndex;

      room.game.starterIndex =
        presidentIndex;

      room.game.message =
        `${player.name} starts the round.`;

      emitRoom(
        room.code
      );
    }
  );

  /*
   * START GAME
   */
  socket.on(
    'startGame',
    ({ roomCode, playerId }) => {
      const found =
        findPlayer(
          String(roomCode || '')
            .toUpperCase(),
          playerId
        );

      if (!found) {
        return socket.emit(
          'errorMessage',
          'Room not found.'
        );
      }

      const {
        room,
        player
      } = found;

      if (
        room.game.players.length < 3
      ) {
        return socket.emit(
          'errorMessage',
          'At least 3 players are required.'
        );
      }

      // First player is room creator.
      if (
        room.game.players[0].id !==
        player.id
      ) {
        return socket.emit(
          'errorMessage',
          'Only the room creator can start the game.'
        );
      }

      if (
        room.game.phase !== 'lobby'
      ) {
        return;
      }

      startFirstRound(
        room.game
      );

      emitRoom(
        room.code
      );
    }
  );

  /*
   * PLAY CARDS
   */
  socket.on(
    'playCards',
    ({
      roomCode,
      playerId,
      cardIds
    }) => {
      const found =
        findPlayer(
          String(roomCode || '')
            .toUpperCase(),
          playerId
        );

      if (!found) {
        return socket.emit(
          'errorMessage',
          'Room not found.'
        );
      }

      const index =
        found.room.game.players.findIndex(
          p => p.id === playerId
        );

      const result =
        playCards(
          found.room.game,
          index,
          cardIds
        );

      if (!result.ok) {
        return socket.emit(
          'errorMessage',
          result.error
        );
      }

      emitRoom(
        found.room.code
      );
    }
  );

  /*
   * PASS
   */
  socket.on(
    'pass',
    ({
      roomCode,
      playerId
    }) => {
      const found =
        findPlayer(
          String(roomCode || '')
            .toUpperCase(),
          playerId
        );

      if (!found) {
        return socket.emit(
          'errorMessage',
          'Room not found.'
        );
      }

      const index =
        found.room.game.players.findIndex(
          p => p.id === playerId
        );

      const result =
        pass(
          found.room.game,
          index
        );

      if (!result.ok) {
        return socket.emit(
          'errorMessage',
          result.error
        );
      }

      emitRoom(
        found.room.code
      );
    }
  );

  /*
   * NEXT ROUND
   *
   * Only the President can start the next round.
   */
  socket.on(
    'nextRound',
    ({
      roomCode,
      playerId
    }) => {
      const found =
        findPlayer(
          String(roomCode || '')
            .toUpperCase(),
          playerId
        );

      if (!found) {
        return socket.emit(
          'errorMessage',
          'Room not found.'
        );
      }

      const { room } =
        found;

      if (
        room.game.phase !==
        'roundOver'
      ) {
        return;
      }

      const playerIndex =
        room.game.players.findIndex(
          p => p.id === playerId
        );

      if (
        room.game.players[playerIndex]
          ?.finishPosition !== 1
      ) {
        return socket.emit(
          'errorMessage',
          'Only the President can start the next round.'
        );
      }

      try {
        startNextRound(
          room.game
        );
      } catch (error) {
        return socket.emit(
          'errorMessage',
          error.message
        );
      }

      emitRoom(
        room.code
      );
    }
  );

  /*
   * LEAVE GAME
   *
   * Leaving deliberately removes the player.
   * Refreshing/disconnecting does NOT remove them.
   */
  socket.on(
    'leaveRoom',
    ({ roomCode, playerId }) => {
      roomCode =
        String(roomCode || '')
          .trim()
          .toUpperCase();

      const room =
        rooms.get(roomCode);

      if (!room) {
        socket.emit(
          'leftRoom'
        );
        return;
      }

      const playerIndex =
        room.players.findIndex(
          p => p.id === playerId
        );

      if (playerIndex === -1) {
        socket.emit(
          'leftRoom'
        );
        return;
      }

      const player =
        room.players[playerIndex];

      /*
       * Remove the player from the room list.
       */
      room.players.splice(
        playerIndex,
        1
      );

      /*
       * Remove the same player from the game list.
       */
      const gamePlayerIndex =
        room.game.players.findIndex(
          p => p.id === playerId
        );

      if (gamePlayerIndex !== -1) {
        room.game.players.splice(
          gamePlayerIndex,
          1
        );
      }

      socket.leave(roomCode);

      socket.emit(
        'leftRoom'
      );

      /*
       * If nobody remains, delete the room.
       */
      if (
        room.players.length === 0
      ) {
        rooms.delete(
          roomCode
        );
        return;
      }

      /*
       * If someone leaves during the lobby,
       * simply update everyone.
       */
      if (
        room.game.phase === 'lobby'
      ) {
        room.game.message =
          `${player.name} left the room.`;

        emitRoom(
          roomCode
        );

        return;
      }

      /*
       * If someone leaves after the game has started,
       * reset the remaining players to a fresh lobby.
       *
       * This avoids corrupting turn/finish indexes.
       */
      room.game.phase = 'lobby';

      room.game.pile = [];
      room.game.pileRank = null;
      room.game.pileCount = 0;
      room.game.lastPlayerIndex = null;
      room.game.turnIndex = null;
      room.game.starterIndex = null;
      room.game.passed.clear();
      room.game.finishOrder = [];
      room.game.round = 0;
      room.game.exchange = null;

      room.game.players.forEach(p => {
        p.hand = [];
        p.finishPosition = null;
      });

      room.game.message =
        `${player.name} left the game. The game has been reset.`;

      emitRoom(
        roomCode
      );
    }
  );

  /*
   * We deliberately DON'T delete the player when
   * they disconnect. This lets someone refresh their
   * phone and reconnect to the game.
   */
  socket.on(
    'disconnect',
    () => {}
  );
});

server.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `President server listening on port ${PORT}`
    );
  }
);
