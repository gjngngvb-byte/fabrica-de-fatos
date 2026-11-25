import WebSocket from "npm:ws@8.18.3";
import decodeMp3 from "npm:@audio/decode-mp3@1.3.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
const SCRIPT_MODEL = "gemini-3.5-flash-lite";
const SCRIPT_FALLBACK_MODEL = "gemini-3.8-flash";
const TTS_MODEL = "gemini-3.8-flash-tts";
const IMAGE_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";

async function gemini(apiKey: string, model: string, body: unknown) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 22000);
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw Object.assign(new Error("Gemini " + model + " HTTP " + response.status + ": " + detail), { status: response.status });
    }
    return await response.json();
  } catch (error) {
    if ((error as any)?.name === "AbortError") {
      throw Object.assign(new Error("O Gemini " + model + " demorou mais de 22 segundos e a tentativa foi encerrada para proteger a produção."), { status: 504 });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function geminiWithFallback(apiKey: string | undefined, body: unknown) {
  const credentials: Array<{ name: string; key: string }> = [];
  if (apiKey?.trim()) credentials.push({ name: "GEMINI_API_KEY", key: apiKey.trim() });
  for (let i = 1; i <= 10; i++) {
    const key = Deno.env.get("GEMINI_API_KEY_" + i)?.trim();
    if (key && !credentials.some((item) => item.key === key)) credentials.push({ name: "GEMINI_API_KEY_" + i, key });
  }
  if (!credentials.length) throw new Error("Nenhuma chave Gemini configurada. Adicione GEMINI_API_KEY ou GEMINI_API_KEY_1 até GEMINI_API_KEY_10 nos Secrets do Supabase.");
  const failures: string[] = [];
  for (const credential of credentials) {
    try {
      try {
        const result = await gemini(credential.key, SCRIPT_MODEL, body);
        console.log("[GEMINI_KEY] geração de texto concluída com " + credential.name);
        return result;
      } catch (primaryError) {
        const status = Number((primaryError as any)?.status || 0);
        if (![0, 429, 500, 502, 503, 504].includes(status)) throw primaryError;
        console.warn("[GEMINI_MODEL_FALLBACK] " + credential.name + " indisponível no modelo principal; tentando " + SCRIPT_FALLBACK_MODEL);
        const result = await gemini(credential.key, SCRIPT_FALLBACK_MODEL, body);
        console.log("[GEMINI_KEY] geração de texto concluída com " + credential.name + " usando modelo alternativo");
        return result;
      }
    } catch (error) {
      const reason = String((error as Error)?.message || error).slice(0, 240);
      failures.push(credential.name + ": " + reason);
      console.warn("[GEMINI_KEY_FALLBACK] " + credential.name + " falhou; pulando para a próxima chave:", reason);
    }
  }
  throw new Error("Todas as chaves Gemini configuradas falharam. " + failures.join(" | ").slice(0, 1200));
}

async function openrouterScript(apiKey: string, prompt: string) {
  const controller = new AbortController();
  // Keep the free OpenRouter attempt below the Edge request ceiling; Gemini free tier is the bounded fallback.
  const timeout = setTimeout(() => controller.abort(), 26000);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://fabrica-de-fatos.vercel.app",
        "X-Title": "Fábrica de Fatos",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "nvidia/nemotron-3-ultra-550b-a55b:free",
        messages: [
          { role: "system", content: "Você é roteirista profissional de vídeos documentais para TikTok em português brasileiro. Responda somente com um objeto JSON válido, sem markdown." },
          { role: "user", content: prompt + "\nRetorne JSON com title, hook, fact, script, caption e hashtags. hashtags deve ser uma lista de strings." },
        ],
        temperature: 0.7,
        max_tokens: 4096,
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 600);
      throw Object.assign(new Error("OpenRouter Nemotron HTTP " + response.status + ": " + detail), { status: response.status });
    }
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("OpenRouter não retornou o roteiro.");
    const cleaned = content.trim().replace(/^\uFEFF/, "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first < 0 || last <= first) throw new Error("Nemotron não retornou um objeto JSON válido.");
    return JSON.parse(cleaned.slice(first, last + 1));
  } catch (error) {
    if ((error as any)?.name === "AbortError") throw Object.assign(new Error("OpenRouter excedeu 26 segundos."), { status: 504 });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseScriptJson(content: unknown, provider: string) {
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part: any) => typeof part === "string" ? part : String(part?.text || "")).join("\\n")
      : "";
  if (!text.trim()) throw new Error(provider + " respondeu sem conteúdo textual utilizável.");
  const cleaned = text.trim().replace(/^\\uFEFF/, "").replace(/^\x60{3}(?:json)?\\s*/i, "").replace(/\\s*\x60{3}$/, "");
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error(provider + " não retornou um objeto JSON válido.");
  return JSON.parse(cleaned.slice(first, last + 1));
}

async function geminiScript(apiKey: string, prompt: string) {
  const payload = await gemini(apiKey, SCRIPT_MODEL, {
    systemInstruction: {
      parts: [{ text: "Você é roteirista profissional de vídeos documentais para TikTok em português brasileiro. Responda somente com JSON válido, sem markdown." }],
    },
    contents: [{
      role: "user",
      parts: [{ text: prompt + "\\nRetorne JSON com title, hook, fact, script, caption e hashtags. hashtags deve ser uma lista de strings." }],
    }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.7, maxOutputTokens: 4096 },
  });
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const content = parts.map((part: any) => String(part?.text || "")).filter(Boolean).join("\\n");
  return parseScriptJson(content, "Gemini gratuito");
}

async function compatibleChatScript(
  apiKey: string,
  prompt: string,
  provider: string,
  baseUrl: string,
  model: string,
  timeoutMs = 26000
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Você é roteirista profissional de vídeos documentais para TikTok em português brasileiro. Responda somente com um objeto JSON válido, sem markdown." },
          { role: "user", content: prompt + "\\nRetorne JSON com title, hook, fact, script, caption e hashtags. hashtags deve ser uma lista de strings." },
        ],
        temperature: 0.7,
        max_tokens: 4096,
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 600);
      throw Object.assign(new Error(provider + " HTTP " + response.status + ": " + detail), { status: response.status });
    }
    const payload = await response.json();
    return parseScriptJson(payload?.choices?.[0]?.message?.content, provider);
  } catch (error) {
    if ((error as any)?.name === "AbortError") {
      throw Object.assign(new Error(provider + " excedeu " + Math.round(timeoutMs / 1000) + " segundos."), { status: 504 });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateScriptDraft(
  openrouterKey: string | undefined,
  geminiKey: string | undefined,
  prompt: string,
  skipOpenRouter = false,
  groqKey?: string,
  zaiKey?: string,
  sensenovaKey?: string,
  apinexKey?: string
) {
  const failures: string[] = [];
  const attempts: Array<{ name: string; run: () => Promise<any> }> = [];

  if (openrouterKey && !skipOpenRouter) {
    attempts.push({ name: "OpenRouter", run: () => openrouterScript(openrouterKey, prompt) });
  }
  if (groqKey) {
    attempts.push({ name: "Groq", run: () => compatibleChatScript(groqKey, prompt, "Groq", "https://api.groq.com/openai/v1", "openai/gpt-oss-120b") });
  }
  if (geminiKey) {
    attempts.push({
      name: "Gemini",
      run: async () => {
        const payload = await geminiWithFallback(geminiKey, {
          systemInstruction: {
            parts: [{ text: "Você é roteirista profissional de vídeos documentais para TikTok em português brasileiro. Responda somente JSON válido, sem markdown." }],
          },
          contents: [{
            role: "user",
            parts: [{ text: prompt + "\\nRetorne JSON com title, hook, fact, script, caption e hashtags. hashtags deve ser uma lista de strings." }],
          }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.7, maxOutputTokens: 4096 },
        });
        const parts = payload?.candidates?.[0]?.content?.parts || [];
        const content = parts.map((part: any) => String(part?.text || "")).filter(Boolean).join("\\n");
        return parseScriptJson(content, "Gemini");
      },
    });
  }
  if (zaiKey) {
    attempts.push({ name: "Z.AI", run: () => compatibleChatScript(zaiKey, prompt, "Z.AI", "https://api.z.ai/api/paas/v4", "glm-4.7-flash") });
  }
  if (sensenovaKey) {
    attempts.push({ name: "SenseNova", run: () => compatibleChatScript(sensenovaKey, prompt, "SenseNova", "https://token.sensenova.ai/v1", "sensenova-6.8-flash-lite") });
  }
  if (apinexKey) {
    attempts.push({ name: "APInex", run: () => compatibleChatScript(apinexKey, prompt, "APInex", "https://api.apinex.bond/v1", "free/deepseek-v4.1-flash", 18000) });
  }

  if (!attempts.length) {
    throw new Error("Nenhum provedor de roteiro está configurado. Adicione OPENROUTER_API_KEY, GROQ_API_KEY, GEMINI_API_KEY, ZAI_API_KEY, SENSENOVA_API_KEY e/ou APINEX_API_KEY nos Secrets do Supabase.");
  }

  for (const attempt of attempts) {
    try {
      const draft = await attempt.run();
      if (!draft || typeof draft !== "object" || !String(draft.title || "").trim() || !String(draft.script || "").trim()) {
        throw new Error(attempt.name + " retornou JSON sem título ou roteiro.");
      }
      console.log("[SCRIPT_PROVIDER] roteiro gerado com sucesso por " + attempt.name);
      return draft;
    } catch (error) {
      const reason = String((error as Error)?.message || error).slice(0, 320);
      failures.push(attempt.name + ": " + reason);
      console.warn("[SCRIPT_FALLBACK] " + attempt.name + " falhou; tentando o próximo provedor:", reason);
    }
  }
  throw new Error("Todos os provedores de roteiro configurados falharam. " + failures.join(" | ").slice(0, 1400));
}

function pcmToWav(pcm: Uint8Array, sampleRate = 24000) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const write = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  write(0, "RIFF"); view.setUint32(4, 36 + pcm.length, true); write(8, "WAVE");
  write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, pcm.length, true);
  const wav = new Uint8Array(44 + pcm.length);
  wav.set(new Uint8Array(header)); wav.set(pcm, 44);
  return wav;
}

