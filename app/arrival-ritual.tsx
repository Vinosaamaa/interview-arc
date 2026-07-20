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
  { path: "/arrival-dawn.jpg", label: "Dawn study" },
  { path: "/arrival-rain-city.jpg", label: "Rain on the window" },
  { path: "/arrival-mountain-cabin.jpg", label: "Pines before sunrise" },
  { path: "/arrival-sakura-study.jpg", label: "Sakura after rain" },
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
  onToggleMuted,
  onEnter,
}: {
  date: string;
  state: "checking" | "show" | "leaving" | "entered";
  muted: boolean;
  trackName: string;
  onToggleMuted: () => void;
  onEnter: () => void;
}) {
  if (state === "entered") return null;
  const wallpaper = wallpaperFor(date);
  return (
    <section className={`arrival-ritual ${state}`} aria-label="Daily arrival">
      <div className="arrival-image" style={{ "--arrival-wallpaper": `url(${wallpaper.path})` } as CSSProperties} aria-hidden="true" />
      <div className="arrival-shade" aria-hidden="true" />
      {state !== "checking" && (
        <div className="arrival-content">
          <span className="arrival-kicker">INTERVIEW ARC · {displayDate(date).toUpperCase()}</span>
          <blockquote>{quoteFor(date)}</blockquote>
          <p>One session. One clear record. Nothing to prove before you begin.</p>
          <div className="arrival-actions">
            <button className="arrival-enter" onClick={onEnter}>Begin today’s work <span>↘</span></button>
            <button className="arrival-sound" onClick={onToggleMuted} aria-pressed={muted}>
              <span aria-hidden="true">{muted ? "◌" : "♪"}</span>
              {muted ? "Enter quietly" : trackName}
            </button>
          </div>
        </div>
      )}
      <footer><span>{wallpaper.label.toUpperCase()}</span><i /><span>BEGIN</span></footer>
    </section>
  );
}
