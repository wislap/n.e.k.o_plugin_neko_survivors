/** Build only QA fixtures; call npm run build:profile first for the real application. */
import {build} from 'vite';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const out=path.resolve(process.argv.find(a=>a.startsWith('--out='))?.slice(6)||'test-results/gpu-benchmark-20261029');
if(!out.startsWith(path.resolve('test-results')+path.sep))throw Error('QA output must be inside frontend/test-results');
const controlledOnly=process.argv.includes('--controlled-only');
const fixture=controlledOnly?null:JSON.parse(await readFile(path.join(out,'natural-wave50.json'),'utf8'));
if(!controlledOnly)await readFile('test-results/profile-build/index.html');
await mkdir(out,{recursive:true});
await writeFile(path.join(out,'probe.html'),'<!doctype html><meta charset="utf-8"><title>Dedicated local benchmark</title>Local benchmark launch target');
await build({configFile:false,publicDir:false,base:'/bench/',build:{outDir:path.join(out,'site'),emptyOutDir:true,sourcemap:true,rollupOptions:{input:'tests/e2e/stress-benchmark.html'},minify:true}});
if(!controlledOnly)await build({configFile:false,publicDir:false,build:{outDir:path.join(out,'tools'),emptyOutDir:true,sourcemap:true,lib:{entry:'tests/e2e/benchmark-tools.mjs',formats:['es'],fileName:'benchmark-tools'},minify:true}});
const source=createHash('sha256'),files=[];
async function visit(dir,record){
  for(const entry of(await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const file=path.join(dir,entry.name);if(entry.isDirectory()){await visit(file,record);continue;}
    const bytes=await readFile(file);
    if(record)files.push({path:path.resolve(file),sha256:createHash('sha256').update(bytes).digest('hex')});
    else source.update(file).update('\0').update(bytes).update('\0');
  }
}
await visit('src',false);
for(const dir of (controlledOnly?[path.join(out,'site')]:[path.join(out,'site'),path.join(out,'tools'),'test-results/profile-build']))await visit(dir,true);
const manifest={generatedAt:new Date().toISOString(),communityBaseCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),originalCommit:execFileSync('git',['-C','../../neko_survivors','rev-parse','HEAD'],{encoding:'utf8'}).trim(),srcSha256:source.digest('hex'),lockSha256:createHash('sha256').update(await readFile('package-lock.json')).digest('hex'),controlledOnly,fixture:fixture?.metadata??null,files};
await writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
