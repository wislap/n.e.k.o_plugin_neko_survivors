import { describe, expect, it } from 'vitest';
import { CARD_THEMES, ENCOUNTER_ART, spriteAnimationFile, starPolygons } from '../../src/rendering/encounters/materials';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('special encounter source material mapping', () => {
  it('maps each animated Remilia and Halloween frame to an existing source asset', () => {
    const assetBase = resolve(import.meta.dirname, '../../public/assets');
    for (const [kind, count, fps] of [['remilia', 24, 12], ['choco', 30, 10], ['vanilla', 30, 10]] as const) {
      const files = new Set<string>();
      for (let i = 0; i < count; i++) {
        const file = spriteAnimationFile(kind, i / fps + .001);
        files.add(file); expect(existsSync(resolve(assetBase, file))).toBe(true);
      }
      expect(files.size).toBe(count);
      expect(spriteAnimationFile(kind, count / fps + .001)).toBe(spriteAnimationFile(kind, 0));
    }
    for (const art of Object.values(ENCOUNTER_ART)) for (const file of Object.values(art)) expect(existsSync(resolve(assetBase, file))).toBe(true);
  });
  it('preserves all spell-specific magic star topologies including disconnected components', () => {
    expect(Object.keys(CARD_THEMES)).toHaveLength(13);
    expect(starPolygons(6, 2, 100)).toHaveLength(2);
    for (const theme of Object.values(CARD_THEMES)) {
      const paths = starPolygons(theme.vertices, theme.step, 100);
      expect(paths.flatMap(path => [...path]).length / 2).toBe(theme.vertices);
      for (const path of paths) for (let i = 0; i < path.length; i += 2) expect(Math.hypot(path[i], path[i + 1])).toBeCloseTo(100);
    }
  });
});
