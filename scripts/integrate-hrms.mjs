// Integrates a source export of the HR Management (HRMS) single-file app into the
// platform. Every patch is an exact match that must occur the expected number
// of times; if the source changes shape, the script stops instead of guessing.
//
//   node scripts/integrate-hrms.mjs "<path to source .html>"   full integration
//   node scripts/integrate-hrms.mjs --refresh                    re-apply step 6 to the
//                                                                integrated output only
//
// Output: modules/hr-remedy-hrms/index.html (private; never under /public)
//
// What it changes (and nothing else):
//   1. Removes the embedded client-side login (form, SHA-256 credential hashes,
//      handler). The platform's server-side classroom login is the only gate.
//   2. Namespaces localStorage per classroom: hrms_v1:<classroom id>, with a
//      documented eviction policy (see the bridge script below).
//   3. Replaces the artifact-only download API with standard browser downloads.
//   4. Turns "Sign out" into "Exit classroom" (handled by the platform host).
//   5. Keeps the original product branding (logo mark, product and assistant names).
//   6. Wording: no demo/training terminology; "Exit" posts access:exit to the host.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'modules', 'hr-remedy-hrms', 'index.html');
const refresh = process.argv[2] === '--refresh';
const src = refresh ? out : process.argv[2];
if (!src) {
  console.error('Usage: node scripts/integrate-hrms.mjs "<source.html>" | --refresh');
  process.exit(1);
}
let html = readFileSync(src, 'utf8');

function patch(label, find, replace, expected = 1) {
  const count = typeof find === 'string' ? html.split(find).length - 1 : (html.match(new RegExp(find.source, find.flags.includes('g') ? find.flags : find.flags + 'g')) ?? []).length;
  if (count !== expected) {
    console.error(`Patch "${label}": expected ${expected} match(es), found ${count}. Source changed — review the patch.`);
    process.exit(1);
  }
  html = typeof find === 'string' ? html.split(find).join(replace) : html.replace(new RegExp(find.source, find.flags.includes('g') ? find.flags : find.flags + 'g'), replace);
}

