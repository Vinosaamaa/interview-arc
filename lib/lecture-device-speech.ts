export type DeviceSpeechState = { phase: string; chunkIndex: number; characterOffset: number; message: string };
type Options = {
  speech: SpeechSynthesis;
  makeUtterance: (text: string) => SpeechSynthesisUtterance;
  chunkCount: number;
  chunkIndex: number;
  characterOffset: number;
  loadChunk: (index: number) => Promise<string>;
  savePosition: (index: number, offset: number) => Promise<void>;
  onChange: (state: DeviceSpeechState) => void;
};

// Self-contained so the exact same controller can be embedded in an MCP widget.
// Only local device voices are eligible. There is no remote/provider fallback.
export function createDeviceLectureSpeech(options: Options) {
  let phase = "paused", index = options.chunkIndex, offset = options.characterOffset;
  let epoch = 0, rate = 1, disposed = false, lastSave = 0;
  let saveTail: Promise<void> = Promise.resolve();
  let utterance: SpeechSynthesisUtterance | null = null;
  const cache = new Map<number, Promise<string>>();
  const emit = (message = "") => options.onChange({ phase, chunkIndex: index, characterOffset: offset, message });
  const load = (n: number) => {
    if (!cache.has(n)) cache.set(n, options.loadChunk(n));
    return cache.get(n)!;
  };
  function fail(error: unknown) {
    if (disposed) return;
    epoch++; phase = "error"; options.speech.cancel();
    emit(error instanceof Error ? error.message : "Device speech could not continue. Reload the saved position.");
  }
  function persist() {
    const savedIndex = index, savedOffset = offset;
    saveTail = saveTail.then(() => options.savePosition(savedIndex, savedOffset));
    // Retain the rejected chain: an unconfirmed save must block later writes.
    void saveTail.catch(fail);
    return saveTail;
  }
  async function step(token: number, voice: SpeechSynthesisVoice) {
    try {
      const text = await load(index);
      if (token !== epoch || phase !== "playing" || disposed) return;
      if (offset >= text.length) {
        if (index === options.chunkCount - 1) { phase = "finished"; await persist(); emit("Lecture finished."); return; }
        index++; offset = 0; await persist();
        if (token === epoch && phase === "playing") void step(token, voice);
        return;
      }
      // Keep utterances short to avoid browser long-utterance stalls. Slices
      // preserve every character; boundary events supply an honest resume point.
      const rest = text.slice(offset), limit = rest.slice(0, 240);
      const sentence = limit.match(/^[\s\S]*?[.!?](?:\s|$)/)?.[0];
      const end = sentence?.length || (rest.length > 240 ? (limit.lastIndexOf(" ") + 1 || 240) : rest.length);
      const start = offset;
      utterance = options.makeUtterance(rest.slice(0, end));
      utterance.voice = voice; utterance.rate = rate;
      utterance.onboundary = event => {
        if (token !== epoch || phase !== "playing") return;
        offset = start + Math.min(end, Math.max(0, event.charIndex)); emit();
        if (Date.now() - lastSave > 30000) { lastSave = Date.now(); void persist(); }
      };
      utterance.onend = () => {
        if (token !== epoch || phase !== "playing") return;
        offset = start + end; emit(); void step(token, voice);
      };
      utterance.onerror = event => { if (token === epoch) fail(new Error("Device speech stopped: " + event.error)); };
      options.speech.speak(utterance); emit();
      // Fetch only one section ahead, preserving the bounded owner-scoped reader.
      const next = index + 1;
      if (next < options.chunkCount) void load(next).catch(() => cache.delete(next));
    } catch (error) { if (token === epoch) fail(error); }
  }
  return {
    async play() {
      if (disposed || phase === "error" || phase === "finished" || phase === "playing") return;
      const voice = options.speech?.getVoices().find(v => v.localService && v.lang.startsWith("en"));
      if (!voice) { phase = "unavailable"; emit("This host has no local English voice. No paid speech request was made."); return; }
      const token = ++epoch; phase = "loading"; emit("Opening the saved section…");
      try { await saveTail; if (token !== epoch || disposed) return; phase = "playing"; lastSave = Date.now(); void step(token, voice); }
      catch (error) { fail(error); }
    },
    async pause() {
      if (disposed || !["playing", "loading"].includes(phase)) return;
      epoch++; phase = "paused"; options.speech.cancel(); emit("Paused. Saving the last reported word or sentence boundary…");
      await persist(); if (phase === "paused") emit("Paused. Position saved.");
    },
    async seek(chunkIndex: number) {
      if (disposed || phase === "error" || !Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= options.chunkCount) return;
      epoch++; phase = "paused"; options.speech.cancel(); index = chunkIndex; offset = 0;
      emit("Saving the selected section…"); await persist(); emit("Section selected. Press Play.");
    },
    setRate(value: number) { if (Number.isFinite(value) && value >= 0.5 && value <= 2) rate = value; },
    dispose() { disposed = true; epoch++; options.speech.cancel(); utterance = null; },
  };
}
