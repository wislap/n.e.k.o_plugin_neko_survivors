import test from 'node:test';
import assert from 'node:assert/strict';
import { GameNarration } from '../../src/game/narration.ts';
import { createGameSession, EMPTY_INPUT } from '../../src/game/index.ts';
import { SessionEngine } from '../../src/game/session-engine.ts';

const options = { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69, pilot: false };
const reports = events => events.filter(event => event.type === 'report');
const voices = events => events.filter(event => event.type === 'speech');
const emotions = events => events.filter(event => event.type === 'avatar-emotion').map(event => event.emotion);
function start(extra = {}) { const session = createGameSession(); session.dispatch({ type: 'start-run', options: { ...options, ...extra } }); return session; }
function fixture(phase, edit = () => {}) {
  const data = start().exportSave(); data.run.phase = phase; edit(data.run);
  return createGameSession({ save: data });
}
function policy() { const events = []; const narration = new GameNarration(event => events.push(event), { next: () => 0 }); return { narration, events }; }

test('all baseline scene events retain context, individual cooldowns and once gates', () => {
  const { narration, events } = policy();
  const context = { wave: 10, hpRatio: .25, level: 9, kills: 8, characterName: '悠怡', difficultyName: '普通', weaponName: '猫爪', bossName: '猫王', upgradeName: '史诗·强健', phase: 2 };
  const cooldowns = { wave_start: 12, level_up: 6, low_hp: 20, boss_phase: 10, pilot_wave: 14 };
  for (const event of ['run_start', 'wave_start', 'wave_clear', 'level_up', 'low_hp', 'boss_spawn', 'boss_phase', 'boss_kill', 'weapon_combo', 'death', 'win', 'pilot_wave', 'pilot_win', 'pilot_lose']) {
    assert.equal(narration.report(event, context), true, event);
    const text = reports(events).at(-1).text;
    for (const value of ['第 10 波', 'Lv 9', '击杀 8', '猫爪', '猫王', '史诗·强健', '第 2 阶段']) assert.ok(text.includes(value), `${event}:${value}`);
    assert.equal(text.includes('血量 25%'), event !== 'wave_start');
    if (cooldowns[event]) {
      assert.equal(narration.report(event, context), false, event);
      narration.advance(cooldowns[event] - .01); assert.equal(narration.report(event, context), false, event);
      narration.advance(.011); assert.equal(narration.report(event, context), true, event);
    }
  }
  assert.equal(narration.report('boss_kill', context, false, 'boss:8:dead'), true);
  narration.advance(100); assert.equal(narration.report('boss_kill', context, false, 'boss:8:dead'), false);
  narration.beginAttempt({ next: () => 0 }); assert.equal(narration.report('boss_kill', context, false, 'boss:8:dead'), true);
});

test('low HP reports cross strictly below 30%, rearm after healing, and retain 20 second cooldown', () => {
  const { narration, events } = policy();
  narration.health({ hpRatio: .3 }, false); assert.equal(events.length, 0);
  narration.health({ hpRatio: .299 }, false); assert.equal(reports(events).length, 1);
  narration.advance(25); narration.health({ hpRatio: .1 }, false); assert.equal(reports(events).length, 1);
  narration.health({ hpRatio: .3 }, false); narration.health({ hpRatio: .2 }, false); assert.equal(reports(events).length, 2);
  narration.health({ hpRatio: .8 }, false); narration.advance(19); narration.health({ hpRatio: .1 }, false); assert.equal(reports(events).length, 2);
  narration.advance(2); narration.health({ hpRatio: .9 }, false); narration.health({ hpRatio: .1 }, false); assert.equal(reports(events).length, 3);
});

