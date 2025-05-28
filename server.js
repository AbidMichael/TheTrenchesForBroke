const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });


const fs = require('fs');
const historyDir = path.join(__dirname, 'history');

const playerDataFile = path.join(__dirname, 'history', 'players.json');


// Création du dossier s’il n’existe pas
if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir);
    console.log('[INIT] Dossier "history" créé.');
}

// Création du dossier s’il n’existe pas
if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir);
    console.log('[INIT] Dossier "history" créé.');
}

let transactionLog = [];

// Serve fichiers statiques
app.use(express.static(path.join(__dirname, 'public')));

// Démarrer serveur
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur HTTP lancé sur le port ${PORT}`);
});

const SELL_PERCENTAGES = [0.1, 0.25, 0.5, 0.75, 0.9, 1];

let coinName = "$" + Math.random().toString(36).substring(2, 5);

let players = {};
// Charger les données des joueurs si elles existent
if (fs.existsSync(playerDataFile)) {
    try {
        const savedPlayers = JSON.parse(fs.readFileSync(playerDataFile, 'utf-8'));
        for (const [id, data] of Object.entries(savedPlayers)) {
            players[id] = {
                ...createNewPlayer(id), // pour garantir les propriétés par défaut
                ...data, // overwrite avec les données sauvegardées
            };
        }
        console.log(`[LOAD] Données de ${Object.keys(players).length} joueur(s) chargées.`);
        const totalMoney = Object.values(players).reduce((sum, p) => sum + p.dollars, 0);
        const newPrice = totalMoney / Object.keys(players).length * 0.01;
        currentCandle = createCandle(newPrice);
    } catch (err) {
        console.error('[LOAD ERROR] Impossible de lire le fichier players.json :', err);
    }
}
let candles = [];
let totalTokensInCirculation = 1;
currentCandle = createCandle(100);

let simulationStarted = false;
let fakeClients = [];

let rugDetected = false;
let rugCheckWindow = [];

function checkForRug(currentPrice) {
    const now = Date.now();
    rugCheckWindow.push({ time: now, price: currentPrice });

    // Garder les 20 dernières secondes
    rugCheckWindow = rugCheckWindow.filter(p => now - p.time <= 20000);

    if (rugCheckWindow.length >= 2) {
        const first = rugCheckWindow[0].price;
        const last = rugCheckWindow[rugCheckWindow.length - 1].price;
        const drop = (first - last) / first;

        if (drop >= 0.5) {
            rugDetected = true;
            console.warn(`[RUG DETECTED] Drop of ${(drop * 100).toFixed(2)}% detected!`);
            return true;
        }
    }

    return false;
}


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
        this.waitingToBuy = this.behavior === 'sniper';

        this.cooldown = 1000 + Math.floor(Math.random() * 5000);
        this.lastAction = Date.now() - Math.floor(Math.random() * this.cooldown);
        this.resetTimeout = null;

        players[id] = this.player;

        if (this.behavior === 'sheep') {
            this.tryBuyImmediately();
        }
        else if (this.behavior === "whale") {
            const price = currentCandle.c;
            if (price <= 10000) {
                this.tryBuyImmediately();
            }
        }
    }

    resetInvestmentCycle() {
        if (this.isExited && this.player.dollars <= 5 && !this.waitingToBuy) {
            // Recharge le bot comme s’il revenait
            if (this.behavior === 'whale') this.player.dollars = 1000;
            else if (this.behavior === 'sniper') this.player.dollars = 300;
            else this.player.dollars = 100;

            this.amountInvested = 0;
            this.entryPrice = null;
            this.hasRecovered = false;
            this.isExited = false;
            this.waitingToBuy = this.behavior === 'sniper';

            console.log(`[BOT] ${this.id} re-injected capital and reset`);
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

        const logger = false;

        if (logger) console.log(`[BOT] ${this.id} Tick | Tokens: ${p.tokens.toFixed(2)} | Dollars: ${p.dollars.toFixed(2)}`);

        if (rugDetected && this.player.tokens > 0 && !this.isExited) {
            const amount = this.player.tokens;
            handleAction(this.id, { action: 'sell', amount });
            this.isExited = true;

            if (this.id.includes("FAKE_0_")) {
                if (logger) console.log(`[BOT] ${this.id} rug panic sell at price ${currentCandle.c.toFixed(2)}`);
            }
            return;
        }

        // Inject random volatility
        const shock = this.injectVolatility();
        if (shock > 1.5 && this.behavior === 'sheep' && p.dollars > 5) {
            const amount = p.dollars * 0.6;
            handleAction(this.id, { action: 'buy', amount });
            if (logger) console.log(`[BOT] ${this.id} FOMO buys during pump`);
        }
        if (shock < 0.7 && this.behavior === 'sheep' && p.tokens > 0.1) {
            const amount = p.tokens * 0.5;
            handleAction(this.id, { action: 'sell', amount });
            if (logger) console.log(`[BOT] ${this.id} panic sells during dump`);
        }

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

        if (this.behavior === 'sniper') {
            const tokenShare = p.tokens / totalTokensInCirculation;
            const gain = price / this.entryPrice;
            if (this._heldOver5 && tokenShare <= 0.05 && gain > 1.05) {
                handleAction(this.id, { action: 'sell', amount: p.tokens });
                this.isExited = true;
                if (logger) console.log(`[BOT] ${this.id} sniper selling all after falling under 5% with profit`);
                return;
            }
            this._heldOver5 = tokenShare > 0.05;
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

        this.resetInvestmentCycle();
        this.lastAction = now;

    }

    injectVolatility() {
        const chance = Math.random();
        if (chance < 0.01) return 1.2 + Math.random() * 0.5;
        if (chance > 0.99) return 0.5 + Math.random() * 0.3;
        return 1;
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
    checkForRug(currentCandle.c);
    if (rugDetected && Date.now() - rugCheckWindow[0].time > 30000) {
        rugDetected = false;
        rugCheckWindow = [];
        console.log(`[RUG RESET] Panic ended`);
    }
    broadcastGameState();
}, 1000);

function createCandle(open = 100) {
    return { o: open, h: open, l: open, c: open, t: Date.now() };
}

function generateId() {
    return Math.random().toString(36).substring(2, 32);
}

function createNewPlayer(name) {
    //console.log(`[PLAYER] Creating new player`);
    return {
        id: name,
        dollars: 500,
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
            transactionLog.push({
                playerId,
                type: data.action,
                amount: data.amount,
                price: currentCandle.c,
                time: Date.now()
            });
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
            transactionLog.push({
                playerId,
                type: data.action,
                amount: data.amount,
                price: currentCandle.c,
                time: Date.now()
            });
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



const BOT_ADD_INTERVAL = 1000;

function spawnFakeClient() {
    const baseRate = 1; // nombre de bots minimum à ajouter

    const price = currentCandle.c;
    const volume = totalTokensInCirculation;

    // Calcul dynamique du nombre de bots à spawn en fonction du volume et du prix
    let multiplier = 1;
    if (price > 5000) multiplier += 3;
    if (price > 20000) multiplier += 5;
    if (volume > 100) multiplier += 5;
    if (volume > 1000) multiplier += 20;

    const botsToAdd = Math.min(10, baseRate * multiplier); // Limite haute pour éviter le spam

    for (let i = 0; i < botsToAdd; i++) {
        let behavior;
        const r = Math.random();
        if (r < 0.05) behavior = 'whale';
        else if (r < 0.2) behavior = 'sniper';
        else behavior = 'sheep';

        const id = `FAKE_${Date.now()}_${Math.floor(Math.random() * 100000)}_${behavior}`;
        const bot = new FakeClient(id, behavior);

        // donne plus de capital aux whales
        if (behavior === 'whale') bot.player.dollars = 15000;
        else if (behavior === 'sniper') bot.player.dollars = 1000;
        else bot.player.dollars = 200;

        fakeClients.push(bot);
    }
}

function startFakeClientSimulation() {
    console.log('[SIMULATION] Starting intelligent fake clients...');

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



setInterval(() => {
    console.log('[RESET] Market reset triggered.');

    // Sauvegarde snapshot
    const snapshot = {
        timestamp: new Date().toISOString(),
        candles: [...candles, currentCandle],
        transactions: [...transactionLog],
        leaderboard: Object.entries(players).map(([id, p]) => ({
            id,
            dollars: p.dollars,
            gains: p.gains
        }))
    };

    const fileName = `market_snapshot_${coinName}_${Date.now()}.json`;
    fs.writeFileSync(path.join(historyDir, fileName), JSON.stringify(snapshot, null, 2));
    console.log(`[SNAPSHOT] Saved to ${fileName}`);
}, 30 * 1000); // toutes les 5 minutes

setInterval(() => {
    // Reset

    // Force sell de tous les tokens
    for (const [id, player] of Object.entries(players)) {
        if (player.tokens > 0) {
            player.totalSold += 0;
            player.gains = 0;
            player.tokens = 0;
        }
    }

    candles = [];
    transactionLog = [];

    const totalMoney = Object.values(players).reduce((sum, p) => sum + p.dollars, 0);
    const newPrice = totalMoney / Object.keys(players).length * 0.01;

    totalTokensInCirculation = 0;
    currentCandle = createCandle(newPrice);

    console.log(`[RESET] New token price set to ${newPrice.toFixed(2)}`);

    broadcastGameState();
    savePlayerData();
}, 5 * 60 * 1000); // toutes les 5 minutes



function savePlayerData() {
    const toSave = {};
    for (const [id, p] of Object.entries(players)) {
        if (!p.isSimulated) {
            toSave[id] = {
                dollars: p.dollars,
                tokens: p.tokens,
                averageBuy: p.averageBuy,
                gains: p.gains,
                totalInvested: p.totalInvested,
                totalSold: p.totalSold,
                totalClicks: p.totalClicks,
                lastActive: p.lastActive
            };
        }
    }

    try {
        fs.writeFileSync(playerDataFile, JSON.stringify(toSave, null, 2));
        console.log('[SAVE] Données des joueurs sauvegardées.');
    } catch (err) {
        console.error('[SAVE ERROR] Échec de la sauvegarde des joueurs :', err);
    }
}

// Sauvegarde toutes les 30s
setInterval(savePlayerData, 30 * 1000);