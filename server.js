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
        this.behavior = behavior;
        this.personality = Math.random() < 0.1 ? 'rugger' : 'believer';
        this.panic = Math.random() < (0.8 - (this.behavior == "whale" ? 0.6 : 0));
        this.player = createNewPlayer(id);
        this.player.isSimulated = true;

        this.amountInvested = 0;
        this.entryPrice = null;
        this.hasRecovered = false;
        this.isExited = false;
        this.waitingToBuy = this.behavior === 'sniper'; // snipers attendent un deep

        this.cooldown = 1000 + Math.floor(Math.random() * 5000);
        this.lastAction = Date.now() - Math.floor(Math.random() * this.cooldown);

        players[id] = this.player;
        
        if (this.behavior === 'sheep') {
            // sheep achètent dès le départ
            this.tryBuyImmediately();
        }
        else if (this.behavior === "whale") {
            const price = currentCandle.c;
            if(price <= p.dollars*4){
                this.tryBuyImmediately();
            }
        }

    }

    tryBuyImmediately() {
        const p = this.player;
        const price = currentCandle.c;
        if (p.dollars > 1) {
            const amount = p.dollars * (0.5 + Math.random() * 0.3);
            this.entryPrice = price;
            this.amountInvested = amount;
            handleAction(this.id, { action: 'buy', amount });
            this.waitingToBuy = false;
        }
    }

    tick() {
        if (this.isExited) return;

        const now = Date.now();
        if (now - this.lastAction < this.cooldown) return;

        const p = this.player;
        const price = currentCandle.c;

        const logger = false; //this.id.includes("FAKE_0_");

        if (logger) console.log(`[BOT] ${this.id} Tick | Tokens: ${p.tokens.toFixed(2)} | Dollars: ${p.dollars.toFixed(2)}`);

        if (p.tokens <= 0.0001 && !this.waitingToBuy) return;

        if (p.tokens <= 0.0001 && this.waitingToBuy && isDeepDetected(candles)) {
            const amount = p.dollars * (0.5 + Math.random() * 0.5);
            this.entryPrice = price;
            this.amountInvested = amount;
            handleAction(this.id, { action: 'buy', amount });
            this.waitingToBuy = false;
            if (logger) console.log(`[BOT] ${this.id} buys ${amount.toFixed(2)} on deep at price ${price.toFixed(2)}`);
            return;
        }

        if (p.tokens > 0 && !this.hasRecovered) {
            const gainRatio = price / this.entryPrice;
            let threshold = 1.5;
            if (this.amountInvested >= 500) threshold = 1.3;
            if (this.amountInvested >= 1000) threshold = 1.2;

            if (gainRatio >= threshold) {
                const recoveryAmount = this.amountInvested;
                const tokensToSell = recoveryAmount / price;
                handleAction(this.id, { action: 'sell', amount: tokensToSell });
                this.hasRecovered = true;
                if (logger) console.log(`[BOT] ${this.id} recovered initial investment at gain ${gainRatio.toFixed(2)}x`);
                return;
            }
        }

        if (p.tokens > 0) {
            const gain = price / this.entryPrice;
            if (gain > 3) {
                const tokensToSell = p.tokens;
                handleAction(this.id, { action: 'sell', amount: tokensToSell });
                this.isExited = true;
                if (logger) console.log(`[BOT] ${this.id} exits market with gain ${gain.toFixed(2)}x`);
            }
        }

        this.lastAction = now;
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

app.post('/reset-game', (req, res) => {
    console.log("[RESET] Resetting game state...");

    players = {};
    fakeClients = [];
    candles = [];
    currentCandle = createCandle();
    totalTokensInCirculation = 10;
    simulationStarted = false;

    res.json({ message: 'Game state has been reset.' });
});