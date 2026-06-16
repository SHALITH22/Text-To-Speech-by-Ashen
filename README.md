# 🔊 TTS — Free Text-to-Speech

A tiny, free, **100% client-side** text-to-speech web app. Paste text, pick a voice, and hear it spoken — all in your browser. **No servers, no sign-up, no data collection, no downloads.**

It uses the browser's built-in [Web Speech API](https://developer.mozilla.org/docs/Web/API/SpeechSynthesis), so it loads instantly and works offline once the page is open.

## Features

- 🎙️ Choose from every voice installed in your browser/OS
- 🎚️ Adjustable **speed**, **pitch**, and **volume**
- ⏯️ Speak / Pause / Resume / Stop controls
- 💾 Remembers your last voice and settings (saved locally)
- ⌨️ `Ctrl/Cmd + Enter` to speak
- 🔒 Private by design — text never leaves your device
- 📦 Zero dependencies, zero build step — just three files

## Run locally

No build tools needed. Either:

- **Double-click `index.html`**, or
- Serve the folder (recommended, so voices load reliably):
  ```bash
  # Python (if installed)
  python -m http.server 8000
  # then open http://localhost:8000
  ```

## Deploy free on GitHub Pages

1. Create a new repo named **`tts`** on GitHub.
2. Push this folder (see commands below).
3. In the repo: **Settings → Pages → Build and deployment → Source: `Deploy from a branch` → Branch: `main` / `root` → Save.**
4. Your app goes live at `https://<your-username>.github.io/tts/` within a minute.

```bash
git init
git add .
git commit -m "Initial commit: free client-side TTS app"
git branch -M main
git remote add origin https://github.com/<your-username>/tts.git
git push -u origin main
```

> Also works on **Cloudflare Pages**, **Netlify**, or **Vercel** — point them at this folder, no build command needed.

## How it works & limitations

- Voices and their quality come from your **operating system / browser**, not this app. Chrome and Edge on Windows expose the system (SAPI) voices; Edge can also surface higher-quality "Online (Natural)" Microsoft voices.
- The Web Speech API **plays** audio but does not expose a way to **export it to an MP3/WAV file** — so there's no download button. If you need downloadable audio files or studio-grade neural voices, you'd need a heavier server-side or in-browser-model engine (e.g. Kokoro), which trades away this app's instant load and zero footprint.

## License

[MIT](LICENSE) — free for personal and commercial use.
