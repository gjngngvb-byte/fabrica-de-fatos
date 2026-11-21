const WIDTH = 720;
const HEIGHT = 1280;
const FPS = 24;

function wrapText(context, text, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (context.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function drawRoundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

async function loadBitmap(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Não foi possível baixar uma das imagens do vídeo.");
  return createImageBitmap(await response.blob());
}

function drawCover(context, bitmap, progress, alpha = 1) {
  const scale = Math.max(WIDTH / bitmap.width, HEIGHT / bitmap.height) * (1.02 + 0.07 * progress);
  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;
  const drift = Math.sin(progress * Math.PI) * 12;
  const x = (WIDTH - drawWidth) / 2 + drift;
  const y = (HEIGHT - drawHeight) / 2;
  context.globalAlpha = alpha;
  context.drawImage(bitmap, x, y, drawWidth, drawHeight);
  context.globalAlpha = 1;
}

function drawFrame(context, scenes, bitmaps, time) {
  let index = scenes.findIndex((scene) => time >= Number(scene.start_seconds) && time < Number(scene.end_seconds));
  if (index < 0) index = time >= Number(scenes[scenes.length - 1]?.end_seconds) ? scenes.length - 1 : 0;
  const scene = scenes[index];
  const start = Number(scene.start_seconds) || 0;
  const end = Number(scene.end_seconds) || start + 1;
  const duration = Math.max(0.1, end - start);
  const progress = Math.max(0, Math.min(1, (time - start) / duration));

  context.fillStyle = "#080808";
  context.fillRect(0, 0, WIDTH, HEIGHT);
  drawCover(context, bitmaps[index], progress);

  const nextScene = scenes[index + 1];
  const transitionStart = Math.max(start, end - 0.55);
  if (nextScene && time >= transitionStart) {
    const nextProgress = Math.min(1, (time - transitionStart) / 0.55);
    drawCover(context, bitmaps[index + 1], 0, nextProgress);
  }

  const caption = (scene.captions || []).find((item) => time >= Number(item.start_seconds) && time < Number(item.end_seconds));
  if (caption?.text) {
    context.save();
    context.font = "bold 43px Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    const lines = wrapText(context, caption.text, WIDTH - 104);
    const lineHeight = 55;
    const boxHeight = lines.length * lineHeight + 42;
    const boxY = HEIGHT - 280 - boxHeight / 2;
    context.fillStyle = "rgba(0,0,0,0.68)";
    drawRoundedRect(context, 38, boxY, WIDTH - 76, boxHeight, 20);
    context.fill();
    context.fillStyle = "#ffffff";
    lines.forEach((line, lineIndex) => {
      context.strokeStyle = "rgba(0,0,0,0.9)";
      context.lineWidth = 3;
      const y = boxY + 22 + lineHeight * lineIndex + lineHeight / 2;
      context.strokeText(line, WIDTH / 2, y, WIDTH - 110);
      context.fillText(line, WIDTH / 2, y, WIDTH - 110);
    });
    context.restore();
  }
}

export async function recordNarratedSlideshow(video, onProgress = () => {}) {
  if (!navigator.mediaDevices || typeof MediaRecorder === "undefined") {
    throw new Error("Este navegador não oferece gravação de vídeo. Abra o estúdio no Chrome ou Edge atualizado.");
  }
  const scenes = video.scenes || [];
  if (!scenes.length || !video.audio_url) throw new Error("O vídeo ainda não tem imagens e narração completas.");

  onProgress(0, "Carregando imagens e narração");
  const bitmaps = [];
  for (let i = 0; i < scenes.length; i++) {
    bitmaps.push(await loadBitmap(scenes[i].image_url));
    onProgress(Math.round(((i + 1) / scenes.length) * 8), "Carregando imagem " + (i + 1) + " de " + scenes.length);
  }

  const audioResponse = await fetch(video.audio_url);
  if (!audioResponse.ok) throw new Error("Não foi possível carregar a narração final.");
  const audioBytes = await audioResponse.arrayBuffer();
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioContext = new AudioContextClass();
  const audioBuffer = await audioContext.decodeAudioData(audioBytes.slice(0));
  if (audioBuffer.duration < 120 || audioBuffer.duration > 300) {
    await audioContext.close();
    throw new Error("A narração tem " + Math.round(audioBuffer.duration) + " segundos. O limite é de 2 a 5 minutos.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Não foi possível preparar a tela de composição.");
  drawFrame(context, scenes, bitmaps, 0);

  const videoStream = canvas.captureStream(FPS);
  const audioDestination = audioContext.createMediaStreamDestination();
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioDestination);
  const stream = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...audioDestination.stream.getAudioTracks(),
  ]);
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
    ? "video/webm;codecs=vp9,opus"
    : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
      ? "video/webm;codecs=vp8,opus"
      : "video/webm";
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_200_000, audioBitsPerSecond: 96_000 });
  const chunks = [];
  const startAt = audioContext.currentTime + 0.15;

  const recorded = new Promise((resolve, reject) => {
    recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    recorder.onerror = (event) => reject(event.error || new Error("Falha ao gravar a composição."));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });

  recorder.start(1000);
  await audioContext.resume();
  source.start(startAt);

  await new Promise((resolve) => {
    const frame = () => {
      const elapsed = Math.max(0, audioContext.currentTime - startAt);
      drawFrame(context, scenes, bitmaps, Math.min(audioBuffer.duration, elapsed));
      onProgress(8 + Math.round((elapsed / audioBuffer.duration) * 67), "Sincronizando cenas e legendas · " + Math.min(100, Math.round((elapsed / audioBuffer.duration) * 100)) + "%");
      if (elapsed < audioBuffer.duration) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
    source.onended = () => resolve();
  });

  if (recorder.state !== "inactive") recorder.stop();
  const webm = await recorded;
  stream.getTracks().forEach((track) => track.stop());
  bitmaps.forEach((bitmap) => bitmap.close?.());
  await audioContext.close();
  if (!webm.size) throw new Error("A gravação ficou vazia.");
  return webm;
}

