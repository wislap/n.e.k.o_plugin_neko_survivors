import { Text, type Texture, type TextStyle, type TextStyleOptions } from 'pixi.js';
import type { PixiRenderer } from '../create-renderer';
interface PinnedLabel { label: Text; texture: Texture; key: string; automaticGc: boolean }
/** Pin Pixi's original managed textures for repeated note glyphs. The visible
 * Text instances retain their exact shaping, stroke, anchor and batching path.
 * Bounded per wave; overflow uses the reference renderer without retaining more. */
export class EffectTextCache {
  private readonly labels = new Map<string, PinnedLabel>();
  private epoch?: string;
  private hits = 0; private misses = 0; private skipped = 0;
  constructor(private readonly renderer: PixiRenderer, private readonly limit = 256) {}
  get diagnostics() { return { labels: this.labels.size, limit: this.limit, hits: this.hits, misses: this.misses, skipped: this.skipped,
    liveReferences: [...this.labels.values()].reduce((n, p) => n + Math.max(0, this.renderer.canvasText.getReferenceCount(p.key) - 1), 0),
    estimatedBytes: [...this.labels.values()].reduce((n, p) => n + p.texture.source.pixelWidth * p.texture.source.pixelHeight * 4, 0) }; }
  begin(epoch: string): void { const key = `${epoch}:${this.renderer.resolution}`; if (key !== this.epoch) { this.clear(); this.epoch = key; } }
  /** Notes keep their requested size through a GPU transform, sampling a larger
   * shared glyph instead of rasterizing every random fractional font size. */
  pinNote(text: string): TextStyle | undefined {
    if (!text || text.length > 4) return;
    const id = 'note:' + text, cached = this.labels.get(id);
    if (cached) { this.hits++; return cached.label.style; }
    return this.pinLabel(id, text, { fontSize: 32, fill: 0xffe98a });
  }
  private pinLabel(id: string, text: string, style: TextStyleOptions): TextStyle | undefined {
    if (this.labels.size >= this.limit) { this.skipped++; return; }
    const label = new Text({ text, style });
    label.anchor.set(.5);
    const texture = this.renderer.canvasText.getManagedTexture(label), key = label.styleKey;
    const automaticGc = texture.source.autoGarbageCollect;
    // GPU text canvases are returned to Pixi's canvas pool after upload. Their
    // pixels cannot be re-uploaded from that canvas following automatic GC.
    texture.source.autoGarbageCollect = false;
    this.labels.set(id, { label, texture, key, automaticGc }); this.misses++; return label.style;
  }
  clear(): void {
    for (const { label, texture, key, automaticGc } of this.labels.values()) {
      texture.source.autoGarbageCollect = automaticGc;
      this.renderer.canvasText.decreaseReferenceCount(key);
      // These labels never enter a render tree/CanvasTextPipe, so the single
      // getManagedTexture reference above is released explicitly, exactly once.
      label.destroy();
    }
    this.labels.clear();
  }
}
