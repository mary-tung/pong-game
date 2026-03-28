(function () {
  'use strict';

  // --- Constants ---
  var CANVAS_W = 400;
  var CANVAS_H = 600;
  var PADDLE_W = 80;
  var PADDLE_H = 14;
  var PADDLE_MARGIN = 20;
  var BALL_R = 8;

  // --- Themes ---
  var themes = {
    classic: {
      bg: '#0a0a0a',
      paddle: '#ffffff',
      ball: '#ffffff',
      line: '#222222',
      scoreFill: '#333333',
      nameFill: '#444444',
      glow: null,
      trail: false,
      particles: false,
    },
    neon: {
      bg: '#0a001a',
      paddle: '#00ffff',
      ball: '#ff00ff',
      line: '#1a0033',
      scoreFill: '#4400aa',
      nameFill: '#6600cc',
      glow: { ball: 'rgba(255,0,255,0.6)', paddle: 'rgba(0,255,255,0.5)', radius: 18 },
      trail: { color: 'rgba(255,0,255,0.15)', length: 8 },
      particles: false,
    },
    ocean: {
      bg: '#001830',
      paddle: '#66ccff',
      ball: '#ffffff',
      line: '#003060',
      scoreFill: '#1a5080',
      nameFill: '#2a6090',
      glow: { ball: 'rgba(100,200,255,0.4)', paddle: 'rgba(100,200,255,0.3)', radius: 14 },
      trail: { color: 'rgba(100,200,255,0.1)', length: 6 },
      particles: { color: 'rgba(100,200,255,0.15)', count: 25, speed: 0.3 },
    },
    lava: {
      bg: '#1a0500',
      paddle: '#ff6600',
      ball: '#ffcc00',
      line: '#331000',
      scoreFill: '#662200',
      nameFill: '#883300',
      glow: { ball: 'rgba(255,100,0,0.6)', paddle: 'rgba(255,100,0,0.4)', radius: 16 },
      trail: { color: 'rgba(255,80,0,0.12)', length: 10 },
      particles: { color: 'rgba(255,80,0,0.2)', count: 20, speed: 0.5 },
    },
    retro: {
      bg: '#001200',
      paddle: '#00ff00',
      ball: '#00ff00',
      line: '#003300',
      scoreFill: '#005500',
      nameFill: '#006600',
      glow: { ball: 'rgba(0,255,0,0.4)', paddle: 'rgba(0,255,0,0.3)', radius: 12 },
      trail: false,
      particles: false,
      scanlines: true,
    },
  };

  var currentTheme = 'classic';
  var ballTrail = []; // stores recent ball positions for trail effect
  var bgParticles = []; // background floating particles

  function initParticles() {
    bgParticles = [];
    var t = themes[currentTheme];
    if (t.particles) {
      for (var i = 0; i < t.particles.count; i++) {
        bgParticles.push({
          x: Math.random() * CANVAS_W,
          y: Math.random() * CANVAS_H,
          r: Math.random() * 2 + 1,
          vx: (Math.random() - 0.5) * t.particles.speed,
          vy: (Math.random() - 0.5) * t.particles.speed,
        });
      }
    }
  }

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

  // --- Theme Picker ---
  var themeBtns = document.querySelectorAll('.theme-btn');
  for (var i = 0; i < themeBtns.length; i++) {
    themeBtns[i].addEventListener('click', function () {
      for (var j = 0; j < themeBtns.length; j++) themeBtns[j].classList.remove('selected');
      this.classList.add('selected');
      currentTheme = this.getAttribute('data-theme');
      initParticles();
    });
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
    var t = themes[currentTheme];
    var flipped = (yourSide === 'top');

    // Update ball trail
    ballTrail.push({ x: st.ball.x, y: st.ball.y });
    var maxTrail = t.trail ? t.trail.length : 1;
    while (ballTrail.length > maxTrail) ballTrail.shift();

    // Update background particles
    if (t.particles) {
      for (var pi = 0; pi < bgParticles.length; pi++) {
        var p = bgParticles[pi];
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = CANVAS_W;
        if (p.x > CANVAS_W) p.x = 0;
        if (p.y < 0) p.y = CANVAS_H;
        if (p.y > CANVAS_H) p.y = 0;
      }
    }

    ctx.save();

    // Background
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Background particles (before flip so they stay ambient)
    if (t.particles) {
      ctx.fillStyle = t.particles.color;
      for (var pi2 = 0; pi2 < bgParticles.length; pi2++) {
        var pp = bgParticles[pi2];
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, pp.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Flip for top player
    if (flipped) {
      ctx.translate(CANVAS_W, CANVAS_H);
      ctx.rotate(Math.PI);
    }

    // Center line
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = t.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, CANVAS_H / 2);
    ctx.lineTo(CANVAS_W, CANVAS_H / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // --- Paddles ---
    if (t.glow) {
      ctx.shadowColor = t.glow.paddle;
      ctx.shadowBlur = t.glow.radius;
    }
    ctx.fillStyle = t.paddle;
    roundRect(ctx,
      st.paddles.top.x - PADDLE_W / 2,
      PADDLE_MARGIN,
      PADDLE_W, PADDLE_H, 4);
    roundRect(ctx,
      st.paddles.bottom.x - PADDLE_W / 2,
      CANVAS_H - PADDLE_MARGIN - PADDLE_H,
      PADDLE_W, PADDLE_H, 4);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    // --- Ball trail ---
    if (t.trail && ballTrail.length > 1) {
      for (var ti = 0; ti < ballTrail.length - 1; ti++) {
        var alpha = (ti + 1) / ballTrail.length;
        var bx = ballTrail[ti].x;
        var by = ballTrail[ti].y;
        ctx.fillStyle = t.trail.color;
        ctx.globalAlpha = alpha * 0.6;
        ctx.beginPath();
        ctx.arc(bx, by, BALL_R * alpha, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // --- Ball ---
    if (t.glow) {
      ctx.shadowColor = t.glow.ball;
      ctx.shadowBlur = t.glow.radius;
    }
    ctx.fillStyle = t.ball;
    ctx.beginPath();
    ctx.arc(st.ball.x, st.ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    // --- Scanlines (retro theme) ---
    if (t.scanlines) {
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      for (var sl = 0; sl < CANVAS_H; sl += 4) {
        ctx.fillRect(0, sl, CANVAS_W, 2);
      }
    }

    ctx.restore();

    // Scores (always upright)
    ctx.fillStyle = t.scoreFill;
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

    ctx.fillText(theirScore, CANVAS_W / 2, CANVAS_H / 2 - 20);
    ctx.fillText(yourScore, CANVAS_W / 2, CANVAS_H / 2 + 46);

    ctx.font = '600 11px -apple-system, sans-serif';
    ctx.fillStyle = t.nameFill;
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
