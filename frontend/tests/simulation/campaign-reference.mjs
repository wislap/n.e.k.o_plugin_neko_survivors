import{parentPort,workerData}from'node:worker_threads';import{createHash}from'node:crypto';
import{createGameSession,GameFrameBuffer,EMPTY_INPUT}from'../../src/game/index.ts';import{encodeFrame}from'../../src/simulation/frame-packet.ts';import{canonicalFrame}from'./canonical-frame.mjs';
const game=createGameSession(),buffer=new GameFrameBuffer({packed:true});game.setViewport(1920,1080);
const events=createHash('sha256'),frames=createHash('sha256'),uis=createHash('sha256'),saves=createHash('sha256');let step=0,eventCount=0;
for(const event of game.drainEvents()){events.update(JSON.stringify({event,step:0,commandId:1}));eventCount++;}game.readUi();game.dispatch(workerData.command);
for(const event of game.drainEvents()){events.update(JSON.stringify({event,step:0,commandId:2,...(['checkpoint','run-ended'].includes(event.type)?{progress:structuredClone({run:game.exportSave(),meta:game.getMeta()})}:{})}));eventCount++;}game.readUi();
for(;step<180000;){step++;const result=game.advance(EMPTY_INPUT);for(const event of result.events){events.update(JSON.stringify({event,step,...(['checkpoint','run-ended'].includes(event.type)?{progress:structuredClone({run:game.exportSave(),meta:game.getMeta()})}:{})}));eventCount++;}const ui=game.readUi();
 if(step%60===0){frames.update(JSON.stringify(canonicalFrame(encodeFrame(game.readFrame(buffer)))));uis.update(JSON.stringify(ui));}
 if(step%600===0)saves.update(JSON.stringify({run:game.exportSave(),meta:game.getMeta()}));
 if(ui.phase==='endless-prompt'||ui.phase==='result'&&!ui.pilot)break;
}
parentPort.postMessage({steps:step,eventCount,events:events.digest('hex'),frames:frames.digest('hex'),uis:uis.digest('hex'),saves:saves.digest('hex'),ui:game.readUi(),progress:{run:game.exportSave(),meta:game.getMeta()}});
