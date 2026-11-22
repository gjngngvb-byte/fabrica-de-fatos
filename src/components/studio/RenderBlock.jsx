import { useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, Film, Loader2, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import PhonePlayer from "@/components/studio/PhonePlayer";
import { generateVideoKit, getStudio } from "@/lib/video-fns";
import { generateSceneImage, generateSceneSpeech, finalizeVideoAssets } from "@/lib/render-fns";
import { recordNarratedSlideshow, convertWebmToMp4 } from "@/lib/video-composer";
import { supabase } from "@/lib/supabase";

function safeFilename(value) {
  return String(value || "fabrica-de-fatos").replace(/[^a-z0-9-_]+/gi, "-").slice(0, 70);
}

const TOTAL_SCENES = 15;
const pct = (done, total) => Math.round((done / Math.max(1, total)) * 100);

export default function RenderBlock({ video }) {
  const router = useRouter();
  const createScript = useServerFn(generateVideoKit);
  const loadStudio = useServerFn(getStudio);
  const createImage = useServerFn(generateSceneImage);
  const createSpeech = useServerFn(generateSceneSpeech);
  const finalizeAssets = useServerFn(finalizeVideoAssets);
  const legacyShort = /12s|Agnes AI|Gemini Video/i.test(video.render_error || "");
  const initialUrl = legacyShort ? "" : (video.mp4_url || "");
  const [render, setRenderState] = useState({
    status: initialUrl ? "pronto" : (video.render_status || "ocioso"),
    url: initialUrl,
    error: "",
    progress: initialUrl ? 100 : 0,
    detail: initialUrl ? "MP4 disponível." : "Aguardando início da produção.",
  });
  const progressRef = useRef(initialUrl ? 100 : 0);
  const setRender = (next) => {
    if (next.status === "pronto") progressRef.current = 100;
    else if (next.status === "falhou") progressRef.current = 0;
    else progressRef.current = Math.max(
      progressRef.current,
      Math.min(99, Math.max(0, Number(next.progress) || 0)),
    );
    setRenderState({ ...next, progress: progressRef.current });
  };
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [previewScenes, setPreviewScenes] = useState(video.scenes || []);
  const [calloutSettings, setCalloutSettings] = useState({ intro: true, outro: true });
  const [activeVideo, setActiveVideo] = useState(video);
  const started = useRef(false);

  const build = async () => {
    if (busy) return;
    let currentPhase = "inicialização";
    setBusy(true);
    progressRef.current = 0;
    setRender({ status: "renderizando", url: "", error: "", progress: 1, detail: "FASE 1/6 · Escolhendo um tema e escrevendo o roteiro completo." });
    try {
      currentPhase = "preparação do roteiro";
      let currentVideo = activeVideo || video;
      const studioConfig = await loadStudio();
      const outputResolution = studioConfig?.output_resolution === "720p" ? "720p" : "1080p";
      const introCalloutEnabled = studioConfig?.intro_callout_enabled !== false;
      const outroCalloutEnabled = studioConfig?.outro_callout_enabled !== false;
      setCalloutSettings({ intro: introCalloutEnabled, outro: outroCalloutEnabled });
      const wordCount = String(currentVideo.script || "").trim().split(/\s+/).filter(Boolean).length;
      const normalizeNarration = (value) => String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();
      const sceneNarration = Array.isArray(currentVideo.scenes)
        ? currentVideo.scenes.map((scene) => normalizeNarration(scene?.narration)).filter(Boolean).join(" ")
        : "";
      const scenesMatchScript = Boolean(currentVideo.script) &&
        normalizeNarration(sceneNarration) === normalizeNarration(currentVideo.script);
      if (wordCount < 280 || !Array.isArray(currentVideo.scenes) ||
          currentVideo.scenes.length !== TOTAL_SCENES || !scenesMatchScript) {
        setRender({ status: "renderizando", url: "", error: "", progress: 2, detail: "FASE 1/6 · Conferindo a correspondência entre roteiro e cenas e preparando o roteiro correto." });
        const scriptResult = await createScript({ data: { videoId: video.id, sceneCount: 0 } });
        currentVideo = scriptResult?.video || scriptResult;
        if (!currentVideo?.script || !Array.isArray(currentVideo.scenes) || currentVideo.scenes.length !== TOTAL_SCENES) {
          throw new Error("A IA não retornou um roteiro completo dividido em exatamente 15 partes.");
        }
        const returnedSceneNarration = currentVideo.scenes.map((scene) => normalizeNarration(scene?.narration)).filter(Boolean).join(" ");
        if (normalizeNarration(returnedSceneNarration) !== normalizeNarration(currentVideo.script)) {
          throw new Error("As cenas retornadas não correspondem ao roteiro principal. A produção foi interrompida para evitar um vídeo com assuntos misturados.");
        }
        setActiveVideo(currentVideo);
      }

      let scenes = [...(currentVideo.scenes || [])];
      setPreviewScenes(scenes);
      const total = TOTAL_SCENES;

      currentPhase = "geração das 15 imagens";
      // FASE 2: as quinze imagens são concluídas antes de iniciar qualquer voz.
      for (let i = 0; i < total; i++) {
        if (scenes[i]?.image_url && scenes[i]?.image_path) {
          setPreviewScenes([...scenes]);
          setRender({
            status: "renderizando", url: "", error: "",
            progress: 5 + Math.round(((i + 1) / total) * 34),
            detail: "FASE 2/6 · Imagem " + String(i + 1).padStart(2, "0") + "/15 já pronta · " + pct(i + 1, total) + "%.",
          });
          continue;
        }
        setRender({
          status: "renderizando", url: "", error: "",
          progress: 5 + Math.round((i / total) * 34),
          detail: "FASE 2/6 · Gerando imagem " + String(i + 1).padStart(2, "0") + "/15 · " + pct(i, total) + "% concluído.",
        });
        const result = await createImage({ data: { videoId: video.id, sceneIndex: i } });
        if (result?.video?.scenes) scenes = result.video.scenes;
        else if (result?.scene) scenes[i] = result.scene;
        setPreviewScenes([...scenes]);
        setRender({
          status: "renderizando", url: "", error: "",
          progress: 5 + Math.round(((i + 1) / total) * 38),
          detail: "FASE 2/6 · Imagem " + String(i + 1).padStart(2, "0") + "/15 concluída · " + pct(i + 1, total) + "%.",
        });
      }

      currentPhase = "geração das imagens das chamadas";
      const calloutTasks = [
        ...(introCalloutEnabled ? [{ sceneIndex: 15, label: "chamada inicial", exists: () => scenes[0]?.intro_callout_image_url && scenes[0]?.intro_callout_image_path }] : []),
        ...(outroCalloutEnabled ? [{ sceneIndex: 16, label: "chamada final", exists: () => scenes[14]?.outro_callout_image_url && scenes[14]?.outro_callout_image_path }] : []),
      ];
      for (let i = 0; i < calloutTasks.length; i++) {
        const task = calloutTasks[i];
        if (task.exists()) continue;
        setRender({
          status: "renderizando", url: "", error: "",
          progress: 39 + Math.round((i / Math.max(1, calloutTasks.length)) * 4),
          detail: "FASE 2/6 · Criando imagem extra da " + task.label + ".",
        });
        const result = await createImage({ data: { videoId: video.id, sceneIndex: task.sceneIndex } });
        if (result?.video?.scenes) {
          currentVideo = result.video;
          scenes = result.video.scenes;
        } else if (result?.scene) {
          const targetIndex = task.sceneIndex === 15 ? 0 : 14;
          scenes[targetIndex] = result.scene;
        }
        setPreviewScenes([...scenes]);
        setActiveVideo(currentVideo);
      }

      currentPhase = "geração das 15 narrações";
      // FASE 3: a narração segue o roteiro original, repartido em quinze trechos contínuos.
      for (let i = 0; i < total; i++) {
        if (scenes[i]?.audio_path && Number(scenes[i]?.audio_duration) > 0) {
          setRender({
            status: "renderizando", url: "", error: "",
            progress: 43 + Math.round(((i + 1) / total) * 24),
            detail: "FASE 3/6 · Narração " + String(i + 1).padStart(2, "0") + "/15 já pronta · " + pct(i + 1, total) + "%.",
          });
          continue;
        }
        setRender({
          status: "renderizando", url: "", error: "",
          progress: 43 + Math.round((i / total) * 24),
          detail: "FASE 3/6 · Criando narração " + String(i + 1).padStart(2, "0") + "/15 · " + pct(i, total) + "% concluído.",
        });
        const result = await createSpeech({ data: { videoId: video.id, sceneIndex: i } });
        if (result?.video?.scenes) scenes = result.video.scenes;
        else if (result?.scene) scenes[i] = result.scene;
        setPreviewScenes([...scenes]);
        setRender({
          status: "renderizando", url: "", error: "",
          progress: 43 + Math.round(((i + 1) / total) * 24),
          detail: "FASE 3/6 · Narração " + String(i + 1).padStart(2, "0") + "/15 concluída · " + pct(i + 1, total) + "%.",
        });
      }

      currentPhase = "união e validação da narração";
      let audioResult;
      const savedAudioReady = Boolean(currentVideo.audio_url) &&
        scenes.length === TOTAL_SCENES &&
        scenes.every((scene) => scene?.audio_path && Number(scene?.audio_duration) > 0);
      if (savedAudioReady) {
        const savedDuration = scenes.reduce((sum, scene) => sum + Number(scene.audio_duration || 0), 0);
        audioResult = { video: { ...currentVideo, scenes }, audio_duration: currentVideo.audio_duration || savedDuration };
        currentVideo = audioResult.video;
        setRender({ status: "renderizando", url: "", error: "", progress: 69, detail: "FASE 4/6 · Narração final já salva. Reutilizando o áudio existente." });
      } else {
        setRender({ status: "renderizando", url: "", error: "", progress: 69, detail: "FASE 4/6 · Unindo os 15 trechos de voz em uma única narração e montando a linha do tempo." });
        audioResult = await finalizeAssets({ data: { videoId: video.id, action: "finalize_audio" } });
        currentVideo = audioResult?.video;
      }
      if (!currentVideo?.audio_url || currentVideo?.scenes?.length !== TOTAL_SCENES) {
        throw new Error("Não foi possível unir e validar a narração completa.");
      }
      setActiveVideo(currentVideo);

      currentPhase = "criação e sincronização das legendas";
      const savedCaptionsReady = currentVideo.scenes.every((scene) =>
        Array.isArray(scene.captions) && scene.captions.length > 0
      );
      if (savedCaptionsReady) {
        setRender({ status: "renderizando", url: "", error: "", progress: 72, detail: "FASE 5/6 · Legendas já sincronizadas. Reutilizando os dados existentes." });
      } else {
        setRender({ status: "renderizando", url: "", error: "", progress: 72, detail: "FASE 5/6 · Criando legendas a partir das 15 partes do roteiro e sincronizando com a voz." });
        const captionResult = await finalizeAssets({ data: { videoId: video.id, action: "build_captions" } });
        currentVideo = captionResult?.video;
      }
      if (!currentVideo?.audio_url || currentVideo?.scenes?.length !== TOTAL_SCENES ||
          currentVideo.scenes.some((scene) => !Array.isArray(scene.captions) || !scene.captions.length)) {
        throw new Error("As legendas não foram criadas e sincronizadas corretamente.");
      }
      setActiveVideo(currentVideo);
      setPreviewScenes(currentVideo.scenes);

      currentPhase = "renderização do vídeo no navegador";
      setRender({ status: "renderizando", url: "", error: "", progress: 74, detail: "FASE 6/6 · Montando o vídeo vertical com imagens, narração e legendas." });
      const webm = await recordNarratedSlideshow({ ...currentVideo, output_resolution: outputResolution, intro_callout_enabled: introCalloutEnabled, outro_callout_enabled: outroCalloutEnabled }, (progress, detail) => {
        const overall = 74 + Math.round((progress / 75) * 16);
        setRender({ status: "renderizando", url: "", error: "", progress: overall, detail: "FASE 6/6 · " + detail });
      });

      currentPhase = "conversão do vídeo para MP4";
      const mp4 = await convertWebmToMp4(webm, (progress, detail) => {
        const overall = 90 + Math.round(((progress - 76) / 22) * 7);
        setRender({ status: "renderizando", url: "", error: "", progress: Math.min(97, overall), detail: "FASE 6/6 · " + detail });
      }, outputResolution);

      currentPhase = "upload e gravação do MP4 no Supabase";
      setRender({ status: "renderizando", url: "", error: "", progress: 98, detail: "Validando o MP4 e salvando o arquivo final." });
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData?.user) throw new Error("Sua sessão expirou. Entre novamente para salvar o MP4.");
      const path = authData.user.id + "/" + video.id + ".mp4";
      const { error: uploadError } = await supabase.storage.from("assets").upload(path, mp4, {
        upsert: true, contentType: "video/mp4",
      });
      if (uploadError) throw new Error("Falha ao armazenar MP4: " + uploadError.message);
      const { data: signed, error: signedError } = await supabase.storage.from("assets").createSignedUrl(path, 60 * 60 * 24 * 30);
      if (signedError) throw new Error("MP4 salvo, mas não foi possível criar o link: " + signedError.message);

      const duration = Number(audioResult.audio_duration || 0);
      const { data: updated, error: updateError } = await supabase.from("videos").update({
        mp4_url: signed.signedUrl,
        render_status: "pronto",
        render_error: "Longform MP4 | " + Math.round(duration) + "s | 15 imagens + narração contínua + legendas sincronizadas",
        status: "pronto",
        error: "",
      }).eq("id", video.id).eq("created_by", authData.user.id).select("*").single();
      if (updateError) throw new Error("MP4 criado, mas o estado do vídeo não foi atualizado: " + updateError.message);
      setRender({ status: "pronto", url: updated.mp4_url, error: "", progress: 100, detail: "MP4 validado e salvo." });
      toast.success("Vídeo completo de " + Math.round(duration / 60 * 10) / 10 + " minutos pronto!");
      router.invalidate();
    } catch (error) {
      let reason = error?.message || (typeof error === "string" ? error : "Erro sem mensagem retornada pelo navegador.");
      if (error?.name && error.name !== "Error") reason = error.name + ": " + reason;
      if (error?.cause) reason += " | Causa: " + (error.cause?.message || String(error.cause));
      const message = "Falha na etapa " + currentPhase + ": " + reason;
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
    if (started.current || initialUrl) return;
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
        <video src={render.url} controls playsInline preload="metadata"
          className="aspect-[9/16] w-full rounded-[2rem] border border-border bg-black object-cover shadow-2xl shadow-black/50" />
        <div className="mt-3 flex items-center gap-2 text-xs text-emerald-500">
          <CheckCircle2 className="size-4" /> MP4 validado · 15 imagens, narração e legendas sincronizadas
        </div>
        <button onClick={downloadMp4} disabled={downloading}
          className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-50">
          {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          {downloading ? "Baixando MP4…" : "Baixar MP4"}
        </button>
      </div>
    );
  }

  const imagesReady = previewScenes.filter((scene) => scene.image_url && scene.image_path).length;
  const speechReady = previewScenes.filter((scene) => scene.audio_path && Number(scene.audio_duration) > 0).length;

  return (
    <div>
      <PhonePlayer scenes={previewScenes} audioUrl={activeVideo?.audio_url || video.audio_url} title={activeVideo?.title || video.title} />
      {activeVideo?.title && (
        <div className="mt-3 rounded-xl border border-border bg-card/50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">Tema escolhido</p>
          <p className="mt-1 text-sm font-medium text-foreground">{activeVideo.title}</p>
          {activeVideo.script && <p className="mt-2 line-clamp-4 text-[11px] leading-relaxed text-muted-foreground">{activeVideo.script}</p>}
        </div>
      )}
      <div className="mt-3 rounded-xl border border-border bg-card/50 p-3">
        <div className="mb-2 flex items-center justify-between text-[11px]">
          <span className="font-semibold text-foreground">Prévia das 15 cenas</span>
          <span className="text-muted-foreground">{imagesReady}/15 imagens principais</span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: TOTAL_SCENES }, (_, index) => {
            const scene = previewScenes[index];
            return (
              <div key={scene?.id || index} className="relative aspect-[3/4] overflow-hidden rounded-md bg-secondary">
                {scene?.image_url ? <img src={scene.image_url} alt={"Cena " + (index + 1)} className="size-full object-cover" /> :
                  <div className="grid size-full place-items-center text-[10px] text-muted-foreground">Aguardando</div>}
                <span className="absolute bottom-0 inset-x-0 bg-black/65 py-0.5 text-center text-[9px] text-white">{String(index + 1).padStart(2, "0")}/15</span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {calloutSettings.intro && previewScenes[0]?.intro_callout_image_url && (
            <div className="overflow-hidden rounded-lg border border-border">
              <img src={previewScenes[0].intro_callout_image_url} alt="Chamada inicial" className="aspect-[3/4] w-full object-cover" />
              <p className="p-2 text-[10px] text-muted-foreground">Imagem extra · Chamada inicial</p>
            </div>
          )}
          {calloutSettings.outro && previewScenes[14]?.outro_callout_image_url && (
            <div className="overflow-hidden rounded-lg border border-border">
              <img src={previewScenes[14].outro_callout_image_url} alt="Chamada final" className="aspect-[3/4] w-full object-cover" />
              <p className="p-2 text-[10px] text-muted-foreground">Imagem extra · Chamada final</p>
            </div>
          )}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">{speechReady}/15 partes da narração prontas</p>
      </div>
      <div className="mt-5 space-y-3">
        <div className="flex h-11 w-full items-center justify-center gap-2 rounded-full border border-border bg-card/50 text-xs font-semibold text-muted-foreground">
          {busy ? <Loader2 className="size-4 animate-spin" /> : render.status === "falhou" ? <AlertCircle className="size-4" /> : <Film className="size-4" />}
          {render.status === "falhou" ? "Falha na produção do vídeo" : busy ? "Produzindo automaticamente…" : "Preparando produção…"}
        </div>
        {render.status !== "pronto" && render.status !== "falhou" && (
          <div className="rounded-xl border border-border bg-card/60 p-3">
            <div className="mb-2 flex items-center justify-between gap-3 text-[11px]">
              <span className="font-medium text-foreground">Progresso da produção · 6 etapas</span>
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
            <button onClick={build} disabled={busy}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-50">
              <RefreshCw className="size-3.5" /> Retomar produção
            </button>
          </>
        )}
        {!busy && render.status !== "falhou" && (
          <p className="text-center font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            MP4 vertical 9:16 · {activeVideo?.output_resolution === "720p" ? "720 × 1280" : "1080 × 1920"} · duração entre 2 e 5 minutos
          </p>
        )}
      </div>
    </div>
  );
}
