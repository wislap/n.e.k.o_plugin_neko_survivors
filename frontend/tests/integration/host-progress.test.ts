import { convertLegacyProgress } from '../../src/game';
import { readEffectOpacity } from '../../src/app/audio-settings';
import { describe, expect, it } from 'vitest';
import { createSaveRepository, type StoragePort } from '../../src/storage';
function memory() {
  const values = new Map<string,string>();
  const writes: string[]=[];
  const storage: StoragePort={getItem:key=>values.get(key)??null,setItem:(key,value)=>{writes.push(key);values.set(key,value);},removeItem:key=>{values.delete(key);}};
  values.set('neko_miao_save_v1',JSON.stringify({wave:3})); values.set('neko_miao_meta_v1',JSON.stringify({wins:9}));
  return {values,writes,storage,repository:createSaveRepository(storage)};
}
describe('legacy run and meta transaction',()=>{
  it('moves old effect opacity into settings during the same explicit commit',()=>{
    const {repository,values}=memory();
    values.delete('neko_miao_save_v1');values.set('neko_miao_meta_v1',JSON.stringify({wins:9,fxAlpha:35}));
    repository.writeSettings({music:.2,enabled:false});
    expect(readEffectOpacity({fxAlpha:35})).toBe(1);
    const result=repository.importLegacyProgress(convertLegacyProgress);
    expect(result.ok).toBe(true);
    expect(repository.read('settings')).toEqual({ok:true,value:{music:.2,enabled:false,playerEffectOpacity:.35}});
    const meta=repository.read('meta');expect(meta.ok && meta.value).not.toHaveProperty('fxAlpha');
    expect(JSON.parse(values.get('neko_miao_meta_v1')!)).toEqual({wins:9,fxAlpha:35});
  });
  it('preserves a current opacity choice when importing old growth',()=>{
    const {repository,values}=memory();
    values.delete('neko_miao_save_v1');values.set('neko_miao_meta_v1',JSON.stringify({wins:9,fxAlpha:35}));
    repository.writeSettings({music:.2,playerEffectOpacity:.8});
    expect(repository.importLegacyProgress(convertLegacyProgress).ok).toBe(true);
    expect(repository.read('settings')).toEqual({ok:true,value:{music:.2,playerEffectOpacity:.8}});
  });
  it('rolls back progress and preserves old settings when the presentation migration cannot be written',()=>{
    const {repository,values,storage}=memory();
    values.delete('neko_miao_save_v1');values.set('neko_miao_meta_v1',JSON.stringify({wins:9,fxAlpha:0}));
    repository.writeSettings({music:.2});const before=new Map(values),write=storage.setItem;
    storage.setItem=(key,value)=>{if(key.includes(':settings:'))throw new Error('quota');write(key,value);};
    expect(repository.importLegacyProgress(convertLegacyProgress)).toMatchObject({ok:false,error:'write_failed'});
    expect(values).toEqual(before);
  });
  it('migrates the previous community namespace only through explicit import and preserves its bytes',()=>{
    const {repository,values}=memory();
    const oldRun=JSON.stringify({format:'neko-survivors-react',version:1,run:{wave:4}}), oldMeta=JSON.stringify({wins:5});
    values.set('neko_survivors_react:run:v1',oldRun);values.set('neko_survivors_react:meta:v1',oldMeta);
    expect(repository.read('run')).toEqual({ok:true,value:null});
    expect(repository.importLegacyProgress(source=>source)).toEqual({ok:true,value:{run:JSON.parse(oldRun),meta:{wins:5}}});
    expect(repository.read('run')).toEqual({ok:true,value:JSON.parse(oldRun)});
    expect(values.get('neko_survivors_react:run:v1')).toBe(oldRun);expect(values.get('neko_survivors_react:meta:v1')).toBe(oldMeta);
  });
  it('migrates run and growth together after unified validation, preserving all old bytes',()=>{
    const {repository,values}=memory(); const before = new Map(values);
    const result=repository.importLegacyProgress(({run,meta})=>({run:{validated:run},meta:{validated:meta}}));
    expect(result.ok).toBe(true);
    expect(repository.read('run')).toEqual({ok:true,value:{validated:{wave:3}}});
    expect(repository.read('meta')).toEqual({ok:true,value:{validated:{wins:9}}});
    for(const [key,value] of before)expect(values.get(key)).toBe(value);
  });
  it('performs no writes when either record fails the common migration callback',()=>{
    const {repository,writes}=memory();
    expect(repository.importLegacyProgress(()=>null)).toMatchObject({ok:false,error:'invalid'});expect(writes).toEqual([]);
  });
  it('rolls back the first new key when quota rejects the second write',()=>{
    const {repository,storage,values}=memory();const write=storage.setItem;
    storage.setItem=(key,value)=>{if(key.includes(':meta:'))throw new Error('QuotaExceededError');write(key,value);};
    expect(repository.importLegacyProgress(source=>source)).toMatchObject({ok:false,error:'write_failed'});
    expect(values.has('neko_survivors_react:run:v2')).toBe(false);expect(values.has('neko_survivors_react:meta:v2')).toBe(false);
    expect(values.has('neko_miao_save_v1')).toBe(true);expect(values.has('neko_miao_meta_v1')).toBe(true);
  });
  it('imports growth-only players without fabricating a new run',()=>{
    const {repository,values}=memory(); values.delete('neko_miao_save_v1');
    expect(repository.importLegacyProgress(source=>source)).toEqual({ok:true,value:{run:null,meta:{wins:9}}});
    expect(repository.read('run')).toEqual({ok:true,value:null});expect(repository.read('meta')).toEqual({ok:true,value:{wins:9}});
  });
  it('does not overwrite any existing new progress',()=>{
    const {repository,writes,storage}=memory();storage.setItem('neko_survivors_react:meta:v2',JSON.stringify({wins:1}));const count=writes.length;
    expect(repository.importLegacyProgress(()=>{throw new Error('must not be called');})).toEqual({ok:true,value:null});
    expect(writes.length).toBe(count);expect(repository.read('meta')).toEqual({ok:true,value:{wins:1}});
  });
  it('pre-encodes both records so a cyclic meta cannot leave a half-imported run',()=>{
    const {repository,writes}=memory();const circular:{cycle?:unknown}={};circular.cycle=circular;
    expect(repository.importLegacyProgress(()=>({run:{valid:true},meta:circular}))).toMatchObject({ok:false,error:'invalid'});expect(writes).toEqual([]);
  });
  it('keeps audio settings separate from run and growth and never imports legacy settings',()=>{
    const {repository}=memory();repository.writeSettings({enabled:false,music:.2});
    expect(repository.read('meta')).toEqual({ok:true,value:null});expect(repository.read('settings')).toEqual({ok:true,value:{enabled:false,music:.2}});
    const settings = repository.read('settings');
    repository.importLegacyProgress(source=>source);
    expect(repository.read('settings')).toEqual(settings);
  });
});

