/** Minimal loopback CDP transport for the explicitly authorized dedicated test browser. */
export class Cdp {
  constructor(url) {
    this.next = 1; this.pending = new Map(); this.events = [];
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve,reject)=>{this.socket.addEventListener('open',resolve,{once:true});this.socket.addEventListener('error',reject,{once:true})});
    this.socket.addEventListener('message',event=>{const m=JSON.parse(String(event.data));if(m.id){const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}else {this.events.push(m);if(this.events.length>1000)this.events.shift()}});
    this.socket.addEventListener('close',()=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('CDP connection closed'))}this.pending.clear()});
  }
  async send(method,params={},sessionId){await this.ready;const id=this.next++;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error(`CDP timeout ${method}`))},30000);this.pending.set(id,{resolve,reject,timer});this.socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))})}
  async evaluate(expression,sessionId){const r=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
  close(){this.socket.close()}
}
