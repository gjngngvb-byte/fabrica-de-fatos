import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { Music2, UploadCloud, RefreshCw, CheckCircle2, AlertCircle, FileText, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authed/musicas")({
  head: () => ({ meta: [{ title: "Biblioteca musical — Fábrica de Fatos" }] }),
  component: MusicLibrary,
});

const cleanName = (name) => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-110);

async function musicAction(body) {
  const { data, error } = await supabase.functions.invoke("music-library", { body });
  if (error) throw new Error(data?.error || error.message || "Não foi possível acessar a biblioteca musical.");
  if (data?.error) throw new Error(data.error + (data.details ? " " + data.details : ""));
  return data;
}

function MusicLibrary() {
  const [tracks, setTracks] = useState([null, null]);
  const [metadata, setMetadata] = useState(null);
  const [files, setFiles] = useState([]);
  const [connection, setConnection] = useState("checking");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const trackInputs = [useRef(null), useRef(null)];
  const metadataInput = useRef(null);

  const refresh = async () => {
    setConnection("checking");
    try {
      const health = await musicAction({ action: "health" });
      if (!health?.connected) throw new Error("O bucket não confirmou a conexão.");
      const [audio, docs] = await Promise.all([
        musicAction({ action: "list", prefix: "tracks/" }),
        musicAction({ action: "list", prefix: "metadata/" }),
      ]);
      setFiles([...(audio.files || []), ...(docs.files || [])]);
      setConnection("connected");
      setError("");
    } catch (e) {
      setConnection("error");
      setError(e.message || "Falha ao verificar a conexão.");
    }
  };

  useEffect(() => { refresh(); }, []);

  const uploadOne = async (file, prefix, contentType) => {
    const key = prefix + Date.now() + "-" + cleanName(file.name);
    setProgress("Preparando " + file.name + "…");
    const signed = await musicAction({ action: "upload-url", key, contentType });
    setProgress("Enviando " + file.name + "…");
    const response = await fetch(signed.url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: file,
    });
    if (!response.ok) throw new Error("O R2 recusou o envio de " + file.name + " (HTTP " + response.status + ").");
    return key;
  };

  const handleUpload = async () => {
    setError("");
    const chosenTracks = tracks.filter(Boolean);
    if (chosenTracks.length !== 2 || !metadata) {
      setError("Selecione exatamente duas músicas e um arquivo de informações.");
      return;
    }
    const invalidTrack = chosenTracks.find((f) => !f.type.startsWith("audio/"));
    if (invalidTrack) {
      setError("O arquivo " + invalidTrack.name + " não foi reconhecido como áudio. Use MP3 ou WAV.");
      return;
    }
    const extension = metadata.name.split(".").pop().toLowerCase();
    if (!["txt", "json", "csv"].includes(extension)) {
      setError("O arquivo de informações precisa ser TXT, JSON ou CSV.");
      return;
    }
    setBusy(true);
    const uploaded = [];
    try {
      for (const file of chosenTracks) {
        uploaded.push(await uploadOne(file, "tracks/", file.type || "audio/mpeg"));
      }
      const metadataType = extension === "json" ? "application/json" : extension === "csv" ? "text/csv" : "text/plain";
      uploaded.push(await uploadOne(metadata, "metadata/", metadataType));
      setProgress("Conferindo os três arquivos no bucket…");
      await refresh();
      toast.success("As duas músicas e o arquivo foram enviados.");
      setTracks([null, null]);
      setMetadata(null);
      trackInputs.forEach((input) => { if (input.current) input.current.value = ""; });
      if (metadataInput.current) metadataInput.current.value = "";
      setProgress("Teste concluído: 3 arquivos enviados.");
    } catch (e) {
      const message = e.message || "Falha no envio.";
      setError(message.includes("Failed to fetch") || message.includes("CORS")
        ? "O navegador bloqueou o envio direto ao R2. Precisamos liberar o CORS do bucket para o domínio do site. Nenhuma alteração foi feita nos vídeos."
        : message);
      setProgress("");
      toast.error("Não foi possível concluir o envio.");
    } finally {
      setBusy(false);
    }
  };

  const formatSize = (bytes) => bytes == null ? "" : bytes < 1024 * 1024
    ? (bytes / 1024).toFixed(1) + " KB" : (bytes / 1024 / 1024).toFixed(1) + " MB";

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-8 lg:px-12 lg:py-14">
      <p className="eyebrow">Acervo de áudio</p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl leading-none tracking-tight">Biblioteca musical</h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">Envie as trilhas e o arquivo que descreve cada música. Os arquivos ficam no bucket privado separado dos vídeos.</p>
        </div>
        <button type="button" onClick={refresh} disabled={connection === "checking" || busy}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-border px-4 text-xs hover:bg-secondary disabled:opacity-50">
          <RefreshCw className={"size-3.5 " + (connection === "checking" ? "animate-spin" : "")} /> Atualizar
        </button>
      </div>

      <section className="mt-8 rounded-2xl border border-border/70 bg-card/40 p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary"><Music2 className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Conexão com o armazenamento musical</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {connection === "checking" ? "Verificando acesso seguro…" : connection === "connected" ? "Bucket livetiktok-musicas conectado." : "Não foi possível confirmar a conexão."}
            </p>
          </div>
          {connection === "connected" ? <CheckCircle2 className="size-5 text-emerald-500" /> : connection === "error" ? <AlertCircle className="size-5 text-destructive" /> : <Loader2 className="size-5 animate-spin text-muted-foreground" />}
        </div>
        {connection === "error" && <p className="mt-3 rounded-lg bg-destructive/5 p-3 text-xs text-destructive">{error}</p>}
      </section>

      <section className="mt-6 space-y-4 rounded-2xl border border-border/70 bg-card/40 p-5">
        <div>
          <h2 className="text-sm font-semibold">Lote de teste</h2>
          <p className="mt-1 text-xs text-muted-foreground">Escolha duas músicas e um arquivo TXT, JSON ou CSV com as informações delas.</p>
        </div>
        {tracks.map((file, index) => (
          <div key={index}>
            <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted-foreground">Música {index + 1}</label>
            <input ref={trackInputs[index]} type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/*"
              onChange={(e) => setTracks((old) => old.map((v, i) => i === index ? e.target.files?.[0] || null : v))}
              className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-secondary file:px-4 file:py-2 file:text-xs file:font-medium file:text-foreground" />
            {file && <p className="mt-1 text-xs text-foreground">{file.name} <span className="text-muted-foreground">· {formatSize(file.size)}</span></p>}
          </div>
        ))}
        <div>
          <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted-foreground">Arquivo de informações</label>
          <input ref={metadataInput} type="file" accept=".txt,.json,.csv,text/plain,application/json,text/csv"
            onChange={(e) => setMetadata(e.target.files?.[0] || null)}
            className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-secondary file:px-4 file:py-2 file:text-xs file:font-medium file:text-foreground" />
          {metadata && <p className="mt-1 flex items-center gap-1.5 text-xs text-foreground"><FileText className="size-3.5" />{metadata.name} <span className="text-muted-foreground">· {formatSize(metadata.size)}</span></p>}
        </div>
        {error && <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</p>}
        {progress && <p className="text-xs text-muted-foreground">{progress}</p>}
        <button type="button" onClick={handleUpload} disabled={busy || connection !== "connected" || tracks.some((f) => !f) || !metadata}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
          {busy ? "Enviando arquivos…" : "Enviar 2 músicas + informações"}
        </button>
        <p className="text-[10px] leading-relaxed text-muted-foreground">O envio usa URLs temporárias assinadas. As chaves secretas do R2 nunca chegam ao navegador.</p>
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Arquivos no bucket</h2>
          <span className="text-xs text-muted-foreground">{files.length} arquivo(s)</span>
        </div>
        <div className="divide-y divide-border/60 rounded-xl border border-border/70 bg-card/30 px-4">
          {files.length === 0 ? <p className="py-6 text-xs text-muted-foreground">Nenhum arquivo listado ainda.</p> : files.map((file) => (
            <div key={file.key} className="flex items-center justify-between gap-3 py-3">
              <span className="min-w-0 truncate text-xs text-foreground">{file.key}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{formatSize(file.size)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
