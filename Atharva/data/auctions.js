/**
 * In-Memory Auction Room State
 * ----------------------------
 * This is the single source of truth for every auction "room" the server
 * manages. It intentionally lives in its own module (not inside server.js)
 * so that sockets/auctionEngine.js and sockets/timerManager.js can both
 * require() the SAME object reference and mutate it safely.
 *
 * NOTE ON PERSISTENCE: this is an in-memory store as specified by the
 * assignment brief. Restarting the process resets all auctions. Swapping
 * this file for a Redis/Postgres-backed store would be the natural next
 * step for production use, and the rest of the codebase does not need to
 * change because everything reads/writes through the helper functions
 * exported below.
 */

const auctions = {
  AUC_VINTAGE_99: {
    id: 'AUC_VINTAGE_99',
    title: '1967 Vintage Fender Stratocaster',
    description: 'Original condition rare electric guitar, sunburst finish.',
    startingPrice: 50000,
    currentBid: 50000,
    reservePrice: 50000,
    highestBidder: null, // { socketId, username }
    minIncrement: 2000,
    timeRemainingSeconds: 60,
    initialTimeSeconds: 60,
    status: 'active', // "upcoming" | "active" | "ended" | "sold"
    bidHistory: [] // newest first: { bidder, amount, timestamp }
  },
  AUC_ROLEX_SUB: {
    id: 'AUC_ROLEX_SUB',
    title: 'Rolex Submariner Date (2004)',
    description: 'Box & papers included, recently serviced.',
    startingPrice: 350000,
    currentBid: 350000,
    reservePrice: 350000,
    highestBidder: null,
    minIncrement: 10000,
    timeRemainingSeconds: 90,
    initialTimeSeconds: 90,
    status: 'active',
    bidHistory: []
  },
  AUC_ART_KANDINSKY: {
    id: 'AUC_ART_KANDINSKY',
    title: 'Abstract Study — Signed Lithograph',
    description: 'Limited edition print, numbered 12/75.',
    startingPrice: 18000,
    currentBid: 18000,
    reservePrice: 18000,
    highestBidder: null,
    minIncrement: 1000,
    timeRemainingSeconds: 45,
    initialTimeSeconds: 45,
    status: 'active',
    bidHistory: []
  }
};

/** Returns a lightweight, client-safe summary of every auction (for listings). */
function listAuctionSummaries() {
  return Object.values(auctions).map((a) => ({
    id: a.id,
    title: a.title,
    currentBid: a.currentBid,
    status: a.status,
    timeRemainingSeconds: a.timeRemainingSeconds,
    highestBidder: a.highestBidder ? a.highestBidder.username : null
  }));
}

/** Returns the full client-safe payload for one auction (used on join / init). */
function getAuctionPublicState(auctionId) {
  const a = auctions[auctionId];
  if (!a) return null;
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    startingPrice: a.startingPrice,
    currentBid: a.currentBid,
    minIncrement: a.minIncrement,
    highestBidder: a.highestBidder ? a.highestBidder.username : null,
    timeRemainingSeconds: a.timeRemainingSeconds,
    initialTimeSeconds: a.initialTimeSeconds,
    status: a.status,
    bidHistory: a.bidHistory
  };
}

module.exports = { auctions, listAuctionSummaries, getAuctionPublicState };