function getWavPcm(wav: Uint8Array) {
  if (String.fromCharCode(...wav.slice(0, 4)) !== "RIFF" || String.fromCharCode(...wav.slice(8, 12)) !== "WAVE") {
    throw new Error("Segmento de voz não é WAV válido.");
  }
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const name = String.fromCharCode(...wav.slice(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (name === "data") return wav.slice(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  throw new Error("O áudio WAV não contém bloco PCM.");
}

function words(text: string) { return text.trim().split(/\s+/).filter(Boolean); }
function normalizeTopic(value: string) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function topicSimilarity(a: string, b: string) {
  const stop = new Set(["de","da","do","das","dos","a","o","e","em","um","uma","que","como","por","para","no","na"]);
  const left = new Set(normalizeTopic(a).split(" ").filter((w) => w.length > 2 && !stop.has(w)));
  const right = new Set(normalizeTopic(b).split(" ").filter((w) => w.length > 2 && !stop.has(w)));
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((w) => right.has(w)).length;
  return intersection / (left.size + right.size - intersection);
}

function splitSentences(text: string) {
  return text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) || [text.trim()];
}

function splitNarrativeUnits(script: string, count: number) {
  let units = splitSentences(script);
  // Preserve sentence boundaries. Split clauses only when more scene units
  // are needed, preferring commas, semicolons and colons.
  while (units.length < count) {
    let selected = -1;
    let selectedParts: string[] = [];
    let largest = 0;
    for (let i = 0; i < units.length; i++) {
      const parts = units[i].match(/[^,;:]+[,;:]|[^,;:]+$/g)?.map((part) => part.trim()).filter(Boolean) || [];
      const size = words(units[i]).length;
      if (parts.length > 1 && size > largest) {
        selected = i;
        selectedParts = parts;
        largest = size;
      }
    }
    if (selected < 0) break;
    units.splice(selected, 1, ...selectedParts);
  }
  // Last resort for scripts with too few punctuation boundaries.
  while (units.length < count) {
    let selected = 0;
    for (let i = 1; i < units.length; i++) {
      if (words(units[i]).length > words(units[selected]).length) selected = i;
    }
    const tokens = words(units[selected]);
    if (tokens.length < 2) break;
    const middle = Math.ceil(tokens.length / 2);
    units.splice(selected, 1, tokens.slice(0, middle).join(" "), tokens.slice(middle).join(" "));
  }
  return units;
}

function buildSceneNarration(script: string, visualScenes: any[], count = 15) {
  // Split only at real sentence boundaries first. Scene boundaries must never
  // cut a sentence merely to make every scene contain the same word count.
  const normalized = String(script || "").replace(/\\s+/g, " ").trim();
  const segmenter = typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("pt-BR", { granularity: "sentence" })
    : null;
  let units = segmenter
    ? [...segmenter.segment(normalized)].map((part) => part.segment.trim()).filter(Boolean)
    : (normalized.match(/[^.!?]+[.!?]+(?:["'”’)]*)|[^.!?]+$/gu) || []).map((part) => part.trim()).filter(Boolean);

  // If the script has fewer than 15 full sentences, use explicit clause
  // punctuation (semicolon, colon, comma) as secondary natural boundaries.
  while (units.length < count) {
    let selected = -1;
    let selectedParts: string[] = [];
    let largest = 0;
    for (let i = 0; i < units.length; i++) {
      const parts = units[i].match(/[^,;:]+[,;:]|[^,;:]+$/gu)?.map((part) => part.trim()).filter(Boolean) || [];
      const size = words(units[i]).length;
      if (parts.length > 1 && size > largest) {
        selected = i;
        selectedParts = parts;
        largest = size;
      }
    }
    if (selected < 0) break;
    units.splice(selected, 1, ...selectedParts);
  }

  if (units.length < count) {
    throw new Error("O roteiro tem apenas " + units.length + " frases e divisões naturais. Para criar " + count + " narrações sem pausas artificiais, gere novamente um roteiro com pelo menos " + count + " frases ou orações bem pontuadas.");
  }

  // Group adjacent complete sentences into 15 similarly sized narration
  // blocks while preserving their original order and punctuation.
  const groups: string[] = [];
  let cursor = 0;
  let remainingWords = units.reduce((sum, unit) => sum + words(unit).length, 0);
  for (let groupIndex = 0; groupIndex < count; groupIndex++) {
    const groupsLeft = count - groupIndex;
    if (groupsLeft === 1) {
      groups.push(units.slice(cursor).join(" ").trim());
      break;
    }
    const target = remainingWords / groupsLeft;
    const latestEnd = units.length - (groupsLeft - 1);
    let bestEnd = cursor + 1;
    let bestDistance = Number.POSITIVE_INFINITY;
    let candidateWords = 0;
    for (let end = cursor + 1; end <= latestEnd; end++) {
      candidateWords += words(units[end - 1]).length;
      const distance = Math.abs(candidateWords - target);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestEnd = end;
      }
      if (candidateWords > target && distance > bestDistance) break;
    }
    const selected = units.slice(cursor, bestEnd);
    groups.push(selected.join(" ").trim());
    const usedWords = selected.reduce((sum, unit) => sum + words(unit).length, 0);
    remainingWords -= usedWords;
    cursor = bestEnd;
  }

  if (groups.length !== count || groups.some((part) => !part)) {
    throw new Error("Não foi possível organizar o roteiro em " + count + " partes narrativas completas.");
  }

  return groups.map((narration, i) => ({
    narration,
    visual: String(visualScenes?.[i]?.visual || visualScenes?.[i]?.prompt ||
      "Visual scene illustrating: " + narration),
    image_url: "",
    image_path: "",
    audio_path: "",
    audio_duration: 0,
    captions: [],
  }));
}

function trimPcmSilence(pcm: Uint8Array, sampleRate = 24000) {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const frames = Math.floor(pcm.length / 2);
  let firstVoice = -1;
  let lastVoice = -1;
  const threshold = 180;
  for (let i = 0; i < frames; i++) {
    if (Math.abs(view.getInt16(i * 2, true)) >= threshold) {
      if (firstVoice < 0) firstVoice = i;
      lastVoice = i;
    }
  }
  if (firstVoice < 0) return pcm;
  // Keep a little natural breath at the start and end, removing only long
  // encoder/TTS silence that would otherwise accumulate between 15 clips.
  const headPadding = Math.floor(sampleRate * 0.025);
  const tailPadding = Math.floor(sampleRate * 0.22);
  const start = Math.max(0, firstVoice - headPadding);
  const end = Math.min(frames, lastVoice + tailPadding + 1);
  return pcm.slice(start * 2, end * 2);
}

function phraseChunks(text: string, maxWords = 7) {
  const tokens = words(text);
  const result: string[] = [];
  for (let i = 0; i < tokens.length; i += maxWords) result.push(tokens.slice(i, i + maxWords).join(" "));
  return result;
}

async function saveAsset(supabase: any, userId: string, pathName: string, bytes: Uint8Array, mime: string) {
  const path = userId + "/" + pathName;
  const isTransientStorageError = (error: any) => {
    const message = String(error?.message || error || "");
    const status = Number(error?.statusCode || error?.status || message.match(/HTTP\\s+(\\d{3})/i)?.[1] || 0);
    return [408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526].includes(status) ||
      /fetch failed|network|timeout|temporar|connection reset/i.test(message);
  };
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  let uploadError: any = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = await supabase.storage.from("assets").upload(path, bytes, { upsert: true, contentType: mime });
    uploadError = result.error;
    if (!uploadError) break;
    if (!isTransientStorageError(uploadError) || attempt === 3) {
      throw new Error("Storage upload " + pathName + ": " + uploadError.message);
    }
    const delay = 700 * Math.pow(2, attempt);
    console.warn("[STORAGE_RETRY] upload", pathName, "attempt", attempt + 1, "waiting", delay, "ms:", uploadError.message);
    await wait(delay);
  }
  if (uploadError) throw new Error("Storage upload " + pathName + ": " + uploadError.message);

  let signedData: any = null;
  let signedError: any = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = await supabase.storage.from("assets").createSignedUrl(path, 60 * 60 * 24 * 30);
    signedData = result.data;
    signedError = result.error;
    if (!signedError) break;
    if (!isTransientStorageError(signedError) || attempt === 3) {
      throw new Error("Storage URL " + pathName + ": " + signedError.message);
    }
    const delay = 700 * Math.pow(2, attempt);
    console.warn("[STORAGE_RETRY] signed URL", pathName, "attempt", attempt + 1, "waiting", delay, "ms:", signedError.message);
    await wait(delay);
  }
  if (signedError || !signedData?.signedUrl) {
    throw new Error("Storage URL " + pathName + ": " + (signedError?.message || "URL assinada não retornada."));
  }
  return { path, url: signedData.signedUrl };
}

async function edgeTtsSynthesizeMp3(text: string, voice: string): Promise<Uint8Array> {
  const trustedToken = String.fromCharCode(54,65,53,65,65,49,68,52,69,65,70,70,52,69,57,70,66,51,55,69,50,51,68,54,56,52,57,49,68,54,70,52);
  const chromiumVersion = "143.0.3650.75";
  const connectionId = crypto.randomUUID().replace(/-/g, "");
  const ticks = (Math.floor((Date.now() / 1000 + 11644473600) / 300) * 300) * 1e7;
  const tokenInput = new TextEncoder().encode(String(ticks) + trustedToken);
  const digest = await crypto.subtle.digest("SHA-256", tokenInput);
  const secMsGec = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  const url = new URL("wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1");
  url.searchParams.set("Ocp-Apim-Subscription-Key", trustedToken);
  url.searchParams.set("Sec-MS-GEC", secMsGec);
  url.searchParams.set("Sec-MS-GEC-Version", "1-" + chromiumVersion);
  url.searchParams.set("ConnectionId", connectionId);
  const voiceName = voice === "storm" || voice === "sunny" ? "AntonioNeural" : "FranciscaNeural";
  const xmlVoice = "Microsoft Server Speech Text to Speech Voice (pt-BR, " + voiceName + ")";
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='pt-BR'><voice name='" + xmlVoice + "'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>" + escaped + "</prosody></voice></speak>";
  const ws = new WebSocket(url.toString(), {
    handshakeTimeout: 12000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      "Origin": "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      "Pragma": "no-cache",
      "Cache-Control": "no-cache",
      "Cookie": "muid=" + Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase() + ";",
    },
  });
  const audioChunks: Uint8Array[] = [];
  return await new Promise<Uint8Array>((resolve, reject) => {
    let settled = false;
    let receivedAudio = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimeout);
      try { ws.close(); } catch { /* socket may already be closed */ }
      if (error) reject(error);
      else if (!receivedAudio) reject(new Error("Microsoft Edge TTS encerrou a conexão sem enviar áudio."));
      else {
        const total = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const joined = new Uint8Array(total);
        let offset = 0;
        for (const chunk of audioChunks) { joined.set(chunk, offset); offset += chunk.length; }
        resolve(joined);
      }
    };
    const totalTimeout = setTimeout(() => finish(new Error("Microsoft Edge TTS excedeu o limite de 40 segundos.")), 40000);
    ws.once("open", () => {
      ws.send("X-Timestamp:" + new Date().toUTCString().replace("GMT", "GMT+0000 (Coordinated Universal Time)") + "\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n" +
        '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n');
      ws.send("X-RequestId:" + connectionId + "\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:" + new Date().toUTCString().replace("GMT", "GMT+0000 (Coordinated Universal Time)") + "Z\r\nPath:ssml\r\n\r\n" + ssml);
    });
    ws.once("unexpected-response", (request: any, response: any) => {
      const status = Number(response.statusCode || 0);
      const retryAfter = response.headers?.["retry-after"];
      const error = Object.assign(new Error("Microsoft Edge TTS recusou a conexão: HTTP " + status), {
        status,
        retryAfter: retryAfter ? Number(retryAfter) : undefined,
      });
      try { request.destroy(); } catch { /* ignore */ }
      finish(error);
    });
    ws.on("message", (data: any, isBinary: boolean) => {
      if (!isBinary) {
        const message = data.toString("utf8");
        const splitAt = message.indexOf("\r\n\r\n");
        if (splitAt < 0) return;
        const headerText = message.slice(0, splitAt);
        const pathLine = headerText.split("\r\n").find((line: string) => line.toLowerCase().startsWith("path:"));
        if (pathLine?.slice(5).trim() === "turn.end") finish();
        return;
      }
      const bytes = new Uint8Array(data);
      if (bytes.length < 2) return;
      const headerLength = (bytes[0] << 8) | bytes[1];
      if (headerLength + 2 > bytes.length) return;
      const headerText = new TextDecoder().decode(bytes.slice(2, headerLength + 2));
      const headers = Object.fromEntries(headerText.split("\r\n").map((line) => {
        const index = line.indexOf(":");
        return index > 0 ? [line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim()] : ["", ""];
      }).filter(([key]) => key));
      if (headers.path === "audio" && headers["content-type"] === "audio/mpeg") {
        const chunk = bytes.slice(headerLength + 2);
        if (chunk.length) { audioChunks.push(chunk); receivedAudio = true; }
      }
    });
    ws.once("error", (error: Error) => finish(new Error("Falha na conexão Microsoft Edge TTS: " + error.message)));
    ws.once("close", (code: number) => {
      if (!settled) finish(receivedAudio ? undefined : new Error("Conexão Microsoft Edge TTS fechada antes do áudio (código " + code + ")."));
    });
  });
}

