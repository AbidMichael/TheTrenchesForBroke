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
let initialLiquidity = 2500; // total initial $ for pool (ex: 500 joueurs x 5$)
let reserveBase = initialLiquidity; // dollar reserve
let reserveToken = 1; // on commence avec 1 token (pour éviter div/0)
let priceStep = 1.1; // facteur exponentiel par token, ajustable !
let basePrice = 100; // prix de base

let candles = [];
let currentCandle = null;

function getPumpFunPrice(tokenReserve) {
    return basePrice * Math.pow(priceStep, tokenReserve - 1);
}

function BuyToken(playerId, dollarAmount, forced = false) {
    if (!forced && (!dollarAmount || !players[playerId] || players[playerId].dollars < dollarAmount)) {
        return;
    }

    // On veut calculer combien de tokens on peut acheter pour dollarAmount $
    let S = reserveToken;
    let step = priceStep;
    let P0 = basePrice;
    let A = dollarAmount;

    // Formule inversée, fractions OK :
    let tokensBought = (Math.log((A * (step - 1)) / P0 + Math.pow(step, S)) / Math.log(step)) - S;

    if (tokensBought <= 0) return;

    if (!forced) {
        players[playerId].tokens += tokensBought;
        players[playerId].dollars -= dollarAmount;
    }
    reserveToken += tokensBought;

    let priceNow = getPumpFunPrice(reserveToken);
    let currentOperation = CreateOperation(playerId, "buy", tokensBought, priceNow);
    currentCandle.operations.push(currentOperation);
    if (!forced && players[playerId]) {
        players[playerId].operations.push(currentOperation);
    }
    currentCandle.current_price = priceNow;
    if (currentCandle.current_price > currentCandle.higher_price) currentCandle.higher_price = currentCandle.current_price;
    if (currentCandle.current_price < currentCandle.lower_price) currentCandle.lower_price = currentCandle.current_price;
    broadcastGameState();
}