if (!refresh) {
// 1. Embedded login --------------------------------------------------------
patch('login css', '#login{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}\n', '');
patch('app hidden until login', '#app{display:none;min-height:100vh}', '#app{min-height:100vh}');
patch('login form', /<div id="login"><form class="box" id="lf"[\s\S]*?<button id="lb" style="width:100%">Sign in<\/button><\/form><\/div>\n/, '');
patch(
  'credential hashes + storage key',
  /const EH="[0-9a-f]{64}",PH="[0-9a-f]{64}",KEY="hrms_v1";/,
  'const KEY="hrms_v1:"+(window.__CLASSROOM__||"standalone");',
);
patch('login handler', /async function sha\(s\)\{[\s\S]*?"Email or password is incorrect\."\};\n/, '');

// 2. Storage that survives a full quota by evicting older classrooms ---------
patch(
  'save',
  'function save(){try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}}',
  'function save(){const v=JSON.stringify(S);for(let n=0;n<8;n++){try{localStorage.setItem(KEY,v);return}catch(e){if(!hrmsEvict())break}}toast("Browser storage is full — recent changes in this classroom may not be kept")}',
);

// 3. Downloads -------------------------------------------------------------
patch(
  'downloads',
  /async function dl\(name,text,type\)\{let d=null;try\{d=await claude\.use\("downloads"\)\}catch\(e\)\{\}\n if\(!d\)\{toast\("Download is not available in this view"\);return\}\n try\{await d\.save\(\{filename:name,data:new Blob\(\[text\],\{type\}\)\}\);\}catch\(e\)\{if\(e&&e\.code!=="declined"\)toast\("Could not save file"\)\}\}/,
  'async function dl(name,text,type){try{const u=URL.createObjectURL(new Blob([text],{type})),a=document.createElement("a");a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000)}catch(e){toast("Could not save file")}}',
);

// 4. Sign out -> exit classroom --------------------------------------------
patch(
  'sign out',
  '<a onclick="location.reload()" style="color:var(--mu)">Sign out</a>',
  '<a onclick="hrmsExit()" style="color:var(--mu)">Exit classroom</a>',
);

// 5. Branding --------------------------------------------------------------

// Bridge: boots the app (the platform already authenticated the student) ---
const bridge = `<script>/* HR Remedy training platform bridge */
(function(){
 // Storage policy: each classroom keeps its own state under hrms_v1:<classroom>.
 // The current classroom plus the two most recently used others are kept;
 // older ones are evicted on entry, and further ones only if the browser quota
 // is exhausted. State is never cleared on navigation or connection loss.
 var IX="hrms_v1:__index";
 function rd(){try{return JSON.parse(localStorage.getItem(IX))||{}}catch(e){return{}}}
 function wr(ix){try{localStorage.setItem(IX,JSON.stringify(ix))}catch(e){}}
 window.hrmsEvict=function(){var ix=rd(),o=Object.keys(ix).filter(function(k){return k!==KEY}).sort(function(a,b){return ix[a]-ix[b]});
  if(!o.length)return false;try{localStorage.removeItem(o[0])}catch(e){}delete ix[o[0]];wr(ix);return true};
 var ix=rd();ix[KEY]=Date.now();
 Object.keys(ix).filter(function(k){return k!==KEY}).sort(function(a,b){return ix[b]-ix[a]}).slice(2)
  .forEach(function(k){try{localStorage.removeItem(k)}catch(e){}delete ix[k]});
 wr(ix);
 window.hrmsExit=function(){try{parent.postMessage({type:"classroom:exit"},location.origin)}catch(e){}};
 authed=true;$("#app").style.display="block";load();go("dash");
})();
</script>
`;
// Anchored to the end of the file: payslip/letter templates also contain </body></html>.
patch('bridge', /<\/body><\/html>\s*$/, `${bridge}</body></html>
`);

}

// 6. Wording (idempotent: applied to a fresh integration or to the output) --
function reword(label, find, replace) {
  if (html.includes(replace) && !html.includes(find)) return; // already applied
  patch(label, find, replace);
}
reword('reload employees button', 'Reload 5,000 demo employees', 'Reload standard employee data (5,000)');
reword('reload employees confirm', 'Replace all employees with 5,000 demo records?', 'Replace all employees with the standard data set of 5,000 employee records?');
reword('letter footer', 'Sample document for HR training only', 'System-generated document');
reword('payslip footer', 'Computer-generated payslip for HR training; no signature required.', 'Computer-generated payslip; no signature required.');
reword('exit link', '>Exit classroom</a>', '>Exit</a>');
reword('exit message', 'parent.postMessage({type:"classroom:exit"},location.origin)', 'parent.postMessage({type:"access:exit"},location.origin)');
reword('bridge comment', '/* HR Remedy training platform bridge */', '/* platform bridge */');
reword('standard data function', 'function loadDemo(){', 'function loadStandardData(){');
reword('standard data call', 'onclick="loadDemo()"', 'onclick="loadStandardData()"');
reword('meeting type', '"Vendor demo"', '"Vendor presentation"');
if (/S\.demo\b/.test(html)) patch('standard data flag', /S\.demo\b/, 'S.std', 2);

// Final safety checks -------------------------------------------------------
for (const [label, re] of [
  ['credential hash', /\b[0-9a-f]{64}\b/],
  ['third-party brand', /darwin/i],
  ['artifact runtime API', /claude\.use/],
  ['embedded login', /id="login"/],
  ['prohibited wording', /\b(training|trainee\w*|simulat\w*|demo|practi[cs]e|(?<!\.)prototype|mock|clone|dummy)\b/i],
]) {
  if (re.test(html)) {
    console.error(`Integrated file still contains: ${label}`);
    process.exit(1);
  }
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`Wrote ${out} (${html.length.toLocaleString()} bytes)`);
