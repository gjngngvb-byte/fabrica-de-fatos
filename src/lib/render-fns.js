import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";
import { gatewayVideos } from "@/lib/video.server";

const MODEL = "seedance_2_mini";
const SECONDS = 15;
const RESOLUTION = "720p";

function renderPrompt(video) {
  const scene = (video.scenes || [])[0] || {};
  const visual = scene.visual || video.fact || video.title || "surprising everyday object";
  return [
    `${visual}.`,
    "Vertical 9:16 cinematic shot for a short-form fact video.",
    "Slow push-in camera, subtle natural motion, shallow depth of field, warm editorial color grade.",
    "No text overlays, no captions, no watermark, no talking head.",
  ].join(" ");
}

export const startRender = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ videoId: z.string().min(1).max(80) }))
  .handler(async ({ data, context }) => {
    const base44 = context.getBase44();
    const video = await base44.entities.Video.get(data.videoId);
    if (!video?.script) throw new Error("Gere o roteiro antes de montar o vídeo.");
    const still = (video.scenes || []).find((scene) => scene.image_url)?.image_url;
    if (!still) throw new Error("Este vídeo ainda não tem cenas.");

    const references = [{ type: "image_url", image_url: { url: still } }];
    if (video.audio_url) references.push({ type: "audio_url", audio_url: { url: video.audio_url } });

    const job = await gatewayVideos(base44).create(
      {
        model: MODEL,
        prompt: renderPrompt(video),
        seconds: SECONDS,
        resolution: RESOLUTION,
        aspect_ratio: "9:16",
        generate_audio: false,
        input_references: references,
      },
      { maxRetries: 0 },
    );

    await base44.entities.Video.update(data.videoId, {
      render_job_id: job.id,
      render_status: "renderizando",
      render_error: "",
      mp4_url: "",
    });

    return { jobId: job.id };
  });

export const checkRender = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ videoId: z.string().min(1).max(80) }))
  .handler(async ({ data, context }) => {
    const base44 = context.getBase44();
    const video = await base44.entities.Video.get(data.videoId);
    if (!video?.render_job_id || video.render_status !== "renderizando") return video;

    const job = await gatewayVideos(base44).retrieve(video.render_job_id);

    if (job?.status === "completed" && job?.url) {
      return await base44.entities.Video.update(video.id, {
        mp4_url: job.url,
        render_status: "pronto",
        render_error: "",
      });
    }

    if (job?.status === "failed") {
      return await base44.entities.Video.update(video.id, {
        render_status: "falhou",
        render_error: String(job?.error?.message || "A renderização falhou.").slice(0, 300),
      });
    }

    return video;
  });