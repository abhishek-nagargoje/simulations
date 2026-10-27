// Builds the SAP ERP module from the supplied single-file application.
//
//   node scripts/build-sap-module.mjs            (reads modules/sap-erp/source/SAP.html)
//   node scripts/build-sap-module.mjs <source>   (another export of the same application)
//
// Output: modules/sap-erp/index.html — private, served only through the
// protected route for an authorized access session. The source file is never
// modified. Every patch is an exact match that must occur the expected number
// of times; if the source changes shape the build stops instead of guessing.
//
// What the build changes (and why):
//   1. Login: the embedded login screen, its SHA-256 credential hash and the
//      sessionStorage logon flag are removed. The platform authenticates the
//      student; the module opens directly.
//   2. Data: the embedded data set (RAW) and localStorage persistence are
//      removed. Data is loaded from the server (PostgreSQL workspace of the
//      access session). Each user action's changes are committed as one batch;
//      the server assigns document numbers and validates the postings, and
//      success messages appear only after the server confirmed the commit.
//      Failed commits are rolled back in the browser and reported.
//      Only personal preferences (variants, layouts, history) stay in the browser.
//   3. Accounting corrections: reversals post a real reversal document; the
//      customer payment in F-53 is posted on the credit side; residual items get
//      the period and fiscal year of their posting date; fiscal years are derived
//      from posting dates; G/L open-item status is taken from the documents
//      instead of being derived from document number digits.
//   4. Functions that only pretended to work (background jobs, attachments,
//      notes, hold, team settings...) now say they are not available.
//   5. Wording: no training/simulation/practice terminology; "Simulate" is
//      "Preview", "Simulation Run" is "Validation Run".
//   6. Branding: the SAP logo imitation and the SAP GUI splash image are
//      replaced by an original mark and background. Textual references to SAP
//      functionality (transaction codes, SAP table names) remain.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2] ?? join(root, 'modules', 'sap-erp', 'source', 'SAP.html');
let html = readFileSync(src, 'utf8');

function count(find) {
  return typeof find === 'string'
    ? html.split(find).length - 1
    : (html.match(new RegExp(find.source, find.flags.includes('g') ? find.flags : find.flags + 'g')) ?? []).length;
}
function patch(label, find, replace, expected = 1) {
  const n = count(find);
  if (n !== expected) {
    console.error(`Patch "${label}": expected ${expected} match(es), found ${n}. Source changed — review the patch.`);
    process.exit(1);
  }
  html = typeof find === 'string'
    ? html.split(find).join(replace)
    : html.replace(new RegExp(find.source, find.flags.includes('g') ? find.flags : find.flags + 'g'), () => replace);
}