export async function convertWebmToMp4(webm, onProgress = () => {}) {
  onProgress(76, "Carregando conversor MP4");
  const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
    import("@ffmpeg/ffmpeg"),
    import("@ffmpeg/util"),
  ]);
  const ffmpeg = new FFmpeg();
  const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
  const coreURL = await toBlobURL(base + "/ffmpeg-core.js", "text/javascript");
  const wasmURL = await toBlobURL(base + "/ffmpeg-core.wasm", "application/wasm");
  await ffmpeg.load({ coreURL, wasmURL });
  ffmpeg.on("progress", ({ progress }) => {
    onProgress(78 + Math.round(Math.max(0, Math.min(1, progress)) * 19), "Convertendo para MP4 · " + Math.round(progress * 100) + "%");
  });
  await ffmpeg.writeFile("input.webm", new Uint8Array(await webm.arrayBuffer()));
  const code = await ffmpeg.exec([
    "-i", "input.webm",
    "-map", "0:v:0",
    "-map", "0:a:0",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "25",
    "-pix_fmt", "yuv420p",
    "-r", String(FPS),
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    "-shortest",
    "output.mp4",
  ]);
  if (code !== 0) {
    ffmpeg.terminate();
    throw new Error("O conversor não conseguiu finalizar o MP4 (código " + code + ").");
  }
  const output = await ffmpeg.readFile("output.mp4");
  ffmpeg.terminate();
  const mp4 = new Blob([output], { type: "video/mp4" });
  if (mp4.size < 64 * 1024) throw new Error("O MP4 final ficou pequeno demais e não passou na validação.");
  const header = new Uint8Array(await mp4.slice(0, 16).arrayBuffer());
  if (String.fromCharCode(...header.slice(4, 8)) !== "ftyp") throw new Error("O arquivo gerado não tem assinatura MP4 válida.");
  onProgress(98, "MP4 validado");
  return mp4;
}
