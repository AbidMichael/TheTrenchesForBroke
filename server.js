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


function isDeepDetected(candles, threshold = 0.2) {
    if (candles.length < 5) return true; // Considère qu'il y a un deep s'il n'y a pas assez de candles

    const recent = candles.slice(-5);
    const maxHigh = Math.max(...recent.map(c => c.h));
    const minLow = Math.min(...recent.map(c => c.l));

    const variation = (maxHigh - minLow) / maxHigh;
    return variation >= threshold;
}

class FakeClient {
    constructor(id, behavior) {
        this.id = id;
        this.behavior = behavior; // 'whale', 'sheep', 'sniper'
        this.personality = Math.random() < 0.1 ? 'rugger' : 'believer';
        this.state = 'waiting';

        this.player = createNewPlayer(id);
        this.player.isSimulated = true;

        this.entryPrice = null;
        this.stopLoss = null;
        this.takeProfit = null;
        this.hasExited = false;
        this.amountInvested = 0;

        players[id] = this.player;

        // Seul le premier bot créé a un flag de log activé
        this.enableLogs = fakeClients.length === 0;
    }

    tick() {
        const p = this.player;
        const price = currentCandle.c;
        const lastCandles = candles.slice(-5);

        if (this.hasExited) return;

        if (this.enableLogs) {
            console.log(`\n[${this.id}] Tick START`);
            console.log(`Current price: ${price.toFixed(2)}`);
            console.log(`Entry price: ${this.entryPrice}`);
            console.log(`Stop loss: ${this.stopLoss}`);
            console.log(`Take profit: ${this.takeProfit}`);
            console.log(`Has exited: ${this.hasExited}`);
            console.log(`Dollars: ${p.dollars.toFixed(2)} | Tokens: ${p.tokens.toFixed(4)}`);
        }

        // Si pas encore entré
        if (!this.entryPrice && p.dollars > 0) {
            const deepDetected = isDeepDetected(candles);
            const recentHigh = Math.max(...lastCandles.map(c => c.h));
            const recentLow = Math.min(...lastCandles.map(c => c.l));

            let entryThreshold = 0;
            if (this.behavior === 'whale') entryThreshold = recentLow * 1.1;
            else if (this.behavior === 'sniper') entryThreshold = recentLow * 1.05;
            else entryThreshold = recentLow * 1.2;

            if (this.enableLogs) {
                console.log(`Evaluating entry: price <= ${entryThreshold.toFixed(2)} | deepDetected: ${deepDetected}`);
            }

            if (price <= entryThreshold && deepDetected) {
                const amount = p.dollars;
                this.entryPrice = price;
                this.amountInvested = amount;

                handleAction(this.id, { action: 'buy', amount });

                const capitalFactor = amount >= 500 ? 1.5 : amount >= 200 ? 1.7 : 2.0;
                this.takeProfit = this.entryPrice * capitalFactor;
                this.stopLoss = this.entryPrice * 0.6;

                if (this.enableLogs) {
                    console.log(`[BUY] at ${price.toFixed(2)} for ${amount.toFixed(2)}$ | TP: ${this.takeProfit.toFixed(2)} | SL: ${this.stopLoss.toFixed(2)}`);
                }
                return;
            }
        }

        if (this.entryPrice && p.tokens > 0) {
            const currentValue = p.tokens * price;
            const net = currentValue + p.dollars;
            const gains = price / this.entryPrice;

            if (price <= this.stopLoss) {
                handleAction(this.id, { action: 'sell', amount: p.tokens });
                this.hasExited = true;
                if (this.enableLogs) console.log(`[STOPLOSS] Selling all at ${price.toFixed(2)}`);
                return;
            }

            if (!this.initialWithdrawn && price >= this.takeProfit) {
                const recoveryAmount = this.amountInvested;
                const sellAmount = recoveryAmount / price;
                handleAction(this.id, { action: 'sell', amount: Math.min(sellAmount, p.tokens) });
                this.initialWithdrawn = true;
                if (this.enableLogs) console.log(`[TAKE PROFIT] Selling ${Math.min(sellAmount, p.tokens).toFixed(4)} to recover ${recoveryAmount.toFixed(2)}$`);
                return;
            }

            if (gains >= 3.0 || (this.personality === 'rugger' && gains >= 2.0)) {
                handleAction(this.id, { action: 'sell', amount: p.tokens });
                this.hasExited = true;
                if (this.enableLogs) console.log(`[EXIT] Selling all for ${gains.toFixed(2)}x gain`);
                return;
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
    //console.log(`[PLAYER] Creating new player`);
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

    // console.log(`[SYNC] Broadcast to ${wss.clients.size} clients`);
}



const BOT_ADD_INTERVAL = 10000;

function spawnFakeClient() {
    const total = 10;
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

    const total = 10;
    for (let i = 0; i < total; i++) {
        let behavior;
        const r = Math.random();
        if (r < 0.8) behavior = 'whale';
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

startFakeClientSimulation();