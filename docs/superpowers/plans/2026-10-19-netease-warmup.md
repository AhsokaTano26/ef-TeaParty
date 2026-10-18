# NetEase Warmup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import NetEase songs/playlists and play account-authorized full songs through existing synchronized warmup controls.

**Architecture:** Go owns activity state, private account persistence, login tasks, import pagination, URL caching and media streaming. A local Node process wraps a pinned community SDK over JSON lines, with no extra listener. React adds a warmup-only import/account panel and keeps the existing draft and playback pipeline.

**Tech Stack:** Go 1.24+, Node.js 22.18+, React 19, TypeScript, `@neteasecloudmusicapienhanced/api` 4.41.1 candidate.

**Spec:** `docs/superpowers/specs/2026-10-18-netease-warmup-design.md`

## Global Constraints

- Preserve existing local activity data; use temporary data for tests.
- Credentials live in `data/netease/account.json`, directory 0700/file 0600, outside public media and backups.
- Warmup media limit 500; other pages 30. Import modifies drafts only, deduplicating song IDs.
- Public audio is limited to currently visible media or the existing preload plan; admin can preview unsaved tracks.
- No permanent CDN URLs in state. Full-song availability must distinguish previews and unavailable songs.
- Node/SDK failures must leave existing local playback usable. No extra public API service or port.

## Review Focus

- A canceled or old QR result must not reconnect an account after logout: exercise in Task 2.
- Paging a large playlist must preserve selected tracks and avoid silently exceeding 500: exercise in Tasks 1 and 4.
- A failing CDN URL or redirect must never fetch private network addresses: exercise in Task 3.
- Restored online tracks must remain references and never carry login credentials: exercise in Task 3.
- Switching questions while an import is pending must never append to the new question: exercise in Task 4.

## Task 1: Stable sources and protocol adapter

**Files:** `internal/party/netease.go`, `internal/party/model.go`, `internal/party/validation.go`, `internal/party/netease_test.go`; `integrations/netease/{package.json,package-lock.json,bridge.cjs,bridge.test.cjs}`; `internal/netease/{bridge.go,bridge_test.go,types.go}`; `Makefile`.

**Interfaces:** `party.NeteaseSource{SongID string}` on `Media.Netease`; `party.NeteaseSongID(url string) string`; `netease.Caller.Call(context.Context, string, any, any) error`, `Close() error`, `Ready() error`; `netease.NewBridge(script string) *Bridge`.

- [ ] Write tests for stable URL/source validation, 500/30 limits, unknown-source rejection and legacy data; run `go test ./internal/party -run Netease`, expect failure until implemented.
- [ ] Implement the model and strict URL rules without widening unrelated local URLs; rerun the same tests, expect PASS.
- [ ] Write adapter tests for allowlisted operations, response correlation, timeout/cancellation and process exit; run `node --test integrations/netease/bridge.test.cjs` and `go test ./internal/netease`, expect RED.
- [ ] Implement bounded JSON-lines IPC, allowlisted SDK methods, sanitized errors and component readiness. Pin and lock the SDK dependency; include it in `make install`.
- [ ] Verify both adapter suites and party tests PASS; commit Task 1.

## Task 2: Account, import and availability service

**Files:** `internal/netease/{service.go,account.go,import.go,links.go,service_test.go,links_test.go}`.

**Interfaces:** `NewService(Caller, privateDir string) *Service`; `Status(ctx) (Status,error)`; `StartLogin(ctx, owner) (Login,error)`; `CheckLogin(ctx, owner, task) (Login,error)`; `CancelLogin(owner,task)`; `CancelOwner(owner)`; `Logout() error`; `Playlists(ctx,offset) (PlaylistPage,error)`; `Import(ctx,input,offset) (TrackPage,error)`; `Resolve(ctx,id) (Stream,error)`; `Invalidate(id)`.

