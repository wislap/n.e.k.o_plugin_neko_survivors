interface TimerExtension { TIME_ELAPSED_EXT:number; GPU_DISJOINT_EXT:number }
/** Diagnostic-only asynchronous elapsed queries. Never wait or call finish. */
export class GpuTimer {
  private readonly extension:TimerExtension|null;
  private readonly pending:WebGLQuery[]=[];
  private active?:WebGLQuery;
  private readonly samples:number[]=[];
  private disjoint=0;private dropped=0;
  constructor(private readonly gl:WebGL2RenderingContext){this.extension=gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension|null;}
  begin():void {
    const gl=this.gl,ext=this.extension;if(!ext||gl.isContextLost())return;
    if(gl.getParameter(ext.GPU_DISJOINT_EXT)){this.disjoint++;for(const q of this.pending)gl.deleteQuery(q);this.pending.length=0;return;}
    while(this.pending.length&&gl.getQueryParameter(this.pending[0],gl.QUERY_RESULT_AVAILABLE)){
      const q=this.pending.shift()!,ns=Number(gl.getQueryParameter(q,gl.QUERY_RESULT));gl.deleteQuery(q);
      if(Number.isFinite(ns)&&ns>=0){if(this.samples.length<4096)this.samples.push(ns/1e6);else this.dropped++;}
    }
    if(this.pending.length>=32){this.dropped++;return;}
    const q=gl.createQuery();if(q){this.active=q;gl.beginQuery(ext.TIME_ELAPSED_EXT,q);}
  }
  end():void{if(!this.active)return;const q=this.active;this.active=undefined;if(this.gl.isContextLost()){this.gl.deleteQuery(q);return;}this.gl.endQuery(this.extension!.TIME_ELAPSED_EXT);this.pending.push(q);}
  get diagnostics(){return{available:!!this.extension,reason:this.extension?undefined:'EXT_disjoint_timer_query_webgl2 unavailable',samplesMs:[...this.samples],pending:this.pending.length,disjoint:this.disjoint,dropped:this.dropped};}
  dispose():void{if(this.active){if(!this.gl.isContextLost())this.gl.endQuery(this.extension!.TIME_ELAPSED_EXT);this.gl.deleteQuery(this.active);this.active=undefined;}for(const q of this.pending)this.gl.deleteQuery(q);this.pending.length=0;}
}
