# Phase 0 — Research: daily self-authoring

Nine client decisions and the planning research (artifact `4cbcb408`) settled most of this feature
before the plan started. What follows are the six questions that were genuinely open, and what the
codebase or the evidence decided.

---

## R1 — How does a document get rewritten without the corpus growing?

**Decision**: Reuse `knowledge/ingestion.py::ingest_note` with a stable per-document `source` slug.

**Rationale**: Chunk ids are `uuid5(source, chunk_index)` and `prune_source` removes anything the
new text no longer produces. So re-ingesting `self-authored-base-usdc-yields` replaces exactly its
own chunks, and a document that shrinks loses its orphans. This is the same mechanism 033 verified
against the live database: `indexed=2 unchanged=38`, then `indexed=0 unchanged=40`.

**Alternatives considered**: A new table and a bespoke upsert. Rejected — it would duplicate the
pruning logic, and the existing path is already proven idempotent in production.

**Consequence for the design**: the six document slugs are constants, not generated. A generated
slug would silently create a seventh document.

---

## R2 — Which sources can actually answer for a testnet product?

**Decision**: Testnet truth comes only from chain reads. Mainnet benchmarks come from DeFiLlama and
Morpho. They are never mixed in one comparison.

**Evidence, gathered live on 2026-08-03**:

| Source | Testnet coverage | Verified |
|---|---|---|
| `chain/aave_rate.py` (84532) | Yes | Our vault reads **0.44% gross / 0.40% net** today |
| DeFiLlama yields | **None** | 15,758 pools, 101 chains, **zero** testnets |
| Morpho GraphQL | **None** | Rejects chainId 84532 outright — already documented in `data/morpho_api.py` |

Base **mainnet** for comparison: Aave v3 USDC **3.48%** (30-day mean 3.20, σ 0.128, $21.0M TVL);
managed USDC vaults **4.32–5.27%**.

**Rationale**: the identical strategy pays roughly **eight times more** on mainnet than on the
testnet the alpha runs on. A note written from web data would describe returns no alpha user can
get; a note written from testnet data would make the product look broken. Both are wrong, so every
figure states its chain in the sentence and the two are never presented as options.

**Alternatives considered**: Suppressing mainnet figures entirely. Rejected — "what this strategy
earns in the live market you'll be on at launch" is the single most useful true thing we can tell an
alpha tester, and decision 8 explicitly asked for that framing.

---

## R3 — How do we stop a good feature from silently degrading the answers we already have?

**Decision**: A fixed golden-question set, checked on every run *before* publishing. A run that
displaces the expected source for any of them is discarded whole.

**Rationale**: This is the operational form of the finding that shaped the spec — retrieval accuracy
falls as a corpus grows, and it fails silently. The literature on recursive self-improvement is
consistent that **self-verification** is what separates a loop that improves from one that decays.
The check is cheap: the same questions, the same expected sources, every day.

**The set** (expected source in brackets, all verbatim from what the corpus answers today):

| Question | Must still be answered by |
|---|---|
| How do I withdraw everything? | the deterministic exit route (029), never a document |
| What fees do you charge? | the fees knowledge document |
| What is the vault APY? | the deterministic APY route (029) |
| Is SparkPoint custodial? | the non-custody knowledge document |
| What is SparkPoint? | the product knowledge document |

**Alternatives considered**: Sampling production traffic and scoring it. Rejected for v1 — it needs
a judge model, it is not deterministic, and a test that can be flaky is a test nobody trusts to
block a publish.

**Consequence**: the check runs against a *staged* corpus. Documents are ingested, the questions are
re-asked, and if anything regressed the ingest is rolled back by re-ingesting the previous text.
This is the only part of the design that needs care about ordering, and it is called out in tasks.

---

## R4 — What actually stops "held findings" from becoming "only good news"?

**Decision**: Claims carry their evidence. A published document may not assert a claim whose
`contradicts` key matches a currently-held finding. The claim is dropped, and the omission is
recorded on the run.

