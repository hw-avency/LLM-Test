const chatForm = document.getElementById('chatForm');
const promptInput = document.getElementById('promptInput');
const sendBtn = document.getElementById('sendBtn');
const resultsGrid = document.getElementById('resultsGrid');
const thinkingModeSelect = document.getElementById('thinkingMode');

const metricLabels = {
  ttftMs: 'TTFT (ms)',
  totalLatencyMs: 'Gesamtlatenz (ms)',
  tokensPerSecond: 'Tokens / Sekunde',
  inputTokens: 'Input Tokens',
  outputTokens: 'Output Tokens (sichtbar)',
  billedOutputTokens: 'Output Tokens (gesamt)',
  finishReason: 'Finish Reason',
  thinkingBudget: 'Thinking Budget',
  streamingEnabled: 'Streaming'
};

const providerOrder = ['openai', 'gemini'];

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

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const message = JSON.parse(trimmed);
        if (message.type === 'result') {
          updateProviderCard(cards, message.result);
        }
      } catch {
        // ignore malformed chunk
      }
    });
  }

  const tail = buffer.trim();
  if (!tail) return;

  try {
    const message = JSON.parse(tail);
    if (message.type === 'result') {
      updateProviderCard(cards, message.result);
    }
  } catch {
    // ignore malformed tail
  }
}

function renderPendingResults(prompt) {
  resultsGrid.innerHTML = '';
  const cards = new Map();

  providerOrder.forEach((provider) => {
    const card = document.createElement('article');
    card.className = 'result-card';

    const title = document.createElement('h2');
    title.textContent = provider.toUpperCase();

    const model = document.createElement('p');
    model.className = 'model';
    model.textContent = 'Warte auf Antwort ...';

    const promptBlock = document.createElement('div');
    promptBlock.className = 'bubble user';
    promptBlock.textContent = prompt;

    const answerBlock = document.createElement('div');
    answerBlock.className = 'bubble assistant loading';
    answerBlock.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Lade Antwort ...</span>';

    const metrics = document.createElement('dl');
    renderMetrics(metrics, null);

    card.append(title, model, promptBlock, answerBlock, metrics);
    resultsGrid.appendChild(card);

    cards.set(provider, { model, answerBlock, metrics });
  });

  return cards;
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
