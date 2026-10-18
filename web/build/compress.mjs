import { gzipSync } from 'node:zlib'

export function compressAssets() {
  return {
    name: 'precompressed-assets',
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (!/\.(?:js|css)$/.test(output.fileName)) continue
          const source = output.type === 'chunk' ? output.code : output.source
          const original = Buffer.from(source)
          if (original.length < 1024) continue
          const compressed = gzipSync(original, { level: 9 })
          if (compressed.length >= original.length) continue
          this.emitFile({ type: 'asset', fileName: `${output.fileName}.gz`, source: compressed })
        }
      },
    },
  }
}
