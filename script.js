/* ============================================================
   POKER GAME — LOGIC (full rewrite)
   Texas Hold'em vs Computer
   ============================================================ */

/* ---------- Constants ---------- */

const SUITS     = ['♠', '♥', '♦', '♣'];
const RANKS     = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RED_SUITS = new Set(['♥', '♦']);

const SMALL_BLIND = 10;
const BIG_BLIND   = 20;

/* ---------- Game State ---------- */

let deck          = [];
let playerHand    = [];
let computerHand  = [];
let community     = [];

let pot           = 0;
let playerChips   = 1000;
let computerChips = 1000;

// Per-street betting
let playerStreetBet    = 0;   // chips player has put in THIS street
let computerStreetBet  = 0;   // chips computer has put in THIS street
let streetBet          = 0;   // the current highest bet this street (must match to stay in)

let stage      = '';
let playerTurn = false;
let gameOver   = false;

// Did each side get to act at least once this street?
let playerActed   = false;
let computerActed = false;

/* ============================================================
   DECK
   ============================================================ */

function buildDeck() {
  const d = [];
  for (const s of SUITS)
    for (const r of RANKS)
      d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/* ============================================================
   DOM HELPERS
   ============================================================ */

function cardEl(card, faceDown) {
  const el = document.createElement('div');
  if (faceDown) {
    el.className = 'card face-down';
  } else {
    el.className = 'card ' + (RED_SUITS.has(card.s) ? 'red' : 'black');
    el.innerHTML =
      '<div class="top">'    + card.r + '<br>' + card.s + '</div>' +
      '<div class="middle">' + card.s + '</div>' +
      '<div class="bot">'    + card.r + '<br>' + card.s + '</div>';
  }
  return el;
}

function placeholderEl() {
  const el = document.createElement('div');
  el.className = 'card-placeholder';
  return el;
}

function renderHand(id, hand, faceDown) {
  const c = document.getElementById(id);
  c.innerHTML = '';
  hand.forEach(function(card) { c.appendChild(cardEl(card, faceDown)); });
}

function renderCommunity() {
  const c = document.getElementById('community-cards');
  c.innerHTML = '';
  community.forEach(function(card) { c.appendChild(cardEl(card, false)); });
  for (let i = community.length; i < 5; i++) c.appendChild(placeholderEl());
}

function msg(html) {
  document.getElementById('message').innerHTML = html;
}

function updateUI() {
  document.getElementById('player-chips').textContent   = '$' + playerChips.toLocaleString();
  document.getElementById('computer-chips').textContent = '$' + computerChips.toLocaleString();
  document.getElementById('pot-display').textContent    = '$' + pot.toLocaleString();
  document.getElementById('stage-display').textContent  = stage || '—';
}

function setBtns(fold, check, call, raise) {
  document.getElementById('btn-fold').disabled  = !fold;
  document.getElementById('btn-check').disabled = !check;
  document.getElementById('btn-call').disabled  = !call;
  document.getElementById('btn-raise').disabled = !raise;
}

/* ============================================================
   HAND EVALUATION
   ============================================================ */

function rankIdx(r) { return RANKS.indexOf(r); }

function combos(arr, k) {
  if (k === arr.length) return [arr.slice()];
  if (k === 1) return arr.map(function(x) { return [x]; });
  var out = [];
  for (var i = 0; i <= arr.length - k; i++) {
    var rest = combos(arr.slice(i + 1), k - 1);
    for (var j = 0; j < rest.length; j++) out.push([arr[i]].concat(rest[j]));
  }
  return out;
}

function scoreHand(cards) {
  var rs = cards.map(function(c) { return rankIdx(c.r); }).sort(function(a,b){return b-a;});
  var ss = cards.map(function(c) { return c.s; });

  var cnt = {};
  rs.forEach(function(r) { cnt[r] = (cnt[r] || 0) + 1; });
  var counts = Object.values(cnt).sort(function(a,b){return b-a;});

  var flush    = cards.length === 5 && ss.every(function(s){ return s === ss[0]; });
  var allUniq  = counts[0] === 1;
  var straight = cards.length === 5 && allUniq && rs[0] - rs[4] === 4;
  var wheel    = cards.length === 5 && allUniq &&
                 rs[0]===12 && rs[1]===3 && rs[2]===2 && rs[3]===1 && rs[4]===0;

  // Full 5-rank tiebreaker in base 13. Max value 371292 < 1000000 (tier gap).
  // This ensures all 5 kicker cards are compared so no false ties or wrong winners.
  var tb = rs[0]*28561 + (rs[1]||0)*2197 + (rs[2]||0)*169 + (rs[3]||0)*13 + (rs[4]||0);

  if (flush && (straight || wheel))        return 8000000 + tb;
  if (counts[0] === 4)                     return 7000000 + tb;
  if (counts[0] === 3 && counts[1] === 2)  return 6000000 + tb;
  if (flush)                               return 5000000 + tb;
  if (straight || wheel)                   return 4000000 + (wheel ? 3 : rs[0]) * 2197;
  if (counts[0] === 3)                     return 3000000 + tb;
  if (counts[0] === 2 && counts[1] === 2)  return 2000000 + tb;
  if (counts[0] === 2)                     return 1000000 + tb;
  return tb;
}

function bestScore(hole) {
  var all  = hole.concat(community);
  // Always evaluate 5-card combos — never score 6 or 7 cards as a hand
  var size = Math.min(5, all.length);
  if (all.length < 5) size = all.length;  // pre-flop: score what we have
  var cs   = combos(all, 5 <= all.length ? 5 : all.length);
  var best = 0;
  for (var i = 0; i < cs.length; i++) {
    var s = scoreHand(cs[i]);
    if (s > best) best = s;
  }
  return best;
}

function handLabel(score) {
  if (score >= 8000000) return 'Straight Flush';
  if (score >= 7000000) return 'Four of a Kind';
  if (score >= 6000000) return 'Full House';
  if (score >= 5000000) return 'Flush';
  if (score >= 4000000) return 'Straight';
  if (score >= 3000000) return 'Three of a Kind';
  if (score >= 2000000) return 'Two Pair';
  if (score >= 1000000) return 'One Pair';
  return 'High Card';
}

/* ============================================================
   COMPUTER AI
   ============================================================ */

/*
  Tiers:
    MONSTER  >= 4000  (straight / flush / boat / quads / SF)
    STRONG   >= 2000  (two pair, trips)
    MADE     >= 1000  (one pair)
    DRAW     = decent high-card or likely draw
    TRASH    = bottom of range

  Pre-flop we evaluate just the 2 hole cards.
*/

function preFlopTier() {
  var s   = scoreHand(computerHand);        // 2-card score
  var top = Math.max(rankIdx(computerHand[0].r), rankIdx(computerHand[1].r));
  if (s >= 1000)  return 'STRONG';          // pocket pair
  if (top >= 10)  return 'MADE';            // A/K/Q/J high
  if (top >= 7)   return 'DRAW';
  return 'TRASH';
}

function postFlopTier(score) {
  if (score >= 4000000) return 'MONSTER';
  if (score >= 2000000) return 'STRONG';
  if (score >= 1000000) return 'MADE';
  var top = Math.max(rankIdx(computerHand[0].r), rankIdx(computerHand[1].r));
  if (top >= 8) return 'DRAW';
  return 'TRASH';
}

/*
  Returns { action: 'fold'|'check'|'call'|'raise', amount? }
  For 'raise': amount = the NEW target for computerStreetBet (total put in this street).
*/
function aiDecide() {
  var rand   = Math.random();
  var toCall = streetBet - computerStreetBet;
  var canChk = toCall === 0;
  var potOdds = pot > 0 ? toCall / (pot + toCall) : 0;

  var tier = (stage === 'Pre-flop') ? preFlopTier() : postFlopTier(bestScore(computerHand));

  // Build a raise target: raise BY extra on top of current streetBet
  function raiseTarget(minExtra, maxExtra) {
    var extra = Math.floor(minExtra + rand * (maxExtra - minExtra + 1));
    extra = Math.max(extra, BIG_BLIND);                   // minimum raise size
    var newStreetBet = streetBet + extra;
    // Can't put in more than we have
    return Math.min(computerStreetBet + computerChips, newStreetBet);
  }

  /* ─── PRE-FLOP ─── */
  if (stage === 'Pre-flop') {

    // Pocket pair: 3-bet or call, never fold
    if (tier === 'STRONG') {
      if (rand < 0.60) return { action: 'raise', amount: raiseTarget(BIG_BLIND, BIG_BLIND*3) };
      return { action: 'call' };
    }
    // Broadway high cards: call or light 3-bet
    if (tier === 'MADE') {
      if (rand < 0.25) return { action: 'raise', amount: raiseTarget(BIG_BLIND, BIG_BLIND*2) };
      return canChk ? { action: 'check' } : { action: 'call' };
    }
    // Mid cards: call if cheap
    if (tier === 'DRAW') {
      if (canChk) return { action: 'check' };
      if (potOdds < 0.38) return { action: 'call' };
      return rand < 0.30 ? { action: 'fold' } : { action: 'call' };
    }
    // Trash: defend BB cheaply, otherwise lean fold
    if (canChk) return { action: 'check' };
    if (potOdds < 0.22) return { action: 'call' };
    return rand < 0.60 ? { action: 'fold' } : { action: 'call' };
  }

  /* ─── POST-FLOP ─── */

  var potBet50  = Math.max(BIG_BLIND, Math.floor(pot * 0.50));
  var potBet75  = Math.max(BIG_BLIND, Math.floor(pot * 0.75));
  var potBet100 = Math.max(BIG_BLIND, Math.floor(pot * 1.00));

  if (tier === 'MONSTER') {
    if (canChk) {
      // Slowplay 20% of the time
      if (rand < 0.20) return { action: 'check' };
      return { action: 'raise', amount: raiseTarget(potBet50, potBet100) };
    }
    // Call to slowplay, raise for value
    if (rand < 0.15) return { action: 'call' };
    return { action: 'raise', amount: raiseTarget(potBet50, potBet100) };
  }

  if (tier === 'STRONG') {
    if (canChk) {
      if (rand < 0.40) return { action: 'check' };
      return { action: 'raise', amount: raiseTarget(potBet50, potBet75) };
    }
    if (stage === 'River' && potOdds > 0.55 && rand < 0.35) return { action: 'fold' };
    if (rand < 0.40) return { action: 'raise', amount: raiseTarget(potBet50, potBet75) };
    return { action: 'call' };
  }

  if (tier === 'MADE') {
    if (canChk) {
      if (rand < 0.30) return { action: 'raise', amount: raiseTarget(potBet50, potBet75) };
      return { action: 'check' };
    }
    if (stage === 'River' && potOdds > 0.45 && rand < 0.55) return { action: 'fold' };
    if (potOdds > 0.60 && rand < 0.70) return { action: 'fold' };
    return { action: 'call' };
  }

  if (tier === 'DRAW') {
    if (canChk) return { action: 'check' };
    // On the river a draw has missed — fold unless tiny price
    if (stage === 'River') return potOdds < 0.12 ? { action: 'call' } : { action: 'fold' };
    // Flop/Turn: call with decent odds
    return potOdds < 0.33 ? { action: 'call' } : { action: 'fold' };
  }

  // TRASH
  if (canChk) return { action: 'check' };
  return potOdds < 0.10 ? { action: 'call' } : { action: 'fold' };
}

/* ============================================================
   STAGE MANAGEMENT
   ============================================================ */

function startStreet() {
  playerStreetBet = 0;
  computerStreetBet = 0;
  streetBet = 0;
  playerActed = false;
  computerActed = false;
}

function advanceStage() {
  if (gameOver) return;

  if (stage === 'Pre-flop') {
    stage = 'Flop';
    community.push(deck.pop(), deck.pop(), deck.pop());
  } else if (stage === 'Flop') {
    stage = 'Turn';
    community.push(deck.pop());
  } else if (stage === 'Turn') {
    stage = 'River';
    community.push(deck.pop());
  } else {
    showdown();
    return;
  }

  startStreet();
  renderCommunity();
  updateUI();

  playerTurn = true;
  setBtns(true, true, false, true);
  msg('<span class="highlight">' + stage + '.</span> Your action — check or bet.');
}

/* ============================================================
   SHOWDOWN
   ============================================================ */

function showdown() {
  renderHand('computer-hand', computerHand, false);

  var ps = bestScore(playerHand);
  var cs = bestScore(computerHand);
  var pn = handLabel(ps);
  var cn = handLabel(cs);

  setBtns(false, false, false, false);
  gameOver = true;
  stage    = 'Showdown';
  updateUI();

  if (ps > cs) {
    playerChips += pot;
    msg('<span class="win">You win $' + pot + '!</span> Your ' + pn + ' beats Computer\'s ' + cn + '.');
  } else if (cs > ps) {
    computerChips += pot;
    msg('<span class="lose">Computer wins $' + pot + '!</span> Their ' + cn + ' beats your ' + pn + '.');
  } else {
    var half = Math.floor(pot / 2);
    playerChips   += half;
    computerChips += half;
    msg('<span class="split">Split pot.</span> Both have ' + pn + '.');
  }

  pot = 0;
  updateUI();
}

/* ============================================================
   COMPUTER TURN
   ============================================================ */

function doComputerTurn() {
  if (gameOver) return;

  var dec    = aiDecide();
  var toCall = streetBet - computerStreetBet;

  computerActed = true;

  /* FOLD */
  if (dec.action === 'fold') {
    playerChips += pot;
    pot          = 0;
    gameOver     = true;
    stage        = 'Folded';
    renderHand('computer-hand', computerHand, false);
    updateUI();
    setBtns(false, false, false, false);
    msg('<span class="win">Computer folds. You win the pot!</span>');
    return;
  }

  /* CHECK */
  if (dec.action === 'check') {
    msg('Computer checks.');
    // Both sides checked → move on
    setTimeout(advanceStage, 600);
    return;
  }

  /* CALL */
  if (dec.action === 'call') {
    var chips = Math.min(toCall, computerChips);
    if (chips <= 0) {
      // Nothing to call — treat as check
      msg('Computer checks.');
      setTimeout(advanceStage, 600);
      return;
    }
    computerChips     -= chips;
    pot               += chips;
    computerStreetBet += chips;
    updateUI();
    msg('Computer calls <span class="highlight">$' + chips + '</span>.');
    setTimeout(advanceStage, 700);
    return;
  }

  /* RAISE */
  if (dec.action === 'raise') {
    // dec.amount is the target for computerStreetBet after this action
    var target    = Math.max(dec.amount, streetBet + BIG_BLIND); // enforce min-raise
    var raiseChips = Math.min(target - computerStreetBet, computerChips);

    // If we can't raise (only enough to call or less), just call
    if (raiseChips <= toCall) {
      var callChips = Math.min(toCall, computerChips);
      computerChips     -= callChips;
      pot               += callChips;
      computerStreetBet += callChips;
      updateUI();
      msg('Computer calls <span class="highlight">$' + callChips + '</span>.');
      setTimeout(advanceStage, 700);
      return;
    }

    computerChips     -= raiseChips;
    pot               += raiseChips;
    computerStreetBet += raiseChips;
    streetBet          = computerStreetBet;
    updateUI();
    msg('Computer raises to <span class="highlight">$' + streetBet + '</span>.');

    // Player must respond to the raise
    playerActed = false;
    playerTurn  = true;
    setBtns(true, false, true, true);
    return;
  }
}

/* ============================================================
   PLAYER ACTIONS
   ============================================================ */

function playerAction(action) {
  if (!playerTurn || gameOver) return;

  var toCall = streetBet - playerStreetBet;

  /* FOLD */
  if (action === 'fold') {
    computerChips += pot;
    pot            = 0;
    gameOver       = true;
    stage          = 'Folded';
    renderHand('computer-hand', computerHand, false);
    updateUI();
    setBtns(false, false, false, false);
    msg('<span class="lose">You folded. Computer wins.</span>');
    return;
  }

  /* CHECK */
  if (action === 'check') {
    if (toCall > 0) {
      msg('There\'s $' + toCall + ' to call — you can\'t check. Call, raise, or fold.');
      return;
    }
    playerActed = true;
    msg('You check.');
    playerTurn = false;
    setBtns(false, false, false, false);
    updateUI();

    if (computerActed) {
      // Both checked — advance
      setTimeout(advanceStage, 600);
    } else {
      setTimeout(doComputerTurn, 800);
    }
    return;
  }

  /* CALL */
  if (action === 'call') {
    if (toCall <= 0) {
      msg('Nothing to call — use Check.');
      return;
    }
    var chips = Math.min(toCall, playerChips);
    playerChips      -= chips;
    pot              += chips;
    playerStreetBet  += chips;
    playerActed       = true;
    msg('You call <span class="highlight">$' + chips + '</span>.');
    playerTurn = false;
    setBtns(false, false, false, false);
    updateUI();
    // Computer already acted (it bet/raised) so just advance
    setTimeout(advanceStage, 700);
    return;
  }

  /* RAISE */
  if (action === 'raise') {
    var raiseBy  = parseInt(document.getElementById('raise-amount').value, 10) || BIG_BLIND;
    var minRaise = toCall + BIG_BLIND;
    raiseBy      = Math.max(raiseBy, minRaise);

    var newStreetBet = playerStreetBet + toCall + raiseBy;
    var chips2 = Math.min(newStreetBet - playerStreetBet, playerChips);

    if (chips2 <= 0) { msg('Not enough chips!'); return; }

    playerChips     -= chips2;
    pot             += chips2;
    playerStreetBet += chips2;
    streetBet        = playerStreetBet;
    playerActed      = true;

    msg('You raise to <span class="highlight">$' + streetBet + '</span>.');
    playerTurn    = false;
    computerActed = false;   // computer must respond
    setBtns(false, false, false, false);
    updateUI();
    setTimeout(doComputerTurn, 900);
    return;
  }
}

/* ============================================================
   NEW GAME
   ============================================================ */

function newGame() {
  if (playerChips   <= 0) playerChips   = 1000;
  if (computerChips <= 0) computerChips = 1000;

  deck         = buildDeck();
  playerHand   = [deck.pop(), deck.pop()];
  computerHand = [deck.pop(), deck.pop()];
  community    = [];

  // Post blinds
  playerChips   -= SMALL_BLIND;
  computerChips -= BIG_BLIND;
  pot            = SMALL_BLIND + BIG_BLIND;

  playerStreetBet   = SMALL_BLIND;
  computerStreetBet = BIG_BLIND;
  streetBet         = BIG_BLIND;

  // Player hasn't voluntarily acted yet; computer has (posted BB)
  playerActed   = false;
  computerActed = true;

  stage      = 'Pre-flop';
  gameOver   = false;
  playerTurn = true;

  renderHand('player-hand',   playerHand,   false);
  renderHand('computer-hand', computerHand, true);
  renderCommunity();
  updateUI();

  setBtns(true, false, true, true);
  msg('Small blind $' + SMALL_BLIND + ' · Computer big blind $' + BIG_BLIND +
      ' · <span class="highlight">Call $' + (BIG_BLIND - SMALL_BLIND) + ', raise, or fold.</span>');
}

/* ============================================================
   INIT
   ============================================================ */

renderCommunity();
updateUI();