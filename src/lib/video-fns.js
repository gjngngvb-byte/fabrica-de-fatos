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
  visual_style:
    "fotografia editorial cinematográfica, luz dramática lateral, cores quentes e profundas, textura de filme 35mm",
  base_hashtags: ["fatoscuriosos", "vocesabia", "curiosidades"],
  cta: "Segue para mais um fato por dia.",
  avoid: "",
};

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Título curto, até 60 caracteres" },
    hook: { type: "string", description: "Primeira frase falada, até 12 palavras" },
    fact: { type: "string", description: "O fato surpreendente em 1 ou 2 frases" },
    script: { type: "string", description: "Narração completa, pronta para ler em voz alta" },
    scenes: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          narration: { type: "string" },
          visual: { type: "string" },
        },
        required: ["narration", "visual"],
      },
    },
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
  },
  required: ["title", "hook", "fact", "script", "scenes", "caption", "hashtags"],
};

async function loadStudio(base44, userId) {
  const found = await base44.entities.Studio.filter({ created_by_id: userId });
  if (found?.length) return found[0];
  return await base44.entities.Studio.create(DEFAULT_STUDIO);
}

function buildPrompt(studio, recentTitles) {
  return [
    "Você é roteirista sênior de vídeos verticais para TikTok e Reels.",
    `Nicho: ${studio.niche}. Idioma: ${studio.language}. Tom de voz: ${studio.tone}.`,
    "",
    "Tarefa: escolha UM fato surpreendente e escreva um vídeo narrado completo.",
    "",
    "Regras:",
    "- O fato precisa ser verdadeiro e verificável. Nada de lenda urbana, exagero ou invenção.",
    "- O gancho tem no máximo 12 palavras e quebra o padrão nos dois primeiros segundos.",
    `- A narração dura cerca de ${studio.duration_target} segundos: entre 70 e 90 palavras no campo script.`,
    "- Frases curtas, ritmo falado, sem jargão, sem emoji, sem marcações de cena no texto falado.",
    "- Divida a narração em 3 cenas, na ordem em que são faladas, somando exatamente o script.",
    "- Em cada cena, o campo visual descreve a imagem em inglês, sem nenhum texto dentro da imagem.",
    `- Legenda: uma frase de até 140 caracteres com gancho e o CTA "${studio.cta}".`,
    "- Hashtags: 6 a 8, sem o símbolo #, em português e relevantes ao fato.",
    recentTitles.length ? `- Não repita estes temas já usados: ${recentTitles.join("; ")}.` : "",
    studio.avoid ? `- Nunca aborde: ${studio.avoid}.` : "",
    "",
    "Responda apenas com o JSON do schema fornecido.",
  ]
    .filter(Boolean)
    .join("\n");
}

function imagePrompt(visual, studio) {
  return `${visual}. ${studio.visual_style}. Vertical 9:16 composition, cinematic lighting, high detail, no text, no watermark.`;
}

export const ensureTodayPlan = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const base44 = context.getBase44();
    const studio = await loadStudio(base44, context.user.id);
    const today = new Date().toISOString().slice(0, 10);
    const target = Math.min(Math.max(studio.videos_per_day || 5, 1), 10);

    const load = async () =>
      (await base44.entities.Video.filter({ scheduled_date: today }, { sort: "slot", limit: 30 })).items;

    let videos = await load();
    if (videos.length < target) {
      const missing = [];
      for (let i = videos.length; i < target; i++) {
        missing.push({ scheduled_date: today, slot: i + 1, status: "planejado" });
      }
      await base44.entities.Video.bulkCreate(missing);
      videos = await load();
    }

    return { videos, studio, today };
  });

export const listVideos = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ status: z.string().max(20).optional() }))
  .handler(async ({ data, context }) => {
    const query = data?.status ? { status: data.status } : {};
    const page = await context
      .getBase44()
      .entities.Video.filter(query, { sort: "-created_date", limit: 60 });
    return page.items;
  });

export const getVideo = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ videoId: z.string().min(1).max(80) }))
  .handler(async ({ data, context }) => {
    try {
      return await context.getBase44().entities.Video.get(data.videoId);
    } catch (error) {
      if (error?.status === 404) return null;
      throw error;
    }
  });

