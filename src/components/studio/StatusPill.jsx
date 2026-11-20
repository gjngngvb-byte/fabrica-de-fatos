import { cn } from "@/lib/utils";

const STYLES = {
  planejado: "text-muted-foreground border-border bg-secondary/60",
  roteiro: "text-amber-300/90 border-amber-400/25 bg-amber-400/10",
  pronto: "text-emerald-300/90 border-emerald-400/25 bg-emerald-400/10",
  publicado: "text-sky-300/90 border-sky-400/25 bg-sky-400/10",
  falhou: "text-red-300/90 border-red-400/25 bg-red-400/10",
};

const LABELS = {
  planejado: "Na fila",
  roteiro: "Em produção",
  pronto: "Pronto",
  publicado: "Publicado",
  falhou: "Falhou",
};

export default function StatusPill({ status = "planejado", className }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
        STYLES[status] || STYLES.planejado,
        className,
      )}
    >
      <span className="size-1 rounded-full bg-current" />
      {LABELS[status] || status}
    </span>
  );
}