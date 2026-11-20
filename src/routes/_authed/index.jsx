import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sparkles, ArrowRight, Film, Radio, Repeat } from "lucide-react";
import SlotCard from "@/components/studio/SlotCard";
import { createManualVideo, ensureTodayPlan, generateVideoKit } from "@/lib/video-fns";

export const Route = createFileRoute("/_authed/")({
  head: () => ({ meta: [{ title: "Hoje — Estúdio" }] }),
  loader: () => ensureTodayPlan(),
  component: Today,
});

const VOICE_LABELS = { river: "calma", honey: "suave", sunny: "alegre", storm: "formal", spark: "energética" };

function Metric({ value, label, accent }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/40 px-4 py-4">
      <p className={`font-display text-3xl leading-none ${accent ? "text-primary" : "text-foreground"}`}>{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function Today() {
  const { videos, studio, today } = Route.useLoaderData();
  const router = useRouter();
  const generate = useServerFn(generateVideoKit);
  const createManual = useServerFn(createManualVideo);
  const [sceneCount, setSceneCount] = useState(0);

  const mutation = useMutation({
    mutationFn: async ({ videoId, sceneCount, manual = false }) => { const target = manual ? await createManual() : { id: videoId }; return generate({ data: { videoId: target.id, sceneCount } }); },
    onSuccess: () => {
      toast.success("Vídeo pronto para gravar.");
      router.invalidate();
    },
    onError: (error) => {
      toast.error(error?.message || "Não foi possível gerar agora.");
      router.invalidate();
    },
  });

  const ready = videos.filter((v) => v.status === "pronto").length;
  const published = videos.filter((v) => v.status === "publicado").length;

  const dateLabel = new Date(`${today}T12:00:00`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

  const recipe = [
    { icon: Film, label: "Formato", value: "Vertical 9:16 · narração" },
    { icon: Radio, label: "Voz", value: `Artificial · ${VOICE_LABELS[studio.voice] || "calma"}` },
    { icon: Repeat, label: "Ritmo", value: `${studio.videos_per_day} vídeos automáticos/dia` },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 lg:px-12 lg:py-14">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow capitalize">{dateLabel}</p>
          <h1 className="mt-3 font-display text-5xl leading-[0.95] tracking-tight lg:text-6xl">
            A fila de <span className="italic text-primary">hoje</span>
          </h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
            {studio.niche} viram vídeos verticais. A automação prepara {studio.videos_per_day} vídeos por dia, e você pode gerar quantos quiser manualmente.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <label className="flex h-11 items-center gap-2 rounded-full border border-border px-3 text-xs text-muted-foreground">
            Estilo<select value={sceneCount} onChange={(event) => setSceneCount(Number(event.target.value))} className="bg-transparent font-medium text-foreground outline-none"><option value={0}>Vídeo contínuo (padrão)</option><option value={3}>3 cenas</option></select>
          </label>
          <button
          onClick={() => mutation.mutate({ sceneCount, manual: true })} disabled={mutation.isPending}
          className="inline-flex h-11 shrink-0 items-center gap-2 self-start rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50 sm:self-auto"
        >
          <Sparkles className={`size-4 ${mutation.isPending ? "animate-pulse" : ""}`} />
          {mutation.isPending ? "Gerando…" : "Gerar vídeo"}
          </button>
        </div>
      </header>

      <div className="mt-10 grid gap-3 sm:grid-cols-3">
        <Metric value={ready} label="Roteiros prontos" accent />
        <Metric value={published} label="Publicados hoje" />
        <Metric value={Math.max(videos.length - ready - published, 0)} label="Na fila" />
      </div>

      <div className="mt-12 grid gap-8 lg:grid-cols-[1fr_300px]">
        <section>
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-sm font-medium">Lote de {videos.length}</h2>
            <Link to="/videos" className="text-xs text-muted-foreground hover:text-foreground">
              Ver biblioteca
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {videos.map((video, i) => (
              <SlotCard
                key={video.id}
                video={video}
                index={i}
                onGenerate={(v) => mutation.mutate({ videoId: v.id, sceneCount })}
                busy={mutation.isPending && mutation.variables?.videoId === video.id}
                style={{ animationDelay: `${i * 60}ms` }}
              />
            ))}
            <Link
              to="/configuracoes"
              className="flex min-h-[168px] flex-col justify-between rounded-2xl border border-dashed border-border/80 p-5 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <span className="font-mono text-[11px] tracking-[0.2em]">
                {String(videos.length + 1).padStart(2, "0")}
              </span>
              <span className="flex items-center gap-2 text-sm">
                Mudar o ritmo <ArrowRight className="size-4" />
              </span>
            </Link>
          </div>
        </section>

        <aside className="lg:sticky lg:top-10 lg:self-start">
          <div className="surface overflow-hidden">
            <div className="relative flex justify-center bg-gradient-to-b from-secondary/60 to-transparent px-6 pb-2 pt-6">
              <div className="relative aspect-[9/16] w-[112px] overflow-hidden rounded-xl border border-border/80 bg-gradient-to-b from-primary/25 via-card to-background">
                <div className="absolute inset-x-2 bottom-2 space-y-1">
                  <div className="h-1 w-3/4 rounded-full bg-foreground/25" />
                  <div className="h-1 w-1/2 rounded-full bg-foreground/15" />
                </div>
                <span className="absolute left-2 top-2 font-mono text-[9px] uppercase tracking-widest text-foreground/50">
                  9:16
                </span>
              </div>
            </div>
            <div className="space-y-4 p-5">
              <p className="eyebrow">Receita do estúdio</p>
              {recipe.map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-start gap-3">
                  <Icon className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
                    <p className="truncate text-sm">{value}</p>
                  </div>
                </div>
              ))}
              <div className="border-t border-border/70 pt-4">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Nicho</p>
                <p className="text-sm">{studio.niche}</p>
              </div>
              <Link to="/configuracoes" className="block pt-1 text-xs text-primary hover:opacity-80">
                Ajustar receita
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}