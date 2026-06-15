/**
 * Tiny WebAudio synth for game feedback sounds — no audio assets needed.
 * The context unlocks on the first user gesture; until then calls no-op.
 */
export class SoundFx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  constructor() {
    const unlock = () => {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  /** 0 = at the player's ear, larger = quieter. */
  private gainFor(distance: number, base: number): number {
    return base / (1 + (distance / 14) ** 2);
  }

  private env(
    type: OscillatorType,
    freqFrom: number,
    freqTo: number,
    dur: number,
    gain: number
  ): void {
    if (!this.ctx || !this.master || gain < 0.004) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(freqTo, 1), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(dur: number, gain: number, filterHz: number): void {
    if (!this.ctx || !this.master || gain < 0.004) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterHz;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
  }

  /** Cheerful rising coin pings for collecting money. */
  coins(distance: number): void {
    const g = this.gainFor(distance, 0.45);
    this.env('sine', 880, 880, 0.09, g);
    setTimeout(() => this.env('sine', 1318, 1318, 0.12, g), 70);
    setTimeout(() => this.env('sine', 1760, 1760, 0.16, g * 0.8), 150);
  }

  /** Deep buzz when a laser blockade powers up. */
  laserOn(distance: number): void {
    const g = this.gainFor(distance, 0.4);
    this.env('sawtooth', 90, 240, 0.5, g);
    this.env('square', 45, 120, 0.5, g * 0.5);
  }

  laserOff(distance: number): void {
    const g = this.gainFor(distance, 0.3);
    this.env('sawtooth', 240, 70, 0.35, g);
  }

  /** Air whoosh for a bat swing. */
  swing(distance: number): void {
    this.noiseBurst(0.18, this.gainFor(distance, 0.3), 900);
  }

  /** Meaty thump for a connected hit. */
  hit(distance: number): void {
    const g = this.gainFor(distance, 0.55);
    this.env('triangle', 160, 40, 0.22, g);
    this.noiseBurst(0.12, g * 0.6, 300);
  }

  /** Soft confirmation when a brainrot is stored. */
  deposit(distance: number): void {
    const g = this.gainFor(distance, 0.35);
    this.env('sine', 523, 523, 0.1, g);
    setTimeout(() => this.env('sine', 784, 784, 0.18, g), 90);
  }

  /** Alarm blip when something of yours is being stolen. */
  alarm(): void {
    this.env('square', 660, 660, 0.12, 0.25);
    setTimeout(() => this.env('square', 520, 520, 0.16, 0.25), 140);
  }
}

