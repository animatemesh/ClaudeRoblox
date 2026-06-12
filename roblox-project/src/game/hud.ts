import { formatMoney } from './catalog';
import type { Entity } from './character';

/** DOM overlay: money counter, leaderboard, prompts and the notification feed. */
export class Hud {
  private moneyEl: HTMLElement;
  private incomeEl: HTMLElement;
  private slotsEl: HTMLElement;
  private blockadeEl: HTMLElement;
  private promptEl: HTMLElement;
  private carryEl: HTMLElement;
  private feedEl: HTMLElement;
  private boardEl: HTMLElement;
  private lockHintEl: HTMLElement;
  private loadingEl: HTMLElement;
  private loadingBarEl: HTMLElement;
  private loadingLabelEl: HTMLElement;

  constructor(rootSelector: string) {
    const root = document.querySelector(rootSelector)!;
    root.innerHTML = `
      <div id="hud">
        <div id="topbar">
          <div id="money-card">
            <div id="money">$0</div>
            <div id="income">+$0/s</div>
            <div id="slots">0/8 slots</div>
            <div id="blockade"></div>
          </div>
          <div id="leaderboard"></div>
        </div>
        <div id="carry-banner" class="hidden"></div>
        <div id="prompt" class="hidden"></div>
        <div id="feed"></div>
        <div id="lock-hint">🖱 Click to play — WASD move · Mouse look · LMB/F swing bat · E buy/steal · Space jump</div>
        <div id="crosshair">·</div>
      </div>
      <div id="loading">
        <h1>STEAL A BRAINROT</h1>
        <div id="loading-bar-outer"><div id="loading-bar"></div></div>
        <div id="loading-label">Loading…</div>
      </div>
    `;
    this.moneyEl = document.getElementById('money')!;
    this.incomeEl = document.getElementById('income')!;
    this.slotsEl = document.getElementById('slots')!;
    this.blockadeEl = document.getElementById('blockade')!;
    this.promptEl = document.getElementById('prompt')!;
    this.carryEl = document.getElementById('carry-banner')!;
    this.feedEl = document.getElementById('feed')!;
    this.boardEl = document.getElementById('leaderboard')!;
    this.lockHintEl = document.getElementById('lock-hint')!;
    this.loadingEl = document.getElementById('loading')!;
    this.loadingBarEl = document.getElementById('loading-bar')!;
    this.loadingLabelEl = document.getElementById('loading-label')!;
  }

  setLoading(label: string, done: number, total: number): void {
    this.loadingBarEl.style.width = `${Math.round((done / total) * 100)}%`;
    this.loadingLabelEl.textContent = `Loading ${label}… (${done}/${total})`;
  }

  hideLoading(): void {
    this.loadingEl.classList.add('gone');
    setTimeout(() => this.loadingEl.remove(), 700);
  }

  setPointerLocked(locked: boolean): void {
    this.lockHintEl.classList.toggle('hidden', locked);
  }

  setMoney(money: number, incomePerSec: number, used: number, total: number): void {
    this.moneyEl.textContent = formatMoney(money);
    this.incomeEl.textContent = `+${formatMoney(incomePerSec)}/s`;
    this.slotsEl.textContent = `${used}/${total} slots`;
  }

  setBlockade(state: 'ready' | 'active' | 'cooldown', secondsLeft = 0): void {
    if (state === 'ready') {
      this.blockadeEl.textContent = '🔒 Blockade ready — step the red button';
      this.blockadeEl.style.color = '#ff8a8a';
    } else if (state === 'active') {
      this.blockadeEl.textContent = `🔒 Blockade ACTIVE ${Math.ceil(secondsLeft)}s`;
      this.blockadeEl.style.color = '#ff4444';
    } else {
      this.blockadeEl.textContent = '🔒 Blockade recharging…';
      this.blockadeEl.style.color = '#8a93ad';
    }
  }

  setPrompt(text: string | null): void {
    if (text) {
      this.promptEl.textContent = text;
      this.promptEl.classList.remove('hidden');
    } else {
      this.promptEl.classList.add('hidden');
    }
  }

  setCarry(text: string | null, stolen: boolean): void {
    if (text) {
      this.carryEl.textContent = text;
      this.carryEl.classList.remove('hidden');
      this.carryEl.classList.toggle('stolen', stolen);
    } else {
      this.carryEl.classList.add('hidden');
    }
  }

  notify(text: string, color = '#ffffff'): void {
    const div = document.createElement('div');
    div.className = 'feed-item';
    div.style.borderLeftColor = color;
    div.textContent = text;
    this.feedEl.prepend(div);
    while (this.feedEl.children.length > 6) this.feedEl.lastChild?.remove();
    setTimeout(() => {
      div.classList.add('fade');
      setTimeout(() => div.remove(), 600);
    }, 5200);
  }

  updateLeaderboard(entities: Entity[]): void {
    const sorted = [...entities].sort((a, b) => b.money - a.money);
    this.boardEl.innerHTML = sorted
      .map((e) => {
        const cls = e.isPlayer ? 'lb-row me' : 'lb-row';
        return `<div class="${cls}"><span class="lb-dot" style="background:${e.colorHex}"></span>` +
          `<span class="lb-name">${e.name}</span><span class="lb-money">${formatMoney(e.money)}</span></div>`;
      })
      .join('');
  }
}
