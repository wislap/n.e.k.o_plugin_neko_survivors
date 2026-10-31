import type { GameCommand } from '../../game';

/** The original E/Q help line remains the control surface; the session owns automation. */
export function UpgradeAutomation({ enabled, dispatch }: {
  enabled: boolean; dispatch(command: GameCommand): void;
}) {
  return <div className="sub">选一个强化。<b style={{ color: '#ffd166', cursor: 'pointer' }} role="button" tabIndex={0}
    onClick={() => dispatch({ type: 'auto-upgrade' })} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); dispatch({ type: 'auto-upgrade' }); } }}>E</b> 自动选一次 ·
    <b style={{ color: '#ffd166', cursor: 'pointer' }} role="button" tabIndex={0} aria-pressed={enabled}
      onClick={() => dispatch({ type: 'set-auto-upgrade', enabled: !enabled })} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); dispatch({ type: 'set-auto-upgrade', enabled: !enabled }); } }}>Q</b> 本局升级全自动（下一局自动关闭）
  </div>;
}
