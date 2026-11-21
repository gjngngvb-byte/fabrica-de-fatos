import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";

async function requireContextUser(context) {
  const supabase = context.getSupabase();
  const user = context.user;
  if (!supabase || !user) throw new Error("Sessão não disponível. Entre novamente.");
  return { supabase, user };
}

async function invokeMessage(error, fallback) {
  try {
    const response = error?.context;
    const payload = response?.clone ? await response.clone().json() : null;
    if (payload?.error || payload?.message) return payload.error || payload.message;
  } catch {}
  return error?.message || fallback;
}

function assetAction(action, fallback) {
  return createServerFn({ method: "POST" })
    .middleware([requireUser])
    .validator(z.object({ videoId: z.string().uuid(), sceneIndex: z.number().int().min(0).max(30) }))
    .handler(async ({ data, context }) => {
      const { supabase, user } = await requireContextUser(context);
      const { data: owned, error: lookupError } = await supabase.from("videos").select("id")
        .eq("id", data.videoId).eq("created_by", user.id).maybeSingle();
      if (lookupError || !owned) throw new Error("Vídeo não encontrado.");
      const { data: result, error } = await supabase.functions.invoke("generate-video-kit", {
        body: { videoId: data.videoId, action, sceneIndex: data.sceneIndex },
      });
      if (error) throw new Error(await invokeMessage(error, fallback));
      if (result?.error) throw new Error(result.error);
      return result;
    });
}

export const generateSceneImage = assetAction("image_asset", "Falha ao gerar imagem.");
export const generateSceneSpeech = assetAction("speech_asset", "Falha ao gerar narração.");

export const finalizeVideoAssets = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ videoId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase, user } = await requireContextUser(context);
    const { data: owned, error: lookupError } = await supabase.from("videos").select("id")
      .eq("id", data.videoId).eq("created_by", user.id).maybeSingle();
    if (lookupError || !owned) throw new Error("Vídeo não encontrado.");
    const { data: result, error } = await supabase.functions.invoke("generate-video-kit", {
      body: { videoId: data.videoId, action: "finalize_assets" },
    });
    if (error) throw new Error(await invokeMessage(error, "Falha ao sincronizar a narração."));
    if (result?.error) throw new Error(result.error);
    return result;
  });
