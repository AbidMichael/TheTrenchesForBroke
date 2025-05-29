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

let coinName = "$" + Math.random().toString(36).substring(2, 5);


// Création du dossier s’il n’existe pas
if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir);
    console.log('[INIT] Dossier "history" créé.');
}

// Serve fichiers statiques
app.use(express.static(path.join(__dirname, 'public')));


// Démarrer serveur
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur HTTP lancé sur le port ${PORT}`);
});

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
    } catch (err) {
        console.error('[LOAD ERROR] Impossible de lire le fichier players.json :', err);
    }
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
            if (!playerId.startsWith("FAKE")) console.warn(`[WARN] Invalid playerId on action:`, playerId);
            return;
        }

        handleAction(playerId, data);
        players[playerId].lastActive = Date.now();
        broadcastGameState();
    });
});



let tokenPool = 10_000_000; // Max number avaible
let marketCap = 100; // Total dollars invested in the token
let totalTokensInCirculation = 0; // Number of token holded by players

let candles = [];
let currentCandle = null


function BuyToken(playerId, amount, forced = false) {

    currentPrice = currentCandle.current_price;
    if (forced || (amount && players[playerId] && players[playerId].dollars >= amount) ) {
        if (!forced) {
            tokenbuyed = amount / currentPrice;
            players[playerId].tokens += tokenbuyed;
            players[playerId].dollars -= amount;
        }
        totalTokensInCirculation += tokenbuyed;

        currentOperation = CreateOperation(playerId, "buy", tokenbuyed, currentPrice);
        currentCandle.operations.push(currentOperation);
        if (!forced) {
            players[playerId].operations.push(currentOperation);
        }

        currentCandle.current_price = (tokenPool - totalTokensInCirculation) / marketCap;
        if (currentCandle.current_price > currentCandle.higher_price) currentCandle.higher_price = currentCandle.current_price;
        if (currentCandle.current_price < currentCandle.lower_price) currentCandle.lower_price = currentCandle.current_price;
    }


}


function SellToken(playerId, amount, forced = false) {

    currentPrice = currentCandle.current_price;

    if (forced || ( amount && players[playerId] && players[playerId].tokens >= amount)) {
        if (!forced) {
            dollarsObtained = amount * currentPrice;
            players[playerId].tokens -= amount;
            players[playerId].dollars += dollarsObtained;
        }
        totalTokensInCirculation -= amount;

        currentOperation = CreateOperation(playerId, "sell", tokenselled, currentPrice);
        currentCandle.operations.push(currentOperation);
        if (!forced) {
            players[playerId].operations.push(currentOperation);
        }

        currentCandle.current_price = (tokenPool - totalTokensInCirculation) / marketCap;
        if (currentCandle.current_price > currentCandle.higher_price) currentCandle.higher_price = currentCandle.current_price;
        if (currentCandle.current_price < currentCandle.lower_price) currentCandle.lower_price = currentCandle.current_price;
    }
}



function CreateOperation(playerid, operationType, amount, price) {
    console.log(`[OPERATION] ${playerid} ${operationType} ${amount} ${price}`)
    return { playerid: playerid, operationType: operationType, amount: amount, price: price };
}

function CreateCandle(open = 100) {
    return { opening_price: open, higher_price: open, lower_price: open, current_price: open, t: Date.now(), operations: [] };
}

currentCandle = CreateCandle(tokenPool / marketCap);
console.log(`[CANDLE] Push first candle: Opening :${currentCandle.opening_price.toFixed(2)} Higher :${currentCandle.higher_price.toFixed(2)} Lower:${currentCandle.lower_price.toFixed(2)} Current:${currentCandle.current_price.toFixed(2)} Number of Operations:${currentCandle.operations.lenght} `);


// Every 2 second, we create a new candles if there has been operations in the current one
setInterval(() => {

    if (currentCandle.operations.length === 0) {
        // No operations done, we dont create a new candles.
    }
    else {
        console.log(`[CANDLE] Push new candle: Opening :${currentCandle.opening_price.toFixed(2)} Higher :${currentCandle.higher_price.toFixed(2)} Lower:${currentCandle.lower_price.toFixed(2)} Current:${currentCandle.current_price.toFixed(2)} Number of Operations:${currentCandle.operations.lenght || 0} `);
        candles.push(currentCandle);
        currentCandle = CreateCandle(currentCandle.current_price);
        broadcastGameState();
    }
}, 2000);





function handleAction(playerId, data) {
    const player = players[playerId];

    if (data.action === 'buy') {
        const amount = data.amount;
        BuyToken(playerId, amount);
        broadcastGameState()
    }

    if (data.action === 'sell') {
        const tokensToSell = data.amount;
        SellToken(playerId, amount)
        broadcastGameState()
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
    const gameState = { candles, currentCandle, leaderboard, players, totalTokensInCirculation, tokenPool, marketCap };

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

// Sauvegarde toutes les 30s
setInterval(savePlayerData, 10 * 1000);



setInterval(() => {

    // Sauvegarde snapshot
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


setInterval(
    () => {
        for (let index = 0; index < 500; index++) {
            BuyToken("dev", Math.random() * 1000,true);
        }

    }, 5000,
    1);


setInterval(
    () => {
        for (let index = 0; index < 5000; index++) {
            BuyToken("dev", Math.random() * 1000,true);
        }

    }, 10000,
    1);
