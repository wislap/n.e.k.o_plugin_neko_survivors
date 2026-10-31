import type {PlayerSoftQuality}from '../../presentation/profile';
import type { GameCommand, GameUiSnapshot } from '../../game';
import { useT } from '../i18n';
import { playerStat } from '../player-stat';
import { AudioSettingsPanel } from '../settings/AudioSettings';
import type { AudioSettings, AudioIssueSummary } from '../../audio/types';
import { DisplaySettings } from '../settings/DisplaySettings';
import type { HostResult } from '../../host';

const PAUSE_STATS = [
  ['damage', 'i-damage', '伤害', 'gold'], ['attackSpeed', 'i-atkspeed', '攻击速度', 'gold'],
  ['critChance', 'i-crit', '暴击率', 'gold'], ['critDamage', 'i-critdmg', '暴击伤害', 'gold'],
  ['armor', 'i-armor', '护甲', 'violet'], ['dodge', 'i-dodge', '闪避', 'violet'],
  ['moveSpeed', 'i-speed', '移动速度', 'violet'], ['luck', 'i-paw', '幸运', 'violet'],
  ['harvesting', 'i-gem', '收获', 'violet'], ['lifesteal', 'i-drop', '吸血', 'gold'],
] as const;
export function PauseScreen({ previousStats, snapshot, dispatch, audio, onSave, onAudio, effectOpacity = 1, onEffectOpacity,softQuality,onSoftQuality, audioIssue, onExit, showAdvanced = false, hostFeedback }: {
  previousStats: Readonly<Record<string, number>>; snapshot: GameUiSnapshot; dispatch(command: GameCommand): void; audio: AudioSettings;
  onSave(): Promise<boolean>; onAudio(settings: AudioSettings): void;
  effectOpacity?: number; onEffectOpacity?(value: number): void;
  softQuality?:PlayerSoftQuality;onSoftQuality?(value:PlayerSoftQuality):void;
  audioIssue?: AudioIssueSummary | null; onExit?(): void;
  showAdvanced?: boolean; hostFeedback?: Pick<HostResult, 'status' | 'reason'> | null;
}) {
  const t = useT(), player = snapshot.players[0];
  if (!player) throw new Error('Pause requires an active player');
  return <section className="screen" role="dialog" aria-modal="true" aria-label={t('ui.pause.originalTitle', {}, '已暂停')}>
    <h2 className="pause-title">{t('ui.pause.originalTitle', {}, '已暂停')}</h2>
    <div className="sub">{t('ui.pause.statOverview', {}, '当前属性一览')}</div>
    <div className="result-stats">{PAUSE_STATS.map(([id, icon, name, tone]) => {
      const detail = playerStat(player, id), value = detail.value;
      const changed = previousStats[id] !== undefined && Math.abs(previousStats[id] - value) > .01;
      return <div key={id} className={`result-stat tone-${tone}${changed ? ' rs-flash' : ''}`} aria-description={detail.description}>
        <svg className="rs-icon" aria-hidden="true"><use href={`#${icon}`} /></svg>
        <div className="rs-txt"><div className="k">{t(`content.stats.${id}.name`, {}, name)}</div><div className="v">{detail.formatted}</div></div>
      </div>;
    })}</div>
    {onEffectOpacity && <DisplaySettings opacity={effectOpacity} onChange={onEffectOpacity} softQuality={softQuality} onSoftQuality={onSoftQuality} />}
    <div className="btn-row">
      <button className="btn" aria-pressed={snapshot.pilot} style={snapshot.pilot ? { borderColor: '#ff9ec7', color: '#ff9ec7', background: '#ff9ec722' } : undefined}
        onClick={() => dispatch({ type: 'set-pilot', enabled: !snapshot.pilot })}>🐾 猫娘帮你玩：{snapshot.pilot ? '开（她正在打）' : '关'}</button>
      <button className="btn primary" onClick={() => dispatch({ type: 'resume' })}>{t('ui.action.resume')}</button>
      <button className="btn" onClick={() => dispatch({ type: 'abandon-run' })}>{t('ui.action.abandon', {}, '放弃本局')}</button>
      {onExit && <button className="btn danger" onClick={onExit}>{t('ui.action.close', {}, '关闭游戏')}</button>}
    </div>
    {showAdvanced && <details style={{ position: 'absolute', top: 28, right: 32, textAlign: 'left', zIndex: 3 }}><summary className="sub" style={{ marginBottom: 0, cursor: 'pointer' }}>{t('ui.pause.moreSettings', {}, '更多设置')}</summary>
      <div style={{ position: 'absolute', top: '100%', right: 0, width: 340, maxWidth: 'calc(100vw - 100px)', padding: 14, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14, boxShadow: 'var(--nk-shadow)' }}>
      <AudioSettingsPanel settings={audio} onChange={onAudio} issue={audioIssue} />
      {hostFeedback && <div role="status" title={hostFeedback.reason}>{t('ui.host.lastResult', { status: t(`ui.host.result.${hostFeedback.status}`) })}</div>}
      <div className="btn-row"><button className="btn" onClick={onSave}>{t('ui.action.save')}</button>
        <button className="btn" onClick={async () => { if (await onSave()) dispatch({ type: 'return-title' }); }}>{t('ui.action.saveExit')}</button>
        <button className="btn" disabled={!snapshot.canRetry} onClick={() => dispatch({ type: 'retry-wave' })}>{t('ui.action.retry')}</button>
        <button className="btn" aria-pressed={!!snapshot.autoUpgrade} onClick={() => dispatch({ type: 'set-auto-upgrade', enabled: !snapshot.autoUpgrade })}>{t(snapshot.autoUpgrade ? 'ui.upgrade.autoStop' : 'ui.upgrade.autoRun')}</button>
      </div></div>
    </details>}
  </section>;
}
