/**
 * Motor de sonido: sintetiza cada efecto con la Web Audio API.
 *
 * No hay ficheros de audio. Cada efecto es una envolvente sobre uno o dos
 * osciladores, lo que mantiene el juego en un único bundle sin descargas ni
 * dependencias. El contexto se crea en la primera interacción del jugador,
 * porque los navegadores bloquean la reproducción automática; si el
 * navegador no soporta la API, todo se convierte en operaciones vacías y el
 * juego sigue siendo plenamente jugable.
 */

import type { SoundId } from '../game/sounds';

type Waveform = OscillatorType;

interface ToneSpec {
  /** Forma de onda del oscilador. */
  wave: Waveform;
  /** Frecuencia inicial, en Hz. */
  from: number;
  /** Frecuencia final: el barrido da el carácter del efecto. */
  to: number;
  /** Duración en segundos. */
  duration: number;
  /** Volumen de pico, de 0 a 1. */
  gain: number;
  /** Ruido blanco mezclado, de 0 a 1: da cuerpo a impactos y explosiones. */
  noise?: number;
}

/**
 * Cada evento tiene sus propios parámetros. Los disparos son cortos y
 * agudos, las muertes caen en tono, la fuga es un descenso grave y molesto,
 * y la victoria es lo único que sube.
 */
const TONES: Readonly<Record<SoundId, ToneSpec>> = {
  'shoot-arrow': { wave: 'triangle', from: 900, to: 420, duration: 0.09, gain: 0.16 },
  'shoot-cannon': { wave: 'square', from: 220, to: 70, duration: 0.16, gain: 0.24, noise: 0.5 },
  'shoot-mortar': { wave: 'sawtooth', from: 160, to: 55, duration: 0.22, gain: 0.24, noise: 0.4 },
  'shoot-bolt': { wave: 'triangle', from: 1200, to: 500, duration: 0.11, gain: 0.18 },
  'shoot-magic': { wave: 'sine', from: 700, to: 1800, duration: 0.16, gain: 0.2 },
  'shoot-frost': { wave: 'sine', from: 1500, to: 900, duration: 0.14, gain: 0.14 },
  hit: { wave: 'square', from: 320, to: 180, duration: 0.05, gain: 0.08, noise: 0.6 },
  kill: { wave: 'triangle', from: 520, to: 120, duration: 0.18, gain: 0.2 },
  leak: { wave: 'sawtooth', from: 300, to: 70, duration: 0.5, gain: 0.3 },
  build: { wave: 'square', from: 300, to: 620, duration: 0.14, gain: 0.2 },
  upgrade: { wave: 'sine', from: 500, to: 1100, duration: 0.22, gain: 0.22 },
  sell: { wave: 'sine', from: 900, to: 400, duration: 0.18, gain: 0.18 },
  repair: { wave: 'triangle', from: 400, to: 800, duration: 0.18, gain: 0.18 },
  'ability-meteor': { wave: 'sawtooth', from: 500, to: 60, duration: 0.7, gain: 0.34, noise: 0.7 },
  'ability-blizzard': { wave: 'sine', from: 1800, to: 300, duration: 0.7, gain: 0.26, noise: 0.3 },
  'wave-start': { wave: 'square', from: 380, to: 560, duration: 0.26, gain: 0.18 },
  victory: { wave: 'triangle', from: 520, to: 1300, duration: 0.9, gain: 0.3 },
  defeat: { wave: 'sawtooth', from: 400, to: 60, duration: 1.1, gain: 0.32 },
};

/** Límite de sonidos simultáneos: sin él, una oleada grande satura el audio. */
const MAX_CONCURRENT = 6;
/** Mismo sonido dos veces seguidas antes de este margen: se descarta el segundo. */
const DEDUPE_WINDOW_MS = 45;

export interface AudioEngine {
  /** Arranca el contexto. Debe llamarse desde un gesto del usuario. */
  unlock(): void;
  play(id: SoundId): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
}

type AudioContextCtor = typeof AudioContext;

function findAudioContext(): AudioContextCtor | null {
  const scope = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/** Motor sin efecto, para navegadores sin Web Audio. */
function silentEngine(initiallyMuted: boolean): AudioEngine {
  let muted = initiallyMuted;
  return {
    unlock: () => {},
    play: () => {},
    setMuted: (value: boolean) => {
      muted = value;
    },
    isMuted: () => muted,
  };
}

export function createAudioEngine(initiallyMuted = false): AudioEngine {
  const found = findAudioContext();
  if (!found) return silentEngine(initiallyMuted);
  const Ctor: AudioContextCtor = found;

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let muted = initiallyMuted;
  let active = 0;
  const lastPlayed = new Map<SoundId, number>();
  let noiseBuffer: AudioBuffer | null = null;

  function ensureContext(): boolean {
    if (ctx) {
      // Los navegadores suspenden el contexto al perder el foco.
      if (ctx.state === 'suspended') void ctx.resume();
      return true;
    }
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      return true;
    } catch {
      ctx = null;
      master = null;
      return false;
    }
  }

  function getNoiseBuffer(context: AudioContext): AudioBuffer {
    if (noiseBuffer) return noiseBuffer;
    const length = Math.floor(context.sampleRate * 0.4);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    noiseBuffer = buffer;
    return buffer;
  }

  return {
    unlock(): void {
      if (muted) return;
      ensureContext();
    },

    play(id: SoundId): void {
      if (muted) return;
      if (!ensureContext() || !ctx || !master) return;
      if (active >= MAX_CONCURRENT) return;

      const now = performance.now();
      const previous = lastPlayed.get(id);
      if (previous !== undefined && now - previous < DEDUPE_WINDOW_MS) return;
      lastPlayed.set(id, now);

      const spec = TONES[id];
      const start = ctx.currentTime;
      const end = start + spec.duration;

      try {
        const envelope = ctx.createGain();
        envelope.gain.setValueAtTime(0, start);
        envelope.gain.linearRampToValueAtTime(spec.gain, start + 0.008);
        envelope.gain.exponentialRampToValueAtTime(0.0001, end);
        envelope.connect(master);

        const osc = ctx.createOscillator();
        osc.type = spec.wave;
        osc.frequency.setValueAtTime(spec.from, start);
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.to), end);
        osc.connect(envelope);
        osc.start(start);
        osc.stop(end);

        active += 1;
        osc.onended = () => {
          active = Math.max(0, active - 1);
        };

        if (spec.noise && spec.noise > 0) {
          const noise = ctx.createBufferSource();
          noise.buffer = getNoiseBuffer(ctx);
          const noiseGain = ctx.createGain();
          noiseGain.gain.setValueAtTime(spec.gain * spec.noise, start);
          noiseGain.gain.exponentialRampToValueAtTime(0.0001, end);
          noise.connect(noiseGain);
          noiseGain.connect(master);
          noise.start(start);
          noise.stop(end);
        }
      } catch {
        // Un fallo de audio nunca debe tumbar el frame.
      }
    },

    setMuted(value: boolean): void {
      muted = value;
      if (muted && master) master.gain.value = 0;
      else if (master) master.gain.value = 0.5;
    },

    isMuted: () => muted,
  };
}
