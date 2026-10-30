"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

/** Decorative silent media: lazy loading, pause offscreen, and an explicit motion control. */
export function AmbientVideo({
  src,
  poster,
  label,
  showControls = true,
}: {
  src: string;
  poster: string;
  label: string;
  showControls?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [reduced, setReduced] = useState(true);
  const [choice, setChoice] = useState<boolean | null>(null);
  const [playing, setPlaying] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => {
      setReduced(media.matches);
      setChoice(null);
    };
    const updateVisibility = () => setPageVisible(!document.hidden);
    updateMotion();
    updateVisibility();
    media.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    const preloader = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setNear(true);
          preloader.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    const observer = new IntersectionObserver(
      (entries) => setInView(entries[0].isIntersecting),
      { threshold: 0.05 },
    );
    preloader.observe(element);
    observer.observe(element);
    return () => {
      preloader.disconnect();
      observer.disconnect();
      media.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  useEffect(() => {
    const player = video.current;
    if (!player || !near || failed) return;
    if (inView && pageVisible && (choice ?? !reduced)) {
      void player.play().catch(() => setPlaying(false));
    } else player.pause();
    return () => player.pause();
  }, [near, inView, pageVisible, reduced, choice, failed]);

  return (
    <div
      ref={container}
      className={`ambient-video ${hasFrame && !failed ? "has-frame" : ""}`}
    >
      {/* Native img keeps the static poster available with JavaScript disabled. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="ambient-video-poster"
        src={poster}
        alt={label}
        width={640}
        height={330}
      />
      <video
        ref={video}
        src={near && (!reduced || choice === true) ? src : undefined}
        poster={poster}
        preload="none"
        muted
        loop
        playsInline
        disablePictureInPicture
        aria-hidden="true"
        tabIndex={-1}
        onPlaying={() => {
          setPlaying(true);
          setHasFrame(true);
        }}
        onPause={() => setPlaying(false)}
        onError={() => setFailed(true)}
      />
      {showControls && !failed && (
        <button
          type="button"
          className="ambient-video-toggle"
          onClick={() => {
            setNear(true);
            setChoice(!playing);
          }}
          aria-label={playing ? "Остановить видео" : "Воспроизвести видео"}
        >
          {playing ? (
            <Pause size={13} fill="currentColor" />
          ) : (
            <Play size={13} fill="currentColor" />
          )}
          <span>{playing ? "Пауза" : "Смотреть"}</span>
        </button>
      )}
      {failed && (
        <span className="sr-only" role="status">
          Анимация недоступна. Показано изображение.
        </span>
      )}
    </div>
  );
}