test('pilot remaps reports, suppresses self praise, and fixed speech shares no report cooldown', () => {
  const { narration, events } = policy();
  for (const source of ['run_start', 'wave_start', 'boss_spawn', 'boss_kill']) {
    narration.advance(14); assert.equal(narration.report(source, {}, true), true); assert.equal(reports(events).at(-1).event, 'pilot_wave');
  }
  for (const source of ['level_up', 'low_hp', 'boss_phase', 'weapon_combo']) assert.equal(narration.report(source, {}, true), false);
  narration.report('death', {}, true); assert.equal(reports(events).at(-1).event, 'pilot_lose');
  narration.report('win', {}, true); assert.equal(reports(events).at(-1).event, 'pilot_win');
  narration.pilot(true); narration.pilot(false);
  assert.deepEqual(voices(events).map(event => event.text), ['要人家帮你玩了吗～', '诶，要你亲自出马了吗？']);
  narration.pet('捡到了', 'pickup'); assert.equal(voices(events).length, 2);
  narration.pet('治疗', 'heal'); narration.pet('拾取技能', 'vacuum'); narration.pet('天气', 'weather');
  assert.deepEqual(voices(events).slice(-2).map(event => event.text), ['治疗', '天气']);
  narration.advance(1); narration.pet('免费道具', 'freeItem'); assert.equal(events.at(-1).text, '免费道具');
});

for (const phase of ['shop', 'upgrade']) test(`public ${phase} pause freezes AI, inventory, RNG and simulation and resumes original phase`, () => {
  const session = fixture(phase, run => {
    run.pilot = true; run.autoUpgrade = true; run.player.materials = 200;
    if (phase === 'upgrade') { run.player.pendingLevelUps = 1; run.afterUpgrade = 'shop'; }
  });
  assert.equal(session.dispatch({ type: 'pause' }).ok, true);
  const before = session.exportSave(), tick = session.readFrame().tick;
  for (let step = 0; step < 180; step++) session.advance(EMPTY_INPUT);
  assert.equal(session.readUi().phase, 'paused'); assert.equal(session.readFrame().tick, tick);
  assert.deepEqual(session.exportSave(), before);
  assert.equal(session.dispatch({ type: 'next-wave' }).ok, false);
  assert.equal(session.dispatch({ type: 'resume' }).ok, true); assert.equal(session.readUi().phase, phase);
  session.advance(EMPTY_INPUT); assert.notEqual(session.readUi().phase, phase);
});

test('public startup, pilot toggles, continuation, next waves, upgrades and manual combinations report semantic events', () => {
  const session = start();
  assert.deepEqual(reports(session.advance(EMPTY_INPUT).events).map(event => event.event), ['run_start']);
  assert.equal(reports(session.advance(EMPTY_INPUT).events).length, 0);
  session.dispatch({ type: 'set-pilot', enabled: true }); session.dispatch({ type: 'set-pilot', enabled: true });
  session.dispatch({ type: 'set-pilot', enabled: false });
  assert.deepEqual(voices(session.advance(EMPTY_INPUT).events).map(event => event.key), ['pilot:takeover', 'pilot:handover']);
  const piloted = start({ pilot: true });
  const initial = piloted.advance(EMPTY_INPUT).events;
  assert.deepEqual(reports(initial).map(event => event.event), ['pilot_wave']); assert.equal(voices(initial)[0].key, 'pilot:takeover');
  const continued = createGameSession({ save: session.exportSave() });
  assert.equal(reports(continued.advance(EMPTY_INPUT).events).length, 0);
  const wave = fixture('shop'); wave.advance(EMPTY_INPUT); wave.dispatch({ type: 'next-wave' });
  assert.deepEqual(reports(wave.advance(EMPTY_INPUT).events).map(event => event.event), ['wave_start']);
  const boss = fixture('shop', run => { run.waveIndex = 8; }); boss.advance(EMPTY_INPUT); boss.dispatch({ type: 'next-wave' });
  const spawn = reports(boss.advance(EMPTY_INPUT).events); assert.equal(spawn[0].event, 'boss_spawn'); assert.ok(spawn[0].text.includes('对手是'));
  const upgrade = fixture('upgrade', run => { run.player.pendingLevelUps = 1; run.afterUpgrade = 'playing'; });
  upgrade.advance(EMPTY_INPUT); const choice = upgrade.readUi().upgrades[0];
  assert.equal(upgrade.dispatch({ type: 'choose-upgrade', optionId: choice.id, revision: upgrade.readUi().revision }).ok, true);
  const upgradeReport = reports(upgrade.advance(EMPTY_INPUT).events).find(event => event.event === 'level_up');
  assert.ok(upgradeReport.text.includes(choice.name));
  const combine = fixture('shop', run => { run.player.materials = 50; run.player.weapons = [{ id: 'cat_paw', level: 1 }, { id: 'cat_paw', level: 1 }]; });
  combine.advance(EMPTY_INPUT); assert.equal(combine.dispatch({ type: 'combine', weaponId: 'cat_paw', revision: combine.readUi().revision }).ok, true);
  const combo = reports(combine.advance(EMPTY_INPUT).events); assert.equal(combo[0].event, 'weapon_combo'); assert.ok(combo[0].text.includes('金枪鱼刀'));
});

