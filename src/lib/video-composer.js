const WIDTH = 720;
const HEIGHT = 1280;
const FPS = 24;

function wrapText(context, text, maxWidth, maxLines = 3) {
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
  return lines.slice(0, maxLines);
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

function decodePcmWav(audioContext, bytes) {
  const view = new DataView(bytes);
  const readTag = (offset) => String.fromCharCode(
    view.getUint8(offset), view.getUint8(offset + 1),
    view.getUint8(offset + 2), view.getUint8(offset + 3),
  );
  if (bytes.byteLength < 44 || readTag(0) !== "RIFF" || readTag(8) !== "WAVE") {
    throw new Error("O arquivo de narração recebido não é um WAV válido.");
  }

  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let blockAlign = 0;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= bytes.byteLength) {
    const tag = readTag(offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + size > bytes.byteLength) {
      throw new Error("O arquivo de narração chegou incompleto. Tente novamente.");
    }
    if (tag === "fmt ") {
      if (size < 16) throw new Error("Cabeçalho WAV inválido.");
      audioFormat = view.getUint16(start, true);
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      blockAlign = view.getUint16(start + 12, true);
      bitsPerSample = view.getUint16(start + 14, true);
      // WAVE_FORMAT_EXTENSIBLE stores the real subtype GUID after the base fmt fields.
      if (audioFormat === 0xfffe && size >= 40) {
        const subtype = view.getUint32(start + 24, true);
        if (subtype === 1 || subtype === 3) audioFormat = subtype;
      }
    } else if (tag === "data") {
      dataOffset = start;
      dataSize = size;
      break;
    }
    offset = start + size + (size % 2);
  }

  const bytesPerSample = bitsPerSample / 8;
  const supportedPcm = audioFormat === 1 && [8, 16, 24, 32].includes(bitsPerSample);
  const supportedFloat = audioFormat === 3 && [32, 64].includes(bitsPerSample);
  const expectedBlockAlign = channels * bytesPerSample;
  if ((!supportedPcm && !supportedFloat) || !channels || !sampleRate ||
      dataOffset < 0 || !bytesPerSample || blockAlign !== expectedBlockAlign) {
    throw new Error(
      "Formato WAV não suportado (formato " + audioFormat + ", " + bitsPerSample +
      " bits, " + channels + " canal(is))."
    );
  }

  const frameCount = Math.floor(dataSize / blockAlign);
  if (!frameCount || dataOffset + frameCount * blockAlign > bytes.byteLength) {
    throw new Error("Os dados da narração estão incompletos ou vazios.");
  }

  const audioBuffer = audioContext.createBuffer(channels, frameCount, sampleRate);
  for (let channel = 0; channel < channels; channel++) {
    const output = audioBuffer.getChannelData(channel);
    for (let frame = 0; frame < frameCount; frame++) {
      const sampleOffset = dataOffset + frame * blockAlign + channel * bytesPerSample;
      let sample;
      if (supportedFloat) {
        sample = bitsPerSample === 32
          ? view.getFloat32(sampleOffset, true)
          : view.getFloat64(sampleOffset, true);
      } else if (bitsPerSample === 8) {
        sample = (view.getUint8(sampleOffset) - 128) / 128;
      } else if (bitsPerSample === 16) {
        const value = view.getInt16(sampleOffset, true);
        sample = value < 0 ? value / 32768 : value / 32767;
      } else if (bitsPerSample === 24) {
        let value = view.getUint8(sampleOffset) |
          (view.getUint8(sampleOffset + 1) << 8) |
          (view.getUint8(sampleOffset + 2) << 16);
        if (value & 0x800000) value |= 0xff000000;
        sample = value / (value < 0 ? 8388608 : 8388607);
      } else {
        const value = view.getInt32(sampleOffset, true);
        sample = value < 0 ? value / 2147483648 : value / 2147483647;
      }
      output[frame] = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
    }
  }
  return audioBuffer;
}
async function loadBitmap(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível baixar uma das imagens do vídeo (HTTP " + response.status + ").");
  const objectUrl = URL.createObjectURL(await response.blob());
  const image = new Image();
  image.decoding = "async";
  image.src = objectUrl;
  try {
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("Imagem carregada sem dimensões válidas.");
    image._composerObjectUrl = objectUrl;
    return image;
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw new Error("Não foi possível decodificar uma imagem do vídeo: " + (error?.message || String(error)));
  }
}

function drawCover(context, bitmap, progress, alpha = 1, width = WIDTH, height = HEIGHT, motionSeed = 0) {
  if (!bitmap || !bitmap.complete || !bitmap.naturalWidth || !bitmap.naturalHeight) {
    throw new Error("Uma imagem da montagem foi desconectada ou perdeu os dados antes da renderização.");
  }
  const imageWidth = bitmap.naturalWidth;
  const imageHeight = bitmap.naturalHeight;
  const t = Math.max(0, Math.min(1, progress));
  // Slow Ken Burns-style camera motion with clearly visible lateral travel.
  // Every scene pans horizontally; selected scenes also add a gentle vertical
  // drift or a very subtle zoom so the movement never feels like a static zoom.
  const motions = [
    { fromX: -1, fromY: 0, toX: 1, toY: 0, zoom: "none" },
    { fromX: 1, fromY: -0.25, toX: -1, toY: 0.25, zoom: "none" },
    { fromX: -1, fromY: 1, toX: 1, toY: -1, zoom: "in" },
    { fromX: 1, fromY: 0, toX: -1, toY: 0, zoom: "out" },
    { fromX: -1, fromY: -1, toX: 1, toY: 1, zoom: "none" },
    { fromX: 1, fromY: 0.5, toX: -1, toY: -0.5, zoom: "in" },
    { fromX: -1, fromY: 0, toX: 1, toY: 0, zoom: "out" },
  ];
  const motion = motions[Math.abs(Number(motionSeed) || 0) % motions.length];
  const zoomProgress = motion.zoom === "out" ? 1 - t : t;
  const zoomAmount = motion.zoom === "none" ? 1.022 : 1.015 + zoomProgress * 0.018;
  const scale = Math.max(width / imageWidth, height / imageHeight) * zoomAmount;
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  const horizontalRoom = Math.max(0, drawWidth - width);
  const verticalRoom = Math.max(0, drawHeight - height);
  // Smooth ease-in/ease-out prevents abrupt starts and stops. The lateral
  // travel is now large enough to be seen on a phone, without reaching the crop edge.
  const ease = t * t * (3 - 2 * t);
  const travelX = Math.min(horizontalRoom * 0.5, width * 0.12);
  const travelY = Math.min(verticalRoom * 0.5, height * 0.055);
  const directionX = motion.fromX + (motion.toX - motion.fromX) * ease;
  const directionY = motion.fromY + (motion.toY - motion.fromY) * ease;
  const x = (width - drawWidth) / 2 + directionX * travelX;
  const y = (height - drawHeight) / 2 + directionY * travelY;
  context.globalAlpha = alpha;
  try {
    context.drawImage(bitmap, x, y, drawWidth, drawHeight);
  } finally {
    context.globalAlpha = 1;
  }
}

