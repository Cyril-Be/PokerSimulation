import { createRandomStrategy, createStrategyByKey, DEFAULT_STRATEGY_KEY } from './strategies.js';

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));

function createPlayerStats(startingStack) {
  return {
    hands: 0,
    wins: 0,
    folds: 0,
    raises: 0,
    checks: 0,
    calls: 0,
    allIns: 0,
    totalBet: 0,
    totalWon: 0,
    stackHistory: [startingStack],
    winProbHistory: [],
    allInHands: [],
  };
}

function compareScore(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const av = a[i] ?? -1;
    const bv = b[i] ?? -1;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function combinations(cards, choose) {
  const result = [];
  const combo = [];
  const walk = (start) => {
    if (combo.length === choose) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < cards.length; i += 1) {
      combo.push(cards[i]);
      walk(i + 1);
      combo.pop();
    }
  };
  walk(0);
  return result;
}

function straightHigh(valuesDesc) {
  const unique = [...new Set(valuesDesc)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  let run = 1;
  for (let i = 1; i < unique.length; i += 1) {
    if (unique[i - 1] - 1 === unique[i]) {
      run += 1;
      if (run >= 5) return unique[i - 4];
    } else {
      run = 1;
    }
  }
  return null;
}

function score5(cards) {
  const ranks = cards.map((c) => RANK_VALUE[c.rank]).sort((a, b) => b - a);
  const counts = new Map();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  const flush = cards.every((c) => c.suit === cards[0].suit);
  const straight = straightHigh(ranks);

  if (flush && straight) return [8, straight];
  if (groups[0][1] === 4) {
    const kicker = groups[1][0];
    return [7, groups[0][0], kicker];
  }
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, groups[0][0], groups[1][0]];
  if (flush) return [5, ...ranks];
  if (straight) return [4, straight];
  if (groups[0][1] === 3) {
    const kickers = groups.slice(1).map(([r]) => r).sort((a, b) => b - a);
    return [3, groups[0][0], ...kickers];
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const highPair = Math.max(groups[0][0], groups[1][0]);
    const lowPair = Math.min(groups[0][0], groups[1][0]);
    const kicker = groups[2][0];
    return [2, highPair, lowPair, kicker];
  }
  if (groups[0][1] === 2) {
    const kickers = groups.slice(1).map(([r]) => r).sort((a, b) => b - a);
    return [1, groups[0][0], ...kickers];
  }
  return [0, ...ranks];
}

export function bestHandScore(cards) {
  const options = combinations(cards, 5);
  let best = options[0] ? score5(options[0]) : [0];
  for (let i = 1; i < options.length; i += 1) {
    const score = score5(options[i]);
    if (compareScore(score, best) > 0) best = score;
  }
  return best;
}

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank, code: `${rank}${suit}` });
    }
  }
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function nextEligibleIndex(order, startPos, players) {
  for (let step = 0; step < order.length; step += 1) {
    const index = order[(startPos + step) % order.length];
    const p = players[index];
    if (!p.folded && !p.allIn) return (startPos + step) % order.length;
  }
  return null;
}

export class PokerGame {
  constructor({ playerNames, startingStack = 1000, smallBlind = 5, bigBlind = 10, strategyFactory = createRandomStrategy } = {}) {
    this.startingStack = startingStack;
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
    this.dealerIndex = -1;
    this.players = playerNames.map((entry, id) => {
      const name = typeof entry === 'string' ? entry : (entry?.name ?? `Bot ${id + 1}`);
      const strategyKey = typeof entry === 'string' ? DEFAULT_STRATEGY_KEY : (entry?.strategyKey ?? DEFAULT_STRATEGY_KEY);
      const strategy = strategyFactory({ strategyKey, id, name });
      return {
      id,
      name,
      stack: startingStack,
      holeCards: [],
      folded: false,
      allIn: false,
      currentBet: 0,
      contribution: 0,
      actionHistory: [],
      strategyKey,
      strategy,
      stats: createPlayerStats(startingStack),
    };
    });

    this.globalStats = {
      handCount: 0,
      totalPots: [],
      averagePotHistory: [],
      actionCounts: { fold: 0, check: 0, call: 0, raise: 0, all_in: 0 },
      tableMoneyHistory: [this.totalTableMoney()],
    };

    this.communityCards = [];
    this.pot = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.stage = 'idle';
    this.handComplete = true;
    this.activeOrder = [];
    this.currentActorPos = 0;
    this.toAct = new Set();
    this.deck = [];
    this.handLog = [];
    this.lastWinners = [];
  }

