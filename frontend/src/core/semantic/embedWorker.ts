// Embedding worker for the optional search by meaning: EmbeddingGemma 2
// (text encoder, 4-bit) on onnxruntime-web's single-threaded WebAssembly
// backend. The model files come from Go over the data channel; nothing is
// fetched from the network here. Terminating the worker frees all of it.
import * as ort from 'onnxruntime-web/wasm';
import { Tokenizer } from '@huggingface/tokenizers';
import { fetchBytes } from '../fetchbytes';
import { initOrtWasm } from '../ortwasm';

export type EmbedIn =
  | { type: 'init'; token: string; dims: number }
  | { type: 'embed'; id: number; texts: string[]; maxTokens: number };

export type EmbedOut =
  | { type: 'ready'; millis: number }
  | { type: 'loading'; done: number; total: number }
  | { type: 'result'; id: number; vectors: Float32Array; dims: number; tokens: number; millis: number }
  | { type: 'error'; id?: number; message: string };

let session: ort.InferenceSession | null = null;
let tokenizer: Tokenizer | null = null;
let dims = 256;

const post = (m: EmbedOut, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

async function init(token: string, d: number) {
  const t0 = performance.now();
  dims = d;
  await initOrtWasm(ort);
  const url = (f: string) => `/__mf/model/${f}?t=${encodeURIComponent(token)}`;
  // Ranged fetches: one big response costs WebKitGTK main-thread time.
  const json = async (f: string) => JSON.parse(new TextDecoder().decode(await fetchBytes(url(f))));
  tokenizer = new Tokenizer(await json('tokenizer.json'), await json('tokenizer_config.json'));
  const graph = await fetchBytes(url('onnx/model_q4.onnx'));
  const data = await fetchBytes(url('onnx/model_q4.onnx_data'), (done, total) => post({ type: 'loading', done, total }));
  session = await ort.InferenceSession.create(graph, {
    externalData: [{ path: 'model_q4.onnx_data', data }],
    graphOptimizationLevel: 'all',
    executionProviders: ['wasm'],
  });
  post({ type: 'ready', millis: Math.round(performance.now() - t0) });
}

const empty = () => new ort.Tensor('float32', new Float32Array(0), [0, 512]);

async function embed(id: number, texts: string[], maxTokens: number) {
  if (!session || !tokenizer) throw new Error('model not loaded');
  const t0 = performance.now();
  const out = new Float32Array(texts.length * dims);
  let tokens = 0;
  // One text per run: batching saves nothing on the CPU backend and padding
  // would waste work on mixed lengths.
  for (let i = 0; i < texts.length; i++) {
    let ids = tokenizer.encode(texts[i]).ids;
    if (ids.length > maxTokens) ids = [...ids.slice(0, maxTokens - 1), ids[ids.length - 1]]; // keep <eos>
    tokens += ids.length;
    const n = ids.length;
    const input = new BigInt64Array(n);
    for (let j = 0; j < n; j++) input[j] = BigInt(ids[j]);
    const res = await session.run({
      input_ids: new ort.Tensor('int64', input, [1, n]),
      attention_mask: new ort.Tensor('int64', new BigInt64Array(n).fill(1n), [1, n]),
      image_features: empty(),
      video_features: empty(),
      audio_features: empty(),
    });
    const full = res.sentence_embedding.data as Float32Array;
    // Matryoshka: the first `dims` values are a valid embedding once renormalized.
    let norm = 0;
    for (let k = 0; k < dims; k++) norm += full[k] * full[k];
    norm = Math.sqrt(norm) || 1;
    for (let k = 0; k < dims; k++) out[i * dims + k] = full[k] / norm;
    for (const t of Object.values(res)) t.dispose();
  }
  post({ type: 'result', id, vectors: out, dims, tokens, millis: Math.round(performance.now() - t0) }, [out.buffer]);
}

self.onmessage = async (e: MessageEvent<EmbedIn>) => {
  const m = e.data;
  try {
    if (m.type === 'init') await init(m.token, m.dims);
    else if (m.type === 'embed') await embed(m.id, m.texts, m.maxTokens);
  } catch (err) {
    post({ type: 'error', id: m.type === 'embed' ? m.id : undefined, message: err instanceof Error ? err.message : String(err) });
  }
};
