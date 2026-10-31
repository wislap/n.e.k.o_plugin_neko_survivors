import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = pathToFileURL(resolve(import.meta.dirname, '../../src/audio/audio-player.ts')).href;
function probe(control: boolean) {
  const source = String.raw`
    import { AudioSystem } from ${JSON.stringify(moduleUrl)};
    const unhandled = [];
    process.on('unhandledRejection', error => unhandled.push({name:error.name,message:error.message}));
    const abort = () => Object.assign(new Error('The play() request was interrupted by a call to pause()'), {name:'AbortError'});
    class Media extends EventTarget {
      static created=[]; pending=[]; paused=true; ended=false; currentTime=0; volume=1; dataset={}; _src='';
      constructor(src='') { super(); this.src=src; Media.created.push(this); }
      set src(value) { this.cancel(); this._src=value; } get src(){return this._src;}
      get currentSrc(){return this.src;}
      cancel(){for(const reject of this.pending)reject(abort());this.pending=[];}
      play(){this.paused=false;return new Promise((resolve,reject)=>this.pending.push(reject));}
      pause(){this.paused=true;this.cancel();} load(){this.cancel();}
      removeAttribute(name){if(name==='src')this.src='';} cloneNode(){return new Media(this.src);}
    }
    class Context {
      state='running';currentTime=1;sampleRate=10;
      createGain(){return {gain:{value:1},connect(){},disconnect(){}};}
      createBuffer(channels,length){return {getChannelData:()=>new Float32Array(length)};}
      decodeAudioData(){return Promise.resolve({});} close(){this.state='closed';return Promise.resolve();}
    }
    globalThis.window={AudioContext:Context,Audio:Media,addEventListener(){},removeEventListener(){}};
    globalThis.Audio=Media;
    if (${control}) Promise.reject(abort());
    else for(let i=0;i<5;i++){
      const output=new AudioSystem();if(!output.init())throw Error('probe initialization failed');
      output.unlock(); output.applyMusicCue({scene:'title'}); output.play('flandreShot'); output.play('vergil_atk');
      output.applyMusicCue({scene:'stage',wave:1}); output.applyMusicCue({scene:'result'}); output.applyMusicCue({scene:'title'});
      output.applyMusicCue({type:'music',scene:'boss',track:'halloween'}); output.applyMusicCue({stop:true});
      output.applyMusicCue({scene:'title'}); output.dispose(); output.dispose();
    }
    await new Promise(resolve=>setTimeout(resolve,20));
    console.log(JSON.stringify({unhandled,media:Media.created.length,allPaused:Media.created.every(element=>element.paused)}));
  `;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', source], { encoding: 'utf8', timeout: 5000 })) as {
    unhandled: { name: string; message: string }[]; media: number; allPaused: boolean;
  };
}

describe('native promise rejection observation at public audio lifecycle boundary', () => {
  it('detects a genuinely unhandled aborted play promise in the isolated observer', () => {
    expect(probe(true).unhandled).toEqual([{ name: 'AbortError', message: 'The play() request was interrupted by a call to pause()' }]);
  });
  it('handles pending music and sound cancellation across switching, stopping and repeated disposal', () => {
    const result = probe(false);
    expect(result.media).toBeGreaterThan(10); expect(result.allPaused).toBe(true); expect(result.unhandled).toEqual([]);
  });
});
