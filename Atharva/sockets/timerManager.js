/**
 * sockets/timerManager.js
 * -----------------------
 * Authoritative server-side auction timers.
 *
 * TEMPORARY TESTING MODE:
 * When the countdown reaches 0, the auction does NOT end.
 * The timer simply resets to 60 seconds and continues.
 */

const { auctions } = require('../data/auctions');

// auctionId -> Node interval handle
const activeIntervals = {};

function tick(io, auctionId) {
  const auction = auctions[auctionId];

  if (!auction || auction.status !== 'active') {
    clearAuctionTimer(auctionId);
    return;
  }

  auction.timeRemainingSeconds -= 1;

  // TEMPORARY TESTING MODE
  // Do not close the auction when the timer reaches 0.
  if (auction.timeRemainingSeconds <= 0) {
    auction.timeRemainingSeconds = 60;

    io.to(auctionId).emit('auction:time_tick', {
      auctionId,
      timeRemaining: auction.timeRemainingSeconds
    });

    return;
  }

  io.to(auctionId).emit('auction:time_tick', {
    auctionId,
    timeRemaining: auction.timeRemainingSeconds
  });
}

function startAuctionTimer(io, auctionId) {
  if (activeIntervals[auctionId]) return;

  activeIntervals[auctionId] = setInterval(() => {
    tick(io, auctionId);
  }, 1000);
}

/**
 * Stops the timer for one auction.
 */
function clearAuctionTimer(auctionId) {
  if (activeIntervals[auctionId]) {
    clearInterval(activeIntervals[auctionId]);
    delete activeIntervals[auctionId];
  }
}

/**
 * Starts the countdown for every auction currently marked active.
 */
function startAllTimers(io) {
  Object.values(auctions).forEach((auction) => {
    if (auction.status === 'active') {
      startAuctionTimer(io, auction.id);
    }
  });
}

/**
 * Anti-snipe hook.
 *
 * If a bid happens near the end, the auction engine can call:
 *
 * extendTimer(auctionId, 20)
 *
 * The timer will continue from 20 seconds.
 */
function extendTimer(auctionId, extraSeconds) {
  const auction = auctions[auctionId];

  if (!auction) return;

  auction.timeRemainingSeconds = extraSeconds;
}

/**
 * Kept for compatibility with the rest of the application.
 *
 * IMPORTANT:
 * This function is no longer called automatically when the
 * countdown reaches 0.
 *
 * It can still be used later when you want to implement
 * the real auction ending behavior.
 */
function endAuction(io, auctionId) {
  const auction = auctions[auctionId];

  if (!auction) return;

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
 * Graceful shutdown helper.
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