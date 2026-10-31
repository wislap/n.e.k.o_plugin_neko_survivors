import { Container, Graphics, Text } from 'pixi.js';
import { PICKUP_STRIDE, type GameFrame, type RenderStreamData } from '../game';
import type { CameraTransform } from './camera';
import { bubbleLayout, offscreenMarker, projectToScreen } from './overlay-layout';
const SLOT_COLORS = [0x9ec7ff, 0xff9ec7, 0xffd166, 0x8ce7e4];
const EMOTES = { heal: ['♥', 0xff7bac], vacuum: ['✦', 0xffe0ec], steal: ['$', 0xffd166], attack: ['!', 0xffc857] } as const;

export class WorldOverlay {
  readonly world = new Graphics();
  readonly screen = new Container({ label: 'world-information' });
  private readonly minimap = new Graphics(); private readonly arrows = new Graphics();
  private readonly bars = new Graphics(); private readonly bubbles = new Graphics();
  private readonly labels = new Map<string, Text>();
  private readonly seen = new Set<string>();
  constructor() { this.screen.eventMode = 'none'; this.screen.addChild(this.minimap, this.arrows, this.bars, this.bubbles); }
  get labelCount(): number { return this.labels.size; }
  private label(id: string, text: string, x: number, y: number, size: number, color: number | string, alpha = 1): void {
    this.seen.add(id);
    let display = this.labels.get(id);
    if (!display) { display = new Text({ text, style: { fontFamily: 'sans-serif', fontSize: size, fontWeight: 'bold', fill: color, stroke: { color: 0x061019, width: 2 } } }); display.anchor.set(.5); this.labels.set(id, display); this.screen.addChild(display); }
    display.text = text; display.style.fontSize = size; display.style.fill = color;
    display.position.set(x, y); display.alpha = alpha;
  }
  sync(frame: GameFrame, camera: CameraTransform, packed: RenderStreamData | undefined = frame.transients): void {
    this.seen.clear(); this.world.clear(); this.arrows.clear(); this.bars.clear(); this.bubbles.clear(); this.minimap.clear();
    const active = frame.phase !== 'title' && frame.phase !== 'result'; this.screen.visible = active; this.world.visible = active;
    if (active) {
      this.drawMinimap(frame, camera, packed); this.drawPlayers(frame, camera); this.drawBosses(frame, camera); this.drawPets(frame, camera);
    }
    for (const [id, label] of this.labels) if (!this.seen.has(id)) { label.destroy(); this.labels.delete(id); }
  }
  private drawMinimap(frame: GameFrame, camera: CameraTransform, packed: RenderStreamData | undefined): void {
    const size = camera.width < 600 ? 88 : 116, x = camera.width - size - 14, y = Math.max(86, camera.height - size - 174), half = frame.worldHalfSize;
    this.minimap.roundRect(x, y, size, size, 8).fill({ color: 0x12141c, alpha: .72 }).stroke({ color: 0xffffff, alpha: .16, width: 1 });
    const point = (wx: number, wy: number) => ({ x: x + Math.max(0, Math.min(1, (wx + half) / (half * 2))) * size, y: y + Math.max(0, Math.min(1, (wy + half) / (half * 2))) * size });
    for (const actor of frame.actors) {
      if (actor.alpha === 0 || actor.kind !== 'enemy') continue;
      const p = point(actor.x, actor.y), s = actor.boss ? 4 : actor.elite ? 3 : 2;
      this.minimap.rect(p.x - s / 2, p.y - s / 2, s, s).fill({ color: actor.boss ? 0xff4d94 : actor.elite ? 0xffc857 : 0xff5f6d, alpha: .85 });
    }
    for (const pickup of frame.pickups) { const p = point(pickup.x, pickup.y); this.minimap.rect(p.x - 1, p.y - 1, 2, 2).fill({ color: 0x6ee7a8, alpha: .5 }); }
    if (packed) for (let i = 0; i < packed.pickupCount; i++) {
      const p = point(packed.pickups[i * PICKUP_STRIDE], packed.pickups[i * PICKUP_STRIDE + 1]);
      this.minimap.rect(p.x - 1, p.y - 1, 2, 2).fill({ color: 0x6ee7a8, alpha: .5 });
    }
    const players = frame.actors.filter(a => a.kind === 'player');
    players.forEach((actor, index) => {
      const p = point(actor.x, actor.y), slot = actor.slot ?? index + 1;
      this.minimap.circle(p.x, p.y, slot === 1 ? 3.5 : 3).fill(actor.downed ? 0x9a80b9 : 0xffffff)
        .circle(p.x, p.y, slot === 1 ? 5.5 : 5).stroke({ color: slot === 1 ? actor.color : SLOT_COLORS[(slot - 1) % 4], width: 2 });
    });
  }
  private drawPlayers(frame: GameFrame, camera: CameraTransform): void {
    const players = frame.actors.filter(a => a.kind === 'player');
    players.forEach((actor, index) => {
      const slot = actor.slot ?? index + 1;
      if (slot === 1) return;
      const color = SLOT_COLORS[(slot - 1) % 4], marker = offscreenMarker(actor, camera, frame.encounter ? 150 : 80);
      if (!marker) {
        const p = projectToScreen(actor, camera);
        this.label(`slot-${actor.id}`, `P${slot}`, p.x, p.y - (actor.radius * 3.0) * camera.zoom - 10, 11, color); return;
      }
      const { x, y, angle } = marker, ca = Math.cos(angle), sa = Math.sin(angle), blink = .72 + .28 * Math.sin(frame.time * 1000 / 260);
      this.arrows.poly([x + ca * 24, y + sa * 24, x + ca * 11 - sa * 7, y + sa * 11 + ca * 7, x + ca * 11 + sa * 7, y + sa * 11 - ca * 7]).fill({ color, alpha: blink })
        .circle(x, y, 17).fill({ color, alpha: blink }).stroke({ color: 0x14060e, alpha: .8, width: 2 });
      this.label(`slot-${actor.id}`, `P${slot}`, x, y + 1, 13, 0xffffff, blink);
      if (actor.label) this.label(`name-${actor.id}`, actor.label, x, y + 29, 10, 0xffd9ea, blink * .8);
    });
  }
  private drawBosses(frame: GameFrame, camera: CameraTransform): void {
    if (frame.encounter) return;
    const bosses = frame.actors.filter(a => a.kind === 'enemy' && a.boss && (a.alpha ?? 1) > 0 && (a.hp ?? 1) > 0);
    const width = Math.min(440, camera.width * .45), x = (camera.width - width) / 2;
    bosses.forEach((boss, index) => {
      const y = 88 + index * 45, fraction = Math.max(0, Math.min(1, (boss.hp ?? 0) / Math.max(1, boss.maxHp ?? 1)));
      this.bars.poly([x - 11, y + 7, x, y, x + width, y, x + width + 11, y + 7, x + width, y + 14, x, y + 14]).fill({ color: 0x200f25, alpha: .9 }).stroke({ color: 0xb970a0, alpha: .8, width: 1.5 })
        .rect(x + 2, y + 3, Math.max(0, width - 4) * fraction, 8).fill(0xe14c82);
      this.label(`boss-${boss.id}`, `${boss.label ?? boss.definitionId}  ${Math.ceil(boss.hp ?? 0)} / ${Math.ceil(boss.maxHp ?? 0)}`, camera.width / 2, y + 25, 12, 0xffe0ec);
    });
  }
  private drawPets(frame: GameFrame, camera: CameraTransform): void {
    for (const actor of frame.actors) {
      if (actor.kind !== 'pet') continue;
      if (actor.vacuum) {
        const p = Math.max(0, Math.min(1, actor.vacuum.progress)), radius = actor.radius + (actor.vacuum.radius - actor.radius) * p;
        this.world.circle(actor.x, actor.y, radius).stroke({ color: 0xffe0ec, width: 3, alpha: .5 * (1 - p) });
      }
      const p = projectToScreen(actor, camera), bob = Math.sin(frame.time * 2) * 1.2;
      if (actor.emote) {
        const [text, color] = EMOTES[actor.emote];
        this.label(`emote-${actor.id}`, text, p.x, p.y - actor.radius * 1.9 * camera.zoom + bob, Math.round(actor.radius * 1.5), color);
      }
      if (actor.bubble && actor.bubble.alpha > 0) {
        const layout = bubbleLayout(actor.bubble.text), x = p.x, bottom = p.y - actor.radius * 1.9 * camera.zoom + bob - 19.5;
        const y = bottom - layout.height / 2, alpha = actor.bubble.alpha;
        this.bubbles.roundRect(x - layout.width / 2, y - layout.height / 2, layout.width, layout.height, 12).fill({ color: 0xffffff, alpha: alpha * .55 }).stroke({ color: 0xffa8cf, alpha, width: 2 })
          .poly([x - 5.85, bottom, x, bottom + 9.1, x + 5.85, bottom]).fill({ color: 0xffffff, alpha: alpha * .55 });
        this.label(`bubble-${actor.id}`, layout.lines.join('\n'), x, y, 13, 0x1d3c63, alpha);
        const label = this.labels.get(`bubble-${actor.id}`)!;
        label.style.stroke = { color: 0xffffff, width: 0 }; label.style.align = 'center'; label.style.lineHeight = 19.5;
      }
    }
  }
  dispose(): void { this.labels.clear(); this.world.destroy(); this.screen.destroy({ children: true, context: true }); }
}
