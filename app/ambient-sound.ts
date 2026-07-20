"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type LofiTrack = {
  name: string;
  artist: string;
  path: string;
  sourceUrl: string;
  sourceLabel: string;
};

const PLAYLIST: LofiTrack[] = [
  { name: "Sweet September", artist: "Arulo", path: "/audio/sweet-september.mp3", sourceUrl: "https://mixkit.co/free-stock-music/lo-fi-beats/", sourceLabel: "Mixkit · Lo-fi beats" },
  { name: "Sleepy Cat", artist: "Alejandro Magaña", path: "/audio/sleepy-cat.mp3", sourceUrl: "https://mixkit.co/free-stock-music/lo-fi-beats/", sourceLabel: "Mixkit · Lo-fi beats" },
  { name: "Serene View", artist: "Arulo", path: "/audio/serene-view.mp3", sourceUrl: "https://mixkit.co/free-stock-music/chillout/", sourceLabel: "Mixkit · Chillout" },
  { name: "Thinking About You", artist: "Arulo", path: "/audio/thinking-about-you.mp3", sourceUrl: "https://mixkit.co/free-stock-music/chillout/", sourceLabel: "Mixkit · Chillout" },
  { name: "Valley Sunset", artist: "Alejandro Magaña", path: "/audio/valley-sunset.mp3", sourceUrl: "https://mixkit.co/free-stock-music/ambient/", sourceLabel: "Mixkit · Ambient" },
  { name: "Relax Beat", artist: "Arulo", path: "/audio/relax-beat.mp3", sourceUrl: "https://mixkit.co/free-stock-music/ambient/", sourceLabel: "Mixkit · Ambient" },
  { name: "Spirit in the Woods", artist: "Alejandro Magaña", path: "/audio/spirit-in-the-woods.mp3", sourceUrl: "https://mixkit.co/free-stock-music/ambient/", sourceLabel: "Mixkit · Ambient" },
  { name: "Forest Treasure", artist: "Alejandro Magaña", path: "/audio/forest-treasure.mp3", sourceUrl: "https://mixkit.co/free-stock-music/ambient/", sourceLabel: "Mixkit · Ambient" },
  { name: "Meditation", artist: "Arulo", path: "/audio/meditation.mp3", sourceUrl: "https://mixkit.co/free-stock-music/ambient/", sourceLabel: "Mixkit · Ambient" },
  { name: "Forest Walk", artist: "Eugenio Mininni", path: "/audio/forest-walk.mp3", sourceUrl: "https://mixkit.co/free-stock-music/ambient/", sourceLabel: "Mixkit · Ambient" },
  { name: "Smooth Meditation", artist: "Arulo", path: "/audio/smooth-meditation.mp3", sourceUrl: "https://mixkit.co/free-stock-music/ambient/", sourceLabel: "Mixkit · Ambient" },
  { name: "Rest Now", artist: "Eugenio Mininni", path: "/audio/rest-now.mp3", sourceUrl: "https://mixkit.co/free-stock-music/ambient/", sourceLabel: "Mixkit · Ambient" },
  { name: "Yoga Song", artist: "Arulo", path: "/audio/yoga-song.mp3", sourceUrl: "https://mixkit.co/free-stock-music/ambient/", sourceLabel: "Mixkit · Ambient" },
  { name: "Nature Yoga", artist: "Arulo", path: "/audio/nature-yoga.mp3", sourceUrl: "https://mixkit.co/free-stock-music/ambient/", sourceLabel: "Mixkit · Ambient" },
  { name: "Finding Myself", artist: "Michael Ramir C.", path: "/audio/finding-myself.mp3", sourceUrl: "https://mixkit.co/free-stock-music/ambient/", sourceLabel: "Mixkit · Ambient" },
  { name: "Forest Mist Whispers", artist: "Alejandro Magaña", path: "/audio/forest-mist-whispers.mp3", sourceUrl: "https://mixkit.co/free-stock-music/ambient/", sourceLabel: "Mixkit · Ambient" },
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

  const previous = useCallback(() => {
    const previousIndex = (indexRef.current - 1 + PLAYLIST.length) % PLAYLIST.length;
    loadTrack(previousIndex, playingRef.current);
  }, [loadTrack]);

  const playTrack = useCallback((index: number) => {
    if (index < 0 || index >= PLAYLIST.length) return;
    loadTrack(index, true);
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
    const bytes = new Uint32Array(1);
    window.crypto.getRandomValues(bytes);
    let nextIndex = bytes[0] % PLAYLIST.length;
    const previous = Number(window.sessionStorage.getItem("interview-arc-last-opening-track"));
    if (PLAYLIST.length > 1 && Number.isInteger(previous) && previous === nextIndex) nextIndex = (nextIndex + 1 + (bytes[0] % (PLAYLIST.length - 1))) % PLAYLIST.length;
    window.sessionStorage.setItem("interview-arc-last-opening-track", String(nextIndex));

    const frame = window.requestAnimationFrame(() => {
      indexRef.current = nextIndex;
      setTrackIndex(nextIndex);
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
  }, [date]);

  return {
    playing,
    playlist: PLAYLIST,
    trackIndex,
    trackName: track.name,
    trackArtist: track.artist,
    volume,
    start,
    stop,
    next,
    previous,
    playTrack,
    setVolume,
  };
}
