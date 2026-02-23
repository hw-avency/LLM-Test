const chatForm = document.getElementById('chatForm');
const promptInput = document.getElementById('promptInput');
const sendBtn = document.getElementById('sendBtn');
const resultsGrid = document.getElementById('resultsGrid');
const thinkingModeSelect = document.getElementById('thinkingMode');

const metricLabels = {
  ttftMs: 'TTFT (ms)',
  firstTokenMs: 'Erstes sichtbares Token (ms)',
  totalLatencyMs: 'Gesamtlatenz (ms)',
  postTtftLatencyMs: 'Zeit nach TTFT (ms)',
  generationMs: 'Generierungszeit (ms)',
  tokensPerSecond: 'Tokens / Sekunde',
  inputTokens: 'Input Tokens',
  outputTokens: 'Output Tokens (sichtbar)',
  billedOutputTokens: 'Output Tokens (gesamt)',
  finishReason: 'Finish Reason',
  thinkingBudget: 'Thinking Budget',
  streamingEnabled: 'Streaming'
};

const providerLabels = new Map();
let providerOrder = ['openai', 'gemini', 'azure'];

initializeProviders();

async function initializeProviders() {
  try {
    const response = await fetch('/api/models');
    if (!response.ok) return;

    const models = await response.json();
    if (!Array.isArray(models) || models.length === 0) return;

    providerOrder = models
      .map((entry) => (typeof entry?.id === 'string' ? entry.id : null))
      .filter(Boolean);

    models.forEach((entry) => {
      if (typeof entry?.id !== 'string') return;
      providerLabels.set(entry.id, entry?.label || entry.id.toUpperCase());
    });
  } catch {
    // fallback to default provider order
  }
}

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  sendBtn.disabled = true;
  promptInput.disabled = true;

  const cards = renderPendingResults(prompt);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        thinkingMode: thinkingModeSelect.value
      })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Gateway request failed');
    }

    if (!response.body) {
      throw new Error('Streaming wird von diesem Browser nicht unterstützt.');
    }

    await consumeStream(response.body, cards);
    promptInput.value = '';
  } catch (error) {
    renderError(error.message);
  } finally {
    sendBtn.disabled = false;
    promptInput.disabled = false;
    promptInput.focus();
  }
});

async function consumeStream(stream, cards) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    lines.forEach((line) => processStreamLine(line, cards));
  }

  const tail = buffer.trim();
  if (tail) processStreamLine(tail, cards);
}

function processStreamLine(line, cards) {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const message = JSON.parse(trimmed);
    if (message.type === 'result') {
      updateProviderCard(cards, message.result);
    }

    if (message.type === 'progress') {
      updateProviderProgress(cards, message.progress);
    }
  } catch {
    // ignore malformed chunks
  }
}

function renderPendingResults(prompt) {
  resultsGrid.innerHTML = '';
  const cards = new Map();

  providerOrder.forEach((provider) => {
    const card = document.createElement('article');
    card.className = 'result-card';

    const title = document.createElement('h2');
    title.textContent = providerLabels.get(provider) || provider.toUpperCase();

    const model = document.createElement('p');
    model.className = 'model';
    model.textContent = 'Warte auf Antwort ...';

    const timeline = document.createElement('ul');
    timeline.className = 'timeline';
    ['started', 'connected', 'first_token', 'completed'].forEach((stage) => {
      const step = document.createElement('li');
      step.dataset.stage = stage;
      step.innerHTML = `<span class="dot" aria-hidden="true"></span><span class="label">${stageLabel(stage)}</span><span class="time">–</span>`;
      timeline.appendChild(step);
    });

    const promptBlock = document.createElement('div');
    promptBlock.className = 'bubble user';
    promptBlock.textContent = prompt;

    const answerBlock = document.createElement('div');
    answerBlock.className = 'bubble assistant loading';
    answerBlock.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Lade Antwort ...</span>';

    const metrics = document.createElement('dl');
    renderMetrics(metrics, null);

    card.append(title, model, timeline, promptBlock, answerBlock, metrics);
    resultsGrid.appendChild(card);

    cards.set(provider, { model, timeline, answerBlock, metrics });
  });

  return cards;
}

function updateProviderProgress(cards, progress) {
  const cardElements = cards.get(progress?.provider);
  if (!cardElements) return;

  const step = cardElements.timeline.querySelector(`[data-stage="${progress.stage}"]`);
  if (!step) return;

  step.classList.add('done');
  const time = step.querySelector('.time');
  time.textContent = `${Number(progress.elapsedMs ?? 0).toFixed(2)} ms`;
}

function updateProviderCard(cards, providerResult) {
  const cardElements = cards.get(providerResult.provider);
  if (!cardElements) return;

  cardElements.model.textContent = providerResult?.model || 'n/a';
  cardElements.answerBlock.className = `bubble assistant ${providerResult?.error ? 'error' : ''}`;
  cardElements.answerBlock.textContent = providerResult?.response || 'Keine Antwort';

  renderMetrics(cardElements.metrics, providerResult?.metrics);
}

function renderMetrics(container, metrics) {
  container.innerHTML = '';

  Object.entries(metricLabels).forEach(([key, label]) => {
    const dt = document.createElement('dt');
    dt.textContent = label;

    const dd = document.createElement('dd');
    const value = metrics?.[key];
    dd.textContent = value === null || value === undefined ? 'n/a' : String(value);

    container.append(dt, dd);
  });
}

function stageLabel(stage) {
  return {
    started: 'Start',
    connected: 'Erster Chunk (TTFT)',
    first_token: 'Erstes sichtbares Token',
    completed: 'Fertig'
  }[stage] || stage;
}

function renderError(message) {
  resultsGrid.innerHTML = '';
  const card = document.createElement('article');
  card.className = 'result-card';

  const title = document.createElement('h2');
  title.textContent = 'Fehler';

  const body = document.createElement('div');
  body.className = 'bubble assistant error';
  body.textContent = message;

  card.append(title, body);
  resultsGrid.appendChild(card);
}
