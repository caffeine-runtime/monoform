// M88: recording the screen. With "record" the app was started as the
// recorder (--record): the options panel (sized to fit, options
// remembered), then — with a drawn picture and a tone standing in for the
// system's share step — the countdown and the bar (small, at the bottom),
// pause, the discard question, and Stop: a finished, editable recording in
// the recordings folder, handed to the main window. A cancelled share step
// goes back quietly, and Discard leaves no file. With "main" the app was
// started with --recorded FILE: the recording opens in the video editor with
// where it was saved. Where the webview can't record, only the options
// panel's notice is checked.
import { api, type Entry } from '../core/backend';
import { recorder } from '../core/recorder.svelte';
import { workspace } from '../core/tabs.svelte';
import { ui } from '../core/ui.svelte';
import { commands } from '../core/commands';
import { boot } from '../core/boot';
import { assert, assertEq, log, sleep, waitFor } from './harness';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const click = (sel: string) => {
  const el = $<HTMLButtonElement>(sel);
  assert(el, `${sel} is there`);
  el.click();
};
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);

/** A moving picture and a tone, in place of a screen and its sound. */
function fakeScreen(): MediaStream {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 360;
  const g = c.getContext('2d')!;
  let f = 0;
  const draw = () => {
    g.fillStyle = `hsl(${(f * 6) % 360} 55% 45%)`;
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff';
    g.font = '64px sans-serif';
    g.fillText(String(f++), 40, 120);
  };
  draw();
  const timer = setInterval(draw, 33);
  const ac = new AudioContext();
  const osc = ac.createOscillator();
  const out = ac.createMediaStreamDestination();
  osc.connect(out);
  osc.start();
  const stream = new MediaStream([...c.captureStream(30).getVideoTracks(), ...out.stream.getAudioTracks()]);
  stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
  return stream;
}

async function recordings(): Promise<Entry[]> {
  const list = await api.ListDir(recorder.folder).catch(() => [] as Entry[]);
  return list.filter((e) => e.name.startsWith('Screen recording '));
}

