"use client";

function parseTimestampToSeconds(ts: string): number {
  // Handles HH:MM:SS, HH:MM:SS.mmm, MM:SS, MM:SS.mmm
  const parts = ts.trim().split(":");
  if (parts.length === 3) {
    return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]);
  }
  if (parts.length === 2) {
    return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(ts) || 0;
}

export function VideoTimestamp({ timestamp }: { timestamp: string }) {
  function handleClick() {
    const video = document.getElementById("video-player") as HTMLVideoElement | null;
    if (!video) return;
    video.currentTime = parseTimestampToSeconds(timestamp);
    video.scrollIntoView({ behavior: "smooth", block: "center" });
    video.play().catch(() => undefined);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="timestamp-link"
      title={`Jump to ${timestamp}`}
    >
      {timestamp}
    </button>
  );
}
