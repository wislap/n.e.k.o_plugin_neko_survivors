import { expect, it } from 'vitest';
import { Graphics, Texture, TextureSource } from 'pixi.js';
import { ProjectileDisplay, ProjectileTextures } from '../../src/rendering/battle-displays';
import type { GameAssets } from '../../src/rendering/assets';
import type { PixiRenderer } from '../../src/rendering/create-renderer';
import type { ProjectileView } from '../../src/game';

function setup(){
  const texture=new Texture({source:new TextureSource({width:32,height:32})});
  const assets={requestFile:async()=>{},getFile:()=>texture} as unknown as GameAssets;
  const textures=new ProjectileTextures({generateTexture:()=>new Texture({source:new TextureSource({width:32,height:32})})} as unknown as PixiRenderer);
  const display=new ProjectileDisplay(false);
  return {display,assets,textures,body:display.children[5] as Graphics,trail:display.children[4] as Graphics,
    dispose(){display.destroy();textures.dispose();texture.destroy(true)}};
}
const base:ProjectileView={id:1,x:10,y:20,angle:.3,radius:5,color:'#ff4d94',hostile:false,playerStyle:'shot',age:1,trail:[{x:0,y:0,alpha:.5},{x:5,y:10,alpha:.9}]};
it('retains fixed shot/coin body geometry while movement, fading and rotation continue',()=>{
  for(const style of ['shot','coin'] as const){
    const s=setup(),v={...base,playerStyle:style};s.display.sync(v,s.textures,s.assets);
    const instructions=[...s.body.context.instructions];s.body.context.dirty=false;
    s.display.sync({...v,x:50,y:60,angle:1.2,age:3,alpha:.4},s.textures,s.assets);
    expect(s.body.context.dirty).toBe(false);
    expect(s.body.context.instructions.every((instruction,i)=>instruction===instructions[i])).toBe(true);
    expect(s.display.position).toMatchObject({x:50,y:60});expect(s.display.alpha).toBe(.4);
    expect(s.body.rotation).toBe(style==='coin'?24:1.2);
    s.dispose();
  }
});
it('invalidates fixed bodies for radius, color and style, and keeps animated orb/tracer geometry live',()=>{
  const s=setup();s.display.sync(base,s.textures,s.assets);
  for(const change of [{radius:9},{color:'#5fd3e8'},{playerStyle:'coin' as const}]){
    s.display.sync(base,s.textures,s.assets);s.body.context.dirty=false;
    s.display.sync({...base,...change},s.textures,s.assets);expect(s.body.context.dirty).toBe(true);
  }
  for(const style of ['orb','tracer'] as const){
    s.display.sync({...base,playerStyle:style},s.textures,s.assets);s.body.context.dirty=false;
    s.display.sync({...base,playerStyle:style,age:2},s.textures,s.assets);expect(s.body.context.dirty).toBe(true);
  }
  s.display.sync({...base,hostile:true,playerStyle:undefined},s.textures,s.assets);
  s.body.context.dirty=false;s.display.sync(base,s.textures,s.assets);expect(s.body.context.dirty).toBe(true);
  s.dispose();
});
