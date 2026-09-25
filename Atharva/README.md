# 🔨 Real-Time Live Auction & Bidding Engine

An authoritative, low-latency live auction platform built with **Node.js, Express, and Socket.io**. It prevents race conditions, enforces minimum bid increments, broadcasts targeted outbid alerts, synchronizes a server-side countdown clock across every bidder, and implements **anti-snipe timer extension**.

---

## ✨ Features

- **Authoritative bid engine** — every bid is validated server-side (min increment, self-outbid prohibition, wallet balance simulation, auction-open check).
- **Race-condition safe** — bid handling is fully synchronous (Node's single-threaded event loop already makes it atomic) plus an explicit defensive lock per auction room as a second layer.
- **Server-driven countdown clock** — one `setInterval` per auction room broadcasts `auction:time_tick` every second, so every bidder sees the exact same time regardless of their own device/network.
- **Anti-snipe protection** — a bid placed inside the final window (default: last 15s) resets the clock (default: +20s), preventing last-second sniping.
- **Targeted outbid alerts** — only the specific bidder who was just outbid receives `bid:outbid`; everyone else gets the public `bid:success` broadcast.
- **Live audience counter & auditable bid history** — per-room viewer count and a full, timestamped bid ledger.
- **Multiple concurrent auction rooms** out of the box (guitar, watch, art print — add your own in `data/auctions.js`).
- **Dark "trading floor" UI** with live pulse indicator, shake/urgency effects on the timer, animated banners, and Web Audio beep cues — no external assets required.
- **Deployable as-is** — health check endpoint, `Procfile`, environment-variable configuration, graceful shutdown, and no hard-coded ports.

---

## 🗂️ Project Structure

```
assignment-15-auction-socket/
├── public/
│   ├── index.html         # Live bidding floor UI
│   ├── app.js              # Client socket handlers & bid controls
│   └── style.css           # Dark trading-floor aesthetic & animations
├── sockets/
│   ├── auctionEngine.js    # Bid validation, outbid alerts, anti-snipe trigger
│   └── timerManager.js     # Server-side 1s interval countdown clock
├── data/
│   └── auctions.js         # In-memory auction room state + helpers
├── server.js                # Express + Socket.io server setup
├── package.json
├── Procfile                 # For Heroku-style platforms
├── .env.example
└── README.md
```

---

## 🚀 Getting Started (Local)

```bash
# 1. Install dependencies
npm install

# 2. Copy environment config (defaults already work out of the box)
cp .env.example .env

# 3. Start the server
npm start
# or, for auto-reload during development:
npm run dev
```

The server starts on **http://localhost:5001** by default (configurable via `PORT` in `.env`).

Open the URL in **multiple browser tabs** to simulate multiple bidders.

---

## 📡 Socket Event Protocol

| Event | Direction | Payload | Description |
|---|---|---|---|
| `auction:join` | Client → Server | `{ auctionId, username }` | Join a live bidding room |
| `auction:init` | Server → Client | `{ item, bidHistory, timeRemaining, walletBalance }` | Hydrates a newly-joined bidder |
| `auction:time_tick` | Server → Room | `{ auctionId, timeRemaining }` | Broadcast every second |
| `user:joined` | Server → Room | `{ username, totalViewers }` | Live audience count update |
| `bid:place` | Client → Server | `{ auctionId, amount }` | Place a bid |
| `bid:success` | Server → Room | `{ currentBid, highestBidder, bidHistory, timeRemaining }` | New leading price broadcast |
| `bid:outbid` | Server → Client (targeted) | `{ message }` | Sent only to the just-outbid bidder |
| `bid:rejected` | Server → Client | `{ reason }` | Invalid bid feedback |
| `auction:extended` | Server → Room | `{ message, timeRemaining }` | Anti-snipe clock extension |
| `auction:sold` | Server → Room | `{ winner, finalPrice, status }` | Auction close / result |

---

## ⚙️ Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5001` | Server port (hosting platforms override this automatically) |
| `CORS_ORIGIN` | `*` | Allowed origin(s) for Socket.io/CORS — lock this down in production |
| `ANTI_SNIPE_WINDOW_SECONDS` | `15` | Bids inside this many final seconds trigger an extension |
| `ANTI_SNIPE_EXTENSION_SECONDS` | `20` | Seconds the clock is reset to when anti-snipe triggers |
| `DEFAULT_WALLET_BALANCE` | `150000` | Simulated starting wallet balance per bidder |

---

## 🧪 Testing & Verification

1. Start the server: `npm start` → runs on `http://localhost:5001`.
2. Open **three browser tabs**: Bidder A ("Vikram"), Bidder B ("Ananya"), and Viewer C.
3. Join the **same auction room** from all three tabs.
4. Place a bid from Vikram → verify all three screens update to the new highest bid instantly.
5. Place a higher bid from Ananya → verify Vikram immediately receives a private **"Outbid"** banner (Ananya and Viewer C do not).
6. Wait until the timer drops below 15s, then place a bid → verify the clock jumps back up (**Anti-Snipe** banner + beep).
7. Let the clock hit 0 → verify the room receives `auction:sold`, the UI locks the bid controls, and any further `bid:place` attempts are rejected with `bid:rejected`.
8. Try bidding below the minimum increment, bidding while already the highest bidder, or bidding more than the shown wallet balance → verify each is rejected with a clear reason.

---

## ☁️ Deployment

This app is stateless-per-instance (in-memory store) and listens on `process.env.PORT`, so it deploys cleanly to any Node host. Pick one:

### Render / Railway (recommended, zero config)
1. Push this folder to a GitHub repo.
2. Create a new **Web Service** from the repo.
3. Build command: `npm install` · Start command: `npm start`.
4. Set environment variables from `.env.example` in the dashboard (or leave defaults).
5. The platform injects its own `PORT` — the app already respects `process.env.PORT`, so no code changes are needed.

### Heroku
```bash
heroku create your-auction-app
git push heroku main
heroku config:set CORS_ORIGIN=https://your-auction-app.herokuapp.com
```
The included `Procfile` (`web: node server.js`) is all Heroku needs.

### Docker (any cloud)
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=5001
EXPOSE 5001
CMD ["node", "server.js"]
```
```bash
docker build -t auction-engine .
docker run -p 5001:5001 --env-file .env auction-engine
```

### Notes for production hardening
- Set `CORS_ORIGIN` to your real frontend domain instead of `*`.
- Put the app behind a process manager (`pm2`) or the platform's own restart policy — `server.js` already handles `SIGTERM`/`SIGINT` for zero-downtime redeploys.
- Swap `data/auctions.js`'s in-memory object for Redis/Postgres if you need auctions to survive a restart or to run multiple server instances behind a load balancer (Socket.io's Redis adapter is the standard way to scale this horizontally).

---

## 📊 Grading Rubric Coverage

| Component | Where it lives |
|---|---|
| Real-Time Bid Processing & Validation Engine (30) | `sockets/auctionEngine.js` → `handleBidPlacement` |
| Server-Side Countdown Timer & Anti-Snipe Mechanism (25) | `sockets/timerManager.js` |
| Targeted Outbid Notifications & Live Room Broadcasting (20) | `bid:outbid` (targeted) vs `bid:success` (room) in `auctionEngine.js` |
| Auditable Bid History Feed & Live Viewer Counter (15) | `auction.bidHistory` + `user:joined` viewer count |
| Trading Floor Client UI Polish, Audio/Visual Cues & Architecture (10) | `public/` (dark theme, animations, Web Audio beeps) |