**Rationale**: Decisions 5 and 7 are each reasonable and together they lean one way. Without a
mechanical guard, the published set drifts rosy — not by anyone falsifying anything, but by every
uncomfortable finding sitting in the console. The guard makes the document say *less*, never
something false, which is the only version of editorial control that survives a reader checking our
claims against DeFiLlama.

**Mechanism**: each claim declares a `topic` key (e.g. `fee_competitiveness`). A finding declares the
same key. While a finding with that key is `held`, claims with that key are withheld from the
published render. This is deliberately a *key match*, not semantic comparison — a model judging
whether two sentences contradict each other is exactly the kind of thing that fails quietly.

**Alternatives considered**: An LLM contradiction check. Rejected: non-deterministic, and it would
put a model in charge of whether the product tells the truth about itself.

---

## R5 — How is fetched prose kept from becoming instruction?

**Decision**: Prose evidence is stored with its attribution, never embedded, and passed to the writer
inside a delimited quotation block in the **user** turn — never the system prompt.

**Rationale**: Injecting a handful of documents into a RAG system can make it return attacker-chosen
answers over 90% of the time, and no model reliably separates instructions in its prompt from
instructions in retrieved text. 027 already established this exact boundary for a user's own words;
the same rule extends to a fetched page, which has strictly weaker provenance.

**Also decided here**:
- The allowlist is **empty by default**. An empty list means *fetch no prose*, never *fetch
  anything*. A misconfiguration therefore fails closed.
- Matching is on **host**, exact or a dot-suffix (`docs.aave.com` permits `docs.aave.com` but not
  `evil-docs.aave.com.attacker.io`). Scheme must be `https`. No redirects are followed across hosts.
- Fetched text is **truncated hard** and stripped of markup before storage, so a page cannot
  consume the writer's whole context.

**Alternatives considered**: Sanitising instruction-shaped text out of fetched prose. Rejected as
security theatre — there is no reliable filter for "this sentence is an instruction", and believing
there is would be worse than knowing there isn't.

---

## R6 — Where does the schedule live, and how do we stop it running twice?

**Decision**: A background asyncio loop started in `lifespan`, guarded by `pg_try_advisory_lock`.

**Rationale**: Both existing pollers (`notification_poller.py`, `vault_apy_poller.py`) already use
exactly this pattern, and `main.py` already warns when `WEB_CONCURRENCY > 1` because the LLM
concurrency limiter is per-process. Without the lock, every extra worker and every restart would run
the job again — and this job costs money on every run.

**Precedent to copy**: 033's `_index_changelog` — created with `asyncio.create_task`, never awaited
inline, wrapped so no exception can escape, cancelled on shutdown. A slow embedding provider awaited
during boot would fail the container healthcheck and take the agent down over a search index; the
same is true here, only more so.

**Cadence**: check every 30 minutes whether a run is due (24h since the last successful start);
actually run at most once a day. A tight loop would hammer the lock; a 24-hour sleep would mean a
restart resets the clock and the job might never run.

---

## Settled without research

These were fixed by client decision or by existing code, and are recorded so nobody re-opens them:

- **Living documents, not a diary** — decision 1, and the finding that drove the whole spec.
- **Six documents** — decision 3. Six is a ceiling.
- **Mode and draft window are settings, not constants** — decision 4.
- **Describe the landscape; never name a competitor product; still name Aave and Morpho** — decision 5.
- **Unflattering findings are held, not dropped** — decision 7.
- **Ship on the testnet alpha now** — decision 8.
- **The allowlist is console-editable and audit-logged** — decision 9.
- **`self_authored` source kind, its citation label, and migration 0034** — already shipped in 031.
- **Persona is not retrievable and does not participate** — 013, pinned by an existing test.
- **Topic selection uses classification signals only, never a user's words** — 027's boundary,
  restated as FR-042 because this feature is the first thing that would be tempted to break it.
