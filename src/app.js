import { PokerGame } from './engine.js';
import { createStrategyByKey, DEFAULT_STRATEGY_KEY, STRATEGY_LIBRARY } from './strategies.js';

const DEFAULT_PLAYER_COUNT = 6;

const state = {
  stepMode: false,
  running: false,
  probabilities: {},
  publicWinProbabilities: {},
  quickMode: false,
};

const el = {
  runQuick: document.getElementById('runQuick'),
  quickHands: document.getElementById('quickHands'),
  runSingle: document.getElementById('runSingle'),
  startStep: document.getElementById('startStep'),
  nextStep: document.getElementById('nextStep'),
  resetGame: document.getElementById('resetGame'),
  applyPlayerCount: document.getElementById('applyPlayerCount'),
  playerCount: document.getElementById('playerCount'),
  defaultStrategy: document.getElementById('defaultStrategy'),
  replacePlayer: document.getElementById('replacePlayer'),
  replacePlayerSelect: document.getElementById('replacePlayerSelect'),
  replaceName: document.getElementById('replaceName'),
  replaceStrategy: document.getElementById('replaceStrategy'),
  replaceStack: document.getElementById('replaceStack'),
  speed: document.getElementById('speed'),
  speedValue: document.getElementById('speedValue'),
  stage: document.getElementById('stage'),
  pot: document.getElementById('pot'),
  table: document.getElementById('tableView'),
  community: document.getElementById('communityCards'),
  log: document.getElementById('actionLog'),
  ranking: document.getElementById('ranking'),
  playerSelect: document.getElementById('playerSelect'),
  playerChart: document.getElementById('playerChart'),
  allStacksChart: document.getElementById('allStacksChart'),
  globalChart: document.getElementById('globalChart'),
  playerLegend: document.getElementById('playerLegend'),
  allStacksLegend: document.getElementById('allStacksLegend'),
  globalLegend: document.getElementById('globalLegend'),
};

let game;

function strategyOptionsHtml(selectedKey) {
  return STRATEGY_LIBRARY.map((s) => `<option value="${s.key}" title="${s.description}" ${s.key === selectedKey ? 'selected' : ''}>${s.label}</option>`).join('');
}

function findStrategyEntry(strategyKey) {
  return STRATEGY_LIBRARY.find((s) => s.key === strategyKey) ?? STRATEGY_LIBRARY.find((s) => s.key === DEFAULT_STRATEGY_KEY) ?? STRATEGY_LIBRARY[0];
}

function syncStrategyDescription(selectEl) {
  if (!selectEl) return;
  const entry = findStrategyEntry(selectEl.value);
  if (!entry) return;
  selectEl.title = `${entry.label} — ${entry.description}`;
}

function fillStrategySelectors() {
  el.defaultStrategy.innerHTML = strategyOptionsHtml(DEFAULT_STRATEGY_KEY);
  el.replaceStrategy.innerHTML = strategyOptionsHtml(DEFAULT_STRATEGY_KEY);
  syncStrategyDescription(el.defaultStrategy);
  syncStrategyDescription(el.replaceStrategy);
}

function createPlayerConfigs(playerCount, strategyKey) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return Array.from({ length: playerCount }, (_, i) => ({
    name: `Bot ${alphabet[i] ?? i + 1}`,
    strategyKey,
  }));
}

function setButtonsRunning(activeButton = null) {
  [el.runQuick, el.runSingle, el.startStep, el.nextStep].forEach((button) => button.classList.remove('is-running'));
  if (activeButton) activeButton.classList.add('is-running');
}

function makeLinePoints(values, width, height, min, max, padding = 20) {
  if (!values.length) return [];
  const range = Math.max(max - min, 1);
  const usableW = width - padding * 2;
  const usableH = height - padding * 2;
  return values.map((v, i) => {
    const x = padding + (values.length <= 1 ? usableW / 2 : (i / (values.length - 1)) * usableW);
    const y = padding + ((max - v) / range) * usableH;
    return { x, y };
  });
}