test('public full-slot shop auto-combination reports the actual resulting weapon', () => {
  const session = fixture('shop', run => {
    run.player.materials = 200;
    run.player.weapons = ['cat_paw', 'star_wand', 'pebble_toss', 'fish_shield', 'lucky_coin', 'toy_turret'].map(id => ({ id, level: 1 }));
    run.shop.offers = Array.from({ length: 4 }, () => ({ kind: 'weapon', id: 'cat_paw', price: 1, sold: false, meta: {} }));
  });
  session.advance(EMPTY_INPUT);
  assert.equal(session.dispatch({ type: 'buy-offer', offerId: session.readUi().offers[0].id, revision: session.readUi().revision }).ok, true);
  const delivered = session.advance(EMPTY_INPUT).events;
  const combo = reports(delivered); assert.equal(combo[0].event, 'weapon_combo'); assert.ok(combo[0].text.includes('金枪鱼刀'));
  assert.deepEqual(delivered.filter(event => event.type === 'sound').map(event => event.name), ['combine']);
});

test('actual world boss damage emits phase and kill reports once and normal death emits before run-ended', () => {
  const engine = new SessionEngine(); engine.start(options); engine.beginWave(9);
  for (let step = 0; step < 120 && !engine.battle.world.enemies.items.some(enemy => enemy.boss); step++) engine.advance(EMPTY_INPUT);
  const boss = engine.battle.world.enemies.items.find(enemy => enemy.boss); assert.ok(boss);
  // Exercise real boss invulnerability/gates and damage callbacks without a campaign-strength fixture.
  boss.update(5.1, engine.battle.player, engine.battle.world);
  engine.battle.world.dealDamage(engine.battle.player, null, boss, boss.maxHp * 10, { pierceArmor: true });
  boss.update(.01, engine.battle.player, engine.battle.world);
  let events = engine.advance(EMPTY_INPUT).events;
  assert.ok(reports(events).some(event => event.event === 'boss_phase'));
  assert.deepEqual(emotions(events), ['surprised']);
  for (let hit = 0; hit < 5 && !boss.dead; hit++) {
    boss.update(5.1, engine.battle.player, engine.battle.world);
    engine.battle.world.dealDamage(engine.battle.player, null, boss, boss.maxHp * 10, { pierceArmor: true });
    boss.update(.01, engine.battle.player, engine.battle.world);
  }
  assert.equal(boss.dead, true);
  events = engine.advance(EMPTY_INPUT).events;
  assert.equal(reports(events).filter(event => event.event === 'boss_kill').length, 1);
  assert.equal(emotions(events).filter(emotion => emotion === 'happy').length, 1);
  assert.equal(reports(engine.advance(EMPTY_INPUT).events).filter(event => event.event === 'boss_kill').length, 0);
  const doomed = new SessionEngine(); doomed.start(options); doomed.advance(EMPTY_INPUT);
  // Yui's initial lethal-save is real: the second lethal hit is required to finish the run.
  for (let hit = 0; hit < 3 && !doomed.battle.player.dead; hit++) {
    doomed.battle.player.takeDamage(doomed.battle.player.maxHp * 10, doomed.battle.player.x, doomed.battle.player.y, { fixedDamage: doomed.battle.player.maxHp * 10, ignoreIFrames: true });
    events = doomed.advance(EMPTY_INPUT).events;
  }
  assert.equal(doomed.readUi().phase, 'result');
  assert.ok(events.some(event => event.type === 'sound' && event.name === 'death'));
  assert.deepEqual(emotions(events), ['sad']);
  assert.ok(events.findIndex(event => event.type === 'report' && event.event === 'death') < events.findIndex(event => event.type === 'run-ended'));
});

