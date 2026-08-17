"use client";

import type { LofiTrack } from "./ambient-sound";

export function MusicPlaylist({
  playlist,
  currentIndex,
  onSelect,
  variant = "dashboard",
}: {
  playlist: LofiTrack[];
  currentIndex: number;
  onSelect: (index: number) => void;
  variant?: "dashboard" | "arrival";
}) {
  return (
    <details className={`music-playlist ${variant}`}>
      <summary aria-label="Open today’s music playlist" title="Open today’s music playlist">
        <span aria-hidden="true">≡</span>
        {variant === "arrival" ? (
          <>
            <span className="music-playlist-label">Playlist</span>
            <small>{playlist.length}</small>
          </>
        ) : null}
      </summary>
      <div className="music-playlist-card">
        <header>
          <div><small>TODAY’S LISTENING</small><strong>Calm focus playlist</strong></div>
          <span>{playlist.length} tracks</span>
        </header>
        <ol>
          {playlist.map((track, index) => (
            <li className={index === currentIndex ? "current" : ""} key={track.path}>
              <button onClick={() => onSelect(index)} aria-current={index === currentIndex ? "true" : undefined}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <span><strong>{track.name}</strong><small>{track.artist}</small></span>
                <i aria-hidden="true">{index === currentIndex ? "♪" : "▶"}</i>
              </button>
              <div>
                <a href={track.sourceUrl} target="_blank" rel="noreferrer" title={track.sourceLabel}>Source ↗</a>
                <a href={track.path} download={`${track.name.toLowerCase().replaceAll(" ", "-")}.mp3`}>Save MP3 ↓</a>
              </div>
            </li>
          ))}
        </ol>
        <footer>Locally hosted · source and download kept with every track</footer>
      </div>
    </details>
  );
}