function drawChart(svg, series) {
  const width = 640;
  const height = 260;
  const padding = 20;
  const maxLength = Math.max(...series.map((s) => s.values.length), 1);
  const values = series.flatMap((s) => [...s.values, ...(s.points ?? []).map((p) => p.value)]);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  svg.innerHTML = '';

  const axis = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  axis.setAttribute('d', `M${padding} ${padding} L${padding} ${height - padding} L${width - padding} ${height - padding}`);
  axis.setAttribute('stroke', '#9fb');
  axis.setAttribute('stroke-width', '1');
  axis.setAttribute('fill', 'none');
  svg.append(axis);

  const tickStep = maxLength > 50 ? Math.ceil(maxLength / 50) : 1;
  for (let i = 0; i < maxLength; i += tickStep) {
    const x = padding + (maxLength <= 1 ? (width - padding * 2) / 2 : (i / (maxLength - 1)) * (width - padding * 2));
    const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    tick.setAttribute('x1', x.toFixed(2));
    tick.setAttribute('x2', x.toFixed(2));
    tick.setAttribute('y1', `${height - padding}`);
    tick.setAttribute('y2', `${height - padding + 4}`);
    tick.setAttribute('stroke', 'rgba(255,255,255,0.4)');
    tick.setAttribute('stroke-width', '1');
    svg.append(tick);
  }

  for (const item of series) {
    const points = makeLinePoints(item.values, width, height, min, max, padding);
    const pathData = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', pathData);
    line.setAttribute('stroke', item.color);
    line.setAttribute('stroke-width', '2');
    line.setAttribute('fill', 'none');
    svg.append(line);

    for (const marker of item.points ?? []) {
      const markerPoint = makeLinePoints([marker.value], width, height, min, max, padding)[0];
      const x = padding + (maxLength <= 1 ? (width - padding * 2) / 2 : (marker.index / (maxLength - 1)) * (width - padding * 2));
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', x.toFixed(2));
      circle.setAttribute('cy', markerPoint.y.toFixed(2));
      circle.setAttribute('r', '3');
      circle.setAttribute('fill', marker.color ?? '#ff9f1c');
      svg.append(circle);
    }
  }
}

function renderLegend(container, items) {
  container.innerHTML = items
    .map((item) => `<span class="legend-item"><span class="legend-swatch" style="background:${item.color}"></span>${item.label}</span>`)
    .join('');
}

function populatePlayerControls() {
  const currentSelected = Number(el.playerSelect.value);
  const replaceSelected = Number(el.replacePlayerSelect.value);
  el.playerSelect.innerHTML = '';
  el.replacePlayerSelect.innerHTML = '';
  for (const p of game.players) {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = p.name;
    el.playerSelect.append(option);

    const replaceOption = document.createElement('option');
    replaceOption.value = p.id;
    replaceOption.textContent = `${p.name} (${p.stack})`;
    el.replacePlayerSelect.append(replaceOption);
  }
  el.playerSelect.value = String(game.players.some((p) => p.id === currentSelected) ? currentSelected : game.players[0]?.id ?? 0);
  el.replacePlayerSelect.value = String(game.players.some((p) => p.id === replaceSelected) ? replaceSelected : game.players[0]?.id ?? 0);
}

function updateRanking() {
  const sorted = [...game.players].sort((a, b) => b.stack - a.stack);
  el.ranking.innerHTML = sorted
    .map((p, i) => `<li><strong>#${i + 1}</strong> ${p.name} — ${p.stack}</li>`)
    .join('');
}

function cardNode(card) {
  const container = document.createElement('div');
  container.className = 'card-slot';
  if (!card) {
    container.textContent = '🂠';
    return container;
  }
  const symbols = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const rankLabel = card.rank === 'T' ? '10' : card.rank;
  container.classList.add(card.suit === 'H' || card.suit === 'D' ? 'red' : 'black');
  container.innerHTML = `<span class="rank">${rankLabel}</span><span class="suit">${symbols[card.suit]}</span>`;
  return container;
}

