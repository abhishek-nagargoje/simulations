// Integrates the supplied single-file Zoho CRM application into the platform.
// Every patch is an exact match that must occur the expected number of times;
// if the source changes shape, the script stops instead of guessing.
//
//   node scripts/integrate-crm.mjs            (reads modules/zoho-crm/source/zoho-crm.html)
//   node scripts/integrate-crm.mjs <source>   (another export of the same application)
//
// Output: modules/zoho-crm/index.html (private; never under /public)
//
// What it changes (and nothing else):
//   1. Removes the embedded client-side sign-in (form, hard-coded credentials,
//      handler). The platform's server-side sign-in is the only gate; the CRM
//      opens directly.
//   2. "Sign Out" hands control back to the platform host (access:exit).
//   3. Keeps the original product branding (logo mark and product name).
//   4. Wording: no training/simulation/demo/practice/clone terminology.
// Records stay in memory as in the original (reset on reload).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2] ?? join(root, 'modules', 'zoho-crm', 'source', 'zoho-crm.html');
const out = join(root, 'modules', 'zoho-crm', 'index.html');
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

// 1. Embedded sign-in -------------------------------------------------------
patch('title', '<title>Zoho CRM · Training Simulator</title>', '<title>Zoho CRM</title>');
patch('sign-in css comment', '   TRAINING SIGN-IN (neutral — not a copy of any vendor login)\n', '   SIGN-IN\n');
patch('skip link', '<a class="skip" id="skip-link" href="#login-main">', '<a class="skip" id="skip-link" href="#main">');
patch('sign-in markup', /<!-- ============ TRAINING SIGN-IN \(demo only\) ============ -->[\s\S]*?(?=<!-- ============ APP ============ -->)/, '');
patch('app visible', '<div id="app" class="app" hidden>', '<div id="app" class="app">');
patch('utility bar visible', '<footer class="bbar" id="bbar" hidden aria-label="Utility bar">', '<footer class="bbar" id="bbar" aria-label="Utility bar">');
patch(
  'credentials',
  "// Demo-only credentials. Checked in the browser — NOT real security.\nconst AUTH = { email: 'training@hrremedyindia.com', password: 'Ryf645@$tty' };\n",
  "const USER_EMAIL = 'abhishek.nagargoje@primenestrealty.com';\n",
);
patch('user email', "$('#user-email').textContent = AUTH.email;", "$('#user-email').textContent = USER_EMAIL;");
patch(
  'sign-in handlers',
  /\/\* =+\n {3}22\. AUTHENTICATION \(demo only\)\n {3}=+ \*\/\nfunction login\(\) \{[\s\S]*?\$\('#pw-toggle'\)\.addEventListener\('click', \(\) => setPwVisible\(\$\('#login-pass'\)\.type === 'password'\)\);\n/,
  `/* =========================================================
   22. SESSION (the platform signs the user in; Sign Out leaves the CRM)
   ========================================================= */
function logout() {
  closeMenus(); closeModal(); closeSidebar(); hideGlobal(); closePop();
  $('#zia-chat').hidden = true;
  try { parent.postMessage({ type: 'access:exit' }, location.origin); } catch (e) { }
}
`,
);
patch('sign-in mark', "  $('#tl-mark').innerHTML = icon('graduate');\n", '');
patch('sign-in submit', "  if (f.id === 'login-form') return login();\n", '');
patch('boot',"  seedData();\n  $('#login-email').focus();\n", "  seedData();\n  AUTHED = true;\n  go('home');\n");

// 2. Wording ----------------------------------------------------------------
// Specific sentences first, then the recurring "... in the training simulator." suffix.
const WORDING = [
  ['Training Simulator · demo data resets on refresh', 'Session data resets on refresh'],
  ['          <div class="ni small muted">Training Simulator — not connected to Zoho.</div>\n', ''],
  ['Other Zoho apps are not part of this training simulator.', 'Other Zoho apps are not included in your subscription.'],
  ['Videos are not available offline in the training simulator.', 'Videos are not available right now.'],
  ['cannot be connected from the training simulator.', 'cannot be connected for your organization.'],
  ['The training simulator does not expose a live MCP endpoint.', 'MCP endpoints are not enabled for your organization.'],
  ['Email and portal signals are disabled in the simulator.', 'Email and portal signals are disabled for your organization.'],
  ['Configuration areas of the CRM. In the simulator these open explanatory previews.', 'Configuration areas of the CRM.'],
  ['In this simulator the screen is a preview only — use it to discuss how ${ORG} would set it up.', 'Contact your administrator to change how ${ORG} has set it up.'],
  ['<span class="badge t-amber">Training preview</span>', '<span class="badge t-amber">Administrator setting</span>'],
  [' in the training simulator.', ' for your organization.'],
  ['Zoho CRM (Training)', 'Zoho CRM'],
  ['Reset training data?', 'Reset data?'],
  ['Reset training data', 'Reset data'],
  ['Training data has been reset.', 'Data has been reset.'],
  ['the original training dataset', 'the original data set'],
  ['removed from this training session', 'removed from this session'],
  ['in this training workspace', 'in this workspace'],
  ['Training assistant', 'AI assistant'],
  ['Help and training exercises', 'Help and guided exercises'],
  ['Training Exercises', 'Guided Exercises'],
  ['TRAINING EXERCISES (auto-checked)', 'GUIDED EXERCISES (auto-checked)'],
  ['Practise the core CRM workflows.', 'Work through the core CRM workflows.'],
  ['Open any system report to practise reading and exporting reports.', 'Open any system report to read and export it.'],
  ['so the demo data is identical on every refresh', 'so the standard data is identical on every refresh'],
  ['4. DEMO DATASET', '4. STANDARD DATA SET'],
  // Internal action names that surface in the markup.
  ['data-act="demo"', 'data-act="notice"'],
  ["'demo', '", "'notice', '"],
  ["a === 'demo'", "a === 'notice'"],
  ['  demo: t => {', '  notice: t => {'],
  ['data-act="training"', 'data-act="guide"'],
  ['  training: () => { closePop(); openTraining(); },', '  guide: () => { closePop(); openGuide(); },'],
  ['openTraining', 'openGuide'],
  ['data-act="clone"', 'data-act="copy-record"'],
  ['  clone: t => {', "  'copy-record': t => {"],
  [')} Clone</', ')} Duplicate</'],
];
for (const [find, replace] of WORDING) patch(`wording: ${find.trim().slice(0, 40)}`, find, replace, 'any');

// Final safety checks -------------------------------------------------------
for (const [label, re] of [
  ['embedded sign-in', /id="login-|login-pass|login-form|tl-mark'|AUTH\.|login\(\)/],
  ['hard-coded credential', /hrremedy|Ryf645/i],
  ['prohibited wording', /\b(hr remedy|training|trainee\w*|simulat\w*|demo|demos|practi[cs]e|(?<!\.)prototype|mock(?:ed|s)?|clone[sd]?|dummy)\b/i],
]) {
  const m = html.match(re);
  if (m) {
    console.error(`Integrated file still contains: ${label} (${m[0]})`);
    process.exit(1);
  }
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`Wrote ${out} (${html.length.toLocaleString()} bytes)`);
