export const DISPLAY_BODY_STRIDE=16;
/** Final GPU bases only. Ring-backed rules and linear canonical snapshots share
 * this writer, including active orb history selection and phase folding. */
export function writeDisplayBody(target:Float32Array,out:number,style:number,x:number,y:number,radius:number,angle:number,age:number,alpha:number,appearance:number,length:number,history:Float64Array,start:number,ring=false):number {
 target[out]=x;target[out+1]=y;target[out+2]=angle;target[out+3]=age*(style===1?8:style===2?5:style===3?40:0)%(Math.PI*2);
 target[out+4]=alpha;target[out+6]=radius;target[out+7]=appearance;target.fill(0,out+8,out+16);
 let count=length;
 if(style===2){count=0;for(let j=0;j<length;j++){const k=ring?(start+j*3)%18:start+j*3;if(history[k+2]>0)count++;}
  count=count>1?Math.min(4,count):0;let taken=0;
  for(let j=length-1;j>=0&&taken<count;j--){const k=ring?(start+j*3)%18:start+j*3;if(history[k+2]<=0)continue;target[out+8+taken*2]=history[k];target[out+9+taken*2]=history[k+1];taken++;}
 }
 target[out+5]=count;return style===0?2:style===1?3+Number(count>0):style===2?5+count:4;
}
