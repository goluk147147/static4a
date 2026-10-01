import fs from 'fs';
import type { MusicStyle } from './types';

// Generated, royalty-free background music — the original render.js synth
// (arpeggiated I–V–vi–IV pluck + pad + kick + hat), with three styles.
interface Style {
  bpm: number;
  chords: number[][];
  pluck: number; // pluck volume
  pad: number;
  kick: number;
  hat: number;
  decay: number; // pluck decay
  kickEvery: number; // beats between kicks (0.5 = double-time)
  bell: number; // extra octave shimmer (festive)
}

const C_G_Am_F = [[261.63, 329.63, 392.0], [196.0, 246.94, 293.66], [220.0, 261.63, 329.63], [174.61, 220.0, 261.63]];
const STYLES: Record<MusicStyle, Style> = {
  // original track
  upbeat: { bpm: 112, chords: C_G_Am_F, pluck: 0.22, pad: 0.035, kick: 0.45, hat: 0.06, decay: 7, kickEvery: 1, bell: 0 },
  // brighter + faster with a bell shimmer and dhol-like double kicks
  festive: { bpm: 124, chords: [[293.66, 369.99, 440.0], [220.0, 277.18, 329.63], [246.94, 293.66, 369.99], [196.0, 246.94, 293.66]], pluck: 0.2, pad: 0.03, kick: 0.4, hat: 0.07, decay: 6, kickEvery: 0.5, bell: 0.07 },
  // slow, soft pad, gentle pluck, no drums
  calm: { bpm: 80, chords: [[220.0, 261.63, 329.63], [174.61, 220.0, 261.63], [261.63, 329.63, 392.0], [196.0, 246.94, 293.66]], pluck: 0.16, pad: 0.06, kick: 0, hat: 0, decay: 3.5, kickEvery: 1, bell: 0.03 },
};

export function writeMusic(file: string, durationSec: number, style: MusicStyle = 'upbeat') {
  const s = STYLES[style] || STYLES.upbeat;
  const SR = 44100, N = Math.round(SR * durationSec);
  const buf = Buffer.alloc(44 + N * 2);
  const beat = 60 / s.bpm;
  let seed = 12345; // deterministic noise → identical audio for identical options
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const ch = s.chords[Math.floor(t / (beat * 4)) % 4];
    const step = Math.floor(t / (beat / 2));
    const stepT = t % (beat / 2);
    const note = ch[step % 3] * (step % 6 >= 3 ? 2 : 1);
    const env = Math.exp(-stepT * s.decay);
    const pluck = Math.sin(2 * Math.PI * note * t) * env * s.pluck;
    const bell = s.bell ? Math.sin(2 * Math.PI * note * 2 * t) * env * env * s.bell : 0;
    const pad = ch.reduce((a, f) => a + Math.sin(2 * Math.PI * (f / 2) * t), 0) * s.pad;
    const kb = beat * s.kickEvery;
    const beatT = t % kb;
    const kick = s.kick ? Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-beatT * 30)) * beatT) * Math.exp(-beatT * 9) * s.kick : 0;
    const offT = (t + beat / 2) % beat;
    const hat = s.hat ? rnd() * Math.exp(-offT * 60) * s.hat : 0;
    let v = pluck + bell + pad + kick + hat;
    const fade = Math.min(1, t / 0.8, (durationSec - t) / 1.2);
    v = Math.max(-1, Math.min(1, v * fade * 0.9));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(N * 2, 40);
  fs.writeFileSync(file, buf);
}
