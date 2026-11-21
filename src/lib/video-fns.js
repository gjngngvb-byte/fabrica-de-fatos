import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser, getAuthenticatedContext } from "@/lib/auth-middleware";

async function edgeFunctionMessage(error, fallback) {
  try {
    const response = error?.context;
    if (response?.clone) {
      const text = await response.clone().text();
      try {
        const payload = JSON.parse(text);
        if (payload?.error || payload?.message) return String(payload.error || payload.message);
      } catch {}
      if (text) return text.slice(0, 700);
    }
  } catch {}
  return error?.message || fallback;
}

const DEFAULT_STUDIO = {
  niche: "Fatos surpreendentes",
  tone: "curioso, direto e levemente provocador",
  language: "pt-BR",
  voice: "river",
  videos_per_day: 5,
  duration_target: 180,
  visual_style: "fotografia documental cinematográfica, luz natural dramática, cores ricas, textura de filme 35mm",
  base_hashtags: ["fatoscuriosos", "vocesabia", "curiosidades"],
  cta: "Segue para mais um fato por dia.",
  avoid: "",
};

async function loadStudio(supabase, userId) {
  const { data, error } = await supabase.from("studios").select("*").eq("created_by", userId).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const { data: created, error: createError } = await supabase.from("studios")
    .insert({ ...DEFAULT_STUDIO, created_by: userId }).select("*").single();
  if (createError) throw createError;
  return created;
}

// This loader is intentionally read-only: opening the dashboard must never recreate queue slots.
export const ensureTodayPlan = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const auth = await getAuthenticatedContext(context);
    const supabase = auth.supabase;
    const studio = await loadStudio(supabase, auth.user.id);
    const today = new Date().toISOString().slice(0, 10);
    const { data: videos, error } = await supabase.from("videos").select("*")
      .eq("created_by", auth.user.id).eq("scheduled_date", today).order("slot", { ascending: true });
    if (error) throw error;
    return { videos: videos || [], studio, today };
  });

export const listVideos = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ status: z.string().max(20).optional() }))
  .handler(async ({ data, context }) => {
    const auth = await getAuthenticatedContext(context);
    let query = auth.supabase.from("videos").select("*").eq("created_by", auth.user.id).order("created_at", { ascending: false }).limit(60);
    if (data?.status) query = query.eq("status", data.status);
    const { data: rows, error } = await query;
    if (error) throw error;
    return rows || [];
  });

export const getVideo = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ videoId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const auth = await getAuthenticatedContext(context);
    const { data: video, error } = await auth.supabase.from("videos").select("*")
      .eq("id", data.videoId).eq("created_by", auth.user.id).maybeSingle();
    if (error) throw error;
    return video;
  });

export const deleteVideo = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ videoId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const auth = await getAuthenticatedContext(context);
    const supabase = auth.supabase;
    const userId = auth.user.id;
    const { data: video, error: lookupError } = await supabase.from("videos").select("*")
      .eq("id", data.videoId).eq("created_by", userId).maybeSingle();
    if (lookupError) throw lookupError;
    if (!video) throw new Error("Vídeo não encontrado ou já excluído.");

    const paths = new Set([userId + "/" + video.id + ".mp4", userId + "/" + video.id + "-narration-full.wav"]);
    for (const scene of (Array.isArray(video.scenes) ? video.scenes : [])) {
      if (scene.image_path && String(scene.image_path).startsWith(userId + "/")) paths.add(scene.image_path);
      if (scene.audio_path && String(scene.audio_path).startsWith(userId + "/")) paths.add(scene.audio_path);
    }
    const { error: storageError } = await supabase.storage.from("assets").remove([...paths]);
    if (storageError) throw new Error("Não foi possível apagar os arquivos do vídeo: " + storageError.message);

    const { error: publicationError } = await supabase.from("tiktok_publications").delete()
      .eq("video_id", video.id);
    if (publicationError && publicationError.code !== "42P01") throw publicationError;

    const { error: deleteError } = await supabase.from("videos").delete()
      .eq("id", video.id).eq("created_by", userId);
    if (deleteError) throw deleteError;
    return { success: true, deletedId: video.id, filesRemoved: paths.size };
  });

export const getStudio = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .handler(async ({ context }) => { const auth = await getAuthenticatedContext(context); return loadStudio(auth.supabase, auth.user.id); });

export const createManualVideo = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const auth = await getAuthenticatedContext(context);
    const supabase = auth.supabase;
    const studio = await loadStudio(supabase, auth.user.id);
    const today = new Date().toISOString().slice(0, 10);
    const { data: video, error } = await supabase.from("videos").insert({
      created_by: auth.user.id,
      scheduled_date: today,
      slot: null,
      status: "planejado",
      voice: studio.voice || "river",
    }).select("*").single();
    if (error) throw error;
    return video;
  });

export const generateVideoKit = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ videoId: z.string().uuid(), sceneCount: z.union([z.literal(0), z.literal(3)]).optional().default(0) }))
  .handler(async ({ data, context }) => {
    const auth = await getAuthenticatedContext(context);
    const supabase = auth.supabase;
    const user = auth.user;
    if (!supabase || !user) throw new Error("Sessão não disponível. Entre novamente.");
    const { data: video, error: lookupError } = await supabase.from("videos").select("id")
      .eq("id", data.videoId).eq("created_by", user.id).single();
    if (lookupError || !video) throw new Error("Vídeo não encontrado.");
    const { data: result, error } = await supabase.functions.invoke("generate-video-kit", {
      body: { videoId: data.videoId, action: "generate" },
    });
    if (error) throw new Error(await edgeFunctionMessage(error, "Falha ao gerar o roteiro."));
    if (result?.error) throw new Error(result.error);
    return result.video;
  });

export const generateNarration = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ videoId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const auth = await getAuthenticatedContext(context);
    const { data: result, error } = await auth.supabase.functions.invoke("generate-video-kit", {
      body: { videoId: data.videoId, action: "generate" },
    });
    if (error) throw new Error(error.message || "Falha ao gerar roteiro e narração.");
    if (result?.error) throw new Error(result.error);
    return result.video;
  });

export const markPublished = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ videoId: z.string().uuid(), published: z.boolean() }))
  .handler(async ({ data, context }) => {
    const auth = await getAuthenticatedContext(context);
    const { data: video, error } = await auth.supabase.from("videos").update({
      status: data.published ? "publicado" : "pronto",
      published_at: data.published ? new Date().toISOString() : null,
    }).eq("id", data.videoId).eq("created_by", auth.user.id).select("*").single();
    if (error) throw error;
    return video;
  });

export const saveStudio = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({
    niche: z.string().max(120), tone: z.string().max(200), language: z.string().max(20),
    voice: z.enum(["river", "honey", "sunny", "storm", "spark"]),
    videos_per_day: z.number().min(1).max(10), duration_target: z.number().min(120).max(300),
    visual_style: z.string().max(400), base_hashtags: z.array(z.string().max(40)).max(10),
    cta: z.string().max(200), avoid: z.string().max(300),
  }))
  .handler(async ({ data, context }) => {
    const auth = await getAuthenticatedContext(context);
    const supabase = auth.supabase;
    const studio = await loadStudio(supabase, auth.user.id);
    const { data: updated, error } = await supabase.from("studios").update(data)
      .eq("id", studio.id).eq("created_by", auth.user.id).select("*").single();
    if (error) throw error;
    return updated;
  });
