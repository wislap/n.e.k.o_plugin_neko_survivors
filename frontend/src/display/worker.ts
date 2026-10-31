import { configureWorkerRendering } from '../rendering/worker-environment';
import { createOffscreenRenderer, type GameRenderer } from '../rendering/game-renderer';
import { decodeFrame, frameBuffers, transfers } from '../simulation/frame-packet';
import type { WorkerInput,WorkerOutput,SimulationStats,SimulationDisplayOutput } from '../simulation/protocol';
import { createFrameCapture } from '../diagnostics/frame-capture';
import { createDisplayLoop } from './loop';
import type { RenderInput,RenderOutput,RenderStatus } from './protocol';
// RAF, message events and close have the same callable surface in this realm.
const scope=globalThis;
configureWorkerRendering();
let renderer:GameRenderer<OffscreenCanvas>|undefined,port:MessagePort|undefined;
type Packet=Extract<WorkerOutput,{kind:'frame'}>;
let requesting=false;
let front:Packet|undefined,pending:Packet|undefined,revision=0,renderedFrames=0,epoch=0,visible=true,failed=false,lastStatus=0;
let status:RenderStatus|undefined,rafMs=0,intervalMs=16.667,adoptedAt=0;
const capture=createFrameCapture();
let captureInterpolation:{frames:number;changedFrames:number}|undefined;
let captureStats:SimulationStats|undefined,samples:NonNullable<import('../diagnostics/frame-capture').FrameCapture['worker']>['samples']=[];
function send(message:RenderOutput){scope.postMessage(message);}
function release(packet?:Packet){if(!packet||!port)return;const buffers=frameBuffers(packet.packet);port.postMessage({kind:'recycle',slot:packet.slot,lease:packet.lease,buffers} satisfies WorkerInput,transfers(buffers));}
function dispose(){loop.stop();release(pending);release(front);pending=front=undefined;port?.close();renderer?.dispose();renderer=undefined;}
function fail(error:unknown){if(failed)return;failed=true;try{dispose();}finally{send({kind:'failure',message:error instanceof Error?error.message:String(error)});}}
const loop=createDisplayLoop({driver:{request:cb=>scope.requestAnimationFrame(cb),cancel:id=>scope.cancelAnimationFrame(id)},
 onFrame:timestamp=>{rafMs=timestamp;capture.beginFrame(timestamp);},onError:fail,render(){
 if(!renderer||!port||!visible)return;
 if(pending){if(front&&(pending.stateAt-front.stateAt>50||pending.stateAt<=front.stateAt))renderer.resetInterpolation();intervalMs=front?Math.max(1,Math.min(50,pending.stateAt-front.stateAt)):16.667;release(front);front=pending;pending=undefined;revision++;adoptedAt=performance.now();}
 if(!requesting){requesting=true;port.postMessage({kind:'frame',afterStep:front?.step??-1,afterStateAt:front?.stateAt??0} satisfies WorkerInput);}
 if(!front)return;
 const start=performance.now(),snapshot=front.packet.compact,canonical=snapshot?undefined:decodeFrame(front.packet),scene=snapshot?.scene??canonical!;
 const alpha=scene.combat?Math.max(0,Math.min(1,(start-adoptedAt)/intervalMs)):1;
 if(snapshot)renderer.renderSnapshot(snapshot,start,revision,alpha);else renderer.renderInterpolated(canonical!,start,revision,alpha);renderedFrames++;
 const end=performance.now();capture.record('renderSubmit',start,end);
 const counts={actors:scene.actors.length,projectiles:scene.projectiles.length+(snapshot?snapshot.bodies.counts.reduce((a,b)=>a+b,0):(canonical?.transients?.playerCount??0))+(snapshot?.transients.enemyCount??canonical?.transients?.enemyCount??0),
  effects:scene.effects.length,pickups:scene.pickups.length+(snapshot?.transients.pickupCount??canonical?.transients?.pickupCount??0)};
 if(capture.running){if(samples.length<60000)samples.push({receivedAt:performance.timeOrigin+end,frameAgeMs:Math.max(0,performance.timeOrigin+end-front.stateAt),packetAgeMs:Math.max(0,performance.timeOrigin+end-front.producedAt),stats:front.stats,step:front.step,rafMs});else capture.finish('worker-sample-limit');}
 capture.frame({phase:scene.phase,wave:scene.hudChrome?.wave??0,combat:scene.combat&&!renderer.contextLost,...counts});
 if(end-lastStatus>=16||!status||status.frame.phase!==scene.phase){
  status={viewCamera:renderer.viewCamera,frame:{camera:scene.camera,tick:scene.tick,phase:scene.phase,combat:scene.combat,hud:scene.hud,hudChrome:scene.hudChrome},counts,
   diagnostics:renderer.diagnostics,revision,step:front.step,stateAt:front.stateAt,producedAt:front.producedAt,renderedFrames,stats:front.stats};
  lastStatus=end;send({kind:'status',status});
 }
}});
async function receive(message:RenderInput){
 try{switch(message.kind){
 case'initialize':
  if(renderer||port)throw new Error('Display is already initialized');
  renderer=await createOffscreenRenderer({...message,interpolation:true});port=message.port;
  port.onmessage=(event:MessageEvent<SimulationDisplayOutput>)=>{const value=event.data;if(value.kind==='fatal'){fail(new Error(value.message));return;}if(value.kind==='epoch'){requesting=false;release(pending);release(front);pending=front=undefined;epoch=value.epoch;renderer?.resetInterpolation();capture.discontinuity('simulation-epoch');return;}if(value.kind!=='frame')return;requesting=false;
   if(value.epoch<epoch){release(value);return;}if(value.epoch>epoch){release(pending);release(front);pending=front=undefined;epoch=value.epoch;renderer?.resetInterpolation();capture.discontinuity('simulation-epoch');}
   release(pending);pending=value;
  };port.onmessageerror=()=>fail(new Error('Display packet could not be decoded'));port.start();
  loop.start();send({kind:'ready',diagnostics:renderer.diagnostics});break;
 case'resize':renderer?.resize(message.width,message.height);renderer?.resetInterpolation();break;
 case'opacity':renderer?.setPlayerEffectOpacity(message.value);break;
 case'soft-quality':renderer?.setPlayerSoftQuality(message.value);break;
 case'visible':visible=message.visible;capture.discontinuity('visibility');if(visible)loop.start();else loop.stop();break;
 case'gpu-timing':renderer?.setGpuTiming(message.enabled);break;
 case'capture-start':captureInterpolation=renderer?.diagnostics.interpolation;captureStats=message.stats;samples=[];capture.start({...message.context,renderer:renderer?.diagnostics,threadModel:'simulation-worker/render-worker',timeOriginEpochMs:performance.timeOrigin});send({kind:'receipt',id:message.id});break;
 case'capture-stop':{const value=capture.stop();value.gpuExecution=renderer?.diagnostics.gpuTiming;const last=renderer?.diagnostics.interpolation;if(last&&captureInterpolation)value.interpolation={...last,frames:last.frames-captureInterpolation.frames,changedFrames:last.changedFrames-captureInterpolation.changedFrames};if(captureStats&&front)value.worker={start:captureStats,end:front.stats,samples,note:'Samples describe actual Render Worker RAF callbacks; Sim markers are measured independently.'};send({kind:'receipt',id:message.id,capture:value});break;}
 case'probe-context':renderer?.probeContext(message.lost);break;
 case'dispose':dispose();scope.close();break;
 }}catch(error){if('id'in message)send({kind:'receipt',id:message.id,error:error instanceof Error?error.message:String(error)});else fail(error);}
}
scope.addEventListener('message',event=>{void receive(event.data);});
