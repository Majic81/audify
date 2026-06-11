/* Audify app controller: input → sentences → speech engine, with
 * highlighting, position resume and settings persisted in localStorage. */

(() => {
  const $ = (id) => document.getElementById(id);

  const els = {
    inputView: $('input-view'),
    readerView: $('reader-view'),
    textInput: $('text-input'),
    sentences: $('sentences'),
    controls: $('controls'),
    btnRead: $('btn-read'),
    btnBack: $('btn-back'),
    btnPlay: $('btn-play'),
    btnPrev: $('btn-prev'),
    btnNext: $('btn-next'),
    btnPhotos: $('btn-photos'),
    photoInput: $('photo-input'),
    ocrStatus: $('ocr-status'),
    btnSettings: $('btn-settings'),
    settings: $('settings'),
    webVoice: $('web-voice'),
    webVoiceField: $('web-voice-field'),
    geminiVoice: $('gemini-voice'),
    geminiVoiceField: $('gemini-voice-field'),
    rate: $('rate'),
    rateLabel: $('rate-label'),
    apiKey: $('api-key'),
    progressLabel: $('progress-label'),
    toast: $('toast'),
  };

  const settings = {
    engine: localStorage.getItem('audify-engine') || 'web',
    webVoiceURI: localStorage.getItem('audify-web-voice') || '',
    geminiVoice: localStorage.getItem('audify-gemini-voice') || 'Kore',
    rate: parseFloat(localStorage.getItem('audify-rate') || '1'),
    apiKey: localStorage.getItem('audify-api-key') || '',
  };

  let sentences = [];      // [{ text, paraEnd }]
  let units = [];          // engine units: { text, first, last } sentence indexes
  let engine = null;
  let isPlaying = false;
  let currentSentence = 0;

  /* ---------- text → sentences ---------- */

  function splitSentences(text) {
    const out = [];
    for (const para of text.split(/\n\s*\n|\n/)) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      // Split after . ! ? … (incl. closing quotes/brackets) followed by whitespace.
      const raw = trimmed.match(/[^.!?…]+[.!?…]+[”"’')\]]*\s*|[^.!?…]+$/g) || [trimmed];
      // Re-join pieces that only ended at an abbreviation, not a real sentence end.
      const abbrev = /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|approx|No|p|pp|cf|e\.g|i\.e)\.\s*$/i;
      const parts = [];
      for (const piece of raw) {
        if (parts.length && abbrev.test(parts[parts.length - 1])) {
          parts[parts.length - 1] += piece;
        } else {
          parts.push(piece);
        }
      }
      parts.forEach((s, i) => {
        const t = s.trim();
        if (t) out.push({ text: t, paraEnd: i === parts.length - 1 });
      });
    }
    return out;
  }

  // The Gemini voice is rate-limited per request, so it reads bigger chunks;
  // the built-in voice reads sentence by sentence for fine-grained highlighting.
  function buildUnits() {
    if (settings.engine === 'web') {
      units = sentences.map((s, i) => ({ text: s.text, first: i, last: i }));
      return;
    }
    units = [];
    let buf = [], first = 0, len = 0;
    sentences.forEach((s, i) => {
      buf.push(s.text);
      len += s.text.length;
      if (len >= 900 || s.paraEnd && len >= 400 || i === sentences.length - 1) {
        units.push({ text: buf.join(' '), first, last: i });
        buf = []; first = i + 1; len = 0;
      }
    });
    if (buf.length) units.push({ text: buf.join(' '), first, last: sentences.length - 1 });
  }

  function unitOfSentence(si) {
    return Math.max(0, units.findIndex((u) => si >= u.first && si <= u.last));
  }

  /* ---------- engines ---------- */

  function makeEngine() {
    if (engine) engine.stop();
    if (settings.engine === 'gemini') {
      engine = new GeminiTtsEngine(() => settings.apiKey);
      engine.setVoice(settings.geminiVoice);
    } else {
      engine = new WebSpeechEngine();
      applyWebVoice();
    }
    engine.setRate(settings.rate);
    engine.onUnit = (i) => highlightUnit(i);
    engine.onDone = () => {
      isPlaying = false;
      updatePlayButton();
      showToast('Finished 🎉');
    };
    engine.onError = (msg) => {
      isPlaying = false;
      updatePlayButton();
      showToast(msg);
    };
  }

  async function applyWebVoice() {
    if (!(engine instanceof WebSpeechEngine)) return;
    const voices = await WebSpeechEngine.voices();
    const v = voices.find((x) => x.voiceURI === settings.webVoiceURI);
    if (v) engine.setVoice(v);
  }

  /* ---------- reader rendering & highlighting ---------- */

  function renderSentences() {
    els.sentences.innerHTML = '';
    sentences.forEach((s, i) => {
      const span = document.createElement('span');
      span.textContent = s.text + ' ';
      span.dataset.i = i;
      els.sentences.appendChild(span);
      if (s.paraEnd) els.sentences.appendChild(Object.assign(document.createElement('i'), { className: 'para-break' }));
    });
  }

  function highlightUnit(ui) {
    const u = units[ui];
    if (!u) return;
    currentSentence = u.first;
    savePosition();
    document.querySelectorAll('#sentences span.current').forEach((el) => el.classList.remove('current'));
    let firstEl = null;
    for (let i = u.first; i <= u.last; i++) {
      const el = els.sentences.querySelector(`span[data-i="${i}"]`);
      if (el) {
        el.classList.add('current');
        if (!firstEl) firstEl = el;
      }
    }
    if (firstEl) firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    els.progressLabel.textContent = `${u.last + 1} / ${sentences.length}`;
  }

  /* ---------- position resume ---------- */

  function textHash(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    return String(h);
  }

  function savePosition() {
    localStorage.setItem('audify-pos', JSON.stringify({
      hash: textHash(els.textInput.value),
      sentence: currentSentence,
    }));
  }

  function savedPosition() {
    try {
      const pos = JSON.parse(localStorage.getItem('audify-pos'));
      if (pos && pos.hash === textHash(els.textInput.value)) return pos.sentence;
    } catch (_) { /* ignore */ }
    return 0;
  }

  /* ---------- playback actions ---------- */

  function startReading() {
    const text = els.textInput.value.trim();
    if (!text) { showToast('Paste some text or add page photos first.'); return; }
    sentences = splitSentences(text);
    if (!sentences.length) { showToast('No readable sentences found.'); return; }
    buildUnits();
    renderSentences();
    els.inputView.hidden = true;
    els.readerView.hidden = false;
    els.controls.hidden = false;
    makeEngine();
    currentSentence = Math.min(savedPosition(), sentences.length - 1);
    isPlaying = true;
    updatePlayButton();
    engine.start(units, unitOfSentence(currentSentence));
  }

  function togglePlay() {
    if (!engine) return;
    if (isPlaying) {
      engine.pause();
      isPlaying = false;
    } else {
      engine.resume();
      isPlaying = true;
    }
    updatePlayButton();
  }

  function skip(delta) {
    if (!engine) return;
    const next = Math.min(Math.max(engine.index + delta, 0), units.length - 1);
    engine.seek(next);
    highlightUnit(next);
  }

  function jumpToSentence(si) {
    if (!engine) return;
    const ui = unitOfSentence(si);
    engine.seek(ui);
    highlightUnit(ui);
    if (!isPlaying) { isPlaying = true; engine.resume(); updatePlayButton(); }
  }

  function backToInput() {
    if (engine) engine.stop();
    isPlaying = false;
    updatePlayButton();
    els.readerView.hidden = true;
    els.controls.hidden = true;
    els.inputView.hidden = false;
  }

  function updatePlayButton() {
    els.btnPlay.textContent = isPlaying ? '⏸' : '▶';
  }

  /* ---------- OCR flow ---------- */

  async function handlePhotos(files) {
    if (!files.length) return;
    if (!settings.apiKey) {
      showToast('Page photos need a free Gemini API key — add it in Settings ⚙️');
      els.settings.showModal();
      return;
    }
    els.ocrStatus.hidden = false;
    try {
      const text = await ocrImages(Array.from(files), settings.apiKey, (done, total) => {
        els.ocrStatus.textContent = `Extracting text from page ${done} of ${total}…`;
      });
      els.textInput.value = (els.textInput.value.trim() ? els.textInput.value.trim() + '\n\n' : '') + text;
      els.ocrStatus.textContent = `Done — text from ${files.length} page${files.length > 1 ? 's' : ''} added below.`;
      setTimeout(() => { els.ocrStatus.hidden = true; }, 4000);
    } catch (err) {
      els.ocrStatus.hidden = true;
      showToast(err.message);
    }
    els.photoInput.value = '';
  }

  /* ---------- settings ---------- */

  async function populateWebVoices() {
    if (!WebSpeechEngine.available()) {
      els.webVoiceField.hidden = true;
      return;
    }
    const voices = await WebSpeechEngine.voices();
    const preferred = voices.filter((v) => v.lang.startsWith(navigator.language.slice(0, 2)));
    const list = (preferred.length ? preferred : voices)
      .concat(voices.filter((v) => !preferred.includes(v)));
    els.webVoice.innerHTML = '<option value="">Default</option>';
    for (const v of list) {
      const opt = document.createElement('option');
      opt.value = v.voiceURI;
      opt.textContent = `${v.name} (${v.lang})`;
      if (v.voiceURI === settings.webVoiceURI) opt.selected = true;
      els.webVoice.appendChild(opt);
    }
  }

  function syncSettingsUI() {
    document.querySelector(`input[name="engine"][value="${settings.engine}"]`).checked = true;
    els.geminiVoice.value = settings.geminiVoice;
    els.rate.value = settings.rate;
    els.rateLabel.textContent = settings.rate.toFixed(1) + '×';
    els.apiKey.value = settings.apiKey;
    els.webVoiceField.style.display = settings.engine === 'web' ? '' : 'none';
    els.geminiVoiceField.style.display = settings.engine === 'gemini' ? '' : 'none';
  }

  function bindSettings() {
    els.btnSettings.addEventListener('click', () => els.settings.showModal());

    document.querySelectorAll('input[name="engine"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        settings.engine = radio.value;
        localStorage.setItem('audify-engine', settings.engine);
        syncSettingsUI();
        // Rebuild mid-session so the new voice continues from the same spot.
        if (!els.readerView.hidden && sentences.length) {
          const wasPlaying = isPlaying;
          if (engine) engine.stop();
          buildUnits();
          makeEngine();
          if (wasPlaying) {
            engine.start(units, unitOfSentence(currentSentence));
          } else {
            engine.units = units;
            engine.index = unitOfSentence(currentSentence);
          }
        }
      });
    });

    els.webVoice.addEventListener('change', () => {
      settings.webVoiceURI = els.webVoice.value;
      localStorage.setItem('audify-web-voice', settings.webVoiceURI);
      applyWebVoice();
    });

    els.geminiVoice.addEventListener('change', () => {
      settings.geminiVoice = els.geminiVoice.value;
      localStorage.setItem('audify-gemini-voice', settings.geminiVoice);
      if (engine instanceof GeminiTtsEngine) engine.setVoice(settings.geminiVoice);
    });

    els.rate.addEventListener('input', () => {
      settings.rate = parseFloat(els.rate.value);
      els.rateLabel.textContent = settings.rate.toFixed(1) + '×';
      localStorage.setItem('audify-rate', String(settings.rate));
      if (engine) engine.setRate(settings.rate);
    });

    els.apiKey.addEventListener('change', () => {
      settings.apiKey = els.apiKey.value.trim();
      localStorage.setItem('audify-api-key', settings.apiKey);
    });
  }

  /* ---------- misc ---------- */

  let toastTimer = null;
  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 5000);
  }

  function bindEvents() {
    els.btnRead.addEventListener('click', startReading);
    els.btnBack.addEventListener('click', backToInput);
    els.btnPlay.addEventListener('click', togglePlay);
    els.btnPrev.addEventListener('click', () => skip(-1));
    els.btnNext.addEventListener('click', () => skip(1));
    els.btnPhotos.addEventListener('click', () => els.photoInput.click());
    els.photoInput.addEventListener('change', () => handlePhotos(els.photoInput.files));
    els.sentences.addEventListener('click', (e) => {
      const span = e.target.closest('span[data-i]');
      if (span) jumpToSentence(parseInt(span.dataset.i, 10));
    });
    els.textInput.addEventListener('input', () => {
      localStorage.setItem('audify-text', els.textInput.value);
    });
  }

  function init() {
    els.textInput.value = localStorage.getItem('audify-text') || '';
    bindEvents();
    bindSettings();
    syncSettingsUI();
    populateWebVoices();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  init();
})();