async function generateSpeech(text: string, voice: string) {
  let mp3: Uint8Array | null = null;
  let lastError: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      mp3 = await edgeTtsSynthesizeMp3(text, voice);
      break;
    } catch (error) {
      lastError = error;
      const status = Number((error as any)?.status || 0);
      if (status !== 429 || attempt === 2) throw error;
      const retryAfter = Number((error as any)?.retryAfter || 0);
      const waitMs = Math.min(12000, Math.max(3500, retryAfter * 1000, 3500 * (attempt + 1)));
      console.warn("[EDGE_TTS_RATE_LIMIT] retry", attempt + 1, "after", waitMs, "ms");
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  if (!mp3 || mp3.length < 1000) throw lastError || new Error("Microsoft Edge TTS retornou áudio vazio.");
  console.log("[EDGE_TTS] MP3 recebido", mp3.length, "bytes");
  const decoded = await decodeMp3(mp3);
  if (!decoded?.channelData?.length || !decoded.sampleRate || !decoded.samplesDecoded) {
    throw new Error("Não foi possível decodificar o áudio MP3 do Edge TTS.");
  }
  const channels: Float32Array[] = decoded.channelData;
  const inputRate = Number(decoded.sampleRate);
  const inputLength = Number(decoded.samplesDecoded);
  const outputRate = 24000;
  const outputLength = Math.floor(inputLength * outputRate / inputRate);
  const pcm = new Uint8Array(outputLength * 2);
  const view = new DataView(pcm.buffer);
  for (let i = 0; i < outputLength; i++) {
    const sourcePosition = i * inputRate / outputRate;
    const leftIndex = Math.min(inputLength - 1, Math.floor(sourcePosition));
    const rightIndex = Math.min(inputLength - 1, leftIndex + 1);
    const fraction = sourcePosition - leftIndex;
    let sample = 0;
    for (const channel of channels) {
      const a = channel[leftIndex] || 0;
      const b = channel[rightIndex] || 0;
      sample += a + (b - a) * fraction;
    }
    sample /= channels.length;
    const clipped = Math.max(-1, Math.min(1, sample));
    view.setInt16(i * 2, clipped < 0 ? clipped * 32768 : clipped * 32767, true);
  }
  return pcmToWav(pcm, outputRate);
}

async function generateImage(accountId: string, token: string, prompt: string) {
  const form = new FormData();
  form.set("prompt", prompt);
  form.set("width", "512");
  form.set("height", "896");
  let response: Response;
  try {
    response = await fetch("https://api.cloudflare.com/client/v4/accounts/" + accountId + "/ai/run/" + IMAGE_MODEL, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: form,
    });
  } catch (error) {
    throw Object.assign(new Error("Cloudflare FLUX conexão: " + String((error as Error)?.message || error)), { status: 0 });
  }
  if (!response.ok) {
    const status = response.status;
    const detail = (await response.text()).slice(0, 500);
    throw Object.assign(new Error("Cloudflare FLUX HTTP " + status + ": " + detail), { status });
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("image/")) return new Uint8Array(await response.arrayBuffer());
  const payload = await response.json();
  const encoded = payload.result?.image || payload.image;
  if (!encoded) throw new Error("FLUX não retornou imagem. " + JSON.stringify(payload).slice(0, 300));
  return Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
}

