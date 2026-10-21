// M25: config files and certificates — INI sections, duplicates and a value
// edited from the table (comments kept, saved); .env (opened by name, secrets
// masked) and .properties; a PEM chain (expiring leaf issued by the CA),
// DER, CSR and a password-protected .p12 from OpenSSL.
import { readFile } from '../core/backend';
import { join } from '../core/paths';
import { workspace, type Tab } from '../core/tabs.svelte';
import { assert, assertEq, sleep, waitFor } from './harness';

type Hooks = Record<string, any>;
const cfg = (t: Tab) => (t as unknown as { configTest?: Hooks }).configTest;
const cert = (t: Tab) => (t as unknown as { certTest?: Hooks }).certTest;

async function openConfig(path: string, n: number) {
  const tab = (await workspace.openPath(path))!;
  assertEq(tab.moduleId, 'config', `${path} opens in the config view`);
  const h = await waitFor(() => (cfg(tab)?.entries().length === n ? cfg(tab) : null), `${path}: ${n} settings`);
  return { tab, h };
}

export default async function m25(dir: string) {
  // ---- INI ----
  const ini = await openConfig(join(dir, 'config', 'app.ini'), 5);
  assertEq(ini.h.entries().map((e: any) => `${e.section}.${e.key}=${e.value}`).join(' '), 'server.host=localhost server.port=8080 database.url=postgres://db/app database.port=1 database.port=2', 'sections and values');
  assertEq(ini.h.issues().length, 1, 'duplicate key flagged');
  await waitFor(() => (document.querySelectorAll('.tabview.active .grid .row').length === 5 ? true : null), 'table rows');
  const host = document.querySelector<HTMLInputElement>('.tabview.active input[aria-label="host"]')!;
  host.value = '0.0.0.0';
  host.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(30);
  assert(ini.h.text().includes('host = 0.0.0.0 ; inline\n'), 'value edited, inline comment kept');
  assert(ini.tab.dirty, 'dirty');
  assert(await workspace.save(ini.tab), 'saved');
  const saved = new TextDecoder().decode(await readFile(join(dir, 'config', 'app.ini')));
  assert(saved.startsWith('; app\n[server]\nhost = 0.0.0.0 ; inline\nport = 8080\n'), 'file written with only that change');
  await workspace.close(ini.tab, { force: true });

  // ---- .env and .properties ----
  const env = await openConfig(join(dir, 'config', '.env'), 4);
  await waitFor(() => (document.querySelectorAll('.tabview.active .secret').length === 2 ? true : null), 'password and token masked');
  env.h.setReveal(true);
  await waitFor(() => (document.querySelectorAll('.tabview.active .secret').length === 0 ? true : null), 'revealed');
  assertEq(env.h.entries()[2].value, 'abc def', 'quoted value');
  await workspace.close(env.tab, { force: true });
  const props = await openConfig(join(dir, 'config', 'app.properties'), 2);
  assertEq(props.h.entries().map((e: any) => e.value).join('|'), 'Hello World|one two', 'escapes and continuations');
  await workspace.close(props.tab, { force: true });

  // ---- certificates ----
  const chainTab = (await workspace.openPath(join(dir, 'certs', 'chain.pem')))!;
  assertEq(chainTab.moduleId, 'cert', 'PEM opens in the certificate view');
  const ch = await waitFor(() => cert(chainTab)?.result(), 'chain read');
  const [leaf, ca] = ch.items;
  assertEq(leaf.subject.commonName, 'www.mf.test', 'leaf subject');
  assertEq(leaf.issuer.commonName, 'Mf Test CA', 'leaf issuer');
  assertEq(leaf.status, 'expiring', 'leaf expires within 30 days');
  assert(leaf.daysLeft >= 8 && leaf.daysLeft <= 10, `days left ${leaf.daysLeft}`);
  assertEq(leaf.names.join(','), 'www.mf.test,mf.test', 'SANs');
  assertEq(leaf.extKeyUsage.join(','), 'TLS server', 'purpose');
  assert(leaf.issuedByNext && ca.selfSigned, 'chain links to the self-signed CA');
  assertEq(leaf.sha256.split(':').length, 32, 'SHA-256 fingerprint');
  await waitFor(() => document.querySelector('.tabview.active .pill.expiring'), 'expiry warning shown');
  await workspace.close(chainTab, { force: true });
  for (const [f, kind] of [
    ['site.cer', 'certificate'],
    ['site.csr', 'request'],
  ]) {
    const t = (await workspace.openPath(join(dir, 'certs', f)))!;
    const r = await waitFor(() => cert(t)?.result(), `${f} read`);
    assertEq(r.items[0].kind, kind, `${f} kind`);
    await workspace.close(t, { force: true });
  }
  const p12 = (await workspace.openPath(join(dir, 'certs', 'site.p12')))!;
  const h = await waitFor(() => cert(p12), 'p12 view');
  await waitFor(() => (h.result()?.needsPassword ? true : null), 'asks for the password');
  await h.unlock('wrong');
  assert(h.result().needsPassword, 'wrong password refused');
  await h.unlock('mf-pw');
  const r = h.result();
  assertEq(r.items.map((i: any) => i.kind).join(','), 'certificate,certificate,private-key', 'certificate, CA and key');
  assert(r.items[2].note.includes('matches'), 'key matches the certificate');
  assertEq(r.items[2].pem, '', 'private key never shown');
  await workspace.close(p12, { force: true });
}