function pickAccentColor(bitmap) {
  try {
    const sample = document.createElement("canvas");
    sample.width = 24;
    sample.height = 24;
    const sampleContext = sample.getContext("2d", { willReadFrequently: true });
    if (!sampleContext) return "#FFE36E";
    sampleContext.drawImage(bitmap, 0, 0, 24, 24);
    const pixels = sampleContext.getImageData(0, 0, 24, 24).data;
    let red = 0, green = 0, blue = 0, count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 100) continue;
      red += pixels[i];
      green += pixels[i + 1];
      blue += pixels[i + 2];
      count++;
    }
    if (!count) return "#FFE36E";
    red /= count * 255;
    green /= count * 255;
    blue /= count * 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    let hue = 45;
    if (delta > 0.025) {
      if (max === red) hue = 60 * (((green - blue) / delta) % 6);
      else if (max === green) hue = 60 * ((blue - red) / delta + 2);
      else hue = 60 * ((red - green) / delta + 4);
    }
    hue = (hue + 360) % 360;
    return "hsl(" + Math.round(hue) + ", 88%, 68%)";
  } catch {
    return "#FFE36E";
  }
}

function drawCalloutOverlay(context, { title = "", message = "", channelName = "", accentColor = "#FFE36E" } = {}, width = WIDTH, height = HEIGHT, alpha = 1) {
  const scale = width / 720;
  const maxWidth = width - 112 * scale;
  const entries = [];
  if (title) entries.push({ text: title, fontSize: 40, color: accentColor, weight: "bold", gap: 12 });
  if (message) entries.push({ text: message, fontSize: 32, color: "#FFFFFF", weight: "bold", gap: 10 });
  if (channelName) entries.push({ text: "no " + channelName, fontSize: 29, color: accentColor, weight: "bold", gap: 0 });
  if (!entries.length) return;

  context.save();
  context.globalAlpha = alpha;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const fontFamily = "'Trebuchet MS', 'Arial Rounded MT Bold', sans-serif";
  const prepared = entries.map((entry) => {
    context.font = entry.weight + " " + Math.round(entry.fontSize * scale) + "px " + fontFamily;
    return { ...entry, lines: wrapText(context, entry.text, maxWidth - 36 * scale, 5) };
  });
  const lineHeights = prepared.map((entry) => entry.fontSize * 1.22 * scale);
  const contentHeight = prepared.reduce((sum, entry, i) =>
    sum + entry.lines.length * lineHeights[i] + entry.gap * scale, 0);
  const padding = 25 * scale;
  const boxHeight = contentHeight + padding * 2;
  const boxY = height - 220 * scale - boxHeight;
  context.fillStyle = "rgba(0,0,0,0.70)";
  drawRoundedRect(context, 38 * scale, boxY, width - 76 * scale, boxHeight, 22 * scale);
  context.fill();
  // A restrained accent strip gives the callout a designed, finished edge.
  context.fillStyle = accentColor;
  drawRoundedRect(context, width / 2 - 42 * scale, boxY + 7 * scale, 84 * scale, 5 * scale, 3 * scale);
  context.fill();
  let cursorY = boxY + padding + 5 * scale;
  prepared.forEach((entry, i) => {
    context.font = entry.weight + " " + Math.round(entry.fontSize * scale) + "px " + fontFamily;
    const lineHeight = lineHeights[i];
    entry.lines.forEach((line) => {
      const y = cursorY + lineHeight / 2;
      context.shadowColor = "rgba(0,0,0,0.55)";
      context.shadowBlur = 7 * scale;
      context.lineWidth = 2.5 * scale;
      context.strokeStyle = "rgba(0,0,0,0.85)";
      context.strokeText(line, width / 2, y, maxWidth);
      context.fillStyle = entry.color;
      context.fillText(line, width / 2, y, maxWidth);
      cursorY += lineHeight;
    });
    cursorY += entry.gap * scale;
  });
  context.restore();
}

