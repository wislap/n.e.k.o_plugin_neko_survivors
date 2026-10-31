import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import type { ActorView, EffectView } from '../../src/game';
import { RenderStream, PICKUP_STRIDE } from '../../src/game';
import { drawAttackEffect } from '../../src/rendering/effects/attack-shapes';
import { EffectDisplay } from '../../src/rendering/effects/effect-display';
import { bubbleLayout, offscreenMarker } from '../../src/rendering/overlay-layout';
import { WorldOverlay } from '../../src/rendering/world-overlay';
import { EFFECT_SCENES, VISUAL_SCENES, visualFixture } from '../../src/rendering/dev/visual-fixtures';
const camera = { x: 0, y: 0, zoom: 1, width: 900, height: 650 };
describe('source weapon effect geometry', () => {
  it('draws each source FX type with its own geometry across the full lifetime', () => {
    for (const progress of [0, .2, .5, .8, .99]) {
      const frame = visualFixture('weapons', progress * 1.2);
      expect(frame.effects.map(effect => effect.kind)).toEqual([...EFFECT_SCENES]);
      for (const effect of frame.effects) {
        const display = new EffectDisplay(); display.sync(effect, progress);
        const graphic = display.children.find(child => child instanceof Graphics) as Graphics;
        if (effect.kind !== 'text') expect(graphic.context.instructions.length).toBeGreaterThan(0);
        const context = graphic.context; display.destroy(); expect(context.destroyed).toBe(true);
      }
    }
  });
  it('keeps beam endpoints in world space and does not replace a chain with a point effect', () => {
    const base: EffectView = { id: 1, x: 100, y: 200, radius: 14, color: '#ffdd99', alpha: 1, kind: 'beam', width: 4, end: { x: 340, y: 200 }, progress: 0 };
    const beam = new Graphics(); expect(drawAttackEffect(beam, base, 0)).toBe(true); expect(beam.context.bounds.maxX).toBeGreaterThanOrEqual(240);
    const chain = new Graphics(); expect(drawAttackEffect(chain, { ...base, kind: 'chain', points: [{ x: 100, y: 200 }, { x: 220, y: 180 }, { x: 350, y: 250 }] }, 0)).toBe(true);
    expect(chain.context.bounds.maxX).toBeGreaterThanOrEqual(250); expect(chain.context.instructions.length).toBeGreaterThan(beam.context.instructions.length);
    beam.destroy(); chain.destroy();
  });
});
describe('world information overlays', () => {
  it('keeps packed pickup minimap markers when compact scene and transients are separate', () => {
    const frame = { ...visualFixture('battle-overlay', 1), actors: [], pickups: [] };
    const packed = new RenderStream(); packed.pickupCount = 2;
    packed.pickups[0] = 120; packed.pickups[1] = 80;
    packed.pickups[PICKUP_STRIDE] = -300; packed.pickups[PICKUP_STRIDE + 1] = 240;
    const compact = new WorldOverlay(), canonical = new WorldOverlay();
    compact.sync(frame, camera, packed); canonical.sync({ ...frame, transients: packed }, camera);
    const markers = (overlay: WorldOverlay) => (overlay.screen.children[0] as Graphics).context.instructions
      .filter(i => i.action === 'fill' && i.data.style.color === 0x6ee7a8)
      .map(i => i.action === 'fill' ? i.data.path.instructions : []);
    expect(markers(compact)).toHaveLength(2); expect(markers(compact)).toEqual(markers(canonical));
    compact.dispose(); canonical.dispose();
  });
  it('keeps teammate direction markers outside world-view bounds, and excludes visible allies', () => {
    const actor: ActorView = { id: 2, kind: 'player', slot: 2, definitionId: 'mimi', x: 2000, y: 0, radius: 12, angle: 0, color: '#fff' };
    expect(offscreenMarker(actor, camera)).toMatchObject({ x: 842, angle: 0 });
    expect(offscreenMarker({ ...actor, x: -2000, y: 0 }, camera)?.angle).toBeCloseTo(Math.PI);
    expect(offscreenMarker({ ...actor, x: 0, y: 0 }, camera)).toBeUndefined();
  });
  it('wraps long pet dialogue within the original 280 screen-pixel maximum', () => {
    const text = '喵'.repeat(100), layout = bubbleLayout(text);
    expect(layout.width).toBeLessThanOrEqual(280); expect(layout.lines.length).toBeGreaterThan(1); expect(layout.lines.join('')).toBe(text);
  });
  it('renders four actual boss summaries, player directions, pet bubble and vacuum without retaining stale labels', () => {
    const frame = visualFixture('battle-overlay', 1), overlay = new WorldOverlay(); overlay.sync(frame, camera);
    expect(overlay.world.context.instructions.length).toBeGreaterThan(0); expect(overlay.screen.children.length).toBeGreaterThanOrEqual(10);
    overlay.sync({ ...frame, actors: [], pickups: [] }, camera); expect(overlay.screen.children.length).toBe(4);
    const context = overlay.world.context; overlay.dispose(); expect(context.destroyed).toBe(true);
  });
});
describe('explicit development visual fixtures', () => {
  it('covers four boss views, ten weather views, the comet sequence and all weapon types', () => {
    for (const scene of VISUAL_SCENES) { const frame = visualFixture(scene, .5, 2); expect(frame.actors).toBeDefined(); expect(frame.projectiles).toBeDefined(); expect(Number.isFinite(frame.time)).toBe(true); }
    for (let stage = 0; stage < 10; stage++) expect(visualFixture('comet', .5, stage).comet?.phase).toBeTruthy();
    for (let stage = 0; stage < 13; stage++) expect(visualFixture('flandre', .5, stage).encounter?.kind).toBe('flandre');
  });
});
