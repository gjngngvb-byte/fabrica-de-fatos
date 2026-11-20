import { useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { Image } from "@/components/ui/image";
import { cn } from "@/lib/utils";

export default function PhonePlayer({ scenes = [], audioUrl, title }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const total = scenes.length || 1;
  const active = Math.min(total - 1, Math.floor(progress * total));

  useEffect(() => {
    setProgress(0);
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
    if (el?.duration) setProgress(el.currentTime / el.duration);
  };

  return (
    <div className="relative mx-auto aspect-[9/16] w-full max-w-[330px] overflow-hidden rounded-[2rem] border border-border bg-black shadow-2xl shadow-black/50">
      {scenes.length === 0 && (
        <div className="absolute inset-0 grid place-items-center bg-gradient-to-b from-primary/20 via-card to-background px-6 text-center">
          <p className="font-display text-xl text-muted-foreground">Sem cenas ainda</p>
        </div>
      )}

      {scenes.map((scene, i) => (
        <div
          key={i}
          className={cn(
            "absolute inset-0 transition-opacity duration-700",
            i === active ? "opacity-100" : "opacity-0",
          )}
        >
          {scene.image_url ? (
            <Image
              src={scene.image_url}
              alt=""
              fittingType="fill"
              className="size-full object-cover transition-transform ease-out"
              style={{
                transform: i === active && playing ? "scale(1.08)" : "scale(1)",
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
        {scenes.map((_, i) => (
          <span key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/25">
            <span
              className="block h-full bg-white transition-[width] duration-200"
              style={{ width: i < active ? "100%" : i === active ? `${(progress * total - active) * 100}%` : "0%" }}
            />
          </span>
        ))}
      </div>

      <div className="absolute inset-x-0 bottom-0 p-5">
        <p className="line-clamp-4 text-[13px] font-medium leading-snug text-white drop-shadow">
          {scenes[active]?.narration || title}
        </p>
      </div>

      <button
        onClick={toggle}
        disabled={!audioUrl}
        className="absolute left-1/2 top-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/25 bg-black/40 text-white backdrop-blur-md transition-transform hover:scale-105 disabled:opacity-40"
        aria-label={playing ? "Pausar" : "Ouvir narração"}
      >
        {playing ? <Pause className="size-5" /> : <Play className="ml-0.5 size-5" />}
      </button>

      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="metadata" onTimeUpdate={onTime} onEnded={() => setPlaying(false)} />}
    </div>
  );
}