import {GameFrameBuffer}from'../../src/game';
import{PlayerTrailPreparation}from'../../src/game';
const trailPreparation=new PlayerTrailPreparation();let preparedTrails;
import{PlayerBodyPreparation}from'../../src/render-data/player-bodies';
const bodyPreparation=new PlayerBodyPreparation();let preparedBodies;
const frameBuffer=new GameFrameBuffer({ packed: !new URLSearchParams(location.search).has('mobile') });
import {Graphics,Mesh} from 'pixi.js';
import {mixedPresets,populatePlayerMix,movePlayerMix}from'./player-mixed-fixture.ts';
import {createRenderer}from'../../src/rendering/create-renderer.ts';
import {GameRenderer}from'../../src/rendering/game-renderer.ts';
import {SessionEngine}from'../../src/game/session-engine.ts';
import {Pickup as NewPickup}from'../../src/game/actors/pickup.ts';
import {createFrameCapture}from'../../src/diagnostics/frame-capture.ts';
import {Renderer as OldRenderer}from'../../../../neko_survivors/static/game/src/systems/renderer.js';
import {World as OldWorld}from'../../../../neko_survivors/static/game/src/systems/world.js';
import {Player as OldPlayer}from'../../../../neko_survivors/static/game/src/entities/player.js';
import {Pickup as OldPickup}from'../../../../neko_survivors/static/game/src/entities/pickup.js';
import {Camera as OldCamera}from'../../../../neko_survivors/static/game/src/core/camera.js';
import {RNG as OldRng}from'../../../../neko_survivors/static/game/src/core/rng.js';
import {sprites,buildPreloadPlan}from'../../../../neko_survivors/static/game/src/core/assets.js';
import {getSpriteEnemies}from'../../../../neko_survivors/static/game/src/data/enemies.js';
import {BACKGROUNDS}from'../../../../neko_survivors/static/game/src/data/backgrounds.js';
import {getSpriteCharacters}from'../../../../neko_survivors/static/game/src/data/characters.js';

