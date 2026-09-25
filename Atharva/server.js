require('dotenv').config();

const path = require('path');
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const registerAuctionSockets = require('./sockets/auctionEngine');
const { startAllTimers, stopAllTimers } = require('./sockets/timerManager');
const { listAuctionSummaries, getAuctionPublicState } = require('./data/auctions');

const PORT = process.env.PORT || 5001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- Health & diagnostics (useful for uptime checks on Render/Railway/Heroku) ----
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
});

// ---- Read-only REST helpers (handy for a landing page / lobby list) ----
app.get('/api/auctions', (req, res) => {
  res.json(listAuctionSummaries());
});

app.get('/api/auctions/:id', (req, res) => {
  const state = getAuctionPublicState(req.params.id);
  if (!state) return res.status(404).json({ error: 'Auction not found' });
  res.json(state);
});

// Fallback to the SPA shell for any unknown non-API route
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] }
});

registerAuctionSockets(io);
startAllTimers(io);

server.listen(PORT, () => {
  console.log(`🔨 Live Auction & Bidding Engine running on port ${PORT}`);
  console.log(`   Local:      http://localhost:${PORT}`);
  console.log(`   Health:     http://localhost:${PORT}/health`);
});

// ---- Graceful shutdown so intervals/timers don't leak on redeploys ----
function shutdown(signal) {
  console.log(`\n${signal} received: shutting down gracefully...`);
  stopAllTimers();
  server.close(() => {
    console.log('HTTP server closed. Bye!');
    process.exit(0);
  });
  // Force-exit if something hangs
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
