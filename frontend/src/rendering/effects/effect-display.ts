import { BitmapText, Container, Graphics, Text, type TextStyle } from 'pixi.js';
import type { EffectView } from '../../game';
import type { DamageFont } from './damage-fonts';
import { drawAttackEffect } from './attack-shapes';
import { drawEncounterEffect } from './encounter-shapes';
export class EffectDisplay extends Container {
  private readonly graphic = new Graphics();
  private text?: Text | BitmapText;
  private bitmapFont?: string;
  private readonly notes: Text[] = [];
  private signature = '';
  private readonly noteStyles: (TextStyle | undefined)[] = [];
  constructor() { super(); this.addChild(this.graphic); this.blendMode = 'add'; }
  sync(view: EffectView, time = 0, noteStyles?: readonly (TextStyle | undefined)[], bitmap?: DamageFont): void {
    const bitmapFont = bitmap?.name;
    const fontChanged = bitmapFont !== this.bitmapFont;
    if (this.text && !!bitmapFont !== (this.text instanceof BitmapText)) { this.text.destroy(); this.text = undefined; }
    this.bitmapFont = bitmapFont;
    this.position.set(view.x, view.y);
    this.rotation = view.end || view.kind === 'chain' ? 0 : view.angle ?? 0;
    this.alpha = view.alpha;
    const progress = view.progress ?? 0;
    this.scale.set(view.kind === 'text' && view.critical ? 1 + (1 - progress) * .35 : 1);
    this.blendMode = view.kind === 'text' || view.kind === 'shard' || view.variant === 'crack' ? 'normal' : 'add';
    const signature = JSON.stringify(view) + (view.kind === 'chain' ? Math.floor(time * 60) : '');
    const noteStyleChanged = noteStyles ? noteStyles.some((s, i) => s !== this.noteStyles[i]) : this.noteStyles.some(Boolean);
    if (signature === this.signature && !noteStyleChanged && !fontChanged) return;
    this.signature = signature; this.graphic.clear(); this.graphic.rotation = 0;
    if (view.kind === 'text') {
      if (!this.text) {
        this.text = bitmapFont ? new BitmapText({text:'',style:{fontFamily:bitmapFont,fontSize:view.critical?19:14,fill:view.color,stroke:{color:0,width:3}}}) : new Text({ text: '', style: { fontSize: 14, fontWeight: 'bold', fill: '#ffffff', stroke: { color: 0x000000, width: 3 } } });
        this.text.anchor.set(.5); this.addChild(this.text);
      }
      this.text.text = view.text ?? '';
      if (bitmapFont) { this.text.position.x = bitmap?.offsetX ?? 0; this.text.style.fontFamily = bitmapFont; this.text.style.fill = view.color; this.text.style.fontSize = view.critical ? 19 : 14; }
      else { this.text.style.fill = view.color; this.text.style.fontSize = view.critical ? 19 : 14; }
    } else {
      this.text?.destroy(); this.text = undefined;
      if (!drawEncounterEffect(this.graphic, view) && !drawAttackEffect(this.graphic, view, time)) this.drawMiscellaneous(view);
    }
    this.syncNotes(view, noteStyles);
  }
  private syncNotes(view: EffectView, styles?: readonly (TextStyle | undefined)[]): void {
    const notes = view.kind === 'nova' ? view.notes ?? [] : [];
    while (this.notes.length > notes.length) this.notes.pop()!.destroy();
    this.noteStyles.length = notes.length;
    while (this.notes.length < notes.length) {
      const style = styles?.[this.notes.length];
      const text = new Text({ text: '', style: style ?? { fontSize: 16, fill: 0xffe98a } });
      text.anchor.set(.5); this.notes.push(text); this.addChild(text);
    }
    const k = view.progress ?? 0, eased = 1 - Math.pow(1 - k, 2.6);
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i], text = this.notes[i], distance = view.radius * (.14 + Math.pow(eased, note.speed));
      const style = styles?.[i], previous = this.noteStyles[i];
      if (style !== previous) { if (style) text.style = style; else if (previous) text.style = previous.clone(); }
      text.text = note.text;
      if (style) text.scale.set(note.size / Number(style.fontSize));
      else { text.style.fontSize = note.size; text.scale.set(1); }
      this.noteStyles[i] = style;
      text.position.set(Math.cos(note.angle) * distance, Math.sin(note.angle) * distance);
      text.rotation = note.rotation + k * note.spin;
    }
  }
  private drawMiscellaneous(view: EffectView): void {
    const g = this.graphic, r = view.radius;
    if (view.kind === 'emitter') {
      if (view.variant === 'wing') g.poly([0, -r, r * .5, 0, 0, r, -r * .5, 0]).fill(view.color)
        .poly([0, -r * .5, r * .22, 0, 0, r * .5, -r * .22, 0]).fill({ color: 0xffffff, alpha: .6 });
      else {
        if (view.variant === 'glow' || view.variant === 'vent') for (let i = 8; i > 0; i--) g.circle(0, 0, r * (1 + i * .13)).fill({ color: view.color, alpha: .018 });
        g.circle(0, 0, r).fill(view.variant === 'blood' ? 0x7d1024 : 0x18121d)
          .circle(0, -r * .1, r * .82).fill(view.variant === 'blood' ? 0xc81e3c : view.color)
          .circle(-r * .3, -r * .36, r * .22).fill({ color: 0xffffff, alpha: .85 });
      }
    } else if (view.kind === 'trail') g.ellipse(0, 0, r, r * .25).fill(view.color);
    else g.star(0, 0, 4, r, r * .4).fill(view.color);
  }
  override destroy(): void { super.destroy({ children: true, context: true }); }
}
