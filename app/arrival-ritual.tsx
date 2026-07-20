"use client";

import type { CSSProperties } from "react";

const DAILY_LINES = [
  "You do not need the whole answer. You need the next honest step.",
  "Small proofs become quiet confidence.",
  "Today is not a verdict. It is another useful signal.",
  "Stay with the question long enough for it to become familiar.",
  "Clarity arrives after you begin.",
  "Practice the pause before you practice the answer.",
  "One careful hour can change the shape of a week.",
  "The work counts even before it feels fluent.",
  "Make the mistake visible. Then make it useful.",
  "Begin calmly. Finish honestly.",
];

const WALLPAPER_POOL = [
  { path: "/arrival-cozy-room-4k.jpg", label: "Quiet room", photographer: "Magic Fan", href: "https://unsplash.com/photos/C3NeCFvQq4M" },
  { path: "/arrival-sakura-river-4k.jpg", label: "Sakura at night", photographer: "ayumi kubo", href: "https://unsplash.com/photos/uiTY1tPjwlk" },
  { path: "/arrival-rain-office-4k.jpg", label: "Rain over Singapore", photographer: "Milin John", href: "https://unsplash.com/photos/9RD0bE5C9WI" },
  { path: "/arrival-mountain-lake-4k.jpg", label: "Peyto Lake at dawn", photographer: "Mario Häfliger", href: "https://unsplash.com/photos/Svnrlh3lXZ0" },
];

const PETALS = Array.from({ length: 26 }, (_, index) => ({
  left: (index * 37 + 11) % 101,
  delay: -((index * 1.73) % 15),
  duration: 11 + (index * 7) % 10,
  drift: -70 + (index * 29) % 150,
  size: 7 + (index * 5) % 9,
  rotate: (index * 47) % 180,
}));

function quoteFor(date: string) {
  const value = date.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return DAILY_LINES[value % DAILY_LINES.length];
}

function wallpaperFor(date: string) {
  const value = date.split("").reduce((sum, character, index) => sum + character.charCodeAt(0) * (index + 1), 0);
  return WALLPAPER_POOL[value % WALLPAPER_POOL.length];
}

function displayDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function PetalField({ quiet, paused }: { quiet: boolean; paused: boolean }) {
  return (
    <div className={`petal-field ${quiet ? "quiet" : "full"} ${paused ? "paused" : ""}`} aria-hidden="true">
      {PETALS.map((petal, index) => (
        <i
          key={index}
          className="ambient-petal"
          style={{
            "--petal-left": `${petal.left}%`,
            "--petal-delay": `${petal.delay}s`,
            "--petal-duration": `${petal.duration}s`,
            "--petal-drift": `${petal.drift}px`,
            "--petal-size": `${petal.size}px`,
            "--petal-rotate": `${petal.rotate}deg`,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}

export function ArrivalRitual({
  date,
  state,
  muted,
  trackName,
  trackArtist,
  volume,
  onToggleMuted,
  onNextTrack,
  onVolumeChange,
  onEnter,
}: {
  date: string;
  state: "show" | "leaving" | "entered";
  muted: boolean;
  trackName: string;
  trackArtist: string;
  volume: number;
  onToggleMuted: () => void;
  onNextTrack: () => void;
  onVolumeChange: (volume: number) => void;
  onEnter: () => void;
}) {
  if (state === "entered") return null;
  const wallpaper = wallpaperFor(date);
  return (
    <section className={`arrival-ritual ${state}`} aria-label="Daily arrival">
      <div className="arrival-image" style={{ "--arrival-wallpaper": `url(${wallpaper.path})` } as CSSProperties} aria-hidden="true" />
      <div className="arrival-shade" aria-hidden="true" />
      <div className="arrival-content">
        <span className="arrival-kicker">INTERVIEW ARC · {displayDate(date).toUpperCase()}</span>
        <blockquote>{quoteFor(date)}</blockquote>
        <p>One session. One clear record. Nothing to prove before you begin.</p>
        <div className="arrival-actions">
          <button className="arrival-enter" onClick={onEnter}>Begin today’s work <span>↘</span></button>
          <div className="arrival-listening-desk" aria-label="Music controls">
            <button className="arrival-sound" onClick={onToggleMuted} aria-pressed={!muted}>
              <span aria-hidden="true">{muted ? "◌" : "♪"}</span>
              <span><small>{muted ? "MUSIC OFF" : "TODAY’S MIX"}</small><strong>{trackName}</strong><em>{trackArtist}</em></span>
            </button>
            <button className="arrival-next-track" onClick={onNextTrack} aria-label="Choose the next track" title="Next track">↠</button>
            <label className="arrival-volume"><span>VOLUME</span><input type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => onVolumeChange(Number(event.target.value))} aria-label="Music volume" /></label>
          </div>
        </div>
      </div>
      <footer><a href={wallpaper.href} target="_blank" rel="noreferrer">{wallpaper.label.toUpperCase()} · PHOTO BY {wallpaper.photographer.toUpperCase()}</a><i /><span>BEGIN</span></footer>
    </section>
  );
}
