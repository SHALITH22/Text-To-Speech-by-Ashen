// Text To Speech by Ashen — free, fully client-side TTS.
//
//   ⚡ Instant : browser Web Speech API (no download, cannot export audio)
//   🎙️ Studio : Kokoro-82M neural model, GPU-accelerated via WebGPU (fast),
//               WASM fallback on CPU. 28+ natural voices, downloadable WAV.
//
// Key performance rule: on WebGPU use fp16/fp32 (GPU-native, fast).
// q8 quantization is for CPU only — using it on the GPU is ~14x slower.

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const els = {};
  ["engInstant","engStudio","deviceBadge","text","charCount","voice","rate","pitch",
   "pitchField","volume","rateVal","pitchVal","volumeVal","speak","pause","resume","stop",
   "download","progressWrap","progressBar","player","status","help","modal","modalClose","modalGot"
  ].forEach((id) => els[id] = $(id));

  const synth = window.speechSynthesis;
  const STORAGE_KEY = "tts-settings-v3";
  const SEEN_KEY = "tts-seen-welcome";
  const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
  const KOKORO_URL = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.0/dist/kokoro.web.js";

  // Curated Kokoro v1.0 voices. ⭐ = most natural (grade A/B). Grades are Kokoro's own.
  const BEST = ["af_heart","af_bella","bf_emma","am_michael","bm_george","af_nicole"];
  const KOKORO_VOICES = [
    { group: "American — Female", items: [
      ["af_heart","Heart","A"],["af_bella","Bella","A-"],["af_nicole","Nicole","B-"],
      ["af_aoede","Aoede","C+"],["af_kore","Kore","C+"],["af_sarah","Sarah","C+"],
      ["af_nova","Nova","C"],["af_alloy","Alloy","C"],["af_sky","Sky","C-"],
      ["af_jessica","Jessica","D"],["af_river","River","D"] ] },
    { group: "American — Male", items: [
      ["am_michael","Michael","C+"],["am_fenrir","Fenrir","C+"],["am_puck","Puck","C+"],
      ["am_echo","Echo","D"],["am_eric","Eric","D"],["am_liam","Liam","D"],
      ["am_onyx","Onyx","D"],["am_santa","Santa","D-"],["am_adam","Adam","F+"] ] },
    { group: "British — Female", items: [
      ["bf_emma","Emma","B-"],["bf_isabella","Isabella","C"],
      ["bf_alice","Alice","D"],["bf_lily","Lily","D"] ] },
    { group: "British — Male", items: [
      ["bm_george","George","C"],["bm_fable","Fable","C"],
      ["bm_lewis","Lewis","D+"],["bm_daniel","Daniel","D"] ] },
  ];

  const state = {
    engine: "instant",
    browserVoices: [],
    kokoro: null,
    compute: null,          // {device, dtype, label}
    audioCtx: null,
    sources: [],            // active AudioBufferSourceNodes
    gainNodes: [],          // for live volume
    stopped: false,
    blobUrl: null,
  };

  // ---------------------------------------------------------------- settings
  const loadSettings = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (_) { return {}; } };
  function saveSettings() {
    const prev = loadSettings();
    const data = {
      engine: state.engine,
      voiceInstant: state.engine === "instant" ? (state.browserVoices[els.voice.value]?.name || prev.voiceInstant) : prev.voiceInstant,
      voiceStudio: state.engine === "studio" ? els.voice.value : prev.voiceStudio,
      rate: els.rate.value, pitch: els.pitch.value, volume: els.volume.value,
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
  function resetControls() { els.speak.disabled = false; els.pause.disabled = true; els.resume.disabled = true; els.stop.disabled = true; }

  // ---------------------------------------------------------------- voices
  function populateBrowserVoices() {
    state.browserVoices = synth ? synth.getVoices().sort((a, b) =>
      a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name)) : [];
    els.voice.innerHTML = "";
    if (!state.browserVoices.length) { els.voice.innerHTML = "<option>Loading voices…</option>"; return; }
    state.browserVoices.forEach((v, i) => {
      const o = document.createElement("option");
      o.value = i; o.textContent = `${v.name} (${v.lang})${v.default ? " — default" : ""}`;
      els.voice.appendChild(o);
    });
    const saved = loadSettings();
    let idx = state.browserVoices.findIndex((v) => /^en/i.test(v.lang));
    if (saved.voiceInstant) { const f = state.browserVoices.findIndex((v) => v.name === saved.voiceInstant); if (f >= 0) idx = f; }
    els.voice.value = Math.max(0, idx);
  }
  function populateKokoroVoices() {
    els.voice.innerHTML = "";
    // ⭐ Most natural group first for easy discovery.
    const star = document.createElement("optgroup");
    star.label = "⭐ Most natural";
    KOKORO_VOICES.forEach((g) => g.items.forEach(([id, name, grade]) => {
      if (BEST.includes(id)) {
        const o = document.createElement("option");
        o.value = id; o.textContent = `⭐ ${name} — grade ${grade}`;
        star.appendChild(o);
      }
    }));
    els.voice.appendChild(star);
    KOKORO_VOICES.forEach((g) => {
      const og = document.createElement("optgroup"); og.label = g.group;
      g.items.forEach(([id, name, grade]) => {
        const o = document.createElement("option");
        o.value = id; o.textContent = `${name} — grade ${grade}`;
        og.appendChild(o);
      });
      els.voice.appendChild(og);
    });
    els.voice.value = loadSettings().voiceStudio || "af_heart";
    if (!els.voice.value) els.voice.value = "af_heart";
  }

  // ---------------------------------------------------------------- engine switch
  function setEngine(next) {
    state.engine = next;
    els.engInstant.classList.toggle("is-active", next === "instant");
    els.engStudio.classList.toggle("is-active", next === "studio");
    stop();
    const studio = next === "studio";
    els.pitchField.style.display = studio ? "none" : "";   // Kokoro has no pitch param
    els.speak.textContent = studio ? "✨ Generate" : "▶ Speak";
    els.player.hidden = true;
    els.download.disabled = true;
    els.deviceBadge.hidden = !studio;
    if (studio) {
      populateKokoroVoices();
      showDeviceBadge();
      setStatus("Studio mode. First generation downloads the voice model once, then it's cached.");
    } else {
      populateBrowserVoices();
      setStatus("Instant mode. Ready.");
    }
    saveSettings();
  }

  // ---------------------------------------------------------------- compute device
  async function pickCompute() {
    if (navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          const f16 = adapter.features && adapter.features.has("shader-f16");
          return { device: "webgpu", dtype: f16 ? "fp16" : "fp32", label: f16 ? "⚡ GPU accelerated (fp16)" : "⚡ GPU accelerated (fp32)" };
        }
      } catch (_) {}
    }
    return { device: "wasm", dtype: "q8", label: "🐢 CPU mode — slower (open in Chrome/Edge for GPU speed)" };
  }
  async function showDeviceBadge() {
    if (!state.compute) state.compute = await pickCompute();
    els.deviceBadge.hidden = false;
    els.deviceBadge.textContent = state.compute.label;
    els.deviceBadge.className = "badge " + (state.compute.device === "webgpu" ? "badge--ok" : "badge--warn");
  }

  // ---------------------------------------------------------------- WAV encoder
  function encodeWav(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); writeStr(8, "WAVE");
    writeStr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    writeStr(36, "data"); view.setUint32(40, samples.length * 2, true);
    let off = 44;
    for (let i = 0; i < samples.length; i++, off += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([view], { type: "audio/wav" });
  }

  // Split text into speakable chunks (~240 chars) on sentence boundaries.
  function splitSentences(t) {
    const parts = (t.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [t]);
    const chunks = []; let cur = "";
    for (const p of parts) {
      if ((cur + p).length > 240 && cur) { chunks.push(cur.trim()); cur = p; }
      else cur += p;
    }
    if (cur.trim()) chunks.push(cur.trim());
    return chunks.length ? chunks : [t];
  }

  // ---------------------------------------------------------------- Studio (Kokoro)
  async function loadModel(device, dtype) {
    const { KokoroTTS } = await import(KOKORO_URL);
    return await KokoroTTS.from_pretrained(KOKORO_MODEL, {
      dtype, device,
      progress_callback: (p) => {
        if (p && p.status === "progress" && typeof p.progress === "number") {
          setProgress(p.progress);
          setStatus(`Downloading voice model (one-time)… ${Math.round(p.progress)}%`);
        }
      },
    });
  }
  async function getKokoro() {
    if (state.kokoro) return state.kokoro;
    state.compute = await pickCompute();
    await showDeviceBadge();
    setStatus("Loading voice model… (one-time download, then cached)");
    setProgress(0);
    const c = state.compute;
    try {
      state.kokoro = await loadModel(c.device, c.dtype);
    } catch (e) {
      console.warn("Primary compute failed, falling back:", e);
      if (c.device === "webgpu" && c.dtype === "fp16") { c.dtype = "fp32"; c.label = "⚡ GPU accelerated (fp32)"; await showDeviceBadge(); state.kokoro = await loadModel("webgpu", "fp32"); }
      else if (c.device === "webgpu") { c.device = "wasm"; c.dtype = "q8"; c.label = "🐢 CPU mode — slower"; await showDeviceBadge(); state.kokoro = await loadModel("wasm", "q8"); }
      else throw e;
    }
    setProgress(null);
    return state.kokoro;
  }

  function closeAudio() {
    state.stopped = true;
    state.sources.forEach((s) => { try { s.stop(); } catch (_) {} });
    state.sources = []; state.gainNodes = [];
    if (state.audioCtx) { try { state.audioCtx.close(); } catch (_) {} state.audioCtx = null; }
  }

  async function generateStudio() {
    const text = els.text.value.trim();
    if (!text) { setStatus("Please enter some text first.", "error"); els.text.focus(); return; }

    closeAudio();
    els.speak.disabled = true; els.download.disabled = true; els.player.hidden = true;
    els.pause.disabled = false; els.resume.disabled = true; els.stop.disabled = false;
    try {
      const tts = await getKokoro();
      const voice = els.voice.value || "af_heart";
      const speed = parseFloat(els.rate.value);
      const vol = parseFloat(els.volume.value);
      const chunks = splitSentences(text);

      const Ctx = window.AudioContext || window.webkitAudioContext;
      state.audioCtx = new Ctx();
      state.sources = []; state.gainNodes = []; state.stopped = false;
      let playHead = state.audioCtx.currentTime;
      const collected = []; let sr = 24000;

      for (let i = 0; i < chunks.length; i++) {
        if (state.stopped) break;
        setStatus(`Generating ${chunks.length > 1 ? (i + 1) + "/" + chunks.length : ""}… ${state.compute.device === "wasm" ? "(CPU mode is slow — please wait)" : ""}`, "active");
        setProgress((i / chunks.length) * 100);
        const audio = await tts.generate(chunks[i], { voice, speed });
        if (state.stopped) break;
        const s = audio.audio || audio.data; sr = audio.sampling_rate || audio.sampleRate || 24000;
        collected.push(s);
        // progressive playback: first chunk starts immediately
        const buf = state.audioCtx.createBuffer(1, s.length, sr); buf.copyToChannel(s, 0);
        const src = state.audioCtx.createBufferSource(); src.buffer = buf;
        const g = state.audioCtx.createGain(); g.gain.value = vol;
        src.connect(g).connect(state.audioCtx.destination);
        if (playHead < state.audioCtx.currentTime) playHead = state.audioCtx.currentTime;
        src.start(playHead); playHead += buf.duration;
        state.sources.push(src); state.gainNodes.push(g);
      }
      setProgress(100);

      if (collected.length) {
        const total = collected.reduce((n, a) => n + a.length, 0);
        const merged = new Float32Array(total); let off = 0;
        for (const a of collected) { merged.set(a, off); off += a.length; }
        if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
        state.blobUrl = URL.createObjectURL(encodeWav(merged, sr));
        els.player.src = state.blobUrl; els.player.volume = vol; els.player.hidden = false;
        els.download.disabled = false;
        setStatus("Done. Playing now — press ⬇ Download WAV to save.", "active");
      }
      setProgress(null);
    } catch (err) {
      setProgress(null); console.error(err);
      setStatus("Generation failed: " + (err && err.message ? err.message : err), "error");
    } finally {
      els.speak.disabled = false; els.pause.disabled = true; els.resume.disabled = true;
    }
  }

  // ---------------------------------------------------------------- Instant (Web Speech)
  function speakInstant() {
    const text = els.text.value.trim();
    if (!text) { setStatus("Please enter some text first.", "error"); els.text.focus(); return; }
    if (!synth) { setStatus("This browser lacks the Web Speech API. Try Chrome or Edge.", "error"); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = state.browserVoices[els.voice.value];
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = parseFloat(els.rate.value); u.pitch = parseFloat(els.pitch.value); u.volume = parseFloat(els.volume.value);
    u.onstart = () => { els.speak.disabled = true; els.pause.disabled = false; els.stop.disabled = false; setStatus("Speaking…", "active"); };
    u.onend = () => { resetControls(); setStatus("Done."); };
    u.onerror = (e) => { resetControls(); if (e.error !== "interrupted" && e.error !== "canceled") setStatus("Error: " + e.error, "error"); };
    synth.speak(u);
  }

  // ---------------------------------------------------------------- shared controls
  function onSpeak() { saveSettings(); state.engine === "studio" ? generateStudio() : speakInstant(); }
  function pause() {
    if (state.engine === "instant") {
      if (synth && synth.speaking && !synth.paused) { synth.pause(); els.pause.disabled = true; els.resume.disabled = false; setStatus("Paused."); }
    } else if (state.audioCtx && state.audioCtx.state === "running") {
      state.audioCtx.suspend(); els.pause.disabled = true; els.resume.disabled = false; setStatus("Paused.");
    }
  }
  function resume() {
    if (state.engine === "instant") {
      if (synth && synth.paused) { synth.resume(); els.pause.disabled = false; els.resume.disabled = true; setStatus("Speaking…", "active"); }
    } else if (state.audioCtx && state.audioCtx.state === "suspended") {
      state.audioCtx.resume(); els.pause.disabled = false; els.resume.disabled = true; setStatus("Playing…", "active");
    }
  }
  function stop() {
    if (synth) synth.cancel();
    closeAudio();
    if (!els.player.hidden) { try { els.player.pause(); els.player.currentTime = 0; } catch (_) {} }
    resetControls();
  }
  function download() {
    if (!state.blobUrl) return;
    const a = document.createElement("a");
    a.href = state.blobUrl;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.download = `tts-${els.voice.value || "speech"}-${stamp}.wav`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------------------------------------------------------------- help modal
  function openModal() { els.modal.hidden = false; }
  function closeModal() { els.modal.hidden = true; try { localStorage.setItem(SEEN_KEY, "1"); } catch (_) {} }

  // ---------------------------------------------------------------- events
  els.engInstant.addEventListener("click", () => setEngine("instant"));
  els.engStudio.addEventListener("click", () => setEngine("studio"));
  els.rate.addEventListener("input", syncLabels);
  els.pitch.addEventListener("input", syncLabels);
  els.volume.addEventListener("input", () => {
    syncLabels();
    const v = parseFloat(els.volume.value);
    if (!els.player.hidden) els.player.volume = v;
    state.gainNodes.forEach((g) => { try { g.gain.value = v; } catch (_) {} });
  });
  [els.rate, els.pitch, els.volume, els.voice].forEach((e) => e.addEventListener("change", saveSettings));
  els.text.addEventListener("input", syncCharCount);
  els.speak.addEventListener("click", onSpeak);
  els.pause.addEventListener("click", pause);
  els.resume.addEventListener("click", resume);
  els.stop.addEventListener("click", stop);
  els.download.addEventListener("click", download);
  els.help.addEventListener("click", openModal);
  els.modalClose.addEventListener("click", closeModal);
  els.modalGot.addEventListener("click", closeModal);
  els.modal.addEventListener("click", (e) => { if (e.target === els.modal) closeModal(); });
  els.text.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); onSpeak(); } });
  window.addEventListener("beforeunload", () => { if (synth) synth.cancel(); closeAudio(); if (state.blobUrl) URL.revokeObjectURL(state.blobUrl); });

  if (synth && synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = () => { if (state.engine === "instant") populateBrowserVoices(); };
  }

  // ---------------------------------------------------------------- init
  (function init() {
    const s = loadSettings();
    if (s.rate) els.rate.value = s.rate;
    if (s.pitch) els.pitch.value = s.pitch;
    if (s.volume) els.volume.value = s.volume;
    syncLabels(); syncCharCount();
    setEngine(s.engine === "studio" ? "studio" : "instant");
    let seen; try { seen = localStorage.getItem(SEEN_KEY); } catch (_) {}
    if (!seen) openModal();
  })();
})();
