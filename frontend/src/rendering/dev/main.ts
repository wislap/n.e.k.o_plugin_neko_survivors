import { DESKTOP_PRESENTATION } from '../../presentation/profile';
/** Vite-only fault/visual inspection. Absent from the production entry graph. */
import { GameRenderer } from '../index';
import { createRenderer } from '../create-renderer';
import { ContextProbe, FiniteFixtureLoop } from './context-probe';
import { visualExpectation } from './expectations';
import { VISUAL_SCENES, visualFixture, type VisualScene } from './visual-fixtures';
declare global {
  interface Window {
    __NEKO_VISUAL_HARNESS__?: {
      setScene(scene: VisualScene): void; setStage(stage: number): void; step(time: number): void;
      loseContext(): void; restoreContext(): void; runFiniteLoop(): void; diagnostics(): unknown; dispose(): void;
    };
  }
}
const container = document.querySelector<HTMLElement>('#stage')!;
const selector = document.querySelector<HTMLSelectElement>('#scene')!;
const output = document.querySelector<HTMLOutputElement>('#diagnostics')!;
const backend = document.querySelector<HTMLElement>('#backend')!;
const loseButton = document.querySelector<HTMLButtonElement>('#lose-context')!;
const restoreButton = document.querySelector<HTMLButtonElement>('#restore-context')!;
const loopButton = document.querySelector<HTMLButtonElement>('#fixture-loop')!;
const contextStatus = document.querySelector<HTMLElement>('#context-status')!;
const params = new URLSearchParams(location.search);
const presentation = params.get('platform') === 'mobile'
  ? Object.freeze({ mobile: true, resolution: 1, displayFps: 30 }) : DESKTOP_PRESENTATION;
