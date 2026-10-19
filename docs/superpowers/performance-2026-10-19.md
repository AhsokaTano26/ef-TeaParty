# Performance measurements — 2026-10-19

Measured locally on Apple M4 Pro / darwin arm64. Baseline commit: `0b1cc94`.
These are repeatable synthetic fixtures, not browser rendering measurements.
72/500 pages contain five options, explanatory text, one image each, eight teams,
and four score records per page. Three 200ms benchmark runs; medians below.

```sh
go test ./internal/party -run '^$' -bench BenchmarkStateRead -benchmem -count 3 -benchtime=200ms
make test
make build
```

| Read path | Before | After | Allocations before → after |
| --- | ---: | ---: | ---: |
| Snapshot/72 | 648.74 µs | 9.46 µs | 1897 → 148 |
| Public/72 | 650.95 µs | 3.49 µs | 1903 → 13 |
| PublicJSON/72 | 650.47 µs | 5.57 µs | 1905 → 15 |
| Snapshot/500 | 4500.96 µs | 91.24 µs | 13048 → 1004 |
| Public/500 | 4531.24 µs | 21.83 µs | 13057 → 13 |
| PublicJSON/500 | 4474.60 µs | 24.11 µs | 13053 → 15 |

Public reads allocate about 2.2 KB for both fixture sizes, previously about
370 KB / 3.8 MB. They still scan page and score lists, so CPU scales with record
count. Atomic JSON persistence and fsync remain synchronous and unchanged.

Frontend baseline: the server sent the 499,078-byte main JS file without HTTP
compression. Build now records a Vite manifest, and the build checker verifies
that editor tabs are dynamic entries outside the projection/initial-host import
closure and every gzip file decodes exactly to its final JS/CSS original.

- Projection JS: 286,603 bytes uncompressed, 90,610 bytes with gzip (81.8% less transfer than baseline).
- Initial host JS: 423,692 bytes uncompressed, 136,969 bytes with gzip (72.6% less transfer than baseline).
- Immutable caching applies only to existing content-addressed build assets.
  HTML and API remain uncached; HEAD and byte ranges are regression-tested.
- Six built-in images use lossless WebP, verified identical when decoded to RGBA; embedded ICC color profile retained:
  - `web/src/assets/cqulogo.png`: 81,483 → 30,930 bytes.
  - `web/src/assets/cqu-ouyan-logo-transparent.png`: 807,647 → 451,336 bytes.
  - `web/src/assets/logo/cqutgtg.png`: 488,021 → 306,300 bytes.
  - `web/src/assets/logo/cqubgd.png`: 360,758 → 184,126 bytes.
  - `web/src/assets/logo/cqulovelive.png`: 1,157,765 → 715,306 bytes.
  - `web/src/assets/logo/cquod.png`: 587,598 → 362,760 bytes.

Used image total: 3,483,272 → 2,050,758 bytes.

Idle host/projection clocks schedule no periodic updates. Active clocks retain
their 200ms cadence and stop on expiry; media sync retains its separate 100ms
loop. Host preview reuses derived data and ignores position-only telemetry.
Configuration identity survives live commands with the same config revision;
new edits, out-of-order responses and same-revision lottery reveal are tested.

A controlled concurrent music test (host/projection/preload equivalent) reduces
17 same-song upstream calls to one. A caller may cancel independently; failures
are retriable; invalidation, account changes and shutdown reject old work.
Shared requests have a 20-second deadline and a limit of 64 in-flight song keys.

Validation: Go race suite, 2 Node bridge tests, 102 frontend tests, TypeScript,
production build plus manifest/gzip integrity checker. Browser access remains
disallowed by the user, so no FCP/LCP/FPS or visual interaction claims are made.
Original activity files and credentials were not used as test fixtures.

Independent review found a clock setup boundary: an effect delayed past expiry
could miss the final sample. The fix publishes an immediate sample on positive
deadlines, including expiry, and adds two lifecycle/setup regression tests.
The complete suite and production artifact checks passed again after the fix.

Real HTTP smoke checks also verify the compressed HEAD content length, private/public state, authenticated SSE, media ranges and reveal behavior using a temporary synthetic activity.
