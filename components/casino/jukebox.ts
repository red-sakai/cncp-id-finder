// The jukebox's music is played live by Web Audio: a small step sequencer
// over a handful of synth voices. No audio files to ship or license.
// A member's own songs play through the same output, so volume, tempo and
// the jukebox lights work on them too.

export type Layer = "drums" | "bass" | "keys";

type Track = {
  id: string;
  name: string;
  mood: string;
  bpm: number;
  swing: number; // 0..0.3, delays every other 16th
  root: number; // MIDI note
  chords: number[][]; // semitones from the root, one chord per bar
  kick: string;
  snare: string;
  hat: string;
  bass: string; // digit = chord tone (0 root .. 3 next tone up), "." rest
  arp: string;
  lead: OscillatorType;
  bassWave: OscillatorType;
  bright: number; // pad filter cutoff, Hz
};

export const TRACKS: Track[] = [
  {
    id: "neon-lounge", name: "Neon Lounge", mood: "Deep house", bpm: 112, swing: 0.06, root: 57,
    chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [3, 7, 10, 14], [-2, 2, 5, 9]],
    kick: "x...x...x...x...", snare: "....x.......x...", hat: "..x...x...x...x.",
    bass: "0..0..0.0..2.3..", arp: "0.1.2.3.2.1.0.2.", lead: "triangle", bassWave: "sawtooth", bright: 1400,
  },
  {
    id: "lucky-seven", name: "Lucky Seven", mood: "Disco", bpm: 124, swing: 0, root: 50,
    chords: [[0, 3, 7, 10], [5, 9, 12, 15], [-2, 2, 5, 9], [7, 11, 14, 17]],
    kick: "x...x...x...x...", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x.",
    bass: "0.3.0.3.0.3.0.3.", arp: "2...1...3...2.1.", lead: "square", bassWave: "square", bright: 2200,
  },
  {
    id: "midnight-felt", name: "Midnight Felt", mood: "Lo-fi", bpm: 84, swing: 0.22, root: 53,
    chords: [[0, 4, 7, 11], [-1, 2, 7, 10], [-3, 0, 5, 9], [-5, -1, 4, 7]],
    kick: "x......x..x.....", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x.",
    bass: "0.....2...1.....", arp: "2...1...3...0...", lead: "triangle", bassWave: "triangle", bright: 900,
  },
  {
    id: "high-roller", name: "High Roller", mood: "Synthwave", bpm: 100, swing: 0, root: 48,
    chords: [[0, 3, 7, 12], [-4, 0, 3, 8], [3, 7, 10, 15], [-2, 2, 5, 10]],
    kick: "x.......x.......", snare: "....x.......x...", hat: "..x...x...x...x.",
    bass: "0.0.0.0.0.0.0.0.", arp: "0123012301230123", lead: "sawtooth", bassWave: "sawtooth", bright: 1800,
  },
];

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const LOOKAHEAD = 0.12;

export class Jukebox {
  private ctx: AudioContext;
  private master: GainNode;
  private layers: Record<Layer, GainNode>;
  private noise: AudioBuffer;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextTime = 0;
  private lastKick = -10;
  private el: HTMLAudioElement | null = null;
  private fileGain: GainNode;
  private analyser: AnalyserNode;
  private wave = new Uint8Array(512);
  private custom = false;
  onEnded: (() => void) | null = null;

  track = 0;
  tempo = 1;
  volume = 0.7;
  on: Record<Layer, boolean> = { drums: true, bass: true, keys: true };

