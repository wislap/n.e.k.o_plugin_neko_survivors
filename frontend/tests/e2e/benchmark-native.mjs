import{createFrameCapture}from'../../src/diagnostics/frame-capture.ts';
export function attachOriginal(game,metadata){
 const capture=createFrameCapture();const update=game._update.bind(game),render=game._render.bind(game),loop=game._loop.bind(game);
 const phase=()=>({play:'playing',level_up:'upgrade',char_select:'title'})[game.state]||game.state;
 game._loop=now=>{capture.beginFrame(now);capture.dropped(Math.max(0,(now-game._lastTime)/1000-.1));loop(now)};
 game._update=dt=>{const at=performance.now();update(dt);capture.record('simulation',at,performance.now())};
 game._render=()=>{const at=performance.now();render();capture.record('renderSubmit',at,performance.now());const w=game.world;if(w&&game.player)capture.frame({phase:phase(),wave:game.waveIndex+1,combat:game.state==='playing',actors:w.enemies.items.length+1,projectiles:w.bullets.items.length+w.enemyBullets.items.length,effects:w.fx?.items?.length??0,pickups:w.pickups.items.length})};
 return{start(){const p=game.player;capture.start({...metadata,kind:'native-full-game',backend:'canvas2d',stageScope:'simulation wraps complete original _update; renderSubmit wraps complete original _render',canvas:{width:game.canvas.width,height:game.canvas.height},playerAtStart:{characterId:p.characterId,level:p.level,hp:p.hp,stats:{...p.stats.values},weapons:p.weapons.map(w=>({id:w.def.id,level:w.level}))}})},stop(){return capture.stop()},get running(){return capture.running},wave(){return game.waveIndex+1},phase};
}
