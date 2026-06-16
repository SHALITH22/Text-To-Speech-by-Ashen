# 🔊 Text To Speech by Ashen

A tiny, free, **100% client-side** text-to-speech web app with **two engines**. No servers, no sign-up, no API keys, no data collection — everything runs in your browser.

| Mode | Engine | Voices | Audio download | Load |
|------|--------|--------|----------------|------|
| ⚡ **Instant** | Browser [Web Speech API](https://developer.mozilla.org/docs/Web/API/SpeechSynthesis) | Whatever your OS provides (3 on Windows/Chrome; more in Edge) | ❌ not possible | Instant |
| 🎙️ **Studio** | [Kokoro-82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) neural model, run locally | **28 built-in** (US/UK, male/female) | ✅ **WAV download** | One-time model download (~160 MB on GPU), then cached |

## Features

- 🎙️ **28 neural voices** in Studio mode (with ⭐ "Most natural" picks) + every OS voice in Instant mode
- ⚡ **GPU-accelerated** — auto-detects WebGPU and uses the full-precision (fp32) model. Typically **faster than realtime**; falls back to CPU automatically. A badge shows which mode you're in.
- 🚀 **Progressive playback** — long text is split into sentences; the first sentence starts playing within seconds while the rest render.
- ⬇️ **Download generated speech as a WAV file** (Studio mode)
- 🎚️ Adjustable **speed**, **volume**, and (Instant only) **pitch**
- ❓ **Built-in help / welcome window** for first-time users
- ⏯️ Speak / Pause / Resume / Stop + built-in audio player
- 💾 Remembers your engine, voice, and settings (saved locally)
- ⌨️ `Ctrl/Cmd + Enter` to speak
- 🔒 Private by design — text and audio never leave your device
- 📦 Zero dependencies, zero build step — Kokoro streams from a CDN, so the repo stays tiny

> **Performance & quality note:** the model dtype is matched to the device — `fp32` on WebGPU (GPU-native, fast, clean) and `q8` on CPU. Two gotchas this avoids: a `q8` model on the GPU runs ~14× slower, and an `fp16` model on the GPU produces garbled/noisy audio on many cards (too little precision for Kokoro). So GPU always uses full-precision `fp32`.

## Run locally

No build tools needed. Serve the folder so the model loads correctly:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

(Double-clicking `index.html` works for Instant mode; Studio mode needs to be served over `http://` or `https://`.)

## Deploy free on GitHub Pages

1. Create a new repo named **`tts`** on GitHub.
2. Push this folder (commands below).
3. **Settings → Pages → Source: Deploy from a branch → `main` / `root` → Save.**
4. Live at `https://<your-username>.github.io/tts/` within a minute.

```bash
git remote add origin https://github.com/<your-username>/Text-To-Speech-by-Ashen.git
git push -u origin main
```

> Also works on **Cloudflare Pages**, **Netlify**, or **Vercel** — no build command needed.

## About the parameters (and ElevenLabs)

The UI mirrors a studio TTS layout, but **every control here actually does something** — there are no placebo sliders:

| This app | What it does | ElevenLabs equivalent |
|----------|--------------|-----------------------|
| **Voice** | Picks 1 of 28 Kokoro voices | Voice library |
| **Speed** | 0.5×–2× speaking rate (native) | Speed |
| **Volume** | Output gain | (post-processing) |
| **Quality** | Model precision / size | Model selection |
| **Pitch** | Pitch shift *(Instant mode only)* | — |

ElevenLabs' **Stability**, **Similarity Boost**, and **Style Exaggeration** are properties of *their* proprietary cloud model. No free, locally-run model (including Kokoro) exposes them, so they're intentionally **not** included rather than added as non-functional sliders. If you ever want those exact controls, you'd need ElevenLabs' paid API (an API key, which can't live safely in a public client-side app).

## Notes & limitations

- **Studio mode** runs fastest on browsers with **WebGPU** (Chrome/Edge). Without it, it falls back to WASM (still works, just slower). GitHub Pages can't send the COOP/COEP headers needed for multi-threaded WASM, so non-WebGPU browsers run single-threaded.
- **Instant mode** voice quality comes from your OS/browser. Open the app in **Microsoft Edge** to access higher-quality "Online (Natural)" voices.
- The Web Speech API (Instant mode) can only *play* audio — exporting to a file is only possible in Studio mode.

## License

[MIT](LICENSE) — free for personal and commercial use.