  setPlayerStrategy(playerIndex, strategyKey) {
    const player = this.players[playerIndex];
    if (!player) return;
    player.strategyKey = strategyKey;
    player.strategy = createStrategyByKey(strategyKey);
  }

  replacePlayer(playerIndex, { name, stack, strategyKey = DEFAULT_STRATEGY_KEY, resetStats = true } = {}) {
    const player = this.players[playerIndex];
    if (!player) return null;
    player.name = name?.trim() ? name.trim() : player.name;
    if (Number.isFinite(stack) && stack > 0) player.stack = stack;
    if (player.stack <= 0) player.stack = this.startingStack;
    player.folded = false;
    player.allIn = false;
    player.currentBet = 0;
    player.contribution = 0;
    player.holeCards = [];
    player.actionHistory = [];
    player.strategyKey = strategyKey;
    player.strategy = createStrategyByKey(strategyKey);
    if (resetStats) player.stats = createPlayerStats(player.stack);
    return player;
  }

  resetForNewSession() {
    this.dealerIndex = -1;
    this.communityCards = [];
    this.pot = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.stage = 'idle';
    this.handComplete = true;
    this.activeOrder = [];
    this.currentActorPos = 0;
    this.toAct = new Set();
    this.deck = [];
    this.handLog = [];
    this.lastWinners = [];

    this.players.forEach((p) => {
      p.stack = this.startingStack;
      p.holeCards = [];
      p.folded = false;
      p.allIn = false;
      p.currentBet = 0;
      p.contribution = 0;
      p.actionHistory = [];
      p.stats = createPlayerStats(this.startingStack);
    });

    this.globalStats = {
      handCount: 0,
      totalPots: [],
      averagePotHistory: [],
      actionCounts: { fold: 0, check: 0, call: 0, raise: 0, all_in: 0 },
      tableMoneyHistory: [this.totalTableMoney()],
    };
  }

  totalTableMoney() {
    return this.players.reduce((sum, p) => sum + p.stack, 0) + this.pot;
  }

  alivePlayers() {
    return this.players.filter((p) => p.stack > 0 || p.contribution > 0);
  }

  activeContenders() {
    return this.players.filter((p) => !p.folded && (p.stack > 0 || p.contribution > 0));
  }

  nextPlayerIndexFrom(index) {
    for (let offset = 1; offset <= this.players.length; offset += 1) {
      const idx = (index + offset) % this.players.length;
      if (this.players[idx].stack > 0) return idx;
    }
    return index;
  }

  postBlind(player, amount) {
    const paid = Math.min(player.stack, amount);
    player.stack -= paid;
    player.currentBet += paid;
    player.contribution += paid;
    player.stats.totalBet += paid;
    if (player.stack === 0) {
      player.allIn = true;
      player.stats.allIns += 1;
    }
    this.pot += paid;
  }

  initializeActionOrder(startIndex) {
    this.activeOrder = this.players.map((_, i) => i);
    this.currentActorPos = this.activeOrder.indexOf(startIndex);
    this.refreshToAct();
  }

  refreshToAct(exceptIndex = null) {
    this.toAct = new Set();
    this.players.forEach((p, i) => {
      if (p.folded || p.allIn) return;
      if (exceptIndex !== null && i === exceptIndex) return;
      this.toAct.add(i);
    });
  }

