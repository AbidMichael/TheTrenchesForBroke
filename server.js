const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve fichiers statiques
app.use(express.static(path.join(__dirname, 'public')));

// Démarrer serveur
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur HTTP lancé sur le port ${PORT}`);
});

const SELL_PERCENTAGES = [0.1, 0.25, 0.5, 0.75, 0.9, 1];

let players = {};
let candles = [];
let currentCandle = createCandle();
let totalTokensInCirculation = 10;

let simulationStarted = false;
let fakeClients = [];


function getMarketCap() {
    return totalTokensInCirculation * currentCandle.c;
}

function isDeepDetected(candles, threshold = 0.2) {
    if (candles.length < 5) return false;

    const recent = candles.slice(-5);
    const maxHigh = Math.max(...recent.map(c => c.h));
    const minLow = Math.min(...recent.map(c => c.l));

    const variation = (maxHigh - minLow) / maxHigh;
    return variation >= threshold;
}

function isChartStagnating(candles, threshold = 0.03) {
    if (candles.length < 5) return false;
    const last5 = candles.slice(-5);
    const highs = last5.map(c => c.h);
    const lows = last5.map(c => c.l);

    const max = Math.max(...highs);
    const min = Math.min(...lows);
    const variation = (max - min) / max;

    return variation < threshold;
}

class FakeClient {
    constructor(id, behavior) {
        this.id = id;
        this.behavior = behavior;
        this.personality = Math.random() < 0.1 ? 'rugger' : 'believer';
        this.panic = Math.random() < (0.8 - (this.behavior == "whale" ? 0.6 : 0));
        this.player = createNewPlayer(id);
        this.player.isSimulated = true;
        this.entryPrice = null;

        this.cooldown = 1000 + Math.floor(Math.random() * 5000);
        this.lastAction = Date.now() - Math.floor(Math.random() * this.cooldown);

        players[id] = this.player;
    }

    tick() {
        const now = Date.now();
        if (now - this.lastAction < this.cooldown) return;

        const p = this.player;
        const price = currentCandle.c;

        switch (this.behavior) {
            case 'whale':
                this.runWhale(p, price);
                break;
            case 'sheep':
                this.runSheep(p, price);
                break;
            case 'sniper':
                this.runSniper(p, price);
                break;
        }

        this.lastAction = now;
    }

    runWhale(p, price) {
        if (p.tokens <= 0.0001) {
            if (price < 5000 && p.dollars > 5) {
                const amount = p.dollars * (0.5 + Math.random() * 0.5);
                this.entryPrice = price;
                handleAction(this.id, { action: 'buy', amount });
                return;
            }

            if (isChartStagnating(candles) && price / this.entryPrice > 1.2 && p.tokens > 0.1) {
                const percent = 0.1 + Math.random() * 0.2; // vendre 10–30%
                handleAction(this.id, { action: 'sell', amount: p.tokens * percent });
                return;
            }

            if (isDeepDetected(candles) && p.dollars > 200) {
                const amount = p.dollars * 0.9;
                this.entryPrice = price;
                handleAction(this.id, { action: 'buy', amount });
                return;
            }
            return;
        }

        if (isDeepDetected(candles) && (this.panic)) {
            const percent = SELL_PERCENTAGES[Math.floor(Math.random() * SELL_PERCENTAGES.length)];
            handleAction(this.id, { action: 'sell', amount: p.tokens * percent });
        }
        const profitRatio = price / this.entryPrice;
        if (this.personality === 'rugger' && profitRatio >= 2) {
            const percent = 0.75 + Math.random() * 0.25; // rugger : gros cash out
            handleAction(this.id, { action: 'sell', amount: p.tokens * percent });
        } else if (profitRatio >= 2.0 || (profitRatio >= 3 && Math.random() < 0.5)) {
            const percent = SELL_PERCENTAGES[Math.floor(Math.random() * SELL_PERCENTAGES.length)];
            handleAction(this.id, { action: 'sell', amount: p.tokens * percent });
        }


    }

    runSheep(p, price) {
        const prev = candles.at(-1);
        if (!prev) return;

        if (p.tokens === 0) {
            if (price < 50000 && p.dollars > 5) {
                const amount = p.dollars * (0.2 + Math.random() * 0.3);
                this.entryPrice = price;
                handleAction(this.id, { action: 'buy', amount });
            }
            return;
        }


        const isDown = price < prev.c;

        if (!isDown && Math.random() < 0.6) {
            if (p.dollars > 5) {
                const amount = p.dollars * (0.2 + Math.random() * 0.3);
                handleAction(this.id, { action: 'buy', amount });
            }
        }

        if (isDown && (isDeepDetected(candles) || this.panic)) {
            const percent = SELL_PERCENTAGES[Math.floor(Math.random() * SELL_PERCENTAGES.length)];
            handleAction(this.id, { action: 'sell', amount: p.tokens * percent });
        }
    }


    runSniper(p, price) {

        const prev = candles.at(-1);
        if (!prev) return;

        if (p.tokens === 0) {
            if (price < 20000 && p.dollars > 5) {
                const amount = p.dollars * (0.5 + Math.random() * 0.5); // 50 à 100 % du cash
                this.entryPrice = price;
                handleAction(this.id, { action: 'buy', amount });
                return;
            }
            if (isChartStagnating(candles) && price / this.entryPrice > 1.3 && p.tokens > 0.1) {
                const percent = 0.25 + Math.random() * 0.25; // vendre 25–50%
                handleAction(this.id, { action: 'sell', amount: p.tokens * percent });
                return;
            }
            if (price < prev.l * 0.5 && p.dollars > 10) {
                const amount = p.dollars * (0.3 + Math.random() * 0.5);
                this.entryPrice = price;
                handleAction(this.id, { action: 'buy', amount });
            }
            return;
        }

        if (price > prev.h && this.entryPrice) {
            const gain = price / this.entryPrice;
            if ((this.personality === 'rugger' && gain > 1.1) || gain > 1.5) {
                const amount = p.tokens * 0.9;
                handleAction(this.id, { action: 'sell', amount });
            }
        }
    }

}



setInterval(() => {
    if (
        candles.length === 0 ||
        currentCandle.h !== candles.at(-1).h ||
        currentCandle.l !== candles.at(-1).l
    ) {
        console.log(`[CANDLE] Push new candle: O:${currentCandle.o.toFixed(2)} H:${currentCandle.h.toFixed(2)} L:${currentCandle.l.toFixed(2)} C:${currentCandle.c.toFixed(2)}`);
        candles.push(currentCandle);
        if (candles.length > 50) candles.shift();
    }
    currentCandle = createCandle(currentCandle.c);
    broadcastGameState();
}, 5000);

function createCandle(open = 1000) {
    return { o: open, h: open, l: open, c: open, t: Date.now() };
}

function generateId() {
    return 'P' + Math.random().toString(36).substring(2, 10);
}

function createNewPlayer(name) {
    console.log(`[PLAYER] Creating new player`);
    return {
        id:name,
        dollars: 100,
        tokens: 0,
        averageBuy: 0,
        gains: 0,
        totalInvested: 0,
        totalSold: 0,
        totalClicks: 0,
        lastActive: Date.now()
    };
}

wss.on('connection', (ws) => {
    let playerId = null;

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        if (data.type === 'connect') {
            playerId = data.playerId;

            if (playerId && players[playerId]) {
                if (!playerId.startsWith("FAKE")) console.log(`[CONNECT] Reconnected existing player: ${playerId}`);
            } else {
                playerId = playerId || generateId();
                players[playerId] = createNewPlayer(playerId);
                if (!playerId.startsWith("FAKE")) console.log(`[CONNECT] Created new player: ${playerId}`);
            }

            ws.playerId = playerId;
            ws.send(JSON.stringify({ type: 'init', playerId }));
            broadcastGameState();
            return;
        }

        if (!playerId || !players[playerId]) {
            if (!playerId.startsWith("FAKE")) console.warn(`[WARN] Invalid playerId on action:`, playerId);
            return;
        }

        handleAction(playerId, data);
        players[playerId].lastActive = Date.now();
        broadcastGameState();
    });
});

function handleAction(playerId, data) {
    const player = players[playerId];

    if (data.action === 'buy') {
        const amount = data.amount;
        if (player.dollars >= amount) {
            const tokensBought = amount / currentCandle.c;

            if (!simulationStarted && !player.isSimulated) {
                simulationStarted = true;
                startFakeClientSimulation();
            }

            if (totalTokensInCirculation > 0) {
                const priceImpactPercent = tokensBought / totalTokensInCirculation;
                currentCandle.c += currentCandle.c * priceImpactPercent;
                if (!playerId.startsWith("FAKE")) console.log(`[BUY] ${playerId} bought ${tokensBought.toFixed(4)} tokens, impact +${(priceImpactPercent * 100).toFixed(2)}%`);
            } else {
                const priceImpactPercent = tokensBought;
                currentCandle.c += currentCandle.c * priceImpactPercent;
                if (!playerId.startsWith("FAKE")) console.log(`[BUY] ${playerId} bought ${tokensBought.toFixed(4)} tokens (first buy), impact +${(priceImpactPercent * 100).toFixed(2)}%`);
            }

            if (currentCandle.c > currentCandle.h) currentCandle.h = currentCandle.c;

            player.averageBuy = (player.averageBuy * player.tokens + currentCandle.c * tokensBought) / (player.tokens + tokensBought);
            player.tokens += tokensBought;
            totalTokensInCirculation += tokensBought;
            player.dollars -= amount;
            player.totalInvested += amount;
            player.totalClicks++;
        } else {
            if (!playerId.startsWith("FAKE")) console.warn(`[BUY FAIL] ${playerId} tried to buy ${amount}, but only has ${player.dollars}`);
        }
    }



    if (data.action === 'sell') {
        const tokensToSell = data.amount;

        if (tokensToSell > player.tokens) {
            if (!playerId.startsWith("FAKE")) console.warn(`[SELL BLOCKED] ${playerId} tried to sell ${tokensToSell} tokens, but only has ${player.tokens}`);
            return;
        }

        if (totalTokensInCirculation > 0) {
            const dollarsGained = tokensToSell * currentCandle.c;
            player.tokens -= tokensToSell;
            totalTokensInCirculation -= tokensToSell;
            player.dollars += dollarsGained;
            player.totalSold += dollarsGained;
            player.gains = player.totalSold - player.totalInvested;
            player.totalClicks++;

            const priceImpactPercent = tokensToSell / totalTokensInCirculation;
            currentCandle.c -= currentCandle.c * priceImpactPercent;

            if (currentCandle.c < currentCandle.l) currentCandle.l = currentCandle.c;
            if (currentCandle.c < 0.01) currentCandle.c = 0.01;

            if (!playerId.startsWith("FAKE")) console.log(`[SELL] ${playerId} sold ${tokensToSell.toFixed(4)} tokens, impact -${(priceImpactPercent * 100).toFixed(2)}%`);
        }

    }
}

function broadcastGameState() {
    const leaderboard = Object.entries(players)
        .map(([id, p]) => ({
            id,
            netWorth: p.tokens * currentCandle.c + p.dollars,
            tokens: p.tokens,
            dollars: p.dollars,
            averageBuy: p.averageBuy,
            totalClicks: p.totalClicks
        }))
        .sort((a, b) => b.netWorth - a.netWorth);
    const gameState = { candles, currentCandle, leaderboard, players, totalTokensInCirculation };

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'update', gameState }));
        }
    });

    console.log(`[SYNC] Broadcast to ${wss.clients.size} clients`);
}



const BOT_ADD_INTERVAL = 10000;

function spawnFakeClient() {
    const total = 100;
    for (let i = 0; i < total; i++) {
        let behavior;
        const r = Math.random();
        if (r < 0.05) behavior = 'whale';
        else if (r < 0.2) behavior = 'sniper';
        else behavior = 'sheep';

        const id = `FAKE_${i}_${behavior}`;
        const bot = new FakeClient(id, behavior);

        // donne plus de capital aux whales
        if (behavior === 'whale') bot.player.dollars = 1000;
        else if (behavior === 'sniper') bot.player.dollars = 300;
        else bot.player.dollars = 100;

        fakeClients.push(bot);
    }

}

function startFakeClientSimulation() {
    console.log('[SIMULATION] Starting intelligent fake clients...');

    const total = 50;
    for (let i = 0; i < total; i++) {
        let behavior;
        const r = Math.random();
        if (r < 0.05) behavior = 'whale';
        else if (r < 0.1) behavior = 'sniper';
        else behavior = 'sheep';

        const id = `FAKE_${i}_${behavior}`;
        const bot = new FakeClient(id, behavior);

        // donne plus de capital aux whales
        if (behavior === 'whale') bot.player.dollars = 1000;
        else if (behavior === 'sniper') bot.player.dollars = 300;
        else bot.player.dollars = 100;

        fakeClients.push(bot);
    }

    setInterval(spawnFakeClient, BOT_ADD_INTERVAL);

    setInterval(() => {
        fakeClients.forEach(bot => bot.tick());
        broadcastGameState();
    }, 500);
}