  constructor() {
    // Created from a tap, so browsers let it make sound.
    this.ctx = new AudioContext();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume * 0.6;
    comp.connect(this.master).connect(this.ctx.destination);
    this.layers = {
      drums: this.ctx.createGain(),
      bass: this.ctx.createGain(),
      keys: this.ctx.createGain(),
    };
    for (const g of Object.values(this.layers)) g.connect(comp);
    this.fileGain = this.ctx.createGain();
    this.fileGain.connect(comp);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.master.connect(this.analyser);
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  get playing() {
    return this.custom ? !!this.el && !this.el.paused : this.timer !== null;
  }

  // Playing and actually heard: browsers hold audio until the page has had a tap.
  get audible() {
    return this.playing && this.ctx.state === "running";
  }

  get isCustom() {
    return this.custom;
  }

  async play(track = this.track) {
    if (this.custom || track !== this.track || !this.playing) {
      this.el?.pause();
      this.custom = false;
      this.track = track;
      this.step = 0;
      this.nextTime = this.ctx.currentTime + 0.06;
    }
    if (!this.timer) this.timer = setInterval(this.pump, 25);
    await this.ctx.resume().catch(() => {});
  }

  async playFile(url: string) {
    this.stopSynth();
    if (!this.el) {
      const el = new Audio();
      el.preservesPitch = true;
      this.ctx.createMediaElementSource(el).connect(this.fileGain);
      el.onended = () => this.onEnded?.();
      this.el = el;
    }
    this.custom = true;
    this.el.src = url;
    this.el.playbackRate = this.tempo;
    await this.ctx.resume().catch(() => {});
    await this.el.play();
  }

  // Picks up where it left off, for the first tap after autoplay was held back.
  async resume() {
    await this.ctx.resume().catch(() => {});
    if (this.custom && this.el?.paused) await this.el.play().catch(() => {});
  }

  pause() {
    this.stopSynth();
    this.el?.pause();
    void this.ctx.suspend();
  }

  setTempo(v: number) {
    this.tempo = v;
    if (this.el) this.el.playbackRate = v;
  }

  private stopSynth() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setVolume(v: number) {
    this.volume = v;
    this.master.gain.setTargetAtTime(v * 0.6, this.ctx.currentTime, 0.05);
  }

  setLayer(layer: Layer, on: boolean) {
    this.on[layer] = on;
    this.layers[layer].gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.08);
  }

  // What the jukebox's lights follow: 1 on a kick, decaying between them.
  // A member's song has no kick to read, so its loudness stands in.
  pulse() {
    if (!this.audible) return 0;
    if (this.custom) {
      this.analyser.getByteTimeDomainData(this.wave);
      let sum = 0;
      for (const v of this.wave) sum += ((v - 128) / 128) ** 2;
      return Math.min(1, Math.sqrt(sum / this.wave.length) * 3.2);
    }
    const since = this.ctx.currentTime - this.lastKick;
    return since < 0 ? 0 : Math.exp(-since * 7);
  }

  dispose() {
    this.stopSynth();
    if (this.el) {
      this.el.pause();
      this.el.removeAttribute("src");
    }
    void this.ctx.close();
  }

  private pump = () => {
    const t = TRACKS[this.track];
    const sixteenth = 60 / (t.bpm * this.tempo) / 4;
    while (this.nextTime < this.ctx.currentTime + LOOKAHEAD) {
      const s = this.step % 16;
      const swing = s % 2 ? t.swing * sixteenth : 0;
      this.schedule(t, this.step, this.nextTime + swing, sixteenth);
      this.nextTime += sixteenth;
      this.step = (this.step + 1) % 64;
    }
  };

  private schedule(t: Track, step: number, at: number, len: number) {
    const s = step % 16;
    const chord = t.chords[Math.floor(step / 16) % t.chords.length];
    const tone = (ch: string, octave: number) => {
      const i = Number(ch);
      const base = chord[i % chord.length] + 12 * Math.floor(i / chord.length);
      return t.root + base + 12 * octave;
    };
    if (t.kick[s] === "x") {
      this.kick(at);
      this.lastKick = at;
    }
    if (t.snare[s] === "x") this.hit(at, 1700, 0.18, 0.5, "bandpass");
    if (t.hat[s] === "x") this.hit(at, 7500, 0.045, 0.22, "highpass");
    if (t.bass[s] !== ".") this.note(this.layers.bass, t.bassWave, hz(tone(t.bass[s], -1)), at, len * 1.8, 0.32, 600);
    if (t.arp[s] !== ".") this.note(this.layers.keys, t.lead, hz(tone(t.arp[s], 1)), at, len * 1.4, 0.09, 3200);
    if (s === 0) for (const n of chord) this.note(this.layers.keys, "sawtooth", hz(t.root + n), at, len * 15, 0.035, t.bright, 0.4);
  }

  private kick(at: number) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.setValueAtTime(140, at);
    osc.frequency.exponentialRampToValueAtTime(42, at + 0.14);
    g.gain.setValueAtTime(0.95, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.34);
    osc.connect(g).connect(this.layers.drums);
    osc.start(at);
    osc.stop(at + 0.36);
  }

  private hit(at: number, freq: number, dur: number, level: number, type: BiquadFilterType) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(level, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    src.connect(f).connect(g).connect(this.layers.drums);
    src.start(at, Math.random() * 0.5);
    src.stop(at + dur + 0.02);
  }

  private note(out: GainNode, wave: OscillatorType, freq: number, at: number, dur: number, level: number, cutoff: number, attack = 0.005) {
    const osc = this.ctx.createOscillator();
    osc.type = wave;
    osc.frequency.value = freq;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
    osc.connect(f).connect(g).connect(out);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }
}