  startHand() {
    const seated = this.players.filter((p) => p.stack > 0);
    if (seated.length < 2) return { type: 'simulation_over' };

    this.globalStats.handCount += 1;
    this.dealerIndex = this.nextPlayerIndexFrom(this.dealerIndex < 0 ? 0 : this.dealerIndex);

    this.deck = shuffle(createDeck());
    this.communityCards = [];
    this.pot = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.stage = 'preflop';
    this.handComplete = false;
    this.handLog = [];
    this.lastWinners = [];

    this.players.forEach((p) => {
      p.folded = p.stack <= 0;
      p.allIn = false;
      p.currentBet = 0;
      p.contribution = 0;
      p.actionHistory = [];
      p.holeCards = p.stack > 0 ? [this.deck.pop(), this.deck.pop()] : [];
      p.stats.hands += p.stack > 0 ? 1 : 0;
    });

    const sbIndex = this.nextPlayerIndexFrom(this.dealerIndex);
    const bbIndex = this.nextPlayerIndexFrom(sbIndex);

    this.postBlind(this.players[sbIndex], this.smallBlind);
    this.postBlind(this.players[bbIndex], this.bigBlind);
    this.currentBet = this.players[bbIndex].currentBet;

    const firstActor = this.nextPlayerIndexFrom(bbIndex);
    this.initializeActionOrder(firstActor);

    return { type: 'hand_start', dealerIndex: this.dealerIndex, sbIndex, bbIndex };
  }

  getValidActions(playerIndex) {
    const player = this.players[playerIndex];
    if (player.folded || player.allIn) return [];

    const toCall = Math.max(0, this.currentBet - player.currentBet);
    const maxTotal = player.currentBet + player.stack;
    const actions = [];

    if (toCall > 0) {
      actions.push({ type: 'fold' });
      if (player.stack <= toCall) {
        actions.push({ type: 'all_in', amount: maxTotal });
      } else {
        actions.push({ type: 'call', amount: this.currentBet });
        if (maxTotal > this.currentBet) {
          const minRaiseTo = Math.min(maxTotal, this.currentBet + this.minRaise);
          if (minRaiseTo > this.currentBet) {
            const raiseTo = minRaiseTo + Math.floor(Math.random() * (maxTotal - minRaiseTo + 1));
            actions.push({ type: 'raise', amount: raiseTo });
          }
        }
        actions.push({ type: 'all_in', amount: maxTotal });
      }
    } else {
      actions.push({ type: 'check' });
      if (player.stack > 0) {
        const minRaiseTo = this.currentBet === 0
          ? Math.min(maxTotal, this.bigBlind)
          : Math.min(maxTotal, this.currentBet + this.minRaise);
        if (minRaiseTo > this.currentBet) {
          const raiseTo = minRaiseTo + Math.floor(Math.random() * (maxTotal - minRaiseTo + 1));
          actions.push({ type: 'raise', amount: raiseTo });
        }
        actions.push({ type: 'all_in', amount: maxTotal });
      }
    }

    return actions;
  }

  applyAction(playerIndex, action) {
    const player = this.players[playerIndex];
    const toCall = Math.max(0, this.currentBet - player.currentBet);
    const event = { type: 'action', playerIndex, stage: this.stage, action: action.type, amount: 0 };

    const addPot = (chips) => {
      player.stack -= chips;
      player.currentBet += chips;
      player.contribution += chips;
      player.stats.totalBet += chips;
      this.pot += chips;
      event.amount += chips;
      if (player.stack === 0) {
        player.allIn = true;
      }
    };

    if (action.type === 'fold') {
      player.folded = true;
      player.stats.folds += 1;
      this.globalStats.actionCounts.fold += 1;
    } else if (action.type === 'check') {
      player.stats.checks += 1;
      this.globalStats.actionCounts.check += 1;
    } else if (action.type === 'call') {
      addPot(Math.min(player.stack, toCall));
      player.stats.calls += 1;
      this.globalStats.actionCounts.call += 1;
    } else if (action.type === 'raise') {
      const target = Math.max(this.currentBet + this.minRaise, action.amount);
      const capped = Math.min(target, player.currentBet + player.stack);
      addPot(capped - player.currentBet);
      const raiseDelta = capped - this.currentBet;
      if (raiseDelta > 0) this.minRaise = Math.max(this.bigBlind, raiseDelta);
      this.currentBet = Math.max(this.currentBet, player.currentBet);
      player.stats.raises += 1;
      this.globalStats.actionCounts.raise += 1;
      this.refreshToAct(playerIndex);
    } else if (action.type === 'all_in') {
      const target = Math.min(action.amount ?? (player.currentBet + player.stack), player.currentBet + player.stack);
      addPot(target - player.currentBet);
      if (player.currentBet > this.currentBet) {
        const raiseDelta = player.currentBet - this.currentBet;
        this.minRaise = Math.max(this.bigBlind, raiseDelta);
        this.currentBet = player.currentBet;
        this.refreshToAct(playerIndex);
      }
      player.stats.allIns += 1;
      if (!player.stats.allInHands.includes(this.globalStats.handCount)) {
        player.stats.allInHands.push(this.globalStats.handCount);
      }
      this.globalStats.actionCounts.all_in += 1;
      event.action = 'all_in';
    }

    player.actionHistory.push({ stage: this.stage, action: event.action, amount: event.amount });
    this.handLog.push(`${player.name}: ${event.action}${event.amount ? ` ${event.amount}` : ''}`);
    this.toAct.delete(playerIndex);

    return event;
  }