export const getStudio = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .handler(async ({ context }) => await loadStudio(context.getBase44(), context.user.id));

export const generateVideoKit = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ videoId: z.string().min(1).max(80) }))
  .handler(async ({ data, context }) => {
    const base44 = context.getBase44();
    const core = context.getBase44().asServiceRole.integrations.Core;
    const studio = await loadStudio(base44, context.user.id);

    const recent = await base44.entities.Video.filter(
      { status: { $in: ["pronto", "publicado"] } },
      { sort: "-created_date", limit: 12 },
    );
    const recentTitles = (recent.items || []).map((v) => v.title).filter(Boolean).slice(0, 8);

    await base44.entities.Video.update(data.videoId, { status: "roteiro", error: "" });

    try {
      const draft = await core.InvokeLLM({
        prompt: buildPrompt(studio, recentTitles),
        response_json_schema: DRAFT_SCHEMA,
      });

      const scenes = (draft.scenes || []).slice(0, 3);
      const narration = (draft.script || scenes.map((s) => s.narration).join(" ")).slice(0, 4800);

      const imageUrls = await Promise.all(
        scenes.map((scene) =>
          core
            .GenerateImage({ prompt: imagePrompt(scene.visual, studio) })
            .then((result) => result?.url || "")
            .catch(() => ""),
        ),
      );

      let audioUrl = "";
      try {
        const speech = await core.GenerateSpeech({
          text: narration,
          voice: studio.voice || "river",
          language_code: "pt",
        });
        audioUrl = speech?.url || "";
      } catch {
        audioUrl = "";
      }

      return await base44.entities.Video.update(data.videoId, {
        title: draft.title,
        hook: draft.hook,
        fact: draft.fact,
        script: narration,
        caption: draft.caption,
        hashtags: [...(draft.hashtags || []), ...(studio.base_hashtags || [])].slice(0, 12),
        scenes: scenes.map((scene, i) => ({
          narration: scene.narration,
          visual: scene.visual,
          image_url: imageUrls[i] || "",
        })),
        audio_url: audioUrl,
        voice: studio.voice || "river",
        mp4_url: "",
        render_job_id: "",
        render_status: "ocioso",
        render_error: "",
        status: "pronto",
        error: "",
      });
    } catch (error) {
      await base44.entities.Video.update(data.videoId, {
        status: "falhou",
        error: String(error?.message || error).slice(0, 300),
      });
      throw new Error("Não foi possível gerar este vídeo. Tente novamente.");
    }
  });

export const generateNarration = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ videoId: z.string().min(1).max(80) }))
  .handler(async ({ data, context }) => {
    const base44 = context.getBase44();
    const video = await base44.entities.Video.get(data.videoId);
    if (!video?.script) throw new Error("Este vídeo ainda não tem roteiro.");

    const speech = await context
      .getBase44()
      .asServiceRole.integrations.Core.GenerateSpeech({
        text: video.script.slice(0, 4800),
        voice: video.voice || "river",
        language_code: "pt",
      });

    return await base44.entities.Video.update(data.videoId, { audio_url: speech?.url || "" });
  });

export const markPublished = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ videoId: z.string().min(1).max(80), published: z.boolean() }))
  .handler(async ({ data, context }) => {
    return await context.getBase44().entities.Video.update(data.videoId, {
      status: data.published ? "publicado" : "pronto",
      published_at: data.published ? new Date().toISOString() : "",
    });
  });

export const saveStudio = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(
    z.object({
      niche: z.string().max(120),
      tone: z.string().max(200),
      language: z.string().max(20),
      voice: z.enum(["river", "honey", "sunny", "storm", "spark"]),
      videos_per_day: z.number().min(1).max(10),
      duration_target: z.number().min(10).max(90),
      visual_style: z.string().max(400),
      base_hashtags: z.array(z.string().max(40)).max(10),
      cta: z.string().max(200),
      avoid: z.string().max(300),
    }),
  )
  .handler(async ({ data, context }) => {
    const base44 = context.getBase44();
    const existing = await loadStudio(base44, context.user.id);
    return await base44.entities.Studio.update(existing.id, data);
  });