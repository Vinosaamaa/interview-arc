"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SoundGraph = {
  context: AudioContext;
  master: GainNode;
  oscillators: OscillatorNode[];
  timers: number[];
};

export function useAmbientSound() {
  const graphRef = useRef<SoundGraph | null>(null);
  const [playing, setPlaying] = useState(false);

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
    master.gain.exponentialRampToValueAtTime(0.032, context.currentTime + 1.8);
    filter.type = "lowpass";
    filter.frequency.value = 1250;
    filter.Q.value = 0.4;
    filter.connect(master);
    master.connect(context.destination);

    const oscillators: OscillatorNode[] = [];
    [130.81, 196, 261.63].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const voiceGain = context.createGain();
      const lfo = context.createOscillator();
      const lfoGain = context.createGain();
      oscillator.type = index === 2 ? "triangle" : "sine";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = index === 1 ? -7 : index === 2 ? 5 : 0;
      voiceGain.gain.value = index === 0 ? 0.45 : index === 1 ? 0.2 : 0.07;
      lfo.frequency.value = 0.035 + index * 0.014;
      lfoGain.gain.value = index === 0 ? 0.1 : 0.045;
      lfo.connect(lfoGain);
      lfoGain.connect(voiceGain.gain);
      oscillator.connect(voiceGain);
      voiceGain.connect(filter);
      oscillator.start();
      lfo.start();
      oscillators.push(oscillator, lfo);
    });

    const timers: number[] = [];
    let chimeIndex = 0;
    const chime = () => {
      if (context.state === "closed") return;
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = [523.25, 659.25, 783.99, 659.25][chimeIndex % 4];
      chimeIndex += 1;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.018, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.8);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(now);
      oscillator.stop(now + 3);
      timers.push(window.setTimeout(chime, 8_000 + (chimeIndex % 3) * 1_700));
    };
    timers.push(window.setTimeout(chime, 2_400));

    graphRef.current = { context, master, oscillators, timers };
    void context.resume();
    setPlaying(true);
  }, []);

  useEffect(() => stop, [stop]);

  return { playing, start, stop };
}