test('low HP and retry are wired through the public session without replaying new-party speech', () => {
  const low = fixture('playing', run => { run.player.hp = 1; });
  const first = low.advance(EMPTY_INPUT).events; assert.equal(reports(first).filter(event => event.event === 'low_hp').length, 1);
  assert.deepEqual(emotions(first), ['surprised']);
  assert.equal(reports(low.advance(EMPTY_INPUT).events).filter(event => event.event === 'low_hp').length, 0);
  const retry = start({ partySize: 2 }); retry.advance(EMPTY_INPUT); retry.dispatch({ type: 'retry-wave' });
  const events = retry.advance(EMPTY_INPUT).events;
  assert.ok(reports(events).some(event => event.event === 'run_start')); assert.equal(voices(events).filter(event => event.key === 'party:start').length, 0);
});

test('challenge fixed speeches advance once per actual stage and freeze while paused', () => {
  const session = createGameSession(); session.dispatch({ type: 'start-challenge', challenge: 'vergil', options });
  const speech = [];
  for (let step = 0; step < 250; step++) speech.push(...voices(session.advance(EMPTY_INPUT).events));
  session.dispatch({ type: 'pause' });
  for (let step = 0; step < 600; step++) assert.equal(voices(session.advance(EMPTY_INPUT).events).length, 0);
  session.dispatch({ type: 'resume' });
  for (let step = 0; step < 400; step++) speech.push(...voices(session.advance(EMPTY_INPUT).events));
  const challengeSpeech = speech.filter(event => event.key !== 'party:start' && !event.key.startsWith('pet:'));
  assert.equal(challengeSpeech.length, 2); assert.equal(new Set(challengeSpeech.map(event => event.text)).size, 2);
});

for (const challenge of [null, 'vergil']) test(`return-title restores title music after ${challenge ?? 'normal'} combat stop cues`, () => {
  const session = createGameSession();
  session.dispatch(challenge ? { type: 'start-challenge', challenge, options } : { type: 'start-run', options });
  session.advance(EMPTY_INPUT); session.dispatch({ type: 'pause' });
  assert.equal(session.dispatch({ type: 'return-title' }).ok, true);
  const events = session.advance(EMPTY_INPUT).events;
  assert.equal(session.readUi().phase, 'title');
  const music = events.filter(event => event.type === 'music'); assert.equal(music.at(-1).scene, 'title'); assert.ok(!music.at(-1).stop);
});


test('natural public challenge chain reports victory at the endless prompt and final result without closing host output', () => {
  const session = createGameSession();
  session.dispatch({ type: 'start-challenge', challenge: 'flandre', options: { ...options, difficulty: 'nightmare', pilot: true } });
  const events = [], phases = new Set();
  for (let step = 0; step < 40000; step++) {
    events.push(...session.advance(EMPTY_INPUT).events.filter(event => event.type === 'report' || event.type === 'run-ended' || event.type === 'avatar-emotion'));
    const phase = session.readUi().phase; phases.add(phase);
    if (phase === 'endless-prompt') break;
  }
  assert.deepEqual([...phases], ['flandre', 'remilia', 'halloween', 'endless-prompt']);
  assert.equal(reports(events).filter(event => event.event === 'pilot_win').length, 1);
  const victory = events.findIndex(event => event.type === 'report' && event.event === 'pilot_win');
  assert.deepEqual(events[victory + 1], { type: 'avatar-emotion', emotion: 'happy' });
  assert.equal(events.some(event => event.type === 'run-ended'), false);
  assert.equal(session.dispatch({ type: 'finish-run' }).ok, true);
  const final = session.advance(EMPTY_INPUT).events;
  assert.equal(reports(final).filter(event => event.event === 'pilot_win').length, 1);
  assert.deepEqual(emotions(final), ['happy']);
  assert.ok(final.findIndex(event => event.type === 'report' && event.event === 'pilot_win') < final.findIndex(event => event.type === 'run-ended'));
  assert.equal(reports(session.advance(EMPTY_INPUT).events).filter(event => event.event === 'pilot_win').length, 0);
});



