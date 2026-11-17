// Casino sound effects, synthesized with Web Audio so there are no files to
// ship. They run on their own audio context, so pausing the jukebox never
// silences a spin. The world calls these at the exact moment an animation
// lands; `delay` is seconds from now.

export type SfxName =
  | "lever" | "thunk"
  | "shuffle" | "deal" | "flip" | "chip" | "chips" | "knock" | "bell";

// How big a win sounds, 0 to 1, from how many times the stake it paid.
// Logarithmic, so every paytable tier is a step up: 2x is about 0.1, 20x
// about 0.45, 150x about 0.75, and `top` (the 800x jackpot) is 1.
export const winIntensity = (multiple: number, top = 800) =>
  Math.min(1, Math.max(0, Math.log(Math.max(1, multiple)) / Math.log(top)));

export type Roll = { setActive(reels: number): void; stop(): void };

export class Sfx {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;

  // Made on the first sound or the first tap; browsers allow it from then on.
  unlock() {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.out = ctx.createGain();
      this.out.gain.value = 0.55;
      this.out.connect(ctx.destination);
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
    }
    void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }

  play(name: SfxName, delay = 0) {
    if (!this.enabled) return;
    const ctx = this.unlock();
    const t = ctx.currentTime + Math.max(0, delay);
    switch (name) {
      case "lever":
        this.sweep(t, 700, 180, 0.32, 0.22, "bandpass");
        this.tone(t + 0.3, 170, 70, 0.14, 0.4, "sine");
        break;
      case "thunk":
        this.tone(t, 170, 55, 0.14, 0.55, "sine");
        this.burst(t, 1400, 0.03, 0.25, "lowpass");
        break;
      case "shuffle":
        for (let i = 0; i < 16; i++) this.burst(t + 0.6 * Math.pow(i / 16, 0.8), 2200, 0.02, 0.16, "bandpass");
        break;
      case "deal":
        this.sweep(t, 2600, 900, 0.09, 0.22, "bandpass");
        break;
      case "flip":
        this.burst(t, 2400, 0.035, 0.22, "highpass");
        this.tone(t + 0.02, 220, 140, 0.04, 0.12, "sine");
        break;
      case "chip":
        this.clink(t);
        this.clink(t + 0.05);
        break;
      case "chips":
        for (let i = 0; i < 7; i++) this.clink(t + i * 0.07 + Math.random() * 0.03);
        break;
      case "knock":
        this.tone(t, 130, 90, 0.05, 0.35, "sine");
        this.tone(t + 0.13, 130, 90, 0.05, 0.35, "sine");
        break;
      case "bell":
        this.tone(t, 1760, 1760, 1.1, 0.12, "sine");
        this.tone(t, 2640, 2640, 0.7, 0.05, "sine");
        break;
    }
  }

  // The win sound grows with the prize. Each step adds a layer on top of the
  // last: a chime, longer and faster runs, a bass boom and a held chord, a
  // snare roll into the chord, shimmer, and at the top a casino alarm and a
  // long rain of coins.
  win(intensity: number) {
    if (!this.enabled) return;
    const ctx = this.unlock();
    const k = Math.min(1, Math.max(0, intensity));
    const t = ctx.currentTime;
    const scale = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568, 2093];
    const notes = 3 + Math.round(k * 4);
    const runs = 1 + Math.round(k * 3);
    const step = 0.1 - k * 0.04;
    const runLen = notes * step + 0.06;
    const level = 0.12 + k * 0.06;
    for (let r = 0; r < runs; r++)
      for (let i = 0; i < notes; i++) {
        const f = scale[i] * (r > 0 && r === runs - 1 && k > 0.5 ? 2 : 1);
        this.tone(t + r * runLen + i * step, f, f, 0.3, level, "triangle");
      }
    const peak = t + runs * runLen;

    if (k > 0.6) {
      // A snare roll that tightens into the final chord.
      for (let i = 0; i < 18; i++) this.burst(peak - 0.6 + 0.6 * Math.pow(i / 18, 0.7), 1800, 0.06, 0.12 + (i / 18) * 0.2, "bandpass");
    }
    if (k > 0.25) {
      const hold = 0.5 + k * 1.8;
      for (const f of [261.63, 329.63, 392, 523.25]) this.tone(peak, f, f, hold, 0.05 + k * 0.05, "sawtooth", 1400 + k * 2000);
    }
    if (k > 0.35) {
      this.tone(t, 120, 42, 0.5, 0.45, "sine");
      this.tone(peak, 110, 38, 0.7 + k * 0.6, 0.55, "sine");
    }
    if (k > 0.7) {
      // Shimmer: a scatter of high bells over the chord.
      for (let i = 0; i < 14 + k * 16; i++) {
        const f = 2400 + Math.random() * 2400;
        this.tone(peak + Math.random() * (0.8 + k), f, f, 0.25, 0.04, "sine");
      }
    }
    if (k > 0.85) {
      // The jackpot alarm: a rising and falling siren over everything.
      for (let i = 0; i < 4; i++) {
        this.tone(peak + i * 0.5, 620, 1240, 0.25, 0.05, "sawtooth", 2600);
        this.tone(peak + i * 0.5 + 0.25, 1240, 620, 0.25, 0.05, "sawtooth", 2600);
      }
    }
    this.coins(t + 0.12, Math.round(4 + k * 70), 0.4 + k * 2.6);
  }

  private coins(t: number, count: number, spread: number) {
    for (let i = 0; i < count; i++) {
      const at = t + Math.random() * spread;
      const f = 2200 + Math.random() * 1600;
      this.tone(at, f, f, 0.09, 0.06, "sine");
      this.tone(at, f * 1.5, f * 1.5, 0.05, 0.03, "sine");
    }
  }

  // The reels' whir: a low hum plus a tick for every symbol that passes.
  // Fewer reels turning means fewer ticks, so the stops are heard.
  roll(): Roll {
    if (!this.enabled) return { setActive() {}, stop() {} };
    const ctx = this.unlock();
    const hum = ctx.createOscillator();
    hum.type = "sawtooth";
    hum.frequency.value = 62;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 260;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.07, ctx.currentTime + 0.15);
    hum.connect(lp).connect(g).connect(this.out!);
    hum.start();
    let active = 3;
    let next = ctx.currentTime;
    const timer = setInterval(() => {
      while (active > 0 && next < ctx.currentTime + 0.1) {
        this.burst(next, 3200 + Math.random() * 800, 0.012, 0.05 + active * 0.02, "highpass");
        next += 1 / (11 * active);
      }
      if (next < ctx.currentTime) next = ctx.currentTime;
    }, 30);
    return {
      setActive(n: number) {
        active = n;
        g.gain.setTargetAtTime(n ? 0.025 + n * 0.015 : 0, ctx.currentTime, 0.05);
      },
      stop() {
        clearInterval(timer);
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
        hum.stop(ctx.currentTime + 0.4);
      },
    };
  }

  // A rising tone under the last reel's slow crawl.
  riser(delay: number, dur: number) {
    if (!this.enabled) return;
    const ctx = this.unlock();
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(720, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + dur * 0.85);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    osc.connect(f).connect(g).connect(this.out!);
    osc.start(t);
    osc.stop(t + dur + 0.1);
  }

  private tone(t: number, f0: number, f1: number, dur: number, level: number, type: OscillatorType, cutoff = 6000) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(f).connect(g).connect(this.out!);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private burst(t: number, freq: number, dur: number, level: number, type: BiquadFilterType) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t, Math.random() * 0.8);
    src.stop(t + dur + 0.02);
  }

  private sweep(t: number, from: number, to: number, dur: number, level: number, type: BiquadFilterType) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = 2;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + dur * 0.2);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private clink(t: number) {
    const f = 2600 + Math.random() * 900;
    this.tone(t, f, f, 0.07, 0.07, "sine");
    this.tone(t, f * 1.37, f * 1.37, 0.05, 0.04, "sine");
    this.burst(t, 5000, 0.01, 0.06, "highpass");
  }
}
