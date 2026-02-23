# Mini LLM Gateway

Kleine Web-App mit Chat UI zur Messung von LLM-Performance für:

- OpenAI (`gpt-5.2`)
- Gemini (`gemini-3-flash`)

## Lokal starten

1. `.env.example` nach `.env` kopieren und API Keys setzen.
2. Starten:

```bash
npm start
```

3. Öffnen: `http://localhost:3000`

## Google Cloud Run (ohne zusätzliche Build-Konfiguration)

Die App ist Cloud-Run-ready:

- liest automatisch `PORT` (Cloud Run setzt diesen Wert)
- startet direkt mit `node server.js`
- enthält ein `Dockerfile` für direkten Container-Deploy

### Option A: Direkt aus Source deployen

```bash
gcloud run deploy mini-llm-gateway \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --set-env-vars OPENAI_API_KEY=YOUR_OPENAI_KEY,GEMINI_API_KEY=YOUR_GEMINI_KEY,OPENAI_MODEL=gpt-5.2,GEMINI_MODEL=gemini-3-flash
```

## Gemessene Kennzahlen

- **TTFT (ms)**: Zeit bis zum ersten Token
- **Gesamtlatenz (ms)**: volle End-to-End-Dauer
- **Tokens / Sekunde**: effektiver Output-Durchsatz
- **Input / Output Tokens** (falls vom Provider geliefert)
