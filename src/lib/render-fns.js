import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";

export const generateSceneAsset = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ videoId: z.string().uuid(), sceneIndex: z.number().int().min(0).max(30) }))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.getSupabase().functions.invoke("generate-video-kit", {
      body: { videoId: data.videoId, action: "scene_asset", sceneIndex: data.sceneIndex },
    });
    if (error) throw new Error(error.message || "Falha ao gerar imagem e voz da cena.");
    if (result?.error) throw new Error(result.error);
    return result;
  });

export const finalizeVideoAssets = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ videoId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.getSupabase().functions.invoke("generate-video-kit", {
      body: { videoId: data.videoId, action: "finalize_assets" },
    });
    if (error) throw new Error(error.message || "Falha ao sincronizar a narração.");
    if (result?.error) throw new Error(result.error);
    return result;
  });
