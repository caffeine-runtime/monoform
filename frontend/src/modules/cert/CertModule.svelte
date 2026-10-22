<script lang="ts">
  // Certificates and keys (.pem .crt .cer .der .p12 .pfx .p7b .csr .crl):
  // who it's for and who issued it, validity with an expiry warning, names
  // (SANs), key, usages, fingerprints (click to copy), the chain order, and
  // the PEM of each certificate. PKCS#12 files ask for their password.
  import { onMount } from 'svelte';
  import Icon from '../../shell/Icon.svelte';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import ShieldAlert from '@lucide/svelte/icons/shield-alert';
  import KeyRound from '@lucide/svelte/icons/key-round';
  import FileSignature from '@lucide/svelte/icons/file-key';
  import Link from '@lucide/svelte/icons/link-2';
  import { api, saveFile } from '../../core/backend';
  import { dirname, join, stem } from '../../core/paths';
  import { workspace, type Tab } from '../../core/tabs.svelte';
  import { toastError, ui } from '../../core/ui.svelte';
  import type { certs } from '../../wailsjs/go/models';
  import { locale, t, tn } from '../../core/i18n';

  let { tab }: { tab: Tab } = $props();

  let res = $state<certs.Result | null>(null);
  let error = $state('');
  let password = $state('');
  let pwWrong = $state(false);
  let showPem = $state<Set<number>>(new Set());
  let loading = $state(true);

  async function load() {
    loading = true;
    error = '';
    try {
      if (!tab.filePath) throw new Error(t('Save the file first.'));
      const r = await api.CertInspect(tab.filePath, password);
      pwWrong = r.needsPassword && password !== '';
      res = r;
      const certsN = r.items.filter((i) => i.kind === 'certificate').length;
      const soon = r.items.find((i) => i.kind === 'certificate' && i.status !== 'valid');
      tab.status = { ...tab.status, type: certsN ? t('{format} certificate', { format: r.format }) : t('{format} file', { format: r.format }), info: r.needsPassword ? t('Password needed') : `${tn('{n} item', '{n} items', r.items.length)}${soon ? ` · ${label(soon)}` : ''}` };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  const fmtDate = (s: string | Date) => new Date(s).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
  function label(i: certs.Item): string {
    if (i.status === 'expired') return tn('Expired {n} day ago', 'Expired {n} days ago', -i.daysLeft);
    if (i.status === 'not-yet-valid') return t('Not valid until {date}', { date: fmtDate(i.notBefore) });
    if (i.status === 'expiring') return i.daysLeft <= 0 ? t('Expires today') : tn('Expires in {n} day', 'Expires in {n} days', i.daysLeft);
    return tn('Valid for {n} more day', 'Valid for {n} more days', i.daysLeft);
  }
  const title = (i: certs.Item) => i.subject?.commonName || i.subject?.organization || (i.kind === 'private-key' ? t('Private key') : i.kind === 'public-key' ? t('Public key') : i.kind === 'request' ? t('Certificate request') : i.kind === 'crl' ? t('Revocation list') : t('Certificate'));
  const role = (i: certs.Item, idx: number) => (i.kind !== 'certificate' ? '' : i.selfSigned ? (i.isCA ? t('Root CA') : t('Self-signed')) : i.isCA ? t('Intermediate CA') : idx === 0 ? t('End-entity') : '');

  async function copy(text: string, done: string) {
    await navigator.clipboard.writeText(text).catch(() => {});
    ui.toast(done, 'success'); // i18n-ignore: the message is translated by the caller
  }

  async function exportPem(i: certs.Item, n: number) {
    const def = join(dirname(tab.filePath ?? ''), `${stem(tab.title)}${(res?.items.length ?? 1) > 1 ? `-${n + 1}` : ''}.pem`);
    const p = await api.SaveFileDialog(t('Save as PEM'), def, [{ name: 'PEM', patterns: '*.pem;*.crt' }]);
    if (!p) return;
    try {
      await saveFile(p, i.pem);
      ui.toast(t('Saved'), 'success', { label: t('Open'), run: () => void workspace.openPath(p) });
    } catch (e) {
      toastError(e);
    }
  }

  (tab as unknown as { certTest: unknown }).certTest = { result: () => res, error: () => error, unlock: (p: string) => ((password = p), load()) };

  onMount(() => {
    tab.handlers = { ...tab.handlers, reload: load };
    void load();
  });
</script>

<div class="body">
  {#if error}
    <div class="empty-state">{error}</div>
  {:else if res?.needsPassword}
    <form class="pw" onsubmit={(e) => (e.preventDefault(), load())}>
      <Icon icon={KeyRound} size={28} />
      <p>{t('This {format} file is protected by a password.', { format: res.format })}</p>
      <input class="input" type="password" placeholder={t('Password')} bind:value={password} autocomplete="off" aria-label={t('Password')} />
      {#if pwWrong}<p class="bad">{t("That password doesn't open it.")}</p>{/if}
      <button class="btn primary" type="submit">{t('Open')}</button>
    </form>
  {:else if res}
    <div class="head">
      <span class="label">{res.format} · {tn('{n} item', '{n} items', res.items.length)}</span>
    </div>
    {#each res.items as i, n (n)}
      <article class="card {i.kind} {i.status}">
        <header>
          <Icon icon={i.kind === 'certificate' ? (i.status === 'valid' ? ShieldCheck : ShieldAlert) : i.kind === 'request' ? FileSignature : KeyRound} size={20} />
          <h2>{title(i)}</h2>
          {#if role(i, n)}<span class="tag">{role(i, n)}</span>{/if}
          {#if i.status}<span class="pill {i.status}">{label(i)}</span>{/if}
          {#if i.issuedByNext}<span class="chain" title={t('Signed by the next certificate in this file')}><Icon icon={Link} size={14} /> {t('issued by the next one')}</span>{/if}
        </header>
        <dl>
          {#if i.subject?.full}<dt>{t('Subject')}</dt><dd>{i.subject.full}</dd>{/if}
          {#if i.issuer?.full}<dt>{t('Issuer')}</dt><dd>{i.issuer.full}</dd>{/if}
          {#if i.kind === 'certificate' || i.kind === 'crl'}
            <dt>{t('Valid', {}, 'certificate')}</dt><dd>{fmtDate(i.notBefore)} → <b>{fmtDate(i.notAfter)}</b></dd>
          {/if}
          {#if i.names?.length}<dt>{t('Names')}</dt><dd class="names">{#each i.names as nm (nm)}<span>{nm}</span>{/each}</dd>{/if}
          {#if i.key}<dt>{t('Key')}</dt><dd>{i.key}{i.encrypted ? ` (${t('encrypted')})` : ''}</dd>{/if}
          {#if i.signature}<dt>{t('Signature')}</dt><dd>{i.signature}</dd>{/if}
          {#if i.serial}<dt>{t('Serial')}</dt><dd class="mono">{i.serial}</dd>{/if}
          {#if i.keyUsage?.length}<dt>{t('Key usage')}</dt><dd>{i.keyUsage.join(', ')}</dd>{/if}
          {#if i.extKeyUsage?.length}<dt>{t('Purposes')}</dt><dd>{i.extKeyUsage.join(', ')}</dd>{/if}
          {#if i.isCA && i.pathLen >= 0}<dt>{t('Path length')}</dt><dd>{i.pathLen}</dd>{/if}
          {#if i.sha256}<dt>SHA-256</dt><dd><button class="fp" title={t('Copy')} onclick={() => copy(i.sha256, t('Copied SHA-256 fingerprint'))}>{i.sha256}</button></dd>{/if}
          {#if i.sha1}<dt>SHA-1</dt><dd><button class="fp" title={t('Copy')} onclick={() => copy(i.sha1, t('Copied SHA-1 fingerprint'))}>{i.sha1}</button></dd>{/if}
          {#if i.spkiPin}<dt>{t('Key pin')}</dt><dd><button class="fp" title={t('SHA-256 of the public key (base64), for pinning — copy')} onclick={() => copy(i.spkiPin, t('Copied key pin'))}>{i.spkiPin}</button></dd>{/if}
          {#if i.ocsp?.length}<dt>OCSP</dt><dd>{i.ocsp.join(', ')}</dd>{/if} <!-- i18n-ignore -->
          {#if i.caIssuers?.length}<dt>{t('CA issuers')}</dt><dd>{i.caIssuers.join(', ')}</dd>{/if}
          {#if i.crls?.length}<dt>CRL</dt><dd>{i.crls.join(', ')}</dd>{/if} <!-- i18n-ignore -->
          {#if i.note}<dt>{t('Note')}</dt><dd>{i.note}</dd>{/if}
        </dl>
        {#if i.pem}
          <div class="actions">
            <button class="btn ghost" onclick={() => (showPem = new Set(showPem.has(n) ? [...showPem].filter((x) => x !== n) : [...showPem, n]))}>{showPem.has(n) ? t('Hide PEM') : t('Show PEM')}</button>
            <button class="btn ghost" onclick={() => copy(i.pem, t('Copied PEM'))}>{t('Copy PEM')}</button>
            <button class="btn ghost" onclick={() => exportPem(i, n)}>{t('Save as PEM…')}</button>
          </div>
          {#if showPem.has(n)}<pre>{i.pem}</pre>{/if}
        {/if}
      </article>
    {/each}
  {:else if loading}
    <div class="empty-state"><span class="spinner"></span></div>
  {/if}
</div>

<style>
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 14px 20px 30px;
  }
  .head {
    margin-bottom: 8px;
  }
  .label {
    color: var(--text-muted);
    font-size: var(--fs-small);
  }
  .card {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 12px 16px;
    margin-bottom: 12px;
    max-width: 980px;
    background: var(--bg);
  }
  .card.expired,
  .card.not-yet-valid {
    border-color: var(--danger);
  }
  .card.expiring {
    border-color: var(--warning);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  h2 {
    font-size: calc(16px * var(--ui-scale));
    margin: 0;
    font-weight: 600;
  }
  .tag {
    font-size: var(--fs-small);
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0 8px;
  }
  .pill {
    font-size: var(--fs-small);
    border-radius: 10px;
    padding: 1px 9px;
    background: color-mix(in srgb, var(--success) 18%, transparent);
    color: var(--success);
  }
  .pill.expiring {
    background: color-mix(in srgb, var(--warning) 18%, transparent);
    color: var(--warning);
  }
  .pill.expired,
  .pill.not-yet-valid {
    background: color-mix(in srgb, var(--danger) 18%, transparent);
    color: var(--danger);
  }
  .chain {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    font-size: var(--fs-small);
    color: var(--text-muted);
  }
  dl {
    display: grid;
    grid-template-columns: 110px 1fr;
    gap: 4px 12px;
    margin: 10px 0 0;
    font-size: var(--fs-small);
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    margin: 0;
    word-break: break-word;
  }
  .names {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .names span {
    background: var(--bg-hover);
    border-radius: 4px;
    padding: 0 6px;
    font-family: var(--font-mono);
  }
  .mono,
  .fp {
    font-family: var(--font-mono);
  }
  .fp {
    border: none;
    background: none;
    color: inherit;
    padding: 0;
    text-align: left;
    cursor: copy;
    word-break: break-all;
    font-size: inherit;
  }
  .fp:hover {
    color: var(--accent-text);
  }
  .actions {
    display: flex;
    gap: 4px;
    margin-top: 10px;
  }
  pre {
    font-size: 11px;
    background: var(--bg-sidebar);
    padding: 8px;
    border-radius: var(--radius);
    overflow: auto;
  }
  .pw {
    max-width: 320px;
    margin: 60px auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: center;
    text-align: center;
  }
  .pw .input {
    width: 100%;
  }
  .bad {
    color: var(--danger);
    margin: 0;
  }
</style>