// ---------------------------------------------------------------------------
// 1. Login and embedded data
// ---------------------------------------------------------------------------
patch('title', '<title>SAP</title>', '<title>SAP ERP</title>');
patch('login css', /\/\* login \*\/\n#login\{[\s\S]*?\.lgsys\{[^\n]*\n/, '');
patch('login markup', /<div id="login">[\s\S]*?<\/div><\/div><\/div>\n/, '');
patch('splash image', /const HERO="data:image\/jpeg;base64,[A-Za-z0-9+/=]+";\n/, '');
patch('embedded data set', /const RAW=\{[^\n]*\};\n/, '');
patch('login handler', /\/\* login \(unchanged credentials\) \*\/\nconst H='[0-9a-f]{64}';\n[^\n]*async function sha[^\n]*\n[^\n]*async function logon[^\n]*\n/, '');
patch('login wiring',
  "$('#lg').onclick=logon;$('#pw').onkeydown=e=>{if(e.key=='Enter')logon()};$('#em').onkeydown=e=>{if(e.key=='Enter')$('#pw').focus()};\n$('#lglogo').innerHTML=LOGO(54);document.body.appendChild(TIP);\nif(sessionStorage.getItem('nr5_logon'))start();",
  'document.body.appendChild(TIP);\nboot();');
patch('start without login',
  "function start(){$('#login').style.display='none';$('#app').style.display='flex';if(STARTED)return;STARTED=true;loadTables();bindForm($('#scr'));",
  "function start(){$('#app').style.display='flex';if(STARTED)return;STARTED=true;bindForm($('#scr'));");
patch('log off returns to the platform',
  "{t:'Yes',p:1,a:()=>{sessionStorage.removeItem('nr5_logon');location.reload()}}",
  "{t:'Yes',p:1,a:()=>{closeDlg();try{parent.postMessage({type:'access:exit'},location.origin)}catch(e){}}}");

// ---------------------------------------------------------------------------
// 2. Data layer: server-backed workspace
// ---------------------------------------------------------------------------
const DATA_LAYER = String.raw`const T={},META={};
const KEY={T001:'BUKRS',SKA1:'SAKNR',CSKS:'KOSTL',MARA:'MAKTX',LFA1:'LIFNR',KNA1:'KUNNR',BSIK:'BELNR',BSID:'BELNR',EKPO:['EBELN','EBELP'],MSEG:['MBLNR','ZEILE'],RBKP:['BELNR','EBELN','EBELP'],VIMDP:'DOCID',SWWWIHEAD:'WI_ID',FKKVKP:'VKONT',DFKKOP:'OPBEL',DFKKBIX:'BITID',DFKKINVBILL:'INVDOC',DFKKZK:'KEYZ1',DFKKZP:['KEYZ1','POSZA'],FEBEP:['KUKEY','ESNUM'],GLDOC:'BELNR',LOG:'ID',RUNS:'RUNID'};
const kOf=(tb,r)=>{const k=KEY[tb];return Array.isArray(k)?k.map(x=>r[x]).join('/'):r[k]};
/* Business data lives in the server database, in the workspace of the current
   access session. The changes of one user action are sent as one batch and
   applied atomically by the server, which assigns document numbers and
   validates them. Success messages are shown only after the server confirmed
   the batch. Only personal preferences (variants, layouts, history) are kept
   in this browser. */
const ACCESS=window.__ACCESS__||{};
const API=ACCESS.api||'';
let ST;
const LSK='erp_prefs:'+(ACCESS.id||'local');
function stInit(){return{vari:{},hist:[],lay:{}}}
function loadPrefs(){try{ST=JSON.parse(localStorage.getItem(LSK))||stInit()}catch(e){ST=stInit()}ST.vari=ST.vari||{};ST.hist=ST.hist||[];ST.lay=ST.lay||{}}
function persist(){try{localStorage.setItem(LSK,JSON.stringify(ST))}catch(e){}}
async function fetchData(){const r=await fetch(API+'/data',{cache:'no-store',credentials:'same-origin'});if(!r.ok){const e=new Error('load');e.status=r.status;throw e}return r.json()}
function applyData(d){for(const k in T)delete T[k];for(const k in META)delete META[k];
  for(const k in d.tables){const t=d.tables[k];META[k]={c:t.c,l:t.l,d:t.d};T[k]=t.r.map(r=>{const o={};t.c.forEach((c,i)=>o[c]=r[i]);return o})}
  const L=d.lines||{};for(const tb in L){const ix={};(T[tb]||[]).forEach(r=>ix[r.BELNR]=r);for(const b in L[tb])if(ix[b])ix[b].IT=L[tb][b]}
  GLC=null}
async function loadTables(){loadPrefs();applyData(await fetchData())}
async function reloadData(){if(TXB)return;try{applyData(await fetchData())}catch(e){return ended(e.status)}if(STK.length)redraw();else home();msgRaw('Data reloaded from the server','s')}
let TXB=null,PHN=0,SAVING=false;const PHMAP={};
const PH_RE=/\{#[A-Z0-9]+\.[0-9]+#\}/g;
const sub=s=>typeof s=='string'&&s.indexOf('{#')>=0?s.replace(PH_RE,m=>PHMAP[m]||m):s;
const uuid=()=>crypto.randomUUID?crypto.randomUUID():'10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
function batch(){if(!TXB){TXB={id:uuid(),ops:[],undo:[],msgs:[],refs:[],after:[]};queueMicrotask(flush)}return TXB}
const snap=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
function upd(tb,r,ch){const b=batch();const key={};[].concat(KEY[tb]).forEach(k=>key[k]=r[k]);const prev={},expect={};
  for(const k in ch){prev[k]=snap(r[k]);if(k!='IT')expect[k]=r[k]==null?'':r[k]}
  b.ops.push({op:'update',t:tb,key,set:snap(ch),expect});b.undo.push(()=>{for(const k in prev){if(prev[k]===undefined)delete r[k];else r[k]=prev[k]}});
  Object.assign(r,ch);b.refs.push(r);GLC=null}
function addRow(tb,r){const b=batch();T[tb].push(r);b.ops.push({op:'insert',t:tb,row:snap(r)});b.undo.push(()=>{const i=T[tb].indexOf(r);if(i>=0)T[tb].splice(i,1)});b.refs.push(r);GLC=null;return r}
/* The number is assigned by the server; until then a unique placeholder stands in for it. */
function nr(name){batch();return'{#'+name.toUpperCase()+'.'+(++PHN)+'#}'}
function onCommitted(fn){if(TXB&&!TXB.sent)TXB.after.push(fn);else fn()}
function fixObj(o,seen){if(!o||typeof o!='object'||seen.has(o))return;seen.add(o);for(const k in o){const v=o[k];if(typeof v=='string'){if(v.indexOf('{#')>=0)o[k]=sub(v)}else if(v&&typeof v=='object')fixObj(v,seen)}}
function fixDom(root){const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode()))if(n.nodeValue.indexOf('{#')>=0)n.nodeValue=sub(n.nodeValue);$$('input,textarea',root).forEach(i=>{if(i.value.indexOf('{#')>=0)i.value=sub(i.value)});$$('[title]',root).forEach(e=>{if(e.title.indexOf('{#')>=0)e.title=sub(e.title)})}
function saving(on){SAVING=on;let o=document.getElementById('saving');if(on&&!o){o=document.createElement('div');o.id='saving';o.className='ov';o.innerHTML='<div class="dlg" style="min-width:260px" role="status" aria-live="polite"><div class="db">Saving changes&hellip;</div></div>';document.body.appendChild(o)}if(!on&&o)o.remove()}
function ended(status){try{parent.postMessage({type:'access:ended',status:status||401},location.origin)}catch(e){}closeAllDlg();$('#scr').innerHTML='<div class="note" style="padding:30px" role="alert">Your access to this application has ended.</div>';setFoot([]);setTB([])}
async function flush(){const b=TXB;if(!b||b.sent)return;b.sent=true;saving(true);let res=null,err=null;
  for(let a=0;a<3;a++){try{const r=await fetch(API+'/commit',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify({requestId:b.id,ops:b.ops})});const body=await r.json().catch(()=>null);
      if(r.ok&&body){res=body;err=null;break}err={status:r.status,message:body&&body.error&&body.error.message};if(r.status<500)break}
    catch(e){err={status:0,message:''}}
    await new Promise(z=>setTimeout(z,400*(a+1)))}
  TXB=null;saving(false);
  if(res){Object.assign(PHMAP,res.numbers||{});const seen=new Set();b.refs.forEach(r=>fixObj(r,seen));fixObj(ST,seen);persist();fixDom(document.body);
    b.after.forEach(f=>f());const shown=b.msgs.filter(m=>m[0]);if(shown.length){const m=shown[shown.length-1];msgRaw(sub(m[0]),m[1])}return}
  if(err.status==401||err.status==403){ended(err.status);return}
  if(err.status==409||err.status==0||err.status>=500){try{applyData(await fetchData())}catch(e){return ended(e.status)}if(STK.length)redraw();msgRaw(err.status==409&&err.message?err.message:'The changes could not be confirmed. The data has been reloaded from the server - check the result before repeating the step.','e');return}
  b.undo.reverse().forEach(u=>u());GLC=null;if(STK.length)redraw();msgRaw('Changes could not be saved: '+(err.message||'the server rejected the request.'),'e')}
function msg(t,ty){if(TXB&&!TXB.sent){TXB.msgs.push([t,ty]);return}msgRaw(t,ty)}
const fyOf=iso=>{const y=+String(iso).slice(0,4),m=+String(iso).slice(5,7);return String(m>=4?y:y-1)};
/* Render guard: replacing a screen removes the focused input, which fires a
   'change' event that would start a second, nested re-render. Screens read
   their inputs before re-rendering, so such events are ignored. */
(()=>{const d=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');let depth=0;
  Object.defineProperty(Element.prototype,'innerHTML',{configurable:true,get(){return d.get.call(this)},set(v){depth++;try{d.set.call(this,v)}finally{depth--}}});
  document.addEventListener('change',e=>{if(depth)e.stopImmediatePropagation()},true)})();
async function boot(){$('#app').style.display='flex';$('#scr').innerHTML='<div class="note" style="padding:30px" role="status">Loading data&hellip;</div>';
  try{await loadTables()}catch(e){if(e.status==401||e.status==403)return ended(e.status);$('#scr').innerHTML='<div class="note" style="padding:30px" role="alert">The data could not be loaded. <button class="sbtn" id="retry">Try again</button></div>';$('#retry').onclick=boot;return}
  start()}
`;
patch('data layer', /const T=\{\},META=\{\};\n[\s\S]*?function resetData\(\)\{[^\n]*\n/, DATA_LAYER);
patch('status bar message', 'function msg(t,ty){const b=$(\'#sbar\')', 'function msgRaw(t,ty){const b=$(\'#sbar\')');
patch('escape substitutes assigned numbers', "const esc=s=>String(s??'')", "const esc=s=>String(sub(s)??'')");
patch('fiscal year constant', 'const TDY=fd(TODAY);', 'const TDY=fd(TODAY),FY=fyOf(TODAY);');
patch('block input while saving',
  "document.addEventListener('keydown',e=>{if($('#app').style.display!='flex')return;",
  "document.addEventListener('keydown',e=>{if(SAVING){e.preventDefault();return}if($('#app').style.display!='flex')return;");
patch('reload instead of reset',
  "['Extras',[['Practice Tasks',practice,true],['Training Data Overview',dataInfo,true],['Reset Training Data',()=>dlg({t:'Reset Training Data',w:460,b:'All postings you made in this browser will be removed and the original 500-record data set restored.<br><br>Continue?',btn:[{t:'Yes',p:1,a:()=>{resetData();closeDlg();home();msg('Training data restored to the original data set','s')}},{t:'No',a:closeDlg}]}),true]]]",
  "['Extras',[['Work Queue',workQueue,true],['Data Overview',dataInfo,true],['Reload Data',reloadData,true]]]");
// Upload logs and productive run IDs are business records -> database tables.
patch('upload log view',
  "const L=T.LOG.filter(l=>l.TC=='Z_MASS_UPLOAD').concat((ST.logs||[]).filter(l=>l.TC=='Z_MASS_UPLOAD'));",
  "const L=T.LOG.filter(l=>l.TC=='Z_MASS_UPLOAD');");
patch('upload log write',
  "ST.logs=ST.logs||[];ST.logs.push({TC:'Z_MASS_UPLOAD',TS:TDY+' '+nowT(),TXT:`${sim?'Simulation':'Upload'}: ${log.filter(l=>l.T=='S').length} ok, ${log.filter(l=>l.T=='E').length} errors`,ID:file?file.name:'',T:log.some(l=>l.T=='E')?'W':'S'});persist();",
  "addRow('LOG',{ID:nr('log'),TC:'Z_MASS_UPLOAD',TS:TDY+' '+nowT(),TXT:`${sim?'Validation':'Upload'}: ${log.filter(l=>l.T=='S').length} ok, ${log.filter(l=>l.T=='E').length} errors`,FILE:file?file.name:'',T:log.some(l=>l.T=='E')?'W':'S'});");
patch('upload log rows', "logScreen('Upload Logs',L.map((l,i)=>({ROW:l.TS,T:l.T||'S',MSG:l.TXT,DOC:l.ID})))",
  "logScreen('Upload Logs',L.map((l,i)=>({ROW:l.TS,T:l.T||'S',MSG:l.TXT,DOC:l.FILE})))");
patch('run id check', "if((ST.runs||[]).includes(ri)&&!val('tr'))", "if(T.RUNS.some(r=>r.RUNID==ri)&&!val('tr'))");
patch('run id write', "if(!test){ST.runs=(ST.runs||[]).concat(ri);persist()}", "if(!test)addRow('RUNS',{RUNID:ri,TS:TDY+' '+nowT()});");

// Screens that open a document right after saving it wait for the server's number.
patch('show new purchase order after commit',
  "ST.lastPO=no;persist();const f=CUR();replace(poScreen('display',no));msg(`Standard PO created under the number ${no}`,'s')},",
  "msg(`Standard PO created under the number ${no}`,'s');const f=CUR();onCommitted(()=>{ST.lastPO=sub(no);persist();if(CUR()===f)replace(poScreen('display',sub(no)))})},");
patch('show new business partner after commit',
  "closeDlg();msg(`Business partner ${id} created`,'s');bpDisplay(id)}",
  "closeDlg();msg(`Business partner ${id} created`,'s');onCommitted(()=>bpDisplay(sub(id)))}");

// ---------------------------------------------------------------------------
// 3. Accounting corrections
// ---------------------------------------------------------------------------
// Fiscal year from the posting date (GJAHR was hard-coded to 2026).
patch('fy clearing doc', "addRow('GLDOC',{BELNR:no,BUKRS:sel[0].BUKRS,GJAHR:'2026',", "addRow('GLDOC',{BELNR:no,BUKRS:sel[0].BUKRS,GJAHR:fyOf(TODAY),");
patch('fy outgoing payment', "Object.assign({BELNR:no,BUKRS:h.BUKRS,GJAHR:'2026',BLART:h.BLART||'KZ'", "Object.assign({BELNR:no,BUKRS:h.BUKRS,GJAHR:fyOf(h.BUDAT),BLART:h.BLART||'KZ'");
patch('fy down payment request', "addRow('BSIK',{BELNR:no,BUKRS:h.BUKRS,GJAHR:'2026',BLART:h.BLART||'KA'", "addRow('BSIK',{BELNR:no,BUKRS:h.BUKRS,GJAHR:fyOf(h.BUDAT),BLART:h.BLART||'KA'");
patch('fy down payment clearing', "addRow('BSIK',{BELNR:no,BUKRS:h.BUKRS,GJAHR:'2026',BLART:'KA'", "addRow('BSIK',{BELNR:no,BUKRS:h.BUKRS,GJAHR:fyOf(h.BUDAT),BLART:'KA'");
patch('fy general posting', "const base={BELNR:no,BUKRS:h.BUKRS,GJAHR:'2026',", "const base={BELNR:no,BUKRS:h.BUKRS,GJAHR:fyOf(h.BUDAT),");
patch('year material document', "addRow('MSEG',{MBLNR:no,MJAHR:'2026',", "addRow('MSEG',{MBLNR:no,MJAHR:String(m.hdr.BUDAT).slice(0,4),");
patch('fy invoice', "({BELNR:no,GJAHR:'2026',BUKRS:m.cc,", "({BELNR:no,GJAHR:fyOf(m.h.BUDAT),BUKRS:m.cc,");
patch('fy invoice upload', "addRow('RBKP',{BELNR:no,GJAHR:'2026',BUKRS:p.BUKRS,", "addRow('RBKP',{BELNR:no,GJAHR:fyOf(TODAY),BUKRS:p.BUKRS,");
patch('fy defaults', "w4 v:2026'", "w4 v:'+FY", 5);
patch('fy default find', "fy=fy||'2026';", 'fy=fy||FY;');
patch('fy po history link', "showInv(iv.dataset.iv,'2026')", "showInv(iv.dataset.iv)");
// Residual items carry the period and fiscal year of their own posting date.
patch('residual item period',
  "STATUS:'Open',AUGBL:'',AUGDT:'',SGTXT:'Residual item '+r.BELNR,BKTXT:'Residual item',BUDAT:TODAY,IT:null}",
  "STATUS:'Open',AUGBL:'',AUGDT:'',STBLG:'',SGTXT:'Residual item '+r.BELNR,BKTXT:'Residual item',BUDAT:TODAY,MONAT:per(TODAY),GJAHR:fyOf(TODAY),IT:null}");
// Reversal: post a reversal document that offsets every line of the original.
patch('reversal document',
  "function reverseDoc(d,reason,pdate){if(d.STATUS=='Reversed')return`Document ${d.BELNR} has already been reversed`;if(d.STATUS=='Cleared')return`Document ${d.BELNR} contains cleared items - reset the clearing first (FBRA)`;if(d.UMSKZ=='F'&&false)return'';\n  const no=nr('rev','BSIK','STBLG');upd(T.BSIK.includes(d)?'BSIK':'BSID',d,{STATUS:'Reversed',STBLG:no,AUGBL:no,AUGDT:pdate||TODAY});\n  if(d.EBELN){}return true}",
  "const SWAPK={'01':'11','11':'01','05':'15','15':'05','21':'31','31':'21','25':'35','35':'25','29':'39','39':'29','40':'50','50':'40','70':'75','75':'70','86':'96','96':'86','89':'99','99':'89'};\n" +
  "function postReversal(d,pdate){const b=pdate||TODAY;const no=nr('fi');addRow('GLDOC',{BELNR:no,BUKRS:d.BUKRS,GJAHR:fyOf(b),BLART:d.BLART||'SA',BLDAT:b,BUDAT:b,MONAT:per(b),XBLNR:d.XBLNR||'',BKTXT:'Reversal of '+d.BELNR,WAERS:d.WAERS||'INR',USNAM:USER,STATUS:'Posted',STBLG:'',\n" +
  "  IT:docItems(d).map((i,k)=>({BUZEI:String(k+1).padStart(3,'0'),BSCHL:SWAPK[i.BSCHL]||i.BSCHL,KOART:i.KOART,ACC:i.ACC,AMT:r2(-i.AMT),MWSKZ:i.MWSKZ||'',ZUONR:i.ZUONR||'',SGTXT:'Reversal of '+d.BELNR,KOSTL:i.KOSTL||'',UMSKZ:i.UMSKZ||'',GSBER:i.GSBER||''}))});return no}\n" +
  "function reverseDoc(d,reason,pdate){if(d.STATUS=='Reversed')return`Document ${d.BELNR} has already been reversed`;if(d.STATUS=='Cleared')return`Document ${d.BELNR} contains cleared items - reset the clearing first (FBRA)`;\n" +
  "  const no=postReversal(d,pdate);upd(T.BSIK.includes(d)?'BSIK':'BSID',d,{STATUS:'Reversed',STBLG:no,AUGBL:no,AUGDT:pdate||TODAY});return true}");
patch('reversal of G/L document',
  "if(f._t=='GLDOC'){if(f.d.STATUS=='Reversed')return msg('Document has already been reversed','e');const no=nr('rev','BSIK','STBLG');upd('GLDOC',f.d,{STATUS:'Reversed',STBLG:no});",
  "if(f._t=='GLDOC'){if(f.d.STATUS=='Reversed')return msg('Document has already been reversed','e');const pdg=pd(val('budat'));const no=postReversal(f.d,pdg&&pdg!='BAD'?pdg:TODAY);upd('GLDOC',f.d,{STATUS:'Reversed',STBLG:no});");
// Customer payments are credit items (posting key 15), vendor payments debit items (25).
patch('incoming payment side',
  "BSCHL:'25',SHKZG:'S',UMSKZ:'',WRBTR:amt,WAERS:h.WAERS,MWSKZ:'',WMWST:0,HKONT:val('hkont')",
  "BSCHL:kt=='K'?'25':'15',SHKZG:kt=='K'?'S':'H',UMSKZ:'',WRBTR:amt,WAERS:h.WAERS,MWSKZ:'',WMWST:0,HKONT:val('hkont')");
// F-53 records no difference posting, so a charged-off difference would leave the clearing unbalanced.
patch('charge off only where a difference document is posted',
  "{t:'Charge off Difference',a:()=>{const c=calc();",
  "{t:'Charge off Difference',a:()=>{if(o.noCharge)return msg('Use \"Distribute Difference\" to keep the difference as a residual item','w');const c=calc();");
patch('outgoing payment without charge-off',
  "pay:kt=='K'?amt:-amt,bank:val('hkont'),date:h.BUDAT,",
  "pay:kt=='K'?amt:-amt,bank:val('hkont'),date:h.BUDAT,noCharge:1,");
// G/L open items: status from the documents (was derived from document number digits).
patch('gl line document reference',
  "out.push({HKONT:recon,BUKRS:d.BUKRS,",
  "out.push({_d:d,HKONT:recon,BUKRS:d.BUKRS,");
patch('gl open item status',
  "else{const k=+l.BELNR.slice(-1)%3;l.STATUS=k?'Cleared':'Open';if(k){l.AUGBL='1990'+l.BELNR.slice(-6);l.AUGDT=l.BUDAT}}});",
  "else{const d=l._d;if(d&&d.STATUS=='Reversed'){l.STATUS='Reversed';l.AUGBL=d.STBLG||'';l.AUGDT=d.AUGDT||l.BUDAT}else l.STATUS='Open'}});");
patch('cancelled invoice reversal lines',
  "T.RBKP.filter(r=>r.FIDOC).forEach(r=>add(invFi(r),'RBKP'));",
  "T.RBKP.filter(r=>r.FIDOC).forEach(r=>{const f=invFi(r);add(f,'RBKP');if(r.STATUS=='Cancelled'&&r.STBLG)add(Object.assign({},f,{BELNR:r.STBLG,STATUS:'Posted',BKTXT:'Cancellation of '+r.BELNR,IT:docItems(f).map(i=>Object.assign({},i,{AMT:r2(-i.AMT)}))}),'RBKP')});");
// Workflow: completed or cancelled work items keep their final status.
patch('work item final status',
  "const setSt=(sl,o,st,m)=>{if(!sl.length)return msg('Select at least one work item','w');sl.forEach(r=>upd('SWWWIHEAD',r,{WI_STAT:st}));alvRedraw(o);msg(`${sl.length} work item(s) ${m}`,'s')};",
  "const setSt=(sl,o,st,m)=>{if(!sl.length)return msg('Select at least one work item','w');const L=sl.filter(r=>r.WI_STAT!=st&&r.WI_STAT!='COMPLETED'&&r.WI_STAT!='CANCELLED');if(!L.length)return msg('The selected work items are already completed or cancelled','w');L.forEach(r=>upd('SWWWIHEAD',r,{WI_STAT:st}));alvRedraw(o);msg(`${L.length} work item(s) ${m}`,'s')};");
// VIM: completed documents are final; posting assigns an invoice reference in the workflow.
patch('vim actions on completed documents',
  "const act=(ch,m)=>{upd('VIMDP',r,ch);redraw();msg(m,'s')};",
  "const act=(ch,m)=>{if(r.TAB=='My Completed')return msg('Document is already completed','w');upd('VIMDP',r,ch);redraw();msg(m,'s')};");
patch('vim post message',
  "act({PROC_STATUS:'Posted',TAB:'My Completed',INVDOC:no,EXCEPTION:''},`Invoice document ${no} posted for DP document ${r.DOCID}`)",
  "act({PROC_STATUS:'Posted',TAB:'My Completed',INVDOC:no,EXCEPTION:''},`DP document ${r.DOCID} completed - invoice reference ${no} assigned`)");
patch('vim bulk on completed documents',
  "function doBulk(ch,m){const sl=alvSel(a);if(!sl.length)return msg('Select at least one document','w');sl.forEach(",
  "function doBulk(ch,m){const sl=alvSel(a).filter(r=>r.TAB!='My Completed');if(!sl.length)return msg('Select at least one document that is not completed','w');sl.forEach(");
patch('vim dispute on completed documents',
  "disp:()=>{const sl=alvSel(a);if(!sl.length)return msg('Select a document','w');",
  "disp:()=>{const sl=alvSel(a).filter(r=>r.TAB!='My Completed');if(!sl.length)return msg('Select a document that is not completed','w');");
// Scanned documents: the vendor is unknown until data entry (was a random vendor).
patch('scan without invented vendor',
  "const v=T.LFA1[Math.floor(Math.random()*T.LFA1.length)];const id=nr('dp','VIMDP','DOCID',10);addRow('VIMDP',{DOCID:id,BUKRS:v.BUKRS,LIFNR:v.LIFNR,NAME1:v.NAME1,",
  "const id=nr('dp','VIMDP','DOCID',10);addRow('VIMDP',{DOCID:id,BUKRS:'1000',LIFNR:'',NAME1:'',");
patch('vim display without vendor', "['Supplier',r.LIFNR+' '+r.NAME1]", "['Supplier',r.LIFNR?r.LIFNR+' '+r.NAME1:'(data entry required)']");

// ---------------------------------------------------------------------------
// 4. Functions that did nothing but reported success
// ---------------------------------------------------------------------------
const NA = "msg('This function is not available in this configuration','w')";
patch('background job', "function bgJob(){const j='BG_'+TC.replace(/\\W/g,'')+'_'+Date.now().toString().slice(-6);msg(`Background job ${j} was scheduled`,'s')}",
  "function bgJob(){msg('Background processing is not available in this configuration - execute the program online (F8)','w')}");
patch('editing options', "btn:[{t:'Save',p:1,a:()=>{closeDlg();msg('Editing options saved','s')}},{t:'Cancel',a:closeDlg}]",
  "btn:[{t:'OK',p:1,a:()=>{closeDlg();msg('Editing options are fixed in this configuration','i')}},{t:'Cancel',a:closeDlg}]");
patch('po hold', "{i:'hold',tip:'Hold',a:()=>{syncHdr();ST.held=ST.held||[];ST.held.push({h:po.h,it:used(),d:TDY});persist();msg(`Purchase order held (${ST.held.length} held document(s))`,'s')}}",
  "{i:'hold',tip:'Hold',a:()=>msg('Hold is not available in this configuration - save the purchase order instead','w')}");
patch('po services',
  "[['Create...',[['Create Attachment',()=>pickFile('',(t,f)=>msg(`Attachment ${f.name} created`,'s'),1)],['Create Note',()=>dlg({t:'Create Note',w:500,b:'<span class=\"fw\"><textarea rows=\"5\" style=\"width:440px\"></textarea></span>',btn:[{t:'Save',p:1,a:()=>{closeDlg();msg('Note created','s')}}]})],['Store Business Document',()=>msg('Business document stored','s')]]],['Attachment List',()=>infoDlg('Attachment List','No attachments exist for this object')],['Send',()=>msg('Object sent to SAP inbox','s')],['Workflow',",
  `[['Create...',[['Create Attachment',()=>${NA}],['Create Note',()=>${NA}],['Store Business Document',()=>${NA}]]],['Attachment List',()=>infoDlg('Attachment List','No attachments exist for this object')],['Send',()=>${NA}],['Workflow',`);
patch('po my objects', "['My Objects',()=>msg('Object added to My Objects','s')]", `['My Objects',()=>${NA}]`);
patch('migo services',
  "popMenu(b,[['Create Attachment',()=>pickFile('',(t,f)=>msg(`Attachment ${f.name} created`,'s'),1)],['Attachment List',()=>infoDlg('Attachment List','No attachments')],['Send',()=>msg('Object sent','s')]])",
  `popMenu(b,[['Create Attachment',()=>${NA}],['Attachment List',()=>infoDlg('Attachment List','No attachments')],['Send',()=>${NA}]])`);
patch('migo hold button', "{t:'Hold',a:()=>{sync();msg('Document held','s')}}", `{t:'Hold',a:()=>msg('Hold is not available in this configuration - post the document instead','w')}`);
patch('migo hold icon', "if(a=='hold')return msg('Document held','s');", "if(a=='hold')return msg('Hold is not available in this configuration - post the document instead','w');");
patch('clearing proposal', "msg('Clearing proposal created - selected items are proposed','s')", "msg('The clearing proposal is created on the initial screen (Create Proposal); proposed items are selected','i')");
patch('upload schema refresh', "sref:()=>msg('Upload schema refreshed','s')", "sref:()=>msg('Upload schema CSV1 is current','i')");
patch('team configuration', "btn:[{t:'Save',p:1,a:()=>{closeDlg();msg('Team configuration saved','s')}},{t:'Cancel',a:closeDlg}]",
  "btn:[{t:'Close',p:1,a:()=>{closeDlg();msg('The team configuration cannot be changed in this configuration','i')}}]");
patch('work view switch', "msg(`Switched to ${v}`,'s')", "msg(`${v}: the work list is the same for all views in this configuration`,'i')");

// ---------------------------------------------------------------------------
// 5. Wording
// ---------------------------------------------------------------------------
patch('user id', "const USER='TRAINEE01';", "const USER='ERPUSER01';");
patch('team list user', "'TRAINEE01 AP Processor'", "'ERPUSER01 AP Processor'");
patch('own data', "['Last Name','Trainee'],['First Name','SAP'],['Function','Finance & Procurement Trainee']",
  "['Last Name','User'],['First Name','ERP'],['Function','Finance & Procurement']");
patch('user menu', "['SAP Menu',()=>msg('SAP Menu is not part of this training system. Use Favorites.','i')]",
  "['User Menu',()=>msg('The user menu is not available in this configuration. Use Favorites or the command field.','i')]");
patch('favorites add', "msg('Use the command field to start any transaction; favorites are fixed for this training.','i')",
  "msg('Favorites are fixed in this configuration. Use the command field to start any transaction.','i')");
patch('favorites fixed', "msg('Favorites are fixed in this training system','i')", "msg('Favorites are fixed in this configuration','i')", 2);
patch('home title', "setTitle('SAP Easy Access')", "setTitle('Easy Access')");
patch('help title', "CUR()?CUR().title:'SAP Easy Access'", "CUR()?CUR().title:'Easy Access'");
patch('document title fallback', "document.title=t||'SAP'", "document.title=t||'SAP ERP'");
patch('help text',
  "All data in this training system is dummy data (500 records per main table). Postings are stored only in this browser.",
  "Postings and changes are saved in the database of this workspace when you post or save. Everyone signed in with the same access shares this workspace. Use Extras &gt; Reload Data to see changes made by others.");
patch('send', "msg('Send is not available in the training system - use Spreadsheet export','w')", "msg('Send is not available in this configuration - use Spreadsheet export','w')");
patch('selection screen settings', "'The selection screen layout is fixed in this training system.'", "'The selection screen layout is fixed in this configuration.'");
patch('additional selection', 'is not supported in the training system - all items are proposed', 'is not available in this configuration - all items are proposed');
patch('preview function', /function simulate\(\)/, 'function preview()');
patch('preview calls', /simulate\(\)/, 'preview()', 2);
patch('preview title', "'Document Overview (Simulation)'", "'Document Overview (Preview)'");
patch('preview buttons', "{t:'Simulate',", "{t:'Preview',", 5);
patch('preview check', "'Simulation: document is balanced and can be posted'", "'Preview: document is balanced and can be posted'");
patch('preview document', "infoDlg('Simulate Document',", "infoDlg('Preview Document',");
patch('F-03', 'which is not part of this training', 'which is not available in this configuration');
patch('one partner per document', "'Only one vendor or customer item per document is supported in the training system'", "'Only one vendor or customer item per document is supported in this configuration'");
patch('additional assignments', "'Additional account assignments are not required in the training system.'", "'Additional account assignments are not available in this configuration.'");
patch('miro item tabs', 'not required for PO-based invoices in this training.', 'not used for PO-based invoices in this configuration.', 2);
patch('validation run', "{t:'Simulation Run',i:'clock',a:()=>run2(1)}", "{t:'Validation Run',i:'clock',a:()=>run2(1)}");
patch('validation run row', "MSG:'Simulation: item can be created'", "MSG:'Validation: item can be created'");
patch('validation run log', "logScreen(sim?'Simulation Run - Log':'Mass Upload for PO - Log',log);msg(`${sim?'Simulation':'Upload'} finished:",
  "logScreen(sim?'Validation Run - Log':'Mass Upload for PO - Log',log);msg(`${sim?'Validation':'Upload'} finished:");
patch('currency', "'Only currency INR is used in this training system'", "'Only currency INR is used in this configuration'");
patch('upload schema maintenance', "'Upload schemas are maintained in Customizing (not in this training)'", "'Upload schemas are maintained in Customizing (not available in this configuration)'");
patch('customer copy', "'Copy reference: use XD01 (not part of this training)'", "'Copy reference: use XD01 (not available in this configuration)'");
patch('maintain entries', "'Maintain Entries is not authorized in this training system - display only'", "'Maintain Entries is not authorized - display only'");
patch('scanned image', 'Scanned image (simulation) - bar code', 'Scanned image - bar code');
patch('work queue section', '/* ===================== favorites, practice, startup ===================== */', '/* ===================== favorites, work queue, startup ===================== */');
patch('work queue function', 'function practice(){', 'function workQueue(){');
patch('work queue first task', "(company code ${T.BSIK[0].BUKRS}, 2026)", "(company code ${T.BSIK[0].BUKRS}, ${T.BSIK[0].GJAHR})");
patch('work queue title', "dlg({t:'Practice Tasks',w:760,", "dlg({t:'Work Queue',w:760,");
patch('data overview',
  "function dataInfo(){infoDlg('Training Data Overview',`<table class=\"alv\"><thead><tr><th>Table</th><th>Contents</th><th class=\"r\">Rows</th></tr></thead><tbody>${Object.keys(META).filter(k=>T[k].length).map(k=>`<tr><td>${k}</td><td>${esc(META[k].d)}</td><td class=\"r\">${T[k].length}</td></tr>`).join('')}</tbody></table><div class=\"note\" style=\"margin-top:8px\">The same data is in the Excel file SAP_Training_Data_500.xlsx.</div>`,720)}",
  "function dataInfo(){infoDlg('Data Overview',`<table class=\"alv\"><thead><tr><th>Table</th><th>Contents</th><th class=\"r\">Rows</th></tr></thead><tbody>${Object.keys(META).filter(k=>T[k].length).map(k=>`<tr><td>${k}</td><td>${esc(META[k].d)}</td><td class=\"r\">${T[k].length}</td></tr>`).join('')}</tbody></table>`,720)}");
patch('more menu', "['Practice Tasks',practice],['Training Data Overview',dataInfo]", "['Work Queue',workQueue],['Data Overview',dataInfo],['Reload Data',reloadData]");

// ---------------------------------------------------------------------------
// 6. Branding: product name with a neutral icon and background instead of SAP's
//    logo and splash image (no approved SAP logo asset has been supplied)
// ---------------------------------------------------------------------------
patch('logo',
  /const LOGO=h=>`<svg height="\$\{h\}" viewBox="0 0 96 48" aria-label="SAP">[\s\S]*?<\/svg>`;/,
  'const LOGO=h=>`<svg height="${h}" viewBox="0 0 104 32" role="img" aria-label="SAP ERP"><rect x="1" y="4" width="24" height="24" rx="6" fill="#fff" fill-opacity=".16" stroke="#fff" stroke-opacity=".7"/><rect x="7" y="10" width="5" height="5" rx="1" fill="#fff"/><rect x="14" y="10" width="5" height="5" rx="1" fill="#fff"/><rect x="7" y="17" width="5" height="5" rx="1" fill="#fff"/><rect x="14" y="17" width="5" height="5" rx="1" fill="#fff"/><text x="33" y="22" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="16" fill="#fff">SAP ERP</text></svg>`;');
patch('home background', 'style="background-image:url(${HERO})"', '');
patch('hero css', '#hero{position:sticky;top:0;height:calc(100vh - 170px);min-height:320px;background:#6aa7d8 center/cover;border-radius:2px}',
  '#hero{position:sticky;top:0;height:calc(100vh - 170px);min-height:320px;border-radius:2px;background:radial-gradient(120% 90% at 85% 10%,#cfe1f3 0,transparent 55%),linear-gradient(160deg,#eaf2fa 0%,#b9d3ec 55%,#86aed6 100%)}');

// ---------------------------------------------------------------------------
// Final checks
// ---------------------------------------------------------------------------
for (const [label, re] of [
  ['credential hash', /\b[0-9a-f]{64}\b/],
  ['embedded login', /id="login"|nr5_logon|sessionStorage/],
  ['embedded data set', /const RAW=|SAP_Training_Data/],
  ['splash image', /data:image\/jpeg/],
  ['business data in localStorage', /nr5_sap_sim/],
  // (.prototype is the JavaScript built-in, not wording)
  ['prohibited wording', /\b(training|trainee\w*|simulat\w*|demo|practi[cs]e|(?<!\.)prototype|mock|clone|dummy)\b/i],
  ['old number counters', /ST\.ctr|ST\.add|ST\.mod/],
]) {
  const m = html.match(re);
  if (m) {
    console.error(`Built module still contains ${label}: "${m[0]}"`);
    process.exit(1);
  }
}

const out = join(root, 'modules', 'sap-erp', 'index.html');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`Wrote ${out} (${html.length.toLocaleString()} bytes)`);