describe('current progress transaction',()=>{
  it('commits run and growth together without touching any legacy keys',()=>{
    const {repository,values}=memory();const oldLegacy=new Map(values);
    expect(repository.writeProgress({run:{wave:10},meta:{wins:20}})).toEqual({ok:true,value:undefined});
    expect(repository.read('run')).toEqual({ok:true,value:{wave:10}});expect(repository.read('meta')).toEqual({ok:true,value:{wins:20}});
    for(const[key,value]of oldLegacy)expect(values.get(key)).toBe(value);
  });
  it('restores both prior new values when the second write hits quota',()=>{
    const {repository,storage,values}=memory();repository.writeProgress({run:{wave:2},meta:{wins:1}});
    const previous=new Map(values),write=storage.setItem;
    storage.setItem=(key,value)=>{if(key.includes(':meta:'))throw new Error('quota');write(key,value);};
    expect(repository.writeProgress({run:{wave:9},meta:{wins:99}})).toMatchObject({ok:false,error:'write_failed'});
    expect(values).toEqual(previous);
  });
  it('restores a prior active run if removing it succeeded but the growth update failed',()=>{
    const{repository,storage,values}=memory();repository.writeProgress({run:{wave:2},meta:{wins:1}});
    const previous=new Map(values),write=storage.setItem;
    storage.setItem=(key,value)=>{if(key.includes(':meta:'))throw new Error('quota');write(key,value);};
    expect(repository.writeProgress({run:null,meta:{wins:2}})).toMatchObject({ok:false,error:'write_failed'});expect(values).toEqual(previous);
  });
});
