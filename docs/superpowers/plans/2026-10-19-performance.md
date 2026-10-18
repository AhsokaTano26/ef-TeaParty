# Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce state read CPU, frontend transfer and avoidable rendering while preserving behavior.

**Architecture:** Owned typed state copies and targeted public snapshots; precompressed hashed assets and lossless image derivatives; split frontend entry/editor bundles; conditional clocks and revision-based configuration reuse; generation-scoped stream request coalescing.

**Tech Stack:** Go standard library, React 19, Vite 6, Node built-in tests.

**Spec:** `docs/superpowers/specs/2026-10-19-performance.md`

## Global Constraints

- Keep activity behavior, data format, privacy boundaries and media synchronization unchanged.
- Preserve atomic durable writes; no new runtime dependencies.
- No browser access; no modification of live data or running demos.

## Review Focus

- Nested snapshot/media pointers must not mutate store data or race with actions.
- Hidden answers and delayed lottery reveal remain private.
- Encoded static responses obey negotiation, HEAD, Range and cache rules.
- Configuration edits and out-of-order live responses cannot become stale.
- Concurrent playback cancellation and account changes cannot leak an old stream.

### Task 1: State read path

**Files:** `internal/party/{store.go,clone.go,performance_test.go}`, `internal/server/server.go`.
**Interfaces:** Existing `Snapshot() State`, `Public() PublicState`, internal `clone(State) State` remain unchanged.

- [ ] Establish 72/500 page Snapshot/Public benchmarks and clean suite baseline.
- [ ] Add ownership, privacy and concurrent read regression checks; assert public read allocations stay bounded as hidden bank grows.
- [ ] Replace JSON copying, build only owned public fields under RLock, aggregate scores once; avoid unused public computation for admin SSE.
- [ ] Verify race tests and rerun benchmarks; commit.

### Task 2: Asset delivery and loading

**Files:** `internal/server/static.go`, `internal/server/static_test.go`, `web/vite.config.ts`, `web/build/compress.mjs`, `web/src/{main,App}.tsx`, `web/scripts/check-build.mjs`, `web/src/assets/*.webp`, `web/src/assets/logo/*.webp`.
**Interfaces:** Existing URLs and MIME types; `.gz` artifacts beside emitted JS/CSS; Vite manifest for measuring route closures.

- [ ] Write API tests for encoding negotiation, immutable caching, HEAD/Range, HTML and missing files; verify new expectations fail.
- [ ] Convert six used built-in PNGs to WebP with exact decoded RGBA equality; retain originals.
- [ ] Precompress at build time, serve safe hashed assets with caching and negotiated gzip; lazy load admin route and editor tabs.
- [ ] Run build and validate manifest import closures exclude editors from projection startup; compare transferred bytes; commit.

### Task 3: Frontend updates

**Files:** `web/src/{Host,Stage}.tsx`, `web/src/playback.ts`, `web/src/api.ts`, `web/src/useNow.ts`, JS tests.
**Interfaces:** `acceptLiveState` still rejects stale revisions; matching configRevision reuses configuration; active clocks retain 200ms cadence.

- [ ] Test same-config identity reuse, config edits and stale responses; add deadline/idle scheduling checks.
- [ ] Stop idle clocks, memoize preview public data, only retain media duration needed by host, stabilize preview callbacks and memoize Stage.
- [ ] Run all JS tests and typecheck; preserve media sync loop and timer alerts; commit.

### Task 4: Concurrent music resolution

**Files:** `internal/netease/service.go`, `internal/netease/service_test.go`.
**Interfaces:** `Resolve(context.Context,string) (Stream,error)` unchanged; in-flight work keyed by song and account generation.

- [ ] Test simultaneous requests share upstream work, waiter cancellation, error retry and account replacement.
- [ ] Implement bounded lifetime in-flight coalescing; keep existing cache invalidation and account checks.
- [ ] Run race tests and report upstream call reduction; commit.

### Task 5: Verification and review

- [ ] Run complete make test/build, comparative benchmarks and compressed asset smoke checks on temporary fixtures.
- [ ] Request independent whole-diff review; fix material findings with regression tests.
- [ ] Save measurements/limitations, commit and integrate locally per the user's existing local-main preference; no push.
