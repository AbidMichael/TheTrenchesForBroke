const ws = new WebSocket(`ws://${location.host}`);
let playerId, gameState = {};

const canvas = document.getElementById('chart');
const ctx = canvas.getContext('2d');

const statsDiv = document.getElementById('stats');
const leaderboardDiv = document.getElementById('leaderboard');

// Drawing parameters
const CHART_PADDING = 60;
const CANDLE_WIDTH = 14;
const CANDLE_GAP = 8;
const CHART_HEIGHT = canvas.height - CHART_PADDING * 2;


function getOrCreatePlayerId() {
    try {
        let id = localStorage.getItem('playerId');
        if (!id) {
            id = 'P' + Math.random().toString(36).substring(2, 10);
            localStorage.setItem('playerId', id);
            console.log('[LOCALSTORAGE] New ID generated:', id);
        } else {
            console.log('[LOCALSTORAGE] Loaded existing ID:', id);
        }
        return id;
    } catch (e) {
        console.warn('[LOCALSTORAGE] Unavailable, fallback to session-only ID');
        return 'P' + Math.random().toString(36).substring(2, 10);
    }
}

ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'init') {
        playerId = data.playerId;
    }
    if (data.type === 'update') {
        gameState = data.gameState;
        drawCandles([...gameState.candles, gameState.currentCandle]);
        updateStats();
        updateLeaderboard();
    }
};

function sendAction(action, amount) {
    ws.send(JSON.stringify({ action, amount }));
}

document.querySelectorAll('[data-buy]').forEach(btn => {
    btn.onclick = () => sendAction('buy', parseFloat(btn.dataset.buy));
});

document.getElementById('customBuyBtn').onclick = () => {
    const amount = parseFloat(document.getElementById('customBuy').value);
    if (!isNaN(amount)) sendAction('buy', amount);
};

document.querySelectorAll('[data-sell]').forEach(btn => {
    btn.onclick = () => sendAction('sell', parseFloat(btn.dataset.sell));
});


function updateStats() {
    const player = gameState.players[playerId];
    const lastCandle = gameState.currentCandle;

    let price = lastCandle ? lastCandle.c : 0;
    let variation = lastCandle ? ((lastCandle.c - lastCandle.o) / lastCandle.o) * 100 : 0;

    statsDiv.innerHTML = `
    Dollars: ${player.dollars.toFixed(2)} |
    Tokens: ${player.tokens.toFixed(4)} |
    Avg Buy: ${player.averageBuy.toFixed(2)} |
    Gains: ${player.gains.toFixed(2)} |
    Prix actuel: ${price.toFixed(2)} |
    Variation: ${(variation >= 0 ? "+" : "") + variation.toFixed(2)}% |
    En circulation: ${gameState.totalTokensInCirculation.toFixed(2)} 
  `;
}

function updateLeaderboard() {
    let html = '';
    const topPlayers = gameState.leaderboard.slice(0, 25);
    const me = gameState.players[playerId];
    const myNetWorth = me.tokens * gameState.currentCandle.c + me.dollars;

    let playerRank = -1;

    gameState.leaderboard.forEach((p, i) => {
        if (p.id === playerId) playerRank = i;
    });

    topPlayers.forEach((p, i) => {
        const isPlayer = p.id === playerId;
        html += `<div ${isPlayer ? 'class="highlight"' : ''}>
      #${i + 1} – ${p.netWorth.toFixed(2)} $ | ${p.tokens.toFixed(3)} tokens
    </div>`;
    });

    if (playerRank >= 25) {
        html += `<div>...</div>
    <div class="highlight">#${playerRank + 1} – ${myNetWorth.toFixed(2)} $ | ${me.tokens.toFixed(3)} tokens</div>`;
    }

    document.getElementById('leaderboard').innerHTML = html;
}


