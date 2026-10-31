import{expect,it,vi}from'vitest';
import{GpuTimer}from'../../src/rendering/gpu-timer';
function setup(){
 let disjoint=false,ready=false;const beginQuery=vi.fn(),endQuery=vi.fn(),deleteQuery=vi.fn();
 const gl={getExtension:()=>({TIME_ELAPSED_EXT:1,GPU_DISJOINT_EXT:2}),isContextLost:()=>false,getParameter:()=>disjoint,createQuery:()=>({}),beginQuery,endQuery,deleteQuery,QUERY_RESULT_AVAILABLE:3,QUERY_RESULT:4,getQueryParameter:(_q:unknown,key:number)=>key===3?ready:2_000_000};
 return{timer:new GpuTimer(gl as unknown as WebGL2RenderingContext),beginQuery,endQuery,deleteQuery,setDisjoint(value:boolean){disjoint=value;},setReady(value:boolean){ready=value;}};
}
it('reads completed elapsed queries asynchronously and discards disjoint windows without starting another query',()=>{
 const s=setup();s.timer.begin();s.timer.end();expect(s.timer.diagnostics.pending).toBe(1);
 s.setDisjoint(true);s.timer.begin();s.timer.end();expect(s.beginQuery).toHaveBeenCalledTimes(1);expect(s.deleteQuery).toHaveBeenCalledTimes(1);expect(s.timer.diagnostics.samplesMs).toEqual([]);
 s.setDisjoint(false);s.timer.begin();s.timer.end();s.setReady(true);s.timer.begin();s.timer.end();expect(s.timer.diagnostics.samplesMs).toEqual([2]);s.timer.dispose();expect(s.timer.diagnostics.pending).toBe(0);
});
it('bounds pending queries without polling in a loop or waiting for GPU completion',()=>{
 const s=setup();for(let i=0;i<40;i++){s.timer.begin();s.timer.end();}expect(s.beginQuery).toHaveBeenCalledTimes(32);expect(s.timer.diagnostics).toMatchObject({pending:32,dropped:8});s.timer.dispose();expect(s.deleteQuery).toHaveBeenCalledTimes(32);
});
