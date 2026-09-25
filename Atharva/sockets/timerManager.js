/**
 * sockets/timerManager.js
 * -----------------------
 * Owns one authoritative server-side setInterval per auction room. Clients
 * never run their own countdown logic for the "truth" — they just render
 * whatever `timeRemainingSeconds` the server broadcasts every second. This
 * is what keeps every bidder's clock perfectly synchronized regardless of
 * network latency or tab-throttling on the client.
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

  if (auction.timeRemainingSeconds <= 0) {
    auction.timeRemainingSeconds = 0;
    endAuction(io, auctionId);
    return;
  }

  io.to(auctionId).emit('auction:time_tick', {
    auctionId,
    timeRemaining: auction.timeRemainingSeconds
  });
}

function startAuctionTimer(io, auctionId) {
  if (activeIntervals[auctionId]) return; // already running
  activeIntervals[auctionId] = setInterval(() => tick(io, auctionId), 1000);
}

function clearAuctionTimer(auctionId) {
  if (activeIntervals[auctionId]) {
    clearInterval(activeIntervals[auctionId]);
    delete activeIntervals[auctionId];
  }
}

/** Starts the countdown for every auction currently marked "active". */
function startAllTimers(io) {
  Object.values(auctions).forEach((auction) => {
    if (auction.status === 'active') startAuctionTimer(io, auction.id);
  });
}

/**
 * Anti-snipe hook: bump the remaining time for an in-progress auction.
 * The auction's setInterval is already running (started at server boot),
 * so this only needs to rewrite the counter — the next tick() picks it up.
 */
function extendTimer(auctionId, extraSeconds) {
  const auction = auctions[auctionId];
  if (!auction) return;
  auction.timeRemainingSeconds = extraSeconds;
}

/** Called when the clock hits zero: closes the auction and announces the result. */
function endAuction(io, auctionId) {
  const auction = auctions[auctionId];
  if (!auction) return;

  clearAuctionTimer(auctionId);

  const wasSold = !!auction.highestBidder && auction.currentBid >= auction.reservePrice;
  auction.status = wasSold ? 'sold' : 'ended';

  io.to(auctionId).emit('auction:sold', {
    auctionId,
    status: auction.status,
    winner: auction.highestBidder ? auction.highestBidder.username : null,
    finalPrice: auction.currentBid,
    message: wasSold
      ? `SOLD to ${auction.highestBidder.username} for ₹${auction.currentBid.toLocaleString('en-IN')}!`
      : 'Auction closed with no winning bid.'
  });
}

/** Graceful shutdown helper — clears every interval so the process can exit cleanly. */
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