function drawFrame(context, scenes, bitmaps, time, callouts = {}, width = WIDTH, height = HEIGHT, totalDuration = Number(scenes[scenes.length - 1]?.end_seconds) || 0) {
  const introDuration = callouts.introIndex !== undefined ? Math.max(0, Number(scenes[0]?.intro_audio_duration) || 0.8) : 0;
  const outroDuration = callouts.outroIndex !== undefined ? Math.max(0, Number(scenes[scenes.length - 1]?.outro_audio_duration) || 0.8) : 0;
  const introActive = introDuration > 0 && time < introDuration;
  const outroStart = totalDuration - outroDuration;
  const outroActive = outroDuration > 0 && time >= outroStart;

  // Keep every scene and caption on the original narration clock. The opening
  // and closing callouts occupy the first/last seconds of their matching audio.
  const sceneTime = Math.max(0, Math.min(totalDuration, time));
  let index = scenes.findIndex((scene) =>
    sceneTime >= Number(scene.start_seconds) && sceneTime < Number(scene.end_seconds)
  );
  if (index < 0) index = sceneTime >= Number(scenes[scenes.length - 1]?.end_seconds) ? scenes.length - 1 : 0;
  const scene = scenes[index];
  const start = Number(scene.start_seconds) || 0;
  const end = Number(scene.end_seconds) || start + 1;
  const duration = Math.max(0.1, end - start);
  const progress = Math.max(0, Math.min(1, (sceneTime - start) / duration));

  context.fillStyle = "#080808";
  context.fillRect(0, 0, width, height);

  if (introActive) {
    drawCover(context, bitmaps[callouts.introIndex], time / Math.max(0.1, introDuration), 1, width, height, 15);
    const introFade = time >= introDuration - 0.45
      ? Math.max(0, 1 - (time - (introDuration - 0.45)) / 0.45)
      : 1;
    if (time >= introDuration - 0.45) {
      drawCover(context, bitmaps[0], 0, 1 - introFade, width, height, 0);
    }
    drawCalloutOverlay(context, {
      title: callouts.introTitle,
      message: callouts.introText,
      accentColor: callouts.accentColor,
    }, width, height, introFade);
  } else if (outroActive) {
    drawCover(context, bitmaps[index], progress, 1, width, height, index);
    drawCover(context, bitmaps[callouts.outroIndex], (time - outroStart) / Math.max(0.1, outroDuration), Math.min(1, (time - outroStart) / 0.45), width, height, 16);
    drawCalloutOverlay(context, {
      message: callouts.outroText,
      channelName: callouts.channelName,
      accentColor: callouts.accentColor,
    }, width, height);
  } else {
    drawCover(context, bitmaps[index], progress, 1, width, height, index);
    const nextScene = scenes[index + 1];
    const transitionStart = Math.max(start, end - 0.55);
    if (nextScene && sceneTime >= transitionStart) {
      const nextProgress = Math.min(1, (sceneTime - transitionStart) / 0.55);
      drawCover(context, bitmaps[index + 1], 0, nextProgress, width, height, index + 1);
    }
  }

  // Legenda tradicional das 15 cenas: preservar o estilo anterior.
  // As chamadas inicial e final continuam usando o overlay novo separado.
  const caption = (scene.captions || []).find((item) =>
    time >= Number(item.start_seconds) && time < Number(item.end_seconds)
  );
  if (!introActive && !outroActive && caption?.text) {
    context.save();
    const scale = width / 720;
    context.font = "bold " + Math.round(43 * scale) + "px Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    const lines = wrapText(context, caption.text, width - 104 * scale);
    const lineHeight = 55 * scale;
    const boxHeight = lines.length * lineHeight + 42 * scale;
    const boxY = height - 280 * scale - boxHeight / 2;
    context.fillStyle = "rgba(0,0,0,0.68)";
    drawRoundedRect(context, 38 * scale, boxY, width - 76 * scale, boxHeight, 20 * scale);
    context.fill();
    context.fillStyle = "#ffffff";
    lines.forEach((line, lineIndex) => {
      context.strokeStyle = "rgba(0,0,0,0.9)";
      context.lineWidth = 3 * scale;
      const y = boxY + 22 * scale + lineHeight * lineIndex + lineHeight / 2;
      context.strokeText(line, width / 2, y, width - 110 * scale);
      context.fillText(line, width / 2, y, width - 110 * scale);
    });
    context.restore();
  }
}
export async function recordNarratedSlideshow(video, onProgress = () => {}) {
  if (!navigator.mediaDevices || typeof MediaRecorder === "undefined") {
    throw new Error("Este navegador não oferece gravação de vídeo. Abra o estúdio no Chrome ou Edge atualizado.");
  }
  const scenes = Array.isArray(video.scenes) ? video.scenes : [];
  if (scenes.length !== 15 || !video.audio_url) {
    throw new Error("A montagem exige exatamente 15 cenas e a narração final.");
  }

  const images = [];
  let audioContext = null;
  let stream = null;
  let recorder = null;
  let source = null;
  let animationId = 0;
  let watchdogId = 0;
  let recordingStarted = false;
  let recordedPromise = null;

  const cleanup = async () => {
    if (animationId) cancelAnimationFrame(animationId);
    if (watchdogId) clearInterval(watchdogId);
    try { if (source) source.stop(); } catch {}
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch {}
    }
    if (stream) stream.getTracks().forEach((track) => track.stop());
    images.forEach((image) => {
      if (image._composerObjectUrl) {
        URL.revokeObjectURL(image._composerObjectUrl);
        image._composerObjectUrl = "";
      }
    });
    if (audioContext && audioContext.state !== "closed") {
      try { await audioContext.close(); } catch {}
    }
  };

  try {
    onProgress(0, "Carregando imagens e narração");
    const callouts = {
      introTitle: String(video.intro_callout_title || ""),
      introText: String(video.intro_callout_text || ""),
      outroText: String(video.outro_callout_text || ""),
      channelName: String(video.outro_channel_name || ""),
    };
    const introEnabled = video.intro_callout_enabled !== false;
    const outroEnabled = video.outro_callout_enabled !== false;
    const introCalloutUrl = introEnabled ? scenes[0]?.intro_callout_image_url : "";
    const outroCalloutUrl = outroEnabled ? scenes[14]?.outro_callout_image_url : "";
    if (introEnabled && !introCalloutUrl) throw new Error("A chamada inicial está ativada, mas a imagem não foi encontrada.");
    if (outroEnabled && !outroCalloutUrl) throw new Error("A chamada final está ativada, mas a imagem não foi encontrada.");
    const totalImageCount = scenes.length +
      Number(Boolean(introCalloutUrl)) +
      Number(Boolean(outroCalloutUrl));
    if (introEnabled && outroEnabled && totalImageCount !== 17) {
      throw new Error("A montagem recebeu " + totalImageCount + " imagens. São obrigatórias 17: chamada inicial + 15 cenas + chamada final.");
    }
    for (let i = 0; i < scenes.length; i++) {
      if (!scenes[i]?.image_url) throw new Error("A cena " + (i + 1) + " não possui imagem.");
      images.push(await loadBitmap(scenes[i].image_url));
      onProgress(Math.round(((i + 1) / totalImageCount) * 8), "Carregando imagem principal " + (i + 1) + " de 15");
    }
    if (introCalloutUrl) {
      callouts.introIndex = images.length;
      images.push(await loadBitmap(introCalloutUrl));
      onProgress(Math.round((images.length / totalImageCount) * 8), "Carregando imagem extra da chamada inicial");
    }
    if (outroCalloutUrl) {
      callouts.outroIndex = images.length;
      images.push(await loadBitmap(outroCalloutUrl));
      onProgress(Math.round((images.length / totalImageCount) * 8), "Carregando imagem extra da chamada final");
    }
    callouts.accentColor = pickAccentColor(images[0]);

    const audioResponse = await fetch(video.audio_url, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!audioResponse.ok) throw new Error("Não foi possível carregar a narração final (HTTP " + audioResponse.status + ").");
    if (audioResponse.status !== 200) throw new Error("O servidor entregou apenas um trecho da narração. Atualize e tente novamente.");
    const audioBytes = await audioResponse.arrayBuffer();
    if (audioBytes.byteLength < 44) throw new Error("O arquivo de narração está vazio ou incompleto.");

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Este navegador não oferece suporte à reprodução de áudio da montagem.");
    audioContext = new AudioContextClass();
    const audioBuffer = decodePcmWav(audioContext, audioBytes);
    if (audioBuffer.duration < 120 || audioBuffer.duration > 360) {
      throw new Error("A narração completa tem " + Math.round(audioBuffer.duration) + " segundos. O limite é de 2 a 6 minutos, incluindo as chamadas.");
    }

    // Bitrate is selected for visual quality, not to fit a storage-provider limit.
    const outputResolution = video.output_resolution === "720p"
      ? { width: 720, height: 1280, videoBitrate: 5_000_000 }
      : { width: 1080, height: 1920, videoBitrate: 8_000_000 };
    const canvas = document.createElement("canvas");
    canvas.width = outputResolution.width;
    canvas.height = outputResolution.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Não foi possível preparar a tela de composição.");
    drawFrame(context, scenes, images, 0, callouts, outputResolution.width, outputResolution.height, audioBuffer.duration);

    if (typeof canvas.captureStream !== "function") {
      throw new Error("Este navegador não permite capturar a composição do vídeo.");
    }
    const videoStream = canvas.captureStream(FPS);
    const audioDestination = audioContext.createMediaStreamDestination();
    source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioDestination);
    stream = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...audioDestination.stream.getAudioTracks(),
    ]);
    if (!stream.getVideoTracks().length || !stream.getAudioTracks().length) {
      throw new Error("O navegador não criou as faixas de vídeo e áudio necessárias.");
    }

    const nativeMp4Mime = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4"]
      .find((type) => MediaRecorder.isTypeSupported(type));
    const webmMimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
        ? "video/webm;codecs=vp8,opus" : "video/webm";
    let mimeType = nativeMp4Mime || webmMimeType;
    const recorderOptions = {
      mimeType,
      videoBitsPerSecond: outputResolution.videoBitrate,
      audioBitsPerSecond: 96_000,
    };
    try {
      recorder = new MediaRecorder(stream, recorderOptions);
    } catch (nativeRecorderError) {
      if (!nativeMp4Mime) throw nativeRecorderError;
      // Some browsers report MP4 support but reject this particular stream.
      // Fall back to WebM and let FFmpeg perform the MP4 conversion.
      mimeType = webmMimeType;
      recorder = new MediaRecorder(stream, { ...recorderOptions, mimeType });
    }
    const chunks = [];
    recordedPromise = new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data);
      };
      recorder.onerror = (event) => reject(event.error || new Error("Falha ao gravar a composição."));
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    });

    await audioContext.resume();
    if (audioContext.state !== "running") {
      throw new Error("O navegador bloqueou a reprodução do áudio durante a montagem. Clique em Retomar produção e mantenha a página aberta.");
    }
    const startAt = audioContext.currentTime + 0.15;
    recorder.start(1000);
    recordingStarted = true;
    source.start(startAt);
    onProgress(8, "Gravando vídeo em tempo real e sincronizando a narração. Mantenha esta aba aberta e visível.");

    await new Promise((resolve, reject) => {
      let settled = false;
      let lastAudioTime = audioContext.currentTime;
      let lastAdvanceAt = Date.now();
      let lastFrameAt = Date.now();
      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (watchdogId) clearInterval(watchdogId);
        watchdogId = 0;
        if (animationId) cancelAnimationFrame(animationId);
        animationId = 0;
        if (error) reject(error);
        else resolve();
      };
      watchdogId = setInterval(() => {
        if (!settled && Date.now() - lastFrameAt > 15000) {
          finish(new Error("A gravação não recebeu novos quadros por 15 segundos. O navegador pode ter pausado a aba. Mantenha a Fábrica de Fatos aberta e visível durante a montagem e tente novamente."));
        }
      }, 3000);
      const frame = () => {
        if (settled) return;
        lastFrameAt = Date.now();
        try {
          if (audioContext.state !== "running") {
            throw new Error("O áudio foi pausado pelo navegador durante a montagem.");
          }
          const now = audioContext.currentTime;
          if (now > lastAudioTime + 0.001) {
            lastAudioTime = now;
            lastAdvanceAt = Date.now();
          } else if (Date.now() - lastAdvanceAt > 15000) {
            throw new Error("O relógio de áudio parou de avançar. Mantenha a aba da Fábrica de Fatos em primeiro plano e tente novamente.");
          }
          const elapsed = Math.max(0, now - startAt);
          drawFrame(context, scenes, images, Math.min(audioBuffer.duration, elapsed), callouts, outputResolution.width, outputResolution.height, audioBuffer.duration);
          onProgress(
            8 + Math.round((elapsed / audioBuffer.duration) * 67),
            "Sincronizando cenas e legendas · " + Math.min(100, Math.round((elapsed / audioBuffer.duration) * 100)) + "%",
          );
          if (elapsed >= audioBuffer.duration) finish();
          else animationId = requestAnimationFrame(frame);
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      };
      animationId = requestAnimationFrame(frame);
    });

    if (recorder.state !== "inactive") recorder.stop();
    const webm = await recordedPromise;
    if (!webm?.size || webm.size < 64 * 1024) {
      throw new Error("A gravação do vídeo ficou vazia ou incompleta.");
    }
    return webm;
  } catch (error) {
    if (recordingStarted && recordedPromise) {
      if (recorder && recorder.state !== "inactive") {
        try { recorder.stop(); } catch {}
      }
      await recordedPromise.catch(() => {});
    }
    throw new Error("Falha durante a renderização das cenas: " + (error?.message || String(error)));
  } finally {
    await cleanup();
  }
}


