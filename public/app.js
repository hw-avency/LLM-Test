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
  outputTokens: 'Output Tokens',
  finishReason: 'Finish Reason',
  thinkingBudget: 'Thinking Budget'
};

const providerOrder = ['openai', 'gemini'];

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  sendBtn.disabled = true;
  promptInput.disabled = true;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        thinkingMode: thinkingModeSelect.value
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Gateway request failed');
    }

    renderResults(prompt, payload.results || []);
    promptInput.value = '';
  } catch (error) {
    renderError(error.message);
  } finally {
    sendBtn.disabled = false;
    promptInput.disabled = false;
    promptInput.focus();
  }
});

function renderResults(prompt, results) {
  resultsGrid.innerHTML = '';

  providerOrder.forEach((provider) => {
    const providerResult = results.find((result) => result.provider === provider);
    const card = document.createElement('article');
    card.className = 'result-card';

    const title = document.createElement('h2');
    title.textContent = provider.toUpperCase();

    const model = document.createElement('p');
    model.className = 'model';
    model.textContent = providerResult?.model || 'n/a';

    const promptBlock = document.createElement('div');
    promptBlock.className = 'bubble user';
    promptBlock.textContent = prompt;

    const answerBlock = document.createElement('div');
    answerBlock.className = `bubble assistant ${providerResult?.error ? 'error' : ''}`;
    answerBlock.textContent = providerResult?.response || 'Keine Antwort';

    const metrics = document.createElement('dl');
    renderMetrics(metrics, providerResult?.metrics);

    card.append(title, model, promptBlock, answerBlock, metrics);
    resultsGrid.appendChild(card);
  });
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
