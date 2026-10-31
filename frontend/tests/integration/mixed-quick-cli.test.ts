import {expect,it} from 'vitest';
import {mkdir,mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';

const cli=path.resolve('scripts/performance/mixed-quick.mjs');
it('protects the frozen build even when a new run name is supplied',async()=>{
  await mkdir('test-results',{recursive:true});
  const out=await mkdtemp(path.resolve('test-results/mixed-cli-'));
  try{
    await writeFile(path.join(out,'manifest.json'),'frozen-marker');
    expect(()=>execFileSync(process.execPath,[cli,'--out='+out,'--run-name=new-run'],{stdio:'pipe'})).toThrow(/Frozen build exists/);
    expect(await readFile(path.join(out,'manifest.json'),'utf8')).toBe('frozen-marker');
    await expect(access(path.join(out,'site'))).rejects.toMatchObject({code:'ENOENT'});
  }finally{await rm(out,{recursive:true,force:true})}
});
it('rejects unsupported quick modes and invalid poses before launching a browser',()=>{
  for(const [arg,message]of [['--backend=canvas2d','supports webgl2'],['--scenario=native','supports mixed'],['--pose=NaN','nonnegative-seconds']]){
    expect(()=>execFileSync(process.execPath,[cli,arg],{stdio:'pipe'})).toThrow(message);
  }
});
