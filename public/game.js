(function () {
  'use strict';

  // --- Constants ---
  var CANVAS_W = 400;
  var CANVAS_H = 600;
  var PADDLE_W = 80;
  var PADDLE_H = 14;
  var PADDLE_MARGIN = 20;
  var BALL_R = 8;

  // --- Elements ---
  var screens = {
    name: document.getElementById('screen-name'),
    lobby: document.getElementById('screen-lobby'),
    countdown: document.getElementById('screen-countdown'),
    game: document.getElementById('screen-game'),
    gameover: document.getElementById('screen-gameover'),
  };

  var nameInput = document.getElementById('name-input');
  var btnPlay = document.getElementById('btn-play');
  var btnAI = document.getElementById('btn-ai');
  var btnAgain = document.getElementById('btn-again');
  var matchInfo = document.getElementById('match-info');
  var countdownNumber = document.getElementById('countdown-number');
  var winnerText = document.getElementById('winner-text');
  var finalScore = document.getElementById('final-score');
  var canvas = document.getElementById('game-canvas');
  var ctx = canvas.getContext('2d');
  var connectionDot = document.getElementById('connection-dot');

  // --- State ---
  var socket = io({ transports: ['websocket', 'polling'] });
  var playerName = '';
  var yourSide = 'bottom';
  var gameState = null;
  var aiTimer = null;

  // --- Screen Management ---
  function showScreen(name) {
    for (var key in screens) {
      screens[key].classList.remove('active');
    }
    screens[name].classList.add('active');
  }

  // --- Name Screen ---
  btnPlay.addEventListener('click', submitName);
  nameInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') submitName();
  });

  function submitName() {
    var name = nameInput.value.trim().slice(0, 12);
    if (!name) {
      nameInput.focus();
      return;
    }
    playerName = name;
    socket.emit('setName', name);
    socket.emit('findMatch');
    showScreen('lobby');
    btnAI.style.display = 'none';
    clearTimeout(aiTimer);
    aiTimer = setTimeout(function () {
      btnAI.style.display = 'block';
    }, 3000);
  }

  // --- Lobby ---
  btnAI.addEventListener('click', function () {
    socket.emit('playAI');
  });

  socket.on('waiting', function () {
    showScreen('lobby');
    btnAI.style.display = 'none';
    clearTimeout(aiTimer);
    aiTimer = setTimeout(function () {
      btnAI.style.display = 'block';
    }, 3000);
  });

  socket.on('matchFound', function (data) {
    yourSide = data.yourSide;
    matchInfo.textContent = 'You vs ' + data.opponent;

    // Countdown
    showScreen('countdown');
    var count = 2;
    countdownNumber.textContent = count;
    var cdInterval = setInterval(function () {
      count--;
      if (count <= 0) {
        clearInterval(cdInterval);
        showScreen('game');
        resizeCanvas();
        return;
      }
      countdownNumber.textContent = count;
    }, 800);
  });

  // --- Canvas Sizing ---
  function resizeCanvas() {
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Scale so we draw in logical coords
    var scaleX = canvas.width / CANVAS_W;
    var scaleY = canvas.height / CANVAS_H;
    ctx.scale(scaleX, scaleY);
  }

  window.addEventListener('resize', function () {
    if (screens.game.classList.contains('active')) resizeCanvas();
  });

  // --- Touch Input ---
  function handleTouch(e) {
    if (!screens.game.classList.contains('active')) return;
    e.preventDefault();
    var touch = e.touches[0];
    if (!touch) return;
    var rect = canvas.getBoundingClientRect();
    var x = ((touch.clientX - rect.left) / rect.width) * CANVAS_W;
    socket.emit('paddleMove', x);
  }

  canvas.addEventListener('touchstart', handleTouch, { passive: false });
  canvas.addEventListener('touchmove', handleTouch, { passive: false });

  // Mouse fallback for desktop testing
  canvas.addEventListener('mousemove', function (e) {
    if (!screens.game.classList.contains('active')) return;
    var rect = canvas.getBoundingClientRect();
    var x = ((e.clientX - rect.left) / rect.width) * CANVAS_W;
    socket.emit('paddleMove', x);
  });

  // --- Rendering ---
  function render() {
    requestAnimationFrame(render);
    if (!gameState || !screens.game.classList.contains('active')) return;

    var st = gameState;
    var flipped = (yourSide === 'top');

    ctx.save();

    // Clear
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // If top player, flip the canvas so your paddle is at the bottom
    if (flipped) {
      ctx.translate(CANVAS_W, CANVAS_H);
      ctx.rotate(Math.PI);
    }

    // Center line
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, CANVAS_H / 2);
    ctx.lineTo(CANVAS_W, CANVAS_H / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Paddles
    ctx.fillStyle = '#fff';
    // Top paddle
    roundRect(ctx,
      st.paddles.top.x - PADDLE_W / 2,
      PADDLE_MARGIN,
      PADDLE_W, PADDLE_H, 4);
    // Bottom paddle
    roundRect(ctx,
      st.paddles.bottom.x - PADDLE_W / 2,
      CANVAS_H - PADDLE_MARGIN - PADDLE_H,
      PADDLE_W, PADDLE_H, 4);

    // Ball
    ctx.beginPath();
    ctx.arc(st.ball.x, st.ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Scores (always upright, not flipped)
    ctx.fillStyle = '#333';
    ctx.font = '900 36px -apple-system, sans-serif';
    ctx.textAlign = 'center';

    var yourScore, theirScore, yourName, theirName;
    if (yourSide === 'bottom') {
      yourScore = st.scores.bottom;
      theirScore = st.scores.top;
      yourName = st.names.bottom;
      theirName = st.names.top;
    } else {
      yourScore = st.scores.top;
      theirScore = st.scores.bottom;
      yourName = st.names.top;
      theirName = st.names.bottom;
    }

    // Opponent score at top, yours at bottom
    ctx.fillText(theirScore, CANVAS_W / 2, CANVAS_H / 2 - 20);
    ctx.fillText(yourScore, CANVAS_W / 2, CANVAS_H / 2 + 46);

    // Names
    ctx.font = '600 11px -apple-system, sans-serif';
    ctx.fillStyle = '#444';
    ctx.fillText(theirName, CANVAS_W / 2, 14);
    ctx.fillText(yourName, CANVAS_W / 2, CANVAS_H - 6);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
  }

  requestAnimationFrame(render);

  // --- Game State ---
  socket.on('gameState', function (data) {
    gameState = data;
    if (data.state === 'finished') {
      showGameOver(data);
    }
  });

  function showGameOver(data) {
    var yourScore, theirScore, yourName, theirName;
    if (yourSide === 'bottom') {
      yourScore = data.scores.bottom;
      theirScore = data.scores.top;
      yourName = data.names.bottom;
      theirName = data.names.top;
    } else {
      yourScore = data.scores.top;
      theirScore = data.scores.bottom;
      yourName = data.names.top;
      theirName = data.names.bottom;
    }

    var youWon = yourScore > theirScore;
    winnerText.textContent = youWon ? 'You Win!' : theirName + ' Wins';
    finalScore.textContent = yourScore + ' - ' + theirScore;
    showScreen('gameover');
    gameState = null;
  }

  // --- Opponent Left ---
  socket.on('opponentLeft', function () {
    winnerText.textContent = 'Opponent Left';
    finalScore.textContent = ':(';
    showScreen('gameover');
    gameState = null;
  });

  // --- Play Again ---
  btnAgain.addEventListener('click', function () {
    socket.emit('playAgain');
  });

  socket.on('goToLobby', function () {
    socket.emit('setName', playerName);
    socket.emit('findMatch');
    showScreen('lobby');
    btnAI.style.display = 'none';
    clearTimeout(aiTimer);
    aiTimer = setTimeout(function () {
      btnAI.style.display = 'block';
    }, 3000);
  });

  // --- Connection Status ---
  socket.on('connect', function () {
    connectionDot.classList.remove('disconnected');
  });

  socket.on('disconnect', function () {
    connectionDot.classList.add('disconnected');
  });

})();
