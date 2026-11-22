import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const source = new URL('../node_modules/@mediapipe/tasks-vision/', import.meta.url);
const output = new URL('../public/mediapipe/', import.meta.url);
const files = ['vision_bundle.js', 'wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.wasm'];
const model = new URL('models/hand_landmarker.task', output);
const modelSource = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const modelSha256 = 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1';
const pkg = JSON.parse(await readFile(new URL('package.json', source), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (pkg.version !== manifest.dependencies['@mediapipe/tasks-vision']) {
  throw new Error('Install the exact MediaPipe version from package-lock.json before syncing.');
}

await mkdir(new URL('wasm/', output), { recursive: true });
await mkdir(new URL('models/', output), { recursive: true });
for (const file of files) {
  await copyFile(new URL(file, source), new URL(file, output));
}

let weights;
let downloaded = false;
try {
  weights = await readFile(model);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const response = await fetch(modelSource, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Model download failed (HTTP ${response.status})`);
  weights = Buffer.from(await response.arrayBuffer());
  downloaded = true;
}
const sha256 = createHash('sha256').update(weights).digest('hex');
if (sha256 !== modelSha256) throw new Error('Unexpected SHA-256 for the MediaPipe hand landmark model.');
if (downloaded) await writeFile(model, weights);
console.log(`MediaPipe ${pkg.version} model SHA-256: ${sha256}`);
for (const file of [...files, 'models/hand_landmarker.task']) {
  console.log(`${file}: ${(await stat(fileURLToPath(new URL(file, output)))).size} bytes`);
}