async function renderMediabunnyMp4(video, onProgress = () => {}, outputResolution = "1080p") {
  if (typeof VideoEncoder === "undefined" || typeof AudioEncoder === "undefined") {
    throw new Error("Este navegador não oferece WebCodecs para codificação direta.");
  }

  onProgress(1, "Carregando o motor WebCodecs + Mediabunny.");
  const media = await withTimeout(
    import(/* @vite-ignore */ "https://esm.sh/mediabunny@1.66.2?bundle"),
    45000,
    "O motor Mediabunny não respondeu em 45 segundos.",
  );
  const {
    Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource,
    VideoSampleSink, AudioSampleSink, Quality,
    getFirstEncodableVideoCodec, getFirstEncodableAudioCodec,
  } = media;

  const scenes = Array.isArray(video.scenes) ? video.scenes : [];
  if (scenes.length !== 15 || !video.audio_url) {
    throw new Error("A montagem exige 15 cenas e a narração final.");
  }

  const images = [];
  let audioContext = null;
  let output = null;
  let outputFinalized = false;
  let videoSource = null;
  let audioSource = null;
  try {
    const callouts = {
      introTitle: String(video.intro_callout_title || ""),
      introText: String(video.intro_callout_text || ""),
      outroText: String(video.outro_callout_text || ""),
      channelName: String(video.outro_channel_name || ""),
    };
    const introEnabled = video.intro_callout_enabled !== false;
    const outroEnabled = video.outro_callout_enabled !== false;
    const introUrl = introEnabled ? scenes[0]?.intro_callout_image_url : "";
    const outroUrl = outroEnabled ? scenes[14]?.outro_callout_image_url : "";
    if (introEnabled && !introUrl) throw new Error("Imagem da chamada inicial não encontrada.");
    if (outroEnabled && !outroUrl) throw new Error("Imagem da chamada final não encontrada.");

    const imageCount = scenes.length + Number(Boolean(introUrl)) + Number(Boolean(outroUrl));
    for (let i = 0; i < scenes.length; i++) {
      if (!scenes[i]?.image_url) throw new Error("A cena " + (i + 1) + " não possui imagem.");
      images.push(await loadBitmap(scenes[i].image_url));
      onProgress(2 + Math.round(((i + 1) / imageCount) * 4), "WebCodecs: carregando imagem " + (i + 1) + "/15.");
    }
    if (introUrl) {
      callouts.introIndex = images.length;
      images.push(await loadBitmap(introUrl));
    }
    if (outroUrl) {
      callouts.outroIndex = images.length;
      images.push(await loadBitmap(outroUrl));
    }
    callouts.accentColor = pickAccentColor(images[0]);

    const audioResponse = await fetch(video.audio_url, { cache: "no-store" });
    if (!audioResponse.ok || audioResponse.status !== 200) {
      throw new Error("Não foi possível carregar a narração completa (HTTP " + audioResponse.status + ").");
    }
    const audioBytes = await audioResponse.arrayBuffer();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio não está disponível neste navegador.");
    audioContext = new AudioContextClass();
    const audioBuffer = decodePcmWav(audioContext, audioBytes);
    if (audioBuffer.duration < 120 || audioBuffer.duration > 360) {
      throw new Error("Duração de narração inválida: " + Math.round(audioBuffer.duration) + " segundos.");
    }

    const resolution = outputResolution === "720p"
      ? { width: 720, height: 1280, bitrate: 4_000_000 }
      : { width: 1080, height: 1920, bitrate: 6_000_000 };
    const canvas = document.createElement("canvas");
    canvas.width = resolution.width;
    canvas.height = resolution.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Não foi possível criar o canvas de exportação.");

    const format = new Mp4OutputFormat({ fastStart: "in-memory" });
    const target = new BufferTarget();
    output = new Output({ format, target });
    const videoCodec = await getFirstEncodableVideoCodec(
      format.getSupportedVideoCodecs().filter((codec) => codec === "avc"),
      { width: resolution.width, height: resolution.height },
    );
    if (!videoCodec) throw new Error("O navegador não oferece codificação AVC/H.264 via WebCodecs.");

    // AAC support depends on the exact channel count, sample rate and bitrate.
    // Probe concrete configurations instead of selecting AAC generically and
    // discovering an unsupported mp4a.40.2 configuration during encoding.
    const audioProfiles = [
      { numberOfChannels: 2, sampleRate: 48000, bitrate: 128000 },
      { numberOfChannels: 2, sampleRate: 44100, bitrate: 128000 },
      { numberOfChannels: 1, sampleRate: 48000, bitrate: 96000 },
      { numberOfChannels: 1, sampleRate: 44100, bitrate: 96000 },
      { numberOfChannels: 1, sampleRate: 24000, bitrate: 64000 },
    ];
    let selectedAudioProfile = null;
    let audioCodec = null;
    const audioProbeErrors = [];
    for (const profile of audioProfiles) {
      try {
        const quality = new Quality({ bitrate: profile.bitrate });
        const supportedCodec = await getFirstEncodableAudioCodec(
          format.getSupportedAudioCodecs().filter((codec) => codec === "aac"),
          {
            numberOfChannels: profile.numberOfChannels,
            sampleRate: profile.sampleRate,
            quality,
          },
        );
        if (supportedCodec) {
          selectedAudioProfile = profile;
          audioCodec = supportedCodec;
          break;
        }
        audioProbeErrors.push(profile.numberOfChannels + "ch/" + profile.sampleRate + "Hz/" + profile.bitrate + "bps: não suportado");
      } catch (probeError) {
        audioProbeErrors.push(profile.numberOfChannels + "ch/" + profile.sampleRate + "Hz: " + (probeError?.message || String(probeError)));
      }
    }
    if (!audioCodec || !selectedAudioProfile) {
      throw new Error("Nenhuma configuração AAC compatível foi encontrada. Tentativas: " + audioProbeErrors.join(" | "));
    }

    videoSource = new CanvasSource(canvas, {
      codec: videoCodec,
      quality: new Quality({ bitrate: resolution.bitrate }),
      latencyMode: "quality",
      hardwareAcceleration: "no-preference",
      keyFrameInterval: 2,
    });
    audioSource = new AudioBufferSource({
      codec: audioCodec,
      quality: new Quality({ bitrate: selectedAudioProfile.bitrate }),
      transform: {
        numberOfChannels: selectedAudioProfile.numberOfChannels,
        sampleRate: selectedAudioProfile.sampleRate,
      },
    });
    output.addVideoTrack(videoSource, { frameRate: FPS });
    output.addAudioTrack(audioSource);
    await output.start();

    // Feed and close the audio track first so the muxer does not need to
    // buffer several minutes of video while waiting for its audio packets.
    await audioSource.add(audioBuffer);
    audioSource.close();

    const frameCount = Math.ceil(audioBuffer.duration * FPS);
    onProgress(7, "WebCodecs: iniciando renderização quadro a quadro, sem gravação em tempo real.");
    for (let frame = 0; frame < frameCount; frame++) {
      const timestamp = frame / FPS;
      const frameDuration = Math.min(1 / FPS, audioBuffer.duration - timestamp);
      drawFrame(
        context, scenes, images, timestamp, callouts,
        resolution.width, resolution.height, audioBuffer.duration,
      );
      await videoSource.add(timestamp, frameDuration);
      if (frame % 24 === 0 || frame === frameCount - 1) {
        onProgress(
          7 + Math.round(((frame + 1) / frameCount) * 78),
          "WebCodecs: codificando quadro " + (frame + 1) + "/" + frameCount + ".",
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    videoSource.close();
    audioSource.close();
    await output.finalize();
    outputFinalized = true;

    const mp4 = new Blob([target.buffer], { type: "video/mp4" });
    await validateMp4Blob(mp4, "MP4 WebCodecs");
    if (mp4.size < 100 * 1024) throw new Error("O MP4 WebCodecs ficou pequeno demais.");
    onProgress(90, "WebCodecs: conferindo estrutura, duração e faixas do MP4.");

    const { Input, ALL_FORMATS, BlobSource } = media;
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(mp4) });
    try {
      const [duration, videoTrack, audioTrack] = await Promise.all([
        input.computeDuration(),
        input.getPrimaryVideoTrack(),
        input.getPrimaryAudioTrack(),
      ]);
      if (!videoTrack || !audioTrack) throw new Error("O MP4 não contém as duas faixas de áudio e vídeo.");
      if (!Number.isFinite(duration) || Math.abs(duration - audioBuffer.duration) > 2) {
        throw new Error("A duração do MP4 não corresponde à narração (" + duration + "s).");
      }
      const [videoDecodable, audioDecodable] = await Promise.all([
        videoTrack.canDecode(),
        audioTrack.canDecode(),
      ]);
      if (!videoDecodable || !audioDecodable) {
        throw new Error("O navegador não conseguiu validar a decodificação das faixas do MP4.");
      }
      const videoSink = new VideoSampleSink(videoTrack);
      const audioSink = new AudioSampleSink(audioTrack);
      const lastCheckTime = Math.max(0, duration - 0.25);
      const [firstVideo, lastVideo, firstAudio, lastAudio] = await Promise.all([
        videoSink.getSample(0),
        videoSink.getSample(lastCheckTime),
        audioSink.getSample(0),
        audioSink.getSample(lastCheckTime),
      ]);
      try {
        if (!firstVideo || !lastVideo || !firstAudio || !lastAudio) {
          throw new Error("O MP4 não conseguiu decodificar amostras do início e do fim das duas faixas.");
        }
      } finally {
        firstVideo?.close?.();
        lastVideo?.close?.();
        firstAudio?.close?.();
        lastAudio?.close?.();
      }
    } finally {
      try { input.dispose(); } catch {}
    }

    onProgress(100, "WebCodecs: MP4 estruturado e faixas verificadas.");
    return mp4;
  } finally {
    try { videoSource?.close(); } catch {}
    try { audioSource?.close(); } catch {}
    if (!outputFinalized) { try { await output?.cancel(); } catch {} }
    images.forEach((image) => {
      if (image._composerObjectUrl) {
        URL.revokeObjectURL(image._composerObjectUrl);
        image._composerObjectUrl = "";
      }
    });
    if (audioContext && audioContext.state !== "closed") {
      try { await audioContext.close(); } catch {}
    }
  }
}

async function validateRenderInputs(video, onProgress = () => {}) {
  const scenes = Array.isArray(video?.scenes) ? video.scenes : [];
  if (scenes.length !== 15) {
    throw new Error("Preparação interrompida: são necessárias 15 cenas completas; foram recebidas " + scenes.length + ".");
  }
  if (!video.audio_url) throw new Error("Preparação interrompida: a narração final ainda não possui endereço.");

  const introEnabled = video.intro_callout_enabled !== false;
  const outroEnabled = video.outro_callout_enabled !== false;
  const requiredImages = scenes.map((scene, index) => {
    if (!scene?.image_url || !scene?.image_path) {
      throw new Error("Preparação interrompida: a imagem da cena " + (index + 1) + " ainda não foi concluída ou sincronizada.");
    }
    return { url: scene.image_url, label: "cena " + (index + 1) };
  });
  if (introEnabled) {
    if (!scenes[0]?.intro_callout_image_url || !scenes[0]?.intro_callout_image_path) {
      throw new Error("Preparação interrompida: a imagem extra da chamada inicial ainda não está pronta.");
    }
    requiredImages.push({ url: scenes[0].intro_callout_image_url, label: "chamada inicial" });
  }
  if (outroEnabled) {
    if (!scenes[14]?.outro_callout_image_url || !scenes[14]?.outro_callout_image_path) {
      throw new Error("Preparação interrompida: a imagem extra da chamada final ainda não está pronta.");
    }
    requiredImages.push({ url: scenes[14].outro_callout_image_url, label: "chamada final" });
  }
  for (let i = 0; i < scenes.length; i++) {
    if (!Array.isArray(scenes[i]?.captions) || scenes[i].captions.length === 0) {
      throw new Error("Preparação interrompida: as legendas da cena " + (i + 1) + " ainda não foram sincronizadas.");
    }
    if (!scenes[i]?.audio_path || !(Number(scenes[i]?.audio_duration) > 0)) {
      throw new Error("Preparação interrompida: o áudio da cena " + (i + 1) + " ainda não foi finalizado.");
    }
  }

  const loaded = [];
  try {
    onProgress(1, "Preparação final · verificando " + requiredImages.length + " imagens sincronizadas antes de iniciar os renderizadores.");
    for (let start = 0; start < requiredImages.length; start += 4) {
      const batch = requiredImages.slice(start, start + 4);
      const results = await Promise.all(batch.map(async (item) => {
        try {
          return await loadBitmap(item.url);
        } catch (error) {
          throw new Error("A " + item.label + " ainda não pode ser baixada e decodificada: " + (error?.message || String(error)));
        }
      }));
      loaded.push(...results);
      onProgress(
        2 + Math.round((loaded.length / requiredImages.length) * 3),
        "Preparação final · imagens verificadas " + loaded.length + "/" + requiredImages.length + ".",
      );
    }

    onProgress(5, "Preparação final · verificando o arquivo completo da narração e a duração.");
    const response = await fetch(video.audio_url, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok || response.status !== 200) {
      throw new Error("A narração ainda não está disponível integralmente (HTTP " + response.status + ").");
    }
    const bytes = await response.arrayBuffer();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Este navegador não oferece suporte à validação do áudio.");
    const audioContext = new AudioContextClass();
    try {
      const audioBuffer = decodePcmWav(audioContext, bytes);
      if (audioBuffer.duration < 120 || audioBuffer.duration > 360) {
        throw new Error("A narração ainda está incompleta ou possui duração inválida (" + Math.round(audioBuffer.duration) + " segundos).");
      }
    } finally {
      if (audioContext.state !== "closed") await audioContext.close();
    }
    onProgress(6, "Preparação concluída · imagens, narrações e legendas estão prontas. Iniciando renderização.");
  } finally {
    loaded.forEach((image) => {
      if (image?._composerObjectUrl) {
        URL.revokeObjectURL(image._composerObjectUrl);
        image._composerObjectUrl = "";
      }
    });
  }
}

export async function renderVideoWithFallback(video, onProgress = () => {}, outputResolution = "1080p", renderOnServer = null) {
  const failures = [];
  const report = (progress, detail, method, status, reason = "") => {
    onProgress(progress, detail, { method, status, reason });
  };

  report(0, "Método 1/3: WebCodecs + Mediabunny, renderização direta em MP4.", "WebCodecs + Mediabunny", "trying");
  try {
    const mp4 = await renderMediabunnyMp4(video, (progress, detail) => {
      onProgress(progress, detail, { method: "WebCodecs + Mediabunny", status: "trying" });
    }, outputResolution);
    report(100, "Método 1/4 concluído: MP4 criado diretamente por WebCodecs.", "WebCodecs + Mediabunny", "success");
    return mp4;
  } catch (error) {
    const reason = error?.message || String(error);
    failures.push("WebCodecs + Mediabunny: " + reason);
    report(0, "Método 1/4 falhou. Preparando o próximo caminho. Motivo: " + reason, "WebCodecs + Mediabunny", "failed", reason);
  }

  if (typeof renderOnServer === "function") {
    report(0, "Método 2/4: FFmpeg no servidor, sem depender da gravação do navegador.", "FFmpeg no servidor", "trying");
    try {
      const mp4 = await renderOnServer(video, (progress, detail) => {
        onProgress(progress, detail, { method: "FFmpeg no servidor", status: "trying" });
      });
      await validateMp4Blob(mp4, "MP4 renderizado no servidor");
      report(100, "Método 2/4 concluído: MP4 criado pelo FFmpeg no servidor.", "FFmpeg no servidor", "success");
      return mp4;
    } catch (error) {
      const reason = error?.message || String(error);
      failures.push("FFmpeg no servidor: " + reason);
      report(0, "Método 2/4 falhou. Retomando os caminhos locais. Motivo: " + reason, "FFmpeg no servidor", "failed", reason);
    }
  } else {
    const reason = "Renderizador remoto não configurado neste ambiente.";
    failures.push("FFmpeg no servidor: " + reason);
    report(0, reason, "FFmpeg no servidor", "failed", reason);
  }

  report(0, "Método 3/4: MediaRecorder + FFmpeg na resolução selecionada.", "MediaRecorder + FFmpeg", "trying");
  try {
    const recording = await recordNarratedSlideshow(
      { ...video, output_resolution: outputResolution },
      (progress, detail) => onProgress(
        Math.min(70, Math.round(progress * 0.7)),
        "Método 3/4 · " + detail,
        { method: "MediaRecorder + FFmpeg", status: "trying" },
      ),
    );
    const mp4 = await convertWebmToMp4(recording, (progress, detail) => onProgress(
      70 + Math.round(Math.max(0, progress - 76) / 22 * 30),
      "Método 3/4 · " + detail,
      { method: "MediaRecorder + FFmpeg", status: "trying" },
    ), outputResolution);
    report(100, "Método 3/4 concluído: gravação e conversão FFmpeg finalizadas.", "MediaRecorder + FFmpeg", "success");
    return mp4;
  } catch (error) {
    const reason = error?.message || String(error);
    failures.push("MediaRecorder + FFmpeg: " + reason);
    report(0, "Método 3/4 falhou. Tentando contingência em 720p. Motivo: " + reason, "MediaRecorder + FFmpeg", "failed", reason);
  }

  report(0, "Método 4/4: nova gravação em 720p para reduzir uso de memória e processamento.", "MediaRecorder + FFmpeg 720p", "trying");
  try {
    const recording = await recordNarratedSlideshow(
      { ...video, output_resolution: "720p" },
      (progress, detail) => onProgress(
        Math.min(70, Math.round(progress * 0.7)),
        "Método 4/4 · " + detail,
        { method: "MediaRecorder + FFmpeg 720p", status: "trying" },
      ),
    );
    const mp4 = await convertWebmToMp4(recording, (progress, detail) => onProgress(
      70 + Math.round(Math.max(0, progress - 76) / 22 * 30),
      "Método 4/4 · " + detail,
      { method: "MediaRecorder + FFmpeg 720p", status: "trying" },
    ), "720p");
    report(100, "Método 4/4 concluído: MP4 de contingência em 720p.", "MediaRecorder + FFmpeg 720p", "success");
    return mp4;
  } catch (error) {
    const reason = error?.message || String(error);
    failures.push("MediaRecorder + FFmpeg 720p: " + reason);
    report(0, "Todos os caminhos de renderização falharam.", "MediaRecorder + FFmpeg 720p", "failed", reason);
  }

  throw new Error("Nenhum dos 4 caminhos conseguiu concluir o MP4. " + failures.join(" || "));
}

async function fetchCoreAsset(url, mimeType, timeoutMs = 45000, parentSignal) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (parentSignal?.aborted) controller.abort();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "force-cache" });
    if (!response.ok) throw new Error("HTTP " + response.status + " ao baixar o conversor.");
    const blob = await response.blob();
    if (!blob.size) throw new Error("O arquivo do conversor veio vazio.");
    return URL.createObjectURL(new Blob([blob], { type: mimeType }));
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Tempo limite ao baixar um componente do conversor MP4.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

