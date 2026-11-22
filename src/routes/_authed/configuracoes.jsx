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
    duration_target: Math.min(300, Math.max(120, studio.duration_target || 180)),
    output_resolution: studio.output_resolution === "720p" ? "720p" : "1080p",
    visual_style: studio.visual_style || "",
    cta: studio.cta || "",
    intro_callout: studio.intro_callout || "",
    intro_callout_enabled: studio.intro_callout_enabled !== false,
    outro_callout_enabled: studio.outro_callout_enabled !== false,
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
          output_resolution: form.output_resolution,
          visual_style: form.visual_style,
          base_hashtags: form.hashtagsText
            .split(",")
            .map((tag) => tag.trim().replace(/^#/, ""))
            .filter(Boolean)
            .slice(0, 10),
          cta: form.cta,
          intro_callout: form.intro_callout,
          intro_callout_enabled: Boolean(form.intro_callout_enabled),
          outro_callout_enabled: Boolean(form.outro_callout_enabled),
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
          <Field label="Duração alvo (segundos)" hint="A fábrica gera vídeos entre 2 e 5 minutos.">
            <input
              type="number"
              min={120}
              max={300}
              className={inputClass}
              value={form.duration_target}
              onChange={(e) => set("duration_target", e.target.value)}
            />
          </Field>
        </div>

        <Field label="Resolução do vídeo" hint="Full HD deixa a montagem mais nítida, mas gera arquivos maiores e exige mais do navegador.">
          <select className={inputClass} value={form.output_resolution} onChange={(e) => set("output_resolution", e.target.value)}>
            <option value="1080p" className="bg-card">Full HD · 1080 × 1920 (recomendado)</option>
            <option value="720p" className="bg-card">HD · 720 × 1280</option>
          </select>
        </Field>

        <Field label="Estilo visual" hint="Aparece em toda imagem gerada.">
          <textarea
            rows={3}
            className="w-full rounded-lg border border-border bg-secondary/60 px-3 py-2 text-sm outline-none transition-colors focus:border-primary/60"
            value={form.visual_style}
            onChange={(e) => set("visual_style", e.target.value)}
          />
        </Field>

        <Field label="Chamada inicial" hint="Texto falado para abrir o vídeo. Se deixar vazio, a IA cria um gancho adequado ao roteiro.">
          <input className={inputClass} value={form.intro_callout} onChange={(e) => set("intro_callout", e.target.value)} placeholder="Ex.: Você não vai acreditar no que acontece..." />
        </Field>

        <Field label="Chamada final" hint="Entra como última frase da narração quando a chamada final está ativada.">
          <input className={inputClass} value={form.cta} onChange={(e) => set("cta", e.target.value)} />
        </Field>

        <div className="rounded-xl border border-border bg-card/40 p-4">
          <p className="text-sm font-medium text-foreground">Chamadas visuais</p>
          <p className="mt-1 text-xs text-muted-foreground">Cada chamada ativada ganha uma imagem exclusiva além das 15 imagens principais.</p>
          <label className="mt-4 flex items-start gap-3">
            <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={form.intro_callout_enabled} onChange={(e) => set("intro_callout_enabled", e.target.checked)} />
            <span><span className="block text-sm text-foreground">Chamada inicial</span><span className="block text-xs text-muted-foreground">Usa o gancho de abertura e adiciona uma imagem antes da sequência principal.</span></span>
          </label>
          <label className="mt-3 flex items-start gap-3">
            <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={form.outro_callout_enabled} onChange={(e) => set("outro_callout_enabled", e.target.checked)} />
            <span><span className="block text-sm text-foreground">Chamada final</span><span className="block text-xs text-muted-foreground">Usa o encerramento e a chamada final configurada, com uma imagem exclusiva.</span></span>
          </label>
        </div>

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

        <Field label="Temas já utilizados" hint="Todo tema de um vídeo finalizado aparece aqui e é enviado à IA para evitar repetições.">
          <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-border bg-secondary/40 p-3">
            {studio.used_topics?.length ? studio.used_topics.map((topic) => (
              <div key={topic.id} className="border-b border-border/60 pb-2 last:border-0 last:pb-0">
                <p className="text-sm text-foreground">{topic.title}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {topic.created_at ? new Date(topic.created_at).toLocaleDateString("pt-BR") : ""}
                </p>
              </div>
            )) : <p className="text-xs text-muted-foreground">Os temas aparecerão aqui quando os vídeos forem finalizados.</p>}
          </div>
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