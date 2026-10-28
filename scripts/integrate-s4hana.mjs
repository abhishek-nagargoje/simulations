// Integrates the supplied single-file Amazon S/4HANA application into the platform.
// Every patch is an exact match that must occur the expected number of times;
// if the source changes shape, the script stops instead of guessing.
//
//   node scripts/integrate-s4hana.mjs            (reads modules/amazon-s4hana/source/Amazon_S4HANA.html)
//   node scripts/integrate-s4hana.mjs <source>   (another export of the same application)
//
// Output: modules/amazon-s4hana/index.html (private; never under /public)
//
// What it changes (and nothing else):
//   1. Storage: postings, user and preferences are kept in the browser as in the
//      original, but namespaced per access session (s4:<access id>:...). The
//      current session plus the two most recently used others are kept.
//   2. Size: the embedded data set (about 8 MB) is stored gzip-compressed and
//      unpacked in the browser before the application starts, so the page stays
//      well below the 4.5 MB function response limit.
//   3. Keeps the original branding and the SAP-style logon (user ID and name,
//      used to attribute postings; the platform has already authenticated).
//   4. Wording: no training/simulation/practice terminology; "Simulate" is "Preview".
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2] ?? join(root, 'modules', 'amazon-s4hana', 'source', 'Amazon_S4HANA.html');
const out = join(root, 'modules', 'amazon-s4hana', 'index.html');
let html = readFileSync(src, 'utf8');

const all = (re) => new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
function patch(label, find, replace, expected = 1) {
  const n = typeof find === 'string' ? html.split(find).length - 1 : (html.match(all(find)) ?? []).length;
  if (expected === 'any' ? n === 0 : n !== expected) {
    console.error(`Patch "${label}": expected ${expected} match(es), found ${n}. Source changed — review the patch.`);
    process.exit(1);
  }
  html = typeof find === 'string' ? html.split(find).join(replace) : html.replace(all(find), () => replace);
}

// 1. Storage per access session ----------------------------------------------
patch(
  'storage namespace',
  'const LS = {\n  get(k, d) { try { const v = localStorage.getItem(k);',
  `// Browser storage is namespaced per access session: s4:<access id>:<key>.
// The current session plus the two most recently used others are kept.
const NS = 's4:' + (window.__CLASSROOM__ || 'standalone') + ':';
(function () {
  const IX = 's4:__index';
  try {
    const ix = JSON.parse(localStorage.getItem(IX) || '{}'); ix[NS] = Date.now();
    const old = Object.keys(ix).filter(k => k !== NS).sort((a, b) => ix[b] - ix[a]).slice(2);
    for (const ns of old) { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith(ns)) localStorage.removeItem(k); } delete ix[ns]; }
    localStorage.setItem(IX, JSON.stringify(ix));
  } catch (e) { }
})();
const LS = {
  get(k, d) { try { const v = localStorage.getItem(NS + k);`,
);
patch('storage set', 'set(k, v) { try { localStorage.setItem(k, JSON.stringify(v));', 'set(k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v));');
patch('log off', "try { localStorage.removeItem('amz_user'); }", "try { localStorage.removeItem(NS + 'amz_user'); }");

// 2. Logon screen ------------------------------------------------------------
patch('title', '<title>Amazon S/4HANA Training Simulator</title>', '<title>Amazon S/4HANA</title>');
patch('logon brand', '<b>amazon</b><span>OSCM Training</span>', '<b>amazon</b><span>OSCM</span>');
patch('logon heading', '<h1>SAP S/4HANA Simulator</h1>', '<h1>SAP S/4HANA</h1>');
patch('logon intro', 'Log on with your student ID. No password is needed in this training system.', 'Log on with your user ID.');
patch('logon user label', '<label>User (Student ID)</label>', '<label>User</label>');
patch('logon note', /\n {4}<div class="lg-note">Training simulation with synthetic data\.[^<]*<\/div>/, '');