const q=new URLSearchParams(location.search),backend=q.get('backend')||'webgl2',scenario=q.get('scenario')||'horde';
const config={...mixedPresets,horde:{enemies:600,bullets:4000,pickups:2000,bosses:0},boss:{enemies:300,bullets:6000,pickups:1200,bosses:4},drops:{enemies:600,bullets:1500,pickups:6000,bosses:0}}[scenario];
if(!['webgl2','canvas2d'].includes(backend))throw Error('Unsupported benchmark backend: '+backend);
if(!config)throw Error('Unknown scenario');
if(config.playerBullets&&backend==='canvas2d')throw Error('Player mixed fixture currently validates community renderers only');
const width=1920,height=1080,projection=backend!=='canvas2d',capture=createFrameCapture();
let world,player,camera,renderer,engine,nativeRenderer,ready=false,active=false,rafId=0,started=0,warmUntil=0,tick=0;
let state=0x123456;const random=()=>{state=(Math.imul(state,1664525)+1013904223)|0;return(state>>>0)/4294967296};
const at=()=>({x:(random()-.5)*1770,y:(random()-.5)*930});
let playerMix=[];let posePrimed=false;const basePositions=[];let errors=[],preloadStats=null;const status=document.getElementById('status');
function observe(message){status.textContent=JSON.stringify(message,null,2)}
async function init(){
 if(projection){
  engine=new SessionEngine({});engine.dispatch({type:'start-run',options:{characterId:'yui',difficulty:'nightmare',partySize:1,seed:69,pilot:false}});engine.setViewport(width,height);engine.battle.enterWave(49,true);world=engine.battle.world;player=engine.battle.player;world.pet=null;world.terrain={rects:[],circles:[]};engine.battle.backgroundId='lab';
  const device=await createRenderer({width,height,resolution:2});nativeRenderer=device.renderer;renderer=new GameRenderer(device,{container:document.getElementById('stage'),presentation:{mobile:false,resolution:2},assetBaseUrl:'/community/assets'});renderer.setPlayerSoftQuality(q.get('softQuality')??'native');
 }else{
  const rng=new OldRng(69);camera=new OldCamera();camera.resize(width,height);camera.snapTo(0,0);world=new OldWorld(rng,camera);world.setDifficulty('nightmare');world.currentWave=49;world.endless=true;player=new OldPlayer('yui',rng);player.world=world;world.player=player;world.terrain={rects:[],circles:[]};const canvas=document.createElement('canvas');canvas.style.cssText='width:1920px;height:1080px';document.getElementById('stage').append(canvas);renderer=new OldRenderer(canvas);renderer.resize();renderer.backgroundId='lab';renderer._drawHudBars=()=>{};
  preloadStats=await sprites.preload(buildPreloadPlan({enemies:getSpriteEnemies(),backgrounds:BACKGROUNDS,pickups:['heal','xp','coin_1','coin_2'],characters:getSpriteCharacters(),pets:['kitten']}));if(preloadStats.failed)throw Error('Original sprite preload failed: '+JSON.stringify(preloadStats));
 }
 const spawn=(id,x,y)=>projection?world.waves.spawnEnemyById(id,x,y):world.spawnEnemyById(id,x,y);
 const ids=['ghost','tank','charger','spitter','spiral_cat','chaos_egg'];
 for(let i=0;i<config.enemies;i++){const p=at();spawn(ids[i%ids.length],p.x,p.y)}
 for(const[id,i]of['boss_cat_king','boss_void_lord','boss_acid_cat','boss_apple_cider'].slice(0,config.bosses).map((id,i)=>[id,i]))spawn(id,[-600,600,-600,600][i],[-300,-300,300,300][i]);
 for(let i=0;i<config.bullets;i++){const p=at();world.spawnEnemyBullet({...p,angle:random()*Math.PI*2,speed:0,damage:1,radius:i%4===3?12:5,shape:['orb','rice','shard','jade'][i%4],color:['#ff4060','#ff9f43','#ffe066','#4cd7d0','#70a1ff'][i%5],hitRadius:i%4===3?7:4})}
 if(config.playerBullets)playerMix=populatePlayerMix(world,player,config.playerBullets,random);
 for(let i=0;i<config.pickups;i++){const p=at();const item=new(projection?NewPickup:OldPickup)(i%2?'xp':'material',p.x,p.y,1);item.variant=i%2+1;item.bobPhase=random()*Math.PI*2;item.vx=item.vy=0;world.pickups.add(item)}
 for(const group of[world.enemies.items,world.enemyBullets.items,world.pickups.items])for(const item of group)basePositions.push({item,x:item.x,y:item.y,phase:random()*6.28});
 if(playerMix.length){await Promise.all([...ids.map(id=>renderer.assets.request('enemy',id)),renderer.assets.request('character','yui'),renderer.assets.request('background','lab'),...['xp','coin_1','coin_2'].map(id=>renderer.assets.request('pickup',id)),...['ff4d94','ffc857','5fd3e8','b794f6'].map(color=>renderer.assets.requestFile(`ordinary/glow_${color}.png`))]);if(renderer.diagnostics.assets.failed.length)throw Error('Mixed preload failed: '+JSON.stringify(renderer.diagnostics.assets.failed));}
 ready=true;document.getElementById('start').disabled=false;observe({ready,backend,scenario,config});
}
function inspectScene(){
 if(!projection)return null;
 const counts={displayNodes:0,meshes:0,meshVertices:0,meshIndices:0,graphics:0,batchableGraphics:0,nonBatchableGraphics:0,vertexCoordinates:0,styleGeometry:{},styles:{shot:0,coin:0,orb:0,tracer:0}};
 function walk(node){counts.displayNodes++;if(node instanceof Mesh){counts.meshes++;counts.meshVertices+=(node.activeVertices??node.geometry.positions.length/2)*(node.geometry.instanceCount??1);counts.meshIndices+=(node.geometry.indexCount||node.geometry.indices.length)*(node.geometry.instanceCount??1)}if(node instanceof Graphics){counts.graphics++;const gpu=node.context._gpuData[nativeRenderer.uid];if(gpu){if(gpu.isBatchable)counts.batchableGraphics++;else counts.nonBatchableGraphics++;counts.vertexCoordinates+=gpu.geometryData?.vertices.length??0}}for(const c of node.children??[])walk(c)}
 walk(renderer.scene.stage);
 for(const {bullet}of playerMix){const style=bullet.behavior==='bounce'?'coin':bullet.kind==='element'?'orb':bullet.kind==='turret'?'tracer':'shot';counts.styles[style]++;const row=counts.styleGeometry[style]??={bodyCoordinates:0,trailCoordinates:0,nonBatchableBody:0,nonBatchableTrail:0};const d=renderer.projectiles.entries.get(bullet.id);for(const [name,index]of [['Body',5],['Trail',4]]){const gpu=d?.children[index]?.context?._gpuData[nativeRenderer.uid];if(gpu){row[name==='Body'?'bodyCoordinates':'trailCoordinates']+=gpu.geometryData?.vertices.length??0;if(!gpu.isBatchable)row['nonBatchable'+name]++;}}}
 return counts;
}
function metadata(){const canvas=document.querySelector('canvas');return{kind:'controlled-world-render-only',difficulty:'nightmare',wave:50,seed:69,backend,scenario,config,logical:{width,height},canvas:{width:canvas.width,height:canvas.height},renderer:projection?renderer.diagnostics:{backend:'canvas2d',preload:preloadStats},scene:inspectScene(),fixtureMotion:q.has('freezeMotion')?'Fixed pose primed once before scoring; no repeated fixture-motion work':'Deterministic prescribed motion, native component/object writes, genuine Bullet/projectFrame, fixed six-point history; not natural gameplay',frozenPose:q.has('pose')?Number(q.get('pose')):null,bodyPreparation:q.has('freezeMotion')&&q.has('pose')?'Fixed body packet prepared once; GPU data still uploaded on every render':'Body preparation included in controlled main-thread projection, real runtime prepares in worker',hudExcluded:true,simulationExcluded:true,note:'Same deterministic entity population; real renderer/projection. No AI/collision/outcomes. Original native visual LOD remains active; this is not natural gameplay.'}}
async function drain(){
 const before=performance.now();
 if(backend==='webgl2'){
  const gl=nativeRenderer.gl,sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();
  for(;;){const v=gl.clientWaitSync(sync,0,0);if(v===gl.ALREADY_SIGNALED||v===gl.CONDITION_SATISFIED)break;if(v===gl.WAIT_FAILED)throw Error('GPU fence failed');await new Promise(r=>setTimeout(r,1))}gl.deleteSync(sync);
 }else renderer.ctx.getImageData(0,0,1,1);
 return {method:backend==='webgl2'?'WebGL fence completion':'Canvas2D final-pixel readback only',endMs:performance.now(),drainMs:performance.now()-before,allSubmittedPrefix:backend!=='canvas2d'};
}
async function frame(now){
 if(!active)return;capture.beginFrame(now);const time=q.has('pose')?Number(q.get('pose')):(tick++%3600)/60;let before=performance.now();
 if(!q.has('freezeMotion')||!posePrimed){for(const{item,x,y,phase}of basePositions){const c=item.componentColumns,row=item.componentRow;const px=x+Math.sin(time+phase)*4,py=y+Math.cos(time*.7+phase)*4;if(c){c.x[row]=px;c.y[row]=py;c.age[row]=time;if('bobPhase'in item)c.bobPhase[row]=time*3+phase;}else{item.x=px;item.y=py;item.age=time;if('bobPhase'in item)item.bobPhase=time*3+phase;}if('facing'in item)item.facing=phase+time*.1}
 movePlayerMix(playerMix,time);posePrimed=true;}
 player.age=time;world.t=time;capture.record('input',before,performance.now());let view;
 before=performance.now();if(projection){engine.battle.time=time;view=engine.readFrame(frameBuffer);if(view.transients&&(!preparedBodies||!q.has('freezeMotion')||!q.has('pose'))){preparedBodies=bodyPreparation.prepare(view.transients);preparedTrails=trailPreparation.prepare(view.transients);}}capture.record('projection',before,performance.now());
 before=performance.now();if(projection)renderer.render(view,now,{bodies:preparedBodies,trails:preparedTrails});else renderer.render(world,camera,player);capture.record('renderSubmit',before,performance.now());
 const counts={actors:world.enemies.items.length+1,projectiles:world.enemyBullets.items.length+world.bullets.items.length,effects:world.fx?.items?.length??0,pickups:world.pickups.items.length};
 capture.frame({phase:'playing',wave:50,combat:true,...counts});
 if(now>=warmUntil&&window.__benchState.phase==='warming'){await drain();const context=metadata();capture.start(context,{durationMs:Number(q.get('seconds')||90)*1000});window.__benchState={phase:'measuring'};started=now}
 if(window.__benchState.phase==='measuring'&&!capture.running){active=false;const completion=await drain();window.__benchResult=capture.stop();window.__benchResult.context.completion=completion;window.__benchResult.context.sceneAtEnd=inspectScene();document.getElementById('info').style.visibility='visible';window.__benchState={phase:'done',frames:window.__benchResult.frames.length,elapsed:(now-started)/1000,metadata:metadata()};observe(window.__benchState);return}
 rafId=requestAnimationFrame(frame);
}
window.__benchState={phase:'loading'};
function fail(error){window.__benchFailure={error:String(error),stack:error?.stack,metadata:ready?metadata():null};errors.push(String(error));document.getElementById('info').style.visibility='visible';document.getElementById('start').disabled=true;active=false;window.__benchState={phase:'failed',errors};observe(window.__benchState)}
window.addEventListener('error',e=>fail(e.error||e.message));
window.addEventListener('unhandledrejection',e=>fail(e.reason));
document.getElementById('start').onclick=()=>{if(!ready||active)return;active=true;document.getElementById('info').style.visibility='hidden';warmUntil=performance.now()+Number(q.get('warmup')||10)*1000;window.__benchState={phase:'warming',metadata:metadata()};rafId=requestAnimationFrame(frame)};
window.addEventListener('pagehide',()=>{active=false;cancelAnimationFrame(rafId);capture.finish('disposed');if(projection)renderer?.dispose();else document.querySelector('canvas')?.remove()},{once:true});
init().then(()=>window.__benchState={phase:'ready',metadata:metadata()}).catch(error=>{window.__benchState={phase:'failed',error:String(error)};observe(window.__benchState)});
