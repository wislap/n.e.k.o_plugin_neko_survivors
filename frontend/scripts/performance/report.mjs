import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { analyzeCapture, analyzeCpuProfile } from './analyze.ts';

const args = process.argv.slice(2), flags = new Map(), maps = [];
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (key === '--all-phases') { flags.set(key, true); continue; }
  if (!['--capture', '--cpu', '--map', '--source-root', '--out', '--wave'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: npm run profile:report -- --capture file.json [--cpu file.cpuprofile] [--map bundle.js.map] [--source-root frontend-directory] --out directory [--all-phases] [--wave 50]. CPU-only reports accept --cpu without --capture.');
  if (key === '--map') maps.push(args[++i]); else flags.set(key, args[++i]);
}
if (!flags.get('--out') || !flags.get('--capture') && !flags.get('--cpu')) throw new Error('Provide --out and --capture and/or --cpu');
const wave=flags.has('--wave')?Number(flags.get('--wave')):undefined;
if(wave!==undefined&&(!Number.isSafeInteger(wave)||wave<1||!flags.get('--capture')))throw new Error('--wave requires a positive integer and --capture');
const inputs = [];
async function jsonInput(file) {
  const bytes = await readFile(file); inputs.push({ path: path.resolve(file), sha256: createHash('sha256').update(bytes).digest('hex') });
  return JSON.parse(bytes.toString('utf8'));
}
const sourceMaps = new Map();
for (const file of maps) {
  const source = await jsonInput(file);
  // Worker maps can retain Vite's default output-relative paths when emitted to
  // a profile directory. Relocate only explicitly, and verify the exact source.
  if (flags.has('--source-root')) {
    for (let i = 0; i < source.sources.length; i++) {
      const relative = source.sources[i].replace(/^(?:\.\.\/|\.\/)+/, '');
      if (!/^(?:src|node_modules)\//.test(relative) || relative.includes('?')) continue;
      const target = path.resolve(flags.get('--source-root'), relative);
      if (source.sourcesContent?.[i] == null || await readFile(target, 'utf8') !== source.sourcesContent[i]) throw new Error(`Source content does not match map: ${target}`);
      source.sources[i] = pathToFileURL(target).href;
    }
  }
  const name = source.file ?? path.basename(file, '.map');
  if (sourceMaps.has(name)) throw new Error(`Ambiguous source map: ${name}`);
  sourceMaps.set(name, new TraceMap(source, pathToFileURL(path.resolve(file)).href));
}
let mapped = 0, unmapped = 0;
const resolve = frame => {
  const name = frame.url.split('/').at(-1)?.split('?')[0], map = sourceMaps.get(name);
  if (map && frame.lineNumber >= 0 && frame.columnNumber >= 0) {
    const original = originalPositionFor(map, { line: frame.lineNumber + 1, column: frame.columnNumber });
    if (original.source != null && original.line != null && original.column != null) {
      mapped++; return { ...frame, url: original.source.startsWith('file:') ? fileURLToPath(original.source) : original.source, functionName: original.name ?? frame.functionName, lineNumber: original.line - 1, columnNumber: original.column };
    }
  }
  if (frame.url) unmapped++;
  return frame;
};
const report = { capture: flags.get('--capture') ? analyzeCapture(await jsonInput(flags.get('--capture')), !flags.get('--all-phases'), wave) : null,
  cpu: flags.get('--cpu') ? analyzeCpuProfile(await jsonInput(flags.get('--cpu')), resolve) : null,
  inputs, sourceMapping: { mappedNodes: mapped, unmappedNodes: unmapped, verifiedSourceRoot: flags.has('--source-root') ? path.resolve(flags.get('--source-root')) : null }, alignment: 'CPU profile and frame capture are independent unless recorded in one externally synchronized trace.' };
const output = path.resolve(flags.get('--out')); await mkdir(output, { recursive: true });
if (report.capture) { await writeFile(path.join(output, 'cpu-stages.trace.json'), JSON.stringify({ traceEvents: report.capture.traceEvents })); delete report.capture.traceEvents; }
await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const escape = value => String(value ?? 'N/A').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => typeof n === 'number' ? n.toFixed(3) : 'N/A';
const table = (headers, rows) => `<table><thead><tr>${headers.map((h, i) => `<th><button type="button" data-sort="${i}">${escape(h)}</button></th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(c => `<td>${escape(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const c = report.capture, cpu = report.cpu;
const timeline = c?.timeline ?? [], max = Math.max(16.67, ...timeline.map(t => t.max ?? 0));
const firstSecond = timeline[0]?.second ?? 0, lastSecond = timeline.at(-1)?.second ?? 0;
const points = timeline.map((t, i) => `${i === 0 || t.second > timeline[i - 1].second + 1 ? 'M' : 'L'}${40 + (t.second - firstSecond) / Math.max(1, lastSecond - firstSecond) * 1080},${220 - (t.p99 ?? 0) / max * 190}`).join(' ');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NEKO 性能热点报告</title><style>body{font:15px system-ui;background:#f1f5fa;color:#17283c;max-width:1200px;margin:auto;padding:28px}h1{margin-bottom:8px}section{background:white;padding:20px;border-radius:12px;margin:18px 0;overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:9px;text-align:left;border-bottom:1px solid #dae2ef}td:last-child{overflow-wrap:anywhere}pre{white-space:pre-wrap}input{padding:8px;width:90%}th button{font:inherit;font-weight:700;border:0;background:none;color:inherit;cursor:pointer;padding:0}.note{color:#56677a}svg{width:100%;background:#f7faff}</style><h1>NEKO 性能热点报告</h1><p class="note">CPU阶段、RAF节奏与统计采样分开解释。GPU执行时间：${c?.gpuExecution?.available ? '异步elapsed query另列；不是屏幕呈现延迟' : 'N/A'}。</p>
${c ? `<section><h2>帧时间与采样范围</h2><p>筛选：${escape(c.filter)} · 记录 ${c.recordedFrames} 帧 · 有效间隔 ${c.validIntervals} · ${escape(c.stopReason)}${c.truncated ? ' · 缓冲已满，采集不完整' : ''}</p>${table(['平均RAF FPS','1% low RAF FPS','P95间隔ms','P99间隔ms','丢弃模拟秒'],[[num(c.averageRafFps),num(c.onePercentLowRafFps),num(c.intervalMs.p95),num(c.intervalMs.p99),num(c.droppedSimulationSeconds)]])}<svg viewBox="0 0 1160 250" role="img" aria-label="每秒P99帧间隔"><text x="40" y="20">每秒P99帧间隔 · 纵轴上限 ${num(max)}ms</text><path d="M40 220H1120" stroke="#9baec7"/><path fill="none" stroke="#2164c4" stroke-width="2" d="${points}"/><text x="40" y="245">${firstSecond}s</text><text x="1080" y="245">${lastSecond}s</text></svg></section><section><h2>CPU阶段（单个显示帧内各次调用累计）</h2>${table(['阶段','均值ms','P95 ms','P99 ms','最大ms'],c.stages.map(s=>[s.stage,num(s.mean),num(s.p95),num(s.p99),num(s.max)]))}</section><section><h2>最慢间隔及前一回调负载</h2><p class="note">前一回调是排查候选；GPU、调度与合成也会影响下一次RAF，不能据此认定因果。</p>${table(['帧','间隔ms','前回调跨度ms','怪/角色','弹丸','特效','掉落'],c.worstIntervals.map(f=>[f.frame,num(f.intervalMs),num(f.previousCallbackSpanMs),f.previousEntities.actors,f.previousEntities.projectiles,f.previousEntities.effects,f.previousEntities.pickups]))}</section>` : ''}
${c?.worker ? `<section><h2>模拟Worker独立窗口</h2><p class="note">${escape(c.worker.note)}</p>${table(['目标倍速','实际规则步倍率','模拟步数','显示包数','传输MiB','不同状态/秒','重复状态帧','状态年龄P99 ms','输入延迟P99 ms','容量限速游戏秒','时钟重置债务秒'],[[c.worker.targetSpeed,num(c.worker.actualSpeed),c.worker.steps,c.worker.packets,num(c.worker.bytes/1048576),num(c.worker.uniqueDisplayedStatesPerSecond),c.worker.repeatedStateFrames,num(c.worker.frameAgeMs.p99),num(c.worker.inputLatencyMs.p99),num(c.worker.unservedSeconds),num(c.worker.resetDebtSeconds)]])}</section>`:''}
${c?.uiThread ? `<section><h2>Main界面循环</h2><p class="note">界面回调频率不是游戏渲染FPS；Render使用独立窗口。</p>${table(['界面回调数','界面RAF FPS'],[[c.uiThread.recordedFrames,num(c.uiThread.averageRafFps)]])}</section>`:''}
${c?.interpolation ? `<section><h2>显示插值</h2><p class="note">插值回调不是新的规则状态；额外插值窗口不是端到端延迟。</p>${table(['绘制回调','实际插值回调','额外窗口上限ms'],[[c.interpolation.frames,c.interpolation.changedFrames,num(c.interpolation.maxDelayMs)]])}</section>`:''}
${c?.gpuExecution ? `<section><h2>异步GPU执行诊断</h2><p class="note">${escape(c.gpuExecution.note)}</p>${table(['有效样本','均值ms','P50 ms','P95 ms','disjoint','丢弃'],[[c.gpuExecution.elapsedMs.count,num(c.gpuExecution.elapsedMs.mean),num(c.gpuExecution.elapsedMs.p50),num(c.gpuExecution.elapsedMs.p95),c.gpuExecution.disjoint,c.gpuExecution.dropped]])}</section>`:''}
${cpu ? `<section><h2>CPU函数热点</h2><p class="note">独立CPU profile；本工具未验证其与帧采集的时钟对齐，请勿直接当作上方慢帧调用栈。</p><p class="note">Self是函数自身的采样时间，Inclusive包含调用链且不可相加。样本覆盖 ${num(cpu.sampledMs)}ms；未采样尾部 ${num(cpu.unsampledTailMs)}ms；映射节点 ${mapped}，未映射节点 ${unmapped}。原始负间隔 ${cpu.negativeTimeDeltas} 个，时间戳重排 ${cpu.reorderedSamples} 个样本。</p><label>筛选函数或路径 <input id="filter" placeholder="例如 collision、World、renderer"></label>${table(['函数','Self ms','Self %','Inclusive ms','位置'],cpu.functions.map(f=>[f.frame.functionName||'(anonymous)',num(f.selfMs),num(f.selfPercent),num(f.inclusiveMs),`${f.frame.url||'(native)'}:${f.frame.lineNumber+1}:${f.frame.columnNumber+1}`]))}</section>` : ''}
<section><h2>上下文与限制</h2><pre>${escape(JSON.stringify({context:c?.context??{},inputs:report.inputs},null,2))}</pre><p>${escape(report.alignment)}</p>${(c?.limitations??[]).map(t=>`<p class="note">${escape(t)}</p>`).join('')}<p class="note">${escape(cpu?.limitation??'未提供CPU profile，无法推导函数级热点。')}</p></section><script>for(const b of document.querySelectorAll('[data-sort]'))b.addEventListener('click',()=>{const body=b.closest('table').tBodies[0],index=Number(b.dataset.sort),rows=[...body.rows],direction=b.dataset.direction==='desc'?1:-1;b.dataset.direction=direction<0?'desc':'asc';rows.sort((a,c)=>{const x=a.cells[index].textContent,y=c.cells[index].textContent,nx=Number(x),ny=Number(y);return direction*(Number.isFinite(nx)&&Number.isFinite(ny)?nx-ny:x.localeCompare(y))});body.append(...rows)});document.getElementById('filter')?.addEventListener('input',e=>{const q=e.target.value.toLowerCase();for(const row of e.target.closest('section').querySelectorAll('tbody tr'))row.hidden=!row.textContent.toLowerCase().includes(q)})</script></html>`;
await writeFile(path.join(output, 'index.html'), html);
console.log(JSON.stringify({ output, frames: c?.recordedFrames ?? 0, functions: cpu?.functions.length ?? 0, mapped, unmapped }));
