import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

loadEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const THINKING_PRESETS = {
  off: 0,
  on: 1024
};

const OPENAI_REASONING_PRESETS = {
  off: 'none',
  on: 'medium'
};

const MODEL_OPTIONS = {
  openai: {
    provider: 'openai',
    model: process.env.OPENAI_MODEL || 'gpt-5.2'
  },
  gemini: {
    provider: 'gemini',
    model: process.env.GEMINI_MODEL || 'gemini-3-flash'
  }
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/healthz') {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/api/models') {
      return sendJson(res, 200, Object.entries(MODEL_OPTIONS).map(([id, meta]) => ({
        id,
        label: `${meta.provider.toUpperCase()} · ${meta.model}`
      })));
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const body = await readJsonBody(req);
      const { prompt, thinkingMode } = body ?? {};

      if (!prompt || typeof prompt !== 'string') {
        return sendJson(res, 400, { error: 'prompt is required.' });
      }

      if (!['off', 'on'].includes(thinkingMode)) {
        return sendJson(res, 400, { error: 'thinkingMode must be "off" or "on".' });
      }

      const tasks = Object.values(MODEL_OPTIONS).map(async (selected) => {
        const result = selected.provider === 'openai'
          ? await callOpenAI(selected.model, prompt, thinkingMode)
          : await callGemini(selected.model, prompt, thinkingMode);

        return {
          provider: selected.provider,
          model: selected.model,
          response: result.text,
          metrics: result.metrics
        };
      });

      const settled = await Promise.allSettled(tasks);
      const results = settled.map((entry, index) => {
        const selected = Object.values(MODEL_OPTIONS)[index];
        if (entry.status === 'fulfilled') return entry.value;

        return {
          provider: selected.provider,
          model: selected.model,
          response: `Fehler: ${entry.reason instanceof Error ? entry.reason.message : 'Unbekannter Fehler'}`,
          metrics: null,
          error: true
        };
      });

      const allFailed = results.every((result) => result.error);
      return sendJson(res, allFailed ? 502 : 200, { results });
    }

    if (req.method === 'GET') {
      return serveStaticFile(url.pathname, res);
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected gateway error.';
    sendJson(res, 500, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`LLM Performance Vergleich running on http://${HOST}:${PORT}`);
});

function loadEnv(filePath) {
  try {
    const raw = fsSync.readFileSync(filePath, 'utf8');
    const lines = raw.split('\n');
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx === -1) return;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!(key in process.env)) process.env[key] = value;
    });
  } catch {
    // optional .env
  }
}

function getGeminiThinkingBudget(mode) {
  return THINKING_PRESETS[mode] ?? THINKING_PRESETS.off;
}

async function serveStaticFile(pathname, res) {
  const normalized = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const safePath = path.normalize(normalized).replace(/^(\.\.(\/|\\|$))+/, '');
  const absolutePath = path.join(publicDir, safePath);

  if (!absolutePath.startsWith(publicDir)) {
    return sendJson(res, 403, { error: 'Forbidden' });
  }

  try {
    const content = await fs.readFile(absolutePath);
    const ext = path.extname(absolutePath);
    const contentType = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8'
    }[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function callOpenAI(model, prompt, thinkingMode) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');

  const reasoningEffort = OPENAI_REASONING_PRESETS[thinkingMode] ?? OPENAI_REASONING_PRESETS.off;

  const start = performance.now();
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: prompt,
      stream: true,
      reasoning: { effort: reasoningEffort }
    })
  });

  if (!response.ok || !response.body) {
    throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let ttftMs = null;
  let usage = null;
  let finishReason = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    if (ttftMs === null) ttftMs = performance.now() - start;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const lines = part.split('\n').map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;

        try {
          const event = JSON.parse(payload);
          if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
            if (ttftMs === null) ttftMs = performance.now() - start;
            text += event.delta;
          }

          if (event.type === 'response.output_item.done') {
            const itemFinishReason = event.item?.finish_reason ?? event.item?.status;
            if (itemFinishReason) finishReason = itemFinishReason;
          }

          if (event.type === 'response.completed') {
            usage = event.response?.usage ?? null;
            finishReason = event.response?.status ?? finishReason;
            if (!text && event.response?.output_text) text = event.response.output_text;
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }
  }

  const totalMs = performance.now() - start;
  const tokensPerSecond = usage?.output_tokens && totalMs > 0
    ? Number((usage.output_tokens / (totalMs / 1000)).toFixed(2))
    : null;

  return {
    text: text.trim() || '[No text returned]',
    metrics: {
      ttftMs: ttftMs ? Number(ttftMs.toFixed(2)) : null,
      totalLatencyMs: Number(totalMs.toFixed(2)),
      tokensPerSecond,
      inputTokens: usage?.input_tokens ?? null,
      outputTokens: usage?.output_tokens ?? null,
      finishReason: finishReason ?? 'completed',
      thinkingBudget: reasoningEffort
    }
  };
}

async function callGemini(model, prompt, thinkingMode) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');

  const thinkingBudget = getGeminiThinkingBudget(thinkingMode);
  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      thinkingConfig: {
        thinkingBudget
      }
    }
  };

  const start = performance.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok || !response.body) {
    throw new Error(`Gemini request failed: ${response.status} ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let ttftMs = null;
  let usage = null;
  let finishReason = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    if (ttftMs === null) ttftMs = performance.now() - start;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const lines = part.split('\n').map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;

        try {
          const event = JSON.parse(payload);
          if (ttftMs === null) ttftMs = performance.now() - start;

          const chunkText = event?.candidates?.[0]?.content?.parts
            ?.map((part) => (typeof part?.text === 'string' ? part.text : ''))
            .join('') || '';
          if (chunkText) text += chunkText;
          if (event?.usageMetadata) usage = event.usageMetadata;
          if (event?.candidates?.[0]?.finishReason) finishReason = event.candidates[0].finishReason;
        } catch {
          // ignore malformed chunks
        }
      }
    }
  }

  const totalMs = performance.now() - start;

  if (!text.trim()) {
    const fallback = await callGeminiNonStreaming(model, requestBody, apiKey);
    if (fallback.text) {
      text = fallback.text;
      usage = fallback.usage ?? usage;
      finishReason = fallback.finishReason ?? finishReason;
    }
  }

  const outputTokens = usage?.candidatesTokenCount ?? null;
  const tokensPerSecond = outputTokens && totalMs > 0
    ? Number((outputTokens / (totalMs / 1000)).toFixed(2))
    : null;

  return {
    text: text.trim() || '[No text returned]',
    metrics: {
      ttftMs: ttftMs ? Number(ttftMs.toFixed(2)) : null,
      totalLatencyMs: Number(totalMs.toFixed(2)),
      tokensPerSecond,
      inputTokens: usage?.promptTokenCount ?? null,
      outputTokens,
      finishReason,
      thinkingBudget
    }
  };
}

async function callGeminiNonStreaming(model, requestBody, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    return { text: '', usage: null };
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim() || '';

  return {
    text,
    usage: payload?.usageMetadata ?? null,
    finishReason: payload?.candidates?.[0]?.finishReason ?? null
  };
}