- [ ] Test QR 800/801/802/803, owner isolation, generation changes, logout races and persisted file permissions using a deterministic SDK substitute. Run `go test ./internal/netease -run 'Login|Account'`, expect RED.
- [ ] Implement private atomic persistence, login expiry/cancellation, normalized account status, and no credential fields in public DTOs; rerun, expect PASS.
- [ ] Test canonical/hash/mobile links, sharing text, invalid hosts/IDs, playlist pagination, authenticated versus guest requests, full/preview/no-permission responses and URL expiry. Run service tests, expect RED for missing behavior.
- [ ] Implement link parsing, bounded short-link resolution, metadata normalization, user playlists and account-specific stream cache. Distinguish network errors from confirmed expired credentials.
- [ ] Verify `go test -race ./internal/netease` PASS; commit Task 2.

## Task 3: Server routes, streaming and archives

**Files:** `internal/server/{netease.go,netease_stream.go,netease_test.go,netease_stream_test.go,server.go,archive.go}`; `cmd/teaparty/main.go`; archive regression tests.

**Interfaces:** `server.WithNetease(*netease.Service) Option` extends `New(..., options ...Option)` compatibly; routes follow the spec. Stable audio route is `/api/netease/audio/{songId}`. Online-source recognition is shared through `party.NeteaseSongID`.

- [ ] Write route tests for authentication, task ownership, anonymous visible/preload-only audio and hidden-answer protection. Run `go test ./internal/server -run Netease`, expect RED.
- [ ] Implement routes, SDK lifecycle in main, and backend logout cleanup; verify routes PASS.
- [ ] Test HEAD, Range, failed/expired URLs, canceled requests, CDN host validation, private DNS targets and redirect validation. Use a controlled RoundTripper so tests never require external networking.
- [ ] Implement streaming with bounded memory and no account headers to CDN; refresh a rejected cached address once. Preserve existing media synchronization state.
- [ ] Add ZIP roundtrip tests showing online entries remain external, source IDs survive, and account files are absent; adapt external-reference handling without changing archive version.
- [ ] Verify `go test -race ./internal/server ./cmd/teaparty` PASS; commit Task 3.

## Task 4: Warmup import and account UI

**Files:** `web/src/{NeteasePanel.tsx,netease.ts,netease.css,Bank.tsx,types.ts,mediaPreflight.ts,Stage.tsx}`; `web/tests/netease.test.mjs`.

**Interfaces:** `NeteasePanel({media: Media[], onAdd:(media:Media[])=>void})`; pure `mergeNeteaseMedia(existing,selected)` enforces 500/deduplication; API requests take AbortSignals. `Media.netease?: {songId:string}` matches Go.

- [ ] Write behavior tests for import selection/deduplication/capacity, page batches, stable media DTOs, cancellation generations and availability-aware preflight. Run `node --test web/tests/netease.test.mjs`, expect RED.
- [ ] Implement pure helpers and typed requests; verify tests PASS.
- [ ] Add account status, QR login/cancel/refresh, account playlists, sharing-link import, selection and incremental paging. Stop polls on unmount/expiry, bind async responses to the selected question, and retain local draft isolation.
- [ ] Insert the panel only in warmup editing, reset its lifecycle on question changes, and use functional draft updates when adding tracks. Keep existing visual controls and themes; show source on imported tracks and useful playback errors.
- [ ] Update preflight to explain online eligibility and HTTP failures; keep audio/preload limits intact.
- [ ] Verify all web tests, typecheck and production build PASS; commit Task 4.

## Task 5: Integrated verification and handoff

**Files:** `README.md`, `docs/live-readiness.md`, approved spec status; fixes identified by verification.

- [ ] Run `make test` and `make build`; expect PASS. Any regression gets a failing reproduction before its fix.
- [ ] Start the updated server against a temporary activity, leaving the existing server/data alone. Verify real anonymous import, metadata and full audio retrieval where upstream permits; verify QR generation without authenticating on the user's behalf.
- [ ] Exercise the rendered warmup flow only through authorized computer/browser tooling; retain an explicit limitation if the previous browser-control denial remains in force.
- [ ] Have a fresh reviewer inspect the complete change against the spec and review-focus conditions, fix important findings with tests, then rerun affected suites.
- [ ] Document setup, supported links, login behavior, online backup limitations and remaining real-account acceptance. Commit, show the implementation and precise verification status to the user.