async function loadFfmpegCoreFromMirrors(onProgress) {
  const cdnBases = [
    "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm",
    "https://fastly.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm",
    "https://gcore.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm",
    "https://testingcf.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm",
    "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm",
  ];
  const controllers = [];
  const attempts = cdnBases.map(async (base, index) => {
    const controller = new AbortController();
    controllers.push(controller);
    const [coreResult, wasmResult] = await Promise.allSettled([
      fetchCoreAsset(base + "/ffmpeg-core.js", "text/javascript", 35000, controller.signal),
      fetchCoreAsset(base + "/ffmpeg-core.wasm", "application/wasm", 55000, controller.signal),
    ]);
    if (coreResult.status === "rejected" || wasmResult.status === "rejected") {
      controller.abort();
      if (coreResult.status === "fulfilled") URL.revokeObjectURL(coreResult.value);
      if (wasmResult.status === "fulfilled") URL.revokeObjectURL(wasmResult.value);
      const reason = coreResult.status === "rejected" ? coreResult.reason : wasmResult.reason;
      throw new Error("Servidor " + (index + 1) + ": " + (reason?.message || String(reason)));
    }
    return { base, coreURL: coreResult.value, wasmURL: wasmResult.value };
  });

  try {
    onProgress(76, "Testando 5 servidores de conversão em paralelo. O primeiro disponível será utilizado.");
    const winner = await Promise.any(attempts);
    controllers.forEach((controller) => controller.abort());
    const settled = await Promise.allSettled(attempts);
    for (const result of settled) {
      if (result.status === "fulfilled" && result.value.base !== winner.base) {
        URL.revokeObjectURL(result.value.coreURL);
        URL.revokeObjectURL(result.value.wasmURL);
      }
    }
    onProgress(77, "Conversor MP4 carregado com sucesso.");
    return winner;
  } catch (error) {
    controllers.forEach((controller) => controller.abort());
    const settled = await Promise.allSettled(attempts);
    for (const result of settled) {
      if (result.status === "fulfilled") {
        URL.revokeObjectURL(result.value.coreURL);
        URL.revokeObjectURL(result.value.wasmURL);
      }
    }
    const details = settled
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason?.message || String(result.reason))
      .join(" | ");
    throw new Error("Nenhum dos 5 servidores conseguiu fornecer o conversor MP4. " + details.slice(0, 700));
  }
}

