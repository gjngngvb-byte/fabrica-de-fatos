import { useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { Image } from "@/components/ui/image";
import { cn } from "@/lib/utils";

export default function PhonePlayer({
  scenes = [], audioUrl, title, introImageUrl = "", outroImageUrl = "",
  introText = "", introTitle = "", outroText = "", channelName = "",
}) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const introDuration = introImageUrl ? 3 : 0;
  const outroDuration = outroImageUrl ? 3 : 0;
  const introActive = Boolean(introImageUrl) && currentTime < introDuration;
  const outroActive = Boolean(outroImageUrl) && duration > 0 && currentTime >= duration - outroDuration;
  const timedScene = duration > 0
    ? scenes.findIndex((scene) => currentTime >= Number(scene.start_seconds || 0) && currentTime < Number(scene.end_seconds || 0))
    : -1;
  const active = Math.min(Math.max(0, scenes.length - 1), timedScene >= 0 ? timedScene : Math.floor(progress * scenes.length));
  const visualItems = [
    ...(introImageUrl ? [{ type: "intro", image_url: introImageUrl }] : []),
    ...scenes.map((scene) => ({ type: "scene", ...scene })),
    ...(outroImageUrl ? [{ type: "outro", image_url: outroImageUrl }] : []),
  ];
  const activeVisual = introActive ? 0 : outroActive ? visualItems.length - 1 : active + (introImageUrl ? 1 : 0);
  const activeScene = scenes[active];
  const sceneVisualStart = Math.max(Number(activeScene?.start_seconds || 0), active === 0 && introImageUrl ? introDuration : 0);
  const sceneVisualEnd = Math.min(Number(activeScene?.end_seconds || duration), active === scenes.length - 1 && outroImageUrl ? duration - outroDuration : duration);
  const activeVisualProgress = introActive
    ? currentTime / Math.max(0.1, introDuration)
    : outroActive
      ? (currentTime - (duration - outroDuration)) / Math.max(0.1, outroDuration)
      : duration > 0
        ? (currentTime - sceneVisualStart) / Math.max(0.1, sceneVisualEnd - sceneVisualStart)
        : progress * visualItems.length - activeVisual;

  useEffect(() => {
    setProgress(0);
    setCurrentTime(0);
    setDuration(0);
    setPlaying(false);
  }, [audioUrl]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  const onTime = () => {
    const el = audioRef.current;
    if (el?.duration) {
      setProgress(el.currentTime / el.duration);
      setCurrentTime(el.currentTime);
      setDuration(el.duration);
    }
  };

  return (
    <div className="relative mx-auto aspect-[9/16] w-full max-w-[330px] overflow-hidden rounded-[2rem] border border-border bg-black shadow-2xl shadow-black/50">
      {scenes.length === 0 && (
        <div className="absolute inset-0 grid place-items-center bg-gradient-to-b from-primary/20 via-card to-background px-6 text-center">
          <p className="font-display text-xl text-muted-foreground">Sem cenas ainda</p>
        </div>
      )}

      {visualItems.map((scene, i) => (
        <div
          key={i}
          className={cn(
            "absolute inset-0 transition-opacity duration-700",
            i === activeVisual ? "opacity-100" : "opacity-0",
          )}
        >
          {scene.image_url ? (
            <Image
              src={scene.image_url}
              alt=""
              fittingType="fill"
              className="size-full object-cover transition-transform ease-out"
              style={{
                transform: i === activeVisual && playing ? "scale(1.08)" : "scale(1)",
                transitionDuration: "7000ms",
              }}
            />
          ) : (
            <div className="size-full bg-gradient-to-b from-primary/25 via-card to-background" />
          )}
        </div>
      ))}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/5 to-black/45" />

      <div className="absolute inset-x-3 top-3 flex gap-1">
        {visualItems.map((_, i) => (
          <span key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/25">
            <span
              className="block h-full bg-white transition-[width] duration-200"
              style={{ width: i < activeVisual ? "100%" : i === activeVisual ? `${Math.max(0, Math.min(100, activeVisualProgress * 100))}%` : "0%" }}
            />
          </span>
        ))}
      </div>

      <div className="absolute inset-x-0 bottom-0 p-5">
        {introActive ? (
          <div className="rounded-xl bg-black/55 p-3 text-center text-white shadow-lg backdrop-blur-sm">
            {introTitle && <p className="mb-2 text-base font-bold leading-tight drop-shadow">{introTitle}</p>}
            {introText && <p className="text-sm font-medium leading-snug drop-shadow">{introText}</p>}
          </div>
        ) : outroActive ? (
          <div className="rounded-xl bg-black/55 p-3 text-center text-white shadow-lg backdrop-blur-sm">
            {outroText && <p className="text-sm font-semibold leading-snug drop-shadow">{outroText}</p>}
            {channelName && <p className="mt-2 text-sm font-bold leading-snug drop-shadow">no {channelName}</p>}
          </div>
        ) : (
          <p className="line-clamp-4 text-[13px] font-medium leading-snug text-white drop-shadow">
            {scenes[active]?.narration || title}
          </p>
        )}
      </div>

      <button
        onClick={toggle}
        disabled={!audioUrl}
        className="absolute left-1/2 top-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/25 bg-black/40 text-white backdrop-blur-md transition-transform hover:scale-105 disabled:opacity-40"
        aria-label={playing ? "Pausar" : "Ouvir narração"}
      >
        {playing ? <Pause className="size-5" /> : <Play className="ml-0.5 size-5" />}
      </button>

      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="none" onTimeUpdate={onTime} onEnded={() => setPlaying(false)} />}
    </div>
  );
}