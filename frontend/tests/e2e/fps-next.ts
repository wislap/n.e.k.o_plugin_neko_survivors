/** Explicit rendering/resource QA only; never imported by the product. */
import { createGameSession, type ActorView,type EffectView } from '../../src/game';
import { createGameRenderer } from '../../src/rendering';
const renderer = await createGameRenderer({container:document.getElementById('game')!,width:1920,height:1080,
  presentation:{mobile:false,resolution:2},assetBaseUrl:'/community/assets'});
const frame = {...createGameSession().readFrame(),phase:'playing' as const,backgroundId:'lab',actors:[] as ActorView[],projectiles:[],pickups:[],effects:[] as EffectView[],telegraphs:[],terrain:[],weapons:[]};
const gl = renderer.canvas.getContext('webgl2')!;
let uploads = 0;
for (const name of ['texImage2D','texSubImage2D'] as const) {
  const original = gl[name].bind(gl);
  Object.assign(gl,{[name]:(...args:unknown[])=>{uploads++;return Reflect.apply(original,gl,args);}});
}
async function draw(textOffset: number) {
  frame.effects = Array.from({length:120},(_,id)=>({id,kind:'text',x:(id%12-5.5)*130,y:(Math.floor(id/12)-4.5)*90,
    text:String(10000+textOffset+id)+(id%3===0?'!':''),critical:id%3===0,color:id%2?'#79dfff':'#ffcf79',radius:14,alpha:.7,progress:.3}));
  renderer.render(frame,2000);
  await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
}
await draw(0);
for(let i=0;i<1000&&renderer.diagnostics.assets.pending;i++)await new Promise(r=>setTimeout(r,5));
await draw(0);await draw(1000);
Object.assign(window,{__nextQA:{ready:true,renderer,draw,async effects(progress=.3,opacity=1){
 renderer.setPlayerEffectOpacity(opacity);
 const kinds=['sparkle','shard','hit','impact','shockwave','explosion','ring','beam','trail'] as const;
 frame.effects=Array.from({length:54},(_,id)=>({id,kind:kinds[id%9],x:(id%9-4)*190,y:(Math.floor(id/9)-2.5)*130,radius:24,color:'#79dfff',alpha:.6,progress,rays:12,power:.7,seed:.4,angle:.3,playerOwned:true,...(kinds[id%9]==='beam'?{end:{x:(id%9-4)*190+70,y:(Math.floor(id/9)-2.5)*130+40}}:{})}));
 renderer.render(frame,2000);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));return renderer.diagnostics;
 },async actors(){
 frame.effects=[];frame.actors=Array.from({length:48},(_,id):ActorView=>({id,kind:'enemy',definitionId:['slime','bat','ghost','goblin'][id%4],radius:10+(id%5)*4,color:'#79dfff',x:(id%8-3.5)*200,y:(Math.floor(id/8)-2.5)*145,angle:.3+id*.2,facePlayer:true,faceRotate:id%3===0,scale:1,hp:id%3===0?100:33,maxHp:100,alpha:id%2?.6:1,mutant:id%7===0,hurtFlash:id%4===0?.2:0,moving:true,walkPhase:id*.2}));
 renderer.render(frame,2000);for(let i=0;i<1000&&renderer.diagnostics.assets.pending;i++)await new Promise(r=>setTimeout(r,5));renderer.render(frame,2000);await new Promise<void>(r=>requestAnimationFrame(()=>r()));return renderer.diagnostics;
 },async digits(){const before=uploads;for(let i=0;i<8;i++)await draw(100000+i*1000);return{textureUploads:uploads-before,diagnostics:renderer.diagnostics};}}});
addEventListener('pagehide',()=>renderer.dispose(),{once:true});
