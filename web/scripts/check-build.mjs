import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'

const root = new URL('../dist/', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('.vite/manifest.json', root), 'utf8'))
function closure(...entries) {
  const seen = new Set()
  const visit = (entry) => {
    if (seen.has(entry)) return
    assert.ok(manifest[entry], `missing chunk ${entry}`)
    seen.add(entry)
    for (const child of manifest[entry].imports || []) visit(child)
  }
  for (const entry of entries) visit(entry)
  return seen
}
const dynamic = (name) => {
  const key = Object.keys(manifest).find((key) => manifest[key].name === name && manifest[key].isDynamicEntry)
  assert.ok(key, `missing dynamic entry ${name}`)
  return key
}
const stage = closure('index.html')
const app = dynamic('App')
const host = closure('index.html', app)
for (const editor of ['Bank', 'Scores', 'Lottery', 'Setup']) {
  const key = dynamic(editor)
  assert.ok(manifest[key]?.isDynamicEntry, `${editor} must load on demand`)
  assert.ok(!stage.has(key) && !host.has(key), `${editor} is loaded before its tab opens`)
}
assert.ok(!stage.has(app), 'projection loads admin code')
for (const chunk of Object.values(manifest)) {
  for (const file of [chunk.file, ...(chunk.css || [])]) {
    if (!/\.(js|css)$/.test(file)) continue
    const original = await readFile(new URL(file, root))
    if (original.length < 1024) continue
    const compressed = await readFile(new URL(`${file}.gz`, root))
    assert.deepEqual(gunzipSync(compressed), original, `corrupt gzip ${file}`)
  }
}
async function bytes(chunks) {
  let js = 0, gzip = 0
  for (const key of chunks) {
    const file = manifest[key].file
    if (!file.endsWith('.js')) continue
    const buffer = await readFile(new URL(file, root))
    js += buffer.length
    gzip += buffer.length < 1024 ? buffer.length : (await readFile(new URL(`${file}.gz`, root))).length
  }
  return { js, gzip }
}
console.log(JSON.stringify({ stage: await bytes(stage), host: await bytes(host) }))
