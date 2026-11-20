import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";

const DEFAULT_STUDIO = {
  niche: "Fatos surpreendentes",
  tone: "curioso, direto e levemente provocador",
  language: "pt-BR",
  voice: "river",
  videos_per_day: 5,
  duration_target: 30,
  visual_style: "fotografia editorial cinematográfica, luz dramática lateral, cores quentes e profundas, textura de filme 35mm",
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

export const ensureTodayPlan = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const supabase = context.getSupabase();
    const studio = await loadStudio(supabase, context.user.id);
    const today = new Date().toISOString().slice(0, 10);
    const target = Math.min(Math.max(studio.videos_per_day || 5, 1), 10);
    const { data: existing, error } = await supabase.from("videos").select("*")
      .eq("created_by", context.user.id).eq("scheduled_date", today).order("slot", { ascending: true });
    if (error) throw error;
    const videos = existing || [];
    const existingSlots = new Set(videos.map((video) => video.slot));
    const missing = Array.from({ length: target }, (_, i) => i + 1)
      .filter((slot) => !existingSlots.has(slot))
      .map((slot) => ({
        created_by: context.user.id, scheduled_date: today, slot, status: "planejado",
      }));
    if (missing.length) {
      // The legacy import can create today's slots at the same time as this loader.
      // Ignore conflicts so concurrent requests never break the dashboard.
      const { error: insertError } = await supabase.from("videos")
        .upsert(missing, { onConflict: "created_by,scheduled_date,slot", ignoreDuplicates: true });
      if (insertError) throw insertError;
    }
    const { data: refreshed, error: refreshError } = await supabase.from("videos").select("*")
      .eq("created_by", context.user.id).eq("scheduled_date", today).order("slot", { ascending: true });
    if (refreshError) throw refreshError;
    return { videos: refreshed || [], studio, today };
  });

export const listVideos = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ status: z.string().max(20).optional() }))
  .handler(async ({ data, context }) => {
    let query = context.getSupabase().from("videos").select("*").eq("created_by", context.user.id).order("created_at", { ascending: false }).limit(60);
    if (data?.status) query = query.eq("status", data.status);
    const { data: rows, error } = await query;
    if (error) throw error;
    return rows || [];
  });

export const getVideo = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ videoId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { data: video, error } = await context.getSupabase().from("videos").select("*")
      .eq("id", data.videoId).eq("created_by", context.user.id).maybeSingle();
    if (error) throw error;
    return video;
  });

export const getStudio = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .handler(async ({ context }) => loadStudio(context.getSupabase(), context.user.id));

export const generateVideoKit = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ videoId: z.string().uuid(), sceneCount: z.union([z.literal(3), z.literal(10)]).optional().default(10) }))
  .handler(async ({ data, context }) => {
    const supabase = context.getSupabase();
    const { data: video, error: lookupError } = await supabase.from("videos").select("id")
      .eq("id", data.videoId).eq("created_by", context.user.id).single();
    if (lookupError || !video) throw new Error("Vídeo não encontrado.");
    const { data: result, error } = await supabase.functions.invoke("generate-video-kit", {
      body: { videoId: data.videoId, action: "generate", sceneCount: data.sceneCount },
    });
    if (error) throw new Error(error.message || "Falha ao gerar o vídeo.");
    if (result?.error) throw new Error(result.error);
    return result.video;
  });

export const generateNarration = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ videoId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.getSupabase().functions.invoke("generate-video-kit", {
      body: { videoId: data.videoId, action: "narration" },
    });
    if (error) throw new Error(error.message || "Falha ao gerar a narração.");
    if (result?.error) throw new Error(result.error);
    return result.video;
  });

export const markPublished = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ videoId: z.string().uuid(), published: z.boolean() }))
  .handler(async ({ data, context }) => {
    const { data: video, error } = await context.getSupabase().from("videos").update({
      status: data.published ? "publicado" : "pronto",
      published_at: data.published ? new Date().toISOString() : null,
    }).eq("id", data.videoId).eq("created_by", context.user.id).select("*").single();
    if (error) throw error;
    return video;
  });

export const saveStudio = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({
    niche: z.string().max(120), tone: z.string().max(200), language: z.string().max(20),
    voice: z.enum(["river", "honey", "sunny", "storm", "spark"]),
    videos_per_day: z.number().min(1).max(10), duration_target: z.number().min(10).max(90),
    visual_style: z.string().max(400), base_hashtags: z.array(z.string().max(40)).max(10),
    cta: z.string().max(200), avoid: z.string().max(300),
  }))
  .handler(async ({ data, context }) => {
    const supabase = context.getSupabase();
    const studio = await loadStudio(supabase, context.user.id);
    const { data: updated, error } = await supabase.from("studios").update(data)
      .eq("id", studio.id).eq("created_by", context.user.id).select("*").single();
    if (error) throw error;
    return updated;
  });
