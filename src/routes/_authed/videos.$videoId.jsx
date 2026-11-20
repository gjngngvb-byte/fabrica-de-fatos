import { useState } from "react";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowLeft, Copy, Download, RefreshCw, Check, Loader2 } from "lucide-react";
import RenderBlock from "@/components/studio/RenderBlock";
import { supabase } from "@/lib/supabase";
import StatusPill from "@/components/studio/StatusPill";
import { Image } from "@/components/ui/image";
import { getVideo, generateVideoKit, markPublished } from "@/lib/video-fns";

export const Route = createFileRoute("/_authed/videos/$videoId")({
  head: () => ({ meta: [{ title: "Vídeo — Estúdio" }] }),
  loader: async ({ params }) => {
    const video = await getVideo({ data: { videoId: params.videoId } });
    if (!video) throw notFound();
    return video;
  },
  component: VideoDetail,
});

function VideoDetail() {
  const video = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [publishing, setPublishing] = useState(false);

  const run = async (key, action, message) => {
    setBusy(key);
    try {
      await action();
      await router.invalidate();
      if (message) toast.success(message);
    } catch (error) {
      toast.error(error?.message || "Algo falhou. Tente de novo.");
    } finally {
      setBusy("");
    }
  };

  const captionText = [video.caption, (video.hashtags || []).map((h) => `#${h}`).join(" ")]
    .filter(Boolean)
    .join("\n\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(captionText);
      toast.success("Legenda copiada.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  const published = video.status === "publicado";

  const publishToTikTok = async () => {
    setPublishing(true);
    const { data, error } = await supabase.functions.invoke("tiktok-publish", { body: { videoId: video.id } });
    setPublishing(false);
    if (error || data?.error) { toast.error(data?.error || error?.message || "Falha ao publicar no TikTok."); return; }
    toast.success("Vídeo enviado ao TikTok para processamento.");
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 lg:px-12 lg:py-12">
      <Link to="/videos" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Biblioteca
      </Link>

      <header className="mt-6 flex flex-wrap items-center gap-3">
        <StatusPill status={video.status === "pronto" && !video.mp4_url ? "roteiro" : video.status} />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {video.scheduled_date} · {video.scenes?.length || 0} cenas
        </span>
      </header>
      <h1 className="mt-4 max-w-2xl font-display text-4xl leading-[1.05] tracking-tight lg:text-5xl">
        {video.title || "Vídeo sem roteiro"}
      </h1>
      {video.hook && <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">{video.hook}</p>}

      <div className="mt-10 grid gap-10 lg:grid-cols-[330px_1fr]">
        <div className="lg:sticky lg:top-8 lg:self-start">
          <RenderBlock video={video} />

          {video.mp4_url && <button onClick={publishToTikTok} disabled={publishing} className="mt-3 flex h-11 w-full items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-50">{publishing ? "Enviando ao TikTok..." : "Publicar no TikTok"}</button>}

          <div className="mt-5 space-y-2">
            <button
              onClick={() => run("publish", () => markPublished({ data: { videoId: video.id, published: !published } }), published ? "Marcado como pronto." : "Marcado como publicado.")}
              disabled={!!busy || !video.title}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-foreground text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy === "publish" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              {published ? "Voltar para pronto" : "Marcar como publicado"}
            </button>

            <button
              onClick={() => run("regen", () => generateVideoKit({ data: { videoId: video.id } }), "Novo vídeo gerado.")}
              disabled={!!busy}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-full border border-border text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              {busy === "regen" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {busy === "regen" ? "Gerando de novo" : "Gerar outra versão"}
            </button>

            {video.audio_url && (
              <a
                href={video.audio_url}
                target="_blank"
                rel="noreferrer"
                className="flex h-10 w-full items-center justify-center gap-2 rounded-full border border-border text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <Download className="size-3.5" /> Baixar narração
              </a>
            )}
          </div>
        </div>

        <div className="min-w-0 space-y-10">
          {video.caption && (
            <section>
              <div className="flex items-center justify-between">
                <p className="eyebrow">Legenda</p>
                <button onClick={copy} className="inline-flex items-center gap-1.5 text-xs text-primary hover:opacity-80">
                  <Copy className="size-3.5" /> Copiar
                </button>
              </div>
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">{video.caption}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(video.hashtags || []).map((tag) => (
                  <span key={tag} className="rounded-full border border-border px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    #{tag}
                  </span>
                ))}
              </div>
            </section>
          )}

          {video.script && (
            <section>
              <p className="eyebrow">Roteiro narrado</p>
              <p className="mt-3 whitespace-pre-line border-l border-primary/30 pl-4 text-sm leading-relaxed text-foreground/90">
                {video.script}
              </p>
            </section>
          )}

          {video.fact && (
            <section>
              <p className="eyebrow">O fato</p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{video.fact}</p>
            </section>
          )}

          {video.scenes?.length > 0 && (
            <section>
              <p className="eyebrow">Cenas</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {video.scenes.map((scene, i) => (
                  <div key={i} className="overflow-hidden rounded-xl border border-border bg-card/50">
                    <div className="relative aspect-[9/16] bg-secondary">
                      {scene.image_url ? (
                        <Image src={scene.image_url} alt="" fittingType="fill" className="size-full object-cover" />
                      ) : (
                        <div className="size-full bg-gradient-to-b from-primary/15 to-transparent" />
                      )}
                      <span className="absolute left-2 top-2 font-mono text-[10px] text-white/70">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <p className="p-3 text-[11px] leading-relaxed text-muted-foreground">{scene.narration}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {video.error && (
            <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              {video.error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}