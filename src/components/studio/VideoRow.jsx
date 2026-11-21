import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Trash2, Loader2 } from "lucide-react";
import StatusPill from "@/components/studio/StatusPill";

export default function VideoRow({ video, onDelete }) {
  const [deleting, setDeleting] = useState(false);
  const remove = async (event) => {
    event.preventDefault(); event.stopPropagation();
    if (!window.confirm("Excluir este vídeo permanentemente, incluindo imagens, áudios e MP4?")) return;
    setDeleting(true);
    try { await onDelete?.(video); } finally { setDeleting(false); }
  };
  return (
    <div
      to="/videos/$videoId"
      params={{ videoId: video.id }}
      className="group flex items-center gap-4 rounded-xl border border-transparent px-3 py-3.5 transition-colors hover:border-border hover:bg-card/60"
    >
      <div className="min-w-0 flex-1">
        <Link to="/videos/$videoId" params={{ videoId: video.id }} className="block truncate text-sm font-medium">
          {video.title || "Vídeo sem roteiro"}
        </Link>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {video.hook || video.fact || "Aguardando geração"}
        </p>
      </div>
      <span className="hidden shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground sm:block">
        {video.scheduled_date || ""}
      </span>
      <StatusPill status={video.status === "pronto" && !video.mp4_url ? "roteiro" : video.status} />
      <Link to="/videos/$videoId" params={{ videoId: video.id }} className="sr-only">Abrir vídeo</Link>
      <button type="button" onClick={remove} disabled={deleting} title="Excluir permanentemente" aria-label="Excluir vídeo" className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50">
        {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      </button>
    </div>
  );
}