function SellToken(playerId, tokensToSell, forced = false) {
    if (!forced && (!tokensToSell || !players[playerId] || players[playerId].tokens < tokensToSell)) {
        return;
    }

    let S = reserveToken;
    let step = priceStep;
    let P0 = basePrice;

    if (tokensToSell > S - 1e-9) tokensToSell = S - 1e-9; // Ne pas vendre plus que la supply

    let dollarObtained = P0 * (Math.pow(step, S) - Math.pow(step, S - tokensToSell)) / (step - 1);

    if (dollarObtained <= 0) return;

    if (!forced) {
        players[playerId].tokens -= tokensToSell;
        players[playerId].dollars += dollarObtained;
    }
    reserveToken -= tokensToSell;

    let priceNow = getPumpFunPrice(reserveToken);
    let currentOperation = CreateOperation(playerId, "sell", tokensToSell, priceNow);
    currentCandle.operations.push(currentOperation);
    if (!forced && players[playerId]) {
        players[playerId].operations.push(currentOperation);
    }
    currentCandle.current_price = priceNow;
    if (currentCandle.current_price > currentCandle.higher_price) currentCandle.higher_price = currentCandle.current_price;
    if (currentCandle.current_price < currentCandle.lower_price) currentCandle.lower_price = currentCandle.current_price;
    broadcastGameState();
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

// Système de simulation de bots crédibles pour pumpfun
// Activation/désactivation et commandes admin inclues

// --- BOT ENGINE ---
const BOT_TYPES = {
    whale: {
        minBuy: 1000,
        maxBuy: 8000,
        minSell: 800,
        maxSell: 6000,
        behavior: 'market_mover', // peut pump ou dump violemment
        probBuy: 0.25,
        probSell: 0.18,
        holdRatio: 0.7 // % du portefeuille max qu'il accepte de stacker
    },
    sheep: {
        minBuy: 2,
        maxBuy: 60,
        minSell: 2,
        maxSell: 60,
        behavior: 'follow_trend', // copie la tendance du marché
        probBuy: 0.10,
        probSell: 0.13,
        holdRatio: 0.2
    },
    sniper: {
        minBuy: 50,
        maxBuy: 800,
        minSell: 30,
        maxSell: 700,
        behavior: 'volatility_hunter', // achète ou vend en pic
        probBuy: 0.11,
        probSell: 0.13,
        holdRatio: 0.4
    }
};

const BOTS = [];
let botsActivated = true;


function createBot(id, type = 'sheep') {
    const botConfig = BOT_TYPES[type] || BOT_TYPES.sheep;
    const botId = id || `FAKE_${type}_${Math.random().toString(36).slice(2, 8)}`;
    players[botId] = createNewPlayer(botId, { bot: true, type });
    players[botId].dollars = 25000 + Math.random()*15000;
    players[botId].botType = type;
    players[botId].emotion = 'neutral';
    players[botId].memory = [];
    players[botId].lastActionTime = Date.now();
    players[botId].patience = Math.floor(Math.random() * 6) + 2;
    players[botId].lossTolerance = 0.18 + Math.random() * 0.2;
    players[botId].greedTolerance = 0.15 + Math.random() * 0.25;
    players[botId].fomoCounter = 0;
    // Nouveau: chaque bot décide son prochain « tick »
    players[botId].nextActionTime = Date.now() + 1000 + Math.random() * 3500;
    BOTS.push({ id: botId, type, ...botConfig, forcedAction: null });
    return botId;
}

// Crée différents profils de bots
for (let i = 0; i < 12; i++) createBot(null, 'sheep');
for (let i = 0; i < 4; i++) createBot(null, 'whale');
for (let i = 0; i < 5; i++) createBot(null, 'sniper');

function simulateBot(bot) {
    if (!botsActivated) return;
    const p = players[bot.id];
    if (!p) return;
    const now = Date.now();

    // Ajoute cette ligne : si ce n'est pas encore le moment, skip !
    if (now < p.nextActionTime) return;

    // Décider s’il fait une action ce cycle
    let doNothing = Math.random() < 0.32; // 32% chance de skip
    // Effet patience (agit si rien fait depuis longtemps)
    let inactiveCycles = Math.floor((now - (p.lastActionTime || 0)) / 1500);
    if (inactiveCycles > p.patience) doNothing = false;

    // --- Mémoire: stock prix achat/vente
    if (!p.memory) p.memory = [];
    if (p.memory.length > 10) p.memory.shift();

    // Calcul PRU (prix moyen d’achat)
    let totalBuy = 0, totalCost = 0;
    for (const m of p.memory) {
        if (m.type === 'buy') {
            totalBuy += m.amount;
            totalCost += m.amount * m.price;
        }
    }
    const avgBuy = totalBuy ? totalCost / totalBuy : currentCandle.current_price;

    // Check gain ou perte latente
    let profitPerc = (currentCandle.current_price - avgBuy) / avgBuy;

    // Update émotion selon tendance du marché
    const candlesBack = Math.min(3, candles.length);
    let upCount = 0, downCount = 0;
    for (let i = 1; i <= candlesBack; i++) {
        if (candles[candles.length - i] && candles[candles.length - i].current_price > candles[candles.length - i].opening_price) upCount++;
        else if (candles[candles.length - i]) downCount++;
    }

    if (downCount >= 2) p.emotion = 'panic';
    else if (upCount >= 2) p.emotion = 'fomo';
    else if (profitPerc < -p.lossTolerance) p.emotion = 'fear';
    else if (profitPerc > p.greedTolerance) p.emotion = 'greed';
    else p.emotion = 'neutral';

    // Décision d’action (order: panic > fomo > greed > normal)
    let action = null;
    let amount = 0;

    if (!doNothing) {
        if (p.emotion === 'panic' && p.tokens > 0) {
            // Panic sell tout !
            action = 'sell';
            amount = Math.min(p.tokens, Math.floor(p.tokens * (0.5 + Math.random() * 0.5)));
        } else if (p.emotion === 'fomo' && p.dollars > bot.minBuy) {
            // All-in FOMO achat
            action = 'buy';
            amount = Math.floor(bot.minBuy + Math.random() * (bot.maxBuy - bot.minBuy));
        } else if (p.emotion === 'fear' && p.tokens > 0) {
            // Sell une partie
            action = 'sell';
            amount = Math.max(1, Math.floor(p.tokens * 0.2));
        } else if (p.emotion === 'greed' && p.tokens > 0) {
            // Take profit sur 30-70% du bag
            action = 'sell';
            amount = Math.floor(p.tokens * (0.3 + Math.random() * 0.4));
        } else if (p.emotion === 'neutral') {
            // Standard selon type originel
            const rand = Math.random();
            if (bot.behavior === 'market_mover' && rand < bot.probBuy && p.dollars > bot.maxBuy) {
                action = 'buy';
                amount = Math.floor(bot.minBuy + Math.random() * (bot.maxBuy - bot.minBuy));
            } else if (bot.behavior === 'follow_trend' && upCount > downCount && rand < bot.probBuy) {
                action = 'buy';
                amount = Math.floor(bot.minBuy + Math.random() * (bot.maxBuy - bot.minBuy));
            } else if (bot.behavior === 'volatility_hunter' && Math.abs(profitPerc) > 0.02 && rand < bot.probSell && p.tokens > bot.minSell) {
                action = 'sell';
                amount = Math.floor(bot.minSell + Math.random() * (bot.maxSell - bot.minSell));
            }
        }
    }

    // Action finale
    if (action && amount > 0) {
        if (action === 'buy') BuyToken(bot.id, amount);
        else if (action === 'sell') SellToken(bot.id, amount);

        // Stocke dans la mémoire
        p.memory.push({ type: action, amount, price: currentCandle.current_price, time: now });
        p.lastActionTime = now;
        p.patience = Math.floor(Math.random() * 6) + 2; // Reset patience
        p.nextActionTime = now + (1000 + Math.random() * 4000);
    }
    
}


function runBotEngine() {
    if (!botsActivated) return;
    for (const bot of BOTS) {
        try { simulateBot(bot); } catch (e) { console.log('Bot crash', e); }
    }
}
setInterval(runBotEngine, 500);

// Commandes pour l'admin (à brancher sur un panel futur)
function setBotsActive(state) {
    botsActivated = state;
}
function forceBotAction(botId, actionType, amount) {
    const bot = BOTS.find(b => b.id === botId);
    if (bot) bot.forcedAction = { type: actionType, amount };
}