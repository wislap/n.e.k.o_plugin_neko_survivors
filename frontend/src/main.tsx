import { createRoot } from 'react-dom/client';
import { GameApp } from './app/GameApp';
import './ui/styles/game.css';
import type { HostOptions } from './host';

declare global {
  interface Window {
    /** Optional configuration supplied by the trusted embedding host page. */
    __NEKO_SURVIVORS_HOST__?: HostOptions;
  }
}

const parameters = new URLSearchParams(location.search);
const profiling = parameters.get('profile') === '1';
const container = document.getElementById('root');
if (!container) throw new Error('Application mount is missing');
createRoot(container).render(<GameApp hostOptions={window.__NEKO_SURVIVORS_HOST__} diagnostics={new URLSearchParams(location.search).get('diagnostics') === '1'} profiling={profiling} />);
