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
  },
  azure_foundry: {
    provider: 'azure_foundry',
    model: process.env.AZURE_FOUNDRY_MODEL || 'gpt-5.2'
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

      return streamChatResults(res, prompt, thinkingMode);
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

function estimateVisibleTokens(text) {
  const normalized = String(text ?? '').trim();
  if (!normalized) return 0;

  return normalized.split(/\s+/u).length;
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

async function streamChatResults(res, prompt, thinkingMode) {
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  const pending = Object.values(MODEL_OPTIONS).map((selected) => runProviderRequest(
    selected,
    prompt,
    thinkingMode,
    (progress) => writeNdjsonLine(res, { type: 'progress', progress })
  ));

  while (pending.length > 0) {
    const winner = await Promise.race(
      pending.map((task, index) => task.then((result) => ({ index, result })))
    );

    pending.splice(winner.index, 1);
    writeNdjsonLine(res, { type: 'result', result: winner.result });
  }

  writeNdjsonLine(res, { type: 'done' });
  res.end();
}

async function runProviderRequest(selected, prompt, thinkingMode, onProgress) {
  onProgress?.({
    provider: selected.provider,
    model: selected.model,
    stage: 'started',
    elapsedMs: 0,
    message: 'Request gestartet'
  });

  try {
    const result = await runModelCall(selected, prompt, thinkingMode, onProgress);

    return {
      provider: selected.provider,
      model: selected.model,
      response: result.text,
      metrics: result.metrics
    };
  } catch (error) {
    return {
      provider: selected.provider,
      model: selected.model,
      response: `Fehler: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`,
      metrics: null,
      error: true
    };
  }
}

async function runModelCall(selected, prompt, thinkingMode, onProgress) {
  if (selected.provider === 'openai') {
    return callOpenAI(selected.model, prompt, thinkingMode, onProgress);
  }

  if (selected.provider === 'gemini') {
    return callGemini(selected.model, prompt, thinkingMode, onProgress);
  }

  if (selected.provider === 'azure_foundry') {
    return callAzureFoundry(selected.model, prompt, thinkingMode, onProgress);
  }

  throw new Error(`Unsupported provider: ${selected.provider}`);
}

function writeNdjsonLine(res, payload) {
  res.write(`${JSON.stringify(payload)}\n`);
}

async function callOpenAI(model, prompt, thinkingMode, onProgress) {
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
  let firstChunkMs = null;
  let firstTokenMs = null;
  let usage = null;
  let finishReason = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    if (firstChunkMs === null) {
      firstChunkMs = performance.now() - start;
      onProgress?.({
        provider: 'openai',
        model,
        stage: 'connected',
        elapsedMs: Number(firstChunkMs.toFixed(2)),
        message: 'Erster Streaming-Chunk eingetroffen'
      });
    }

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/u);
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
            if (firstTokenMs === null) {
              firstTokenMs = performance.now() - start;
              onProgress?.({
                provider: 'openai',
                model,
                stage: 'first_token',
                elapsedMs: Number(firstTokenMs.toFixed(2)),
                message: 'Erstes sichtbares Token'
              });
            }
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
  onProgress?.({
    provider: 'openai',
    model,
    stage: 'completed',
    elapsedMs: Number(totalMs.toFixed(2)),
    message: 'Antwort vollständig'
  });
  const estimatedVisibleTokens = estimateVisibleTokens(text);
  const outputTextTokens = usage?.output_tokens_details?.text_tokens
    ?? (estimatedVisibleTokens > 0 ? estimatedVisibleTokens : null);
  const billedOutputTokens = usage?.output_tokens ?? outputTextTokens;
  const tokensPerSecond = billedOutputTokens && totalMs > 0
    ? Number((billedOutputTokens / (totalMs / 1000)).toFixed(2))
    : null;

  return {
    text: text.trim() || '[No text returned]',
    metrics: {
      ttftMs: firstChunkMs ? Number(firstChunkMs.toFixed(2)) : null,
      firstTokenMs: firstTokenMs ? Number(firstTokenMs.toFixed(2)) : null,
      totalLatencyMs: Number(totalMs.toFixed(2)),
      postTtftLatencyMs: firstChunkMs ? Number((totalMs - firstChunkMs).toFixed(2)) : null,
      generationMs: firstTokenMs ? Number((totalMs - firstTokenMs).toFixed(2)) : null,
      tokensPerSecond,
      inputTokens: usage?.input_tokens ?? null,
      outputTokens: outputTextTokens,
      billedOutputTokens,
      finishReason: finishReason ?? 'completed',
      thinkingBudget: reasoningEffort,
      streamingEnabled: true
    }
  };
}

async function callGemini(model, prompt, thinkingMode, onProgress) {
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
  let firstChunkMs = null;
  let firstTokenMs = null;
  let usage = null;
  let finishReason = null;
  let streamingEnabled = true;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    if (firstChunkMs === null) {
      firstChunkMs = performance.now() - start;
      onProgress?.({
        provider: 'gemini',
        model,
        stage: 'connected',
        elapsedMs: Number(firstChunkMs.toFixed(2)),
        message: 'Erster Streaming-Chunk eingetroffen'
      });
    }

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/u);
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const lines = part.split('\n').map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;

        try {
          const event = JSON.parse(payload);

          const chunkText = event?.candidates?.[0]?.content?.parts
            ?.map((part) => (typeof part?.text === 'string' ? part.text : ''))
            .join('') || '';
          if (chunkText) {
            if (firstTokenMs === null) {
              firstTokenMs = performance.now() - start;
              onProgress?.({
                provider: 'gemini',
                model,
                stage: 'first_token',
                elapsedMs: Number(firstTokenMs.toFixed(2)),
                message: 'Erstes sichtbares Token'
              });
            }
            text += chunkText;
          }
          if (event?.usageMetadata) usage = event.usageMetadata;
          if (event?.candidates?.[0]?.finishReason) finishReason = event.candidates[0].finishReason;
        } catch {
          // ignore malformed chunks
        }
      }
    }
  }

  const remaining = buffer.trim();
  if (remaining) {
    const lines = remaining.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;

      try {
        const event = JSON.parse(payload);

        const chunkText = event?.candidates?.[0]?.content?.parts
          ?.map((part) => (typeof part?.text === 'string' ? part.text : ''))
          .join('') || '';
        if (chunkText) {
          if (firstTokenMs === null) {
            firstTokenMs = performance.now() - start;
            onProgress?.({
              provider: 'gemini',
              model,
              stage: 'first_token',
              elapsedMs: Number(firstTokenMs.toFixed(2)),
              message: 'Erstes sichtbares Token'
            });
          }
          text += chunkText;
        }
        if (event?.usageMetadata) usage = event.usageMetadata;
        if (event?.candidates?.[0]?.finishReason) finishReason = event.candidates[0].finishReason;
      } catch {
        // ignore malformed chunks
      }
    }
  }

  const totalMs = performance.now() - start;
  onProgress?.({
    provider: 'gemini',
    model,
    stage: 'completed',
    elapsedMs: Number(totalMs.toFixed(2)),
    message: 'Antwort vollständig'
  });

  if (!text.trim()) {
    const fallback = await callGeminiNonStreaming(model, requestBody, apiKey);
    if (fallback.text) {
      text = fallback.text;
      usage = fallback.usage ?? usage;
      finishReason = fallback.finishReason ?? finishReason;
      streamingEnabled = false;
    }
  }

  const estimatedVisibleTokens = estimateVisibleTokens(text);
  const outputTokens = usage?.candidatesTokenCount
    ?? (estimatedVisibleTokens > 0 ? estimatedVisibleTokens : null);
  const thinkingTokens = usage?.thoughtsTokenCount ?? 0;
  const billedOutputTokens = outputTokens === null ? null : outputTokens + thinkingTokens;
  const tokensPerSecond = outputTokens && totalMs > 0
    ? Number((outputTokens / (totalMs / 1000)).toFixed(2))
    : null;

  return {
    text: text.trim() || '[No text returned]',
    metrics: {
      ttftMs: firstChunkMs ? Number(firstChunkMs.toFixed(2)) : null,
      firstTokenMs: firstTokenMs ? Number(firstTokenMs.toFixed(2)) : null,
      totalLatencyMs: Number(totalMs.toFixed(2)),
      postTtftLatencyMs: firstChunkMs ? Number((totalMs - firstChunkMs).toFixed(2)) : null,
      generationMs: firstTokenMs ? Number((totalMs - firstTokenMs).toFixed(2)) : null,
      tokensPerSecond,
      inputTokens: usage?.promptTokenCount ?? null,
      outputTokens,
      billedOutputTokens,
      finishReason,
      thinkingBudget,
      streamingEnabled
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

async function callAzureFoundry(model, prompt, thinkingMode, onProgress) {
  const endpoint = process.env.AZURE_FOUNDRY_ENDPOINT;
  const apiKey = process.env.AZURE_FOUNDRY_API_KEY;
  const deployment = process.env.AZURE_FOUNDRY_DEPLOYMENT;
  const apiVersion = process.env.AZURE_FOUNDRY_API_VERSION || '2024-10-21';

  if (!endpoint) throw new Error('AZURE_FOUNDRY_ENDPOINT is not configured.');
  if (!apiKey) throw new Error('AZURE_FOUNDRY_API_KEY is not configured.');
  if (!deployment) throw new Error('AZURE_FOUNDRY_DEPLOYMENT is not configured.');

  const normalizedEndpoint = endpoint.replace(/\/+$/u, '');
  const reasoningEffort = OPENAI_REASONING_PRESETS[thinkingMode] ?? OPENAI_REASONING_PRESETS.off;
  const requestBody = {
    messages: [{ role: 'user', content: prompt }],
    stream: true,
    stream_options: { include_usage: true }
  };

  if (reasoningEffort !== OPENAI_REASONING_PRESETS.off) {
    requestBody.reasoning_effort = reasoningEffort;
  }

  const start = performance.now();
  const url = `${normalizedEndpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok || !response.body) {
    throw new Error(`Azure Foundry request failed: ${response.status} ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let firstChunkMs = null;
  let firstTokenMs = null;
  let usage = null;
  let finishReason = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    if (firstChunkMs === null) {
      firstChunkMs = performance.now() - start;
      onProgress?.({
        provider: 'azure_foundry',
        model,
        stage: 'connected',
        elapsedMs: Number(firstChunkMs.toFixed(2)),
        message: 'Erster Streaming-Chunk eingetroffen'
      });
    }

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/u);
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const lines = part.split('\n').map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        try {
          const event = JSON.parse(payload);
          const deltaText = event?.choices?.[0]?.delta?.content;
          if (typeof deltaText === 'string' && deltaText.length > 0) {
            if (firstTokenMs === null) {
              firstTokenMs = performance.now() - start;
              onProgress?.({
                provider: 'azure_foundry',
                model,
                stage: 'first_token',
                elapsedMs: Number(firstTokenMs.toFixed(2)),
                message: 'Erstes sichtbares Token'
              });
            }
            text += deltaText;
          }

          if (event?.usage) usage = event.usage;
          const reason = event?.choices?.[0]?.finish_reason;
          if (reason) finishReason = reason;
        } catch {
          // ignore malformed chunks
        }
      }
    }
  }

  const totalMs = performance.now() - start;
  onProgress?.({
    provider: 'azure_foundry',
    model,
    stage: 'completed',
    elapsedMs: Number(totalMs.toFixed(2)),
    message: 'Antwort vollständig'
  });

  const estimatedVisibleTokens = estimateVisibleTokens(text);
  const outputTokens = usage?.completion_tokens
    ?? (estimatedVisibleTokens > 0 ? estimatedVisibleTokens : null);
  const billedOutputTokens = outputTokens;
  const tokensPerSecond = outputTokens && totalMs > 0
    ? Number((outputTokens / (totalMs / 1000)).toFixed(2))
    : null;

  return {
    text: text.trim() || '[No text returned]',
    metrics: {
      ttftMs: firstChunkMs ? Number(firstChunkMs.toFixed(2)) : null,
      firstTokenMs: firstTokenMs ? Number(firstTokenMs.toFixed(2)) : null,
      totalLatencyMs: Number(totalMs.toFixed(2)),
      postTtftLatencyMs: firstChunkMs ? Number((totalMs - firstChunkMs).toFixed(2)) : null,
      generationMs: firstTokenMs ? Number((totalMs - firstTokenMs).toFixed(2)) : null,
      tokensPerSecond,
      inputTokens: usage?.prompt_tokens ?? null,
      outputTokens,
      billedOutputTokens,
      finishReason: finishReason ?? 'completed',
      thinkingBudget: reasoningEffort,
      streamingEnabled: true
    }
  };
}
