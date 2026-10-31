import { afterEach, expect, it, vi } from 'vitest';
import { Assets, DOMAdapter, Texture, TextureSource } from 'pixi.js';
import { RenderStream, createGameSession, type GameFrame } from '../../src/game';
import { GameRenderer } from '../../src/rendering/game-renderer';
import type { PixiRenderer } from '../../src/rendering/create-renderer';

const releases: (() => void)[] = [];
afterEach(async () => { for (const release of releases.splice(0)) release(); await new Promise(resolve => setTimeout(resolve, 0)); vi.restoreAllMocks(); });
function setup() {
  vi.spyOn(DOMAdapter.get(), 'createCanvas').mockReturnValue({ getContext: () => null } as unknown as HTMLCanvasElement);
  const texture = new Texture({ source: new TextureSource({ width: 32, height: 32 }) });
  vi.spyOn(Assets, 'load').mockResolvedValue(texture as unknown as Record<string, unknown>); vi.spyOn(Assets, 'unload').mockResolvedValue(undefined);
  const screen = { width: 1920, height: 1080 }, render = vi.fn();
  const native = { screen, render,generateTexture:()=>new Texture({source:new TextureSource({width:32,height:32})}), resize(width: number, height: number) { Object.assign(screen, { width, height }); }, destroy() {} } as unknown as PixiRenderer;
  const events = new EventTarget(), canvas = Object.assign(events, { remove() {} }) as unknown as HTMLCanvasElement;
  const renderer = new GameRenderer({ renderer: native, canvas }, { container: { appendChild() {} } as unknown as HTMLElement, presentation: { mobile: false, resolution: 2 } });
  releases.push(() => { renderer.dispose(); texture.destroy(true); });
  const frame: GameFrame = { ...createGameSession().readFrame(), phase: 'paused' };
  return { renderer, render, events, frame,native };
}
it('prepares an explicit display version once while still drawing every callback', () => {
  const s = setup();
  s.renderer.render(s.frame, 0, { revision: 1 }); s.renderer.render(s.frame, 10, { revision: 1 });
  expect(s.render).toHaveBeenCalledTimes(2);
  expect(s.renderer.diagnostics.preparation).toEqual({ worldUpdates: 1, cachedDraws: 1 });
});

it('refreshes new packets at the same tick and every explicit render invalidation', () => {
  const s = setup();
  s.renderer.render(s.frame, 0, { revision: 1 });
  s.renderer.render({ ...s.frame }, 10, { revision: 2 });
  s.renderer.setPlayerEffectOpacity(.4); s.renderer.render(s.frame, 20, { revision: 2 });
  s.renderer.resize(1280, 720); s.renderer.render(s.frame, 30, { revision: 2 });
  s.events.dispatchEvent(new Event('webglcontextlost')); s.renderer.render(s.frame, 40, { revision: 2 });
  s.events.dispatchEvent(new Event('webglcontextrestored')); s.renderer.render(s.frame, 50, { revision: 2 });
  expect(s.renderer.diagnostics.preparation).toEqual({ worldUpdates: 5, cachedDraws: 0 });
  expect(s.render).toHaveBeenCalledTimes(5);
});
it('publishes late textures into the same paused packet', async () => {
  const s = setup(); s.renderer.render(s.frame, 0, { revision: 1 });
  await new Promise(resolve => setTimeout(resolve, 0));
  s.renderer.render(s.frame, 10, { revision: 1 }); s.renderer.render(s.frame, 20, { revision: 1 });
  expect(s.renderer.diagnostics.preparation).toEqual({ worldUpdates: 2, cachedDraws: 1 });
});
it('keeps unversioned mutable frames and real-time title animation live', () => {
  const s = setup(); s.renderer.render(s.frame); s.renderer.render(s.frame);
  const title = createGameSession().readFrame(); s.renderer.render(title, 0, { revision: 1 }); s.renderer.render(title, 100, { revision: 1 });
  expect(s.renderer.diagnostics.preparation).toEqual({ worldUpdates: 4, cachedDraws: 0 });
  expect(s.render).toHaveBeenCalledTimes(4);
});

it('prepares versioned raw packets locally and reuses their prepared world on cached draws', () => {
  const s = setup(), stream = new RenderStream();
  stream.playerView({id:1,x:20,y:30,radius:5,angle:.3,age:1,color:'#ff4d94',hostile:false,playerStyle:'shot',trail:[]});
  const frame = {...s.frame,transients:stream};
  s.renderer.render(frame,0,{revision:1});
  expect(s.renderer.diagnostics.playerBatch.baseInstances).toBe(1);
  s.renderer.render(frame,10,{revision:1});
  expect(s.renderer.diagnostics.preparation).toEqual({worldUpdates:1,cachedDraws:1});
});

it('queries immutable device strings once per context, without synchronizing every diagnostics publication',()=>{
 const s=setup(),getParameter=vi.fn(()=> 'test device');
 Object.assign(s.native,{gl:{getParameter,getExtension:()=>null,VENDOR:1,RENDERER:2,VERSION:3,SHADING_LANGUAGE_VERSION:4}});
 for(let i=0;i<100;i++)expect(s.renderer.diagnostics.device?.vendor).toBe('test device');
 expect(getParameter).toHaveBeenCalledTimes(4);
 s.events.dispatchEvent(new Event('webglcontextlost'));s.events.dispatchEvent(new Event('webglcontextrestored'));
 expect(s.renderer.diagnostics.device?.vendor).toBe('test device');expect(getParameter).toHaveBeenCalledTimes(8);
});