function drawCandles(candles) {
    const canvas = document.getElementById('chart');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Constants
    const CHART_PADDING = 60;
    const CANDLE_WIDTH = 14;
    const CANDLE_GAP = 8;
    const CHART_HEIGHT = canvas.height - CHART_PADDING * 2;

    // Auto-adjust canvas width if needed
    const requiredWidth = CHART_PADDING + candles.length * (CANDLE_WIDTH + CANDLE_GAP);
    if (canvas.width < requiredWidth) {
        canvas.width = requiredWidth;
    }

    // Frame
    ctx.save();
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(CHART_PADDING / 2, CHART_PADDING / 2, canvas.width - CHART_PADDING, canvas.height - CHART_PADDING);
    ctx.restore();

    if (candles.length === 0) return;

    // Find min/max for Y scale
    let min = Math.min(...candles.map(c => c.l));
    let max = Math.max(...candles.map(c => c.h));
    if (min === max) { min -= 1; max += 1; }
    const range = max - min;

    // Axes (Y values)
    ctx.save();
    ctx.fillStyle = "#bbb";
    ctx.font = "14px monospace";
    for (let i = 0; i <= 4; ++i) {
        let yVal = min + (range * (4 - i) / 4);
        let yPos = CHART_PADDING / 2 + (CHART_HEIGHT * i / 4);
        ctx.fillText(yVal.toFixed(2).padStart(6, ' '), 8, yPos + 5);
        ctx.beginPath();
        ctx.strokeStyle = '#333';
        ctx.moveTo(CHART_PADDING / 2, yPos);
        ctx.lineTo(canvas.width - CHART_PADDING / 2, yPos);
        ctx.stroke();
    }
    ctx.restore();

    // Draw candles
    for (let i = 0; i < candles.length; ++i) {
        const c = candles[i];
        const x = CHART_PADDING + i * (CANDLE_WIDTH + CANDLE_GAP);

        const y = val => CHART_PADDING / 2 + ((max - val) / range) * CHART_HEIGHT;

        // Wick
        ctx.save();
        ctx.strokeStyle = "#bbb";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + CANDLE_WIDTH / 2, y(c.h));
        ctx.lineTo(x + CANDLE_WIDTH / 2, y(c.l));
        ctx.stroke();
        ctx.restore();

        // Body
        let isBull = c.c >= c.o;
        ctx.save();
        ctx.fillStyle = isBull ? "#00ff94" : "#ff3860";
        ctx.strokeStyle = isBull ? "#07cc70" : "#c42534";
        ctx.lineWidth = 2;
        let bodyTop = isBull ? y(c.c) : y(c.o);
        let bodyBot = isBull ? y(c.o) : y(c.c);
        ctx.beginPath();
        ctx.rect(x, bodyTop, CANDLE_WIDTH, Math.max(bodyBot - bodyTop, 2));
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }
}

ws.onopen = () => {
    const playerId = getOrCreatePlayerId();
    ws.send(JSON.stringify({ type: 'connect', playerId }));
    console.log('[WS] Connected and sent playerId:', playerId);
};

ws.onerror = () => {
    console.error("🔴 Impossible de rejoindre les tranchées...");
};

// Premier affichage vide
drawCandles([]);


function sellPercent(percent) {
    const player = gameState.players[playerId];
    yourTokens = player.tokens;
    console.log(yourTokens);
    if (!yourTokens || percent <= 0) return;
    const amount = yourTokens * (percent / 100);
    console.log(amount);
    sendAction('sell', parseFloat(amount));
}

function sellToBreakEven() {
    const player = gameState.players[playerId];
    yourTokens = player.tokens;
    if (!yourTokens || player.yourAvgBuy <= 0) return;
    const targetDollars = player.yourAvgBuy * yourTokens;

    // Objectif : récupérer ce qu’on a investi
    const requiredSell = (player.totalInvested - (player.gains + player.dollars)) / gameState.currentCandle.c;
    const amount = Math.min(yourTokens, requiredSell);

    if (amount > 0) {
        sendAction('sell', parseFloat(amount));
    }
}

