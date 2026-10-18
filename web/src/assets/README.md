# Built-in image assets

UI imports use lossless WebP derivatives. Keep the original PNGs as source assets.
Reproduce each derivative with `cwebp -lossless -exact -m 6 source.png -o source.webp`.
The `-exact` flag preserves RGB even underneath fully transparent pixels.

Verified during the performance update: decode each source and derivative to RGBA
with FFmpeg and compare SHA-256 hashes. All six images decoded identically.
No conversion tools are required at runtime or during normal builds.