async function validateMp4Blob(blob, label = "MP4") {
  if (!(blob instanceof Blob) || blob.size < 64 * 1024) {
    throw new Error(label + " ficou vazio ou pequeno demais.");
  }
  const headSize = Math.min(blob.size, 2 * 1024 * 1024);
  const tailStart = Math.max(0, blob.size - 2 * 1024 * 1024);
  const [head, tail] = await Promise.all([
    blob.slice(0, headSize).arrayBuffer(),
    blob.slice(tailStart).arrayBuffer(),
  ]);
  const first = new Uint8Array(head);
  if (first.length < 12 || String.fromCharCode(...first.slice(4, 8)) !== "ftyp") {
    throw new Error(label + " não possui um cabeçalho MP4 válido.");
  }
  const bytes = new Uint8Array(first.length + tail.byteLength);
  bytes.set(first, 0);
  bytes.set(new Uint8Array(tail), first.length);
  const hasBox = (tag) => {
    const a = tag.charCodeAt(0), b = tag.charCodeAt(1), c = tag.charCodeAt(2), d = tag.charCodeAt(3);
    for (let i = 4; i <= bytes.length - 4; i++) {
      if (bytes[i] === a && bytes[i + 1] === b && bytes[i + 2] === c && bytes[i + 3] === d) return true;
    }
    return false;
  };
  if (!hasBox("moov") || !hasBox("mdat")) {
    throw new Error(label + " parece incompleto: faltam estruturas internas obrigatórias do MP4.");
  }
  return true;
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function convertWebmToMp4(webm, onProgress = () => {}, outputResolution = "1080p") {
  if (!(webm instanceof Blob) || webm.size < 64 * 1024) {
    throw new Error("A gravação de vídeo não contém dados suficientes para converter.");
  }
  const isMp4Input = webm.type.includes("mp4");
  // Always pass browser recordings through FFmpeg. Native MediaRecorder MP4
  // output can have incomplete indexes/finalization on some browser versions.
  // Re-encoding produces a finalized MP4 with fast-start metadata.
  onProgress(76, "Finalizando e validando o vídeo em MP4 de alta qualidade (FFmpeg no navegador)");
  const { FFmpeg } = await withTimeout(
    import("@ffmpeg/ffmpeg"),
    30000,
    "O módulo do conversor MP4 demorou demais para carregar. Atualize a página e tente novamente.",
  );
  const ffmpeg = new FFmpeg();
  let coreURL = "";
  let wasmURL = "";
  try {
    const coreAssets = await loadFfmpegCoreFromMirrors(onProgress);
    coreURL = coreAssets.coreURL;
    wasmURL = coreAssets.wasmURL;

    onProgress(77, "Inicializando FFmpeg WebAssembly");
    await withTimeout(
      ffmpeg.load({ coreURL, wasmURL }),
      90000,
      "O conversor MP4 não inicializou em 90 segundos. Verifique a conexão e tente novamente.",
    );
    ffmpeg.on("progress", ({ progress }) => {
      const safeProgress = Math.max(0, Math.min(1, Number(progress) || 0));
      onProgress(78 + Math.round(safeProgress * 19), "Convertendo para MP4 · " + Math.round(safeProgress * 100) + "%");
    });
    onProgress(78, "Carregando o vídeo no conversor FFmpeg");
    const inputName = isMp4Input ? "input.mp4" : "input.webm";
    await withTimeout(
      ffmpeg.writeFile(inputName, new Uint8Array(await webm.arrayBuffer())),
      90000,
      "O vídeo demorou demais para ser carregado no conversor MP4.",
    );
    const targetVideoBitrate = outputResolution === "720p" ? "5M" : "8M";
    const code = await withTimeout(
      ffmpeg.exec([
        "-i", inputName,
        "-map", "0:v:0",
        "-map", "0:a:0",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-b:v", targetVideoBitrate,
        "-pix_fmt", "yuv420p",
        "-r", String(FPS),
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        "-shortest",
        "output.mp4",
      ]),
      8 * 60 * 1000,
      "A conversão MP4 excedeu 8 minutos e foi interrompida para não deixar a produção travada.",
    );
    if (code !== 0) throw new Error("O conversor não conseguiu finalizar o MP4 (código " + code + ").");
    const output = await withTimeout(
      ffmpeg.readFile("output.mp4"),
      90000,
      "O MP4 foi convertido, mas demorou demais para ser recuperado do conversor.",
    );
    const mp4 = new Blob([output], { type: "video/mp4" });
    await validateMp4Blob(mp4, "MP4 convertido");
    onProgress(97, "Verificando a reprodução completa do vídeo e do áudio");
    const decodeCode = await withTimeout(
      ffmpeg.exec([
        "-v", "error",
        "-xerror",
        "-i", "output.mp4",
        "-map", "0:v:0",
        "-map", "0:a:0",
        "-f", "null",
        "-",
      ]),
      5 * 60 * 1000,
      "A verificação completa do MP4 excedeu 5 minutos e foi interrompida.",
    );
    if (decodeCode !== 0) {
      throw new Error("O MP4 passou pela verificação do cabeçalho, mas apresentou erro ao decodificar o vídeo ou o áudio. O arquivo não será disponibilizado como concluído.");
    }
    onProgress(98, "MP4 finalizado e decodificado integralmente sem erros");
    return mp4;
  } catch (error) {
    const message = error?.message || String(error);
    if (/failed to fetch|network|load|wasm|worker/i.test(message)) {
      throw new Error("Não foi possível carregar ou executar o conversor MP4 gratuito. Verifique a conexão e tente novamente. Detalhe: " + message);
    }
    throw error;
  } finally {
    try { ffmpeg.terminate(); } catch {}
    if (coreURL) URL.revokeObjectURL(coreURL);
    if (wasmURL) URL.revokeObjectURL(wasmURL);
  }
}
