import { useEffect, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { getStudio, saveStudio } from "@/lib/video-fns";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/_authed/configuracoes")({
  head: () => ({ meta: [{ title: "Ajustes — Estúdio" }] }),
  loader: () => getStudio(),
  component: Settings,
});

const VOICES = [
  { value: "river", label: "Calma e neutra" },
  { value: "honey", label: "Quente e suave" },
  { value: "sunny", label: "Alegre e rápida" },
  { value: "storm", label: "Formal e autoritária" },
  { value: "spark", label: "Energética" },
];

const inputClass =
  "h-10 w-full rounded-lg border border-border bg-secondary/60 px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/60";

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1.5 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Settings() {
  const studio = Route.useLoaderData();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [saving, setSaving] = useState(false);
  const [tiktok, setTiktok] = useState({ loading: true, connected: false, account: null, busy: false });
  useEffect(() => {
    supabase.functions.invoke("tiktok-connect", { body: { action: "status" } }).then(({ data, error }) => {
      setTiktok({ loading: false, connected: !!data?.connected, account: data?.account || null, busy: false });
      if (error) console.warn("TikTok status:", error.message);
    });
  }, []);
  const connectTikTok = async () => {
    setTiktok((v) => ({ ...v, busy: true }));
    const { data, error } = await supabase.functions.invoke("tiktok-connect", { body: { action: "start" } });
    if (error || data?.error) {
      toast.error(data?.error || error?.message || "Não foi possível iniciar a conexão TikTok.");
      setTiktok((v) => ({ ...v, busy: false }));
      return;
    }
    window.location.href = data.url;
  };
  const [form, setForm] = useState({
    niche: studio.niche || "",
    tone: studio.tone || "",
    voice: studio.voice || "river",
    videos_per_day: studio.videos_per_day || 5,
    duration_target: studio.duration_target || 30,
    visual_style: studio.visual_style || "",
    cta: studio.cta || "",
    avoid: studio.avoid || "",
    hashtagsText: (studio.base_hashtags || []).join(", "),
  });

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await saveStudio({
        data: {
          niche: form.niche,
          tone: form.tone,
          language: "pt-BR",
          voice: form.voice,
          videos_per_day: Number(form.videos_per_day) || 5,
          duration_target: Number(form.duration_target) || 30,
          visual_style: form.visual_style,
          base_hashtags: form.hashtagsText
            .split(",")
            .map((tag) => tag.trim().replace(/^#/, ""))
            .filter(Boolean)
            .slice(0, 10),
          cta: form.cta,
          avoid: form.avoid,
        },
      });
      await router.invalidate();
      toast.success("Receita salva.");
    } catch (error) {
      toast.error(error?.message || "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-8 lg:px-12 lg:py-14">
      <p className="eyebrow">Receita</p>
      <h1 className="mt-3 font-display text-5xl leading-none tracking-tight">Ajustes</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Tudo o que a fábrica usa para escrever, narrar e desenhar cada vídeo.
      </p>

      <section className="mt-8 rounded-2xl border border-border/70 bg-card/40 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div><p className="text-sm font-medium">Conta TikTok</p><p className="mt-1 text-xs text-muted-foreground">{tiktok.loading ? "Verificando conexão..." : tiktok.connected ? `Conectada${tiktok.account?.display_name ? ` como ${tiktok.account.display_name}` : ""}` : "Conecte para habilitar a publicação dos vídeos."}</p></div>
          <button type="button" onClick={connectTikTok} disabled={tiktok.busy || tiktok.loading || tiktok.connected} className="inline-flex h-10 items-center rounded-full bg-foreground px-4 text-xs font-medium text-background disabled:opacity-50">{tiktok.busy ? "Conectando..." : tiktok.connected ? "Conectada" : "Conectar TikTok"}</button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">A publicação direta depende da aprovação do app nas permissões de publicação do TikTok.</p>
      </section>

      <form onSubmit={submit} className="mt-10 space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Nicho">
            <input className={inputClass} value={form.niche} onChange={(e) => set("niche", e.target.value)} />
          </Field>
          <Field label="Tom de voz">
            <input className={inputClass} value={form.tone} onChange={(e) => set("tone", e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Voz artificial">
            <select className={inputClass} value={form.voice} onChange={(e) => set("voice", e.target.value)}>
              {VOICES.map((voice) => (
                <option key={voice.value} value={voice.value} className="bg-card">
                  {voice.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Vídeos por dia">
            <select
              className={inputClass}
              value={form.videos_per_day}
              onChange={(e) => set("videos_per_day", e.target.value)}
            >
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n} className="bg-card">
                  {n} por dia
                </option>
              ))}
            </select>
          </Field>
          <Field label="Duração alvo (s)">
            <input
              type="number"
              min={10}
              max={90}
              className={inputClass}
              value={form.duration_target}
              onChange={(e) => set("duration_target", e.target.value)}
            />
          </Field>
        </div>

        <Field label="Estilo visual" hint="Aparece em toda imagem gerada.">
          <textarea
            rows={3}
            className="w-full rounded-lg border border-border bg-secondary/60 px-3 py-2 text-sm outline-none transition-colors focus:border-primary/60"
            value={form.visual_style}
            onChange={(e) => set("visual_style", e.target.value)}
          />
        </Field>

        <Field label="Chamada final" hint="Entra no fim da legenda de cada vídeo.">
          <input className={inputClass} value={form.cta} onChange={(e) => set("cta", e.target.value)} />
        </Field>

        <Field label="Hashtags fixas" hint="Separadas por vírgula, sem o símbolo #.">
          <input
            className={inputClass}
            value={form.hashtagsText}
            onChange={(e) => set("hashtagsText", e.target.value)}
          />
        </Field>

        <Field label="Temas proibidos" hint="Assuntos que a fábrica nunca deve abordar.">
          <input className={inputClass} value={form.avoid} onChange={(e) => set("avoid", e.target.value)} />
        </Field>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50"
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          {saving ? "Salvando" : "Salvar receita"}
        </button>
      </form>

      <div className="mt-14 border-t border-border/70 pt-6 lg:hidden">
        <p className="text-xs text-muted-foreground">{user?.full_name || user?.email}</p>
        <button
          onClick={() => logout()}
          className="mt-2 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Sair da conta
        </button>
      </div>
    </div>
  );
}