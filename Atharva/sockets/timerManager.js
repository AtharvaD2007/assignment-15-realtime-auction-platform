/**
 * sockets/timerManager.js
 * -----------------------
 * Authoritative server-side auction timers.
 *
 * TEMPORARY TESTING MODE:
 * Auctions do NOT end when the countdown reaches 0.
 * The timer resets to the auction's initial time and continues.
 */

const { auctions } = require('../data/auctions');

// auctionId -> Node interval handle
const activeIntervals = {};

/**
 * Runs every second for an active auction.
 */
function tick(io, auctionId) {
  const auction = auctions[auctionId];

  // Stop timer if auction doesn't exist or is no longer active
  if (!auction || auction.status !== 'active') {
    clearAuctionTimer(auctionId);
    return;
  }

  auction.timeRemainingSeconds -= 1;

  /**
   * TEMPORARY TESTING MODE
   *
   * When countdown reaches 0:
   * - DO NOT end auction
   * - DO NOT change status
   * - DO NOT emit auction:sold
   * - Reset to the original auction duration
   */
  if (auction.timeRemainingSeconds <= 0) {
    auction.timeRemainingSeconds = auction.initialTimeSeconds;

    io.to(auctionId).emit('auction:time_tick', {
      auctionId,
      timeRemaining: auction.timeRemainingSeconds
    });

    return;
  }

  // Broadcast authoritative server time
  io.to(auctionId).emit('auction:time_tick', {
    auctionId,
    timeRemaining: auction.timeRemainingSeconds
  });
}

/**
 * Starts one auction timer.
 */
function startAuctionTimer(io, auctionId) {
  if (activeIntervals[auctionId]) {
    return;
  }

  activeIntervals[auctionId] = setInterval(() => {
    tick(io, auctionId);
  }, 1000);
}

/**
 * Clears one auction timer.
 */
function clearAuctionTimer(auctionId) {
  if (activeIntervals[auctionId]) {
    clearInterval(activeIntervals[auctionId]);
    delete activeIntervals[auctionId];
  }
}

/**
 * Starts timers for every currently active auction.
 */
function startAllTimers(io) {
  Object.values(auctions).forEach((auction) => {
    if (auction.status === 'active') {
      startAuctionTimer(io, auction.id);
    }
  });
}

/**
 * Anti-snipe timer extension.
 *
 * Example:
 * extendTimer('AUC_VINTAGE_99', 20)
 */
function extendTimer(auctionId, seconds) {
  const auction = auctions[auctionId];

  if (!auction) {
    return;
  }

  auction.timeRemainingSeconds = seconds;
}

/**
 * Real auction-ending function.
 *
 * This is intentionally NOT called automatically by tick()
 * while testing mode is enabled.
 */
function endAuction(io, auctionId) {
  const auction = auctions[auctionId];

  if (!auction) {
    return;
  }

  clearAuctionTimer(auctionId);

  const wasSold =
    !!auction.highestBidder &&
    auction.currentBid >= auction.reservePrice;

  auction.status = wasSold ? 'sold' : 'ended';

  io.to(auctionId).emit('auction:sold', {
    auctionId,
    status: auction.status,
    winner: auction.highestBidder
      ? auction.highestBidder.username
      : null,
    finalPrice: auction.currentBid,
    message: wasSold
      ? `SOLD to ${auction.highestBidder.username} for ₹${auction.currentBid.toLocaleString('en-IN')}!`
      : 'Auction closed with no winning bid.'
  });
}

/**
 * Graceful shutdown.
 */
function stopAllTimers() {
  Object.keys(activeIntervals).forEach(clearAuctionTimer);
}

module.exports = {
  startAuctionTimer,
  startAllTimers,
  extendTimer,
  endAuction,
  stopAllTimers
};