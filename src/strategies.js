const RANK_ORDER = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
export const DEFAULT_STRATEGY_KEY = 'random_human';

export const STRATEGY_LIBRARY = [
  { key: 'pure_random', label: 'Aléatoire total', description: 'Choisit fold/call/raise/all-in totalement au hasard.' },
  { key: 'always_call', label: 'Toujours call', description: 'Call systématique si possible, sinon check/fold.' },
  { key: 'premium_only', label: 'Premium only', description: 'Joue seulement AA/KK/QQ/AK, fold le reste.' },
  { key: 'pair_broadway', label: 'Paire ou Broadway', description: 'Joue les paires et AK/AQ/AJ préflop.' },
  { key: 'hand_score', label: 'Score de main', description: 'Score simple (paire/suited/high cards) puis action selon seuil.' },
  { key: 'random_human', label: 'Aléatoire humain', description: 'Exploration aléatoire, peu de all-in.' },
  { key: 'threshold_60', label: 'Seuil 60%', description: 'Joue agressif au-dessus de 60%.' },
  { key: 'threshold_70', label: 'Seuil 70%', description: 'Très prudent, agressif au-dessus de 70%.' },
  { key: 'phase_adaptive', label: 'Adaptatif par phase', description: 'Seuil variable selon préflop/flop/turn/river.' },
  { key: 'mimic', label: 'Mimétisme', description: 'Imite la dernière action forte de la table.' },
  { key: 'mimic_lag', label: 'Mimétisme décalé', description: 'Imite avec un tour de retard.' },
  { key: 'tight_aggressive', label: 'Tight-agressive', description: 'Peu de mains, relances fortes.' },
  { key: 'gto_lite', label: 'GTO lite', description: 'Mix probabiliste inspiré théorie des jeux.' },
];

function findAction(validActions, type) {
  return validActions.find((a) => a.type === type) ?? null;
}

function randomPick(actions) {
  if (!actions.length) return null;
  return actions[Math.floor(Math.random() * actions.length)];
}

function weightedPick(weighted) {
  const total = weighted.reduce((sum, item) => sum + Math.max(item.weight, 0), 0);
  if (total <= 0) return weighted[0]?.action ?? null;
  const draw = Math.random() * total;
  let acc = 0;
  for (const item of weighted) {
    acc += Math.max(item.weight, 0);
    if (draw <= acc) return item.action;
  }
  return weighted[weighted.length - 1]?.action ?? null;
}

function estimateStrength(game, playerIndex) {
  const player = game.players[playerIndex];
  const [a, b] = player.holeCards;
  if (!a || !b) return 0.4;
  const high = Math.max(RANK_ORDER[a.rank], RANK_ORDER[b.rank]);
  const low = Math.min(RANK_ORDER[a.rank], RANK_ORDER[b.rank]);
  const suitedBonus = a.suit === b.suit ? 0.06 : 0;
  const pairBonus = a.rank === b.rank ? 0.22 + high / 100 : 0;
  const gapPenalty = a.rank === b.rank ? 0 : Math.max(0, (high - low - 1) * 0.02);
  const boardFactor = game.communityCards.length * 0.03;
  const base = (high + low) / 34;
  return Math.max(0, Math.min(1, base + suitedBonus + pairBonus + boardFactor - gapPenalty));
}

function selectConservativeAction(validActions, { aggression = 0.2, allInWeight = 0.02 } = {}) {
  const call = findAction(validActions, 'call');
  const check = findAction(validActions, 'check');
  const raise = findAction(validActions, 'raise');
  const fold = findAction(validActions, 'fold');
  const allIn = findAction(validActions, 'all_in');
  const pool = [];
  if (check) pool.push({ action: check, weight: 0.45 });
  if (call) pool.push({ action: call, weight: 0.35 });
  if (fold) pool.push({ action: fold, weight: 0.18 - aggression * 0.1 });
  if (raise) pool.push({ action: raise, weight: 0.06 + aggression * 0.45 });
  if (allIn) pool.push({ action: allIn, weight: allInWeight });
  return weightedPick(pool) ?? validActions[0];
}

function maybeShove(validActions, strength, riskFactor = 0.75) {
  const allIn = findAction(validActions, 'all_in');
  if (!allIn) return null;
  if (strength >= riskFactor && Math.random() < 0.45) return allIn;
  return null;
}

