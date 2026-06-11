# Audify 🔊

**Free read-aloud for your ebooks on iPhone.** No App Store, no Apple Developer Program, no subscription — €0 total.

Audify is a tiny web app you install from Safari. Paste your book's text (or add screenshots of the pages — AI extracts the text), press play, and listen with either the **built-in iOS voice** (free, unlimited, offline) or a **natural Gemini AI voice** (free API tier).

> **Live app:** https://majic81.github.io/audify/

---

## ⚡ Fastest option: you may not need an app at all

iOS has a built-in feature that does exactly this for Apple Books — it reads the page aloud, **turns pages automatically**, and keeps going. Set it up in 2 minutes:

1. Open **Settings → Accessibility → Spoken Content**.
2. Turn on **Speak Screen** (and optionally **Speech Controller** for an always-available floating button).
3. Pick a nice voice under **Voices** (the "Premium"/"Enhanced" Siri voices are free downloads and sound great), and set the **Speaking Rate**.
4. Open the **Books** app on a page, then **swipe down from the top of the screen with two fingers** (or tap the Speech Controller button → play).
5. iOS reads the page and auto-turns to the next one. A controller overlay gives you pause/speed.

This works in Books, Kindle, Safari, PDFs — almost anywhere. Use Audify when you want a nicer AI voice, your own text, or books that block Speak Screen.

---

## 📲 Install Audify on your iPhone

1. Open **https://majic81.github.io/audify/** in **Safari**.
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Launch **Audify** from your home screen like any app.

That's it — works immediately with paste-text + the built-in voice, no account, no key.

## 🔑 Optional: free Gemini API key (for page photos & the AI voice)

Needed only for the **"Add page photos"** OCR feature and the **Gemini AI voice**:

1. Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) and sign in with your Google account.
2. Tap **Create API key** — it's free, no credit card.
3. In Audify, open **Settings ⚙️** and paste the key.

The key is stored only on your device (localStorage) and calls go directly from your phone to Google — there is no Audify server.

> Note: your **Gemini Pro subscription is not needed** — the API free tier is separate and free for everyone (Flash models, roughly 10–15 requests/minute and ~1,500/day, plenty for reading). Heads-up: Google may use free-tier prompts to improve its models, so don't OCR confidential documents.

## 📖 How to use

1. **Get your text in:**
   - **Paste** book text into the box, or
   - Take **screenshots** of book pages (e.g. in the Books app), tap **📷 Add page photos**, and select them — Gemini extracts clean text, skipping page numbers and menus.
2. Tap **▶ Read this.**
3. Listen. The current sentence is highlighted; tap any sentence to jump there. Audify remembers your position when you come back.
4. In **Settings ⚙️** switch between the **built-in iOS voice** (default, free, unlimited) and the **Gemini AI voice** (more natural narration), choose a voice, and set the speed.

## 💶 Why this is €0

| Piece | Cost |
| --- | --- |
| App distribution (PWA via Safari, no App Store) | €0 |
| Hosting (GitHub Pages) | €0 |
| Built-in voice (iOS Web Speech API) | €0, unlimited |
| Page-photo OCR + AI voice (Gemini API free tier) | €0 within free quota |
| Apple Developer Program | not needed |

## ⚠️ Known iOS limitations

- A web app **cannot watch or record other apps' screens** — iOS forbids it for anything that isn't a paid-developer native app. That's why Audify works from screenshots/pasted text, and why iOS's own Speak Screen (above) is the best fully-automatic option inside Books.
- The built-in voice pauses if you lock the screen (iOS suspends web speech). Keep the screen on while listening, or use the Gemini voice, which plays as regular audio.
- iOS doesn't let web apps register in the share sheet, so add screenshots via the **Add page photos** button instead.

## 🛠 Development

Plain HTML/CSS/JS, no build step:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
node scripts/make-icons.mjs   # regenerate PNG icons
```

Deployment is automatic: every push runs `.github/workflows/deploy.yml`, which publishes the repo root to GitHub Pages. If the first run fails with a Pages permission error, enable it once in **Repo Settings → Pages → Source: GitHub Actions**.

## 🗺 Ideas for later

EPUB upload, word-level highlighting, background audio, a reading library, lock-screen media controls.
