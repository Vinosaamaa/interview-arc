"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type LofiTrack = {
  name: string;
  artist: string;
  path: string;
};

const PLAYLIST: LofiTrack[] = [
  { name: "Sweet September", artist: "Arulo", path: "/audio/sweet-september.mp3" },
  { name: "Sleepy Cat", artist: "Alejandro Magaña", path: "/audio/sleepy-cat.mp3" },
  { name: "Serene View", artist: "Arulo", path: "/audio/serene-view.mp3" },
  { name: "Thinking About You", artist: "Arulo", path: "/audio/thinking-about-you.mp3" },
];

function stableIndex(date: string, length: number) {
  const value = date.split("").reduce((sum, character, index) => sum + character.charCodeAt(0) * (index + 3), 0);
  return value % length;
}

export function useAmbientSound(date: string) {
  const initialIndex = stableIndex(date, PLAYLIST.length);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const indexRef = useRef(initialIndex);
  const playingRef = useRef(false);
  const volumeRef = useRef(0.72);
  const advanceRef = useRef<() => void>(() => undefined);
  const [playing, setPlaying] = useState(false);
  const [trackIndex, setTrackIndex] = useState(initialIndex);
  const [volume, setVolumeState] = useState(0.72);

  const track = PLAYLIST[trackIndex];

  const loadTrack = useCallback((index: number, shouldPlay: boolean) => {
    audioRef.current?.pause();
    const audio = new Audio(PLAYLIST[index].path);
    audio.preload = "auto";
    audio.volume = volumeRef.current;
    audio.addEventListener("ended", () => advanceRef.current(), { once: true });
    audioRef.current = audio;
    indexRef.current = index;
    setTrackIndex(index);
    if (shouldPlay) {
      void audio.play().then(() => {
        playingRef.current = true;
        setPlaying(true);
      }).catch(() => {
        playingRef.current = false;
        setPlaying(false);
      });
    }
  }, []);

  const start = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      loadTrack(indexRef.current, true);
      return;
    }
    audio.volume = volumeRef.current;
    void audio.play().then(() => {
      playingRef.current = true;
      setPlaying(true);
    }).catch(() => {
      playingRef.current = false;
      setPlaying(false);
    });
  }, [loadTrack]);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    playingRef.current = false;
    setPlaying(false);
  }, []);

  const next = useCallback(() => {
    const nextIndex = (indexRef.current + 1) % PLAYLIST.length;
    loadTrack(nextIndex, playingRef.current);
  }, [loadTrack]);

  const setVolume = useCallback((nextVolume: number) => {
    const safeVolume = Math.min(1, Math.max(0, nextVolume));
    volumeRef.current = safeVolume;
    setVolumeState(safeVolume);
    if (audioRef.current) audioRef.current.volume = safeVolume;
    window.localStorage.setItem("interview-arc-music-volume", String(safeVolume));
  }, []);

  useEffect(() => {
    advanceRef.current = next;
  }, [next]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const savedVolume = Number(window.localStorage.getItem("interview-arc-music-volume"));
      if (Number.isFinite(savedVolume) && savedVolume > 0) {
        const safeVolume = Math.min(1, savedVolume);
        volumeRef.current = safeVolume;
        setVolumeState(safeVolume);
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  return {
    playing,
    trackName: track.name,
    trackArtist: track.artist,
    volume,
    start,
    stop,
    next,
    setVolume,
  };
}
