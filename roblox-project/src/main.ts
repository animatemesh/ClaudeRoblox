import './style.css';
import { Game } from './game/game';

const container = document.getElementById('app')!;
const game = new Game(container);
game.start().catch((err) => {
  console.error('Failed to start game:', err);
  const label = document.getElementById('loading-label');
  if (label) label.textContent = 'Failed to load: ' + (err?.message ?? err);
});
