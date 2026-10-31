/** Disaster sound synthesis, owned by the audio output module. */
export function playCometSound(actx: AudioContext | null, bus: GainNode | null, kind: string) {
  try {
    if (!actx || actx.state === 'closed') return;
    const now = actx.currentTime;
    if (kind === 'whoosh') {
      // 超音速呼啸：白噪声 + 带通中心频率快速上扫 200→2600Hz，0.9s
      const dur = 0.9;
      const len = Math.floor(actx.sampleRate * dur);
      const buf = actx.createBuffer(1, len, actx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = actx.createBufferSource();
      src.buffer = buf;
      const bp = actx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(220, now);
      bp.frequency.exponentialRampToValueAtTime(2600, now + dur * 0.75);
      const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.34, now + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(bp); bp.connect(g); g.connect(bus ?? actx.destination);
      src.start(now); src.stop(now + dur);
    } else if (kind === 'bolt') {
      // 火弹嘶鸣：短促下扫噪声 + 尖啸正弦，0.22s（节流由调用方管）
      const dur = 0.22;
      const len = Math.floor(actx.sampleRate * dur);
      const buf = actx.createBuffer(1, len, actx.sampleRate);
      const dd = buf.getChannelData(0);
      for (let i = 0; i < len; i++) dd[i] = Math.random() * 2 - 1;
      const src = actx.createBufferSource();
      src.buffer = buf;
      const hp = actx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 900;
      const g = actx.createGain();
      g.gain.setValueAtTime(0.12, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(hp); hp.connect(g); g.connect(bus ?? actx.destination);
      src.start(now); src.stop(now + dur);
      const o = actx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(1500, now);
      o.frequency.exponentialRampToValueAtTime(320, now + dur);
      const g2 = actx.createGain();
      g2.gain.setValueAtTime(0.07, now);
      g2.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.connect(g2); g2.connect(bus ?? actx.destination);
      o.start(now); o.stop(now + dur);
    } else if (kind === 'blast') {
      // 二次大爆的低沉砰：正弦下潜 + 短噪声，0.35s
      const dur = 0.35;
      const len = Math.floor(actx.sampleRate * dur);
      const buf = actx.createBuffer(1, len, actx.sampleRate);
      const dd = buf.getChannelData(0);
      for (let i = 0; i < len; i++) dd[i] = Math.random() * 2 - 1;
      const src = actx.createBufferSource();
      src.buffer = buf;
      const lp = actx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(900, now);
      lp.frequency.exponentialRampToValueAtTime(180, now + dur);
      const g = actx.createGain();
      g.gain.setValueAtTime(0.16, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(lp); lp.connect(g); g.connect(bus ?? actx.destination);
      src.start(now); src.stop(now + dur);
      const o = actx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(110, now);
      o.frequency.exponentialRampToValueAtTime(38, now + dur);
      const g2 = actx.createGain();
      g2.gain.setValueAtTime(0.2, now);
      g2.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.connect(g2); g2.connect(bus ?? actx.destination);
      o.start(now); o.stop(now + dur);
    } else if (kind === 'alarm') {
      // 袭击警报：低沉两连鸣（三角波 480→240Hz ×2），带一点不安的颤
      for (let i = 0; i < 2; i++) {
        const o = actx.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(480, now + i * 0.42);
        o.frequency.exponentialRampToValueAtTime(236, now + i * 0.42 + 0.34);
        const g = actx.createGain();
        g.gain.setValueAtTime(0.0001, now + i * 0.42);
        g.gain.exponentialRampToValueAtTime(0.16, now + i * 0.42 + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.42 + 0.38);
        o.connect(g); g.connect(bus ?? actx.destination);
        o.start(now + i * 0.42); o.stop(now + i * 0.42 + 0.4);
      }
    }
  } catch { /* 合成失败 = 安静，绝不影响演出 */ }
}
