import { SimulationHost } from './host.ts';
import type { WorkerInput, WorkerOutput } from './protocol.ts';
// Use a narrow worker surface rather than mixing DOM and WebWorker lib globals.
const scope = globalThis as unknown as {
  postMessage(message: WorkerOutput, transfer?: ArrayBuffer[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerInput>) => void): void;
};
const host = new SimulationHost((message, transfer) => scope.postMessage(message, transfer));
scope.addEventListener('message', event => host.receive(event.data));
