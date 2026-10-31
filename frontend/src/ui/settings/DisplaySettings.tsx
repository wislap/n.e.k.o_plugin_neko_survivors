import type {PlayerSoftQuality}from '../../presentation/profile';
import { useT } from '../i18n';

export function DisplaySettings({ opacity, onChange,softQuality='native',onSoftQuality }: { opacity: number; onChange(value: number): void;softQuality?:PlayerSoftQuality;onSoftQuality?(value:PlayerSoftQuality):void }) {
  const t = useT(), percent = Math.round(opacity * 100);
  return <div style={{ marginTop: 16, textAlign: 'left' }}>
    <div className="sub" style={{ marginBottom: 6 }}>{t('ui.pause.settings', {}, '设置')}</div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <label htmlFor="player-effect-opacity" style={{ whiteSpace: 'nowrap' }}>{t('ui.visual.originalPlayerEffects', {}, '玩家特效')}</label>
      <input id="player-effect-opacity" type="range" className="fx-slider" min="0" max="100" step="5" value={percent} style={{ flex: 1 }} onChange={event => onChange(Number(event.target.value) / 100)} />
      <span style={{ minWidth: 44, textAlign: 'right' }}>{`${percent}%`}</span>
    </div>
    {onSoftQuality&&<label style={{display:'flex',gap:12,alignItems:'center',marginTop:10}}>{t('ui.visual.softQuality')}
      <select id="player-soft-quality" aria-label={t('ui.visual.softQuality')} value={softQuality} onChange={event=>onSoftQuality(event.target.value as PlayerSoftQuality)}><option value="native">{t('ui.visual.softNative')}</option><option value="balanced">{t('ui.visual.softBalanced')}</option></select>
      <span className="sub">{t('ui.visual.softHint')}</span>
    </label>}
    <div className="sub" style={{ marginTop: 6, opacity: .75 }}>{t('ui.visual.originalEffectHint', {}, '调低自己攻击的透明度 —— 弹幕太密看不清敌人弹幕时有用（敌人弹幕不受影响）。')}</div>
  </div>;
}
