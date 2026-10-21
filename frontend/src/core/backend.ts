// Bridge to the Go backend: Wails bindings for small calls, and the /__hia/
// HTTP data channel for file contents (see internal/server).
import * as Go from '../wailsjs/go/app/App';
import { EventsOn } from '../wailsjs/runtime/runtime';
import type { fs, settings, app } from '../wailsjs/go/models';
import { uploadParts } from './upload';

export type Entry = fs.Entry;
export type Settings = settings.Settings;
export type SessionTab = settings.SessionTab;
export type BootInfo = app.BootInfo;
export type AIPack = app.AIPack;

export const api = Go;

let token = '';
export function setToken(t: string) {
  token = t;
}

/** URL for any /__hia/ endpoint with the session token and query params. */
export function endpoint(path: string, params: Record<string, string | number | boolean | undefined> = {}): string {
  const q = new URLSearchParams({ t: token });
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
  return `/__hia/${path}?${q.toString()}`;
}

/** URL that streams a file from disk (usable in <img>, fetch, pdf.js). */
export function fileUrl(path: string): string {
  return endpoint('file', { path });
}

export class BackendError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function check(res: Response): Promise<Response> {
  if (res.ok) return res;
  let msg = res.statusText || `HTTP ${res.status}`;
  try {
    const j = await res.json();
    if (j?.error) msg = j.error;
  } catch {
    /* not JSON */
  }
  throw new BackendError(msg, res.status);
}

export async function fetchBytes(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const res = await check(await fetch(url, { signal }));
  return res.arrayBuffer();
}

export async function readFile(path: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  return fetchBytes(fileUrl(path), signal);
}

export type Body = Blob | ArrayBuffer | ArrayBufferView | string;

/**
 * Request bodies are always sent as an ArrayBuffer: WebKitGTK crashes
 * (webkit_uri_scheme_request_get_http_body returns garbage) when a custom-
 * scheme POST carries a Blob, and an empty body is sent as a header flag for
 * the same reason.
 */
async function toBody(body: Body): Promise<{ body?: BodyInit; empty: boolean }> {
  let buf: ArrayBuffer | ArrayBufferView;
  if (body instanceof Blob) buf = await body.arrayBuffer();
  else if (typeof body === 'string') buf = new TextEncoder().encode(body);
  else buf = body;
  if (buf.byteLength === 0) return { empty: true };
  return { body: buf as BodyInit, empty: false };
}

async function post(url: string, body: Body): Promise<Response> {
  const b = await toBody(body);
  const headers: Record<string, string> = {};
  if (b.empty) headers['X-Empty-Body'] = '1';
  return check(await fetch(url, { method: 'POST', body: b.body, headers }));
}

/** POST raw bytes to an endpoint and parse the JSON reply. */
export async function postBytes<T = unknown>(url: string, body: Body): Promise<T> {
  return (await post(url, body)).json() as Promise<T>;
}

/** POST bytes and get bytes back (PDF operations, image transcoding). */
export async function postForBytes(url: string, body: Body): Promise<ArrayBuffer> {
  return (await post(url, body)).arrayBuffer();
}

/** Atomically write data to path (temp file + rename on the Go side). */
/** `extra` adds query params, e.g. { transform: 'image', format: 'jpg' }. */
export async function saveFile(path: string, data: Body, onProgress?: (done: number, total: number) => void, extra: Record<string, string> = {}): Promise<Entry> {
  let buf: ArrayBuffer | Uint8Array;
  if (data instanceof Blob) buf = await data.arrayBuffer();
  else if (typeof data === 'string') buf = new TextEncoder().encode(data);
  else if (data instanceof ArrayBuffer) buf = data;
  else buf = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return uploadParts((p, q) => endpoint(p, q), path, [buf], onProgress, extra) as Promise<Entry>;
}

/** Token for code (workers) that builds its own URLs. */
export function sessionToken(): string {
  return token;
}

/** Subscribe to a backend event; returns an unsubscribe function. */
export function on<T = any>(event: string, cb: (data: T) => void): () => void {
  return EventsOn(event, cb as (...d: any[]) => void);
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return String(e);
}
