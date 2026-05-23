import test from 'node:test';
import assert from 'node:assert/strict';
import { PokerGame } from '../src/engine.js';

test('startHand deals cards and posts blinds', () => {
  const game = new PokerGame({ playerNames: ['A', 'B', 'C', 'D'] });
  const event = game.startHand();

  assert.equal(event.type, 'hand_start');
  const playersWithCards = game.players.filter((p) => p.stack >= 0 && p.holeCards.length === 2);
  assert.equal(playersWithCards.length, 4);
  assert.ok(game.pot >= game.smallBlind + game.bigBlind);
  assert.equal(game.stage, 'preflop');
});

test('single hand completes and keeps chip conservation', () => {
  const game = new PokerGame({ playerNames: ['A', 'B', 'C', 'D', 'E'] });
  const initial = game.players.reduce((sum, p) => sum + p.stack, 0);

  game.startHand();
  let guard = 0;
  while (!game.handComplete && guard < 500) {
    game.step();
    guard += 1;
  }

  assert.ok(game.handComplete);
  const finalMoney = game.players.reduce((sum, p) => sum + p.stack, 0);
  assert.equal(finalMoney, initial);
});

test('probability estimate outputs bounded values', () => {
  const game = new PokerGame({ playerNames: ['A', 'B', 'C'] });
  game.startHand();
  const probs = game.estimateProbabilities(40);

  for (const p of game.players) {
    const pr = probs[p.id];
    assert.ok(pr.win >= 0 && pr.win <= 1);
    assert.ok(pr.split >= 0 && pr.split <= 1);
    assert.ok(pr.lose >= 0 && pr.lose <= 1);
    assert.ok(Math.abs(pr.win + pr.split + pr.lose - 1) < 0.00001);
  }
});

test('resetForNewSession resets stacks and keeps player identity/strategy', () => {
  const game = new PokerGame({
    playerNames: [
      { name: 'Neo', strategyKey: 'threshold_60' },
      { name: 'Trinity', strategyKey: 'mimic' },
    ],
  });

  game.startHand();
  let guard = 0;
  while (!game.handComplete && guard < 300) {
    game.step();
    guard += 1;
  }
  game.setPlayerStrategy(0, 'gto_lite');
  game.players[1].name = 'Trinity 2';

  game.resetForNewSession();

  assert.equal(game.stage, 'idle');
  assert.equal(game.handComplete, true);
  assert.equal(game.players[0].stack, game.startingStack);
  assert.equal(game.players[1].stack, game.startingStack);
  assert.equal(game.players[0].strategyKey, 'gto_lite');
  assert.equal(game.players[1].strategyKey, 'mimic');
  assert.equal(game.players[0].name, 'Neo');
  assert.equal(game.players[1].name, 'Trinity 2');
  assert.equal(game.globalStats.handCount, 0);
});