// 3. Wording -----------------------------------------------------------------
const WORDING = [
  // Embedded data
  [' (Training)"', '"'],
  ['@training.example.com', '@buying.example.com'],
  ['Safety training ', 'Safety instruction '],
  // Application
  ['Amazon OSCM - SAP S/4HANA Training Simulator', 'Amazon OSCM - SAP S/4HANA'],
  ['My practice postings:', 'My postings:'],
  ['Reset my practice data', 'Reset my postings'],
  ['Reset My Practice Data', 'Reset My Postings'],
  ['(S/4HANA 2023 FPS02 - training)', '(S/4HANA 2023 FPS02)'],
  ["confirmDlg('Reset practice data', `This removes <b>all practice postings stored in this browser</b> (${JOURNAL.length} entries, all users) and reloads the original training data. Continue?`",
    "confirmDlg('Reset postings', `This removes <b>all postings stored in this browser</b> (${JOURNAL.length} entries, all users) and reloads the original data. Continue?`"],
  ['`practice_${USER.id}.json`', '`postings_${USER.id}.json`'],
  ['every state change in the simulator', 'every state change in the application'],
  ['configured in this training system', 'configured in this system'],
  ["intro: 'Training tip: ", "intro: 'Tip: "],
  ['Synthetic training document', 'Scanned document'],
  ["{ t: 'Simulate', fn: () => { bal(); msg('Simulation: see balance below the header', 'I'); } }", "{ t: 'Preview', fn: () => { bal(); msg('Preview: see balance below the header', 'I'); } }"],
  ["title: 'MRP simulation result'", "title: 'MRP planning result'"],
  ["frSel('Simulation only', 'dSim', [['0', 'No - create requisitions'], ['1', 'Yes - simulate']]", "frSel('Planning only', 'dSim', [['0', 'No - create requisitions'], ['1', 'Yes - plan only']]"],
  ['<div class="hint">Training simulation: this system uses student IDs without passwords, so nothing is reset. In a real landscape this app sends a password-reset request for the selected system to GRC.</div>',
    '<div class="hint">Sends a password-reset request for the selected system to GRC.</div>'],
  ["msg('Request recorded (simulation) - no credentials are changed in the training system', 'I')", "msg('Password reset is not available in this configuration', 'I')"],
  ['exercises, training pages, start-up', 'exercises, user guides, start-up'],
  [' - Training Material', ' - User Guide'],
  ["'Training Material'", "'User Guide'"],
  ['Procure-to-Pay Practice (Create / Post)', 'Procure-to-Pay (Create / Post)'],
  ['Welcome to the Amazon S/4HANA training system', 'Welcome to Amazon S/4HANA'],
  ['records of synthetic master and transaction data', 'records of master and transaction data'],
  ['your practice postings:', 'your postings:'],
  ['<br>Educational simulation with synthetic data. Not affiliated with, endorsed or sponsored by Amazon.com, Inc. or SAP SE. SAP, S/4HANA and Fiori are trademarks of SAP SE.',
    '<br>SAP, S/4HANA and Fiori are trademarks of SAP SE.'],
  ['including your practice postings', 'including your postings'],
  ['Every table of the training system', 'Every table of the system'],
  ['plus all practice postings', 'plus all postings'],
  ["'Amazon OSCM S/4HANA simulation - database export'", "'Amazon OSCM S/4HANA - database export'"],
  ["'Practice postings included'", "'Postings included'"],
  ['This simulator reproduces the SAP S/4HANA Fiori launchpad used by Amazon procurement and inventory teams. It contains',
    'The SAP S/4HANA Fiori launchpad of the Amazon procurement and inventory teams contains'],
  ['Amazon_S4HANA_Simulation_Database.xlsx', 'Amazon_S4HANA_Database.xlsx'],
  ['every time you open the simulator', 'every time you open the application'],
  ['VIM training material', 'VIM user guides'],
  ['Statuses in this training system', 'Statuses in this system'],
  ['<p>Practice: open the', '<p>Try it: open the'],
  ['Approval limits (training)', 'Approval limits'],
  ['In the simulator any user may approve to keep exercises simple.', 'In this system any user may approve.'],
];
for (const [find, replace] of WORDING) patch(`wording: ${find.trim().slice(0, 40)}`, find, replace, 'any');

// 4. Compressed data set -----------------------------------------------------
const DATA = /<script>const RAW = (\{[\s\S]*?\});<\/script>\n<script>\n'use strict';\n/;
const m = DATA.exec(html);
if (!m) {
  console.error('Embedded data set not found. Source changed — review the patch.');
  process.exit(1);
}
JSON.parse(m[1]); // the data must be plain JSON
const packed = gzipSync(Buffer.from(m[1], 'utf8'), { level: 9 }).toString('base64');
const loader = `<script type="application/octet-stream" id="s4-data">${packed}</script>
<script>
// Unpacks the data set, then starts the application script below.
(async function () {
  try {
    const b = atob(document.getElementById('s4-data').textContent), u = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    const text = await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    window.RAW = JSON.parse(text);
    const s = document.createElement('script');
    s.textContent = document.getElementById('s4-app').textContent;
    document.body.appendChild(s);
  } catch (e) {
    console.error(e);
    document.body.insertAdjacentHTML('beforeend', '<p style="font-family:Arial,sans-serif;padding:24px">The system could not be started. Reload the page.</p>');
  }
})();
</script>
<script type="text/plain" id="s4-app">
'use strict';
`;
html = html.replace(DATA, () => loader);
patch('app script end', /\n<\/script>\n<\/body>\n<\/html>\s*$/, '\n</script>\n</body>\n</html>\n');

// Final safety checks -------------------------------------------------------
for (const [label, re] of [
  ['uncompressed data set', /const RAW = /],
  ['unscoped browser storage', /localStorage\.(get|set|remove)Item\((?!NS \+|IX|k\))/],
  ['prohibited wording', /\b(hr remedy|training|trainee\w*|simulat\w*|demo|demos|practi[cs]e|(?<!\.)prototype|mock(?:ed|s)?|clone[sd]?|dummy)\b/i],
]) {
  const hit = html.match(re);
  if (hit) {
    console.error(`Integrated file still contains: ${label} (${hit[0]})`);
    process.exit(1);
  }
}
if (html.length > 4_000_000) {
  console.error(`Output is ${html.length.toLocaleString()} bytes; it must stay below 4 MB.`);
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`Wrote ${out} (${html.length.toLocaleString()} bytes)`);
