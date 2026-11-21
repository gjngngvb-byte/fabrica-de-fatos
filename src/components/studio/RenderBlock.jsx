import { useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, Film, Loader2, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import PhonePlayer from "@/components/studio/PhonePlayer";
import { generateVideoKit } from "@/lib/video-fns";
import { generateSceneAsset, finalizeVideoAssets } from "@/lib/render-fns";
import { recordNarratedSlideshow, convertWebmToMp4 } from "@/lib/video-composer";
import { supabase } from "@/lib/supabase";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeFilename(value) {
  return String(value || "fabrica-de-fatos").replace(/[^a-z0-9-_]+/gi, "-").slice(0, 70);
}

export default function RenderBlock({ video }) {
  const router = useRouter();
  const createScript = useServerFn(generateVideoKit);
  const createScene = useServerFn(generateSceneAsset);
  const finalizeAssets = useServerFn(finalizeVideoAssets);
  const legacyShort = /12s|Agnes AI|Gemini Video/i.test(video.render_error || "");
  const initialUrl = legacyShort ? "" : (video.mp4_url || "");
  const [render, setRender] = useState({
    status: initialUrl ? "pronto" : (video.render_status || "ocioso"),
    url: initialUrl,
    error: "",
    progress: initialUrl ? 100 : 0,
    detail: initialUrl ? "MP4 disponível." : "",
  });
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const started = useRef(false);

  const build = async () => {
    if (busy) return;
    setBusy(true);
    setRender({ status: "renderizando", url: "", error: "", progress: 1, detail: "Preparando roteiro longo." });
    try {
      let currentVideo = video;
      const wordCount = String(currentVideo.script || "").trim().split(/\s+/).filter(Boolean).length;
      if (wordCount < 280 || !Array.isArray(currentVideo.scenes) || currentVideo.scenes.length < 8) {
        setRender((state) => ({ ...state, progress: 2, detail: "Escrevendo um roteiro completo de 2 a 5 minutos." }));
        const scriptResult = await createScript({ data: { videoId: video.id, sceneCount: 0 } });
        currentVideo = scriptResult?.video || scriptResult;
        if (!currentVideo?.script || !currentVideo?.scenes?.length) throw new Error("A IA não retornou o roteiro e as cenas.");
      }

      let scenes = [...(currentVideo.scenes || [])];
      const total = scenes.length;
      let lastGeminiRequestAt = 0;
      for (let i = 0; i < total; i++) {
        const existing = scenes[i];
        if (existing.image_url && existing.audio_path && Number(existing.audio_duration) > 0) {
          setRender({ status: "renderizando", url: "", error: "", progress: 5 + Math.round(((i + 1) / total) * 48), detail: "Cena " + (i + 1) + " de " + total + " já está pronta." });
          continue;
        }
        setRender({
          status: "renderizando", url: "", error: "",
          progress: 5 + Math.round((i / total) * 48),
          detail: "Gerando imagem e voz da cena " + (i + 1) + " de " + total + ".",
        });
        // Gemini TTS Free Tier allows only 3 requests per minute. Keep a 22s gap.
        const elapsed = Date.now() - lastGeminiRequestAt;
        if (lastGeminiRequestAt && elapsed < 22000) {
          const waitMs = 22000 - elapsed;
          setRender({
            status: "renderizando", url: "", error: "",
            progress: 5 + Math.round((i / total) * 48),
            detail: "Respeitando o limite gratuito do Gemini. Próxima cena em " + Math.ceil(waitMs / 1000) + "s.",
          });
          await sleep(waitMs);
        }
        lastGeminiRequestAt = Date.now();
        let result;
        try {
          result = await createScene({ data: { videoId: video.id, sceneIndex: i } });
        } catch (sceneError) {
          const message = String(sceneError?.message || sceneError);
          if (!/429|quota exceeded|rate limit/i.test(message)) throw sceneError;
          const retryMatch = message.match(/retry in ([0-9.]+)s/i);
          const retryMs = Math.ceil((retryMatch ? Number(retryMatch[1]) : 40) * 1000) + 2000;
          setRender({
            status: "renderizando", url: "", error: "",
            progress: 5 + Math.round((i / total) * 48),
            detail: "O Gemini pediu uma pausa por limite de uso. Retomando em " + Math.ceil(retryMs / 1000) + "s.",
          });
          await sleep(retryMs);
          lastGeminiRequestAt = Date.now();
          result = await createScene({ data: { videoId: video.id, sceneIndex: i } });
        }
        if (result?.video?.scenes) scenes = result.video.scenes;
        else if (result?.scene) scenes[i] = result.scene;
      }

      setRender({ status: "renderizando", url: "", error: "", progress: 57, detail: "Unindo os trechos de voz e calculando as legendas sincronizadas." });
      const finalized = await finalizeAssets({ data: { videoId: video.id } });
      currentVideo = finalized?.video;
      if (!currentVideo?.audio_url || !currentVideo?.scenes?.length) throw new Error("Não foi possível finalizar a narração e as legendas.");

      const webm = await recordNarratedSlideshow(currentVideo, (progress, detail) => {
        setRender({ status: "renderizando", url: "", error: "", progress, detail });
      });
      setRender({ status: "renderizando", url: "", error: "", progress: 76, detail: "Convertendo a gravação para MP4." });
      const mp4 = await convertWebmToMp4(webm, (progress, detail) => {
        setRender({ status: "renderizando", url: "", error: "", progress, detail });
      });

      setRender({ status: "renderizando", url: "", error: "", progress: 98, detail: "Enviando e verificando o MP4 final." });
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData?.user) throw new Error("Sua sessão expirou. Entre novamente para salvar o MP4.");
      const path = authData.user.id + "/" + video.id + ".mp4";
      const { error: uploadError } = await supabase.storage.from("assets").upload(path, mp4, {
        upsert: true,
        contentType: "video/mp4",
      });
      if (uploadError) throw new Error("Falha ao armazenar MP4: " + uploadError.message);
      const { data: signed, error: signedError } = await supabase.storage.from("assets").createSignedUrl(path, 60 * 60 * 24 * 30);
      if (signedError) throw new Error("MP4 salvo, mas não foi possível criar o link: " + signedError.message);

      const duration = Number(finalized.audio_duration || 0);
      const { data: updated, error: updateError } = await supabase.from("videos").update({
        mp4_url: signed.signedUrl,
        render_status: "pronto",
        render_error: "Longform MP4 | " + Math.round(duration) + "s | FLUX + Gemini TTS",
        status: "pronto",
        error: "",
      }).eq("id", video.id).eq("created_by", authData.user.id).select("*").single();
      if (updateError) throw new Error("MP4 criado, mas o estado do vídeo não foi atualizado: " + updateError.message);
      setRender({ status: "pronto", url: updated.mp4_url, error: "", progress: 100, detail: "MP4 longo validado e salvo." });
      toast.success("Vídeo completo de " + Math.round(duration / 60 * 10) / 10 + " minutos pronto!");
      router.invalidate();
    } catch (error) {
      const message = error?.message || "Não foi possível concluir o vídeo.";
      try {
        const { data: authData } = await supabase.auth.getUser();
        if (authData?.user) {
          await supabase.from("videos").update({
            render_status: "falhou",
            render_error: message.slice(0, 700),
          }).eq("id", video.id).eq("created_by", authData.user.id);
        }
      } catch {}
      setRender({ status: "falhou", url: "", error: message, progress: 0, detail: "" });
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (started.current) return;
    if (!video.script) return;
    if (initialUrl) return;
    if (video.render_status === "pronto" && video.mp4_url && !legacyShort) return;
    started.current = true;
    build();
  }, [video.id]);

  const downloadMp4 = async () => {
    if (!render.url) return;
    setDownloading(true);
    try {
      const response = await fetch(render.url);
      if (!response.ok) throw new Error("O arquivo MP4 não está acessível. Atualize a página.");
      const blob = await response.blob();
      if (!blob.size || (blob.type && !blob.type.includes("video"))) throw new Error("O arquivo baixado não passou na verificação.");
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = safeFilename(video.title) + ".mp4";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      toast.error(error?.message || "Não foi possível baixar o MP4.");
    } finally {
      setDownloading(false);
    }
  };

  if (render.url && render.status === "pronto") {
    return (
      <div>
        <video
          src={render.url}
          controls
          playsInline
          preload="metadata"
          className="aspect-[9/16] w-full rounded-[2rem] border border-border bg-black object-cover shadow-2xl shadow-black/50"
        />
        <div className="mt-3 flex items-center gap-2 text-xs text-emerald-500">
          <CheckCircle2 className="size-4" /> MP4 longo validado · narração e legendas sincronizadas
        </div>
        <div className="mt-4 space-y-2">
          <button onClick={downloadMp4} disabled={downloading} className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-50">
            {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {downloading ? "Baixando MP4…" : "Baixar MP4"}
          </button>
          <button onClick={build} disabled={busy} className="flex h-10 w-full items-center justify-center gap-2 rounded-full border border-border text-xs text-muted-foreground disabled:opacity-50">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Gerar novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PhonePlayer scenes={video.scenes || []} audioUrl={video.audio_url} title={video.title} />
      <div className="mt-5 space-y-3">
        <div className="flex h-11 w-full items-center justify-center gap-2 rounded-full border border-border bg-card/50 text-xs font-semibold text-muted-foreground">
          {busy ? <Loader2 className="size-4 animate-spin" /> : render.status === "falhou" ? <AlertCircle className="size-4" /> : <Film className="size-4" />}
          {render.status === "falhou" ? "Falha na montagem do vídeo" : busy ? "Construindo vídeo longo…" : "Preparando vídeo…"}
        </div>
        {busy && (
          <div className="rounded-xl border border-border bg-card/60 p-3">
            <div className="mb-2 flex items-center justify-between gap-3 text-[11px]">
              <span className="font-medium text-foreground">Produção completa · imagens, voz, legendas e MP4</span>
              <span className="font-mono text-muted-foreground">{render.progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: render.progress + "%" }} />
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{render.detail}</p>
          </div>
        )}
        {render.status === "falhou" && (
          <>
            <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-[11px] text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" /> {render.error || "A geração falhou. Tente novamente."}
            </p>
            <button onClick={build} disabled={busy} className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-50">
              <RefreshCw className="size-3.5" /> Tentar novamente
            </button>
          </>
        )}
        {!busy && render.status !== "falhou" && (
          <p className="text-center font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            MP4 vertical 9:16 · duração entre 2 e 5 minutos
          </p>
        )}
      </div>
    </div>
  );
}
