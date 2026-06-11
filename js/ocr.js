/* Extract book text from page screenshots with Gemini vision (free API tier).
 * Tries current model IDs in order and remembers the one that works.
 */

const OCR_MODELS = ['gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];

const OCR_PROMPT =
  'This image is a page from an ebook. Transcribe the body text exactly, in reading order. ' +
  'Skip page numbers, headers, footers, progress bars and any app interface elements. ' +
  'Join words split by end-of-line hyphenation. Output only the transcribed text, nothing else.';

async function ocrImages(files, apiKey, onProgress) {
  const texts = [];
  for (let i = 0; i < files.length; i++) {
    onProgress(i + 1, files.length);
    const dataUrl = await downscaleImage(files[i]);
    const [, mime, b64] = /^data:(.*?);base64,(.*)$/.exec(dataUrl);
    texts.push(await ocrOne(mime, b64, apiKey));
  }
  return texts.join('\n\n');
}

async function ocrOne(mimeType, base64Data, apiKey) {
  const remembered = localStorage.getItem('audify-ocr-model');
  const models = remembered
    ? [remembered, ...OCR_MODELS.filter((m) => m !== remembered)]
    : OCR_MODELS;

  let lastError = null;
  for (const model of models) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType, data: base64Data } },
              { text: OCR_PROMPT },
            ],
          }],
        }),
      }
    );
    if (res.status === 404) { lastError = new Error('Model ' + model + ' not found'); continue; }
    if (res.status === 429) {
      throw new Error('Gemini free-tier limit reached — wait a minute and try again.');
    }
    if (res.status === 400 || res.status === 403) {
      const body = await res.json().catch(() => ({}));
      const msg = body.error && body.error.message ? body.error.message : 'invalid API key?';
      throw new Error('Gemini rejected the request: ' + msg);
    }
    if (!res.ok) { lastError = new Error('HTTP ' + res.status + ' from ' + model); continue; }

    const data = await res.json();
    const text = data.candidates && data.candidates[0]
      && data.candidates[0].content && data.candidates[0].content.parts
      && data.candidates[0].content.parts.map((p) => p.text || '').join('').trim();
    if (!text) { lastError = new Error('Empty response from ' + model); continue; }
    localStorage.setItem('audify-ocr-model', model);
    return text;
  }
  throw new Error('Text extraction failed: ' + (lastError ? lastError.message : 'no model available'));
}

// Shrink photos before upload: faster, and well within free-tier token budgets.
function downscaleImage(file, maxDim = 1568, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
}