  advanceStreet() {
    this.players.forEach((p) => {
      p.currentBet = 0;
    });
    this.currentBet = 0;
    this.minRaise = this.bigBlind;

    if (this.stage === 'preflop') {
      this.stage = 'flop';
      this.communityCards.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
    } else if (this.stage === 'flop') {
      this.stage = 'turn';
      this.communityCards.push(this.deck.pop());
    } else if (this.stage === 'turn') {
      this.stage = 'river';
      this.communityCards.push(this.deck.pop());
    } else {
      return this.resolveHand();
    }

    const firstActor = this.nextPlayerIndexFrom(this.dealerIndex);
    this.currentActorPos = this.activeOrder.indexOf(firstActor);
    this.refreshToAct();
    return { type: 'street', stage: this.stage };
  }

  resolveHand() {
    const contenders = this.activeContenders();
    let winners = [];

    if (contenders.length === 1) {
      winners = [contenders[0]];
    } else {
      let best = null;
      for (const p of contenders) {
        const score = bestHandScore([...p.holeCards, ...this.communityCards]);
        if (!best || compareScore(score, best.score) > 0) {
          best = { score, players: [p] };
        } else if (compareScore(score, best.score) === 0) {
          best.players.push(p);
        }
      }
      winners = best.players;
    }

    const share = Math.floor(this.pot / winners.length);
    let remainder = this.pot - share * winners.length;
    for (const w of winners) {
      let won = share;
      if (remainder > 0) {
        won += 1;
        remainder -= 1;
      }
      w.stack += won;
      w.stats.wins += 1;
      w.stats.totalWon += won;
    }

    this.lastWinners = winners.map((w) => w.id);
    const handPot = this.pot;
    this.pot = 0;
    this.handComplete = true;
    this.stage = 'showdown';

    this.players.forEach((p) => {
      p.stats.stackHistory.push(p.stack);
    });
    this.globalStats.totalPots.push(handPot);
    const sumPot = this.globalStats.totalPots.reduce((a, b) => a + b, 0);
    this.globalStats.averagePotHistory.push(sumPot / this.globalStats.totalPots.length);
    this.globalStats.tableMoneyHistory.push(this.totalTableMoney());

    return { type: 'hand_end', winners: this.lastWinners, pot: handPot };
  }

  estimateProbabilities(iterations = 120) {
    const contenders = this.players.filter((p) => !p.folded && p.holeCards.length === 2);
    const result = Object.fromEntries(this.players.map((p) => [p.id, { win: 0, split: 0, lose: 1 }]));
    if (contenders.length < 2) {
      contenders.forEach((p) => {
        result[p.id] = { win: 1, split: 0, lose: 0 };
      });
      return result;
    }

    const used = new Set([...this.communityCards, ...contenders.flatMap((p) => p.holeCards)].map((c) => c.code));
    const baseDeck = createDeck().filter((c) => !used.has(c.code));

    for (let i = 0; i < iterations; i += 1) {
      const simDeck = shuffle([...baseDeck]);
      const board = [...this.communityCards];
      while (board.length < 5) board.push(simDeck.pop());

      let bestScore = null;
      let winners = [];
      for (const p of contenders) {
        const score = bestHandScore([...p.holeCards, ...board]);
        if (!bestScore || compareScore(score, bestScore) > 0) {
          bestScore = score;
          winners = [p];
        } else if (compareScore(score, bestScore) === 0) {
          winners.push(p);
        }
      }

      for (const p of contenders) {
        if (winners.includes(p) && winners.length === 1) result[p.id].win += 1;
        else if (winners.includes(p)) result[p.id].split += 1;
        else result[p.id].lose += 1;
      }
    }

    Object.values(result).forEach((r) => {
      const total = r.win + r.split + r.lose;
      if (total > 0) {
        r.win /= total;
        r.split /= total;
        r.lose /= total;
      }
    });

    this.players.forEach((p) => {
      p.stats.winProbHistory.push(result[p.id].win ?? 0);
    });

    return result;
  }

