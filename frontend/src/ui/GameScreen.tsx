import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getDifficultyChoices, type CharacterChoice, type DifficultyId, type GameCommand, type GameUiSnapshot, type RunOptions } from '../game';
import { Hud } from './hud/Hud';
import type { HudDisplay } from '../app/hud-display';
import type { PresentationProfile,PlayerSoftQuality } from '../presentation/profile';
import { ShopScreen } from './shop/ShopScreen';
import { TitleScreen } from './title/TitleScreen';
import { UpgradeScreen } from './upgrades/UpgradeScreen';
import { PauseScreen } from './pause/PauseScreen';
import { ResultsScreen } from './results/ResultsScreen';
import type { AudioSettings, AudioIssueSummary } from '../audio/types';
import type { HostResult } from '../host';

interface Props {
  presentation: Readonly<PresentationProfile>; snapshot: GameUiSnapshot; characters: readonly CharacterChoice[];
  canContinue: boolean; audio: AudioSettings;
  hostFeedback?: Pick<HostResult, 'status' | 'reason'> | null;
  audioIssue?: AudioIssueSummary | null;
  dispatch(command: GameCommand): void;
  onContinue(): void; onImportLegacy(): void; onSave(): Promise<boolean>; onAudio(settings: AudioSettings): void;
  effectOpacity?: number; onEffectOpacity?(value: number): void;
  softQuality?:PlayerSoftQuality;onSoftQuality?(value:PlayerSoftQuality):void;
  onExit?(): void;
  showAdvanced?: boolean;
  hudNow?: number;
  hudDisplay?: HudDisplay;
}
export function GameScreen(props: Props) {
  const { snapshot, dispatch } = props;
  const [difficulty, setDifficulty] = useState<DifficultyId>(snapshot.difficulty);
  useEffect(() => setDifficulty(snapshot.difficulty), [snapshot.difficulty]);
  const [selectingAfterResult, setSelectingAfterResult] = useState(false);
  // Original DOM HUD updates only during combat; menu prices and inventory
  // update independently while the screen-space bars keep their display clock.
  const chrome = useRef(snapshot);
  const refreshChrome = snapshot.phase === 'title' || snapshot.combat
    || chrome.current.players.length === 0;
  const chromeSnapshot = refreshChrome ? snapshot : chrome.current;
  useLayoutEffect(() => { if (refreshChrome) chrome.current = snapshot; }, [snapshot, refreshChrome]);
  const [pauseHistory, setPauseHistory] = useState({ active: false,
    latest: {} as Readonly<Record<string, number>>, previous: {} as Readonly<Record<string, number>> });
  const paused = snapshot.phase === 'paused';
  if (pauseHistory.active !== paused || snapshot.phase === 'title' && Object.keys(pauseHistory.latest).length > 0) {
    setPauseHistory(snapshot.phase === 'title' ? { active: false, latest: {}, previous: {} }
      : { active: paused, latest: paused ? Object.fromEntries(snapshot.players[0]!.statDetails.map(row => [row.statId, row.value])) : pauseHistory.latest,
        previous: paused ? pauseHistory.latest : pauseHistory.previous });
  }
  const start = (options: RunOptions) => { setSelectingAfterResult(false); dispatch({ type: 'start-run', options }); };
  const restart = () => { setSelectingAfterResult(true); dispatch({ type: 'return-title' }); };
  const playing = snapshot.phase !== 'title';
  return <>
    {playing && <Hud presentation={props.presentation} snapshot={snapshot} chromeSnapshot={chromeSnapshot} chromeHidden={snapshot.phase === 'result'} clock={props.hudNow} display={props.hudDisplay} />}
    <div id="overlay" className="interface">
    {snapshot.phase === 'title' && <TitleScreen characters={props.characters} canContinue={props.canContinue}
      key={`title-${selectingAfterResult}`} initialSelecting={selectingAfterResult}
      difficulties={getDifficultyChoices()} difficulty={difficulty}
      onSetDifficulty={setDifficulty}
      seed={snapshot.seed} audioEnabled={props.audio.enabled}
      onToggleAudio={() => props.onAudio({ ...props.audio, enabled: !props.audio.enabled })} onExit={props.onExit}
      onDuoWatch={() => start({ characterId: props.characters[0]!.id, difficulty, partySize: 2, pilot: true, randomParty: true })}
      unlockedChallenges={snapshot.unlockedChallenges} onStart={start}
      showLegacyImport={props.showAdvanced} showExtraChallenges={props.showAdvanced}
      onChallenge={(challenge, options) => dispatch({ type: 'start-challenge', challenge, options })}
      onContinue={props.onContinue} onImportLegacy={props.onImportLegacy} />}
    {snapshot.phase === 'shop' && <ShopScreen snapshot={snapshot} dispatch={dispatch} />}
    {snapshot.phase === 'upgrade' && <UpgradeScreen snapshot={snapshot} dispatch={dispatch} />}
    {snapshot.phase === 'paused' && <PauseScreen previousStats={pauseHistory.previous} snapshot={snapshot} dispatch={dispatch} audio={props.audio} onSave={props.onSave} onAudio={props.onAudio}
      effectOpacity={props.effectOpacity} onEffectOpacity={props.onEffectOpacity} softQuality={props.softQuality} onSoftQuality={props.presentation.mobile?undefined:props.onSoftQuality} audioIssue={props.audioIssue} onExit={props.onExit}
      showAdvanced={props.showAdvanced} hostFeedback={props.hostFeedback} />}
    {(snapshot.phase === 'result' || snapshot.phase === 'endless-prompt') && <ResultsScreen snapshot={snapshot} dispatch={dispatch} onRestart={restart} />}
    </div>
  </>;
}
