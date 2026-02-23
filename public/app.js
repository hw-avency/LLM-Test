const modelSelect = document.getElementById('modelSelect');
const chatWindow = document.getElementById('chatWindow');
const chatForm = document.getElementById('chatForm');
const promptInput = document.getElementById('promptInput');
const sendBtn = document.getElementById('sendBtn');
const metricsList = document.getElementById('metrics');

const metricLabels = {
  ttftMs: 'TTFT (ms)',
  totalLatencyMs: 'Gesamtlatenz (ms)',
  tokensPerSecond: 'Tokens / Sekunde',
  inputTokens: 'Input Tokens',
  outputTokens: 'Output Tokens'
};

init();

async function init() {
  const response = await fetch('/api/models');
  const models = await response.json();

  models.forEach((model) => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.label;
    modelSelect.appendChild(option);
  });
}

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  pushMessage('user', prompt);
  promptInput.value = '';
  sendBtn.disabled = true;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelSelect.value, prompt })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Gateway request failed');
    }

    pushMessage('assistant', payload.response);
    renderMetrics(payload.metrics);
  } catch (error) {
    pushMessage('assistant', `Fehler: ${error.message}`);
  } finally {
    sendBtn.disabled = false;
  }
});

function pushMessage(role, content) {
  const message = document.createElement('article');
  message.className = `message ${role}`;
  message.textContent = content;
  chatWindow.appendChild(message);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function renderMetrics(metrics) {
  metricsList.innerHTML = '';

  Object.entries(metricLabels).forEach(([key, label]) => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    const value = metrics[key];
    dd.textContent = value === null || value === undefined ? 'n/a' : String(value);

    metricsList.appendChild(dt);
    metricsList.appendChild(dd);
  });
}