test('party startup retains human duo, two-pilot showcase and larger squad fixed lines', () => {
  for (const [partySize, pilot, text] of [[2, false, '也来帮忙了喵'], [2, true, '两只猫娘上场'], [4, false, '4 人小队开局！猫娘阵容：']]) {
    const session = start({ partySize, pilot });
    const lines = voices(session.advance(EMPTY_INPUT).events).filter(event => event.key === 'party:start');
    assert.equal(lines.length, 1); assert.ok(lines[0].text.includes(text));
    assert.equal(voices(session.advance(EMPTY_INPUT).events).filter(event => event.key === 'party:start').length, 0);
  }
});

test('weather and comet fixed warnings and exhausted pilot handover remain semantic once-only output', () => {
  const engine = new SessionEngine(); engine.start(options); engine.advance(EMPTY_INPUT);
  engine.battle.weather._start(engine.battle.player);
  const weather = voices(engine.advance(EMPTY_INPUT).events).filter(event => event.key.startsWith('weather:'));
  assert.equal(weather.length, 1); assert.equal(weather[0].text, engine.battle.weather.def.say);
  assert.equal(voices(engine.advance(EMPTY_INPUT).events).filter(event => event.key.startsWith('weather:')).length, 0);
  engine.battle.comet.forceTrigger(1);
  const speech = [];
  for (let step = 0; step < 302; step++) speech.push(...voices(engine.advance(EMPTY_INPUT).events));
  const comet = speech.filter(event => event.key === 'comet-warning'); assert.equal(comet.length, 1); assert.equal(comet[0].text, '天上好像有什么东西来了？！');
  const exhausted = new SessionEngine(); exhausted.start({ ...options, pilot: true }); exhausted.advance(EMPTY_INPUT);
  exhausted.run.end(false);
  for (let retry = 0; retry < 5; retry++) exhausted.run.retry(true, exhausted.battle.waveIndex);
  assert.equal(voices(exhausted.advance(EMPTY_INPUT).events).filter(event => event.key === 'pilot:handover').length, 1);
  assert.equal(exhausted.pilotEnabled, false);
  assert.equal(voices(exhausted.advance(EMPTY_INPUT).events).filter(event => event.key === 'pilot:handover').length, 0);
});


test('endless narration retains only current-wave once keys over five thousand waves', () => {
  let emitted = 0;
  const narration = new GameNarration(event => { if (event.type === 'report') emitted++; }, { next: () => 0 });
  for (let wave = 1; wave <= 5000; wave++) {
    const context = { wave };
    for (const key of [`wave:${wave}:boss:7:phase:2`, `wave:${wave}:boss:7:killed`, `wave:${wave}:result`]) {
      assert.equal(narration.report('boss_kill', context, false, key), true);
      assert.equal(narration.report('boss_kill', context, false, key), false);
    }
    // Internal resource assertion: identities must not accumulate across an endless run.
    assert.equal(narration.once.size, 3);
    assert.equal(narration.lastReport.size, 1);
  }
  assert.equal(emitted, 15000);
});

test('same boss identities report again in a new wave while same-wave phases and result keys remain once-only', () => {
  const { narration, events } = policy();
  for (const wave of [1, 2]) {
    const context = { wave, phase: 2 };
    assert.equal(narration.report('boss_phase', context, false, 'boss:7:phase:2'), true);
    assert.equal(narration.report('boss_phase', context, false, 'boss:7:phase:2'), false);
    for (const key of ['boss:7:killed', 'campaign-win-prompt', 'run-result']) {
      const event = key.startsWith('boss') ? 'boss_kill' : 'win';
      assert.equal(narration.report(event, context, false, key), true);
      assert.equal(narration.report(event, context, false, key), false);
    }
    narration.advance(10);
  }
  assert.equal(reports(events).length, 8);
});

