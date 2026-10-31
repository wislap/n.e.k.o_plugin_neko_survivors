import test from 'node:test';
import assert from 'node:assert/strict';
import { RunProgression } from '../../src/game/run/run-progression.ts';
import { UPGRADES } from '../../src/game/content/upgrades.ts';
import { scaleUpgrade } from '../../src/game/content/upgrades.ts';

const options = [scaleUpgrade(UPGRADES[0], 'rare')];

test('pause resumes the same shop, upgrade roll and challenge context', () => {
  const run = new RunProgression();
  assert.equal(run.pause(), false);
  run.start();
  for (const enter of [() => run.openShop(), () => run.openUpgrade(options, 'shop'), () => run.enterChallenge('halloween', true)]) {
    enter();
    const stage = run.read().stage;
    assert.equal(run.pause(), true);
    assert.equal(run.read().stage.resume, stage);
    assert.equal(run.savePhase, stage.phase);
    assert.equal(run.pause(), false);
    assert.equal(run.resume(), true);
    assert.equal(run.read().stage, stage);
  }
  assert.equal(run.resume(), false);
});

test('upgrade return targets keep the last shop roll and clear the completed combat roll', () => {
  const run = new RunProgression(); run.start();
  run.openUpgrade(options, 'shop');
  assert.equal(run.read().stage.roll, run.read().upgrade);
  assert.equal(run.completeUpgrade(), 'shop');
  assert.deepEqual(run.read().upgrade.options, options);
  run.openShop();
  run.beginWave();
  assert.equal(run.read().upgrade.after, 'shop');
  assert.deepEqual(run.read().upgrade.options, []);
  run.openUpgrade(options);
  assert.equal(run.completeUpgrade(), 'playing');
  assert.deepEqual(run.read().upgrade.options, []);
  assert.throws(() => run.completeUpgrade(), /requires the upgrade stage/);
  assert.equal(run.openUpgrade([], 'shop'), 'shop');
});

test('wave decisions own the nightmare gate, final challenge and endless continuation', () => {
  const run = new RunProgression(); run.start();
  assert.equal(run.nextAfterWave(9, 'nightmare'), 'vergil');
  run.enterChallenge('vergil'); run.openShop();
  assert.equal(run.nextAfterWave(9, 'nightmare'), 'shop');
  assert.equal(run.nextAfterWave(19, 'normal'), 'endless-prompt');
  assert.equal(run.nextAfterWave(19, 'nightmare'), 'flandre');
  assert.equal(run.continueEndless(), false);
  assert.equal(run.enterEndlessPrompt(), true);
  assert.equal(run.enterEndlessPrompt(), false);
  assert.equal(run.continueEndless(), true);
  run.openShop();
  assert.equal(run.nextAfterWave(19, 'nightmare'), 'shop');
});

test('challenge successors preserve chain history and reject a foreign result', () => {
  const run = new RunProgression(); run.start();
  run.enterChallenge('flandre');
  assert.throws(() => run.nextAfterChallenge({ kind: 'vergil', outcome: 'beat' }), /match the active challenge/);
  assert.deepEqual(run.nextAfterChallenge({ kind: 'flandre', outcome: 'beat' }), { challenge: 'remilia', chain: true });
  assert.deepEqual(run.nextAfterChallenge({ kind: 'flandre', outcome: 'extraDeath' }), { phase: 'endless-prompt' });
  run.enterChallenge('remilia', true);
  assert.deepEqual(run.nextAfterChallenge({ kind: 'remilia', outcome: 'timeout' }), { challenge: 'halloween', chain: true });
  assert.deepEqual(run.nextAfterChallenge({ kind: 'remilia', outcome: 'death' }), { phase: 'shop' });
  run.enterChallenge('halloween', true);
  assert.deepEqual(run.nextAfterChallenge({ kind: 'halloween', outcome: 'death' }), { phase: 'endless-prompt' });
  run.openShop();
  assert.equal(run.read().challenge.chain, true);
  run.enterChallenge('halloween');
  assert.deepEqual(run.nextAfterChallenge({ kind: 'halloween', outcome: 'done' }), { phase: 'shop' });
});

