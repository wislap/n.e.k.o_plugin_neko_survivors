import { parentPort, workerData } from 'node:worker_threads';
import { SimulationHost } from '../../src/simulation/host.ts';
import { createGameSession, EMPTY_INPUT } from '../../src/game/index.ts';
if (workerData?.reference) {
  parentPort.on('message', message => {
    const game = createGameSession(message.options);
    game.setViewport(1920,1080);
    const outputs=game.drainEvents().map(event=>({event,step:0,commandId:1}));game.readUi();
    game.dispatch(message.command);
    for(const event of game.drainEvents())outputs.push({event,step:0,commandId:2,...(['checkpoint','run-ended'].includes(event.type)?{progress:structuredClone({run:game.exportSave(),meta:game.getMeta()})}:{})});game.readUi();
    for(let step=1;step<=message.steps;step++){for(const event of game.advance(EMPTY_INPUT).events)outputs.push({event,step,...(['checkpoint','run-ended'].includes(event.type)?{progress:structuredClone({run:game.exportSave(),meta:game.getMeta()})}:{})});game.readUi();}
    parentPort.postMessage({ui:game.readUi(),progress:{run:game.exportSave(),meta:game.getMeta()},frame:game.readFrame(),outputs});
  });
} else {
  const host = new SimulationHost((message,transfer)=>parentPort.postMessage(message,transfer));
  parentPort.on('message',message=>host.receive(message));
}
