"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type LofiTrack = {
  name: string;
  bpm: number;
  roots: number[];
  color: "sine" | "triangle";
};

const PLAYLIST: LofiTrack[] = [
  { name: "Rain on the Window", bpm: 68, roots: [130.81, 110, 146.83, 98], color: "sine" },
  { name: "First Train Home", bpm: 72, roots: [146.83, 123.47, 164.81, 110], color: "triangle" },
  { name: "Pines Before Sunrise", bpm: 64, roots: [110, 130.81, 98, 123.47], color: "sine" },
  { name: "Sakura After Rain", bpm: 70, roots: [123.47, 146.83, 110, 130.81], color: "triangle" },
  { name: "A Quiet Page", bpm: 66, roots: [98, 123.47, 110, 82.41], color: "sine" },
];

type SoundGraph = {
  context: AudioContext;
  master: GainNode;
  oscillators: OscillatorNode[];
  chordVoices: OscillatorNode[];
  timers: number[];
  trackIndex: number;
  beat: number;
};

function stableIndex(date: string, length: number) {
  const value = date.split("").reduce((sum, character, index) => sum + character.charCodeAt(0) * (index + 3), 0);
  return value % length;
}

function makeNoise(context: AudioContext, seconds: number) {
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  return buffer;
}

export function useAmbientSound(date: string) {
  const graphRef = useRef<SoundGraph | null>(null);
  const [playing, setPlaying] = useState(false);
  const [trackName, setTrackName] = useState(() => PLAYLIST[stableIndex(date, PLAYLIST.length)].name);

  const stop = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graphRef.current = null;
    graph.timers.forEach((timer) => window.clearTimeout(timer));
    const now = graph.context.currentTime;
    graph.master.gain.cancelScheduledValues(now);
    graph.master.gain.setValueAtTime(Math.max(graph.master.gain.value, 0.0001), now);
    graph.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);
    window.setTimeout(() => {
      graph.oscillators.forEach((oscillator) => {
        try { oscillator.stop(); } catch { /* Already stopped. */ }
      });
      void graph.context.close();
    }, 700);
    setPlaying(false);
  }, []);

  const start = useCallback(() => {
    if (graphRef.current) return;
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const master = context.createGain();
    const filter = context.createBiquadFilter();
    master.gain.setValueAtTime(0.0001, context.currentTime);
    master.gain.exponentialRampToValueAtTime(0.045, context.currentTime + 1.8);
    filter.type = "lowpass";
    filter.frequency.value = 1180;
    filter.Q.value = 0.55;
    filter.connect(master);
    master.connect(context.destination);

    const initialTrack = stableIndex(date, PLAYLIST.length);
    const track = PLAYLIST[initialTrack];
    const chordVoices: OscillatorNode[] = [];
    const oscillators: OscillatorNode[] = [];
    [1, 1.5, 2, 2.5].forEach((ratio, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = index === 3 ? track.color : "sine";
      oscillator.frequency.value = track.roots[0] * ratio;
      oscillator.detune.value = [-8, 5, -3, 7][index];
      gain.gain.value = [0.38, 0.15, 0.065, 0.025][index];
      oscillator.connect(gain);
      gain.connect(filter);
      oscillator.start();
      chordVoices.push(oscillator);
      oscillators.push(oscillator);
    });

    // A very low vinyl/rain bed makes the synthesized playlist feel tactile
    // without downloading or licensing third-party music files.
    const noise = context.createBufferSource();
    const noiseFilter = context.createBiquadFilter();
    const noiseGain = context.createGain();
    noise.buffer = makeNoise(context, 3);
    noise.loop = true;
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 1600;
    noiseFilter.Q.value = 0.35;
    noiseGain.gain.value = 0.022;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start();

    const graph: SoundGraph = {
      context,
      master,
      oscillators: [...oscillators, noise as unknown as OscillatorNode],
      chordVoices,
      timers: [],
      trackIndex: initialTrack,
      beat: 0,
    };
    graphRef.current = graph;

    const playKick = (at: number) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(90, at);
      oscillator.frequency.exponentialRampToValueAtTime(42, at + 0.13);
      gain.gain.setValueAtTime(0.085, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(at);
      oscillator.stop(at + 0.2);
    };

    const playTick = (at: number) => {
      const source = context.createBufferSource();
      const tickFilter = context.createBiquadFilter();
      const gain = context.createGain();
      source.buffer = makeNoise(context, 0.08);
      tickFilter.type = "highpass";
      tickFilter.frequency.value = 1900;
      gain.gain.setValueAtTime(0.025, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
      source.connect(tickFilter);
      tickFilter.connect(gain);
      gain.connect(master);
      source.start(at);
    };

    const advance = () => {
      if (graphRef.current !== graph || context.state === "closed") return;
      const current = PLAYLIST[graph.trackIndex];
      const beatMs = 60_000 / current.bpm;
      const beatInBar = graph.beat % 4;
      const bar = Math.floor(graph.beat / 4);
      if (beatInBar === 0) {
        const root = current.roots[bar % current.roots.length];
        [1, 1.5, 2, 2.5].forEach((ratio, index) => {
          graph.chordVoices[index].frequency.exponentialRampToValueAtTime(root * ratio, context.currentTime + 0.5);
        });
      }
      if (beatInBar === 0 || beatInBar === 2) playKick(context.currentTime);
      if (beatInBar === 1 || beatInBar === 3) playTick(context.currentTime);
      graph.beat += 1;

      // Eighty beats is one small track; advance through the playlist while the
      // page remains open, starting from a different song each date.
      if (graph.beat % 80 === 0) {
        graph.trackIndex = (graph.trackIndex + 1) % PLAYLIST.length;
        graph.beat = 0;
        const nextTrack = PLAYLIST[graph.trackIndex];
        graph.chordVoices.forEach((voice) => { voice.type = nextTrack.color; });
        setTrackName(nextTrack.name);
      }
      graph.timers.push(window.setTimeout(advance, beatMs));
    };
    graph.timers.push(window.setTimeout(advance, 600));

    void context.resume();
    setTrackName(track.name);
    setPlaying(true);
  }, [date]);

  useEffect(() => stop, [stop]);

  return { playing, trackName, start, stop };
}
