import {expect,it,vi,afterEach} from 'vitest';
import {MotionHistory,MotionUniforms} from '../../src/rendering/motion';
import {InstanceRuns} from '../../src/rendering/instance-mesh';
import {Texture,TextureSource,Mesh,DOMAdapter} from 'pixi.js';
afterEach(()=>vi.restoreAllMocks());
it('snaps births, deaths and jumps while retaining reordered live identities',()=>{
 const h=new MotionHistory();h.begin();h.sample(1,10,20);expect([h.dx,h.dy]).toEqual([0,0]);h.sample('actor',30,40);h.end();
 h.begin();h.sample('actor',35,50);expect([h.dx,h.dy]).toEqual([-5,-10]);h.sample(1,11,22);expect([h.dx,h.dy]).toEqual([-1,-2]);h.end();h.sample(1,11,22,false);expect([h.dx,h.dy]).toEqual([-1,-2]);
 h.begin();h.sample('actor',500,500);expect([h.dx,h.dy]).toEqual([0,0]);h.end();
 h.begin();h.sample(1,12,24);expect([h.dx,h.dy]).toEqual([0,0]);h.end();h.clear();
});
it('uploads motion once per packet and only updates a shared uniform on repeated draws',()=>{
 vi.spyOn(DOMAdapter.get(),'createCanvas').mockReturnValue({getContext:()=>null} as unknown as HTMLCanvasElement);
 const texture=new Texture({source:new TextureSource({width:8,height:8})}),uniforms=new MotionUniforms(),batch=new InstanceRuns(false,uniforms),part={texture,anchorX:.5,anchorY:.5};
 batch.begin();batch.setMotion(-4,-6);batch.quad(part,'normal',10,20);batch.finish();
 const mesh=batch.children[0] as Mesh,buffer=mesh.geometry.getBuffer('aMotion');expect(Array.from(buffer.data).slice(0,2)).toEqual([-4,-6]);expect(batch.diagnostics.uploadBytes).toBe(40);
 uniforms.set(.5);expect(mesh.shader?.resources.motionUniforms.uniforms.uInterpolation).toBe(.5);expect(mesh.geometry.getBuffer('aMotion')).toBe(buffer);expect(Array.from(buffer.data).slice(0,2)).toEqual([-4,-6]);
 batch.destroy();texture.destroy(true);
});