test('clearing current-wave once identities never resets cross-wave scene cooldowns', () => {
  const { narration, events } = policy();
  assert.equal(narration.report('wave_start', { wave: 1 }, false, 'wave:1:start'), true);
  narration.advance(5);
  assert.equal(narration.report('wave_start', { wave: 2 }, false, 'wave:2:start'), false);
  narration.advance(7);
  // A cooldown-rejected stage is still consumed once in its own wave.
  assert.equal(narration.report('wave_start', { wave: 2 }, false, 'wave:2:start'), false);
  assert.equal(narration.report('wave_start', { wave: 3 }, false, 'wave:3:start'), true);
  assert.equal(reports(events).length, 2);
  narration.beginAttempt({ next: () => 0 });
  assert.equal(narration.report('wave_start', { wave: 1 }, false, 'wave:1:start'), false);
  narration.advance(12);
  assert.equal(narration.report('wave_start', { wave: 2 }, false, 'wave:2:start'), true);
});


test('all baseline emotion triggers survive LLM policy without using presentation entropy', () => {
  const expected = { low_hp: 'surprised', boss_kill: 'happy', boss_phase: 'surprised', level_up: 'happy', weapon_combo: 'happy', win: 'happy', death: 'sad' };
  for (const pilot of [false, true]) for (const [event, emotion] of Object.entries(expected)) {
    const events = []; let randomCalls = 0;
    const narration = new GameNarration(value => events.push(value), { next() { randomCalls++; return .5; } });
    narration.report(event, { wave: 1 }, pilot, 'first');
    assert.deepEqual(emotions(events), [emotion], `${pilot}/${event}`);
    narration.report(event, { wave: 1 }, pilot, 'first');
    assert.deepEqual(emotions(events), [emotion], 'same-stage duplicate cannot replay the expression');
    narration.report(event, { wave: 1 }, pilot, 'second');
    assert.deepEqual(emotions(events), [emotion, emotion], 'another real trigger keeps its expression despite cooldown');
    assert.equal(randomCalls, 0);
  }
});

test('low HP expression follows the 30 percent crossing, independent of cooldown and pilot suppression', () => {
  for (const pilot of [false, true]) {
    const { narration, events } = policy();
    narration.health({ wave: 1, hpRatio: .3 }, pilot);
    narration.health({ wave: 1, hpRatio: .29 }, pilot);
    narration.health({ wave: 1, hpRatio: .1 }, pilot);
    assert.deepEqual(emotions(events), ['surprised']);
    narration.health({ wave: 1, hpRatio: .8 }, pilot);
    narration.health({ wave: 1, hpRatio: .2 }, pilot);
    assert.deepEqual(emotions(events), ['surprised', 'surprised']);
    assert.equal(reports(events).length, pilot ? 0 : 1);
  }
});

test('public upgrade emotions are not swallowed by the six-second report cooldown or pilot mode', () => {
  const session = fixture('upgrade', run => { run.player.pendingLevelUps = 2; run.afterUpgrade = 'playing'; });
  for (let count = 0; count < 2; count++) {
    const ui = session.readUi();
    assert.equal(session.dispatch({ type: 'choose-upgrade', optionId: ui.upgrades[0].id, revision: ui.revision }).ok, true);
  }
  const events = session.advance(EMPTY_INPUT).events;
  assert.deepEqual(emotions(events), ['happy', 'happy']);
  assert.equal(reports(events).filter(event => event.event === 'level_up').length, 1);
  const piloted = fixture('upgrade', run => { run.pilot = true; run.player.pendingLevelUps = 1; run.afterUpgrade = 'playing'; });
  const ui = piloted.readUi();
  const command = { type: 'choose-upgrade', optionId: ui.upgrades[0].id, revision: ui.revision };
  assert.equal(piloted.dispatch(command).ok, true);
  assert.equal(piloted.dispatch(command).ok, false);
  const automated = piloted.advance(EMPTY_INPUT).events;
  assert.deepEqual(emotions(automated), ['happy']);
  assert.equal(reports(automated).filter(event => event.event === 'level_up').length, 0);
});

