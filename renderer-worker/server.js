import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pipeline } from "node:stream/promises";

const PORT = Number(process.env.PORT || 10000);
const API_TOKEN = process.env.RENDERER_API_TOKEN || "";
const JOB_TTL_MS = 30 * 60 * 1000;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const FPS = 24;
const jobs = new Map();
let queue = Promise.resolve();

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
  });
  res.end(JSON.stringify(payload));
}

function safeUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error("URL de mídia inválida."); }
  if (url.protocol !== "https:" || !url.hostname || url.hostname === "localhost" ||
      url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local")) {
    throw new Error("Somente URLs HTTPS públicas são aceitas pelo renderizador.");
  }
  return url.toString();
}

async function readJson(req, maxBytes = 512 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("A solicitação ultrapassou o tamanho permitido.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function downloadToFile(urlValue, destination, maxBytes) {
  const url = safeUrl(urlValue);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!response.ok || !response.body) throw new Error("Falha ao baixar mídia (HTTP " + response.status + ").");
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > maxBytes) throw new Error("Arquivo de mídia maior que o limite permitido.");
    let received = 0;
    const limiter = new TransformStream({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > maxBytes) throw new Error("Arquivo de mídia excedeu o limite permitido.");
        controller.enqueue(chunk);
      },
    });
    await pipeline(
      response.body.pipeThrough(limiter),
      createWriteStream(destination),
    );
    if (!received) throw new Error("Arquivo de mídia vazio.");
    return received;
  } finally {
    clearTimeout(timeout);
  }
}

function assTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const whole = Math.floor(value % 60);
  const centiseconds = Math.floor((value - Math.floor(value)) * 100);
  return String(hours) + ":" + String(minutes).padStart(2, "0") + ":" +
    String(whole).padStart(2, "0") + "." + String(centiseconds).padStart(2, "0");
}

function assEscape(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/{/g, "\\{").replace(/}/g, "\\}").replace(/\n/g, " ");
}

function makeAss(scenes, width, height, callouts) {
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: " + width,
    "PlayResY: " + height,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,DejaVu Sans," + Math.round(width / 16) + ",&H00FFFFFF,&H000000FF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,70,70," + Math.round(height * 0.105) + ",1",
    "Style: Callout,DejaVu Sans," + Math.round(width / 21) + ",&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,5,70,70,70,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  for (const scene of scenes) {
    for (const caption of (Array.isArray(scene.captions) ? scene.captions : [])) {
      const start = Number(caption.start_seconds);
      const end = Number(caption.end_seconds);
      if (!caption.text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      lines.push("Dialogue: 0," + assTime(start) + "," + assTime(end) + ",Default,,0,0,0,," + assEscape(caption.text));
    }
  }
  if (callouts?.introText || callouts?.introTitle) {
    const text = [callouts.introTitle, callouts.introText].filter(Boolean).join("\\N");
    lines.push("Dialogue: 1,0:00:00.00,0:00:01.00,Callout,,0,0,0,," + assEscape(text));
  }
  if (callouts?.outroText || callouts?.channelName) {
    const text = [callouts.outroText, callouts.channelName ? "no " + callouts.channelName : ""].filter(Boolean).join("\\N");
    lines.push("Dialogue: 1,0:04:50.00,0:06:00.00,Callout,,0,0,0,," + assEscape(text));
  }
  return lines.join("\n") + "\n";
}

