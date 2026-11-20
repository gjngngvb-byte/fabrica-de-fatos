import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import VideoRow from "@/components/studio/VideoRow";
import { listVideos } from "@/lib/video-fns";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/videos/")({
  head: () => ({ meta: [{ title: "Biblioteca — Estúdio" }] }),
  component: Library,
});

const FILTERS = [
  { value: "", label: "Todos" },
  { value: "pronto", label: "Roteiros" },
  { value: "publicado", label: "Publicados" },
  { value: "planejado", label: "Na fila" },
  { value: "falhou", label: "Falhas" },
];

function Library() {
  const [status, setStatus] = useState("");
  const list = useServerFn(listVideos);
  const { data: videos = [], isLoading } = useQuery({
    queryKey: ["videos", status],
    queryFn: () => list({ data: { status } }),
  });

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-8 lg:px-12 lg:py-14">
      <p className="eyebrow">Acervo</p>
      <h1 className="mt-3 font-display text-5xl leading-none tracking-tight">Biblioteca</h1>
      <p className="mt-3 text-sm text-muted-foreground">Tudo que a fábrica já escreveu, gravou ou publicou.</p>

      <div className="mt-8 flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            onClick={() => setStatus(filter.value)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-xs transition-colors",
              status === filter.value
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="mt-6 divide-y divide-border/60">
        {isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>}
        {!isLoading && videos.length === 0 && (
          <div className="py-16 text-center">
            <p className="font-display text-2xl text-muted-foreground">Nada por aqui ainda</p>
            <Link to="/" className="mt-3 inline-block text-sm text-primary hover:opacity-80">
              Gerar os vídeos de hoje
            </Link>
          </div>
        )}
        {videos.map((video) => (
          <VideoRow key={video.id} video={video} />
        ))}
      </div>
    </div>
  );
}