test('public manual and automatic weapon combinations emit happy once, with no emotion for rejected purchase', () => {
  for (const automatic of [false, true]) {
    const session = fixture('shop', run => {
      run.player.materials = 200;
      run.player.weapons = (automatic ? ['cat_paw', 'star_wand', 'pebble_toss', 'fish_shield', 'lucky_coin', 'toy_turret'] : ['cat_paw', 'cat_paw']).map(id => ({ id, level: 1 }));
      run.shop.offers = Array.from({ length: 4 }, () => ({ kind: 'weapon', id: 'cat_paw', price: 1, sold: false, meta: {} }));
    });
    session.advance(EMPTY_INPUT);
    const ui = session.readUi();
    const command = automatic ? { type: 'buy-offer', offerId: ui.offers[0].id, revision: ui.revision }
      : { type: 'combine', weaponId: 'cat_paw', revision: ui.revision };
    assert.equal(session.dispatch(command).ok, true);
    assert.equal(session.dispatch(command).ok, false);
    assert.deepEqual(emotions(session.advance(EMPTY_INPUT).events), ['happy']);
  }
});

const soundNames = events => events.filter(event => event.type === 'sound').map(event => event.name);
test('baseline start, wave, boss and result sound cues reach the public event stream without restore startup noise', () => {
  const fresh = start();
  assert.equal(soundNames(fresh.advance(EMPTY_INPUT).events).filter(name => name === 'gameStart').length, 1);
  const continued = createGameSession({ save: fresh.exportSave() });
  assert.equal(soundNames(continued.advance(EMPTY_INPUT).events).includes('gameStart'), false);
  for (const waveIndex of [0, 8]) {
    const session = fixture('shop', run => { run.waveIndex = waveIndex; }); session.advance(EMPTY_INPUT);
    session.dispatch({ type: 'next-wave' });
    const sounds = soundNames(session.advance(EMPTY_INPUT).events);
    assert.deepEqual(sounds.filter(name => ['click', 'waveStart', 'bossSpawn'].includes(name)), waveIndex === 8 ? ['click', 'waveStart', 'bossSpawn'] : ['click', 'waveStart']);
  }
  const quit = start(); quit.advance(EMPTY_INPUT); quit.dispatch({ type: 'abandon-run' });
  assert.equal(soundNames(quit.advance(EMPTY_INPUT).events).includes('death'), false);
  const engine = new SessionEngine(); engine.start(options); engine.advance(EMPTY_INPUT); engine.endRun(true);
  assert.equal(soundNames(engine.advance(EMPTY_INPUT).events).includes('win'), true);
});

test('shop feedback follows lock, refresh, combination, sale and rejection outcomes', () => {
  const session = fixture('shop', run => { run.player.materials = 200; run.player.weapons = [{ id: 'cat_paw', level: 1 }, { id: 'cat_paw', level: 1 }]; });
  session.advance(EMPTY_INPUT);
  function execute(command) {
    const ui = session.readUi(); const result = session.dispatch({ ...command, revision: ui.revision });
    return { result, sounds: soundNames(session.advance(EMPTY_INPUT).events) };
  }
  const offer = session.readUi().offers[0];
  assert.deepEqual(execute({ type: 'toggle-lock', offerId: offer.id }).sounds, ['lock']);
  assert.deepEqual(execute({ type: 'reroll' }).sounds, ['reroll']);
  assert.deepEqual(execute({ type: 'combine', weaponId: 'cat_paw' }).sounds, ['combine']);
  const rejected = execute({ type: 'sell-weapon', weaponInstanceId: -999 });
  assert.equal(rejected.result.ok, false); assert.deepEqual(rejected.sounds, ['error']);
  const weapon = session.readUi().players[0].weapons[0];
  assert.deepEqual(execute({ type: 'sell-weapon', weaponInstanceId: weapon.instanceId }).sounds, ['buy']);
});


test('buying the final shop offer produces its purchase sound followed by the free refresh sound', () => {
  const session = fixture('shop', run => {
    run.player.materials = 200;
    run.shop.offers = Array.from({ length: 4 }, (_, index) => ({ kind: 'item', id: 'warm_milk', price: 1, sold: index > 0, meta: {} }));
  });
  session.advance(EMPTY_INPUT); const ui = session.readUi();
  assert.equal(session.dispatch({ type: 'buy-offer', offerId: ui.offers[0].id, revision: ui.revision }).ok, true);
  assert.deepEqual(soundNames(session.advance(EMPTY_INPUT).events), ['buy', 'reroll']);
});
