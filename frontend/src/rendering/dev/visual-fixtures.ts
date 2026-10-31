/**
 * Development-only display snapshots. These do not simulate gameplay or prove
 * attacks, outcomes, unlocks, or damage. All textures remain real plugin assets.
 * Geometry expectations come from reference renderer.js, weather-fx.js and the
 * four dedicated encounter renderers at baseline 5ade0bb3.
 */
import type { ActorView, EffectView, GameFrame, ProjectileView, WeatherView } from '../../game';
export const WEATHER_SCENES = ['fog', 'bloodMoon', 'meteor', 'rain', 'breeze', 'typhoon', 'clear', 'scorch', 'calm', 'riverFog'] as const;
export const EFFECT_SCENES = ['slash', 'thrust', 'spin', 'beam', 'nova', 'explosion', 'chain', 'sparkle', 'text', 'ring', 'hit', 'impact', 'shockwave', 'shard'] as const;
export const VISUAL_SCENES = ['battle-overlay', 'weapons', 'ordinary', 'flandre', 'vergil', 'remilia', 'halloween', 'comet', ...WEATHER_SCENES] as const;
export type VisualScene = typeof VISUAL_SCENES[number];
const actors = (): ActorView[] => [
  { id: 'p1', kind: 'player', slot: 1, definitionId: 'yui', label: 'Yui', x: 0, y: 80, radius: 13, angle: -.5, color: '#93d8fa', hp: 70, maxHp: 100, shield: 20, maxShield: 30 },
  { id: 'p2', kind: 'player', slot: 2, definitionId: 'mimi', label: 'Mimi', x: 1500, y: -100, radius: 13, angle: 0, color: '#ff9ec7', hp: 80, maxHp: 100 },
  { id: 'p3', kind: 'player', slot: 3, definitionId: 'nana', label: 'Nana', x: -120, y: 100, radius: 13, angle: 0, color: '#ffd166', downed: true, downCount: 2, rescueProgress: 3, rescueNeed: 5, hp: 0, maxHp: 100 },
  { id: 'pet', kind: 'pet', definitionId: 'kitten', x: 100, y: 100, radius: 12, angle: 0, color: '#ffc4db', bubble: { text: '视觉验证夹具：这是宠物对白，实际使用游戏素材。', alpha: 1 }, emote: 'vacuum', vacuum: { radius: 220, progress: .6 } },
];
function effects(time: number): EffectView[] {
  return EFFECT_SCENES.map((kind, i) => {
    const x = (i % 5 - 2) * 145, y = Math.floor(i / 5) * 140 - 160;
    return { id: `fixture-${kind}`, kind, x, y, playerOwned: true, radius: kind === 'sparkle' ? 4 : kind === 'shard' ? 15 : 55,
      color: '#79dfff', alpha: .8, progress: (time % 1.2) / 1.2, angle: -.4, width: 12, arc: Math.PI * .8,
      power: .85, rays: 12, seed: 42, end: kind === 'thrust' || kind === 'beam' ? { x: x + 105, y: y - 25 } : undefined,
      points: kind === 'chain' ? [{ x, y }, { x: x + 55, y: y - 30 }, { x: x + 120, y: y + 20 }] : undefined,
      text: '128!', critical: true, notes: kind === 'nova' ? [{ angle: 0, speed: 1, text: '♪', size: 17, rotation: 0, spin: 2 }, { angle: 2.4, speed: .8, text: '🐾', size: 16, rotation: 1, spin: -2 }] : undefined };
  });
}
function bullets(time: number): ProjectileView[] {
  const shapes = ['orb', 'rice', 'drop', 'shard', 'petal', 'ring', 'blade', 'jade', 'paw', 'bead', 'laser'] as const;
  return shapes.map((shape, i) => ({ id: `sample-${shape}`, x: (i % 6 - 2.5) * 90, y: Math.floor(i / 6) * 90 + 100, radius: shape === 'jade' ? 26 : 9,
    angle: time * .3, color: i % 2 ? 'violet' : 'amber', hostile: true, shape, hitRadius: shape === 'jade' ? 7 : undefined, length: shape === 'laser' ? 65 : undefined }));
}
export function visualFixture(scene: VisualScene, time: number, stage = 0): GameFrame {
  const frame: GameFrame = { tick: Math.floor(time * 60), time, phase: 'playing', combat: true, camera: { x: 0, y: 0, zoom: 1 },
    backgroundId: 'lab', worldHalfSize: 1200, actors: actors(), effects: [], projectiles: [], pickups: [], telegraphs: [] };
  if (scene === 'battle-overlay') {
    frame.actors = [...frame.actors, ...['boss_nono', 'boss_cat_king', 'boss_acid_cat', 'boss_void_lord'].map((definitionId, i): ActorView => ({ id: `boss-${i}`, kind: 'enemy', definitionId, label: `Boss ${i + 1}`, x: (i - 1.5) * 140, y: -100, radius: 30, angle: 0, color: '#f98bae', boss: true, hp: 400 + i * 100, maxHp: 1000 }))];
    frame.pickups = ['xp', 'material', 'heal'].map((kind, i) => ({ id: i, x: i * 25, y: 170, kind: kind as 'xp' | 'material' | 'heal', variant: i % 2 ? 2 : 1, bobPhase: time * 3 + i }));
  } else if (scene === 'weapons') { frame.effects = effects(time); frame.actors = []; }
  else if (scene === 'ordinary') {
    frame.actors = [
      { id: 'fallback', kind: 'phantom', definitionId: 'yui', spriteId: null, x: -250, y: -50, radius: 13,
        angle: -.3, color: '#ff7bac', accent: '#ffe08a', moving: true, walkPhase: time * 11, age: time,
        blinkPhase: time % 3 < .12 ? .12 - time % 3 : 0, wallFlash: .25 },
      { id: 'orbit-owner', kind: 'player', definitionId: 'yui', x: 0, y: 50, radius: 13, angle: 0, color: '#ff7bac', age: time },
      { id: 'turret', kind: 'turret', definitionId: 'toy_turret', x: 250, y: -40, radius: 16,
        angle: time * .4, color: '#a9b4c9', spawnProgress: Math.min(1, time / .3), recoil: .16 * (1 - time % .6 / .6) },
    ];
    frame.pickups = ([1, 2] as const).map((variant, i) => ({ id: i, kind: 'material', x: -100 + i * 70, y: 180,
      variant, bobPhase: time * 5 + i }));
    frame.projectiles = (['coin', 'orb', 'tracer', 'shot'] as const).map((playerStyle, i) => ({
      id: `friendly-${i}`, x: -240 + i * 150, y: -200, radius: 5, hostile: false, angle: -.2, age: time,
      shape: 'circle', color: ['#ffc857', '#b794f6', '#a9b4c9', '#9aa3bb'][i], playerStyle,
      trail: [1, 2, 3, 4].map(step => ({ x: -240 + i * 150 - step * 14, y: -200 + step * 3, alpha: 1 - step * .16 })),
    }));
    frame.weapons = [{ id: 'orbit', ownerId: 'orbit-owner', definitionId: 'mouse_toy',
      x: Math.cos(time * 3) * 100, y: 50 + Math.sin(time * 3) * 100, angle: time * 3, radius: 18,
      orbitRadius: 100, color: '#ff9f68', ballIndex: 0,
      trail: [3, 2, 1, 0].map(step => ({ x: Math.cos((time - step * .035) * 3) * 100, y: 50 + Math.sin((time - step * .035) * 3) * 100 })),
    }];
  }
  else if ((WEATHER_SCENES as readonly string[]).includes(scene)) {
    frame.weather = { id: scene, strength: Math.min(1, time / 2), fogStrength: scene === 'fog' ? Math.min(1, time / 2) : 0, elapsed: time, flash: 0,
      meteors: scene === 'meteor' ? [{ id: 1, x: -130, y: -20, radius: 64, progress: time % 1, side: -1 }] : [],
      burnZones: scene === 'meteor' ? [{ id: 2, x: 180, y: 30, radius: 70, alpha: .7 }] : [],
      typhoons: scene === 'typhoon' ? [{ id: 3, x: 120, y: -80, radius: 80, angle: time * 3 }] : [],
      fogClouds: scene === 'riverFog' ? [{ id: 4, x: -110, y: 0, radius: 90 }] : [] } satisfies WeatherView;
  } else if (scene === 'comet') {
    const phases = ['banner', 'gap1', 'fly1', 'gap2', 'fly2', 'gap3', 'dive', 'boom', 'roar', 'takeoff'];
    frame.comet = { phase: phases[stage % phases.length], time: time % [3.6, 1.2, 1.6, 1.2, 1.6, 1.2, .5, .9, 4, 1.6][stage % phases.length], age: time, center: { x: 0, y: 0 }, direction: 1, halfSize: 500,
      flash: stage % phases.length === 7 ? Math.max(0, 1 - (time % 1.6) * 3) : 0,
      bolts: [{ x: -160, y: -100 + (time % 1) * 160, landY: 60, radius: 8, vy: 500, elapsed: time % 1, landed: stage % 2 === 1, exploded: stage % 3 === 0, seed: 2 }],
      rings: [{ x: 0, y: 0, radius: 260, elapsed: time % 1, duration: 1, delay: 0, kind: stage % 2 ? 'ground' : 'shock', warm: stage % 2 === 1 }], trails: [{ x: -100, y: -50, radius: 30, alpha: .4 }] };
  } else {
    const common = { state: 'active', time, introTime: time % 10, arena: { x: 0, y: -80, halfWidth: 560, halfHeight: 300 }, hp: 620, maxHp: 1000, boss: { x: 0, y: -100 } };
    frame.projectiles = bullets(time);
    if (scene === 'flandre') {
      const cards = ['cranberry', 'laevateinn', 'fourkind', 'kagome', 'maze', 'starbow', 'catadioptric', 'clock', 'ripples', 'fragile', 'bloodstain', 'heart', 'prologue'];
      frame.phase = 'flandre'; frame.encounter = { ...common, kind: 'flandre', cardId: cards[stage % cards.length], cardName: `FIXTURE: ${cards[stage % cards.length]}`, declaration: 1 - time % 1, purgeCooldown: 3 };
      frame.actors = [{ id: 'flandre', kind: 'enemy', definitionId: stage % 2 ? 'flandre_laevateinn' : 'flandre', x: 0, y: -100, radius: 28, angle: 0, color: '#fff' }, ...frame.actors];
      frame.telegraphs = [{ id: 1, kind: 'line', x: 0, y: -100, end: { x: 220, y: -50 }, width: 48, color: '#ff5064', alpha: .9 }];
    } else if (scene === 'vergil') {
      frame.phase = 'vergil'; frame.encounter = { ...common, kind: 'vergil', state: stage % 3 === 0 ? 'intro' : stage % 3 === 1 ? 'wander' : 'ult', chairVisible: true, chairFacing: 1.57, charge: stage % 3 === 2 ? 2 : 0, veil: .3, guarding: true, guardShatter: .15,
        slashes: [{ id: 1, x: 100, y: 0, radius: 55, alpha: .8, angle: time }], rifts: [{ id: 2, x: -130, y: -20, radius: 50, alpha: .9 }], blades: [{ id: 3, x1: -200, y1: -50, x2: 220, y2: 150, seed: 42, alpha: .8 }] };
      frame.effects = [
        { id: 'source-glass', kind: 'shard', variant: 'glass', x: 200, y: 140, radius: 0, angle: time * .7,
          color: '#beebff', alpha: .6, progress: .3, points: [{ x: 180, y: 110 }, { x: 220, y: 130 }, { x: 190, y: 170 }] },
        { id: 'source-blade', kind: 'spark', variant: 'blade', x: -230, y: 100, radius: 0, angle: time, color: '#fff', alpha: .7, progress: .3 },
        { id: 'source-crack', kind: 'trail', variant: 'crack', x: 240, y: -100, radius: 0, color: '#1e042c', alpha: .8, seed: 42 },
        { id: 'source-charge', kind: 'sparkle', x: -180, y: -100, radius: 3, end: { x: -160, y: -106 }, color: '#78ebff', alpha: .8, progress: .5, width: 1 },
      ];
    } else if (scene === 'remilia') {
      frame.phase = 'remilia'; frame.encounter = { ...common, kind: 'remilia', sigil: 1, ending: stage % 2 ? .5 : 0, animationFrame: Math.floor(time * 12) % 24, alpha: 1,
        bats: [{ x: -150, y: -90, width: 14, height: 5, alpha: .4 }, { x: 180, y: -140, width: 9, height: 4, alpha: .3 }] };
    } else if (scene === 'halloween') {
      frame.phase = 'halloween'; frame.encounter = { ...common, kind: 'halloween', moonPhase: .3, veil: 0,
        cats: [{ id: 'choco', x: -140, y: -100, alpha: 1, frame: Math.floor(time * 7) % 30 }, { id: 'vanilla', x: 140, y: -100, alpha: 1, frame: Math.floor(time * 7) % 30 }],
        pumpkins: [{ id: 1, x: -120, y: 80, radius: 28, alpha: .9 }, { id: 2, x: 130, y: 50, radius: 210, alpha: .9, exploding: true, progress: time % 1 }], candies: [{ id: 3, x: 0, y: 50, color: '#ff9a3c' }] };
    }
  }
  return frame;
}
