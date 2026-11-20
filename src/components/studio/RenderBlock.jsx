import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, Film, Loader2 } from "lucide-react";
import PhonePlayer from "@/components/studio/PhonePlayer";
import { startRender, checkRender } from "@/lib/render-fns";

const POLL_MS = 15000;

export default function RenderBlock({ video }) {
  const router = useRouter();
  const start = useServerFn(startRender);
  const check = useServerFn(checkRender);
  const [render, setRender] = useState({
    status: video.render_status || "ocioso",
    url: video.mp4_url || "",
    error: video.render_error || "",
  });
  const [busy, setBusy] = useState(false);

  const rendering = render.status === "renderizando";

  useEffect(() => {
    if (!rendering) return;
    let cancelled = false;

    const timer = setInterval(async () => {
      try {
        const fresh = await check({ data: { videoId: video.id } });
        if (cancelled || !fresh) return;
        setRender({
          status: fresh.render_status || "ocioso",
          url: fresh.mp4_url || "",
          error: fresh.render_error || "",
        });
        if (fresh.render_status === "pronto") {
          toast.success("Vídeo MP4 pronto.");
          router.invalidate();
        }
        if (fresh.render_status === "falhou") toast.error("A renderização falhou.");
      } catch {
        // silencioso: o próximo ciclo tenta de novo
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [rendering, video.id, check, router]);

  const build = async () => {
    setBusy(true);
    try {
      await start({ data: { videoId: video.id } });
      setRender({ status: "renderizando", url: "", error: "" });
      toast.success("Renderizando o MP4. Leva alguns minutos.");
    } catch (error) {
      toast.error(error?.message || "Não foi possível montar o vídeo.");
    } finally {
      setBusy(false);
    }
  };

  if (render.url) {
    return (
      <div>
        <video
          src={render.url}
          controls
          playsInline
          className="aspect-[9/16] w-full rounded-[2rem] border border-border bg-black object-cover shadow-2xl shadow-black/50"
        />
        <div className="mt-5 space-y-2">
          <a
            href={render.url}
            download
            target="_blank"
            rel="noreferrer"
            className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-primary text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Download className="size-3.5" /> Baixar MP4
          </a>
          <button
            onClick={build}
            disabled={busy}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-full border border-border text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Film className="size-3.5" />}
            {busy ? "Enviando" : "Montar de novo"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PhonePlayer scenes={video.scenes || []} audioUrl={video.audio_url} title={video.title} />
      <div className="mt-5 space-y-2">
        <button
          onClick={build}
          disabled={busy || rendering || !video.script}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-primary text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy || rendering ? <Loader2 className="size-3.5 animate-spin" /> : <Film className="size-3.5" />}
          {rendering ? "Renderizando…" : busy ? "Enviando" : "Montar vídeo MP4"}
        </button>
        <p className="text-center font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {rendering ? "pode sair desta página" : "15s · 9:16 · 720p"}
        </p>
        {render.error && <p className="text-center text-[11px] text-destructive">{render.error}</p>}
      </div>
    </div>
  );
}