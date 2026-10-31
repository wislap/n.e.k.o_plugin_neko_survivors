import { MotionUniforms } from './motion';
import type { PreparedTrails } from '../game';
import { PlayerBodyPreparation, type BodyPacket } from '../render-data/player-bodies';
import { GpuTimer } from './gpu-timer';
import { EffectBatch } from './effects/effect-batch';
import type { PresentationProfile } from '../presentation/profile';
import { Rectangle } from 'pixi.js';
import { readPlayerView, readEnemyView, readPickupView, type DisplayFrame, type RenderStreamView, type GameFrame, type ProjectileView } from '../game';
import { ActorBatch } from './actor-batch';
import { GameAssets } from './assets';
import { ProjectileDisplay, ProjectileTextures, TelegraphDisplay } from './battle-displays';
import { cameraTransform, screenToWorld, type CameraTransform } from './camera';
import { createRenderer, type RendererDevice, type RenderCanvas } from './create-renderer';
import { EnemyProjectiles, PickupBatch } from './transient-batches';
import { PlayerProjectiles } from './player-projectiles';
import type { PlayerSoftQuality } from '../presentation/profile';
import { DisplayObjectIndex } from './object-index';
import { GameScene } from './scene';
import { TerrainDisplay } from './terrain-display';
import { WeaponDisplay } from './weapon-display';
import { WeatherDisplay } from './weather-display';
import { EncounterDisplay } from './encounters/encounter-display';
import { AtmosphereFilter } from './shaders/atmosphere';
import { CometDisplay } from './comet-display';
import { MazeDisplay } from './maze-display';
import { WorldOverlay } from './world-overlay';
import { releaseRendererFilterBindings } from './filter-bindings';
export interface DisplayPreparation {
  revision?: number; interpolate?:boolean;adoptMotion?:boolean; bodies?: BodyPacket; trails?: PreparedTrails;
}
export interface GameRendererOptions {
  container: HTMLElement; width?: number; height?: number; presentation: Readonly<PresentationProfile>;
  assetBaseUrl?: string;interpolation?:boolean;
}
export class GameRenderer<C extends RenderCanvas = HTMLCanvasElement> {
  private motion?:MotionUniforms;
  private readonly presentation: Readonly<PresentationProfile>;
  private readonly scene: GameScene;
  private readonly assets: GameAssets;
  private readonly bulletTextures: ProjectileTextures;
  private readonly terrain = new DisplayObjectIndex<TerrainDisplay>();
  private readonly weapons = new DisplayObjectIndex<WeaponDisplay>();
  private readonly weather: WeatherDisplay;
  private readonly comet = new CometDisplay();
  private readonly maze = new MazeDisplay();
  private readonly overlay = new WorldOverlay();
  private readonly encounter = new EncounterDisplay();
  private atmosphere?: AtmosphereFilter;
  private readonly actors = new ActorBatch();
  private readonly projectiles = new DisplayObjectIndex<ProjectileDisplay>();
  private readonly playerProjectiles = new PlayerProjectiles();
  private readonly bodyPreparation = new PlayerBodyPreparation();
  private readonly mobilePlayers: ProjectileView[] = [];
  private readonly pickups = new PickupBatch();
  private readonly enemyProjectiles = new EnemyProjectiles();
  private readonly effects = new EffectBatch();
  private readonly telegraphs = new DisplayObjectIndex<TelegraphDisplay>();
  private camera: CameraTransform;
  private renderedSnapshots=0;private interpolatedFrames=0;
  private cameraFrom?:CameraTransform;private cameraTo?:CameraTransform;private motionRevision=-1;private motionAlpha=1;
  get viewCamera():CameraTransform{return {...this.camera};}
  private playerOpacity = 1;
  private softQuality:PlayerSoftQuality='native';
  private disposed = false; private lost = false; private recovered = 0;
  private prepared?: { revision: number; assets: number; opacity: number; width: number; height: number; generation: number; phase: GameFrame['phase'] };
  private gpuTimer?: GpuTimer;
  private contextProbe?:WEBGL_lose_context;
  probeContext(lost:boolean):void{if(lost){this.contextProbe=this.device.renderer.gl.getExtension('WEBGL_lose_context')??undefined;this.contextProbe?.loseContext();}else this.contextProbe?.restoreContext();}
  setGpuTiming(enabled:boolean):void { this.gpuTimer?.dispose();this.gpuTimer=enabled?new GpuTimer(this.device.renderer.gl):undefined; }
  private worldUpdates = 0;
  private cachedDraws = 0;
  private readonly onContextLost = () => { this.lost = true;this.gpuTimer?.dispose(); };
  private readonly onContextRestored = () => { this.lost = false; this.recovered++; this.bulletTextures.dispose(); this.effects.invalidateText();this.scene.invalidateBackground();this.resetInterpolation();this.deviceDescription=undefined;if(this.gpuTimer)this.gpuTimer=new GpuTimer(this.device.renderer.gl); };
  constructor(private readonly device: RendererDevice<C>, options: Omit<GameRendererOptions,'container'> & {container?:HTMLElement}) {
    this.presentation = options.presentation;
    if(options.interpolation){this.motion=new MotionUniforms();this.actors.enableMotion(this.motion);this.enemyProjectiles.enableMotion(this.motion);this.pickups.enableMotion(this.motion);}
    this.scene = new GameScene(this.presentation);
    this.assets = new GameAssets(options.assetBaseUrl);
    this.weather = new WeatherDisplay(this.assets, this.presentation.mobile);
    this.bulletTextures = new ProjectileTextures(device.renderer);
    this.camera = { x: 0, y: 0, zoom: 1, width: device.renderer.screen.width, height: device.renderer.screen.height };
    device.canvas.addEventListener('webglcontextlost', this.onContextLost);
    device.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    this.scene.terrain.addChild(this.maze);
    this.scene.actors.addChild(this.actors);
    this.scene.content.addChildAt(this.encounter.background, this.scene.content.children.indexOf(this.scene.world));
    this.scene.world.addChildAt(this.encounter.ground, 1);
    this.scene.world.addChildAt(this.encounter.actors, this.scene.world.children.indexOf(this.scene.weapons));
    this.scene.world.addChildAt(this.comet.ground, this.scene.world.children.indexOf(this.scene.pickups));
    this.scene.world.addChild(this.overlay.world, this.weather.world, this.comet.world, this.encounter.foreground);
    this.scene.content.addChild(this.weather.screen);
    this.scene.stage.addChild(this.overlay.screen, this.comet.screen, this.encounter.screen);
    this.scene.projectiles.addChild(this.playerProjectiles, this.enemyProjectiles);
    this.scene.pickups.addChild(this.pickups);
    this.scene.effects.addChild(this.effects);
    if(options.container&&'style' in device.canvas)options.container.appendChild(device.canvas);
  }
  warmText():void{this.effects.warmText(this.device.renderer);}
  setPlayerEffectOpacity(value: number): void {
    if (!Number.isFinite(value)) throw new RangeError('Player effect opacity must be finite');
    this.playerOpacity = Math.max(0, Math.min(1, value));
  }
  get playerEffectOpacity(): number { return this.playerOpacity; }
  get contextLost(): boolean { return this.lost; }
  get backend(): 'webgl2' { return 'webgl2'; }
  get canvas(): C { return this.device.canvas; }
  private deviceDescription?:{vendor:string;renderer:string;version:string;shadingLanguage:string};
  private describeDevice() {
    // GL string queries synchronize Chrome's command buffer. Device identity is
    // invariant for a context; never query it for each worker status publication.
    if(this.deviceDescription)return this.deviceDescription;
    const native = this.device.renderer;
    if ('gl' in native && typeof native.gl?.getParameter === 'function' && !this.lost) {
      const gl = native.gl;
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return this.deviceDescription={ vendor: String(gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR)),
        renderer: String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)),
        version: String(gl.getParameter(gl.VERSION)), shadingLanguage: String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION)) };
    }
    return undefined;
  }
  get diagnostics() {
    return { backend: this.backend, disposed: this.disposed,playerSoftQuality:this.presentation.mobile?'native':this.softQuality,requestedPlayerSoftQuality:this.softQuality,
      gpuTiming: this.gpuTimer?.diagnostics, interpolation:{frames:this.renderedSnapshots,changedFrames:this.interpolatedFrames,maxDelayMs:50,policy:'one received packet interval; births/deaths/epoch/large jumps snap'},
      preparation: { worldUpdates: this.worldUpdates, cachedDraws: this.cachedDraws },
      background:this.scene.backgroundDiagnostics,
      device: this.disposed ? undefined : this.describeDevice(),
      contextLost: this.lost, recoveries: this.recovered, assets: this.assets.diagnostics, generatedTextures: this.bulletTextures.statistics, playerAtlas: this.bulletTextures.player.statistics, actorBatch: this.actors.diagnostics, playerBatch: this.playerProjectiles.diagnostics, enemyBatch: this.enemyProjectiles.diagnostics, pickupBatch: this.pickups.diagnostics, effectBatch: this.effects.diagnostics,
      objects: { overlayLabels: this.overlay.labelCount, terrain: this.terrain.size, weapons: this.weapons.size, actors: this.actors.size, projectiles: this.projectiles.size + this.playerProjectiles.size + this.enemyProjectiles.size, pickups: this.pickups.size, effects: this.effects.size, telegraphs: this.telegraphs.size } };
  }
  resize(width: number, height: number): void {
    if (this.disposed) return;
    this.device.renderer.resize(Math.max(1, width), Math.max(1, height));
    this.camera.width = Math.max(1, width); this.camera.height = Math.max(1, height);
  }
  /** A revision promises an immutable display packet. Unversioned borrowed
   * frames remain supported and are always prepared, including mutable QA input. */
  render(frame: GameFrame, nowMs = 0, display?: DisplayPreparation): void {
    if(this.disposed||this.lost)return;
    this.gpuTimer?.begin();try{this.prepareAndDraw(frame,frame.transients,nowMs,display);}finally{this.gpuTimer?.end();}
  }
  renderSnapshot(snapshot:Readonly<DisplayFrame>,nowMs:number,revision:number,alpha=1):void {
    if(this.disposed||this.lost)return;
    const data=snapshot.transients;
    const stream:RenderStreamView={...data,readPlayer:(i,v)=>readPlayerView(data,i,v),readEnemy:(i,v)=>readEnemyView(data,i,v),readPickup:(i,v)=>readPickupView(data,i,v)};
    this.renderDisplay(snapshot.scene,stream,nowMs,revision,alpha,snapshot.bodies,snapshot.trails);
  }
  renderInterpolated(frame:GameFrame,nowMs:number,revision:number,alpha:number):void {
    if(this.disposed||this.lost)return;
    this.renderDisplay(frame,frame.transients,nowMs,revision,alpha);
  }
  private renderDisplay(frame:Omit<GameFrame,'transients'>,stream:RenderStreamView|undefined,nowMs:number,revision:number,alpha:number,bodies?:BodyPacket,trails?:PreparedTrails):void {
    this.motionAlpha=alpha;const adoptMotion=this.motionRevision!==revision;
    if(adoptMotion){if(this.motion)this.motion.hasMotion=false;const next=cameraTransform(frame,this.device.renderer.screen.width,this.device.renderer.screen.height);this.cameraFrom=this.cameraTo??next;this.cameraTo=next;if((next.x-this.cameraFrom.x)**2+(next.y-this.cameraFrom.y)**2>256**2)this.cameraFrom=next;this.motionRevision=revision;}
    this.playerProjectiles.interpolate(alpha);this.motion?.set(alpha);
    this.gpuTimer?.begin();try{this.prepareAndDraw(frame,stream,nowMs,{revision,bodies,trails,interpolate:alpha<1,adoptMotion});this.renderedSnapshots++;if(alpha>0&&alpha<1&&(this.playerProjectiles.hasMotion||this.actors.hasMotion||this.motion?.hasMotion||this.cameraFrom&&this.cameraTo&&(this.cameraFrom.x!==this.cameraTo.x||this.cameraFrom.y!==this.cameraTo.y||this.cameraFrom.zoom!==this.cameraTo.zoom)))this.interpolatedFrames++;}finally{this.gpuTimer?.end();}
  }

  setPlayerSoftQuality(value:PlayerSoftQuality):void{if(value!=='native'&&value!=='balanced')throw new RangeError('Unknown player soft quality');this.softQuality=value;this.playerProjectiles.setSoftQuality(this.presentation.mobile?'native':value);}
  resetInterpolation():void{this.cameraFrom=this.cameraTo=undefined;this.motionRevision=-1;this.playerProjectiles.resetInterpolation();this.actors.resetMotion();this.enemyProjectiles.resetMotion();this.pickups.resetMotion();}
  private prepareAndDraw(frame: Omit<GameFrame,'transients'>, transients:RenderStreamView|undefined, nowMs = 0, display?: DisplayPreparation): void {
    let { revision: displayRevision, bodies, trails } = display ?? {};
    if (this.disposed || this.lost) return;
    const renderer = this.device.renderer;
    const prepared = this.prepared;
    if (displayRevision !== undefined && frame.phase !== 'title' && prepared
      && prepared.revision === displayRevision && prepared.phase === frame.phase
      && prepared.assets === this.assets.revision && prepared.opacity === this.playerOpacity
      && prepared.width === renderer.screen.width && prepared.height === renderer.screen.height
      && prepared.generation === this.recovered) {
      this.cachedDraws++; this.drawScene(); return;
    }
    this.prepared = undefined; this.worldUpdates++;
    this.camera = cameraTransform(frame, renderer.screen.width, renderer.screen.height);
    this.scene.sync(frame, this.camera, this.assets, nowMs,renderer);
    const playing = frame.phase !== 'title';
    this.overlay.screen.visible = playing; this.comet.screen.visible = playing; this.encounter.screen.visible = playing;
    if (!playing) {
      this.scene.content.filters = [];
      renderer.render(this.scene.stage);
      return;
    }
    this.maze.sync(frame.maze, frame.time);
    const terrain = (frame.terrain ?? []).filter(t => !frame.maze || t.material !== 'ice');
    this.terrain.sync(terrain, () => this.scene.terrain.addChild(new TerrainDisplay()), (d, v) => d.sync(v));
    this.weapons.sync(frame.weapons ?? [], () => this.scene.weapons.addChild(new WeaponDisplay(this.presentation.mobile)), (d, v) => { d.sync(v, frame.actors.find(a => a.id === v.ownerId), frame.time); d.alpha *= this.playerOpacity; });
    this.weather.sync(frame.weather, this.camera);
    this.comet.sync(frame.comet, this.camera, frame.actors, this.assets);
    this.encounter.sync(frame.encounter, this.camera, this.assets);
    this.overlay.sync(frame, this.camera, transients);
    this.updateAtmosphere(frame);
    this.actors.sync(frame.actors, frame.time, this.assets, this.bulletTextures.player,display?.adoptMotion);
    if (display && !bodies && transients && !this.presentation.mobile) bodies = this.bodyPreparation.prepare(transients,!!this.motion);
    if (!this.presentation.mobile) this.playerProjectiles.sync(bodies && 'groups' in bodies ? [] : frame.projectiles.filter(v => (v.trail?.length ?? 0) <= 6), this.bulletTextures.player, this.assets, this.playerOpacity, transients, bodies, trails,display?.interpolate,display?.adoptMotion);
    const individual = frame.projectiles.filter(v => v.playerStyle && (this.presentation.mobile || bodies && 'groups' in bodies || (v.trail?.length ?? 0) > 6));
    if (this.presentation.mobile && transients) for (let i = 0; i < transients.playerCount; i++) {
      const v = this.mobilePlayers[i] ??= { id: 0, x: 0, y: 0, radius: 0, angle: 0, color: '', hostile: false, trail: [] };
      individual.push(transients.readPlayer(i, v));
    }
    this.projectiles.sync(individual, () => this.scene.projectiles.addChildAt(new ProjectileDisplay(this.presentation.mobile), this.scene.projectiles.children.indexOf(this.enemyProjectiles)), (d, v) => { d.sync(v, this.bulletTextures, this.assets); if (!v.hostile) d.alpha *= this.playerOpacity; });
    this.enemyProjectiles.sync(frame.projectiles.filter(v => !v.playerStyle), transients, this.bulletTextures, this.presentation.mobile, this.playerOpacity,display?.adoptMotion);
    this.pickups.sync(frame.pickups, transients, this.bulletTextures, this.assets,display?.adoptMotion);
    this.effects.sync(frame.effects, frame.time, this.bulletTextures.player, this.playerOpacity, renderer, `${frame.encounter?.kind ?? 'ordinary'}:${frame.hudChrome?.wave ?? 0}`);
    this.telegraphs.sync(frame.telegraphs, () => this.scene.telegraphs.addChild(new TelegraphDisplay()), (d, v) => d.sync(v));
    this.drawScene();
    if (displayRevision !== undefined) this.prepared = { revision: displayRevision, phase: frame.phase,
      assets: this.assets.revision, opacity: this.playerOpacity, width: renderer.screen.width,
      height: renderer.screen.height, generation: this.recovered };
  }
  private drawScene():void {
    if(this.cameraFrom&&this.cameraTo){const a=this.motionAlpha,from=this.cameraFrom,to=this.cameraTo;this.camera={x:from.x+(to.x-from.x)*a,y:from.y+(to.y-from.y)*a,zoom:from.zoom+(to.zoom-from.zoom)*a,width:this.device.renderer.screen.width,height:this.device.renderer.screen.height};this.scene.applyCamera(this.camera);}
    this.playerProjectiles.updateViewport(this.camera,this.device.renderer.resolution??this.presentation.resolution);
    this.actors.interpolate(this.motion?.group.uniforms.uInterpolation??1);this.device.renderer.render(this.scene.stage);
  }
  private updateAtmosphere(frame: GameFrame): void {
    const weather = frame.weather;
    const strength = Math.max(0, Math.min(1, weather?.strength ?? 0));
    const id = weather?.id;
    const heat = id === 'scorch' ? strength : 0;
    const fog = weather?.id === 'fog' ? weather.fogStrength : id === 'riverFog' ? strength * .45 : 0;
    const veil = frame.comet && !['idle', 'done'].includes(frame.comet.phase) ? .45 : frame.encounter?.kind === 'vergil' ? frame.encounter.veil : frame.encounter?.kind === 'halloween' ? frame.encounter.veil : frame.encounter ? .35 : 0;
    const tint = id === 'bloodMoon' ? [1, .12, .24, strength * .15] : id === 'clear' || id === 'scorch' ? [1, .71, .3, strength * .05] : [0, 0, 0, 0];
    const player = frame.actors.find(a => a.kind === 'player');
    const health = player?.maxHp ? (player.hp ?? player.maxHp) / player.maxHp : 1;
    const danger = health < .35 ? .18 + (.35 - health) / .35 * .3 * (.5 + Math.sin(frame.time * 5) * .5) : 0;
    const vision = [player ? .5 + (player.x - this.camera.x) * this.camera.zoom / this.camera.width : .5,
      player ? .5 + (player.y - this.camera.y) * this.camera.zoom / this.camera.height : .5,
      this.camera.width / this.camera.zoom, this.camera.height / this.camera.zoom];
    const active = heat + fog + veil + tint[3] + danger > .001;
    if (active) {
      this.atmosphere ??= new AtmosphereFilter();
      this.atmosphere.update(frame.time, heat, fog, veil, tint, vision, danger);
      this.scene.content.filterArea = new Rectangle(0, 0, this.camera.width, this.camera.height);
      this.scene.content.filters = [this.atmosphere];
    } else this.scene.content.filters = [];
  }
  screenToWorld(x: number, y: number) { return screenToWorld(this.camera, x, y); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gpuTimer?.dispose();
    releaseRendererFilterBindings(this.device.renderer);
    this.device.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.device.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.terrain.dispose(); this.weapons.dispose(); this.maze.destroy();
    this.weather.dispose(); this.overlay.dispose(); this.comet.dispose(); this.encounter.dispose();
    this.scene.content.filters = [];
    this.atmosphere?.destroy();
    this.actors.destroy(); this.projectiles.dispose(); this.playerProjectiles.destroy(); this.pickups.destroy(); this.enemyProjectiles.destroy(); this.effects.destroy(); this.telegraphs.dispose();
    this.scene.dispose(); this.bulletTextures.dispose(); this.assets.dispose();
    this.device.renderer.destroy({ removeView: true, releaseGlobalResources: false }); if('remove' in this.device.canvas)this.device.canvas.remove();
  }
}
export async function createGameRenderer(options: GameRendererOptions): Promise<GameRenderer> {
  const device = await createRenderer({ width: options.width ?? (options.container.clientWidth || 1),
    height: options.height ?? (options.container.clientHeight || 1), resolution: options.presentation.resolution });
  let game:GameRenderer|undefined;
  try { game=new GameRenderer(device, options);game.warmText();return game; }
  catch (error) {
    if(game)game.dispose();
    else {releaseRendererFilterBindings(device.renderer);device.renderer.destroy({ removeView: true, releaseGlobalResources: false });device.canvas.remove();}
    throw error;
  }
}
export async function createOffscreenRenderer(options:Omit<GameRendererOptions,'container'> & {canvas:OffscreenCanvas;width:number;height:number}):Promise<GameRenderer<OffscreenCanvas>> {
 const device=await createRenderer({canvas:options.canvas,width:options.width,height:options.height,resolution:options.presentation.resolution});
 let game:GameRenderer<OffscreenCanvas>|undefined;
 try{game=new GameRenderer(device,options);game.warmText();return game;}
 catch(error){if(game)game.dispose();else{releaseRendererFilterBindings(device.renderer);device.renderer.destroy({removeView:false,releaseGlobalResources:false});}throw error;}
}