if (presentation.mobile) document.querySelector('#warning')!.textContent += ' · 手机显示档位（非真机）';
let scene = (VISUAL_SCENES as readonly string[]).includes(params.get('scene') ?? '') ? params.get('scene') as VisualScene : 'battle-overlay';
let stage = Number(params.get('stage') ?? 0) || 0;
for (const key of VISUAL_SCENES) { const option = document.createElement('option'); option.value = key; option.textContent = key; selector.appendChild(option); }
selector.value = scene;
async function mount() {
  // Only this development module retains native backend handles for fault injection.
  const device = await createRenderer({ resolution: presentation.resolution, width: container.clientWidth, height: container.clientHeight });
  let renderer: GameRenderer;
  try { renderer = new GameRenderer(device, { container, presentation, assetBaseUrl: '/assets' }); }
  catch (error) { device.renderer.destroy(true); throw error; }
  backend.textContent = `${renderer.backend} · 仅显示验证`;
  const events = new AbortController(), probe = new ContextProbe(), loop = new FiniteFixtureLoop(VISUAL_SCENES.length * 2);
  const sampledTime = Number(params.get('time'));
  const fixedTime = params.has('time') && Number.isFinite(sampledTime) && sampledTime >= 0;
  let time = fixedTime ? sampledTime : 0, previous = performance.now(), paused = fixedTime, disposed = false, lastReport = -1, raf = 0;
  if (fixedTime) document.querySelector<HTMLButtonElement>('#pause')!.textContent = '恢复动画';
  const contextExtension = device.canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context') ?? null;
  loseButton.disabled = !contextExtension;
  const snapshot = () => ({ fixture: true, scene, stage, presentation, contextProbe: { state: probe.state, records: [...probe.records] },
    finiteLoop: { running: loop.running, completed: loop.completed, total: loop.total, dwellMs: loop.dwellMs },
    expectation: visualExpectation(scene), ...renderer.diagnostics });
  function report() {
    const diagnostic = renderer.diagnostics; probe.observe(diagnostic);
    restoreButton.disabled = !renderer.contextLost;
    loseButton.disabled = renderer.contextLost || !contextExtension;
    const status = probe.state === 'regenerated' ? '恢复完成，弹纹理已重新生成' : probe.state === 'restored-awaiting-textures' ? '已恢复；选择 Boss 场景验证弹纹理再生' : renderer.contextLost ? '上下文已丢失，等待恢复' : '上下文正常';
    contextStatus.textContent = status; contextStatus.dataset.probeState = probe.state;
    document.body.dataset.contextLost = String(renderer.contextLost); document.body.dataset.recoveries = String(diagnostic.recoveries);
    output.textContent = JSON.stringify(snapshot(), null, 1);
    loopButton.textContent = loop.running ? `停止长跑（${loop.completed}/${loop.total}）` : `有限长跑（${loop.total}场）`;
  }
  const render = () => { renderer.render(visualFixture(scene, time, stage)); document.body.dataset.scene = scene; document.body.dataset.stage = String(stage); };
  function loseContext() {
    if (disposed || renderer.contextLost) return;
    if (!contextExtension) { contextStatus.textContent = 'WEBGL_lose_context 扩展不可用'; return; }
    probe.request(renderer.diagnostics);
    contextExtension!.loseContext();
    report();
  }
  function restoreContext() {
    if (disposed || !renderer.contextLost || !contextExtension) return;
    probe.record('restore-requested', renderer.diagnostics); contextExtension.restoreContext(); report();
  }
  function runFiniteLoop() {
    if (loop.running) loop.stop(); else { paused = false; loop.start(performance.now()); probe.record('finite-loop-start', renderer.diagnostics); }
    report();
  }
  device.canvas.addEventListener('webglcontextlost', () => { probe.nativeLoss(renderer.diagnostics); report(); }, { signal: events.signal });
  device.canvas.addEventListener('webglcontextrestored', () => { probe.record('native-context-restored', renderer.diagnostics); render(); report(); }, { signal: events.signal });
  const observer = new ResizeObserver(() => { renderer.resize(container.clientWidth, container.clientHeight); render(); }); observer.observe(container);
  selector.addEventListener('change', () => { loop.stop(); scene = selector.value as VisualScene; stage = 0; time = 0; render(); report(); }, { signal: events.signal });
  document.querySelector('#opacity')!.addEventListener('input', event => { renderer.setPlayerEffectOpacity(Number((event.target as HTMLInputElement).value) / 100); render(); }, { signal: events.signal });
  document.querySelector('#stage-next')!.addEventListener('click', () => { stage++; time = 0; render(); report(); }, { signal: events.signal });
  document.querySelector('#pause')!.addEventListener('click', event => { paused = !paused; (event.currentTarget as HTMLButtonElement).textContent = paused ? '恢复动画' : '暂停动画'; }, { signal: events.signal });
  loseButton.addEventListener('click', loseContext, { signal: events.signal }); restoreButton.addEventListener('click', restoreContext, { signal: events.signal }); loopButton.addEventListener('click', runFiniteLoop, { signal: events.signal });
  function frame(now: number) {
    if (disposed) return;
    const running = loop.running, index = renderer.contextLost ? undefined : loop.advance(now);
    if (index !== undefined) { scene = VISUAL_SCENES[index % VISUAL_SCENES.length]; selector.value = scene; stage = Math.floor(index / VISUAL_SCENES.length); time = 0; probe.record(`finite-loop-step:${index}:${scene}`, renderer.diagnostics); }
    if (running && !loop.running) probe.record('finite-loop-completed', renderer.diagnostics);
    if (!paused) time += Math.min(.1, (now - previous) / 1000);
    previous = now; render();
    if (now - lastReport > 500) { lastReport = now; report(); }
    raf = requestAnimationFrame(frame);
  }
  function dispose() {
    if (disposed) return; disposed = true; cancelAnimationFrame(raf); loop.stop(); events.abort(); observer.disconnect(); renderer.dispose(); delete window.__NEKO_VISUAL_HARNESS__;
  }
  window.__NEKO_VISUAL_HARNESS__ = { setScene(value) { loop.stop(); scene = value; selector.value = value; stage = 0; time = 0; render(); report(); }, setStage(value) { stage = value; render(); report(); }, step(value) { paused = true; time = value; render(); report(); }, loseContext, restoreContext, runFiniteLoop, diagnostics: snapshot, dispose };
  addEventListener('pagehide', dispose, { signal: events.signal }); import.meta.hot?.dispose(dispose);
  render(); report(); raf = requestAnimationFrame(frame);
}
void mount().catch(error => { backend.textContent = 'GPU 初始化失败'; output.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error); });
