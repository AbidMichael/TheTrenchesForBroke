const ws = new WebSocket(`wss://${location.host}`);
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
            id = Math.random().toString(36).substring(2, 32);
            localStorage.setItem('playerId', id);
            console.log('[LOCALSTORAGE] New ID generated:', id);
        } else {
            console.log('[LOCALSTORAGE] Loaded existing ID:', id);
        }
        return id;
    } catch (e) {
        console.warn('[LOCALSTORAGE] Unavailable, fallback to session-only ID');
        return Math.random().toString(36).substring(2, 32);
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
        updateStatsEncadre(Object.values(gameState.players));
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

function updateStatsEncadre(allPlayers) {
    // Séparer bots et humains
    const bots = allPlayers.filter(p => p.id.startsWith('FAKE'));
    const humans = allPlayers.filter(p => !p.id.startsWith('FAKE'));

    // Regrouper les bots par type
    const typeCounts = {};
    const typeTokens = {};
    const typeDollars = {};
    bots.forEach(bot => {
        // Suppose que bot.type existe (sinon adapte ici)
        if (!typeCounts[bot.type]) {
            typeCounts[bot.type] = 0;
            typeTokens[bot.type] = 0;
            typeDollars[bot.type] = 0;
        }
        typeCounts[bot.type]++;
        typeTokens[bot.type] += bot.tokens;
        typeDollars[bot.type] += bot.dollars;
    });

    // Totaux
    const totalBots = bots.length;
    const totalHumans = humans.length;
    const totalTokens = bots.reduce((sum, b) => sum + b.tokens, 0);
    const totalDollars = bots.reduce((sum, b) => sum + b.dollars, 0);
    const humanTokens = humans.reduce((sum, h) => sum + h.tokens, 0);
    const humanDollars = humans.reduce((sum, h) => sum + h.dollars, 0);

    // Génération HTML
    let html = `<b>Population IA :</b> ${totalBots} bots<br>`;
    html += `<b>Répartition :</b><ul>`;
    for (const type in typeCounts) {
        const percent = ((typeCounts[type] / totalBots) * 100).toFixed(1);
        html += `<li>${type.charAt(0).toUpperCase() + type.slice(1)} : ${typeCounts[type]} (${percent}%)</li>`;
    }
    html += `</ul>`;
    html += `<b>Tokens par type :</b><ul>`;
    for (const type in typeTokens) {
        const percent = totalTokens ? ((typeTokens[type] / totalTokens) * 100).toFixed(1) : 0;
        html += `<li>${type.charAt(0).toUpperCase() + type.slice(1)} : ${typeTokens[type].toFixed(2)} (${percent}%)</li>`;
    }
    html += `</ul>`;
    html += `<b>Dollars par type :</b><ul>`;
    for (const type in typeDollars) {
        html += `<li>${type.charAt(0).toUpperCase() + type.slice(1)} : ${typeDollars[type].toFixed(2)}</li>`;
    }
    html += `</ul>`;
    html += `<b>Tokens humains :</b> ${humanTokens.toFixed(2)}<br>`;
    html += `<b>Dollars humains :</b> ${humanDollars.toFixed(2)}<br>`;

    // Exemples de stats complémentaires :
    // Bot le plus riche
    if (bots.length > 0) {
        const topBot = bots.reduce((prev, curr) => prev.dollars > curr.dollars ? prev : curr);
        html += `<b>Bot le plus riche :</b> ${topBot.type} (${topBot.dollars.toFixed(2)}$)<br>`;
    }

    // % détenu par top 3 bots
    const sortedByTokens = [...bots].sort((a, b) => b.tokens - a.tokens);
    const top3 = sortedByTokens.slice(0, 3);
    const top3Tokens = top3.reduce((sum, b) => sum + b.tokens, 0);
    const top3Percent = totalTokens ? ((top3Tokens / totalTokens) * 100).toFixed(1) : 0;
    html += `<b>% tokens détenu par les 3 plus gros bots :</b> ${top3Percent}%<br>`;

    document.getElementById("stats-content").innerHTML = html;
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
    let visibleCandles = candles; // tu peux ajouter un filtre ici si tu as un scroll plus tard

    let min = Math.min(...visibleCandles.map(c => c.l));
    let max = Math.max(...visibleCandles.map(c => c.h));

    if (min === max) {
        min -= 1;
        max += 1;
    }

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

