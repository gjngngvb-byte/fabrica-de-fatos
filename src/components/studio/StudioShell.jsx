import { Outlet, Link, useRouterState } from "@tanstack/react-router";
import { Sparkles, Layers, SlidersHorizontal, LogOut, Music2 } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Hoje", icon: Sparkles },
  { to: "/videos", label: "Biblioteca", icon: Layers },
  { to: "/musicas", label: "Músicas", icon: Music2 },
  { to: "/configuracoes", label: "Ajustes", icon: SlidersHorizontal },
];

export default function StudioShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-border bg-background/85 px-5 py-4 backdrop-blur-xl lg:h-screen lg:flex-col lg:items-stretch lg:justify-start lg:border-b-0 lg:border-r lg:px-6 lg:py-8">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <span className="font-display text-lg leading-none">f</span>
          </span>
          <span className="hidden text-sm font-medium tracking-tight sm:block">
            Fábrica <span className="text-muted-foreground">de vídeos</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1 lg:mt-10 lg:flex-col lg:items-stretch lg:gap-1">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active = pathname === to || (to !== "/" && pathname.startsWith(to));
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                <span className={cn(!active && "lg:opacity-90")}>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="hidden lg:mt-auto lg:block">
          <div className="mb-3 h-px w-full hairline" />
          <p className="truncate text-xs text-muted-foreground">{user?.full_name || user?.email}</p>
          <button
            onClick={() => logout()}
            className="mt-2 flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <LogOut className="size-3.5" /> Sair
          </button>
        </div>
      </aside>

      <main className="min-w-0 pb-20 lg:pb-0">
        <Outlet />
      </main>
    </div>
  );
}