function aggressiveDecision(validActions, strength, threshold) {
  const raise = findAction(validActions, 'raise');
  const call = findAction(validActions, 'call');
  const check = findAction(validActions, 'check');
  const fold = findAction(validActions, 'fold');
  if (strength >= threshold) return raise ?? call ?? check ?? validActions[0];
  if (strength >= threshold - 0.12) return call ?? check ?? fold ?? validActions[0];
  return fold ?? check ?? call ?? validActions[0];
}

function hasRanks(player, ranks) {
  const hand = new Set(player.holeCards.map((c) => c.rank));
  return ranks.every((rank) => hand.has(rank));
}

function hasAnyPair(player) {
  return player.holeCards[0]?.rank && player.holeCards[0].rank === player.holeCards[1]?.rank;
}

function preflopHandScore(player) {
  const [a, b] = player.holeCards;
  if (!a || !b) return 0;
  let score = 0;
  if (a.rank === b.rank) score += 10;
  if (a.suit === b.suit) score += 2;
  if (RANK_ORDER[a.rank] >= 11) score += 1;
  if (RANK_ORDER[b.rank] >= 11) score += 1;
  return score;
}

function createStrategyChooser(key) {
  if (key === 'pure_random') {
    return ({ validActions }) => randomPick(validActions) ?? validActions[0];
  }
  if (key === 'always_call') {
    return ({ validActions }) => findAction(validActions, 'call')
      ?? findAction(validActions, 'check')
      ?? findAction(validActions, 'fold')
      ?? validActions[0];
  }
  if (key === 'premium_only') {
    return ({ game, playerIndex, validActions }) => {
      const player = game.players[playerIndex];
      const premiumPair = hasAnyPair(player) && ['A', 'K', 'Q'].includes(player.holeCards[0]?.rank);
      const ak = hasRanks(player, ['A', 'K']);
      const shouldPlay = premiumPair || ak || game.stage !== 'preflop';
      if (shouldPlay) return findAction(validActions, 'raise') ?? findAction(validActions, 'call') ?? findAction(validActions, 'check') ?? validActions[0];
      return findAction(validActions, 'fold') ?? findAction(validActions, 'check') ?? validActions[0];
    };
  }
  if (key === 'pair_broadway') {
    return ({ game, playerIndex, validActions }) => {
      const player = game.players[playerIndex];
      const hasBroadway = hasRanks(player, ['A', 'K']) || hasRanks(player, ['A', 'Q']) || hasRanks(player, ['A', 'J']);
      const shouldPlay = hasAnyPair(player) || hasBroadway || game.stage !== 'preflop';
      if (shouldPlay) return findAction(validActions, 'raise') ?? findAction(validActions, 'call') ?? findAction(validActions, 'check') ?? validActions[0];
      return findAction(validActions, 'fold') ?? findAction(validActions, 'check') ?? validActions[0];
    };
  }
  if (key === 'hand_score') {
    return ({ game, playerIndex, validActions }) => {
      const player = game.players[playerIndex];
      const preflopScore = preflopHandScore(player);
      const postflopBoost = game.stage === 'preflop' ? 0 : Math.round(estimateStrength(game, playerIndex) * 4);
      const score = preflopScore + postflopBoost;
      if (score >= 12) return findAction(validActions, 'raise') ?? findAction(validActions, 'call') ?? findAction(validActions, 'check') ?? validActions[0];
      if (score >= 9) return findAction(validActions, 'call') ?? findAction(validActions, 'check') ?? validActions[0];
      return findAction(validActions, 'fold') ?? findAction(validActions, 'check') ?? findAction(validActions, 'call') ?? validActions[0];
    };
  }
  if (key === 'threshold_60') {
    return ({ game, playerIndex, validActions }) => aggressiveDecision(validActions, estimateStrength(game, playerIndex), 0.6);
  }
  if (key === 'threshold_70') {
    return ({ game, playerIndex, validActions }) => aggressiveDecision(validActions, estimateStrength(game, playerIndex), 0.7);
  }
  if (key === 'phase_adaptive') {
    return ({ game, playerIndex, validActions }) => {
      const stageThreshold = { preflop: 0.72, flop: 0.64, turn: 0.58, river: 0.53 };
      const threshold = stageThreshold[game.stage] ?? 0.62;
      const strength = estimateStrength(game, playerIndex);
      const shove = maybeShove(validActions, strength, 0.9);
      return shove ?? aggressiveDecision(validActions, strength, threshold);
    };
  }
  if (key === 'mimic') {
    return ({ game, playerIndex, validActions }) => {
      const opponents = game.players.filter((p) => p.id !== playerIndex);
      const lastActions = opponents
        .map((p) => p.actionHistory.at(-1))
        .filter(Boolean);
      const lastAggressive = [...lastActions].reverse().find((a) => a.action === 'raise' || a.action === 'all_in');
      if (lastAggressive?.action === 'all_in') return findAction(validActions, 'call') ?? findAction(validActions, 'fold') ?? validActions[0];
      if (lastAggressive?.action === 'raise') return findAction(validActions, 'raise') ?? findAction(validActions, 'call') ?? validActions[0];
      return selectConservativeAction(validActions, { aggression: 0.15, allInWeight: 0.01 });
    };
  }
  if (key === 'mimic_lag') {
    return ({ game, playerIndex, validActions }) => {
      const opponents = game.players.filter((p) => p.id !== playerIndex);
      const laggedActions = opponents
        .map((p) => p.actionHistory.at(-2))
        .filter(Boolean);
      const laggedAggressive = laggedActions.find((a) => a.action === 'raise' || a.action === 'all_in');
      if (laggedAggressive?.action === 'raise' && Math.random() < 0.7) {
        return findAction(validActions, 'raise') ?? findAction(validActions, 'call') ?? validActions[0];
      }
      if (laggedAggressive?.action === 'all_in' && Math.random() < 0.55) {
        return findAction(validActions, 'call') ?? findAction(validActions, 'fold') ?? validActions[0];
      }
      return selectConservativeAction(validActions, { aggression: 0.22, allInWeight: 0.015 });
    };
  }
  if (key === 'tight_aggressive') {
    return ({ game, playerIndex, validActions }) => {
      const strength = estimateStrength(game, playerIndex);
      const shove = maybeShove(validActions, strength, 0.92);
      if (shove) return shove;
      if (strength >= 0.68) return findAction(validActions, 'raise') ?? findAction(validActions, 'call') ?? validActions[0];
      if (strength >= 0.54) return findAction(validActions, 'call') ?? findAction(validActions, 'check') ?? validActions[0];
      return findAction(validActions, 'fold') ?? findAction(validActions, 'check') ?? validActions[0];
    };
  }
  if (key === 'gto_lite') {
    return ({ game, playerIndex, validActions }) => {
      const strength = estimateStrength(game, playerIndex);
      const pot = Math.max(game.pot, game.bigBlind);
      const player = game.players[playerIndex];
      const toCall = Math.max(0, game.currentBet - player.currentBet);
      const potOdds = toCall / (pot + toCall);
      const bluffRate = Math.max(0.05, 0.22 - strength * 0.2);
      const raise = findAction(validActions, 'raise');
      const call = findAction(validActions, 'call');
      const check = findAction(validActions, 'check');
      const fold = findAction(validActions, 'fold');
      const allIn = findAction(validActions, 'all_in');
      if (allIn && strength > 0.95 && Math.random() < 0.3) return allIn;
      if (raise && (strength > 0.62 || Math.random() < bluffRate)) return raise;
      if (call && strength + 0.08 >= potOdds) return call;
      return check ?? fold ?? call ?? validActions[0];
    };
  }
  return ({ validActions }) => {
    const allIn = findAction(validActions, 'all_in');
    const toKeep = validActions.filter((a) => a.type !== 'all_in');
    if (allIn && toKeep.length > 0) {
      const pick = weightedPick([
        { action: randomPick(toKeep), weight: 0.92 },
        { action: allIn, weight: 0.08 },
      ]);
      return pick ?? randomPick(validActions);
    }
    return selectConservativeAction(validActions, { aggression: 0.2, allInWeight: 0.01 });
  };
}

export function createStrategyByKey(key = DEFAULT_STRATEGY_KEY) {
  const chooser = createStrategyChooser(key);
  const safeKey = STRATEGY_LIBRARY.some((s) => s.key === key) ? key : DEFAULT_STRATEGY_KEY;
  return {
    key: safeKey,
    chooseAction(context) {
      return chooser(context);
    },
  };
}

export function createRandomStrategy() {
  return createStrategyByKey(DEFAULT_STRATEGY_KEY);
}