function buildFfmpegArgs(job, inputs, outputPath, subtitlesPath, duration) {
  const width = job.outputResolution === "720p" ? 720 : 1080;
  const height = job.outputResolution === "720p" ? 1280 : 1920;
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-filter_complex_threads", "1"];
  for (const file of inputs.images) {
    args.push("-loop", "1", "-framerate", String(FPS), "-t", String(duration), "-i", file);
  }
  args.push("-i", inputs.audio);
  const audioIndex = inputs.images.length;
  const filters = [];
  const videoLabels = [];
  for (let i = 0; i < inputs.images.length; i++) {
    const sceneDuration = inputs.durations[i];
    const label = "v" + i;
    const motion = i % 2 === 0
      ? "sin(on/130)*iw*0.025"
      : "-sin(on/130)*iw*0.025";
    filters.push(
      "[" + i + ":v]scale=" + width + ":" + height + ":force_original_aspect_ratio=increase," +
      "crop=" + width + ":" + height + "," +
      "zoompan=z='1.02+0.015*sin(on/170)':x='iw/2-(iw/zoom/2)+" + motion +
      "':y='ih/2-(ih/zoom/2)+cos(on/180)*ih*0.012':d=1:s=" + width + "x" + height +
      ":fps=" + FPS + ",trim=duration=" + sceneDuration.toFixed(3) +
      ",setpts=PTS-STARTPTS,setsar=1,format=yuv420p[" + label + "]",
    );
    videoLabels.push("[" + label + "]");
  }
  filters.push(videoLabels.join("") + "concat=n=" + inputs.images.length + ":v=1:a=0,subtitles='" +
    subtitlesPath.replace(/'/g, "\\'") + "'[vout]");
  args.push("-filter_complex", filters.join(";"));
  args.push(
    "-map", "[vout]", "-map", audioIndex + ":a:0",
    "-t", String(duration),
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "22",
    "-pix_fmt", "yuv420p", "-r", String(FPS), "-profile:v", "high",
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", "-max_muxing_queue_size", "2048",
    "-progress", "pipe:1", "-nostats", outputPath,
  );
  return args;
}

async function runFfmpeg(args, job, duration) {
  await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let progressBuffer = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 20 * 60 * 1000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      progressBuffer += chunk;
      const blocks = progressBuffer.split("\n");
      progressBuffer = blocks.pop() || "";
      for (const line of blocks) {
        const [key, value] = line.split("=");
        if (key === "out_time_ms") {
          const seconds = Number(value) / 1_000_000;
          if (Number.isFinite(seconds)) job.progress = Math.min(94, Math.max(job.progress, Math.round(seconds / duration * 94)));
        }
        if (key === "progress" && value === "end") job.progress = 95;
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-8000); });
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error("FFmpeg encerrou com código " + code + (signal ? " (" + signal + ")" : "") + ": " + stderr.slice(-1800)));
    });
  });
}

async function processJob(job) {
  const dir = path.join(os.tmpdir(), "fabrica-render-" + job.id);
  job.dir = dir;
  try {
    await mkdir(dir, { recursive: true });
    job.status = "downloading";
    job.message = "Baixando imagens e narração para renderização no servidor.";
    const scenes = job.payload.scenes;
    const imageFiles = [];
    const durations = [];
    let totalDuration = 0;
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const imageUrl = safeUrl(scene.image_url);
      const file = path.join(dir, "scene-" + String(i + 1).padStart(2, "0") + ".img");
      await downloadToFile(imageUrl, file, MAX_IMAGE_BYTES);
      imageFiles.push(file);
      const start = Number(scene.start_seconds) || totalDuration;
      const end = Number(scene.end_seconds);
      const sceneDuration = Number.isFinite(end) && end > start ? end - start : 1;
      durations.push(sceneDuration);
      totalDuration += sceneDuration;
      job.progress = Math.min(8, Math.round((i + 1) / scenes.length * 8));
      job.message = "Imagem " + (i + 1) + " de " + scenes.length + " recebida.";
    }
    const audioFile = path.join(dir, "narration.wav");
    await downloadToFile(job.payload.audio_url, audioFile, MAX_AUDIO_BYTES);
    const audioStats = await stat(audioFile);
    if (audioStats.size < 44) throw new Error("A narração baixada está vazia ou incompleta.");
    const outputPath = path.join(dir, "final.mp4");
    const subtitlesPath = path.join(dir, "captions.ass");
    const width = job.payload.outputResolution === "720p" ? 720 : 1080;
    const height = job.payload.outputResolution === "720p" ? 1280 : 1920;
    const ass = makeAss(scenes, width, height, job.payload.callouts || {});
    await import("node:fs/promises").then(({ writeFile }) => writeFile(subtitlesPath, ass, "utf8"));
    job.status = "rendering";
    job.message = "FFmpeg está compondo as 15 cenas, movimentos, legendas e narração.";
    job.progress = 10;
    const args = buildFfmpegArgs(job.payload, { images: imageFiles, durations, audio: audioFile }, outputPath, subtitlesPath, totalDuration);
    await runFfmpeg(args, job, totalDuration);
    const outputStats = await stat(outputPath);
    if (outputStats.size < 100 * 1024) throw new Error("O MP4 gerado pelo servidor ficou pequeno demais.");
    job.outputPath = outputPath;
    job.status = "completed";
    job.progress = 100;
    job.message = "MP4 H.264 + AAC criado no servidor.";
    job.completedAt = Date.now();
  } catch (error) {
    job.status = "failed";
    job.error = error?.message || String(error);
    job.message = "A renderização no servidor falhou.";
  }
}

