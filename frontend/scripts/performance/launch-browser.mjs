/** Dedicated benchmark browser. Never reuse or copy the user's daily profile. */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const flags = new Map(process.argv.slice(2).map(value => { const [key,...rest] = value.split('='); return [key,rest.join('=')||true]; }));
const gpu = flags.get('--gpu'), input = flags.get('--url');
const platform=flags.get('--platform');
if(platform&&!['x11','wayland'].includes(platform))throw Error('--platform must be x11 or wayland');
if (!['integrated','discrete'].includes(gpu) || typeof input !== 'string') throw Error('Usage: node launch-browser.mjs --gpu=integrated|discrete --url=http://127.0.0.1:PORT/page [--uncapped]');
const url = new URL(input);
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password) throw Error('Only the explicit loopback benchmark URL is allowed');
const output = path.resolve('test-results/gpu-benchmark-20261029'); await mkdir(output,{recursive:true});
const profile = await mkdtemp(path.join(output,`chrome-${gpu}-`));
const device = gpu === 'integrated' ? {pci:'pci-0000_00_02_0',id:'8086:a780!',icd:'intel_icd.json'} : {pci:'pci-0000_03_00_0',id:'1002:7550!',icd:'radeon_icd.json'};
const args = [`--user-data-dir=${profile}`,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--no-first-run','--no-default-browser-check','--disable-background-networking','--window-size=1920,1080','--force-device-scale-factor=2','--enable-features=Vulkan','--use-angle=vulkan','--use-vulkan=native'];
if (flags.has('--uncapped')) args.push('--disable-frame-rate-limit','--disable-gpu-vsync');
if(platform)args.push(`--ozone-platform=${platform}`);
args.push(url.href);
const child = spawn('/usr/bin/google-chrome-stable',args,{env:{...process.env,DRI_PRIME:device.pci,MESA_VK_DEVICE_SELECT:device.id,VK_DRIVER_FILES:`/usr/share/vulkan/icd.d/${device.icd}`},stdio:['ignore','ignore','pipe']});
const diagnostics=[];child.stderr.on('data',chunk=>{if(diagnostics.length<100)diagnostics.push(String(chunk));});
process.on('SIGINT',()=>child.kill('SIGTERM'));process.on('SIGTERM',()=>child.kill('SIGTERM'));
let ready;
for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error(`Chrome exited ${child.exitCode}: ${diagnostics.join('').slice(-1000)}`);try{const [port,browserPath]=String(await readFile(path.join(profile,'DevToolsActivePort'))).trim().split('\n');ready={gpu,uncapped:flags.has('--uncapped'),port:Number(port),browserWebSocket:`ws://127.0.0.1:${port}${browserPath}`,profile,pid:child.pid,url:url.href,args,device};break;}catch{}await new Promise(r=>setTimeout(r,100));}
if(!ready){child.kill('SIGTERM');throw Error('Dedicated Chrome did not expose its loopback debug endpoint');}
await writeFile(path.join(profile,'benchmark-browser.json'),JSON.stringify(ready,null,2));console.log(JSON.stringify(ready));
await new Promise(resolve=>child.on('exit',resolve));
await writeFile(path.join(profile,'browser-log.txt'),diagnostics.join(''));
