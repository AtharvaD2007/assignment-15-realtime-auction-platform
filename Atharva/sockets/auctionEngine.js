/**
 * sockets/auctionEngine.js
 * ------------------------
 * Authoritative bid validation engine + socket event wiring.
 *
 * RACE-CONDITION SAFETY
 * ----------------------
 * Node.js runs JavaScript on a single thread. As long as a socket handler
 * contains no `await` between reading auction state and writing it back,
 * the whole check-then-update sequence executes as one atomic "tick" of
 * the event loop — no other bid for the same auction can interleave in
 * the middle of it, even if two bids arrive in the same millisecond.
 * `handleBidPlacement` below is written to be 100% synchronous for this
 * exact reason. On top of that we add an explicit per-auction `isLocked`
 * flag as a defensive second layer, so that if this function is ever
 * extended with an `await` (e.g. a real database write), concurrent bids
 * still cannot corrupt state — a locked auction simply queues/rejects
 * until the lock clears.
 */

const { auctions, getAuctionPublicState } = require('../data/auctions');
const { extendTimer } = require('./timerManager');

const ANTI_SNIPE_WINDOW_SECONDS = parseInt(process.env.ANTI_SNIPE_WINDOW_SECONDS || '15', 10);
const ANTI_SNIPE_EXTENSION_SECONDS = parseInt(process.env.ANTI_SNIPE_EXTENSION_SECONDS || '20', 10);
const DEFAULT_WALLET_BALANCE = parseInt(process.env.DEFAULT_WALLET_BALANCE || '150000', 10);
const MIN_MS_BETWEEN_BIDS = 250; // per-socket throttle to stop spam / accidental double-clicks

// Defensive lock map: auctionId -> boolean
const auctionLocks = {};

/**
 * Core authoritative bid handler. Fully synchronous by design (see note above).
 */
function handleBidPlacement(io, socket, auction, bidAmount, username) {
  // 0. Defensive lock (belt-and-suspenders; see file header)
  if (auctionLocks[auction.id]) {
    return socket.emit('bid:rejected', { reason: 'Auction is busy processing another bid, try again' });
  }
  auctionLocks[auction.id] = true;

  try {
    // 1. Basic payload sanity
    if (typeof bidAmount !== 'number' || !Number.isFinite(bidAmount) || bidAmount <= 0) {
      return socket.emit('bid:rejected', { reason: 'Invalid bid amount' });
    }

    // 2. Auction must be active and clock must still be running
    if (auction.status !== 'active' || auction.timeRemainingSeconds <= 0) {
      return socket.emit('bid:rejected', { reason: 'Auction is closed' });
    }

    // 3. Self-outbid prohibition
    if (auction.highestBidder && auction.highestBidder.socketId === socket.id) {
      return socket.emit('bid:rejected', { reason: 'You are already the highest bidder' });
    }

    // 4. Minimum increment enforcement
    const minimumRequired = auction.currentBid + auction.minIncrement;
    if (bidAmount < minimumRequired) {
      return socket.emit('bid:rejected', {
        reason: `Bid too low. Minimum valid bid is ₹${minimumRequired.toLocaleString('en-IN')}`
      });
    }

    // 5. Wallet balance simulation
    const walletBalance = socket.data.walletBalance ?? DEFAULT_WALLET_BALANCE;
    if (bidAmount > walletBalance) {
      return socket.emit('bid:rejected', {
        reason: `Insufficient simulated wallet balance (₹${walletBalance.toLocaleString('en-IN')})`
      });
    }

    // 6. Capture previous highest bidder to notify outbid
    const previousBidder = auction.highestBidder;

    // 7. Commit state update (this is the atomic write)
    auction.currentBid = bidAmount;
    auction.highestBidder = { socketId: socket.id, username };
    auction.bidHistory.unshift({
      bidder: username,
      amount: bidAmount,
      timestamp: new Date().toLocaleTimeString('en-IN', { hour12: false })
    });
    // Keep the audit trail bounded so memory doesn't grow unbounded on long auctions
    if (auction.bidHistory.length > 200) auction.bidHistory.length = 200;

    // 8. Anti-Snipe Rule: bid inside the final window resets/extends the clock
    let extended = false;
    if (auction.timeRemainingSeconds < ANTI_SNIPE_WINDOW_SECONDS) {
      extendTimer(auction.id, ANTI_SNIPE_EXTENSION_SECONDS);
      extended = true;
      io.to(auction.id).emit('auction:extended', {
        auctionId: auction.id,
        timeRemaining: auction.timeRemainingSeconds,
        message: `Anti-snipe triggered: +${ANTI_SNIPE_EXTENSION_SECONDS} seconds added!`
      });
    }

    // 9. Broadcast new leading price + full bid history snapshot to the room
    io.to(auction.id).emit('bid:success', {
      auctionId: auction.id,
      currentBid: auction.currentBid,
      highestBidder: username,
      bidHistory: auction.bidHistory,
      timeRemaining: auction.timeRemainingSeconds,
      antiSnipeTriggered: extended
    });

    // 10. Targeted private alert to the bidder who just got outbid
    if (previousBidder && previousBidder.socketId !== socket.id) {
      io.to(previousBidder.socketId).emit('bid:outbid', {
        auctionId: auction.id,
        message: `You were outbid by ${username} at ₹${bidAmount.toLocaleString('en-IN')}!`
      });
    }
  } finally {
    auctionLocks[auction.id] = false;
  }
}

