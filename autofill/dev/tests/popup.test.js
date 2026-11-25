// The toolbar popup (popup.html, popup.js): the four tools, Moonfill's scan list, and Settings.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const top = new URL('../../../', import.meta.url);   // the extension's folder
const read = path => readFileSync(new URL(path, top), 'utf8');
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

async function popup(store = {}) {
  const dom = new JSDOM(read('popup.html').replace(/<script src="popup.js"><\/script>/, ''), {runScripts: 'outside-only'});
  const {window} = dom;
  const calls = [];
  window.chrome = {
    runtime: {getManifest: () => ({version: '3.0.16', version_name: '3.0.16 AutoSetup prototype'}), openOptionsPage: () => calls.push('options'), sendMessage: m => calls.push(m)},
    storage: {local: {get: async () => ({...store}), remove: async () => {}}, onChanged: {addListener: () => {}}},
    tabs: {create: o => calls.push(o)}
  };
  window.eval(read('popup.js'));
  await tick();   // jsdom fires DOMContentLoaded itself, just after the page is built
  if (!window.document.querySelector('.version').textContent) {   // already past it: start the popup once
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await tick();
  }
  return {window, doc: window.document, calls};
}

test('popup: names the extension and its version, and lists the four tools with where to start each', async t => {
  const {window, doc} = await popup();
  t.after(() => window.close());
  assert.equal(doc.querySelector('h1').textContent, 'UI AutoSetup');
  assert.equal(doc.querySelector('.version').textContent, 'v3.0.16');
  assert.deepEqual([...doc.querySelectorAll('.tools b')].map(b => b.textContent), ['🌙 Moonpull scan', '📋 Technical Checklist', '🚀 New Implementation', '🔎 Internal Review']);
  assert.match(doc.getElementById('empty').textContent, /No scans running/);
  assert.equal(doc.querySelector('img[src="assets/autosetup128.png"]') !== null, true);
  assert.equal(doc.querySelector('#portfolioBtn, #githubBtn'), null, 'no personal links');
});

test('popup: Settings opens the settings page; scans still show with Force paste and Copy result', async t => {
  const now = Date.now();
  const p = await popup({
    moonfillJob_1: {id: '1', program: 'Example Ltd', mid: '12345', state: 'waiting', startedAt: now - 5000, submittedAt: now - 5000},
    moonfillJob_2: {id: '2', program: 'Other Ltd', mid: '67890', state: 'failed', error: 'no result after 10 minutes', startedAt: now - 9000, finishedAt: now - 1000, resultText: 'result'}
  });
  const {window, doc, calls} = p;
  t.after(() => window.close());
  doc.getElementById('settingsBtn').click();
  assert.deepEqual(calls, ['options']);
  const cards = [...doc.querySelectorAll('.job')];
  assert.equal(cards.length, 2);
  // newest first: the running scan, then the failed one
  assert.match(cards[0].textContent, /In progress/);
  assert.match(cards[1].textContent, /Failed: no result after 10 minutes/);
  assert.deepEqual([...cards[1].querySelectorAll('.act')].map(b => b.textContent), ['Force paste', 'Copy result']);
  cards[1].querySelector('.act.primary').click();
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), {action: 'forcePost', jobId: '2'});
});

test('popup: in the extension\'s own colours (the flame), not Moonfill\'s Salesforce blue', () => {
  const css = read('css/style.css');
  assert.doesNotMatch(css, /#0176d3/i, 'no Salesforce blue');
  for (const c of ['#fca800', '#fc6000', '#f01824']) assert.match(css, new RegExp(c, 'i'));
  assert.match(read('popup.html'), /<meta name="color-scheme" content="dark">/);
});
