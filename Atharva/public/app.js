// ================== Live Auction Floor — Client ==================
// ================== Live Auction Floor — Client ==================

const socket = io("https://assignment-15-realtime-auction-platform-icla.onrender.com", {
  transports: ["websocket", "polling"]
});

// ---- DOM refs ----
const joinScreen = document.getElementById('joinScreen');
const floorScreen = document.getElementById('floorScreen');
const usernameInput = document.getElementById('usernameInput');
const auctionSelect = document.getElementById('auctionSelect');
const joinBtn = document.getElementById('joinBtn');
const joinError = document.getElementById('joinError');

const itemTitle = document.getElementById('itemTitle');
const itemDescription = document.getElementById('itemDescription');
const currentBidEl = document.getElementById('currentBid');
const highestBidderEl = document.getElementById('highestBidder');
const timerEl = document.getElementById('timer');
const viewerCountEl = document.getElementById('viewerCount');
const walletBalanceEl = document.getElementById('walletBalance');
const bannerZone = document.getElementById('bannerZone');
const bidAmountInput = document.getElementById('bidAmountInput');
const placeBidBtn = document.getElementById('placeBidBtn');
const quickBidBtn = document.getElementById('quickBidBtn');
const bidError = document.getElementById('bidError');
const statusMsg = document.getElementById('statusMsg');
const bidHistoryList = document.getElementById('bidHistoryList');

let state = {
  auctionId: null,
  minIncrement: 0,
  currentBid: 0,
  closed: false
};


function beep(freq = 440, duration = 120, type = 'sine') {
  try {
    const ctx = beep.ctx || (beep.ctx = new (window.AudioContext || window.webkitAudioContext)());
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = 0.05;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration / 1000);
  } catch (e) { /* audio not available, fail silently */ }
}


fetch('https://assignment-15-realtime-auction-platform-icla.onrender.com/api/auctions')
  .then((r) => r.json())
  .then((list) => {
    auctionSelect.innerHTML = list
      .map((a) => `<option value="${a.id}" ${a.status !== 'active' ? 'disabled' : ''}>
        ${a.title} — ₹${a.currentBid.toLocaleString('en-IN')} ${a.status !== 'active' ? '(closed)' : ''}
      </option>`)
      .join('');
  })
  .catch(() => {
    joinError.textContent = 'Could not reach the server. Is it running?';
  });

// ---- Join flow ----
joinBtn.addEventListener('click', () => {
  const username = usernameInput.value.trim();
  const auctionId = auctionSelect.value;
  joinError.textContent = '';

  if (!username) {
    joinError.textContent = 'Please enter a display name.';
    return;
  }
  if (!auctionId) {
    joinError.textContent = 'Please choose an auction room.';
    return;
  }

  socket.emit('auction:join', { auctionId, username });
});

usernameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinBtn.click(); });

// ---- Server events ----
socket.on('auction:init', ({ item, timeRemaining, walletBalance }) => {
  joinScreen.classList.add('hidden');
  floorScreen.classList.remove('hidden');

  state.auctionId = item.id;
  state.minIncrement = item.minIncrement;
  state.currentBid = item.currentBid;
  state.closed = item.status !== 'active';

  itemTitle.textContent = item.title;
  itemDescription.textContent = item.description;
  currentBidEl.textContent = formatINR(item.currentBid);
  highestBidderEl.textContent = item.highestBidder
  ? `Leading: ${item.highestBidder.username}`
  : 'No bids yet';
  timerEl.textContent = `${timeRemaining}s`;
  walletBalanceEl.textContent = formatINR(walletBalance);
  quickBidBtn.textContent = `Bid ₹${(item.currentBid + item.minIncrement).toLocaleString('en-IN')}`;
  renderHistory(item.bidHistory);
});

socket.on('user:joined', ({ username, totalViewers, left }) => {
  viewerCountEl.textContent = `👁 ${totalViewers}`;
  if (!left) statusMsg.textContent = `${username} joined the floor`;
});

socket.on('auction:time_tick', ({ timeRemaining }) => {
  timerEl.textContent = `${timeRemaining}s`;
  timerEl.classList.toggle('urgent', timeRemaining <= 10);
});

socket.on('bid:success', ({ currentBid, highestBidder, bidHistory, timeRemaining, antiSnipeTriggered }) => {
  state.currentBid = currentBid;
  currentBidEl.textContent = formatINR(currentBid);
  currentBidEl.classList.add('bump');
  setTimeout(() => currentBidEl.classList.remove('bump'), 200);

  highestBidderEl.textContent = `Leading: ${highestBidder}`;
  timerEl.textContent = `${timeRemaining}s`;
  quickBidBtn.textContent = `Bid ₹${(currentBid + state.minIncrement).toLocaleString('en-IN')}`;
  renderHistory(bidHistory);
  bidError.textContent = '';
  beep(700, 90, 'triangle');
  if (!antiSnipeTriggered) statusMsg.textContent = `${highestBidder} is now leading at ${formatINR(currentBid)}`;
});

socket.on('bid:outbid', ({ message }) => {
  showBanner(message, 'outbid');
  beep(300, 180, 'sawtooth');
});

socket.on('bid:rejected', ({ reason }) => {
  bidError.textContent = reason;
});

socket.on('auction:extended', ({ message, timeRemaining }) => {
  timerEl.textContent = `${timeRemaining}s`;
  showBanner(`⏱ ${message}`, 'extend');
  beep(500, 250, 'square');
});

socket.on('auction:sold', ({ status, winner, finalPrice, message }) => {
  state.closed = true;
  placeBidBtn.disabled = true;
  quickBidBtn.disabled = true;
  bidAmountInput.disabled = true;
  timerEl.textContent = '0s';
  showBanner(`🏁 ${message}`, 'sold');
  beep(880, 300, 'sine');
});

// ---- Bidding actions ----
placeBidBtn.addEventListener('click', () => {
  const amount = Number(bidAmountInput.value);
  if (!amount) {
    bidError.textContent = 'Enter a bid amount first.';
    return;
  }
  submitBid(amount);
});

quickBidBtn.addEventListener('click', () => {
  submitBid(state.currentBid + state.minIncrement);
});

bidAmountInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') placeBidBtn.click(); });

function submitBid(amount) {
  if (state.closed) {
    bidError.textContent = 'This auction has ended.';
    return;
  }
  bidError.textContent = '';
  socket.emit('bid:place', { auctionId: state.auctionId, amount });
}

// ---- Rendering helpers ----
function renderHistory(history) {
  bidHistoryList.innerHTML = history
    .map(
      (h) => `<li>
        <span>
          <span class="bidder">${escapeHtml(h.bidder)}</span><br/>
          <span class="time">${h.timestamp}</span>
        </span>
        <span class="amount">${formatINR(h.amount)}</span>
      </li>`
    )
    .join('');
}

function showBanner(text, cls) {
  const div = document.createElement('div');
  div.className = `banner ${cls}`;
  div.textContent = text;
  bannerZone.innerHTML = '';
  bannerZone.appendChild(div);
  setTimeout(() => { if (bannerZone.contains(div)) bannerZone.removeChild(div); }, 6000);
}

function formatINR(n) {
  return `₹${Number(n).toLocaleString('en-IN')}`;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
