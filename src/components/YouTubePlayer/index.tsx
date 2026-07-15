'use client';

import { useEffect, useRef } from 'react';

/** A seek request. `nonce` changes on every click so seeking to the same
 *  timestamp twice still re-fires the effect. */
export interface SeekTarget {
  seconds: number;
  nonce: number;
}

interface YouTubePlayerProps {
  videoId: string;
  seekTarget: SeekTarget | null;
}

/**
 * An embedded YouTube player driven purely by the iframe's postMessage command
 * API (`enablejsapi=1`). We deliberately do NOT load YouTube's external
 * `iframe_api` script — that keeps the reader self-contained and lets tests run
 * without any third-party network dependency. The video is streamed by
 * YouTube in the iframe; Lector never downloads or hosts it (#334).
 *
 * `data-seek-seconds` mirrors the last seek target so end-to-end tests can
 * assert that a transcript click drove the player without reaching across the
 * cross-origin iframe boundary.
 */
export default function YouTubePlayer({ videoId, seekTarget }: YouTubePlayerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!seekTarget || !iframeRef.current?.contentWindow) return;
    const win = iframeRef.current.contentWindow;
    const command = (func: string, args: unknown[]) =>
      win.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
    // Seek, then play — matches YouTube's own "click a chapter" behaviour.
    command('seekTo', [Math.max(0, seekTarget.seconds), true]);
    command('playVideo', []);
  }, [seekTarget]);

  const src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?enablejsapi=1&rel=0`;

  return (
    <div
      data-testid="yt-player"
      data-video-id={videoId}
      data-seek-seconds={seekTarget ? Math.max(0, Math.floor(seekTarget.seconds)) : ''}
      className="aspect-video w-full overflow-hidden rounded-xl border border-border bg-black"
    >
      <iframe
        ref={iframeRef}
        className="h-full w-full"
        src={src}
        title="YouTube video player"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}
