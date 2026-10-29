# Tasks — 067 comparative follow-up

## A — root cause

- [x] **T6701** Re-read 066's research and the comparative DAG path; capture the 13:54Z beta turn
  (`chat-sse2.json`): 18 351 ms, text only, `_COMPARATIVE_FALLBACK`, gap “verified material on
  both”, no citation.
- [x] **T6702** Show the fallback gap implies `covered` contained both subjects, so retrieval is
  not the failure; the replacement is post-retrieval.
- [x] **T6703** Reproduce offline with realistic fake LLM answers: a concise (209-char) substantive
  declining opening is classified non-answer by the 066 length/marker test; a 297-char variant is
  served but uncitable because `_answer_can_cite` rejects any decline opening. Record the
  second possible false positive (`the information available to me` → META) in `research.md`.
- [x] **T6704** Confirm the five OH Defender notes (coverage, deictic, curly apostrophes, grammar
  words, blunt classifier) against the code.

## B — fix

- [x] **T6705** `_comparative_substantive_clauses` / `_comparative_has_substance` /
  `_is_comparative_non_answer(answer, names)` — classify by substance, not length/markers.
- [x] **T6706** `_answer_can_cite` — substantive declining openings may cite; deictic turns keep
  065 behaviour; non-comparative turns keep 029.
- [x] **T6707** `_ground_comparative` — whole-message hits that name a subject count as coverage;
  rebuild `covered` in message order.
- [x] **T6708** Coverage hint + `COMPARATIVE_RULE`: if the data cannot rank, say so once and still
  compare the risk factors.
- [x] **T6709** `comparative_outcome subjects=%d covered=%d reason=%s cited=%s` INFO line at every
  comparative replacement/serve point; no message/model text.
- [x] **T6710** `guard_text.py` verb patterns accept curly apostrophes.
- [x] **T6711** `comparative.py` grammar-word filter is case-insensitive and covers all-caps /
  interrogative forms.

## C — tests

- [x] **T6712** End-to-end offline regressions, streaming on and off: declining-opening substantive
  answer served + cited (long/short); pure decline still replaced + uncited; whole-message coverage;
  deictic citation; outcome log.
- [x] **T6713** Unit tests: classifier both ways (named and deictic), curly-apostrophe guard,
  grammar-word extractor.
- [x] **T6714** Fail-before/pass-after against an `origin/main` (066) archive checkout
  (**14 failed, 2 passed** on base; 73 passed on 067).
- [x] **T6715** Full suite + `ruff check` + `mypy`; report the 12 pre-existing
  `test_vault_reader` forge-artifact failures.

## D — release

- [x] **T6716** `CHANGELOG.md` top entry + newest-first `content_seed/whats-new.json` entry
  (2026-10-29).
- [x] **T6717** Commit, push, PR to `main` (`fix(067): …`).
- [x] **T6718** Cherry-pick to `~/project/sparkpoint-pivot-067-dev` (`origin/develop`), resolve the
  two release-note files keeping both newest-first, run touched tests + ruff/mypy, push and open
  the develop PR.
