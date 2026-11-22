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
  const autoResumeRef = useRef(true);
  const retryTimerRef = useRef(null);
  const retryAttemptRef = useRef(0);
  const busyRef = useRef(false);
  const [downloading, setDownloading] = useState(false);
  const [previewScenes, setPreviewScenes] = useState(video.scenes || []);
  const [calloutSettings, setCalloutSettings] = useState({
    intro: true, outro: true, introText: "", introTitle: "", outroText: "", channelName: "",
  });
  const [outputResolution, setOutputResolution] = useState("1080p");
  const [activeVideo, setActiveVideo] = useState(video);
  const started = useRef(false);

  const build = async () => {
    if (busyRef.current) return;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    busyRef.current = true;
    let currentPhase = "inicialização";
    setBusy(true);
    progressRef.current = 0;
    setRender({ status: "renderizando", url: "", error: "", progress: 1, detail: "FASE 1/6 · Escolhendo um tema e escrevendo o roteiro completo." });
    try {
      currentPhase = "preparação do roteiro";
      let currentVideo = activeVideo || video;
      const { data: latestVideo, error: latestVideoError } = await supabase.from("videos")
        .select("*").eq("id", video.id).maybeSingle();
      if (latestVideoError) throw new Error("Não foi possível recuperar o progresso salvo para retomar: " + latestVideoError.message);
      if (latestVideo) currentVideo = latestVideo;
      setActiveVideo(currentVideo);
      setPreviewScenes(currentVideo.scenes || []);
      const studioConfig = await loadStudio();
      const resumeEnabled = studioConfig?.auto_resume_enabled !== false;
      autoResumeRef.current = resumeEnabled;
      const outputResolution = studioConfig?.output_resolution === "720p" ? "720p" : "1080p";
      setOutputResolution(outputResolution);
      const introCalloutEnabled = studioConfig?.intro_callout_enabled !== false;
      const outroCalloutEnabled = studioConfig?.outro_callout_enabled !== false;
      setCalloutSettings({
        intro: introCalloutEnabled, outro: outroCalloutEnabled,
        introText: "", introTitle: "", outroText: "", channelName: "",
      });
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
        let progressPollBusy = false;
        const progressPoll = setInterval(async () => {
          if (progressPollBusy) return;
          progressPollBusy = true;
          try {
            const { data: progressRow } = await supabase.from("videos")
              .select("render_error").eq("id", video.id).maybeSingle();
            const progressMessage = String(progressRow?.render_error || "");
            if (progressMessage.startsWith("[SCRIPT_PROGRESS]")) {
              const detail = progressMessage.replace("[SCRIPT_PROGRESS]", "").trim();
              setRender({
                status: "renderizando", url: "", error: "", progress: 2,
                detail: "FASE 1/6 · Preparação do roteiro · " + detail,
              });
            }
          } catch {}
          finally { progressPollBusy = false; }
        }, 1000);
        let scriptResult;
        try {
          scriptResult = await createScript({ data: { videoId: video.id, sceneCount: 0 } });
        } finally {
          clearInterval(progressPoll);
        }
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

      const showIntroTitle = studioConfig?.show_title_on_intro !== false;
      const showChannelName = studioConfig?.show_channel_name_on_outro !== false;
      let connectedChannelName = "";
      if (showChannelName) {
        try {
          const { data: channelStatus, error: channelStatusError } = await supabase.functions.invoke("tiktok-connect", {
            body: { action: "status" },
          });
          if (!channelStatusError) connectedChannelName = String(channelStatus?.account?.display_name || "").trim();
          else console.warn("TikTok channel name unavailable:", channelStatusError.message);
        } catch (channelError) {
          console.warn("TikTok channel name unavailable:", channelError?.message || channelError);
        }
      }
      const calloutDisplay = {
        introText: String(studioConfig?.intro_callout || currentVideo.hook || "").trim(),
        introTitle: showIntroTitle ? String(currentVideo.title || "").trim() : "",
        outroText: String(studioConfig?.cta || "").trim(),
        channelName: showChannelName ? connectedChannelName : "",
      };
      setCalloutSettings({
        intro: introCalloutEnabled, outro: outroCalloutEnabled, ...calloutDisplay,
      });

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
      if (introCalloutEnabled && !(scenes[0]?.intro_callout_image_url && scenes[0]?.intro_callout_image_path)) {
        throw new Error("A chamada inicial está ativada, mas sua imagem não foi criada. A montagem foi interrompida para não gerar um vídeo incompleto.");
      }
      if (outroCalloutEnabled && !(scenes[14]?.outro_callout_image_url && scenes[14]?.outro_callout_image_path)) {
        throw new Error("A chamada final está ativada, mas sua imagem não foi criada. A montagem foi interrompida para não gerar um vídeo incompleto.");
      }
      if (introCalloutEnabled && outroCalloutEnabled) {
        const imageCount = scenes.length +
          Number(Boolean(scenes[0]?.intro_callout_image_url)) +
          Number(Boolean(scenes[14]?.outro_callout_image_url));
        if (imageCount !== 17) throw new Error("A produção precisa conter exatamente 17 imagens: 1 chamada inicial + 15 cenas + 1 chamada final. Foram encontradas " + imageCount + ".");
      }

      const introCalloutSpeechText = [calloutDisplay.introTitle, calloutDisplay.introText].filter(Boolean).join(". ").trim();
      const outroCalloutSpeechText = [
        calloutDisplay.outroText,
        calloutDisplay.channelName ? "no " + calloutDisplay.channelName : "",
      ].filter(Boolean).join(". ").trim();

      currentPhase = "narração das chamadas inicial e final";
      const calloutSpeechTasks = [
        ...(introCalloutEnabled && introCalloutSpeechText
          ? [{ sceneIndex: 15, narrationText: introCalloutSpeechText, label: "chamada inicial" }]
          : []),
        ...(outroCalloutEnabled && outroCalloutSpeechText
          ? [{ sceneIndex: 16, narrationText: outroCalloutSpeechText, label: "chamada final" }]
          : []),
      ];
      for (const task of calloutSpeechTasks) {
        const targetScene = task.sceneIndex === 15 ? scenes[0] : scenes[14];
        const cachedPath = task.sceneIndex === 15 ? targetScene?.intro_audio_path : targetScene?.outro_audio_path;
        const cachedText = task.sceneIndex === 15 ? targetScene?.intro_audio_text : targetScene?.outro_audio_text;
        if (cachedPath && cachedText === task.narrationText) continue;
        setRender({ status: "renderizando", url: "", error: "", progress: 42,
          detail: "FASE 3/6 · Criando voz da " + task.label + "." });
        const result = await createSpeech({ data: { videoId: video.id, sceneIndex: task.sceneIndex, narrationText: task.narrationText } });
        if (result?.video?.scenes) { currentVideo = result.video; scenes = result.video.scenes; }
        setPreviewScenes([...scenes]);
        setActiveVideo(currentVideo);
      }

      currentPhase = "geração das 15 narrações";
      // Somente as quinze cenas centrais recebem os trechos do roteiro.
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
      const introCalloutAudioReady = !introCalloutEnabled || !introCalloutSpeechText ||
        Boolean(scenes[0]?.intro_audio_path && scenes[0]?.intro_audio_text === introCalloutSpeechText);
      const outroCalloutAudioReady = !outroCalloutEnabled || !outroCalloutSpeechText ||
        Boolean(scenes[14]?.outro_audio_path && scenes[14]?.outro_audio_text === outroCalloutSpeechText);
      const calloutTimelineReady = !(introCalloutSpeechText || outroCalloutSpeechText) ||
        Number(scenes[0]?.audio_timeline_version) === 1;
      const savedAudioReady = Boolean(currentVideo.audio_url) && scenes.length === TOTAL_SCENES &&
        scenes.every((scene) => scene?.audio_path && Number(scene?.audio_duration) > 0) &&
        introCalloutAudioReady && outroCalloutAudioReady && calloutTimelineReady;
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
      const webm = await recordNarratedSlideshow({
        ...currentVideo,
        output_resolution: outputResolution,
        intro_callout_enabled: introCalloutEnabled,
        outro_callout_enabled: outroCalloutEnabled,
        intro_callout_text: calloutDisplay.introText,
        intro_callout_title: calloutDisplay.introTitle,
        outro_callout_text: calloutDisplay.outroText,
        outro_channel_name: calloutDisplay.channelName,
      }, (progress, detail) => {
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
        render_error: "Longform MP4 | " + Math.round(duration) + "s | 17 imagens (1 chamada inicial + 15 cenas + 1 chamada final) + narração contínua + legendas sincronizadas",
        status: "pronto",
        error: "",
      }).eq("id", video.id).eq("created_by", authData.user.id).select("*").single();
      if (updateError) throw new Error("MP4 criado, mas o estado do vídeo não foi atualizado: " + updateError.message);
      retryAttemptRef.current = 0;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
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
      const shouldAutoResume = autoResumeRef.current;
      let retryDelayMs = 0;
      if (shouldAutoResume) {
        retryAttemptRef.current += 1;
        retryDelayMs = Math.min(15000 * Math.pow(2, Math.min(retryAttemptRef.current - 1, 5)), 300000);
      }
      setRender({
        status: "falhou", url: "", error: message, progress: 0,
        detail: shouldAutoResume
          ? "Nova tentativa automática em " + Math.ceil(retryDelayMs / 1000) + " segundos. O progresso salvo será reutilizado."
          : "",
      });
      toast.error(message);
      if (shouldAutoResume) {
        retryTimerRef.current = setTimeout(async () => {
          retryTimerRef.current = null;
          try {
            const latestSettings = await loadStudio();
            const enabled = latestSettings?.auto_resume_enabled !== false;
            autoResumeRef.current = enabled;
            if (enabled) {
              toast.info("Retomando a produção do último ponto concluído…");
              build();
            }
          } catch (resumeError) {
            console.warn("Não foi possível confirmar a configuração de retomada:", resumeError?.message || resumeError);
          }
        }, retryDelayMs);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  useEffect(() => {
    if (started.current || initialUrl) return;
    if (video.render_status === "pronto" && video.mp4_url && !legacyShort) return;
    started.current = true;
    let cancelled = false;
    const startProduction = async () => {
      if (video.render_status === "falhou" || video.render_status === "renderizando") {
        try {
          const studioConfig = await loadStudio();
          const enabled = studioConfig?.auto_resume_enabled !== false;
          autoResumeRef.current = enabled;
          setAutoResumeEnabled(enabled);
          if (cancelled) return;
          if (!enabled) {
            setRender({
              status: "falhou", url: "", error: video.render_error || "A produção foi interrompida.",
              progress: 0, detail: "A retomada automática está desativada. Use Retomar produção quando quiser continuar.",
            });
            return;
          }
        } catch (settingsError) {
          console.warn("Não foi possível ler a configuração de retomada:", settingsError?.message || settingsError);
        }
      }
      if (!cancelled) build();
    };
    startProduction();
    return () => {
      cancelled = true;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
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
          <CheckCircle2 className="size-4" /> MP4 validado · 17 imagens, narração e legendas sincronizadas
        </div>
        <div className="mt-4 rounded-xl border border-border bg-card/60 p-3">
          <div className="mb-2 flex items-center justify-between text-[11px]">
            <span className="font-medium text-foreground">Produção concluída</span>
            <span className="font-mono text-emerald-500">100%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div className="h-full w-full rounded-full bg-emerald-500" />
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">MP4 salvo · {outputResolution === "720p" ? "720 × 1280 HD" : "1080 × 1920 Full HD"}</p>
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
      <PhonePlayer scenes={previewScenes} audioUrl={activeVideo?.audio_url || video.audio_url} title={activeVideo?.title || video.title}
        introImageUrl={calloutSettings.intro ? previewScenes[0]?.intro_callout_image_url : ""}
        outroImageUrl={calloutSettings.outro ? previewScenes[14]?.outro_callout_image_url : ""}
        introText={calloutSettings.introText} introTitle={calloutSettings.introTitle}
        outroText={calloutSettings.outroText} channelName={calloutSettings.channelName} />
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
            {render.detail && <p className="text-center text-[11px] text-muted-foreground">{render.detail}</p>}
            <button onClick={() => { retryAttemptRef.current = 0; build(); }} disabled={busy}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-50">
              <RefreshCw className="size-3.5" /> Retomar produção
            </button>
          </>
        )}
        {!busy && render.status !== "falhou" && (
          <p className="text-center font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            MP4 vertical 9:16 · {outputResolution === "720p" ? "720 × 1280" : "1080 × 1920"} · roteiro de 2 a 5 minutos + chamadas narradas
          </p>
        )}
      </div>
    </div>
  );
}
