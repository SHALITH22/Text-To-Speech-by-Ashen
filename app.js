// TTS — a free, fully client-side text-to-speech app.
// Uses the browser's built-in Web Speech API (SpeechSynthesis).
// No servers, no network calls, no data collection.

(function () {
  "use strict";

  const synth = window.speechSynthesis;
  const $ = (id) => document.getElementById(id);

  const els = {
    text: $("text"),
    charCount: $("charCount"),
    voice: $("voice"),
    rate: $("rate"),
    pitch: $("pitch"),
    volume: $("volume"),
    rateVal: $("rateVal"),
    pitchVal: $("pitchVal"),
    volumeVal: $("volumeVal"),
    speak: $("speak"),
    pause: $("pause"),
    resume: $("resume"),
    stop: $("stop"),
    status: $("status"),
  };

  const STORAGE_KEY = "tts-settings";
  let voices = [];

  // --- Feature detection ---------------------------------------------------
  if (!synth) {
    setStatus("Your browser does not support the Web Speech API. Try Chrome, Edge, or Safari.", "error");
    els.speak.disabled = true;
    return;
  }

  // --- Voice loading -------------------------------------------------------
  function populateVoices() {
    voices = synth.getVoices().sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
    const saved = loadSettings();
    els.voice.innerHTML = "";

    if (!voices.length) {
      const opt = document.createElement("option");
      opt.textContent = "Loading voices…";
      els.voice.appendChild(opt);
      return;
    }

    voices.forEach((v, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = `${v.name} (${v.lang})${v.default ? " — default" : ""}`;
      els.voice.appendChild(opt);
    });

    // Restore saved voice, else pick the first English voice, else first voice.
    let index = 0;
    if (saved && saved.voiceName) {
      const found = voices.findIndex((v) => v.name === saved.voiceName);
      if (found >= 0) index = found;
    } else {
      const en = voices.findIndex((v) => /^en/i.test(v.lang));
      if (en >= 0) index = en;
    }
    els.voice.value = index;
  }

  populateVoices();
  if (synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = populateVoices;
  }

  // --- Settings persistence ------------------------------------------------
  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
    } catch (_) {
      return null;
    }
  }

  function saveSettings() {
    const v = voices[els.voice.value];
    const data = {
      voiceName: v ? v.name : null,
      rate: els.rate.value,
      pitch: els.pitch.value,
      volume: els.volume.value,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (_) {
      /* ignore quota errors */
    }
  }

  // Apply saved slider values on load.
  (function applySavedSliders() {
    const s = loadSettings();
    if (!s) return;
    if (s.rate) els.rate.value = s.rate;
    if (s.pitch) els.pitch.value = s.pitch;
    if (s.volume) els.volume.value = s.volume;
  })();

  // --- UI sync -------------------------------------------------------------
  function syncLabels() {
    els.rateVal.textContent = Number(els.rate.value).toFixed(1);
    els.pitchVal.textContent = Number(els.pitch.value).toFixed(1);
    els.volumeVal.textContent = Math.round(els.volume.value * 100);
  }

  function syncCharCount() {
    const n = els.text.value.length;
    els.charCount.textContent = `${n.toLocaleString()} character${n === 1 ? "" : "s"}`;
  }

  function setStatus(msg, kind) {
    els.status.textContent = msg;
    els.status.className = "status" + (kind ? ` status--${kind}` : "");
  }

  function setSpeakingState(speaking) {
    els.speak.disabled = speaking;
    els.pause.disabled = !speaking;
    els.resume.disabled = true;
    els.stop.disabled = !speaking;
  }

  // --- Speaking ------------------------------------------------------------
  function speak() {
    const text = els.text.value.trim();
    if (!text) {
      setStatus("Please enter some text first.", "error");
      els.text.focus();
      return;
    }

    synth.cancel(); // clear any queued/stuck utterance

    const utter = new SpeechSynthesisUtterance(text);
    const v = voices[els.voice.value];
    if (v) {
      utter.voice = v;
      utter.lang = v.lang;
    }
    utter.rate = parseFloat(els.rate.value);
    utter.pitch = parseFloat(els.pitch.value);
    utter.volume = parseFloat(els.volume.value);

    utter.onstart = () => {
      setSpeakingState(true);
      setStatus("Speaking…", "active");
    };
    utter.onend = () => {
      setSpeakingState(false);
      setStatus("Done.");
    };
    utter.onerror = (e) => {
      setSpeakingState(false);
      if (e.error === "interrupted" || e.error === "canceled") return;
      setStatus(`Error: ${e.error}`, "error");
    };

    saveSettings();
    synth.speak(utter);
  }

  function pause() {
    if (synth.speaking && !synth.paused) {
      synth.pause();
      els.pause.disabled = true;
      els.resume.disabled = false;
      setStatus("Paused.");
    }
  }

  function resume() {
    if (synth.paused) {
      synth.resume();
      els.pause.disabled = false;
      els.resume.disabled = true;
      setStatus("Speaking…", "active");
    }
  }

  function stop() {
    synth.cancel();
    setSpeakingState(false);
    setStatus("Stopped.");
  }

  // --- Events --------------------------------------------------------------
  els.rate.addEventListener("input", syncLabels);
  els.pitch.addEventListener("input", syncLabels);
  els.volume.addEventListener("input", syncLabels);
  ["change"].forEach((evt) => {
    els.rate.addEventListener(evt, saveSettings);
    els.pitch.addEventListener(evt, saveSettings);
    els.volume.addEventListener(evt, saveSettings);
    els.voice.addEventListener(evt, saveSettings);
  });
  els.text.addEventListener("input", syncCharCount);

  els.speak.addEventListener("click", speak);
  els.pause.addEventListener("click", pause);
  els.resume.addEventListener("click", resume);
  els.stop.addEventListener("click", stop);

  // Ctrl/Cmd + Enter to speak.
  els.text.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      speak();
    }
  });

  // Some browsers keep speaking after the tab closes; stop cleanly on unload.
  window.addEventListener("beforeunload", () => synth.cancel());

  // --- Init ----------------------------------------------------------------
  syncLabels();
  syncCharCount();
  setStatus("Ready.");
})();
