(function () {
  'use strict';

  // --- Constants ---
  var CANVAS_W = 400;
  var CANVAS_H = 600;
  var PADDLE_W = 80;
  var PADDLE_H = 14;
  var PADDLE_MARGIN = 20;
  var BALL_R = 8;
  var TWO_PI = Math.PI * 2;

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
    taylor: {
      bg: '#0e0618',
      paddle: '#c8aaff',
      ball: '#ffaadd',
      line: '#1a0d33',
      scoreFill: '#4a2d80',
      nameFill: '#6b44aa',
      glow: { ball: [255, 170, 221, 0.5], paddle: [200, 170, 255, 0.4], radius: 16 },
      trail: { color: 'rgba(200,170,255,0.12)', length: 8 },
      particles: { color: 'rgba(220,190,255,0.2)', count: 30, speed: 0.2 },
    },
    britney: {
      bg: '#1a0018',
      paddle: '#ff3399',
      ball: '#ffdd00',
      line: '#330030',
      scoreFill: '#880066',
      nameFill: '#aa0088',
      glow: { ball: [255, 220, 0, 0.5], paddle: [255, 51, 153, 0.5], radius: 18 },
      trail: { color: 'rgba(255,51,153,0.15)', length: 7 },
      particles: { color: 'rgba(255,100,200,0.18)', count: 25, speed: 0.35 },
    },
    cardi: {
      bg: '#120800',
      paddle: '#ff2222',
      ball: '#ffd700',
      line: '#2a1200',
      scoreFill: '#8b4513',
      nameFill: '#b8600a',
      glow: { ball: [255, 215, 0, 0.6], paddle: [255, 34, 34, 0.5], radius: 20 },
      trail: { color: 'rgba(255,215,0,0.15)', length: 10 },
      particles: { color: 'rgba(255,200,50,0.2)', count: 20, speed: 0.4 },
    },
  };

  var currentTheme = 'classic';

  // --- Pre-rendered glow sprites (replaces expensive shadowBlur) ---
  var glowSprites = {}; // { themeName: { ball: canvas, paddle: canvas } }

  function buildGlowSprite(r, g, b, a, radius, size) {
    var c = document.createElement('canvas');
    var s = (size + radius * 2) * 2;
    c.width = s;
    c.height = s;
    var cx = c.getContext('2d');
    var half = s / 2;
    var grad = cx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')');
    grad.addColorStop(0.4, 'rgba(' + r + ',' + g + ',' + b + ',' + (a * 0.5) + ')');
    grad.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
    cx.fillStyle = grad;
    cx.fillRect(0, 0, s, s);
    return c;
  }

  function rebuildGlowSprites() {
    glowSprites = {};
    for (var name in themes) {
      var t = themes[name];
      if (t.glow) {
        var g = t.glow;
        glowSprites[name] = {
          ball: buildGlowSprite(g.ball[0], g.ball[1], g.ball[2], g.ball[3], g.radius, BALL_R),
          paddle: buildGlowSprite(g.paddle[0], g.paddle[1], g.paddle[2], g.paddle[3], g.radius, Math.max(PADDLE_W, PADDLE_H)),
        };
      }
    }
  }
  rebuildGlowSprites();

  // --- Ball trail ring buffer ---
  var TRAIL_MAX = 12;
  var trailBuf = new Float32Array(TRAIL_MAX * 2); // x,y pairs
  var trailHead = 0;
  var trailLen = 0;

  function trailPush(x, y) {
    trailBuf[trailHead * 2] = x;
    trailBuf[trailHead * 2 + 1] = y;
    trailHead = (trailHead + 1) % TRAIL_MAX;
    if (trailLen < TRAIL_MAX) trailLen++;
  }

  function trailClear() {
    trailLen = 0;
    trailHead = 0;
  }

  // --- Background particles ---
  var bgParticles = [];

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
  var ctx = canvas.getContext('2d', { alpha: false }); // opaque canvas — skips compositing
  var connectionDot = document.getElementById('connection-dot');

  // --- State ---
  var socket = io({ transports: ['websocket', 'polling'] });
  var playerName = '';
  var yourSide = 'bottom';
  var aiTimer = null;
  var activeScreen = 'name'; // cached to avoid DOM reads in render loop

  // --- Interpolation state ---
  var prevState = null;
  var currState = null;
  var stateTimestamp = 0;
  var prevTimestamp = 0;
  var SERVER_TICK_MS = 1000 / 30; // server sends at 30Hz

  // --- Cached layout ---
  var canvasRect = { left: 0, top: 0, width: 1, height: 1 };

  function cacheRect() {
    var r = canvas.getBoundingClientRect();
    canvasRect.left = r.left;
    canvasRect.top = r.top;
    canvasRect.width = r.width;
    canvasRect.height = r.height;
  }

  // --- Screen Management ---
  function showScreen(name) {
    for (var key in screens) {
      screens[key].classList.remove('active');
    }
    screens[name].classList.add('active');
    activeScreen = name;
  }

  // --- Theme Picker ---
  var themeBtns = document.querySelectorAll('.theme-btn');
  for (var i = 0; i < themeBtns.length; i++) {
    themeBtns[i].addEventListener('click', function () {
      for (var j = 0; j < themeBtns.length; j++) themeBtns[j].classList.remove('selected');
      this.classList.add('selected');
      currentTheme = this.getAttribute('data-theme');
      initParticles();
      trailClear();
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
    prevState = null;
    currState = null;
    trailClear();

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
    var dpr = Math.min(window.devicePixelRatio || 1, 2); // cap at 2x for perf
    var rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    var scaleX = canvas.width / CANVAS_W;
    var scaleY = canvas.height / CANVAS_H;
    ctx.scale(scaleX, scaleY);
    cacheRect();
  }

  window.addEventListener('resize', function () {
    if (activeScreen === 'game') resizeCanvas();
  });

  // --- Touch Input (throttled to 30Hz) ---
  var lastTouchEmit = 0;
  var pendingX = -1;
  var touchThrottleMs = 1000 / 30;

  function emitPaddle(x) {
    var now = performance.now();
    pendingX = x;
    if (now - lastTouchEmit >= touchThrottleMs) {
      socket.emit('paddleMove', pendingX);
      lastTouchEmit = now;
      pendingX = -1;
    }
  }

  // Flush any pending paddle position
  function flushPaddle() {
    if (pendingX >= 0) {
      socket.emit('paddleMove', pendingX);
      pendingX = -1;
      lastTouchEmit = performance.now();
    }
  }

  function handleTouch(e) {
    if (activeScreen !== 'game') return;
    e.preventDefault();
    var touch = e.touches[0];
    if (!touch) return;
    var x = ((touch.clientX - canvasRect.left) / canvasRect.width) * CANVAS_W;
    emitPaddle(x);
  }

  canvas.addEventListener('touchstart', handleTouch, { passive: false });
  canvas.addEventListener('touchmove', handleTouch, { passive: false });
  canvas.addEventListener('touchend', function () { flushPaddle(); }, { passive: true });

  canvas.addEventListener('mousemove', function (e) {
    if (activeScreen !== 'game') return;
    var x = ((e.clientX - canvasRect.left) / canvasRect.width) * CANVAS_W;
    emitPaddle(x);
  });

  // --- Interpolation helper ---
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function getInterpolatedState(now) {
    if (!currState) return null;
    if (!prevState) return currState;

    var elapsed = now - stateTimestamp;
    var t = Math.min(elapsed / SERVER_TICK_MS, 1);

    return {
      ball: {
        x: lerp(prevState.ball.x, currState.ball.x, t),
        y: lerp(prevState.ball.y, currState.ball.y, t),
      },
      paddles: {
        top: { x: lerp(prevState.paddles.top.x, currState.paddles.top.x, t) },
        bottom: { x: lerp(prevState.paddles.bottom.x, currState.paddles.bottom.x, t) },
      },
      scores: currState.scores,
      names: currState.names,
      state: currState.state,
    };
  }

  // --- Rendering ---
  function render(timestamp) {
    requestAnimationFrame(render);
    if (activeScreen !== 'game' || !currState) return;

    var st = getInterpolatedState(performance.now());
    if (!st) return;

    var t = themes[currentTheme];
    var flipped = (yourSide === 'top');

    // Update ball trail
    trailPush(st.ball.x, st.ball.y);

    // Update particles
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

    // Batched particles (single path, single fill)
    if (t.particles && bgParticles.length > 0) {
      ctx.fillStyle = t.particles.color;
      ctx.beginPath();
      for (var pi2 = 0; pi2 < bgParticles.length; pi2++) {
        var pp = bgParticles[pi2];
        ctx.moveTo(pp.x + pp.r, pp.y);
        ctx.arc(pp.x, pp.y, pp.r, 0, TWO_PI);
      }
      ctx.fill();
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

    // --- Paddle glow (sprite blit, not shadowBlur) ---
    var gs = glowSprites[currentTheme];
    if (gs) {
      var ps = gs.paddle;
      var pw = ps.width;
      var ph = ps.height;
      // Top paddle glow
      ctx.drawImage(ps,
        st.paddles.top.x - pw / 2,
        PADDLE_MARGIN + PADDLE_H / 2 - ph / 2,
        pw, ph);
      // Bottom paddle glow
      ctx.drawImage(ps,
        st.paddles.bottom.x - pw / 2,
        CANVAS_H - PADDLE_MARGIN - PADDLE_H / 2 - ph / 2,
        pw, ph);
    }

    // --- Paddles (no shadowBlur!) ---
    ctx.fillStyle = t.paddle;
    roundRect(ctx,
      st.paddles.top.x - PADDLE_W / 2,
      PADDLE_MARGIN,
      PADDLE_W, PADDLE_H, 4);
    roundRect(ctx,
      st.paddles.bottom.x - PADDLE_W / 2,
      CANVAS_H - PADDLE_MARGIN - PADDLE_H,
      PADDLE_W, PADDLE_H, 4);

    // --- Ball trail (ring buffer read) ---
    var maxTrail = t.trail ? t.trail.length : 0;
    if (t.trail && trailLen > 1) {
      var drawCount = Math.min(trailLen, maxTrail);
      ctx.fillStyle = t.trail.color;
      for (var ti = 0; ti < drawCount - 1; ti++) {
        var idx = ((trailHead - drawCount + ti) % TRAIL_MAX + TRAIL_MAX) % TRAIL_MAX;
        var alpha = (ti + 1) / drawCount;
        var bx = trailBuf[idx * 2];
        var by = trailBuf[idx * 2 + 1];
        ctx.globalAlpha = alpha * 0.6;
        ctx.beginPath();
        ctx.arc(bx, by, BALL_R * alpha, 0, TWO_PI);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // --- Ball glow (sprite blit) ---
    if (gs) {
      var bs = gs.ball;
      ctx.drawImage(bs,
        st.ball.x - bs.width / 2,
        st.ball.y - bs.height / 2,
        bs.width, bs.height);
    }

    // --- Ball ---
    ctx.fillStyle = t.ball;
    ctx.beginPath();
    ctx.arc(st.ball.x, st.ball.y, BALL_R, 0, TWO_PI);
    ctx.fill();

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

  // --- Game State (with interpolation) ---
  socket.on('gameState', function (data) {
    if (data.state === 'finished') {
      currState = data;
      showGameOver(data);
      return;
    }
    prevState = currState;
    currState = data;
    prevTimestamp = stateTimestamp;
    stateTimestamp = performance.now();
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
    currState = null;
    prevState = null;
  }

  // --- Opponent Left ---
  socket.on('opponentLeft', function () {
    winnerText.textContent = 'Opponent Left';
    finalScore.textContent = ':(';
    showScreen('gameover');
    currState = null;
    prevState = null;
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
