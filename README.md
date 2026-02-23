# LLM Performance Vergleich

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
- **Input Tokens** (falls vom Provider geliefert)
- **Output Tokens (sichtbar)**: geschätzte Tokens der angezeigten Antwort
- **Output Tokens (gesamt)**: vom Provider abgerechnete Output-Tokens (kann höher sein, z. B. wegen interner Reasoning-Tokens)

## Gemini Thinking / TTFT

- Über `GEMINI_THINKING_BUDGET` kannst du den Denk-Budget-Wert setzen.
- `GEMINI_THINKING_BUDGET=0` deaktiviert Thinking und liefert i.d.R. die niedrigste TTFT.
- Wenn der Wert leer/ungesetzt ist, nutzt Gemini den Provider-Default.

Beispiel `.env`:

```bash
GEMINI_MODEL=gemini-3-flash-preview
GEMINI_THINKING_BUDGET=0
```
