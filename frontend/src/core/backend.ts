// Bridge to the Go backend: Wails bindings for small calls, and the /__hia/
// HTTP data channel for file contents (see internal/server).
import * as Go from '../wailsjs/go/app/App';
import { EventsOn } from '../wailsjs/runtime/runtime';
import type { fs, settings, app } from '../wailsjs/go/models';

export type Entry = fs.Entry;
export type Settings = settings.Settings;
export type SessionTab = settings.SessionTab;
export type BootInfo = app.BootInfo;

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

/** POST raw bytes to an endpoint and parse the JSON reply. */
export async function postBytes<T = unknown>(url: string, body: BodyInit): Promise<T> {
  const res = await check(await fetch(url, { method: 'POST', body }));
  return res.json() as Promise<T>;
}

/** POST bytes and get bytes back (PDF operations, image transcoding). */
export async function postForBytes(url: string, body: BodyInit): Promise<ArrayBuffer> {
  const res = await check(await fetch(url, { method: 'POST', body }));
  return res.arrayBuffer();
}

/** Atomically write data to path (temp file + rename on the Go side). */
export async function saveFile(path: string, data: BodyInit): Promise<Entry> {
  return postBytes<Entry>(endpoint('save', { path }), data);
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
