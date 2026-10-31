export const ENCOUNTER_ART = {
  flandre: { background: 'flandre-stage7/eff07_nc_4k.png', circle: 'fx/magic_circle_86.png' },
  vergil: { arena: 'boss/vergil_arena.jpg', chair: 'boss/vergil_chair.png', silhouette: 'boss/vergil_silhouette.png' },
  remilia: { tower: 'boss/remilia/tower.png', moon: 'boss/remilia/moonskin.png', sigil: 'boss/remilia/sigil.png' },
} as const;
export function spriteAnimationFile(kind: 'remilia' | 'choco' | 'vanilla', elapsed: number): string {
  const count = kind === 'remilia' ? 24 : 30;
  const frame = ((Math.floor(Math.max(0, elapsed) * (kind === 'remilia' ? 12 : 10)) % count) + count) % count;
  return kind === 'remilia' ? `boss/remilia/remilia_${String(frame).padStart(2, '0')}.png`
    : `boss/halloween/${kind}_h_${String(frame).padStart(2, '0')}.png`;
}
export const CARD_THEMES: Record<string, { color: string; vertices: number; step: number }> = {
  prologue: { color: '#6a7cff', vertices: 7, step: 2 }, cranberry: { color: '#e050f0', vertices: 5, step: 2 },
  laevateinn: { color: '#ff3040', vertices: 6, step: 2 }, fourkind: { color: '#5040f0', vertices: 8, step: 3 },
  kagome: { color: '#30e080', vertices: 6, step: 2 }, maze: { color: '#60e8e8', vertices: 7, step: 3 },
  starbow: { color: '#ffe060', vertices: 9, step: 4 }, catadioptric: { color: '#4a64f0', vertices: 5, step: 2 },
  clock: { color: '#a8c8ff', vertices: 12, step: 5 }, ripples: { color: '#5a6cf0', vertices: 10, step: 3 },
  fragile: { color: '#ff80c0', vertices: 7, step: 2 }, bloodstain: { color: '#ff2030', vertices: 5, step: 2 }, heart: { color: '#d060f0', vertices: 9, step: 2 },
};
/** Complete disconnected star components (e.g. six-point star {6/2}). */
export function starPolygons(vertices: number, step: number, radius: number): readonly (readonly number[])[] {
  if (vertices < 3 || step < 1 || step >= vertices) throw new Error('Invalid star polygon');
  const visited = new Set<number>(); const paths: number[][] = [];
  for (let start = 0; start < vertices; start++) {
    if (visited.has(start)) continue;
    const path: number[] = [];
    let index = start;
    do {
      visited.add(index); const angle = index / vertices * Math.PI * 2 - Math.PI / 2;
      path.push(Math.cos(angle) * radius, Math.sin(angle) * radius); index = (index + step) % vertices;
    } while (index !== start);
    paths.push(path);
  }
  return paths;
}