/**
 * Registers every Socket.io event for the auction floor.
 * Call once per server: registerAuctionSockets(io)
 */
function registerAuctionSockets(io) {
  io.on('connection', (socket) => {
    // Per-connection simulated wallet + bid-throttle bookkeeping
    socket.data.walletBalance = DEFAULT_WALLET_BALANCE;
    socket.data.lastBidAt = 0;
    socket.data.username = null;
    socket.data.auctionId = null;

    // ---- JOIN A LIVE AUCTION ROOM -----------------------------------
    socket.on('auction:join', ({ auctionId, username }) => {
      const auction = auctions[auctionId];
      if (!auction) {
        return socket.emit('bid:rejected', { reason: 'Auction not found' });
      }
      if (!username || typeof username !== 'string' || !username.trim()) {
        return socket.emit('bid:rejected', { reason: 'A username is required to join' });
      }

      // Leave any previous auction room this socket was in
      if (socket.data.auctionId && socket.data.auctionId !== auctionId) {
        socket.leave(socket.data.auctionId);
      }

      socket.data.username = username.trim().slice(0, 30);
      socket.data.auctionId = auctionId;
      socket.join(auctionId);

      // Hydrate the newly joined bidder with current state
      socket.emit('auction:init', {
        item: getAuctionPublicState(auctionId),
        bidHistory: auction.bidHistory,
        timeRemaining: auction.timeRemainingSeconds,
        walletBalance: socket.data.walletBalance
      });

      // Update live viewer count for everyone in the room
      const room = io.sockets.adapter.rooms.get(auctionId);
      const totalViewers = room ? room.size : 1;
      io.to(auctionId).emit('user:joined', {
        username: socket.data.username,
        totalViewers
      });
    });

    // ---- PLACE A BID --------------------------------------------------
    socket.on('bid:place', ({ auctionId, amount }) => {
      const auction = auctions[auctionId];
      if (!auction) {
        return socket.emit('bid:rejected', { reason: 'Auction not found' });
      }
      if (socket.data.auctionId !== auctionId) {
        return socket.emit('bid:rejected', { reason: 'Join the auction room before bidding' });
      }

      // Per-socket throttle to stop double-submits / spam
      const now = Date.now();
      if (now - socket.data.lastBidAt < MIN_MS_BETWEEN_BIDS) {
        return socket.emit('bid:rejected', { reason: 'Please slow down between bids' });
      }
      socket.data.lastBidAt = now;

      handleBidPlacement(io, socket, auction, Number(amount), socket.data.username);
    });

    // ---- DISCONNECT -----------------------------------------------------
    socket.on('disconnect', () => {
      const auctionId = socket.data.auctionId;
      if (!auctionId || !auctions[auctionId]) return;
      const room = io.sockets.adapter.rooms.get(auctionId);
      const totalViewers = room ? room.size : 0;
      io.to(auctionId).emit('user:joined', {
        username: socket.data.username,
        totalViewers,
        left: true
      });
    });
  });
}

module.exports = registerAuctionSockets;
module.exports.handleBidPlacement = handleBidPlacement;
