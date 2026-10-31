import type { FilterSystem } from 'pixi.js';

const released = new WeakSet<FilterSystem>();

/** Pixi 8.22 FilterSystem.destroy omits its renderer-local global filter group.
 * Detach its listeners before ViewSystem prunes screen-sized temporary textures.
 * The group is not owned by the individual Filter shaders that temporarily use it.
 */
export function releaseRendererFilterBindings(renderer: { filter?: FilterSystem }): void {
  const system = renderer.filter;
  if (!system || released.has(system)) return;
  const group: unknown = Reflect.get(system, '_globalFilterBindGroup');
  if (group != null) {
    if (typeof group !== 'object' || !('destroy' in group) || typeof group.destroy !== 'function') {
      throw new TypeError('Unexpected Pixi filter binding group');
    }
    group.destroy();
  }
  released.add(system);
}
