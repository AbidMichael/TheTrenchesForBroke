const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const historyDir = path.join(__dirname, 'history');
const playerDataFile = path.join(historyDir, 'players.json');
let coinName = "$" + Math.random().toString(36).substring(2, 5);

if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir);
    console.log('[INIT] Dossier "history" créé.');
}

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur HTTP lancé sur le port ${PORT}`);
});

let players = {};
if (fs.existsSync(playerDataFile)) {
    try {
        const savedPlayers = JSON.parse(fs.readFileSync(playerDataFile, 'utf-8'));
        for (const [id, data] of Object.entries(savedPlayers)) {
            players[id] = {
                ...createNewPlayer(id),
                ...data,
            };
        }
    } catch (err) {
        console.error('[LOAD ERROR] Impossible de lire le fichier players.json :', err);
    }
}

function generateId() {
    return 'USER_' + Math.random().toString(36).substring(2, 8);
}

function createNewPlayer(name, data = { bot: false, wallet: null }) {
    return {
        id: name,
        dollars: 500,
        tokens: 0,
        averageBuy: 0,
        gains: 0,
        totalInvested: 0,
        totalSold: 0,
        totalClicks: 0,
        lastActive: Date.now(),
        data: data,
        operations: [],
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
            if (!playerId || !playerId.startsWith("FAKE")) console.warn(`[WARN] Invalid playerId on action:`, playerId);
            return;
        }
        handleAction(playerId, data);
        players[playerId].lastActive = Date.now();
    });
});

// Pump.fun-like parameters
let initialLiquidity = 2500000; // total initial $ for pool (ex: 500 joueurs x 5$)
let reserveBase = initialLiquidity; // dollar reserve
let reserveToken = 1; // on commence avec 1 token (pour éviter div/0)
let priceStep = 1.001; // facteur exponentiel par token, ajustable !
let basePrice = 1; // prix de base

let candles = [];
let currentCandle = null;

function getPumpFunPrice(tokenReserve, baseReserve) {
    // Approximation pump.fun : Prix = basePrice * step^(nb tokens en circulation)
    return basePrice * Math.pow(priceStep, tokenReserve - 1); // -1 car on commence à 1 token
}

function BuyToken(playerId, dollarAmount, forced = false) {
    let boughtTokens = 0;
    let effectiveDollars = dollarAmount;

    if (!forced && (!dollarAmount || !players[playerId] || players[playerId].dollars < dollarAmount)) {
        return;
    }

    // Boucle d'achat : le prix monte à chaque token acheté
    let price, cost;
    for (let i = 0; i < 5000 && effectiveDollars > 0.00001;) { // boucle de sécurité max 5000 tokens
        price = getPumpFunPrice(reserveToken + boughtTokens, reserveBase - effectiveDollars);
        if (price <= 0) break;
        cost = price;
        if (cost > effectiveDollars) break; // plus assez pour acheter un token entier
        boughtTokens += 1;
        effectiveDollars -= cost;
    }
    // Finalement on ajoute les tokens
    if (boughtTokens > 0) {
        if (!forced) {
            players[playerId].tokens += boughtTokens;
            players[playerId].dollars -= (dollarAmount - effectiveDollars);
        }
        reserveToken += boughtTokens;
        reserveBase += (dollarAmount - effectiveDollars);

        let priceNow = getPumpFunPrice(reserveToken, reserveBase);
        let currentOperation = CreateOperation(playerId, "buy", boughtTokens, priceNow);
        currentCandle.operations.push(currentOperation);
        if (!forced && players[playerId]) {
            players[playerId].operations.push(currentOperation);
        }
        currentCandle.current_price = priceNow;
        if (currentCandle.current_price > currentCandle.higher_price) currentCandle.higher_price = currentCandle.current_price;
        if (currentCandle.current_price < currentCandle.lower_price) currentCandle.lower_price = currentCandle.current_price;
    }
}

function SellToken(playerId, amount, forced = false) {
    let sellTokens = amount;
    if (!forced && (!amount || !players[playerId] || players[playerId].tokens < amount)) {
        return;
    }
    let dollarObtained = 0;
    // On simule la vente token par token (le prix baisse à chaque vente)
    let price;
    for (let i = 0; i < sellTokens && reserveToken > 1; i++) {
        price = getPumpFunPrice(reserveToken - 1, reserveBase);
        dollarObtained += price;
        reserveToken -= 1;
    }
    if (dollarObtained > 0) {
        if (!forced) {
            players[playerId].tokens -= sellTokens;
            players[playerId].dollars += dollarObtained;
        }
        reserveBase -= dollarObtained;
        let priceNow = getPumpFunPrice(reserveToken, reserveBase);
        let currentOperation = CreateOperation(playerId, "sell", sellTokens, priceNow);
        currentCandle.operations.push(currentOperation);
        if (!forced && players[playerId]) {
            players[playerId].operations.push(currentOperation);
        }
        currentCandle.current_price = priceNow;
        if (currentCandle.current_price > currentCandle.higher_price) currentCandle.higher_price = currentCandle.current_price;
        if (currentCandle.current_price < currentCandle.lower_price) currentCandle.lower_price = currentCandle.current_price;
    }
}

function CreateOperation(playerid, operationType, amount, price) {
    console.log(`[OPERATION] ${playerid} ${operationType} ${amount} ${price}`);
    return { playerid: playerid, operationType: operationType, amount: amount, price: price };
}

function CreateCandle(open = basePrice) {
    return { opening_price: open, higher_price: open, lower_price: open, current_price: open, t: Date.now(), operations: [] };
}

currentCandle = CreateCandle(getPumpFunPrice(reserveToken, reserveBase));
console.log(`[CANDLE] First candle: Price: ${currentCandle.opening_price}`);

setInterval(() => {
    if (currentCandle.operations.length === 0) {
        // No new candle
    } else {
        console.log(`[CANDLE] Push new candle, Price: ${currentCandle.current_price}`);
        candles.push(currentCandle);
        currentCandle = CreateCandle(currentCandle.current_price);
        broadcastGameState();
    }
}, 2000);

function handleAction(playerId, data) {
    if (data.action === 'buy') {
        const amount = data.amount;
        BuyToken(playerId, amount);
        broadcastGameState();
    }
    if (data.action === 'sell') {
        const tokensToSell = data.amount;
        SellToken(playerId, tokensToSell);
        broadcastGameState();
    }
}

function broadcastGameState() {
    const leaderboard = Object.entries(players)
        .filter(([id, p]) => id !== 'dev')
        .map(([id, p]) => ({
            id,
            netWorth: p.tokens * currentCandle.current_price + p.dollars,
            tokens: p.tokens,
            dollars: p.dollars,
            averageBuy: p.averageBuy,
            totalClicks: p.totalClicks
        }))
        .sort((a, b) => b.netWorth - a.netWorth);
    const gameState = { candles, currentCandle, leaderboard, players, reserveToken, reserveBase };
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'update', gameState }));
        }
    });
}

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
                lastActive: p.lastActive,
                operations: p.operations
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
setInterval(savePlayerData, 10 * 1000);

setInterval(() => {
    const snapshot = {
        timestamp: new Date().toISOString(),
        candles: [...candles, currentCandle],
        players: players,
        leaderboard: Object.entries(players).map(([id, p]) => ({
            id,
            dollars: p.dollars,
            gains: p.gains
        }))
    };
    const fileName = `market_snapshot_${coinName}_${Date.now()}.json`;
    fs.writeFileSync(path.join(historyDir, fileName), JSON.stringify(snapshot, null, 2));
    console.log(`[SNAPSHOT] Saved to ${fileName}`);
}, 60 * 1000);

// Simulation bots/dev
setInterval(() => {
    for (let index = 0; index < 100; index++) {
        BuyToken("dev", Math.random() * 50, true);
    }
}, 5000,10000);

setInterval(() => {
    for (let index = 0; index < 1000; index++) {
        BuyToken("dev", Math.random() * 50, true);
    }
}, 10000,15000);
