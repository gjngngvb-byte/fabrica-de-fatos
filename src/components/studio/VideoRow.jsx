import { Link } from "@tanstack/react-router";
import StatusPill from "@/components/studio/StatusPill";

export default function VideoRow({ video }) {
  return (
    <Link
      to="/videos/$videoId"
      params={{ videoId: video.id }}
      className="group flex items-center gap-4 rounded-xl border border-transparent px-3 py-3.5 transition-colors hover:border-border hover:bg-card/60"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {video.title || "Vídeo sem roteiro"}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {video.hook || video.fact || "Aguardando geração"}
        </p>
      </div>
      <span className="hidden shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground sm:block">
        {video.scheduled_date || ""}
      </span>
      <StatusPill status={video.status} />
    </Link>
  );
}