function updateCharts() {
  const selected = game.players[Number(el.playerSelect.value) || 0];
  if (!selected) return;
  const stackSeries = selected.stats.stackHistory;
  const probSeries = selected.stats.winProbHistory.map((v) => Number((v * 100).toFixed(2)));
  const allInPoints = selected.stats.allInHands.map((handNumber) => {
    const index = Math.min(stackSeries.length - 1, Math.max(0, handNumber));
    return { index, value: stackSeries[index], color: '#ff9f1c' };
  });

  drawChart(el.playerChart, [
    { values: stackSeries, color: '#ff6b6b' },
    { values: probSeries, color: '#ffd166' },
    { values: stackSeries, color: 'transparent', points: allInPoints },
  ]);
  renderLegend(el.playerLegend, [
    { color: '#ff6b6b', label: 'Stack' },
    { color: '#ffd166', label: 'Win % (complète)' },
    { color: '#ff9f1c', label: 'Point all-in' },
  ]);

  const stackPalette = ['#ff6b6b', '#4ecdc4', '#ffd166', '#06d6a0', '#118ab2', '#c77dff', '#f72585', '#f4a261', '#90be6d'];
  const allStackSeries = game.players.map((player, index) => ({
    values: player.stats.stackHistory,
    color: stackPalette[index % stackPalette.length],
  }));
  drawChart(el.allStacksChart, allStackSeries);
  renderLegend(el.allStacksLegend, game.players.map((player, index) => ({
    color: stackPalette[index % stackPalette.length],
    label: player.name,
  })));

  drawChart(el.globalChart, [
    { values: game.globalStats.totalPots, color: '#ffd166' },
    { values: game.globalStats.averagePotHistory, color: '#06d6a0' },
    { values: game.globalStats.tableMoneyHistory.slice(1), color: '#118ab2' },
  ]);
  renderLegend(el.globalLegend, [
    { color: '#ffd166', label: 'Pot total' },
    { color: '#06d6a0', label: 'Pot moyen' },
    { color: '#118ab2', label: 'Argent global' },
  ]);
}

function renderTable(activePlayerIndex = null) {
  el.stage.textContent = game.stage;
  el.pot.textContent = game.pot;
  el.community.innerHTML = '';
  for (let i = 0; i < 5; i += 1) el.community.append(cardNode(game.communityCards[i]));

  el.table.innerHTML = '';
  for (const p of game.players) {
    const seat = document.createElement('div');
    seat.className = 'seat';
    if (activePlayerIndex === p.id) seat.classList.add('active');
    if (game.lastWinners.includes(p.id)) seat.classList.add('winner');

    const prob = state.probabilities[p.id] ?? { win: 0, split: 0, lose: 0 };
    const publicWin = state.publicWinProbabilities[p.id] ?? 0;
    const cards = document.createElement('div');
    cards.className = 'cards';
    cards.append(cardNode(p.holeCards[0]), cardNode(p.holeCards[1]));

    seat.innerHTML = `
      <h4>${p.name}</h4>
      <div>Stack: <strong>${p.stack}</strong></div>
      <div>Mise main: ${p.contribution}</div>
      <div>Dernière action: ${p.actionHistory.at(-1)?.action ?? '-'}</div>
      <div>Proba victoire (incomplète): <strong>${Math.round(publicWin * 100)}%</strong></div>
      <div>Win ${Math.round(prob.win * 100)}% / Split ${Math.round(prob.split * 100)}% / Lose ${Math.round(prob.lose * 100)}%</div>
      <label class="seat-strategy">
        Stratégie
        <select data-player-id="${p.id}" class="seat-strategy-select">${strategyOptionsHtml(p.strategyKey)}</select>
      </label>
    `;
    seat.append(cards);
    el.table.append(seat);
  }

  el.table.querySelectorAll('.seat-strategy-select').forEach((select) => syncStrategyDescription(select));

  populatePlayerControls();
  updateRanking();
  updateCharts();
}

function appendLog(msg) {
  const li = document.createElement('li');
  li.textContent = msg;
  el.log.append(li);
  while (el.log.children.length > 320) el.log.removeChild(el.log.firstChild);
  el.log.scrollTop = el.log.scrollHeight;
}

function updateProbabilities(knownIterations, publicIterations) {
  state.probabilities = game.estimateProbabilities(knownIterations);
  state.publicWinProbabilities = {};
  for (const p of game.players) {
    state.publicWinProbabilities[p.id] = game.estimatePublicWinProbability(p.id, publicIterations);
  }
}

function processEvent(event) {
  if (!event) return;
  if (event.type === 'hand_start') {
    appendLog(`🂡 Nouvelle main #${game.globalStats.handCount}. Dealer: ${game.players[event.dealerIndex].name}`);
  } else if (event.type === 'action') {
    appendLog(`${game.players[event.playerIndex].name} -> ${event.action}${event.amount ? ` (${event.amount})` : ''}`);
  } else if (event.type === 'street') {
    appendLog(`--- ${event.stage.toUpperCase()} ---`);
  } else if (event.type === 'hand_end') {
    appendLog(`🏆 Gagnant(s): ${event.winners.map((id) => game.players[id].name).join(', ')} | Pot ${event.pot}`);
  }

  updateProbabilities(state.quickMode ? 24 : 80, state.quickMode ? 16 : 60);
  renderTable(event.playerIndex ?? null);
}

