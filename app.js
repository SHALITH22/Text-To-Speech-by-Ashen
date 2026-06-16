// TTS — free, fully client-side text-to-speech.
//
//   ⚡ Instant mode : browser Web Speech API (no download, cannot export audio)
//   🎙️ Studio mode : Kokoro-82M neural model running locally via WebGPU/WASM
//                     (one-time model download, 28+ voices, downloadable WAV)
//
// No servers, no API keys, no data collection.

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const els = {
    engInstant: $("engInstant"),
    engStudio: $("engStudio"),
    text: $("text"),
    charCount: $("charCount"),
    voice: $("voice"),
    qualityField: $("qualityField"),
    quality: $("quality"),
    rate: $("rate"),
    pitch: $("pitch"),
    pitchField: $("pitchField"),
    volume: $("volume"),
    rateVal: $("rateVal"),
    pitchVal: $("pitchVal"),
    volumeVal: $("volumeVal"),
    speak: $("speak"),
    pause: $("pause"),
    resume: $("resume"),
    stop: $("stop"),
    download: $("download"),
    progressWrap: $("progressWrap"),
    progressBar: $("progressBar"),
    player: $("player"),
    status: $("status"),
  };

  const synth = window.speechSynthesis;
  const STORAGE_KEY = "tts-settings-v2";
  const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
  const KOKORO_URL = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.0/dist/kokoro.web.js";

  // Curated Kokoro v1.0 English voices (id, label, quality grade). 28 voices vs.
  // the 3 the browser exposes. Grades are Kokoro's own published quality grades.
  const KOKORO_VOICES = [
    { group: "American — Female", items: [
      ["af_heart", "Heart", "A"], ["af_bella", "Bella", "A-"], ["af_nicole", "Nicole", "B-"],
      ["af_aoede", "Aoede", "C+"], ["af_kore", "Kore", "C+"], ["af_sarah", "Sarah", "C+"],
      ["af_nova", "Nova", "C"], ["af_alloy", "Alloy", "C"], ["af_sky", "Sky", "C-"],
      ["af_jessica", "Jessica", "D"], ["af_river", "River", "D"] ] },
    { group: "American — Male", items: [
      ["am_michael", "Michael", "C+"], ["am_fenrir", "Fenrir", "C+"], ["am_puck", "Puck", "C+"],
      ["am_echo", "Echo", "D"], ["am_eric", "Eric", "D"], ["am_liam", "Liam", "D"],
      ["am_onyx", "Onyx", "D"], ["am_santa", "Santa", "D-"], ["am_adam", "Adam", "F+"] ] },
    { group: "British — Female", items: [
      ["bf_emma", "Emma", "B-"], ["bf_isabella", "Isabella", "C"],
      ["bf_alice", "Alice", "D"], ["bf_lily", "Lily", "D"] ] },
    { group: "British — Male", items: [
      ["bm_george", "George", "C"], ["bm_fable", "Fable", "C"],
      ["bm_lewis", "Lewis", "D+"], ["bm_daniel", "Daniel", "D"] ] },
  ];

  let engine = "instant";          // "instant" | "studio"
  let browserVoices = [];          // SpeechSynthesis voices
  let kokoroTTS = null;            // loaded KokoroTTS instance
  let kokoroLoadingFor = null;     // dtype currently loading/loaded
  let currentBlobUrl = null;       // object URL for download/playback

  // ---------------------------------------------------------------- settings
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch (_) { return {}; }
  }
  function saveSettings() {
    const data = {
      engine,
      voiceInstant: engine === "instant" ? (browserVoices[els.voice.value]?.name || null) : loadSettings().voiceInstant,
      voiceStudio: engine === "studio" ? els.voice.value : loadSettings().voiceStudio,
      rate: els.rate.value, pitch: els.pitch.value, volume: els.volume.value,
      quality: els.quality.value,
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
  }

  // ---------------------------------------------------------------- UI helpers
  function setStatus(msg, kind) {
    els.status.textContent = msg;
    els.status.className = "status" + (kind ? ` status--${kind}` : "");
  }
  function syncLabels() {
    els.rateVal.textContent = Number(els.rate.value).toFixed(1);
    els.pitchVal.textContent = Number(els.pitch.value).toFixed(1);
    els.volumeVal.textContent = Math.round(els.volume.value * 100);
  }
  function syncCharCount() {
    const n = els.text.value.length;
    els.charCount.textContent = `${n.toLocaleString()} character${n === 1 ? "" : "s"}`;
  }
  function setProgress(pct) {
    if (pct == null) { els.progressWrap.hidden = true; return; }
    els.progressWrap.hidden = false;
    els.progressBar.style.width = Math.max(0, Math.min(100, pct)) + "%";
  }
  function resetControls() {
    els.speak.disabled = false;
    els.pause.disabled = true;
    els.resume.disabled = true;
    els.stop.disabled = true;
  }

  // ---------------------------------------------------------------- voices
  function populateBrowserVoices() {
    browserVoices = synth ? synth.getVoices().sort((a, b) =>
      a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name)) : [];
    els.voice.innerHTML = "";
    if (!browserVoices.length) {
      els.voice.innerHTML = "<option>Loading voices…</option>";
      return;
    }
    browserVoices.forEach((v, i) => {
      const o = document.createElement("option");
      o.value = i;
      o.textContent = `${v.name} (${v.lang})${v.default ? " — default" : ""}`;
      els.voice.appendChild(o);
    });
    const saved = loadSettings();
    let idx = browserVoices.findIndex((v) => /^en/i.test(v.lang));
    if (saved.voiceInstant) {
      const f = browserVoices.findIndex((v) => v.name === saved.voiceInstant);
      if (f >= 0) idx = f;
    }
    els.voice.value = Math.max(0, idx);
  }

  function populateKokoroVoices() {
    els.voice.innerHTML = "";
    KOKORO_VOICES.forEach((g) => {
      const og = document.createElement("optgroup");
      og.label = g.group;
      g.items.forEach(([id, name, grade]) => {
        const o = document.createElement("option");
        o.value = id;
        o.textContent = `${name} — grade ${grade}`;
        og.appendChild(o);
      });
      els.voice.appendChild(og);
    });
    const saved = loadSettings();
    els.voice.value = saved.voiceStudio || "af_heart";
    if (!els.voice.value) els.voice.value = "af_heart";
  }

  // ---------------------------------------------------------------- engine switch
  function setEngine(next) {
    engine = next;
    els.engInstant.classList.toggle("is-active", next === "instant");
    els.engStudio.classList.toggle("is-active", next === "studio");
    stop();

    const studio = next === "studio";
    els.qualityField.hidden = !studio;
    els.pitchField.style.display = studio ? "none" : "";   // Kokoro has no pitch param
    els.speak.textContent = studio ? "✨ Generate" : "▶ Speak";
    els.player.hidden = true;
    els.download.disabled = true;

    if (studio) {
      populateKokoroVoices();
      setStatus("Studio mode. First generation downloads the model once (then cached).");
    } else {
      populateBrowserVoices();
      setStatus("Instant mode. Ready.");
    }
    saveSettings();
  }

  // ---------------------------------------------------------------- WAV encoder
  function encodeWav(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);            // PCM
    view.setUint16(22, 1, true);            // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, samples.length * 2, true);
    let off = 44;
    for (let i = 0; i < samples.length; i++, off += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([view], { type: "audio/wav" });
  }

  // ---------------------------------------------------------------- Studio (Kokoro)
  async function getKokoro(dtype) {
    if (kokoroTTS && kokoroLoadingFor === dtype) return kokoroTTS;
    setStatus("Loading model… (one-time download, then cached)");
    setProgress(0);
    const { KokoroTTS } = await import(KOKORO_URL);
    const device = ("gpu" in navigator) ? "webgpu" : "wasm";
    kokoroTTS = await KokoroTTS.from_pretrained(KOKORO_MODEL, {
      dtype,
      device,
      progress_callback: (p) => {
        if (p && p.status === "progress" && typeof p.progress === "number") {
          setProgress(p.progress);
          setStatus(`Downloading model… ${Math.round(p.progress)}%`);
        }
      },
    });
    kokoroLoadingFor = dtype;
    setProgress(null);
    return kokoroTTS;
  }

  async function generateStudio() {
    const text = els.text.value.trim();
    if (!text) { setStatus("Please enter some text first.", "error"); els.text.focus(); return; }

    els.speak.disabled = true;
    els.download.disabled = true;
    els.player.hidden = true;
    try {
      const tts = await getKokoro(els.quality.value);
      setStatus("Generating audio…", "active");
      setProgress(100);
      const voice = els.voice.value || "af_heart";
      const speed = parseFloat(els.rate.value);
      const audio = await tts.generate(text, { voice, speed });

      // kokoro-js returns a RawAudio: { audio: Float32Array, sampling_rate: Number }
      const samples = audio.audio || audio.data;
      const rate = audio.sampling_rate || audio.sampleRate || 24000;

      if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
      const blob = encodeWav(samples, rate);
      currentBlobUrl = URL.createObjectURL(blob);

      els.player.src = currentBlobUrl;
      els.player.volume = parseFloat(els.volume.value);
      els.player.hidden = false;
      els.download.disabled = false;
      els.stop.disabled = false;
      setProgress(null);
      setStatus("Done. Press play, or download the WAV.", "active");
      els.player.play().catch(() => {});
    } catch (err) {
      setProgress(null);
      console.error(err);
      setStatus("Generation failed: " + (err && err.message ? err.message : err), "error");
    } finally {
      els.speak.disabled = false;
    }
  }

  // ---------------------------------------------------------------- Instant (Web Speech)
  function speakInstant() {
    const text = els.text.value.trim();
    if (!text) { setStatus("Please enter some text first.", "error"); els.text.focus(); return; }
    if (!synth) { setStatus("This browser lacks the Web Speech API. Try Chrome or Edge.", "error"); return; }

    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = browserVoices[els.voice.value];
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = parseFloat(els.rate.value);
    u.pitch = parseFloat(els.pitch.value);
    u.volume = parseFloat(els.volume.value);
    u.onstart = () => { els.speak.disabled = true; els.pause.disabled = false; els.stop.disabled = false; setStatus("Speaking…", "active"); };
    u.onend = () => { resetControls(); setStatus("Done."); };
    u.onerror = (e) => { resetControls(); if (e.error !== "interrupted" && e.error !== "canceled") setStatus("Error: " + e.error, "error"); };
    synth.speak(u);
  }

  // ---------------------------------------------------------------- shared controls
  function onSpeak() { saveSettings(); engine === "studio" ? generateStudio() : speakInstant(); }
  function pause() {
    if (engine === "instant") {
      if (synth && synth.speaking && !synth.paused) { synth.pause(); els.pause.disabled = true; els.resume.disabled = false; setStatus("Paused."); }
    } else if (!els.player.paused) {
      els.player.pause(); els.pause.disabled = true; els.resume.disabled = false; setStatus("Paused.");
    }
  }
  function resume() {
    if (engine === "instant") {
      if (synth && synth.paused) { synth.resume(); els.pause.disabled = false; els.resume.disabled = true; setStatus("Speaking…", "active"); }
    } else {
      els.player.play(); els.pause.disabled = false; els.resume.disabled = true; setStatus("Playing…", "active");
    }
  }
  function stop() {
    if (synth) synth.cancel();
    if (!els.player.hidden) { els.player.pause(); els.player.currentTime = 0; }
    resetControls();
    if (engine === "studio" && !els.player.hidden) els.stop.disabled = false;
  }
  function download() {
    if (!currentBlobUrl) return;
    const a = document.createElement("a");
    a.href = currentBlobUrl;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.download = `tts-${els.voice.value || "speech"}-${stamp}.wav`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------------------------------------------------------------- events
  els.engInstant.addEventListener("click", () => setEngine("instant"));
  els.engStudio.addEventListener("click", () => setEngine("studio"));
  els.rate.addEventListener("input", syncLabels);
  els.pitch.addEventListener("input", syncLabels);
  els.volume.addEventListener("input", () => { syncLabels(); if (!els.player.hidden) els.player.volume = parseFloat(els.volume.value); });
  [els.rate, els.pitch, els.volume, els.voice, els.quality].forEach((e) => e.addEventListener("change", saveSettings));
  els.text.addEventListener("input", syncCharCount);
  els.speak.addEventListener("click", onSpeak);
  els.pause.addEventListener("click", pause);
  els.resume.addEventListener("click", resume);
  els.stop.addEventListener("click", stop);
  els.download.addEventListener("click", download);
  els.text.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); onSpeak(); } });
  window.addEventListener("beforeunload", () => { if (synth) synth.cancel(); if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl); });

  // ---------------------------------------------------------------- init
  if (synth && synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = () => { if (engine === "instant") populateBrowserVoices(); };
  }
  (function init() {
    const s = loadSettings();
    if (s.rate) els.rate.value = s.rate;
    if (s.pitch) els.pitch.value = s.pitch;
    if (s.volume) els.volume.value = s.volume;
    if (s.quality) els.quality.value = s.quality;
    syncLabels();
    syncCharCount();
    setEngine(s.engine === "studio" ? "studio" : "instant");
  })();
})();