async function generateImageWithContingency(primaryAccountId: string, primaryToken: string, prompt: string) {
  // Preserve the primary and existing secondary credentials, then try accounts 1-10.
  // Transient connection/server failures and HTTP 429 advance to the next configured credential.
  const accounts: Array<{ label: string; accountId?: string; token?: string }> = [
    { label: "primary", accountId: primaryAccountId, token: primaryToken },
    { label: "secondary", accountId: Deno.env.get("CLOUDFLARE_ACCOUNT_ID_SECONDARY") || undefined, token: Deno.env.get("CLOUDFLARE_API_TOKEN_SECONDARY") || undefined },
    { label: "additional_1", accountId: Deno.env.get("CLOUDFLARE_ACCOUNT_ID_1") || undefined, token: Deno.env.get("CLOUDFLARE_API_TOKEN_1") || undefined },
    { label: "additional_2", accountId: Deno.env.get("CLOUDFLARE_ACCOUNT_ID_2") || undefined, token: Deno.env.get("CLOUDFLARE_API_TOKEN_2") || undefined },
    { label: "additional_3", accountId: Deno.env.get("CLOUDFLARE_ACCOUNT_ID_3") || undefined, token: Deno.env.get("CLOUDFLARE_API_TOKEN_3") || undefined },
    { label: "additional_4", accountId: Deno.env.get("CLOUDFLARE_ACCOUNT_ID_4") || undefined, token: Deno.env.get("CLOUDFLARE_API_TOKEN_4") || undefined },
    { label: "additional_5", accountId: Deno.env.get("CLOUDFLARE_ACCOUNT_ID_5") || undefined, token: Deno.env.get("CLOUDFLARE_API_TOKEN_5") || undefined },
    { label: "additional_6", accountId: Deno.env.get("CLOUDFLARE_ACCOUNT_ID_6") || undefined, token: Deno.env.get("CLOUDFLARE_API_TOKEN_6") || undefined },
    { label: "additional_7", accountId: Deno.env.get("CLOUDFLARE_ACCOUNT_ID_7") || undefined, token: Deno.env.get("CLOUDFLARE_API_TOKEN_7") || undefined },
    { label: "additional_8", accountId: Deno.env.get("CLOUDFLARE_ACCOUNT_ID_8") || undefined, token: Deno.env.get("CLOUDFLARE_API_TOKEN_8") || undefined },
    { label: "additional_9", accountId: Deno.env.get("CLOUDFLARE_ACCOUNT_ID_9") || undefined, token: Deno.env.get("CLOUDFLARE_API_TOKEN_9") || undefined },
    { label: "additional_10", accountId: Deno.env.get("CLOUDFLARE_ACCOUNT_ID_10") || undefined, token: Deno.env.get("CLOUDFLARE_API_TOKEN_10") || undefined },
  ];

  const retryableStatuses = [0, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526];
  let lastError: unknown;

  for (let index = 0; index < accounts.length; index++) {
    const account = accounts[index];
    if (!account.accountId || !account.token) {
      if (index === 0) throw new Error("Faltam as credenciais principais da Cloudflare.");
      continue;
    }

    try {
      if (index > 0) {
        console.warn("[CLOUDFLARE_FAILOVER] trying configured credential after transient failure", account.label);
      }
      return await generateImage(account.accountId, account.token, prompt);
    } catch (error) {
      lastError = error;
      const status = Number((error as any)?.status ?? 0);

      if (!retryableStatuses.includes(status)) {
        throw error;
      }

      console.warn("[CLOUDFLARE_FAILOVER] retryable failure (including quota/rate-limit 429); checking next configured credential", account.label, status);
    }
  }

  throw new Error("Cloudflare FLUX: todas as contas configuradas falharam por indisponibilidade temporária. Último erro: " + String((lastError as Error)?.message || lastError || "sem detalhes").slice(0, 500));
}


function getRateLimitRetryDelayMs(response: Response, detail: string): number | null {
  // Daily free-model quotas do not clear after a short wait. Skip directly to the next provider.
  if (/free-models-per-day|daily.{0,20}limit|per-day|add\\s+\\d+\\s+credits/i.test(detail)) return null;
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay) && dateDelay > 0) return dateDelay;
  }
  const resetHeader = response.headers.get("x-ratelimit-reset-tokens") ||
    response.headers.get("x-ratelimit-reset-requests");
  if (resetHeader) {
    const match = resetHeader.match(/([0-9]+(?:\\.[0-9]+)?)(ms|s|m)?/i);
    if (match) {
      const value = Number(match[1]);
      const unit = String(match[2] || "s").toLowerCase();
      return Math.ceil(value * (unit === "ms" ? 1 : unit === "m" ? 60000 : 1000));
    }
  }
  const bodyMatch = detail.match(/(?:try again in|retry after|retry in|wait)\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(ms|seconds?|secs?|s|minutes?|mins?|m)?/i);
  if (bodyMatch) {
    const value = Number(bodyMatch[1]);
    const unit = String(bodyMatch[2] || "s").toLowerCase();
    return Math.ceil(value * (unit.startsWith("m") ? 60000 : unit === "ms" ? 1 : 1000));
  }
  return 5000;
}

