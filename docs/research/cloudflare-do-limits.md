# Cloudflare Workers + Durable Objects — verified limits and pricing (2026-09-13)

Verified against live Cloudflare docs by a research pass on 2026-09-13. Quotes are from the docs; pages last updated Apr–Aug 2026. Use this when weighing a Durable-Object-per-chat-room architecture for ChatterED.

## 1. Durable Object alarms
- API: `ctx.storage.setAlarm(Date|number)`, `getAlarm()`, `deleteAlarm()`; handler `async alarm(alarmInfo)` with `retryCount`, `isRetry`.
- **One alarm per DO** at a time; a second `setAlarm` overrides. Fan-out pattern: store a schedule in storage, `alarm()` processes due events and reschedules.
- Timing: ms granularity, "usually execute within a few milliseconds after the set time, but can be delayed by up to a minute due to maintenance or failures while failover takes place". Fine for a ~60 s silence timer if the UI shows a countdown client-side and the server is authoritative.
- At-least-once execution; auto-retry on throw, exponential backoff from 2 s, up to 6 retries. Catch and reschedule yourself for indefinite retry.
- No documented minimum (past-time alarms fire immediately) and **no documented maximum horizon**.
- Alarms wake hibernated/evicted DOs; constructor re-runs first. Alarm handler wall-time cap 15 min.
- Billing: each alarm invocation = 1 request; each `setAlarm()` = 1 row written.
- Compat date ≥ 2026-02-24: `deleteAll()` also deletes the active alarm.

## 2. DO SQLite storage limits
| Limit | Value |
|---|---|
| Storage per DO | 10 GB (Paid); Free per-object figure is inconsistent in docs (10 GB in table vs 1 GB in FAQ) |
| Storage per account | Unlimited (Paid) / 5 GB (Free) |
| Key+value, row, string/BLOB | 2 MB |
| SQL statement | 100 KB; 100 bound params; 100 columns/table |
| WebSocket message (received) | 32 MiB |
| Simultaneous outgoing connections/request | 6 (only while awaiting headers) |
- Free plan: only SQLite-backed DOs. Over-limit writes fail with `SQLITE_FULL`; reads/deletes still work.

## 3. WebSocket Hibernation API
- Use `ctx.acceptWebSocket(ws, tags?)`; handlers `webSocketMessage/Close/Error`. DO can be evicted while clients stay connected.
- **Duration charges do not accrue during hibernation.** Non-hibernating `ws.accept()` bills for the whole connection.
- Max 32,768 hibernatable sockets per DO; ≤10 tags of ≤256 chars each; `getWebSockets(tag)`.
- `setWebSocketAutoResponse` (req/res ≤ 2048 chars) answers pings without waking. Protocol ping/pong doesn't wake.
- `ws.serializeAttachment()` ≤ 16,384 bytes survives hibernation; in-memory state does not.
- **Alarms, requests, setTimeout/setInterval all prevent hibernation.** A periodic alarm defeats hibernation savings; idle→hibernate after 10 s.
- Outbound WebSockets never hibernate and keep the DO alive up to 15 min.

## 4. Pricing (Aug 2026 docs)
Compute: Free 100k req/day + 13k GB-s/day. Paid: 1M req/mo included then $0.15/M; 400k GB-s/mo then $12.50/M GB-s. Incoming WebSocket messages billed at 20:1. Duration bills 128 MB regardless of usage.
SQLite: Free 5M rows read/day, 100k rows written/day, 5 GB. Paid: 25B reads/mo then $0.001/M; 50M writes/mo then $1.00/M; 5 GB-mo then $0.20/GB-mo. Storage billing banner says "will be enabled Jan 2026" — assume live.
Workers Paid base: $5/mo minimum; 10M req/mo then $0.30/M; 30M CPU-ms then $0.02/M; no egress charges.
Worked example (docs Example 4): 100 DOs × 100 hibernating sockets, 1 msg/client/min ≈ **$20.65/mo** vs **$142.95/mo** non-hibernating (Example 2).

## 5. Runtime limits relevant to streaming LLM calls from a DO
- CPU: DO default 30 s per invocation (raise to 5 min via `limits.cpu_ms`); each incoming request/WS message resets it. I/O wait doesn't count.
- Wall clock: unlimited while a caller stays connected. A 30–120 s streamed fetch to an LLM API is allowed and consumes ~no CPU.
- Subrequests: Free 50, Paid 10,000/invocation. The 6-connection cap applies only while waiting for headers, so it does not cap concurrent LLM streams.
- Memory 128 MB per isolate. `waitUntil` ≤ 30 s after response; docs say don't use it to keep a DO alive.
- In-flight streaming fetch keeps the DO in memory and billable. On runtime redeploy, WebSockets are terminated — clients must reconnect and resume.

## 6. Input/output gates
Storage ops pause delivery of other events (input gate) and writes aren't visible until durable (output gate), so read-then-write sequences without intervening I/O are atomic without explicit transactions. `allowConcurrency: true` opts out; `blockConcurrencyWhile` (30 s cap).

## 7. Event-log sink options for the research study
- **D1**: 10 GB/db Paid (500 MB Free); 1000 queries/invocation Paid; 30 s query cap; storage $0.75/GB-mo (vs $0.20 for DO SQLite); rows read/written priced like DO SQLite. Writing from a DO to D1 via binding works but each write is a subrequest that blocks hibernation — batch, or write from the calling Worker.
- **Workers Analytics Engine**: 10M data points/mo included then $0.25/M (currently not billed); ≤20 blobs/20 doubles/1 index per point; 250 points per invocation; **3-month retention** — unsuitable as the sole archive for a longitudinal study.
- **Pipelines → R2**: ingress free; sinks 50 GB/mo included; R2 $0.015/GB-mo, egress free. Best unbounded archive (Parquet, queryable).
- Recommendation shape: DO SQLite for per-room transcript state; D1 or Pipelines→R2 for cross-participant analysis; AE only for live telemetry.

## 8. Data residency (matters for an NUS study)
- Jurisdictions are only `eu`, `us`, `fedramp`. **No Singapore/APAC jurisdiction** — no hard residency guarantee.
- Location hints are best-effort: `OBJECT_NAMESPACE.get(id, { locationHint: "apac-se" })` (also `apac`, `apac-ne`). Only the first `get()` honours the hint; DOs don't move after creation.
- Even under a jurisdiction, DurableObjectIds are logged elsewhere for billing/debugging.
- If the ethics review requires data to stay in Singapore, DOs cannot contractually guarantee it; consider a Singapore-region VPS/DB for the study instead.

## Flagged as unverified / inconsistent in the docs
1. Alarm maximum delay not documented.
2. DO Free-plan per-object storage: 10 GB vs 1 GB in the same page.
3. SQLite storage billing banner is stale.
4. Analytics Engine billing not yet enforced.
5. "Write from a DO to D1" is implied by binding availability, not stated verbatim.
6. D1 vs DO SQLite storage rate differ despite "intended to be identical" (that claim covers row ops only).
