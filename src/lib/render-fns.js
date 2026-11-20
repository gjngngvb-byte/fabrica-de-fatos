import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";

export const startRender = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ videoId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.getSupabase().functions.invoke("render-video", {
      body: { videoId: data.videoId, action: "start" },
    });
    if (error) throw new Error(error.message || "Não foi possível iniciar a renderização.");
    if (result?.error) throw new Error(result.error);
    return { jobId: result.jobId, video: result.video };
  });

export const checkRender = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ videoId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.getSupabase().functions.invoke("render-video", {
      body: { videoId: data.videoId, action: "check" },
    });
    if (error) throw new Error(error.message || "Não foi possível consultar a renderização.");
    if (result?.error) throw new Error(result.error);
    return result.video;
  });