  estimatePublicWinProbability(playerIndex, iterations = 80) {
    const hero = this.players[playerIndex];
    if (!hero || hero.folded || hero.holeCards.length < 2) return 0;
    const opponents = this.players.filter((p) => p.id !== playerIndex && !p.folded && (p.stack > 0 || p.contribution > 0));
    if (opponents.length === 0) return 1;

    const known = new Set([...this.communityCards, ...hero.holeCards].map((c) => c.code));
    const availableDeck = createDeck().filter((c) => !known.has(c.code));
    let wins = 0;
    let splits = 0;
    let sims = 0;

    for (let i = 0; i < iterations; i += 1) {
      const simDeck = shuffle([...availableDeck]);
      const board = [...this.communityCards];
      while (board.length < 5 && simDeck.length > 0) board.push(simDeck.pop());
      if (board.length < 5) continue;
      const opponentHands = [];
      for (let o = 0; o < opponents.length; o += 1) {
        if (simDeck.length < 2) break;
        opponentHands.push([simDeck.pop(), simDeck.pop()]);
      }
      if (opponentHands.length !== opponents.length) continue;

      const heroScore = bestHandScore([...hero.holeCards, ...board]);
      let bestScore = heroScore;
      let heroTied = false;
      let heroStillBest = true;
      for (const hand of opponentHands) {
        const oppScore = bestHandScore([...hand, ...board]);
        const cmp = compareScore(oppScore, bestScore);
        if (cmp > 0) {
          heroStillBest = false;
          heroTied = false;
          bestScore = oppScore;
        } else if (cmp === 0 && compareScore(heroScore, bestScore) === 0) {
          heroTied = true;
        }
      }

      sims += 1;
      if (heroStillBest && !heroTied) wins += 1;
      else if (heroStillBest && heroTied) splits += 1;
    }

    if (sims === 0) return 0;
    return (wins + splits * 0.5) / sims;
  }

  step() {
    if (this.handComplete) return { type: 'idle' };

    if (this.activeContenders().length <= 1) return this.resolveHand();

    if (this.toAct.size === 0) return this.advanceStreet();

    const actorPos = nextEligibleIndex(this.activeOrder, this.currentActorPos, this.players);
    if (actorPos === null) return this.advanceStreet();
    this.currentActorPos = actorPos;

    let actorIndex = this.activeOrder[this.currentActorPos];
    let guard = 0;
    while (!this.toAct.has(actorIndex) && guard < this.activeOrder.length) {
      this.currentActorPos = (this.currentActorPos + 1) % this.activeOrder.length;
      actorIndex = this.activeOrder[this.currentActorPos];
      guard += 1;
    }

    if (!this.toAct.has(actorIndex)) return this.advanceStreet();

    const validActions = this.getValidActions(actorIndex);
    const choice = this.players[actorIndex].strategy.chooseAction({ game: this, playerIndex: actorIndex, validActions });
    const selected = validActions.find((a) => a.type === choice?.type) ?? validActions[0];
    const event = this.applyAction(actorIndex, selected);

    this.currentActorPos = (this.currentActorPos + 1) % this.activeOrder.length;
    return event;
  }

  playFullHand() {
    const events = [];
    if (this.handComplete) events.push(this.startHand());
    let guard = 0;
    while (!this.handComplete && guard < 300) {
      events.push(this.step());
      guard += 1;
    }
    return events;
  }
}

export function cardImageUrl(card) {
  if (!card) return '';
  return `https://deckofcardsapi.com/static/img/${card.code}.png`;
}