async function compatibleChatText(
  apiKey: string,
  provider: string,
  baseUrl: string,
  model: string,
  prompt: string,
  timeoutMs = 18000
) {
  const headers: Record<string, string> = {
    Authorization: "Bearer " + apiKey,
    "Content-Type": "application/json",
  };
  if (provider === "OpenRouter") {
    headers["HTTP-Referer"] = "https://fabrica-de-fatos.vercel.app";
    headers["X-Title"] = "Fábrica de Fatos";
  }
  const requestBody = JSON.stringify({
    model,
    messages: [
      {
        role: "system",
        content: "Você é diretor de arte especializado em transformar narração documental em prompts visuais concretos para geradores de imagem. Responda somente com um único parágrafo de descrição visual em português brasileiro. Nunca inclua palavras, letras, números, placas, legendas ou qualquer escrita como elemento visual.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.35,
    max_tokens: 700,
  });

  for (let attempt = 0; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(baseUrl + "/chat/completions", {
        method: "POST",
        headers,
        signal: controller.signal,
        body: requestBody,
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        if (response.status === 429 && attempt < 2) {
          const delayMs = getRateLimitRetryDelayMs(response, detail);
          if (delayMs !== null && delayMs <= 30000) {
            console.warn("[VISUAL_PROMPT_RATE_LIMIT] " + provider + " rate limited; waiting " + delayMs + "ms before retry " + (attempt + 1) + "/2");
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            continue;
          }
          if (delayMs !== null) {
            throw Object.assign(new Error(provider + " HTTP 429: limite temporário exige aguardar " + Math.ceil(delayMs / 1000) + "s, acima da espera segura de 30s desta tentativa. " + detail), { status: 429 });
          }
        }
        throw Object.assign(new Error(provider + " HTTP " + response.status + ": " + detail), { status: response.status });
      }
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new Error(provider + " não retornou uma descrição visual utilizável.");
      }
      return content.trim().replace(/^["'`]+|["'`]+$/g, "");
    } catch (error) {
      if ((error as any)?.name === "AbortError") {
        throw Object.assign(new Error(provider + " excedeu " + Math.round(timeoutMs / 1000) + " segundos ao criar o prompt visual."), { status: 504 });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(provider + " continuou limitado após duas novas tentativas.");
}

async function generateVisualPrompt(
  prompt: string,
  openrouterKey: string | undefined,
  groqKey: string | undefined,
  geminiKey: string | undefined,
  zaiKey: string | undefined,
  sensenovaKey: string | undefined
) {
  const attempts: Array<{ name: string; run: () => Promise<string> }> = [];
  if (openrouterKey) attempts.push({
    name: "OpenRouter",
    run: () => compatibleChatText(openrouterKey, "OpenRouter", "https://openrouter.ai/api/v1", "nvidia/nemotron-3-ultra-550b-a55b:free", prompt),
  });
  if (groqKey) attempts.push({
    name: "Groq",
    run: () => compatibleChatText(groqKey, "Groq", "https://api.groq.com/openai/v1", "openai/gpt-oss-120b", prompt),
  });
  if (geminiKey) attempts.push({
    name: "Gemini",
    run: async () => {
      const payload = await geminiWithFallback(geminiKey, {
        systemInstruction: {
          parts: [{ text: "Você é diretor de arte. Transforme trechos narrativos em descrições visuais concretas. Responda somente com um parágrafo em português brasileiro, sem markdown e sem mencionar escrita na cena." }],
        },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.35, maxOutputTokens: 700 },
      });
      const parts = payload?.candidates?.[0]?.content?.parts || [];
      const result = parts.map((part: any) => String(part?.text || "")).filter(Boolean).join("\n").trim();
      if (!result) throw new Error("Gemini não retornou uma descrição visual utilizável.");
      return result.replace(/^["'`]+|["'`]+$/g, "");
    },
  });
  if (zaiKey) attempts.push({
    name: "Z.AI",
    run: () => compatibleChatText(zaiKey, "Z.AI", "https://api.z.ai/api/paas/v4", "glm-4.7-flash", prompt),
  });
  if (sensenovaKey) attempts.push({
    name: "SenseNova",
    run: () => compatibleChatText(sensenovaKey, "SenseNova", "https://token.sensenova.ai/v1", "sensenova-6.8-flash-lite", prompt),
  });
  if (!attempts.length) throw new Error("Nenhum provedor de texto está configurado para transformar os trechos em prompts visuais.");
  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      const result = await attempt.run();
      if (result.length < 35) throw new Error("A descrição visual retornada ficou curta demais.");
      console.log("[VISUAL_PROMPT_PROVIDER] prompt visual criado por " + attempt.name);
      return result;
    } catch (error) {
      const reason = String((error as Error)?.message || error).slice(0, 260);
      failures.push(attempt.name + ": " + reason);
      console.warn("[VISUAL_PROMPT_FALLBACK] " + attempt.name + " falhou; tentando o próximo provedor:", reason);
    }
  }
  throw new Error("Não foi possível transformar o trecho em prompt visual. " + failures.join(" | ").slice(0, 900));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Faça login novamente." }, 401);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Sessão inválida." }, 401);
    const userId = authData.user.id;
    const body = await req.json();
    const videoId = String(body.videoId || "");
    const action = String(body.action || "generate");
    const { data: video, error: videoError } = await supabase.from("videos").select("*")
      .eq("id", videoId).eq("created_by", userId).single();
    if (videoError || !video) return json({ error: "Vídeo não encontrado." }, 404);

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    const groqKey = Deno.env.get("GROQ_API_KEY");
    const zaiKey = Deno.env.get("ZAI_API_KEY");
    const sensenovaKey = Deno.env.get("SENSENOVA_API_KEY");
    const apinexKey = Deno.env.get("APINEX_API_KEY");

    if (action === "generate") {
      const openrouterKey = Deno.env.get("OPENROUTER_API_KEY");
      if (!openrouterKey && !groqKey && !geminiKey && !zaiKey && !sensenovaKey && !apinexKey) return json({ error: "Configure ao menos uma chave de API de roteiro nos Secrets do Supabase: OPENROUTER_API_KEY, GROQ_API_KEY, GEMINI_API_KEY, ZAI_API_KEY, SENSENOVA_API_KEY ou APINEX_API_KEY." }, 503);
      const { data: studioRow } = await supabase.from("studios").select("*").eq("created_by", userId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      const studio = studioRow || {};
      const targetSeconds = Math.max(120, Math.min(300, Math.round(Number(studio.duration_target) || 180)));
      const sceneCount = Math.max(6, Math.min(15, Math.round(targetSeconds / 20)));
      const { data: historyRows, error: historyError } = await supabase.from("videos").select("title")
        .eq("created_by", userId).not("title", "is", null).order("created_at", { ascending: false }).limit(1000);
      if (historyError) throw new Error("Não foi possível consultar o histórico de temas para evitar repetições: " + historyError.message);
      const usedTopics = (historyRows || []).map((row: any) => String(row.title || "").trim()).filter(Boolean);
      const usedTopicsBlock = usedTopics.length
        ? "HISTÓRICO DE TODOS OS TEMAS JÁ CRIADOS (NÃO REPITA NENHUM, NEM COM OUTRO TÍTULO OU PEQUENA VARIAÇÃO):\n- " + usedTopics.join("\n- ")
        : "Ainda não existem temas anteriores.";
      const cta = String(studio.cta || "").trim();
      const configuredIntroCallout = String(studio.intro_callout || "").trim();
      const introCalloutEnabled = studio.intro_callout_enabled !== false;
      const outroCalloutEnabled = studio.outro_callout_enabled !== false;
      const calculatedTargetWords = Math.round(Math.max(90, targetSeconds - 12) * 2.2);
      const minWords = Math.max(180, Math.floor(calculatedTargetWords * 0.97));
      const maxWords = Math.ceil(calculatedTargetWords * 1.03);
      const targetWords = Math.round((minWords + maxWords) / 2);
      const updateScriptProgress = async (message: string) => {
        try {
          const { error: progressError } = await supabase.from("videos")
            .update({ render_error: "[SCRIPT_PROGRESS] " + message })
            .eq("id", video.id).eq("created_by", userId);
          if (progressError) console.warn("[SCRIPT_LENGTH] progress update failed:", progressError.message);
        } catch (progressError) {
          console.warn("[SCRIPT_LENGTH] progress update failed:", String((progressError as Error)?.message || progressError));
        }
      };
      await updateScriptProgress("Preparando o roteiro inicial e calculando a quantidade de palavras.");
      const prompt = [
        "Você é roteirista de documentários curtos para TikTok em português brasileiro.",
        "Crie um roteiro informativo, correto, envolvente e detalhado sobre fatos surpreendentes.",
        "Duração desejada: aproximadamente " + targetSeconds + " segundos (" + Math.round(targetSeconds / 60) + " minutos). Meta de " + targetWords + " palavras; faixa obrigatória de " + minWords + " a " + maxWords + " palavras, considerando narração natural em português brasileiro.",
        "Retorne somente JSON com title, hook, fact, script, caption e hashtags. Não inclua scenes nem prompts de imagem.",
        "O campo script deve conter somente o desenvolvimento narrativo central, sem a chamada inicial (hook) e sem a chamada final (CTA), pois essas duas falas serão gravadas separadamente. Não repita essas chamadas no script. Desenvolva contexto, causas, consequências, detalhes concretos e transições naturais.",
        "Escreva com pontuação natural e pelo menos " + sceneCount + " frases completas, usando pontos finais para encerrar ideias. As " + sceneCount + " cenas serão agrupadas a partir dessas frases, sem cortes no meio de uma frase e sem pausas artificiais.",
        introCalloutEnabled ? (configuredIntroCallout ? "Use exatamente este texto como chamada inicial falada e como campo hook: " + configuredIntroCallout + ". NÃO inclua esse texto no campo script." : "O campo hook será a chamada inicial falada. NÃO inclua o hook no campo script.") : "A chamada inicial está desativada: não acrescente o campo hook ao script.",
        outroCalloutEnabled && cta ? "A chamada final está ativada e será gravada separadamente. NÃO inclua a frase de CTA no campo script." : "A chamada final está desativada: não acrescente a frase de CTA ao script.",
        "Não use instruções para gerar vídeos, não escreva falas de apresentador. A narração será sintetizada separadamente.",
        "Legenda até 140 caracteres. 6 a 8 hashtags sem #.",
        "Nicho: " + (studio.niche || "Fatos surpreendentes") + ". Tom: " + (studio.tone || "curioso, direto e levemente provocador") + ".",
        studio.avoid ? "Evite estes temas: " + studio.avoid : "",
        usedTopicsBlock,
        "Escolha um assunto factual realmente novo e um ângulo diferente de todos os temas listados. Não reutilize entidades, acontecimentos ou fatos centrais já explorados.",

      ].filter(Boolean).join("\n");
      let draft = await generateScriptDraft(
        openrouterKey,
        geminiKey,
        prompt,
        false,
        groqKey,
        zaiKey,
        sensenovaKey,
        apinexKey
      );
      for (let topicAttempt = 0; topicAttempt < 3; topicAttempt++) {
        const generatedTitle = String(draft.title || "").trim();
        const collision = usedTopics.find((previous) => topicSimilarity(generatedTitle, previous) >= 0.62);
        if (!collision) break;
        console.warn("[TOPIC_DEDUP] similar topic rejected", generatedTitle, "matches", collision);
        draft = await generateScriptDraft(openrouterKey, geminiKey, prompt + "\nO tema gerado repete " + collision +
          ". Gere um assunto de categoria e fato central diferentes. Título rejeitado: " + generatedTitle +
          ". Não reutilize o mesmo acontecimento, personagem, lugar ou descoberta.", false, groqKey, zaiKey, sensenovaKey, apinexKey);
      }
      const finalCollision = usedTopics.find((previous) => topicSimilarity(String(draft.title || ""), previous) >= 0.62);
      if (finalCollision) throw new Error("A IA tentou repetir um tema já utilizado (" + finalCollision + "). Tente novamente para obter um assunto realmente novo.");
      let script = String(draft.script || "").trim();
      let hook = introCalloutEnabled ? (configuredIntroCallout || String(draft.hook || "").trim()) : "";
      const generatedHook = String(draft.hook || "").trim();
      const normalizeCalloutText = (value: string) => String(value || "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const stripLeadingCallout = (value: string, phrase: string) => {
        const target = normalizeCalloutText(phrase).split(" ").filter(Boolean);
        let result = String(value || "").trimStart();
        while (target.length) {
          const matches = [...result.matchAll(/[A-Za-zÀ-ÿ0-9]+/g)].slice(0, target.length);
          if (matches.length !== target.length ||
              matches.map((match) => normalizeCalloutText(match[0])).join(" ") !== target.join(" ")) break;
          const end = matches[matches.length - 1].index! + matches[matches.length - 1][0].length;
          result = result.slice(end).replace(/^[\s.!?,;:…-]+/u, "");
        }
        return result.trim();
      };
      const stripTrailingCallout = (value: string, phrase: string) => {
        const target = normalizeCalloutText(phrase).split(" ").filter(Boolean);
        let result = String(value || "").trimEnd();
        while (target.length) {
          const matches = [...result.matchAll(/[A-Za-zÀ-ÿ0-9]+/g)];
          const tail = matches.slice(-target.length);
          if (tail.length !== target.length ||
              tail.map((match) => normalizeCalloutText(match[0])).join(" ") !== target.join(" ")) break;
          result = result.slice(0, tail[0].index).replace(/[\s.!?,;:…-]+$/u, "");
        }
        return result.trim();
      };
      if (introCalloutEnabled && hook) {
        script = stripLeadingCallout(script, hook);
        script = stripLeadingCallout(script, generatedHook);
        script = stripLeadingCallout(script, configuredIntroCallout);
      }
      if (outroCalloutEnabled && cta) script = stripTrailingCallout(script, cta);
      draft.hook = hook;
      const calloutWordCount = (introCalloutEnabled && hook ? words(hook).length : 0) +
        (outroCalloutEnabled && cta ? words(cta).length : 0);
      const applyCalloutsToScript = () => {
        if (introCalloutEnabled && hook) {
          script = stripLeadingCallout(script, hook);
          script = stripLeadingCallout(script, generatedHook);
          script = stripLeadingCallout(script, configuredIntroCallout);
        }
        if (outroCalloutEnabled && cta) script = stripTrailingCallout(script, cta);
        script = script.trim();
      };
      applyCalloutsToScript();
      let wordCount = words(script).length + calloutWordCount;
      // Keep the best valid draft seen so a weak revision can never replace a stronger script.
      let bestDraft = { ...draft };
      let bestScript = script;
      let bestWordCount = wordCount;
      const targetWordCount = targetWords;
      const targetScriptWordCount = Math.max(1, targetWordCount - calloutWordCount);
      const minScriptWordCount = Math.max(1, minWords - calloutWordCount);
      const maxScriptWordCount = Math.max(minScriptWordCount, maxWords - calloutWordCount);
      const distanceFromTarget = (count: number) => Math.abs(count - targetWordCount);
      for (let adjustmentAttempt = 0; bestDraft.title && (bestWordCount < minWords || bestWordCount > maxWords) && adjustmentAttempt < 10; adjustmentAttempt++) {
        const currentBodyWordCount = words(bestScript).length;
        const needsExpansion = currentBodyWordCount < targetScriptWordCount;
        const delta = Math.abs(targetScriptWordCount - currentBodyWordCount);
        const attemptLabel = "Tentativa " + (adjustmentAttempt + 1) + "/10 · " + (needsExpansion ? "AUMENTANDO" : "RESUMINDO") +
          " · roteiro atual: " + bestWordCount + " palavras · faixa: " + minWords + "–" + maxWords + ".";
        await updateScriptProgress(attemptLabel);
        console.log("[SCRIPT_LENGTH] " + attemptLabel + " Meta ideal: " + targetWordCount + ".");
        console.warn("[SCRIPT_LENGTH] adjusting draft:", bestWordCount, "words; target", minWords, "-", maxWords, "ideal", targetWordCount, "attempt", adjustmentAttempt + 1, "of 10");
        const adjustmentPrompt = [
          prompt,
          "CONTROLE OBRIGATÓRIO DE EXTENSÃO: o roteiro central (sem chamada inicial e sem CTA) tem " + currentBodyWordCount + " palavras. A meta do texto central é " + targetScriptWordCount + " palavras, com faixa de " + minScriptWordCount + " a " + maxScriptWordCount + ". As chamadas são gravadas separadamente e não devem aparecer no campo script.",
          needsExpansion
            ? "O roteiro central está ABAIXO DA FAIXA. Acrescente aproximadamente " + delta + " palavras ao texto central para chegar a " + targetScriptWordCount + ". Preserve o texto atual e amplie com contexto, causas, consequências e detalhes concretos. Não invente fatos nem use enchimento. O campo script deve ter entre " + minScriptWordCount + " e " + maxScriptWordCount + " palavras, sem chamadas."
            : "O roteiro central está ACIMA DA FAIXA. Retire aproximadamente " + delta + " palavras do texto central para chegar a " + targetScriptWordCount + ". Preserve fatos essenciais, lógica e conclusão factual. O campo script deve ter entre " + minScriptWordCount + " e " + maxScriptWordCount + " palavras, sem chamadas.",
          "Ajuste somente o desenvolvimento narrativo central. Não inclua hook nem CTA no campo script. Mantenha português brasileiro, começo envolvente, desenvolvimento e conclusão factual.",
          "Preserve a pontuação natural e mantenha pelo menos " + sceneCount + " frases completas. Não una frases diferentes sem necessidade nem crie cortes artificiais no meio de uma ideia.",
          "Não inclua a chamada inicial nem a chamada final no campo script. Elas serão acrescentadas uma única vez como áudio separado.",
          "ROTEIRO ATUAL A SER AJUSTADO:",
          bestScript,
          "Retorne JSON completo com title, hook, fact, script, caption e hashtags. O campo script deve conter o roteiro ajustado completo."
        ].join("\\n");
        let adjustedDraft: any;
        try {
          adjustedDraft = await generateScriptDraft(openrouterKey, geminiKey, adjustmentPrompt, true, groqKey, zaiKey, sensenovaKey, apinexKey);
        } catch (adjustError) {
          console.warn("[SCRIPT_LENGTH] adjustment provider failed; retaining best draft:", String((adjustError as Error)?.message || adjustError).slice(0, 240));
          break;
        }
        let candidateScript = String(adjustedDraft?.script || "").trim();
        if (!candidateScript) {
          console.warn("[SCRIPT_LENGTH] empty revision; retaining best draft");
          break;
        }
        const previousScript = script;
        script = candidateScript;
        applyCalloutsToScript();
        candidateScript = script;
        const candidateCount = words(candidateScript).length + calloutWordCount;
        console.log("[SCRIPT_LENGTH] revision checked:", candidateCount, "words; required", minWords, "-", maxWords, "attempt", adjustmentAttempt + 1, "of 10");
        await updateScriptProgress("Tentativa " + (adjustmentAttempt + 1) + "/10 concluída · " +
          (needsExpansion ? "AUMENTANDO" : "RESUMINDO") + " · resultado: " + candidateCount +
          " palavras · faixa exigida: " + minWords + "–" + maxWords + ".");
        if ((candidateCount >= minWords && candidateCount <= maxWords) || distanceFromTarget(candidateCount) < distanceFromTarget(bestWordCount)) {
          bestDraft = { ...bestDraft, ...adjustedDraft };
          bestScript = candidateScript;
          bestWordCount = candidateCount;
          console.log("[SCRIPT_LENGTH] improved draft accepted:", bestWordCount, "words");
        } else {
          console.warn("[SCRIPT_LENGTH] weaker revision rejected; keeping", bestWordCount, "words");
        }
        draft = { ...bestDraft };
        script = bestScript;
        wordCount = bestWordCount;
        if (candidateScript === previousScript && distanceFromTarget(wordCount) > 5) {
          console.warn("[SCRIPT_LENGTH] identical revision; continuing with a stronger retry instead of stopping");
        }
      }
      draft = { ...bestDraft };
      script = bestScript;
      wordCount = bestWordCount;
      console.log("[SCRIPT_LENGTH] final verification:", wordCount, "words; required", minWords, "-", maxWords, "ideal", targetWordCount);
      if (wordCount >= minWords && wordCount <= maxWords) {
        await updateScriptProgress("Roteiro aprovado · " + wordCount + " palavras dentro da faixa " + minWords + "–" + maxWords + ".");
      }
      if (!draft.title || !script || wordCount < minWords || wordCount > maxWords) {
        const difference = targetWordCount - wordCount;
        const adjustment = difference > 0
          ? "adicione aproximadamente " + difference + " palavras para atingir a média de " + targetWordCount
          : "retire aproximadamente " + Math.abs(difference) + " palavras para atingir a média de " + targetWordCount;
        throw new Error("O roteiro ficou com " + wordCount + " palavras após 10 tentativas de ajuste. Para " + targetSeconds + " segundos, a média é " + targetWordCount + " palavras (faixa aceita: " + minWords + " a " + maxWords + "). Para completar o ajuste até a média, " + adjustment + " palavras. Gere novamente.");
      }
      const scenes = buildSceneNarration(script, [], sceneCount);
      if (scenes.length !== sceneCount) throw new Error("A IA precisa dividir o roteiro em exatamente " + sceneCount + " cenas.");
      const fullScript = scenes.map((scene) => scene.narration).join(" ").replace(/\s+/g, " ").trim();
      if (fullScript !== script.replace(/\s+/g, " ").trim()) throw new Error("A divisão das " + sceneCount + " cenas não corresponde exatamente ao roteiro completo.");
      const updatedData = {
        title: String(draft.title).slice(0, 160),
        hook: String(draft.hook || "").slice(0, 300),
        fact: String(draft.fact || "").slice(0, 3000),
        script,
        caption: String(draft.caption || "").slice(0, 300),
        hashtags: [...(Array.isArray(draft.hashtags) ? draft.hashtags : []), ...((studio.base_hashtags || ["fatoscuriosos", "vocesabia"]).map(String))].slice(0, 12),
        scenes,
        audio_url: "",
        mp4_url: "",
        render_job_id: "",
        render_status: "renderizando",
        render_error: "ASSETS_PENDING",
        status: "pronto",
        error: "",
      };
      const { data: updated, error } = await supabase.from("videos").update(updatedData).eq("id", video.id).select("*").single();
      if (error) throw error;
      return json({ video: updated, stage: "script_ready", word_count: wordCount, scene_count: scenes.length });
    }

    if (action === "image_asset") {
      const accountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID");
      const cloudflareToken = Deno.env.get("CLOUDFLARE_API_TOKEN");
      if (!accountId || !cloudflareToken) return json({ error: "Faltam CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN nos Secrets do Supabase." }, 503);
      const index = Number(body.sceneIndex);
      const sceneCount = Array.isArray(video.scenes) ? video.scenes.length : 0;
      const isIntroCallout = index === sceneCount;
      const isOutroCallout = index === sceneCount + 1;
      if (!Number.isInteger(index) || (!isIntroCallout && !isOutroCallout && (index < 0 || index >= (video.scenes || []).length))) {
        return json({ error: "Índice de cena ou chamada inválido." }, 400);
      }
      const targetIndex = isIntroCallout ? 0 : isOutroCallout ? sceneCount - 1 : index;
      const scene = video.scenes[targetIndex];
      const urlKey = isIntroCallout ? "intro_callout_image_url" : isOutroCallout ? "outro_callout_image_url" : "image_url";
      const pathKey = isIntroCallout ? "intro_callout_image_path" : isOutroCallout ? "outro_callout_image_path" : "image_path";
      if (scene[urlKey] && scene[pathKey]) return json({ scene, sceneIndex: index, cached: true, stage: "image_ready" });
      const { data: studioRow } = await supabase.from("studios").select("*").eq("created_by", userId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      const visualStyle = String(studioRow?.visual_style || "").trim();
      if (!visualStyle) throw new Error("Nenhum estilo visual foi selecionado em Ajustes. Escolha um estilo antes de gerar as imagens.");
      const introMessage = String(studioRow?.intro_callout || video.hook || "").trim();
      const outroMessage = String(studioRow?.cta || "").trim();
      const themeContext = [
        "TEMA CENTRAL DO VÍDEO: " + String(video.title || ""),
        "FATO CENTRAL PARA ORIENTAR A CENA: " + String(video.fact || ""),
      ].join("\n");
      const visualBrief = isIntroCallout || isOutroCallout
        ? [
          "Crie uma única cena visual que represente o tema central deste vídeo.",
          "Tema: " + String(video.title || ""),
          "Contexto factual breve: " + String(video.fact || ""),
          "A cena será usada como chamada " + (isIntroCallout ? "inicial" : "final") + ", mas NÃO represente palavras da chamada e NÃO escreva a chamada na imagem.",
          "Use somente o tema central como assunto. Não use acontecimentos específicos de outras partes do roteiro.",
        ].join("\n")
        : [
          "Transforme o trecho narrado abaixo em uma descrição visual concreta para uma única imagem documental.",
          "TRECHO NARRADO DE REFERÊNCIA: " + String(scene.narration || ""),
          "ROTEIRO COMPLETO APENAS COMO CONTEXTO PARA RESOLVER PRONOMES, PERSONAGENS E REFERÊNCIAS: " + String(video.script || ""),
          themeContext,
          "Use o roteiro completo apenas para entender corretamente pessoas, animais, lugares, pronomes, causas e contexto. Não tente representar o roteiro inteiro; represente somente o trecho específico.",
          "Descreva sujeito principal, ação, ambiente, composição e detalhes visuais importantes. Converta conceitos abstratos em uma cena visual clara sem usar símbolos escritos ou elementos informativos.",
        ].join("\n");
      const visualPromptRequest = [
        "Converta a referência narrativa em UM prompt de imagem completo, específico e visualmente concreto, em português brasileiro.",
        "O texto narrado é apenas referência semântica. NÃO o copie, NÃO o transforme em palavras visíveis e NÃO peça ao gerador de imagens para escrever ou reproduzir qualquer parte dele.",
        "A descrição deve mostrar uma cena única, com sujeitos e ações identificáveis, cenário coerente e detalhes concretos. Não faça colagem, painel, sequência, infográfico ou composição com várias cenas.",
        "Estilo visual obrigatório e exclusivo, copiado exatamente do campo Estilo visual: " + visualStyle,
        "A descrição final deve respeitar somente esse estilo. Não acrescente técnicas, materiais, texturas, iluminação, acabamento, profundidade ou estética que não estejam descritos no estilo configurado.",
        "Proibição absoluta: não inclua texto, letras, números, escrita, placas, letreiros, rótulos, logotipos, marcas d'água, legendas, balões, interfaces ou pseudo-texto. Se houver objetos que normalmente contenham escrita, represente-os lisos e sem caracteres.",
        "Responda somente com o prompt visual final, em um parágrafo, sem introdução, sem explicações e sem aspas.",
        visualBrief,
      ].join("\n\n");
      const openrouterVisualKey = Deno.env.get("OPENROUTER_API_KEY");
      const visualDescription = await generateVisualPrompt(
        visualPromptRequest,
        openrouterVisualKey,
        groqKey,
        geminiKey,
        zaiKey,
        sensenovaKey,
        apinexKey
      );
      const paperCutoutStyle = /paper\\s*cutout|recorte de papel|camadas de papel/i.test(visualStyle);
      const styleSpecificGuard = paperCutoutStyle
        ? "Preserve rigorosamente o estilo paper cutout 2D descrito em Estilo visual: formas planas recortadas, camadas de papel e sombras discretas somente se estiverem descritas no estilo. Não use CGI, modelagem 3D, aparência plástica ou renderização tridimensional."
        : "Não acrescente técnicas ou características de outros estilos. Use exclusivamente o estilo descrito em Estilo visual.";
      const imagePrompt = [
        visualDescription,
        "ESTILO VISUAL EXCLUSIVO E OBRIGATÓRIO: " + visualStyle,
        "Aplique somente o conteúdo do campo Estilo visual acima. Não misture estilos, não use estilo padrão do modelo e não invente materiais, texturas, técnicas, iluminação ou acabamentos.",
        styleSpecificGuard,
        "Composição vertical 9:16, uma única cena, assunto principal bem enquadrado.",
        "PROIBIÇÃO ABSOLUTA DE TEXTO NA IMAGEM, SEM EXCEÇÕES: zero letras, palavras, números, frases, títulos, legendas, subtítulos, placas, letreiros, rótulos, etiquetas, balões de fala, símbolos tipográficos, caracteres, escrita, assinaturas, logotipos, marcas d'água, interfaces, telas com texto, infográficos, gráficos ou pseudo-texto. Não inclua escrita nem mesmo quando ela existiria naturalmente no cenário. Qualquer placa, livro, tela, embalagem, roupa ou objeto que normalmente tenha escrita deve aparecer totalmente liso, sem caracteres. Não reproduza a narração, o título nem qualquer chamada. O texto só será acrescentado posteriormente na edição do vídeo.",
        "PROMPT NEGATIVO FIXO: text, typography, letters, words, numbers, captions, subtitles, title cards, labels, signs, logos, watermark, signature, handwriting, pseudo-text, glyphs, UI, interface, infographic, chart, poster, banner, speech bubble, text overlay, mixed art styles, style drift, default style, unrequested technique, unrequested material, unrequested texture, unrequested lighting, 3D render unless explicitly specified in Estilo visual.",
      ].join(". ");
      const imageBytes = await generateImageWithContingency(accountId, cloudflareToken, imagePrompt);
      const assetName = isIntroCallout ? "callout-intro" : isOutroCallout ? "callout-outro" : "scene-" + index;
      const imageAsset = await saveAsset(supabase, userId, video.id + "-" + assetName + ".jpg", imageBytes, "image/jpeg");
      const scenes = [...video.scenes];
      const updatedScene = { ...scene, [urlKey]: imageAsset.url, [pathKey]: imageAsset.path };
      scenes[targetIndex] = updatedScene;
      const { data: updated, error } = await supabase.from("videos").update({
        scenes, render_error: "IMAGES_PENDING",
      }).eq("id", video.id).select("*").single();
      if (error) throw error;
      return json({ video: updated, scene: updatedScene, sceneIndex: index, stage: "image_ready", callout: isIntroCallout ? "intro" : isOutroCallout ? "outro" : null });
    }

    if (action === "speech_asset") {
      const index = Number(body.sceneIndex);
      const sceneCount = Array.isArray(video.scenes) ? video.scenes.length : 0;
      const isIntroCallout = index === sceneCount;
      const isOutroCallout = index === sceneCount + 1;
      const isCallout = isIntroCallout || isOutroCallout;
      if (!Number.isInteger(index) || (!isCallout && (index < 0 || index >= (video.scenes || []).length))) {
        return json({ error: "Índice de cena ou chamada inválido." }, 400);
      }
      const targetIndex = isIntroCallout ? 0 : isOutroCallout ? sceneCount - 1 : index;
      const scene = video.scenes[targetIndex];
      const pathKey = isIntroCallout ? "intro_audio_path" : isOutroCallout ? "outro_audio_path" : "audio_path";
      const durationKey = isIntroCallout ? "intro_audio_duration" : isOutroCallout ? "outro_audio_duration" : "audio_duration";
      const textKey = isIntroCallout ? "intro_audio_text" : isOutroCallout ? "outro_audio_text" : "";
      const narrationText = isCallout ? String(body.narrationText || "").trim() : String(scene?.narration || "").trim();
      if (!scene || !narrationText) return json({ error: "Não há texto de narração para esta cena ou chamada." }, 400);
      if (scene[pathKey] && Number(scene[durationKey]) > 0 &&
          (!isCallout || String(scene[textKey] || "") === narrationText)) {
        return json({ scene, sceneIndex: index, cached: true, stage: "speech_ready" });
      }
      const imageUrlKey = isIntroCallout ? "intro_callout_image_url" : isOutroCallout ? "outro_callout_image_url" : "image_url";
      const imagePathKey = isIntroCallout ? "intro_callout_image_path" : isOutroCallout ? "outro_callout_image_path" : "image_path";
      if (!scene[imageUrlKey] || !scene[imagePathKey]) {
        return json({ error: "A imagem desta cena ou chamada ainda não foi gerada." }, 409);
      }
      const { data: studioRow } = await supabase.from("studios").select("*").eq("created_by", userId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      const voice = String(video.voice || studioRow?.voice || "river");
      const wavBytes = await generateSpeech(narrationText, voice);
      const assetName = isIntroCallout ? "voice-callout-intro.wav" : isOutroCallout ? "voice-callout-outro.wav" : "voice-" + index + ".wav";
      const audioAsset = await saveAsset(supabase, userId, video.id + "-" + assetName, wavBytes, "audio/wav");
      const pcm = getWavPcm(wavBytes);
      const duration = pcm.length / 48000;
      const scenes = [...video.scenes];
      const updatedScene = isCallout
        ? { ...scene, [pathKey]: audioAsset.path, [durationKey]: duration, [textKey]: narrationText }
        : { ...scene, [pathKey]: audioAsset.path, [durationKey]: duration };
      scenes[targetIndex] = updatedScene;
      const { data: updated, error } = await supabase.from("videos").update({
        scenes, render_error: "SPEECH_PENDING",
      }).eq("id", video.id).select("*").single();
      if (error) throw error;
      return json({ video: updated, scene: updatedScene, sceneIndex: index, stage: "speech_ready", duration, callout: isIntroCallout ? "intro" : isOutroCallout ? "outro" : null });
    }

    if (action === "finalize_audio") {
      const scenes = Array.isArray(video.scenes) ? video.scenes : [];
      const sceneCount = scenes.length;
      const lastSceneIndex = sceneCount - 1;
      if (sceneCount < 6 || scenes.some((scene: any) => !scene.image_url || !scene.audio_path || !scene.audio_duration)) {
        return json({ error: "A produção precisa ter todas as " + sceneCount + " imagens e partes da narração antes de juntar o áudio." }, 409);
      }
      const pcmParts: Uint8Array[] = [];
      const timedScenes: any[] = [];
      let cursor = 0;
      const downloadPcm = async (path: string, label: string) => {
        const { data: file, error } = await supabase.storage.from("assets").download(path);
        if (error || !file) throw new Error("Não foi possível recuperar a voz da " + label + ": " + (error?.message || "arquivo ausente"));
        return trimPcmSilence(getWavPcm(new Uint8Array(await file.arrayBuffer())));
      };

      let introDuration = 0;
      if (scenes[0]?.intro_audio_path) {
        const introPcm = await downloadPcm(String(scenes[0].intro_audio_path), "chamada inicial");
        introDuration = introPcm.length / 48000;
        pcmParts.push(introPcm);
        cursor += introDuration;
      }

      for (const scene of scenes) {
        const pcm = await downloadPcm(String(scene.audio_path), "roteiro");
        const duration = pcm.length / 48000;
        const start = cursor;
        const end = cursor + duration;
        timedScenes.push({ ...scene, audio_duration: duration, start_seconds: start, end_seconds: end, captions: [] });
        pcmParts.push(pcm);
        cursor = end;
      }

      let outroDuration = 0;
      if (scenes[lastSceneIndex]?.outro_audio_path) {
        const outroPcm = await downloadPcm(String(scenes[lastSceneIndex].outro_audio_path), "chamada final");
        outroDuration = outroPcm.length / 48000;
        pcmParts.push(outroPcm);
        cursor += outroDuration;
      }

      if (timedScenes[0]) {
        timedScenes[0] = { ...timedScenes[0], intro_audio_duration: introDuration, audio_timeline_version: 1 };
      }
      if (timedScenes[lastSceneIndex]) {
        timedScenes[lastSceneIndex] = { ...timedScenes[lastSceneIndex], outro_audio_duration: outroDuration };
      }

      const { data: durationStudio } = await supabase.from("studios").select("duration_target")
        .eq("created_by", userId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      const targetSeconds = Math.max(120, Math.min(300, Math.round(Number(durationStudio?.duration_target) || 180)));
      if (cursor < targetSeconds * 0.8 || cursor > targetSeconds * 1.2) {
        return json({ error: "A narração ficou com " + Math.round(cursor) + " segundos, mas a duração escolhida é " + targetSeconds + " segundos. O roteiro precisa ser recalibrado antes da montagem.", audio_duration: cursor, target_duration: targetSeconds }, 422);
      }
      const totalLength = pcmParts.reduce((sum, part) => sum + part.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const part of pcmParts) { combined.set(part, offset); offset += part.length; }
      const wav = pcmToWav(combined, 48000);
      const audioAsset = await saveAsset(supabase, userId, video.id + "-narration-full.wav", wav, "audio/wav");
      const { data: updated, error } = await supabase.from("videos").update({
        scenes: timedScenes,
        audio_url: audioAsset.url,
        render_status: "renderizando",
        render_error: "AUDIO_READY",
        status: "roteiro",
      }).eq("id", video.id).select("*").single();
      if (error) throw error;
      return json({ video: updated, stage: "audio_ready", audio_duration: cursor, scene_count: timedScenes.length });
    }

    if (action === "build_captions") {
      const scenes = Array.isArray(video.scenes) ? video.scenes : [];
      if (!scenes.length || !video.audio_url || scenes.some((scene: any) => !scene.start_seconds && scene.start_seconds !== 0)) {
        return json({ error: "A linha do tempo da narração ainda não está pronta para criar as legendas." }, 409);
      }
      const timedScenes = scenes.map((scene: any) => {
        const phrases = phraseChunks(String(scene.narration || ""), 7);
        const duration = Number(scene.end_seconds) - Number(scene.start_seconds);
        const totalChars = Math.max(1, phrases.reduce((sum, phrase) => sum + phrase.length, 0));
        let phraseCursor = Number(scene.start_seconds);
        const captions = phrases.map((phrase, i) => {
          const portion = duration * (phrase.length / totalChars);
          const item = { text: phrase, start_seconds: phraseCursor, end_seconds: i === phrases.length - 1 ? Number(scene.end_seconds) : phraseCursor + portion };
          phraseCursor += portion;
          return item;
        });
        return { ...scene, captions };
      });
      const { data: updated, error } = await supabase.from("videos").update({
        scenes: timedScenes,
        render_error: "CAPTIONS_READY",
      }).eq("id", video.id).select("*").single();
      if (error) throw error;
      return json({ video: updated, stage: "captions_ready", scene_count: timedScenes.length });
    }

    return json({ error: "Ação não reconhecida." }, 400);
  } catch (error) {
    const message = String((error as Error)?.message || error).slice(0, 800);
    console.error("[VIDEO_PIPELINE] failure", message);
    return json({ error: message }, 500);
  }
});