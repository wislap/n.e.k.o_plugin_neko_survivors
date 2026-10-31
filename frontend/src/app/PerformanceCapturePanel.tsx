import type {PlayerSoftQuality}from '../presentation/profile';
import { useEffect, useState } from 'react';
import type { GameRuntime } from './runtime';

/** Explicit QA mode only. No interval, live JSON rendering or per-frame React subscription. */
export function PerformanceCapturePanel({ runtime,softQuality='native' }: { runtime: GameRuntime;softQuality?:PlayerSoftQuality }) {
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [gpuTiming,setGpuTiming]=useState(false);
  const [message, setMessage] = useState('先进入目标场景并预热，再开始采集。');
  const [download, setDownload] = useState<{ url: string; name: string; json: string } | null>(null);
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url); }, [download]);
  async function start() {
    setPending(true);
    try { await runtime.startPerformanceCapture(); setRecording(true); setDownload(null); setMessage('采集已启动：最多90秒；缓冲满时停止。完成后点击导出。'); }
    catch (error) { setMessage(String(error)); }
    finally { setPending(false); }
  }
  async function prepareDownload() {
    setPending(true);
    try {
      const result = await runtime.stopPerformanceCapture();
      const json = JSON.stringify(result);
      setDownload({ url: URL.createObjectURL(new Blob([json], { type: 'application/json' })), name: `neko-capture-${Date.now()}.json`, json });
      setRecording(false); setMessage(`已准备${result.frames.length}帧，结束原因：${result.stopReason}。`);
    } catch (error) { setMessage(String(error)); }
    finally { setPending(false); }
  }
  return <aside className="runtime-diagnostics" aria-label="性能采集">
    <strong>性能采集 · RAF/CPU，GPU计时可选</strong>
    <p>{message}</p>
    <label>模拟倍速 <select aria-label="模拟倍速" value={speed} disabled={pending || recording} onChange={async event => {
      const value = Number(event.target.value); setPending(true);
      try { if (await runtime.setSimulationSpeed(value)) setSpeed(value); else setMessage('倍率设置失败'); }
      finally { setPending(false); }
    }}>{[1, 2, 4, 8].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
    <p>倍速增加规则步数；绘制按显示频率请求最新状态。实际倍率和帧龄见运行诊断及采集文件。</p>
    <label>柔光质量 <select aria-label="柔光质量" value={softQuality} disabled={pending||recording} onChange={event=>{const value=event.target.value as PlayerSoftQuality;runtime.setPlayerSoftQuality(value);}}>
      <option value="native">原生柔光</option><option value="balanced" disabled={runtime.presentation.mobile}>平衡柔光（桌面）</option>
    </select></label>
    <p>平衡档将光晕和拖尾外层按半分辨率绘制，主体与白色内芯保持原分辨率；柔光边缘和重叠亮度会变化。本次运行有效。</p>
    <label><input type="checkbox" checked={gpuTiming} disabled={pending||recording} onChange={event=>{runtime.setGpuTiming(event.target.checked);setGpuTiming(event.target.checked);}}/> GPU耗时诊断（增加测量开销）</label>
    <button disabled={pending || recording} onClick={start}>开始采集</button>{' '}
    <button disabled={pending || !recording} onClick={prepareDownload}>停止并准备导出</button>
    {download && <><p><a href={download.url} download={download.name}>下载采集 JSON</a></p>
      <details><summary>复制原始 JSON</summary><textarea aria-label="采集 JSON（可复制）" readOnly rows={4} value={download.json} /></details></>}
  </aside>;
}
