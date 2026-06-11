/* Two interchangeable text-to-speech engines.
 *
 * Both speak a list of "units" (one unit = one or more sentences) and report
 * progress via callbacks so the app can highlight text and track position:
 *   engine.start(units, startIndex)  — units: [{ text, firstSentence, lastSentence }]
 *   engine.pause() / engine.resume() / engine.stop()
 *   engine.setRate(rate)
 * Callbacks (set as properties): onUnit(index), onDone(), onError(message)
 */

/* ---------- Built-in voice via the Web Speech API ---------- */

class WebSpeechEngine {
  constructor() {
    this.rate = 1;
    this.voice = null;
    this.units = [];
    this.index = 0;
    this.playing = false;
    this.onUnit = this.onDone = this.onError = null;
  }

  static available() {
    return 'speechSynthesis' in window;
  }

  // Voices load asynchronously on iOS; resolve once the list is non-empty.
  static voices() {
    return new Promise((resolve) => {
      const list = speechSynthesis.getVoices();
      if (list.length) return resolve(list);
      speechSynthesis.addEventListener('voiceschanged', () => {
        resolve(speechSynthesis.getVoices());
      }, { once: true });
      setTimeout(() => resolve(speechSynthesis.getVoices()), 1500);
    });
  }

  setRate(rate) { this.rate = rate; }
  setVoice(voice) { this.voice = voice; }

  start(units, startIndex = 0) {
    this.units = units;
    this.index = startIndex;
    this.playing = true;
    this._speakCurrent();
  }

  _speakCurrent() {
    if (!this.playing) return;
    if (this.index >= this.units.length) {
      this.playing = false;
      if (this.onDone) this.onDone();
      return;
    }
    if (this.onUnit) this.onUnit(this.index);
    const u = new SpeechSynthesisUtterance(this.units[this.index].text);
    u.rate = this.rate;
    if (this.voice) u.voice = this.voice;
    u.onend = () => {
      if (!this.playing) return;
      this.index += 1;
      this._speakCurrent();
    };
    u.onerror = (e) => {
      // "interrupted"/"canceled" fire on our own cancel() calls — not real errors.
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      this.playing = false;
      if (this.onError) this.onError('Speech failed: ' + (e.error || 'unknown error'));
    };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  // pause()/resume() of speechSynthesis is unreliable on iOS, so pausing
  // cancels and resuming restarts the current sentence instead.
  pause() {
    this.playing = false;
    speechSynthesis.cancel();
  }

  resume() {
    this.playing = true;
    this._speakCurrent();
  }

  stop() {
    this.playing = false;
    speechSynthesis.cancel();
  }

  seek(index) {
    this.index = index;
    if (this.playing) this._speakCurrent();
  }
}

/* ---------- Gemini AI voice via the free-tier TTS API ---------- */

const GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';

class GeminiTtsEngine {
  constructor(getApiKey) {
    this.getApiKey = getApiKey;
    this.rate = 1;
    this.voiceName = 'Kore';
    this.units = [];
    this.index = 0;
    this.playing = false;
    this.audio = new Audio();
    this.cache = new Map(); // unit index -> audio blob URL
    this.onUnit = this.onDone = this.onError = null;
    this.audio.addEventListener('ended', () => {
      if (!this.playing) return;
      this.index += 1;
      this._playCurrent();
    });
  }

  setRate(rate) {
    this.rate = rate;
    this.audio.playbackRate = rate;
  }
  setVoice(name) {
    if (name !== this.voiceName) this._clearCache();
    this.voiceName = name;
  }

  start(units, startIndex = 0) {
    this._clearCache();
    this.units = units;
    this.index = startIndex;
    this.playing = true;
    this._playCurrent();
  }

  async _playCurrent() {
    if (!this.playing) return;
    if (this.index >= this.units.length) {
      this.playing = false;
      if (this.onDone) this.onDone();
      return;
    }
    if (this.onUnit) this.onUnit(this.index);
    const i = this.index;
    try {
      const url = await this._fetchAudio(i);
      if (!this.playing || this.index !== i) return; // user skipped meanwhile
      this.audio.src = url;
      this.audio.playbackRate = this.rate;
      await this.audio.play();
      this._prefetch(i + 1);
    } catch (err) {
      this.playing = false;
      if (this.onError) this.onError(err.message);
    }
  }

  async _fetchAudio(i) {
    if (this.cache.has(i)) return this.cache.get(i);
    const key = this.getApiKey();
    if (!key) throw new Error('Add your free Gemini API key in Settings to use the AI voice.');
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: this.units[i].text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voiceName } },
            },
          },
        }),
      }
    );
    if (res.status === 429) {
      throw new Error('Gemini free-tier limit reached — wait a minute, or switch to the built-in voice in Settings.');
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = body.error && body.error.message ? body.error.message : `HTTP ${res.status}`;
      throw new Error('Gemini AI voice unavailable (' + msg + '). Switch to the built-in voice in Settings.');
    }
    const data = await res.json();
    const part = data.candidates && data.candidates[0]
      && data.candidates[0].content && data.candidates[0].content.parts
      && data.candidates[0].content.parts.find((p) => p.inlineData);
    if (!part) throw new Error('Gemini returned no audio. Try again or use the built-in voice.');
    const sampleRate = parseRate(part.inlineData.mimeType) || 24000;
    const blob = pcmToWav(base64ToBytes(part.inlineData.data), sampleRate);
    const url = URL.createObjectURL(blob);
    this.cache.set(i, url);
    return url;
  }

  _prefetch(i) {
    if (i < this.units.length && !this.cache.has(i)) {
      this._fetchAudio(i).catch(() => {}); // errors surface when the unit actually plays
    }
  }

  pause() {
    this.playing = false;
    this.audio.pause();
  }

  resume() {
    this.playing = true;
    if (this.audio.src && this.audio.paused && !this.audio.ended) {
      this.audio.play().catch(() => this._playCurrent());
    } else {
      this._playCurrent();
    }
  }

  stop() {
    this.playing = false;
    this.audio.pause();
    this.audio.removeAttribute('src');
  }

  seek(index) {
    this.index = index;
    this.audio.pause();
    if (this.playing) this._playCurrent();
  }

  _clearCache() {
    for (const url of this.cache.values()) URL.revokeObjectURL(url);
    this.cache.clear();
  }
}

/* ---------- helpers: Gemini returns raw 16-bit PCM; wrap it as WAV ---------- */

function parseRate(mimeType) {
  const m = /rate=(\d+)/.exec(mimeType || '');
  return m ? parseInt(m[1], 10) : null;
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function pcmToWav(pcmBytes, sampleRate, channels = 1, bitsPerSample = 16) {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + pcmBytes.length, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, byteRate, true);
  v.setUint16(32, (channels * bitsPerSample) / 8, true);
  v.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  v.setUint32(40, pcmBytes.length, true);
  return new Blob([header, pcmBytes], { type: 'audio/wav' });
}
