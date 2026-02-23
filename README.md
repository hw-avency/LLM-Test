# LLM Performance Vergleich

Kleine Web-App mit Chat UI zur Messung von LLM-Performance für:

- OpenAI (`gpt-5.2`)
- Gemini (`gemini-3-flash`)
- Azure AI Foundry (`gpt-5.2`, via Azure Deployment)

## Start

1. `.env.example` nach `.env` kopieren und API Keys setzen.
2. Starten:

```bash
npm start
```

3. Öffnen: `http://localhost:3000`


## Azure AI Foundry (GPT-5.2)

Für den dritten Vergleichskanal (GPT-5.2 über Microsoft Foundry/Azure) setze in `.env`:

```bash
AZURE_FOUNDRY_ENDPOINT=https://<dein-resource-name>.openai.azure.com
AZURE_FOUNDRY_API_KEY=<dein-key>
AZURE_FOUNDRY_DEPLOYMENT=<deployment-name>
AZURE_FOUNDRY_MODEL=gpt-5.2
AZURE_FOUNDRY_API_VERSION=2024-10-21
```

Hinweis: `AZURE_FOUNDRY_MODEL` dient primär als Anzeige in der UI; geroutet wird über `AZURE_FOUNDRY_DEPLOYMENT`.

## Gemessene Kennzahlen

- **TTFT (ms)**: Zeit bis zum ersten Token
- **Gesamtlatenz (ms)**: volle End-to-End-Dauer
- **Zeit nach TTFT (ms)**: Rest der Latenz nach dem ersten Chunk (`Gesamtlatenz - TTFT`)
- **Erstes sichtbares Token (ms)**: Zeitpunkt, an dem wirklich Text sichtbar wird
- **Generierungszeit (ms)**: Zeit vom ersten sichtbaren Token bis zum Ende
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

## Live-Timeline ("TTFT spürbar machen")

Die UI zeigt pro Provider jetzt live vier Phasen an:

1. Start
2. Erster Streaming-Chunk (TTFT)
3. Erstes sichtbares Token
4. Fertig

So wird der Bereich zwischen TTFT und Gesamtlatenz sichtbar: typischerweise Modell-Generierung, Token-Ausgabe und ggf. Reasoning-Overhead.
