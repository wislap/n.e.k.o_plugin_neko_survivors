import { useT } from '../i18n';

import type { AudioSettings, AudioIssueSummary } from '../../audio/types';
export function AudioSettingsPanel({ settings, onChange, issue }: { settings: AudioSettings; onChange(settings: AudioSettings): void; issue?: AudioIssueSummary | null }) {
  const t = useT();
  return <fieldset style={{ margin: '10px 0', textAlign: 'left' }}><legend>{t('ui.audio.title')}</legend>
    {(['master', 'music', 'sfx'] as const).map(channel => <label key={channel} style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '6px 0' }}>
      <span style={{ minWidth: 58 }}>{t(`ui.audio.${channel}`)}</span><input className="fx-slider" type="range" min="0" max="1" step="0.01" value={settings[channel]} style={{ flex: 1 }}
        onChange={event => onChange({ ...settings, [channel]: Number(event.target.value) })} />
    </label>)}
    <label><input type="checkbox" checked={settings.enabled} onChange={event => onChange({ ...settings, enabled: event.target.checked })} />{t('ui.audio.enabled')}</label>
    {issue && <details style={{ marginTop: 8 }}><summary>{t('ui.audio.diagnostic', {}, '音频状态')}</summary><p role="status" title={issue.resource}>{t(issue.waitingForGesture ? 'ui.audio.waiting' : issue.recoverable ? 'ui.audio.retry' : 'ui.audio.failed', { reason: issue.reason })}</p></details>}
  </fieldset>;
}