function ensureHand() {
  if (!game.handComplete) return;
  processEvent(game.startHand());
}

async function playAutomaticHand() {
  if (state.running) return;
  ensureHand();
  state.running = true;
  state.quickMode = false;
  setButtonsRunning(el.runSingle);
  while (!game.handComplete && state.running) {
    processEvent(game.step());
    await new Promise((resolve) => setTimeout(resolve, Number(el.speed.value)));
  }
  state.running = false;
  setButtonsRunning();
}

async function runQuickSimulation(handCount) {
  if (state.running) return;
  state.running = true;
  state.quickMode = true;
  setButtonsRunning(el.runQuick);
  for (let i = 0; i < handCount && state.running; i += 1) {
    if (game.players.filter((p) => p.stack > 0).length < 2) break;
    processEvent(game.startHand());
    while (!game.handComplete && state.running) processEvent(game.step());
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  state.running = false;
  state.quickMode = false;
  setButtonsRunning();
}

function createGame(playerCount, strategyKey, clearLog = true) {
  game = new PokerGame({
    playerNames: createPlayerConfigs(playerCount, strategyKey),
    strategyFactory: ({ strategyKey: key }) => createStrategyByKey(key),
  });
  state.stepMode = false;
  state.running = false;
  state.quickMode = false;
  state.probabilities = {};
  state.publicWinProbabilities = {};
  if (clearLog) el.log.innerHTML = '';
  populatePlayerControls();
  updateProbabilities(40, 40);
  renderTable();
}

el.runQuick.addEventListener('click', () => runQuickSimulation(Number(el.quickHands.value)));
el.runSingle.addEventListener('click', () => playAutomaticHand());
el.startStep.addEventListener('click', () => {
  state.stepMode = true;
  setButtonsRunning(el.startStep);
  ensureHand();
});
el.nextStep.addEventListener('click', () => {
  if (!state.stepMode) return;
  setButtonsRunning(el.nextStep);
  ensureHand();
  processEvent(game.step());
});
el.playerSelect.addEventListener('change', () => renderTable());
el.speed.addEventListener('input', () => {
  el.speedValue.textContent = `${el.speed.value} ms`;
});
el.applyPlayerCount.addEventListener('click', () => {
  if (state.running) return;
  createGame(Number(el.playerCount.value), el.defaultStrategy.value);
});
el.resetGame.addEventListener('click', () => {
  if (state.running) return;
  game.resetForNewSession();
  state.stepMode = false;
  state.running = false;
  state.quickMode = false;
  state.probabilities = {};
  state.publicWinProbabilities = {};
  setButtonsRunning();
  el.log.innerHTML = '';
  updateProbabilities(40, 40);
  renderTable();
});
el.replacePlayer.addEventListener('click', () => {
  if (state.running) return;
  const playerIndex = Number(el.replacePlayerSelect.value);
  const parsedStack = Number(el.replaceStack.value);
  const stack = Number.isFinite(parsedStack) && parsedStack > 0 ? parsedStack : undefined;
  const updated = game.replacePlayer(playerIndex, {
    name: el.replaceName.value,
    stack,
    strategyKey: el.replaceStrategy.value,
    resetStats: true,
  });
  if (updated) {
    appendLog(`🔁 ${updated.name} rejoint la table avec la stratégie ${el.replaceStrategy.value}.`);
    updateProbabilities(40, 40);
    renderTable();
  }
});

el.table.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement) || !target.classList.contains('seat-strategy-select')) return;
  const playerId = Number(target.dataset.playerId);
  game.setPlayerStrategy(playerId, target.value);
  syncStrategyDescription(target);
  appendLog(`🎯 ${game.players[playerId].name} adopte ${target.value}.`);
  renderTable();
});

el.defaultStrategy.addEventListener('change', () => syncStrategyDescription(el.defaultStrategy));
el.defaultStrategy.addEventListener('mouseover', () => syncStrategyDescription(el.defaultStrategy));
el.replaceStrategy.addEventListener('change', () => syncStrategyDescription(el.replaceStrategy));
el.replaceStrategy.addEventListener('mouseover', () => syncStrategyDescription(el.replaceStrategy));

fillStrategySelectors();
el.playerCount.value = String(DEFAULT_PLAYER_COUNT);
el.speedValue.textContent = `${el.speed.value} ms`;
createGame(DEFAULT_PLAYER_COUNT, DEFAULT_STRATEGY_KEY, true);
