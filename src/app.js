import { PokerGame } from './engine.js';

const players = ['Bot A', 'Bot B', 'Bot C', 'Bot D', 'Bot E', 'Bot F'];
const game = new PokerGame({ playerNames: players });

const state = {
  stepMode: false,
  running: false,
  activePlayerChart: 0,
  probabilities: {},
};

const el = {
  runQuick: document.getElementById('runQuick'),
  quickHands: document.getElementById('quickHands'),
  runSingle: document.getElementById('runSingle'),
  startStep: document.getElementById('startStep'),
  nextStep: document.getElementById('nextStep'),
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
  globalChart: document.getElementById('globalChart'),
};

for (const p of game.players) {
  const option = document.createElement('option');
  option.value = p.id;
  option.textContent = p.name;
  el.playerSelect.append(option);
}

function makeLinePath(values, width, height, padding = 20) {
  if (!values.length) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const usableW = width - padding * 2;
  const usableH = height - padding * 2;
  return values
    .map((v, i) => {
      const x = padding + (values.length === 1 ? usableW / 2 : (i / (values.length - 1)) * usableW);
      const y = padding + ((max - v) / range) * usableH;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function drawChart(svg, series) {
  const width = 640;
  const height = 260;
  svg.innerHTML = '';
  const axis = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  axis.setAttribute('d', 'M20 20 L20 240 L620 240');
  axis.setAttribute('stroke', '#9fb');
  axis.setAttribute('stroke-width', '1');
  axis.setAttribute('fill', 'none');
  svg.append(axis);

  for (const item of series) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', makeLinePath(item.values, width, height));
    line.setAttribute('stroke', item.color);
    line.setAttribute('stroke-width', '2');
    line.setAttribute('fill', 'none');
    svg.append(line);
  }
}

function cardNode(card) {
  const container = document.createElement('div');
  container.className = 'card-slot';
  if (!card) {
    container.textContent = '🂠';
    return container;
  }
  const symbols = { S: '♠', H: '♥', D: '♦', C: '♣' };
  container.classList.add(card.suit === 'H' || card.suit === 'D' ? 'red' : 'black');
  container.innerHTML = `<span class="rank">${card.rank}</span><span class="suit">${symbols[card.suit]}</span>`;
  return container;
}

function updateRanking() {
  const sorted = [...game.players].sort((a, b) => b.stack - a.stack);
  el.ranking.innerHTML = sorted
    .map((p, i) => `<li><strong>#${i + 1}</strong> ${p.name} — ${p.stack}</li>`)
    .join('');
}

function updateCharts() {
  const selected = game.players[Number(el.playerSelect.value) || 0];
  drawChart(el.playerChart, [
    { values: selected.stats.stackHistory, color: '#ff6b6b' },
    { values: selected.stats.winProbHistory.map((v) => Number((v * 100).toFixed(2))), color: '#ffd166' },
  ]);
  drawChart(el.globalChart, [
    { values: game.globalStats.totalPots, color: '#ffd166' },
    { values: game.globalStats.averagePotHistory, color: '#06d6a0' },
    { values: game.globalStats.tableMoneyHistory.slice(1), color: '#118ab2' },
  ]);
}

function renderTable(activePlayerIndex = null) {
  el.stage.textContent = game.stage;
  el.pot.textContent = game.pot;
  el.community.innerHTML = '';
  for (let i = 0; i < 5; i += 1) {
    el.community.append(cardNode(game.communityCards[i]));
  }

  el.table.innerHTML = '';
  for (const p of game.players) {
    const seat = document.createElement('div');
    seat.className = 'seat';
    if (activePlayerIndex === p.id) seat.classList.add('active');
    if (game.lastWinners.includes(p.id)) seat.classList.add('winner');

    const prob = state.probabilities[p.id] ?? { win: 0, split: 0, lose: 0 };
    const cards = document.createElement('div');
    cards.className = 'cards';
    cards.append(cardNode(p.holeCards[0]), cardNode(p.holeCards[1]));

    seat.innerHTML = `
      <h4>${p.name}</h4>
      <div>Stack: <strong>${p.stack}</strong></div>
      <div>Mise main: ${p.contribution}</div>
      <div>Dernière action: ${p.actionHistory.at(-1)?.action ?? '-'}</div>
      <div>Win ${Math.round(prob.win * 100)}% / Split ${Math.round(prob.split * 100)}% / Lose ${Math.round(prob.lose * 100)}%</div>
    `;
    seat.append(cards);
    el.table.append(seat);
  }

  updateRanking();
  updateCharts();
}

function appendLog(msg) {
  const li = document.createElement('li');
  li.textContent = msg;
  el.log.prepend(li);
}

function processEvent(event) {
  if (!event) return;
  if (event.type === 'hand_start') {
    appendLog(`🂡 Nouvelle main. Dealer: ${game.players[event.dealerIndex].name}`);
  } else if (event.type === 'action') {
    appendLog(`${game.players[event.playerIndex].name} -> ${event.action}${event.amount ? ` (${event.amount})` : ''}`);
  } else if (event.type === 'street') {
    appendLog(`--- ${event.stage.toUpperCase()} ---`);
  } else if (event.type === 'hand_end') {
    appendLog(`🏆 Gagnant(s): ${event.winners.map((id) => game.players[id].name).join(', ')} | Pot ${event.pot}`);
  }

  state.probabilities = game.estimateProbabilities();
  renderTable(event.playerIndex ?? null);
}

function ensureHand() {
  if (!game.handComplete) return;
  processEvent(game.startHand());
}

async function playAutomaticHand() {
  ensureHand();
  state.running = true;
  while (!game.handComplete && state.running) {
    processEvent(game.step());
    await new Promise((resolve) => setTimeout(resolve, Number(el.speed.value)));
  }
  state.running = false;
}

async function runQuickSimulation(handCount) {
  state.running = true;
  for (let i = 0; i < handCount && state.running; i += 1) {
    if (game.players.filter((p) => p.stack > 0).length < 2) break;
    processEvent(game.startHand());
    while (!game.handComplete && state.running) {
      processEvent(game.step());
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  state.running = false;
}

el.runQuick.addEventListener('click', () => runQuickSimulation(Number(el.quickHands.value)));
el.runSingle.addEventListener('click', () => playAutomaticHand());
el.startStep.addEventListener('click', () => {
  state.stepMode = true;
  ensureHand();
});
el.nextStep.addEventListener('click', () => {
  if (!state.stepMode) return;
  ensureHand();
  processEvent(game.step());
});
el.playerSelect.addEventListener('change', () => renderTable());
el.speed.addEventListener('input', () => {
  el.speedValue.textContent = `${el.speed.value} ms`;
});

el.speedValue.textContent = `${el.speed.value} ms`;
renderTable();
