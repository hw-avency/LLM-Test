# Mini LLM Gateway

Kleine Web-App mit Chat UI zur Messung von LLM-Performance für:

- OpenAI (`gpt-5.2`)
- Gemini (`gemini-3-flash`)

## Start

1. `.env.example` nach `.env` kopieren und API Keys setzen.
2. Starten:

```bash
npm start
```

3. Öffnen: `http://localhost:3000`

## Gemessene Kennzahlen

- **TTFT (ms)**: Zeit bis zum ersten Token
- **Gesamtlatenz (ms)**: volle End-to-End-Dauer
- **Tokens / Sekunde**: effektiver Output-Durchsatz
- **Input / Output Tokens** (falls vom Provider geliefert)