async function recorderWindow() {
  const panel = await waitFor(() => $('.panel'), 'the options panel');
  assertEq($('.panel h1')?.textContent, 'Record the screen', 'title');
  assert(!$('.sidebar') && !$('.tabbar'), 'no sidebar or tab bar');
  await waitFor(() => (recorder.folder ? true : null), 'the recordings folder');
  assert(/monoform-selftest|Screen Recordings/.test(recorder.folder), `recordings go to ${recorder.folder}`);
  assertEq($('.where span')?.textContent, 'Saved to ' + recorder.folder.split(/[\\/]/).slice(-2).join(' › '), 'the folder is shown');

  if (!recorder.available) {
    assert($('.notice')?.textContent?.includes('isn’t available'), 'says recording isn’t available here');
    log('this webview can’t record the screen: the panel says so');
    return;
  }
  // The window fits the panel.
  await waitFor(() => (Math.abs(window.innerHeight - panel.offsetHeight) <= 2 ? true : null), `the window fits the panel (${window.innerHeight} vs ${panel.offsetHeight})`);
  assert(Math.abs(window.innerWidth - panel.offsetWidth) <= 2, `the window is as wide as the panel (${window.innerWidth} vs ${panel.offsetWidth})`);
  log(`options panel ${window.innerWidth}×${window.innerHeight}, saving to ${recorder.folder}`);

  // Options are switches, remembered for next time.
  const count = $<HTMLButtonElement>('#rec-count')!;
  assertEq(count.getAttribute('aria-checked'), 'true', 'the countdown is on at first');
  count.click();
  await sleep(30);
  assertEq(JSON.parse(localStorage.getItem('monoform.record')!).countdown, false, 'the countdown setting is remembered');
  count.click();
  button('60 fps')!.click();
  await sleep(30);
  assert($('.seg button.on')?.textContent === '60 fps' && $('.opt .hint')?.parentElement, '60 fps chosen');
  button('30 fps')!.click();
  log('switches work and are remembered');

  // Cancelling the share step goes back without a word.
  recorder.source = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  click('.go');
  await waitFor(() => (recorder.phase === 'setup' ? true : null), 'back to the options');
  assert(!$('.error'), 'no error after a cancelled share step');
  log('a cancelled share step goes back quietly');

  // Record: countdown, bar, pause, stop.
  const before = (await recordings()).length;
  recorder.source = async () => fakeScreen();
  click('.go');
  await waitFor(() => $('.bar .count'), 'the countdown');
  assertEq($('.bar .count')?.textContent, '3', 'counts down from 3');
  await waitFor(() => (window.innerHeight < 80 ? true : null), `a small bar (${window.innerWidth}×${window.innerHeight})`);
  await waitFor(() => (recorder.phase === 'recording' ? true : null), 'recording after the countdown', 6000);
  assert(window.innerHeight < 80 && window.innerWidth < 520, `the bar is small (${window.innerWidth}×${window.innerHeight})`);
  assert(recorder.systemAudio, 'the computer’s sound is recorded');
  await sleep(1300);
  const shown = $('.bar .time')!.textContent!;
  assert(shown === '0:01' || shown === '0:02', `the clock runs (${shown})`);
  click('.bar button[title="Pause"]');
  await sleep(50);
  const pausedAt = recorder.elapsed;
  assert($('.bar .time.paused') && $('.bar .rdot.paused'), 'shown as paused');
  await sleep(800);
  assert(Math.abs(recorder.elapsed - pausedAt) < 30, 'the clock stops while paused');
  click('.bar button[title="Resume"]');
  // Discard asks first; Keep recording carries on.
  click('.bar button[title="Discard the recording…"]');
  await waitFor(() => button('Keep recording'), 'the discard question');
  button('Keep recording')!.click();
  await waitFor(() => $('.bar .time'), 'recording again');
  await sleep(900);
  const recorded = recorder.elapsed / 1000;
  log(`recorded ${recorded.toFixed(1)} s with a pause and a declined discard`);
  click('.bar .stop');
  await waitFor(() => (recorder.phase === 'done' ? true : null), 'saved', 20000);
  const path = recorder.saved;
  assertEq(JSON.stringify(await api.TestLastHandoff()), JSON.stringify(['--recorded', path]), 'handed to the main window');
  const list = await recordings();
  assertEq(list.length, before + 1, 'one new recording');
  assert(list.some((e) => e.path === path), `${path} is in the folder`);
  const opened = await api.VideoOpen(path);
  const info = opened!.info;
  const ext = recorder.format!.ext;
  assert(path.endsWith(`.${ext}`), `saved as ${ext}`);
  assert(info.editable && info.hasVideo && info.hasAudio, `an editable recording with sound: ${JSON.stringify(info)}`);
  assert(Math.abs(info.duration - recorded) < 0.9, `as long as recorded (${info.duration.toFixed(2)} s vs ${recorded.toFixed(2)} s)`);
  log(`saved ${path.split(/[\\/]/).pop()}: ${info.videoCodec}/${info.audioCodec}, ${info.width}×${info.height}, ${info.duration.toFixed(2)} s`);

  // Discard: no file, back to the options.
  recorder.phase = 'setup';
  recorder.setPrefs({ countdown: false });
  await waitFor(() => $('.panel'), 'the options again');
  click('.go');
  await waitFor(() => (recorder.phase === 'recording' ? true : null), 'recording at once without the countdown');
  await sleep(700);
  click('.bar button[title="Discard the recording…"]');
  await waitFor(() => button('Discard'), 'the discard question');
  button('Discard')!.click();
  await waitFor(() => $('.panel'), 'back to the options');
  assertEq((await recordings()).length, before + 1, 'a discarded recording leaves no file');
  recorder.setPrefs({ countdown: true });
  log('a discarded recording leaves nothing behind');
}

async function mainWindow() {
  const t = await waitFor(() => workspace.tabs.find((x) => x.title.endsWith('.webm')), 'the recording opened');
  assertEq(t.moduleId, 'video', 'in the video editor');
  await waitFor(() => (ui.toasts.some((x) => x.message.startsWith('Screen recording saved to')) ? true : null), 'where it was saved');
  const toast = ui.toasts.find((x) => x.message.startsWith('Screen recording saved to'))!;
  assertEq(toast.action?.label, 'Show in folder', 'with Show in folder');
  // The command starts the recorder (Windows) or isn't offered.
  const cmd = commands.get('screenshot.record');
  assert(cmd, 'the Record the screen command');
  if (boot.platform === 'windows') {
    assert(commands.execute('screenshot.record'), 'the command runs');
    await waitFor(async () => (JSON.stringify(await api.TestLastHandoff()) === '["--record"]' ? true : null), 'the recorder window started');
  } else {
    assert(cmd.when && !cmd.when(), 'not offered where recording isn’t tried yet');
  }
  log('a finished recording opens in the video editor, with where it was saved');
}

export default async function m88(arg: string) {
  if (arg === 'main') return mainWindow();
  return recorderWindow();
}
