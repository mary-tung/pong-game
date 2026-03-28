const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 5000,
});

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// --- Constants ---
const CANVAS_W = 400;
const CANVAS_H = 600;
const PADDLE_W = 80;
const PADDLE_H = 14;
const PADDLE_MARGIN = 20;
const BALL_R = 8;
const WIN_SCORE = 5;
const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;

// --- State ---
const waitingQueue = []; // { socketId, name }
const rooms = {};        // roomId -> room state

function createRoom(id, p1, p2) {
  return {
    id,
    players: {
      top: { id: p1.socketId, name: p1.name, x: CANVAS_W / 2 },
      bottom: { id: p2.socketId, name: p2.name, x: CANVAS_W / 2 },
    },
    ball: resetBall(),
    scores: { top: 0, bottom: 0 },
    state: 'playing', // playing | finished
    interval: null,
    isAI: p2.isAI || false,
    tickCount: 0, // used to halve broadcast rate
  };
}

function resetBall() {
  const angle = (Math.random() * Math.PI / 3) - Math.PI / 6; // -30 to +30 deg
  const direction = Math.random() < 0.5 ? 1 : -1;
  const speed = 4;
  return {
    x: CANVAS_W / 2,
    y: CANVAS_H / 2,
    vx: Math.sin(angle) * speed,
    vy: Math.cos(angle) * speed * direction,
  };
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// --- AI Logic ---
// AI picks a target and smoothly moves toward it each frame
function updateAI(room) {
  const ball = room.ball;
  const aiPaddle = room.players.top;

  // Pick a new target every ~40 frames (adds slight human-like reaction delay)
  if (!room.aiTarget || room.aiTickCount % 40 === 0) {
    // Predict where ball will be when it reaches the AI's y-level
    let targetX = ball.x;
    if (ball.vy < 0) {
      // Ball heading toward AI — predict intercept
      const timeToReach = (ball.y - (PADDLE_MARGIN + PADDLE_H)) / (-ball.vy);
      targetX = ball.x + ball.vx * timeToReach;
      // Simulate wall bounces for prediction
      while (targetX < 0 || targetX > CANVAS_W) {
        if (targetX < 0) targetX = -targetX;
        if (targetX > CANVAS_W) targetX = 2 * CANVAS_W - targetX;
      }
    } else {
      // Ball heading away — drift toward center
      targetX = CANVAS_W / 2;
    }
    // Add slight inaccuracy (±15px) so AI isn't perfect
    room.aiTarget = targetX + (Math.random() - 0.5) * 30;
  }
  room.aiTickCount = (room.aiTickCount || 0) + 1;

  // Smooth movement toward target using lerp
  const lerpSpeed = 0.08; // lower = smoother/slower
  aiPaddle.x += (room.aiTarget - aiPaddle.x) * lerpSpeed;
  aiPaddle.x = clamp(aiPaddle.x, PADDLE_W / 2, CANVAS_W - PADDLE_W / 2);
}

// --- Game Loop ---
function tick(room) {
  if (room.state !== 'playing') return;

  const ball = room.ball;
  const top = room.players.top;
  const bottom = room.players.bottom;

  if (room.isAI) updateAI(room);

  // Move ball
  ball.x += ball.vx;
  ball.y += ball.vy;

  // Wall bounce (left/right)
  if (ball.x - BALL_R <= 0) {
    ball.x = BALL_R;
    ball.vx = Math.abs(ball.vx);
  } else if (ball.x + BALL_R >= CANVAS_W) {
    ball.x = CANVAS_W - BALL_R;
    ball.vx = -Math.abs(ball.vx);
  }

  // Paddle collision — top paddle
  const topPaddleY = PADDLE_MARGIN + PADDLE_H;
  if (ball.vy < 0 && ball.y - BALL_R <= topPaddleY && ball.y - BALL_R >= PADDLE_MARGIN) {
    if (ball.x >= top.x - PADDLE_W / 2 && ball.x <= top.x + PADDLE_W / 2) {
      ball.y = topPaddleY + BALL_R;
      const offset = (ball.x - top.x) / (PADDLE_W / 2); // -1 to 1
      ball.vx = offset * 4;
      ball.vy = Math.abs(ball.vy) * 1.02; // slight speed increase
      ball.vy = Math.min(ball.vy, 8);
    }
  }

  // Paddle collision — bottom paddle
  const bottomPaddleY = CANVAS_H - PADDLE_MARGIN - PADDLE_H;
  if (ball.vy > 0 && ball.y + BALL_R >= bottomPaddleY && ball.y + BALL_R <= CANVAS_H - PADDLE_MARGIN) {
    if (ball.x >= bottom.x - PADDLE_W / 2 && ball.x <= bottom.x + PADDLE_W / 2) {
      ball.y = bottomPaddleY - BALL_R;
      const offset = (ball.x - bottom.x) / (PADDLE_W / 2);
      ball.vx = offset * 4;
      ball.vy = -Math.abs(ball.vy) * 1.02;
      ball.vy = Math.max(ball.vy, -8);
    }
  }

  // Score — ball passes top
  var scored = false;
  if (ball.y - BALL_R <= 0) {
    room.scores.bottom++;
    scored = true;
    if (room.scores.bottom >= WIN_SCORE) {
      room.state = 'finished';
      broadcastState(room);
      endGame(room);
      return;
    }
    Object.assign(ball, resetBall());
    ball.vy = Math.abs(ball.vy); // towards top after bottom scores
  }

  // Score — ball passes bottom
  if (ball.y + BALL_R >= CANVAS_H) {
    room.scores.top++;
    scored = true;
    if (room.scores.top >= WIN_SCORE) {
      room.state = 'finished';
      broadcastState(room);
      endGame(room);
      return;
    }
    Object.assign(ball, resetBall());
    ball.vy = -Math.abs(ball.vy); // towards bottom after top scores
  }

  // Broadcast at 30Hz (every other tick), or immediately on score
  room.tickCount++;
  if (scored || room.tickCount % 2 === 0) {
    broadcastState(room);
  }
}

function broadcastState(room) {
  const data = {
    ball: { x: room.ball.x, y: room.ball.y },
    paddles: {
      top: { x: room.players.top.x },
      bottom: { x: room.players.bottom.x },
    },
    scores: room.scores,
    state: room.state,
    names: {
      top: room.players.top.name,
      bottom: room.players.bottom.name,
    },
  };

  // Send to bottom player (they see the game as-is)
  const bottomSocket = io.sockets.sockets.get(room.players.bottom.id);
  if (bottomSocket) {
    bottomSocket.emit('gameState', { ...data, yourSide: 'bottom' });
  }

  // Send to top player (if not AI)
  if (!room.isAI) {
    const topSocket = io.sockets.sockets.get(room.players.top.id);
    if (topSocket) {
      topSocket.emit('gameState', { ...data, yourSide: 'top' });
    }
  }
}

function startGame(room) {
  room.interval = setInterval(() => tick(room), TICK_MS);
}

function endGame(room) {
  if (room.interval) {
    clearInterval(room.interval);
    room.interval = null;
  }
}

function cleanupRoom(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  endGame(room);
  delete rooms[roomId];
}

// --- Socket Handling ---
io.on('connection', (socket) => {
  let playerName = '';
  let currentRoom = null;

  socket.on('setName', (name) => {
    playerName = String(name).trim().slice(0, 12) || 'Player';
  });

  socket.on('findMatch', () => {
    // Remove from queue if already there
    const idx = waitingQueue.findIndex((p) => p.socketId === socket.id);
    if (idx !== -1) waitingQueue.splice(idx, 1);

    // Check for a waiting player
    while (waitingQueue.length > 0) {
      const opponent = waitingQueue.shift();
      const opponentSocket = io.sockets.sockets.get(opponent.socketId);
      if (opponentSocket && opponentSocket.connected) {
        // Match found!
        const roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const room = createRoom(
          roomId,
          { socketId: opponent.socketId, name: opponent.name },
          { socketId: socket.id, name: playerName }
        );
        rooms[roomId] = room;

        // Tell both players
        opponentSocket.emit('matchFound', { opponent: playerName, yourSide: 'top', roomId });
        socket.emit('matchFound', { opponent: opponent.name, yourSide: 'bottom', roomId });

        // Store room reference
        opponentSocket.data.currentRoom = roomId;
        socket.data.currentRoom = roomId;
        currentRoom = roomId;

        // Start after a brief countdown
        setTimeout(() => {
          if (rooms[roomId]) startGame(rooms[roomId]);
        }, 2000);
        return;
      }
    }

    // No match — add to queue
    waitingQueue.push({ socketId: socket.id, name: playerName });
    socket.emit('waiting');
  });

  socket.on('playAI', () => {
    // Remove from waiting queue
    const idx = waitingQueue.findIndex((p) => p.socketId === socket.id);
    if (idx !== -1) waitingQueue.splice(idx, 1);

    const roomId = `room_ai_${Date.now()}`;
    const room = createRoom(
      roomId,
      { socketId: 'AI', name: 'Robot' },
      { socketId: socket.id, name: playerName }
    );
    room.isAI = true;
    rooms[roomId] = room;

    socket.emit('matchFound', { opponent: 'Robot', yourSide: 'bottom', roomId });
    socket.data.currentRoom = roomId;
    currentRoom = roomId;

    setTimeout(() => {
      if (rooms[roomId]) startGame(rooms[roomId]);
    }, 2000);
  });

  socket.on('paddleMove', (x) => {
    const roomId = socket.data.currentRoom;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    const px = clamp(Number(x) || CANVAS_W / 2, PADDLE_W / 2, CANVAS_W - PADDLE_W / 2);
    if (room.players.bottom.id === socket.id) {
      room.players.bottom.x = px;
    } else if (room.players.top.id === socket.id) {
      room.players.top.x = px;
    }
  });

  socket.on('playAgain', () => {
    const roomId = socket.data.currentRoom;
    if (roomId) {
      cleanupRoom(roomId);
      socket.data.currentRoom = null;
    }
    socket.emit('goToLobby');
  });

  socket.on('disconnect', () => {
    // Remove from waiting queue
    const idx = waitingQueue.findIndex((p) => p.socketId === socket.id);
    if (idx !== -1) waitingQueue.splice(idx, 1);

    // Handle active game
    const roomId = socket.data.currentRoom;
    if (roomId && rooms[roomId]) {
      const room = rooms[roomId];
      if (room.state === 'playing') {
        room.state = 'finished';
        // Notify remaining player
        const otherId = room.players.top.id === socket.id
          ? room.players.bottom.id
          : room.players.top.id;
        if (otherId !== 'AI') {
          const otherSocket = io.sockets.sockets.get(otherId);
          if (otherSocket) {
            otherSocket.emit('opponentLeft');
          }
        }
      }
      cleanupRoom(roomId);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Pong server running on http://localhost:${PORT}`);
});