test('result history remains observable after returning to title and retry budgets survive restore', () => {
  const run = new RunProgression(); run.start();
  assert.equal(run.end(false), true);
  assert.equal(run.read().stage.outcome, run.read().outcome);
  assert.equal(run.end(true), false);
  assert.equal(run.menuAction(true, true, 4), 'retry');
  const checkpoint = new RunProgression(); checkpoint.start();
  for (let i = 0; i < 5; i++) {
    const attempts = run.captureRetry();
    run.start(); run.restoreHistory(checkpoint.read());
    run.retry(true, 4, attempts);
    run.end(false);
  }
  assert.deepEqual(run.read().retries, { total: 5, manual: 0 });
  assert.equal(run.menuAction(true, true, 4), 'retire-pilot');
  assert.equal(run.menuAction(true, true, 5), 'retry');
  const history = run.captureRetry();
  run.start(); run.restoreHistory(checkpoint.read()); run.retry(false, 4, history);
  assert.deepEqual(run.read().retries, { total: 6, manual: 1 });
  run.end(false, true); run.returnTitle();
  assert.deepEqual(run.read().outcome, { won: false, abandoned: true });
  assert.equal(run.menuAction(true, true, 4), null);
});

test('owned snapshots preserve historical roll, return target, outcome and chain outside active stages', () => {
  const source = new RunProgression(); source.start();
  source.openUpgrade(options, 'shop'); source.completeUpgrade();
  source.enterChallenge('halloween', true); source.end(true);
  source.openShop();
  const snapshot = structuredClone(source.read());
  const restored = new RunProgression(); restored.start(); restored.openShop(); restored.restoreHistory(snapshot);
  assert.deepEqual(restored.read(), snapshot);
  assert.equal(restored.read().stage.phase, 'shop');
  assert.equal(restored.read().upgrade.after, 'shop');
  assert.deepEqual(restored.read().upgrade.options, options);
  assert.deepEqual(restored.read().outcome, { won: true, abandoned: false });
  assert.deepEqual(restored.read().challenge, { kind: 'halloween', chain: true });
  snapshot.upgrade.options.length = 0;
  assert.equal(restored.read().upgrade.options.length, 1);
});

test('restore rebinds paused active data to the sole history objects', () => {
  const source = new RunProgression(); source.start(); source.openUpgrade(options, 'shop'); source.pause();
  const restored = new RunProgression(); restored.start(); restored.openUpgrade(options, 'shop'); restored.pause();
  restored.restoreHistory(source.read());
  assert.equal(restored.read().stage.resume.roll, restored.read().upgrade);
  restored.resume(); assert.equal(restored.completeUpgrade(), 'shop');
  source.resume(); source.enterChallenge('remilia', true); source.pause();
  restored.enterChallenge('remilia', true); restored.pause(); restored.restoreHistory(source.read());
  assert.equal(restored.read().stage.resume.context, restored.read().challenge);
  assert.equal(restored.savePhase, 'remilia');
});

test('a new start preserves the observed previous challenge chain and resets attempt facts', () => {
  const run = new RunProgression(); run.start();
  run.enterChallenge('halloween', true); run.end(true);
  run.setAutoUpgrade(true); run.retry(false, 0);
  run.start();
  assert.equal(run.phase, 'playing');
  assert.deepEqual(run.read().challenge, { kind: 'halloween', chain: true });
  assert.deepEqual(run.read().outcome, { won: false, abandoned: false });
  assert.deepEqual(run.read().retries, { total: 0, manual: 0 });
  assert.equal(run.read().autoUpgrade, false);
});

test('menu decisions share explicit automatic and abandonment rules', () => {
  const run = new RunProgression(); run.start(); run.openUpgrade(options);
  assert.equal(run.menuAction(false, true, 0), null);
  assert.equal(run.menuAction(true, true, 0), 'upgrade');
  run.setAutoUpgrade(true);
  assert.equal(run.menuAction(false, true, 0), 'auto-upgrade');
  assert.equal(run.canAbandon(), true);
  run.pause(); assert.equal(run.canAbandon(), true);
  assert.equal(run.menuAction(true, true, 0), null);
  run.resume(); run.end(false, true);
  assert.equal(run.canAbandon(), false);
  assert.equal(run.menuAction(true, true, 0), null);
  run.returnTitle(); assert.equal(run.canAbandon(), false);
});
