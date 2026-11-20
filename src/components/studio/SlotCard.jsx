import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Loader2, Sparkles } from "lucide-react";
import StatusPill from "@/components/studio/StatusPill";
import { cn } from "@/lib/utils";

export default function SlotCard({ video, index, onGenerate, busy, style }) {
  const ready = video?.status === "pronto" || video?.status === "publicado";

  return (
    <article
      style={style}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card/60 p-5 transition-colors duration-300",
        "hover:border-primary/35 hover:bg-card/90 animate-rise",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] tracking-[0.2em] text-muted-foreground">
          {String(index + 1).padStart(2, "0")}
        </span>
        <StatusPill status={video?.status === "pronto" && !video?.mp4_url ? "roteiro" : video?.status || "planejado"} />
      </div>

      <div className="mt-6 min-h-[92px]">
        {video?.title ? (
          <>
            <h3 className="font-display text-2xl leading-tight tracking-tight">{video.title}</h3>
            <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
              {video.hook || video.fact}
            </p>
          </>
        ) : (
          <>
            <h3 className="font-display text-2xl leading-tight text-muted-foreground/70">
              Aguardando roteiro
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground/60">
              Um fato surpreendente entra na fila e sai pronto para gravar.
            </p>
          </>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-border/70 pt-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {video?.scenes?.length ? `${video.scenes.length} cenas` : "9:16"}
        </span>

        {ready ? (
          <Link
            to="/videos/$videoId"
            params={{ videoId: video.id }}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-opacity hover:opacity-80"
          >
            Abrir <ArrowUpRight className="size-3.5" />
          </Link>
        ) : (
          <button
            onClick={() => onGenerate?.(video)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {busy ? "Gerando" : "Gerar"}
          </button>
        )}
      </div>
    </article>
  );
}