# BYOK providers — the decisions (25 Sep 2026)

Extends #19 (the Claude CLI backend) and #15 (per-learner keys). Code: `app/src/main/llm/backend.ts`,
`providers.ts`, `providerservice.ts`; clients in `app/src/room/llm/`. Status table: `app/docs/STATUS.md`.

1. **The local Claude CLI stays the recommended default.** It costs the learner nothing per token,
   needs no key, and is what every prompt in this app was written and measured against
   (`whole-file-context.md`). Bring-your-own-key is the fallback, not a peer.
2. **Order under `auto`:** CLI (installed and signed in) → the learner's *preferred* API provider,
   if configured → the first configured of **Anthropic, OpenAI, Gemini, OpenAI-compatible** →
   scripted. Anthropic leads the fixed order because the prompts target Claude and existing
   installs already hold that key; the compatible endpoint is last because it could be anything.
3. **A forced provider that cannot run lands on scripted, with the reason — never on a different
   paid provider.** Silently billing a key the learner did not pick is the failure this prevents.
   (Forcing the CLI still falls to the API chain, as it did to the Anthropic key before.)
4. **Model defaults:** both roles on the provider's mid tier (GPT-6 Sol, Gemini 3.8 Flash); the
   API plan's Haiku-for-agents split stays Anthropic-only. Fable is refused on every provider.
5. **Cost honesty:** list prices are transcribed with their date; a model not on the card is
   priced at zero *and flagged*, shown as "cost unknown" — never invented at Sonnet rates, never
   shown as free.
6. **Where a key may go:** each key only to its own provider; a compatible endpoint must be
   `https://`, with plain `http://` only for loopback (Ollama, LM Studio on this Mac).
