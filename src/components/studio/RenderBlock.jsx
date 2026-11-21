import { useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, Film, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import PhonePlayer from "@/components/studio/PhonePlayer";
import { startRender, checkRender } from "@/lib/render-fns";

const POLL_MS = 7000;

function normalizeProgress(value) {
  const raw = typeof value === "number" ? value : value?.percent ?? value?.percentage ?? value?.progress;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return Math.max(0, Math.min(100, Math.round(raw <= 1 ? raw * 100 : raw)));
}

export default function RenderBlock({ video }) {
  const router = useRouter();
  const start = useServerFn(startRender);
  const check = useServerFn(checkRender);
  const [render, setRender] = useState({
    status: video.render_status || (video.mp4_url ? "pronto" : "ocioso"),
    url: video.mp4_url || "",
    error: video.render_error || "",
    progress: null,
    detail: "",
  });
  const [busy, setBusy] = useState(false);
  const autoStarted = useRef(false);
  const [downloading, setDownloading] = useState(false);

  const rendering = render.status === "renderizando" || render.status === "ajustando_proporcao" || render.status === "finalizando_arquivo";

  useEffect(() => {
    if (!rendering) return;
    let cancelled = false;
    let checking = false;

    const poll = async () => {
      if (checking) return;
      checking = true;
      try {
        const result = await check({ data: { videoId: video.id } });
        if (cancelled || !result) return;
        const fresh = result.video || result;
        setRender({
          status: fresh.render_status || result.status || "renderizando",
          url: fresh.mp4_url || "",
          error: fresh.render_error || "",
          progress: normalizeProgress(result.progress ?? result.progress_percent),
          detail: [result.stage ? "Etapa: " + result.stage : "", result.message || result.detail || ""].filter(Boolean).join(" · "),
        });
        if (fresh.render_status === "pronto" && fresh.mp4_url) {
          toast.success("MP4 verificado e pronto para baixar.");
          router.invalidate();
        }
        if (fresh.render_status === "falhou") toast.error(fresh.render_error || "A renderização falhou.");
      } catch (error) {
        if (!cancelled) setRender((current) => ({ ...current, detail: error?.message || "Falha temporária na consulta. Tentando novamente." }));
      } finally {
        checking = false;
      }
    };

    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [rendering, video.id, check, router]);

  const build = async () => {
    setBusy(true);
    try {
      const result = await start({ data: { videoId: video.id } });
      setRender({
        status: result?.video?.render_status || "renderizando",
        url: "",
        error: "",
        progress: normalizeProgress(result?.progress),
        detail: "Pedido recebido. Aguardando processamento da Agnes AI.",
      });
      toast.success("Geração iniciada. O status será verificado automaticamente.");
    } catch (error) {
      toast.error(error?.message || "Não foi possível iniciar a geração.");
      setRender((current) => ({ ...current, status: "falhou", error: error?.message || "Falha ao iniciar." }));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    // Segurança adicional: se um vídeo com roteiro chegar sem render iniciada,
    // dispara a criação do MP4 automaticamente ao abrir seus detalhes.
    if (autoStarted.current || !video.script || video.mp4_url || rendering || busy) return;
    if (render.status !== "ocioso" && render.status !== "falhou") return;
    autoStarted.current = true;
    build();
  }, [video.id, video.script, video.mp4_url, render.status, rendering, busy]);

  const downloadMp4 = async () => {
    if (!render.url) return;
    setDownloading(true);
    try {
      const response = await fetch(render.url);
      if (!response.ok) throw new Error("O arquivo MP4 não está acessível. Tente atualizar a página.");
      const blob = await response.blob();
      if (!blob.size || (blob.type && !blob.type.includes("video"))) throw new Error("O arquivo baixado não passou na verificação.");
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = (video.title || "video-tiktok").replace(/[^a-z0-9-_]+/gi, "-").slice(0, 70) + ".mp4";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      toast.error(error?.message || "Não foi possível baixar o MP4.");
    } finally {
      setDownloading(false);
    }
  };

  if (render.url && render.status === "pronto") {
    return (
      <div>
        <video
          src={render.url}
          controls
          playsInline
          preload="metadata"
          className="aspect-[9/16] w-full rounded-[2rem] border border-border bg-black object-cover shadow-2xl shadow-black/50"
        />
        <div className="mt-3 flex items-center gap-2 text-xs text-emerald-500">
          <CheckCircle2 className="size-4" /> MP4 validado e armazenado
        </div>
        <div className="mt-4 space-y-2">
          <button
            onClick={downloadMp4}
            disabled={downloading}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {downloading ? "Baixando MP4…" : "Baixar MP4"}
          </button>
          <button
            onClick={build}
            disabled={busy || rendering}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-full border border-border text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Film className="size-3.5" />}
            {busy ? "Enviando" : "Gerar novamente"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PhonePlayer scenes={video.scenes || []} audioUrl={video.audio_url} title={video.title} />
      <div className="mt-5 space-y-3">
        <div className="flex h-11 w-full items-center justify-center gap-2 rounded-full border border-border bg-card/50 text-xs font-semibold text-muted-foreground">
          {busy || rendering ? <Loader2 className="size-4 animate-spin" /> : render.status === "falhou" ? <AlertCircle className="size-4" /> : <Film className="size-4" />}
          {render.status === "ajustando_proporcao" ? "Ajustando formato 9:16…" : render.status === "finalizando_arquivo" ? "Preparando arquivo MP4…" : rendering || busy ? "Gerando MP4 automaticamente…" : render.status === "falhou" ? "Falha ao gerar MP4 automaticamente" : "Preparando geração automática…"}
        </div>

        {rendering && (
          <div className="rounded-xl border border-border bg-card/60 p-3">
            <div className="mb-2 flex items-center justify-between gap-3 text-[11px]">
              <span className="font-medium text-foreground">
                {render.status === "ajustando_proporcao" ? "Validando enquadramento" : render.status === "finalizando_arquivo" ? "Preparando arquivo para download" : "Agnes AI · processamento e validação"}
              </span>
              <span className="font-mono text-muted-foreground">
                {render.progress === null ? "Progresso não informado" : render.progress + "%"}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              {render.progress === null ? (
                <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
              ) : (
                <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: render.progress + "%" }} />
              )}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              {render.detail || "Consultando a etapa atual da geração, validação e armazenamento do MP4."}
            </p>
          </div>
        )}

        {render.status === "falhou" && (
          <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-[11px] text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" /> {render.error || "A geração falhou. Tente novamente."}
          </p>
        )}

        {!rendering && render.status !== "falhou" && (
          <p className="text-center font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            MP4 vertical 9:16 · 720p · verificação automática antes de liberar o download
          </p>
        )}
      </div>
    </div>
  );
}
