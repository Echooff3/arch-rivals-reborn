
// Procedural audio via Web Audio API
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private crowdGain!: GainNode;
  private started = false;

  async ensure(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);

    // Crowd ambience loop
    this.crowdGain = this.ctx.createGain();
    this.crowdGain.gain.value = 0.08;
    this.crowdGain.connect(this.master);
    this.startCrowd();
  }

  private startCrowd(): void {
    if (!this.ctx) return;
    const bufferSize = 2 * this.ctx.sampleRate;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      // pink-ish
      b0 = 0.99 * b0 + 0.0555179 * white;
      b1 = 0.963 * b1 + 0.2965164 * white;
      b2 = 0.57 * b2 + 1.0526913 * white;
      output[i] = (b0 + b1 + b2 + white * 0.1) * 0.15;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 600;
    filter.Q.value = 0.6;
    src.connect(filter);
    filter.connect(this.crowdGain);
    src.start();
  }

  private now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  bounce(): void {
    if (!this.ctx) return;
    const t = this.now();
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.08);
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + 0.15);
  }

  swish(): void {
    if (!this.ctx) return;
    const t = this.now();
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.35, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = "highpass";
    filt.frequency.setValueAtTime(800, t);
    filt.frequency.exponentialRampToValueAtTime(4000, t + 0.3);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(t);
  }

  rim(): void {
    if (!this.ctx) return;
    const t = this.now();
    const osc = this.ctx.createOscillator();
    osc.type = "square";
    const g = this.ctx.createGain();
    osc.frequency.setValueAtTime(820, t);
    osc.frequency.exponentialRampToValueAtTime(420, t + 0.12);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + 0.25);
  }

  punch(): void {
    if (!this.ctx) return;
    const t = this.now();
    // body thud
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.15);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + 0.22);
    // noise burst
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.08, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.4, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    src.connect(ng); ng.connect(this.master);
    src.start(t);
  }

  whistle(): void {
    if (!this.ctx) return;
    const t = this.now();
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(2200, t);
    osc.frequency.linearRampToValueAtTime(2600, t + 0.3);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.15, t + 0.05);
    g.gain.linearRampToValueAtTime(0, t + 0.35);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + 0.4);
  }

  buzzer(): void {
    if (!this.ctx) return;
    const t = this.now();
    const osc = this.ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 180;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.setValueAtTime(0.35, t + 1.5);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + 1.65);
  }

  cheer(): void {
    if (!this.ctx) return;
    const t = this.now();
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 1.4, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const env = Math.sin((i / d.length) * Math.PI);
      d[i] = (Math.random() * 2 - 1) * env;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = 1000;
    filt.Q.value = 0.5;
    const g = this.ctx.createGain();
    g.gain.value = 0.4;
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(t);
  }

  blip(freq = 880): void {
    if (!this.ctx) return;
    const t = this.now();
    const osc = this.ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + 0.1);
  }
}

export const audio = new AudioManager();
