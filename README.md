# 🧱 The Trenches For Broke

**The Trenches For Broke** is a real-time multiplayer web game that mixes the addictive simplicity of clicker games with the high-stakes psychology of crypto trading. Players start with $100 and try to out-trade each other by buying and selling a volatile virtual token whose price is driven entirely by player activity.

---

## 🎮 Gameplay Overview

- 📈 Dynamic candlestick chart (1 candle = 5s of game time)
- 💸 Players start with **$100**
- 💰 Buy and sell tokens with preset or custom amounts
- 📉 Prices fluctuate based on trade volume relative to total token supply
- 🧠 Strategic decisions: buy low, sell high — but panic selling hurts everyone
- 📊 Tokens in circulation, current price, average buy, and total gains are all visible

---

## 📊 Live Leaderboard

The leaderboard updates in real time and shows:

- Player **Net Worth** (Token * Current Price + Cash)
- Number of tokens held
- Average buy price
- Total gains
- Number of trades

Your own position is always displayed, even if you're not in the Top 25.

---

## 🧪 Debug Mode

In development mode, optional test clients ("bots") can simulate market activity for debugging purposes. These bots are **disabled** in the live version.

---

## 🛠️ Tech Stack

**Frontend:**
- HTML5 + CSS3
- Vanilla JavaScript (Canvas API for chart rendering)

**Backend:**
- Node.js
- Express
- WebSocket (via `ws`)

All game state is stored in memory – no database required.

---

## 📁 Project Structure

