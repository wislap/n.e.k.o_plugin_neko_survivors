import { Assets, type Texture } from 'pixi.js';
import { ResourcePool } from './resource-scope';

import { spriteUrl, type SpriteKind } from '../assets/sprite-url';
export { SPRITE_KINDS, spriteUrl } from '../assets/sprite-url';
export type { SpriteKind } from '../assets/sprite-url';
const texturePool = new ResourcePool<Texture>(url => Assets.load<Texture>(url), async url => { await Assets.unload(url); });

export class GameAssets {
  private readonly textures = new Map<string, Texture>();
  private readonly leases = new Map<string, { release(): void }>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly failed = new Map<string, string>();
  private disposed = false;
  private publishedRevision = 0;
  constructor(private readonly base = './assets') {}
  get revision(): number { return this.publishedRevision; }
  get(kind: SpriteKind, id: string): Texture | undefined { return this.textures.get(`${kind}:${id}`); }
  getFile(path: string): Texture | undefined { return this.textures.get(`file:${path}`); }
  requestFile(path: string): Promise<void> {
    if (!path || path.startsWith('/') || path.split('/').some(part => !part || part === '..' || part === '.') || path.includes('\\')) {
      return Promise.reject(new Error(`Invalid asset path: ${path}`));
    }
    return this.requestUrl(`file:${path}`, `${this.base.replace(/\/$/, '')}/${path.split('/').map(encodeURIComponent).join('/')}`);
  }
  request(kind: SpriteKind, id: string): Promise<void> {
    return this.requestUrl(`${kind}:${id}`, spriteUrl(this.base, kind, id));
  }
  private requestUrl(key: string, url: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.pending.has(key)) return this.pending.get(key)!;
    if (this.textures.has(key) || this.failed.has(key)) return Promise.resolve();
    const lease = texturePool.acquire(url);
    this.leases.set(key, lease);
    const pending = lease.value.then(texture => {
      if (!this.disposed) { this.textures.set(key, texture); this.publishedRevision++; }
    }).catch(error => {
      if (!this.disposed) this.failed.set(key, error instanceof Error ? error.message : String(error));
      lease.release();
      this.leases.delete(key);
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, pending);
    return pending;
  }
  get diagnostics(): { loaded: number; pending: number; estimatedBytes: number; failed: readonly string[] } {
    return { loaded: this.textures.size, pending: this.pending.size, estimatedBytes: [...new Set(this.textures.values())].reduce((bytes, texture) => bytes + texture.width * texture.height * 4, 0), failed: [...this.failed.keys()] };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const lease of this.leases.values()) lease.release();
    this.leases.clear();
    this.textures.clear();
    this.failed.clear();
  }
}