function startQueuedJob(job) {
  queue = queue.then(() => processJob(job)).catch((error) => {
    job.status = "failed";
    job.error = error?.message || String(error);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
    });
    return res.end();
  }
  const url = new URL(req.url || "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, service: "fabrica-de-fatos-renderer" });
  }
  if (!API_TOKEN) return sendJson(res, 503, { error: "RENDERER_API_TOKEN não configurado." });
  if (req.method === "POST" && url.pathname === "/jobs") {
    if (req.headers.authorization !== "Bearer " + API_TOKEN) return sendJson(res, 401, { error: "Não autorizado." });
    try {
      const payload = await readJson(req);
      if (!Array.isArray(payload.scenes) || payload.scenes.length !== 15 || !payload.audio_url) {
        return sendJson(res, 400, { error: "A solicitação exige 15 cenas e a narração completa." });
      }
      for (const scene of payload.scenes) safeUrl(scene.image_url);
      safeUrl(payload.audio_url);
      const id = randomUUID();
      const accessToken = randomBytes(24).toString("hex");
      const job = {
        id, accessToken, status: "queued", progress: 0,
        message: "Renderização adicionada à fila do servidor.",
        payload, createdAt: Date.now(),
      };
      jobs.set(id, job);
      startQueuedJob(job);
      setTimeout(async () => {
        jobs.delete(id);
        if (job.dir) await rm(job.dir, { recursive: true, force: true }).catch(() => {});
      }, JOB_TTL_MS).unref?.();
      return sendJson(res, 202, { jobId: id, accessToken, statusUrl: "/jobs/" + id });
    } catch (error) {
      return sendJson(res, 400, { error: error?.message || "Solicitação inválida." });
    }
  }
  const match = url.pathname.match(/^\/jobs\/([0-9a-f-]{36})(?:\/file)?$/i);
  if (req.method === "GET" && match) {
    const job = jobs.get(match[1]);
    if (!job || url.searchParams.get("token") !== job.accessToken) return sendJson(res, 404, { error: "Trabalho não encontrado." });
    if (url.pathname.endsWith("/file")) {
      if (job.status !== "completed" || !job.outputPath) return sendJson(res, 409, { error: "O MP4 ainda não está pronto." });
      const info = await stat(job.outputPath);
      res.writeHead(200, {
        "content-type": "video/mp4",
        "content-length": info.size,
        "content-disposition": 'attachment; filename="fabrica-de-fatos.mp4"',
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      });
      return createReadStream(job.outputPath).pipe(res);
    }
    return sendJson(res, 200, {
      jobId: job.id, status: job.status, progress: job.progress,
      message: job.message, error: job.error || "",
      downloadUrl: job.status === "completed" ? "/jobs/" + job.id + "/file?token=" + job.accessToken : "",
    });
  }
  return sendJson(res, 404, { error: "Rota não encontrada." });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Fábrica de Fatos renderer listening on " + PORT);
});
