// ---- persistence ----
// Uses Claude's storage when embedded there; falls back to localStorage when self-hosted.
if (typeof window.storage === "undefined") {
  try {
    const LS = window.localStorage; const T = "__ll_t__"; LS.setItem(T,"1"); LS.removeItem(T);
    window.storage = {
      get:    async (k)    => { const v = LS.getItem(k); if (v === null) throw new Error("missing"); return {key:k, value:v}; },
      set:    async (k, v) => { LS.setItem(k, String(v)); return {key:k, value:String(v)}; },
      delete: async (k)    => { LS.removeItem(k); return {key:k, deleted:true}; },
      list:   async (pfx)  => { const keys=[]; for (let i=0;i<LS.length;i++){ const kk=LS.key(i); if(!pfx || (kk && kk.indexOf(pfx)===0)) keys.push(kk);} return {keys}; }
    };
  } catch (e) {
    const M = {};
    window.storage = {
      get:    async (k)    => { if (k in M) return {key:k, value:M[k]}; throw new Error("missing"); },
      set:    async (k, v) => { M[k] = String(v); return {key:k, value:M[k]}; },
      delete: async (k)    => { delete M[k]; return {key:k, deleted:true}; },
      list:   async (pfx)  => ({ keys: Object.keys(M).filter(kk => !pfx || kk.indexOf(pfx)===0) })
    };
  }
}

const DATA = window.PROGRAM;
const EX_GROUP = window.EX_GROUP;

const DAYS = [
  {k:'mon', dow:'MON', typ:'Full Body · Strength', color:'var(--mon)'},
  {k:'fri', dow:'FRI', typ:'Upper · Hypertrophy', color:'var(--fri)'},
  {k:'sat', dow:'SAT', typ:'Lower · Hypertrophy', color:'var(--sat)'},
];
let state = {wk:1, day:'mon'};
let dayCache = {};   // key -> {exIdx:{done,sets:[{w,r}]}}

/* ---------- storage ---------- */
const keyFor = (wk,day)=>`bts:log:w${wk}:${day}`;
async function loadDay(wk,day){
  const k=keyFor(wk,day);
  if(dayCache[k]) return dayCache[k];
  let val={};
  try{ const res=await window.storage.get(k,false); if(res&&res.value) val=JSON.parse(res.value); }
  catch(e){ val={}; }
  dayCache[k]=val; return val;
}
let saveTimers={};
function queueSave(wk,day){
  const k=keyFor(wk,day);
  clearTimeout(saveTimers[k]);
  saveTimers[k]=setTimeout(async()=>{
    try{ await window.storage.set(k, JSON.stringify(dayCache[k]||{}), false); }
    catch(e){ console.error('save failed',e); }
  },500);
}

/* ---------- helpers ---------- */
function techClass(t){ if(!t) return ''; t=t.toLowerCase();
  if(t.includes('myo')) return 'myo';
  if(t.includes('llp')||t.includes('lengthened')) return 'llp';
  if(t.includes('stretch')) return 'stretch';
  if(t.includes('failure')) return 'fail';
  return '';}
function techLabel(t){ if(!t||t==='N/A') return null; return t
  .replace('Failure + LLPs (Extend set)','Failure + lengthened partials')
  .replace('Static Stretch (30s)','30s loaded stretch'); }
function esc(s){ return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ---------- render ---------- */
function curWeek(){ return DATA.weeks[state.wk-1]; }

function renderHeader(){
  const w=curWeek();
  document.getElementById('wkLabel').textContent='Week '+w.n;
  let badges='';
  badges += `<span class="badge ${w.block==='Foundation'?'found':'ramp'}">${w.block}</span>`;
  if(w.deload) badges+='<span class="badge deload">Deload</span>';
  else if(w.vol) badges+=`<span class="badge vol">${w.vol}</span>`;
  document.getElementById('wkMeta').innerHTML = badges;
  document.getElementById('prevWk').disabled = state.wk<=1;
  document.getElementById('nextWk').disabled = state.wk>=12;
}

async function renderTabs(){
  const tabs=document.getElementById('tabs'); tabs.innerHTML='';
  for(const d of DAYS){
    const exs=curWeek().days[d.k];
    const log=await loadDay(state.wk,d.k);
    let done=0; exs.forEach((_,i)=>{ if(log[i]&&log[i].done) done++; });
    const el=document.createElement('button');
    el.className='tab'+(state.day===d.k?' on':''); el.dataset.d=d.k;
    el.innerHTML=`<div class="ring">${done}/${exs.length}</div><div class="dow">${d.dow}</div><div class="typ">${d.typ}</div>`;
    el.onclick=()=>{ state.day=d.k; renderAll(); };
    tabs.appendChild(el);
  }
}

async function renderList(){
  const w=curWeek(); const exs=w.days[state.day];
  const d=DAYS.find(x=>x.k===state.day);
  const log=await loadDay(state.wk,state.day);
  // previous week same day for overload hints
  let prevLog={}, prevExs=[];
  if(state.wk>1){ prevExs=DATA.weeks[state.wk-2].days[state.day]; prevLog=await loadDay(state.wk-1,state.day); }
  const prevByName={};
  prevExs.forEach((pe,pi)=>{ if(prevLog[pi]) prevByName[pe.ex]=prevLog[pi].sets||[]; });

  let done=0; exs.forEach((_,i)=>{ if(log[i]&&log[i].done) done++; });
  document.getElementById('daybar').innerHTML =
    `<span class="dot" style="background:${d.color}"></span>`+
    `<span class="ttl">${d.dow} — ${d.typ.replace(' · ',' · ')}</span>`+
    `<span class="prog"><b>${done}</b>/${exs.length} done</span>`;

  const list=document.getElementById('list'); list.innerHTML='';
  exs.forEach((ex,idx)=>{
    const rec=log[idx]||{done:false,sets:[]};
    const nSets=ex.sets||2;
    const tl=techLabel(ex.tech); const tc=techClass(ex.tech);
    const card=document.createElement('div'); card.className='card';

    let tags=`<span class="tag"><b>${nSets}</b> × ${esc(ex.reps)} reps</span>`;
    if(ex.erpe) tags+=`<span class="tag">early RPE ${esc(ex.erpe)}</span>`;
    tags+=`<span class="tag">last RPE <b>${esc(ex.lrpe)}</b></span>`;
    tags+=`<span class="tag">rest ${esc(ex.rest)}</span>`;
    tags+=`<span class="tag">warm-up ${esc(ex.wu)}</span>`;
    if(tl) tags+=`<span class="tag ${tc}">${esc(tl)}</span>`;

    const nameHTML = ex.demo
      ? `<a class="exname" href="${ex.demo}" target="_blank" rel="noopener">${esc(ex.ex)}<span class="play">▶ demo</span></a>`
      : `<span class="exname">${esc(ex.ex)}</span>`;

    // set rows
    const prevSets = prevByName[ex.ex]||[];
    let setHTML=`<div class="colhead"><span>set</span><span>weight</span><span>reps</span></div>`;
    for(let s=0;s<nSets;s++){
      const last = s===nSets-1;
      const sv=(rec.sets&&rec.sets[s])||{};
      const pv=prevSets[s];
      const prevHint = (pv&&(pv.w||pv.r)) ? `<div class="prev">last wk: <b>${esc(pv.w||'–')}</b> × ${esc(pv.r||'–')}</div>`:'';
      setHTML+=`<div class="setrow${last?' lastset':''}">
        <div class="slabel${last?' last':''}">Set ${s+1}${last?'<div class="pill">FAILURE</div>':''}</div>
        <div class="ig"><input inputmode="decimal" data-i="${idx}" data-s="${s}" data-f="w" value="${esc(sv.w||'')}" placeholder="–"><span class="unit">lb</span></div>
        <div class="ig"><input inputmode="numeric" data-i="${idx}" data-s="${s}" data-f="r" value="${esc(sv.r||'')}" placeholder="–"><span class="unit">reps</span></div>
        ${prevHint}
      </div>`;
    }

    card.innerHTML=`
      <div class="chead">
        <div class="cnum">${String(idx+1).padStart(2,'0')}</div>
        <div class="cttl">${nameHTML}<div class="tags">${tags}</div></div>
        <button class="done${rec.done?' on':''}" data-done="${idx}" aria-label="Mark done">✓</button>
      </div>
      <div class="sets">${setHTML}</div>
      <div class="more">
        <button class="mtog" data-more="${idx}"><span class="chev">›</span> Substitutions &amp; coaching notes</button>
        <div class="mbody" id="mb-${idx}">
          <div class="lbl">Swap options</div>
          <div class="subs">${ex.sub1?`<span class="subchip">${esc(ex.sub1)}</span>`:''}${ex.sub2?`<span class="subchip">${esc(ex.sub2)}</span>`:''}</div>
          <div class="lbl">Notes</div>
          <div class="notes">${esc((ex.notes||'').trim())||'—'}</div>
        </div>
      </div>`;
    list.appendChild(card);
  });

  // wire inputs
  list.querySelectorAll('input').forEach(inp=>{
    inp.addEventListener('input',()=>{
      const i=+inp.dataset.i, s=+inp.dataset.s, f=inp.dataset.f;
      const k=keyFor(state.wk,state.day); const dc=dayCache[k]||(dayCache[k]={});
      const r=dc[i]||(dc[i]={done:false,sets:[]});
      while(r.sets.length<=s) r.sets.push({});
      r.sets[s][f]=inp.value;
      queueSave(state.wk,state.day);
    });
  });
  list.querySelectorAll('[data-done]').forEach(b=>{
    b.addEventListener('click',()=>{
      const i=+b.dataset.done;
      const k=keyFor(state.wk,state.day); const dc=dayCache[k]||(dayCache[k]={});
      const r=dc[i]||(dc[i]={done:false,sets:[]});
      r.done=!r.done; b.classList.toggle('on',r.done);
      queueSave(state.wk,state.day);
      // update counters without full re-render
      refreshCounts();
    });
  });
  list.querySelectorAll('[data-more]').forEach(b=>{
    b.addEventListener('click',()=>{
      const mb=document.getElementById('mb-'+b.dataset.more);
      mb.classList.toggle('open'); b.classList.toggle('open');
    });
  });
}

function refreshCounts(){
  const w=curWeek(); const exs=w.days[state.day]; const log=dayCache[keyFor(state.wk,state.day)]||{};
  let done=0; exs.forEach((_,i)=>{ if(log[i]&&log[i].done) done++; });
  const pb=document.querySelector('.daybar .prog'); if(pb) pb.innerHTML=`<b>${done}</b>/${exs.length} done`;
  // tab ring
  const tab=document.querySelector(`.tab[data-d="${state.day}"] .ring`); if(tab) tab.textContent=`${done}/${exs.length}`;
}

async function renderAll(){
  renderHeader();
  await renderTabs();
  await renderList();
  document.querySelector('.wrap').scrollIntoView({block:'start'});
}

/* ---------- nav ---------- */
document.getElementById('prevWk').onclick=()=>{ if(state.wk>1){state.wk--; renderAll();} };
document.getElementById('nextWk').onclick=()=>{ if(state.wk<12){state.wk++; renderAll();} };

/* ---------- rest timer ---------- */
let tRemain=120, tTotal=120, tInt=null, tRunning=false;
const tBig=document.getElementById('tBig'), timer=document.getElementById('timer'), fab=document.getElementById('fab');
function fmtT(s){ const m=Math.floor(s/60), ss=s%60; return m+':'+String(ss).padStart(2,'0'); }
function drawT(){ tBig.textContent=fmtT(Math.max(0,tRemain)); }
function setPreset(sec){ stopT(); tTotal=tRemain=sec; tBig.classList.remove('alarm'); drawT(); }
function startT(){ if(tRunning) return; tRunning=true; fab.classList.add('run');
  document.getElementById('tStart').textContent='Pause';
  tInt=setInterval(()=>{ tRemain--; drawT();
    if(tRemain<=0){ stopT(); tBig.classList.add('alarm'); if(navigator.vibrate)navigator.vibrate([200,100,200]); }
  },1000); }
function stopT(){ clearInterval(tInt); tRunning=false; fab.classList.remove('run'); document.getElementById('tStart').textContent='Start'; }
[60,90,120,180,300].forEach(sec=>{
  const b=document.createElement('button'); b.className='preset'; b.textContent=fmtT(sec).replace(':00','m').replace(':',':');
  b.textContent = sec%60===0 ? (sec/60)+' min' : fmtT(sec);
  b.onclick=()=>setPreset(sec); document.getElementById('presets').appendChild(b);
});
fab.onclick=()=>{ timer.classList.add('show'); };
document.getElementById('tClose').onclick=()=>{ timer.classList.remove('show'); };
document.getElementById('tStart').onclick=()=>{ tRunning?stopT():startT(); };
document.getElementById('tReset').onclick=()=>{ setPreset(tTotal); };
drawT();

/* ---------- guide sheet ---------- */
const scrim=document.getElementById('scrim'), sheet=document.getElementById('sheet');
document.getElementById('guideBtn').onclick=()=>{ sheet.innerHTML=guideHTML(); scrim.classList.add('show'); };
scrim.onclick=(e)=>{ if(e.target===scrim) scrim.classList.remove('show'); };
function guideHTML(){ return `
  <div class="grab"></div>
  <h2>How this build works</h2>
  <p>Your 5-day program, folded into <b>3 days</b> that fit Mon / Fri / Sat. Wednesday stays open for your trainer. Every exercise keeps its original sets, reps, RPE, rest and technique — only the day grouping changed.</p>
  <h3>Weekly schedule</h3>
  <div class="schrow"><div class="d" style="color:var(--mon)">Monday</div><div>Full Body · Strength (program)</div></div>
  <div class="schrow rest"><div class="d">Tuesday</div><div>Rest</div></div>
  <div class="schrow"><div class="d" style="color:var(--peach)">Wednesday</div><div>Trainer session (full body / mixed)</div></div>
  <div class="schrow rest"><div class="d">Thursday</div><div>Rest</div></div>
  <div class="schrow"><div class="d" style="color:var(--fri)">Friday</div><div>Upper · Hypertrophy (program)</div></div>
  <div class="schrow"><div class="d" style="color:var(--sat)">Saturday</div><div>Lower · Hypertrophy (program)</div></div>
  <div class="schrow rest"><div class="d">Sunday</div><div>Rest</div></div>
  <h3>The blocks</h3>
  <p><b>Foundation (Wk 1–5):</b> Week 1 is an intro/deload — leave reps in the tank, no failure. Weeks 2–5 hold steady volume with the last set to failure.</p>
  <p><b>Ramping (Wk 6–12):</b> New exercises. Week 6 is an intro/deload, then volume climbs at Wk 7–8, 9–10, 11–12. After Week 12, loop back to Week 1 as your next deload.</p>
  <h3>Execution</h3>
  <p>2–4 sec negatives, explosive positives, chase the deep stretch at the bottom of every rep. Keep form identical week to week; beat last week by reps first, then load.</p>
  <h3>RPE scale</h3>
  <table class="rpe">
    <tr><td>10</td><td>True failure — tried and couldn't complete the rep</td></tr>
    <tr><td>9</td><td>1 rep left in the tank</td></tr>
    <tr><td>8–9</td><td>1–2 reps left — hard, but not all-out</td></tr>
    <tr><td>6–7</td><td>3–4 reps left — used on intro/deload weeks</td></tr>
  </table>
  <h3>Intensity techniques (last set only)</h3>
  <div class="gl"><b>Failure</b> — take the final set to a true RPE 10.</div>
  <div class="gl"><b>Lengthened partials (LLPs)</b> — after failure, keep doing partial reps in the stretched position until you can't move it.</div>
  <div class="gl"><b>Myo-reps</b> — after failure, rest ~5s and grind 3–4 more; repeat until you can't get 3.</div>
  <div class="gl"><b>30s loaded stretch</b> — hold the stretched position under load for 30s after the last set (calves).</div>
  <h3>Warm-up each session</h3>
  <p>5–10 min light cardio + arm/leg swings, then a warm-up pyramid sized to the warm-up count on each lift (more sets = heavier ramp on big compounds).</p>
  <h3>Backup &amp; restore</h3>
  <p>Your logs save automatically to your Claude account and reappear whenever you reopen this. Export a backup to keep your own copy, move to a new device, or restore after a reset.</p>
  <button class="databtn" id="expJson">⬇  Download backup file (.json)</button>
  <button class="databtn" id="expCsv">⬇  Export training log (.csv)</button>
  <button class="databtn" id="impBtn">↺  Restore from a backup file</button>
  <input type="file" id="impFile" accept="application/json,.json" style="display:none">
  <button class="dangerbtn" id="resetBtn">Reset all logged data</button>
  <div class="tiny">Your sets save to your Claude account as you log them.<br>Adapted from Jeff Nippard’s Intermediate-Advanced program · personal use.</div>`;
}
function download(filename, text, mime){
  try{ const blob=new Blob([text],{type:mime||'text/plain'}); const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },800); return true; }catch(e){ return false; }
}
async function gatherAll(){
  const out={};
  try{ const r=await window.storage.list('bts:', false); const keys=(r&&r.keys)||[];
    for(const k of keys){ try{ const v=await window.storage.get(k,false); if(v&&v.value!=null) out[k]=JSON.parse(v.value); }catch(_){} }
  }catch(e){
    for(let wk=1;wk<=12;wk++) for(const d of ['mon','fri','sat']){ const k=keyFor(wk,d);
      try{ const v=await window.storage.get(k,false); if(v&&v.value!=null) out[k]=JSON.parse(v.value);}catch(_){} }
  }
  return out;
}
function showText(title, txt){
  sheet.innerHTML=`<div class="grab"></div><h2>${title}</h2><p>Couldn’t trigger a download here — select all, copy, and paste this into a note or file to keep it safe.</p>`+
    `<textarea class="bigta" readonly>${txt.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</textarea>`+
    `<button class="databtn" id="copyTa">Copy to clipboard</button>`;
  scrim.classList.add('show'); const ta=sheet.querySelector('.bigta'); ta.focus(); ta.select();
}
async function exportJSON(){
  const data=await gatherAll();
  const txt=JSON.stringify({app:'BTS Tracker', version:1, exportedAt:new Date().toISOString(), data}, null, 2);
  const stamp=new Date().toISOString().slice(0,10);
  if(!download('bts-backup-'+stamp+'.json', txt, 'application/json')) showText('Backup data', txt);
}
async function exportCSV(){
  const rows=[['Week','Day','Exercise','Set','Weight','Reps']];
  for(const w of DATA.weeks){ for(const dk of ['mon','fri','sat']){ const log=await loadDay(w.n,dk);
    w.days[dk].forEach((ex,i)=>{ const rec=log[i]; if(rec&&rec.sets) rec.sets.forEach((s,si)=>{
      if(s&&((s.w&&s.w!=='')||(s.r&&s.r!==''))) rows.push([w.n, dk.toUpperCase(), ex.ex, si+1, s.w||'', s.r||'']); }); }); } }
  const csv=rows.map(r=>r.map(c=>{ c=String(c); return /[",\n]/.test(c)?'"'+c.replace(/"/g,'""')+'"':c; }).join(',')).join('\n');
  const stamp=new Date().toISOString().slice(0,10);
  if(!download('bts-log-'+stamp+'.csv', csv, 'text/csv')) showText('Training log (CSV)', csv);
}
function restoreData(text){
  let obj; try{ obj=JSON.parse(text); }catch(e){ alert('That doesn’t look like a valid backup file.'); return; }
  const data=(obj&&obj.data)?obj.data:obj; const keys=Object.keys(data||{});
  if(!keys.length){ alert('No saved data found in that file.'); return; }
  if(!confirm('Restore '+keys.length+' saved day(s)? This replaces your current logs.')) return;
  (async()=>{ for(const k of keys){ try{ await window.storage.set(k, JSON.stringify(data[k]), false);}catch(_){} }
    dayCache={}; scrim.classList.remove('show'); await renderAll();
    try{ if(document.getElementById('bodyView').style.display!=='none') await renderProg(); }catch(_){}
    alert('Backup restored.'); })();
}
sheet.addEventListener('click',async(e)=>{
  const id=e.target.id;
  if(id==='resetBtn'){
    if(!confirm('Erase every logged set across all 12 weeks? This cannot be undone.')) return;
    try{ const r=await window.storage.list('bts:', false); for(const k of ((r&&r.keys)||[])){ try{ await window.storage.delete(k,false);}catch(_){} } }
    catch(_){ for(let wk=1;wk<=12;wk++) for(const d of ['mon','fri','sat']){ try{ await window.storage.delete(keyFor(wk,d),false);}catch(__){} } }
    dayCache={}; scrim.classList.remove('show'); renderAll();
  } else if(id==='expJson'){ exportJSON(); }
  else if(id==='expCsv'){ exportCSV(); }
  else if(id==='impBtn'){ const f=document.getElementById('impFile'); if(f) f.click(); }
  else if(id==='copyTa'){ const ta=sheet.querySelector('.bigta'); if(ta){ ta.select();
      try{ await navigator.clipboard.writeText(ta.value); e.target.textContent='Copied'; }
      catch(_){ try{ document.execCommand('copy'); e.target.textContent='Copied'; }catch(__){} } }
  }
});
document.addEventListener('change',e=>{
  if(e.target&&e.target.id==='impFile'){ const f=e.target.files&&e.target.files[0]; if(!f) return;
    const rd=new FileReader(); rd.onload=()=>restoreData(String(rd.result)); rd.readAsText(f); e.target.value=''; }
});

/* ===================== PROGRESS (strength & reps) ===================== */
const PMETRICS={
  '1rm':{name:'Est. 1RM', unit:'lb', dec:0, calc:sets=>{ let b=null; for(const s of sets){ if(s.w>0&&s.r>0){ const e=s.w*(1+s.r/30); if(b==null||e>b)b=e; } } return b; }},
  'top':{name:'Top Set', unit:'lb', dec:1, calc:sets=>{ let b=null; for(const s of sets){ if(s.w>0){ if(b==null||s.w>b)b=s.w; } } return b; }},
  'vol':{name:'Total Volume', unit:'lb', dec:0, calc:sets=>{ let v=0,a=false; for(const s of sets){ if(s.w>0&&s.r>0){ v+=s.w*s.r; a=true; } } return a?v:null; }},
};
const GROUP_ORDER=['Chest','Back','Shoulders','Arms','Legs','Core'];
let progState={ sel:{type:'ex', name:null}, metric:'1rm' };

const EX_INDEX={}, GROUP_INDEX={};
DATA.weeks.forEach(w=>{ ['mon','fri','sat'].forEach(dk=>{ w.days[dk].forEach((ex,i)=>{
  (EX_INDEX[ex.ex]||(EX_INDEX[ex.ex]=[])).push({wk:w.n, day:dk, exIdx:i});
  const g=EX_GROUP[ex.ex]; if(g&&g!=='Other'){ (GROUP_INDEX[g]||(GROUP_INDEX[g]=[])).push({wk:w.n, day:dk, exIdx:i}); }
});});});

function parseSets(arr){ return (arr||[]).map(s=>{ const w=parseFloat(s&&s.w), r=parseFloat(s&&s.r); return {w:isNaN(w)?0:w, r:isNaN(r)?0:r}; }); }
function volOf(sets){ let v=0,a=false; for(const s of sets){ if(s.w>0&&s.r>0){ v+=s.w*s.r; a=true; } } return a?v:0; }

async function exPoints(){
  const m=PMETRICS[progState.metric];
  const occ=(EX_INDEX[progState.sel.name]||[]).slice().sort((a,b)=>a.wk-b.wk);
  const pts=[];
  for(const o of occ){ const log=await loadDay(o.wk,o.day); const rec=log[o.exIdx];
    if(!rec||!rec.sets) continue; const sets=parseSets(rec.sets); const v=m.calc(sets);
    if(v!=null&&!isNaN(v)) pts.push({label:'Wk '+o.wk, wk:o.wk, v, sets}); }
  return pts;
}
async function groupPoints(){
  const occ=GROUP_INDEX[progState.sel.name]||[]; const byWeek={};
  for(const o of occ){ const log=await loadDay(o.wk,o.day); const rec=log[o.exIdx];
    if(!rec||!rec.sets) continue; const v=volOf(parseSets(rec.sets));
    if(v>0) byWeek[o.wk]=(byWeek[o.wk]||0)+v; }
  return Object.keys(byWeek).map(Number).sort((a,b)=>a-b).map(wk=>({label:'Wk '+wk, wk, v:byWeek[wk]}));
}

function chartSVG(pts, prIdx){
  const W=348,H=210,padL=10,padR=46,padT=18,padB=30, pw=W-padL-padR, ph=H-padT-padB;
  if(pts.length===0) return '<div class="empty">Nothing logged for this yet.<br>Enter your weight × reps in <b>Train</b> and the line will plot here.</div>';
  let vals=pts.map(p=>p.v), lo=Math.min(...vals), hi=Math.max(...vals);
  if(lo===hi){ lo-=Math.max(5,lo*0.05); hi+=Math.max(5,hi*0.05); }
  const pad=(hi-lo)*0.18||5; lo-=pad; hi+=pad; if(lo<0) lo=0;
  const X=i=> pts.length===1? padL+pw/2 : padL + i*pw/(pts.length-1);
  const Y=v=> padT + (hi-v)/(hi-lo)*ph;
  let grid='',ylab=''; const ticks=4; const range=hi-lo; const yd=range<12?1:0;
  const fmtY=t=> range>=1000? Math.round(t/100)*100/1000+'k' : (range<12? t.toFixed(1):Math.round(t).toString());
  for(let i=0;i<ticks;i++){ const t=lo+range*i/(ticks-1), y=Y(t).toFixed(1);
    grid+=`<line x1="${padL}" y1="${y}" x2="${padL+pw}" y2="${y}" class="gl"/>`;
    ylab+=`<text x="${padL+pw+8}" y="${(+y+3).toFixed(1)}" class="yl">${fmtY(t)}</text>`; }
  const dline=pts.map((p,i)=>`${i?'L':'M'} ${X(i).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ');
  const darea= pts.length>1? dline+` L ${X(pts.length-1).toFixed(1)} ${(padT+ph).toFixed(1)} L ${X(0).toFixed(1)} ${(padT+ph).toFixed(1)} Z`:'';
  const dots=pts.map((p,i)=> i===prIdx
     ? `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="5.5" class="dotpr"/>`
     : `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="4.5" class="dot"/>`).join('');
  const step=Math.max(1,Math.ceil(pts.length/7));
  const xlab=pts.map((p,i)=>(i%step===0||i===pts.length-1)?`<text x="${X(i).toFixed(1)}" y="${H-10}" class="xl">${p.label}</text>`:'').join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" class="chart" role="img">
    <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7fdbe8" stop-opacity="0.30"/><stop offset="1" stop-color="#7fdbe8" stop-opacity="0"/></linearGradient></defs>
    ${grid}${darea?`<path d="${darea}" fill="url(#ag)"/>`:''}<path d="${dline}" class="cline"/>${dots}${ylab}${xlab}</svg>`;
}

async function renderProg(){
  if(!progState.sel.name) progState.sel={type:'ex', name:DATA.weeks[0].days.mon[0].ex};
  const isGroup = progState.sel.type==='group';
  document.querySelector('.bcEyebrow').textContent = isGroup?'Muscle group':'Progression';
  const metricSel=document.getElementById('metricSel');
  metricSel.style.display = isGroup?'none':'';
  document.getElementById('exSel').innerHTML=`${progState.sel.name} <span class="car">▾</span>`;
  if(!isGroup) metricSel.innerHTML=`${PMETRICS[progState.metric].name} <span class="car">▾</span>`;
  const cur=document.getElementById('curVal'), pr=document.getElementById('prVal'), upd=document.getElementById('curUpd');
  const lbls=document.querySelectorAll('.bcStats .bcLbl');

  if(isGroup){
    const pts=await groupPoints();
    lbls[0].textContent='Change'; lbls[1].textContent='Latest volume';
    let prIdx=-1;
    if(pts.length){
      let best=-Infinity; pts.forEach((p,i)=>{ if(p.v>best){best=p.v;prIdx=i;} });
      const first=pts[0].v, last=pts[pts.length-1].v;
      const pct = first>0? (last-first)/first*100 : 0; const sign=pct>0?'+':'';
      cur.innerHTML=`<span style="color:${pct>=0?'var(--green)':'var(--maroon)'}">${sign}${pct.toFixed(0)}%</span>`;
      upd.textContent=`Weekly volume · Wk ${pts[0].wk}–${pts[pts.length-1].wk}`;
      pr.innerHTML=`${Math.round(last).toLocaleString()}<span class="bcUnit"> lb</span>`;
    } else { cur.textContent='–'; pr.textContent='–'; upd.textContent='Log sets in Train to see this group’s trend.'; }
    document.getElementById('chartbox').innerHTML=chartSVG(pts, prIdx);
    renderGroupHist(pts);
  } else {
    const m=PMETRICS[progState.metric]; const pts=await exPoints();
    lbls[0].textContent='Latest'; lbls[1].textContent='Best';
    const uSuffix=' '+m.unit; let prIdx=-1;
    if(pts.length){
      let best=-Infinity; pts.forEach((p,i)=>{ if(p.v>best){best=p.v;prIdx=i;} });
      const last=pts[pts.length-1], prev=pts[pts.length-2];
      cur.innerHTML=`${last.v.toFixed(m.dec)}<span class="bcUnit">${uSuffix}</span>`;
      upd.textContent='Latest: Week '+last.wk;
      if(prev){ const diff=last.v-prev.v, good=diff>0; const ar=diff<0?'↓':diff>0?'↑':'→';
        cur.innerHTML+=` <span class="delta ${diff===0?'':(good?'good':'bad')}">${ar}${Math.abs(diff).toFixed(m.dec)}</span>`; }
      pr.innerHTML=`${best.toFixed(m.dec)}<span class="bcUnit">${uSuffix}</span>`;
    } else { cur.textContent='–'; pr.textContent='–'; upd.textContent=''; }
    document.getElementById('chartbox').innerHTML=chartSVG(pts, prIdx);
    renderExHist(pts);
  }
}

function renderExHist(pts){
  const el=document.getElementById('histList');
  if(!pts.length){ el.style.display='none'; el.innerHTML=''; return; }
  el.style.display='';
  const rows=[...pts].reverse().map((p,i)=>{
    let bw=null; p.sets.forEach(s=>{ if(s.w>0&&(bw==null||s.w>bw.w)) bw=s; });
    const top = bw? `${bw.w}×${bw.r||'–'}` : '–';
    let b1=null; p.sets.forEach(s=>{ if(s.w>0&&s.r>0){ const x=s.w*(1+s.r/30); if(b1==null||x>b1)b1=x; } });
    let vol=0,va=false; p.sets.forEach(s=>{ if(s.w>0&&s.r>0){ vol+=s.w*s.r; va=true; } });
    return `<div class="hrow${i===0?' first':''}"><div class="hd">Wk ${p.wk}</div><div class="hv">top ${top}  ·  1RM ${b1!=null?Math.round(b1):'–'}  ·  vol ${va?Math.round(vol):'–'}</div></div>`;
  }).join('');
  el.innerHTML=`<div class="lcTtl">Week by week</div>`+rows;
}
function renderGroupHist(pts){
  const el=document.getElementById('histList');
  if(!pts.length){ el.style.display='none'; el.innerHTML=''; return; }
  el.style.display='';
  const base=pts[0].v;
  const rows=[...pts].reverse().map((p,i)=>{
    const pct = base>0? (p.v-base)/base*100 : 0; const sign=pct>0?'+':'';
    return `<div class="hrow${i===0?' first':''}"><div class="hd">Wk ${p.wk}</div><div class="hv">${Math.round(p.v).toLocaleString()} lb<span style="color:var(--ovl)">  ·  ${sign}${pct.toFixed(0)}% vs Wk ${pts[0].wk}</span></div></div>`;
  }).join('');
  el.innerHTML=`<div class="lcTtl">Week by week · ${progState.sel.name} volume</div>`+rows;
}

document.getElementById('metricSel').onclick=()=>{
  sheet.innerHTML=`<div class="grab"></div><h2>Progress metric</h2>`+
    Object.entries(PMETRICS).map(([k,m])=>`<button class="mopt" data-pm="${k}">${m.name}<span>${m.unit}</span></button>`).join('')+
    `<p style="margin-top:14px">Est. 1RM blends weight and reps (Epley formula). Top Set is your heaviest weight that day. Total Volume is weight × reps summed across all sets.</p>`;
  scrim.classList.add('show');
};
document.getElementById('exSel').onclick=()=>{
  let html=`<div class="grab"></div><h2>What do you want to track?</h2>`;
  html+=`<h3>Muscle groups</h3>`;
  GROUP_ORDER.forEach(g=>{ if(GROUP_INDEX[g]) html+=`<button class="mopt" data-group="${g}">${g}<span>rollup</span></button>`; });
  const seen=new Set();
  for(const [bn,wk] of [['Foundation',1],['Ramping',6]]){
    html+=`<h3>${bn} block — movements</h3>`;
    const wkObj=DATA.weeks[wk-1];
    for(const dk of ['mon','fri','sat']){
      wkObj.days[dk].forEach(ex=>{ if(seen.has(ex.ex)) return; seen.add(ex.ex);
        html+=`<button class="mopt exopt" data-ex="${ex.ex.replace(/"/g,'&quot;')}">${ex.ex}<span>${dk.toUpperCase()}</span></button>`; });
    }
  }
  sheet.innerHTML=html; scrim.classList.add('show');
};
sheet.addEventListener('click',e=>{
  const pm=e.target.closest('[data-pm]'); if(pm){ progState.metric=pm.dataset.pm; scrim.classList.remove('show'); renderProg(); return; }
  const g=e.target.closest('[data-group]'); if(g){ progState.sel={type:'group',name:g.dataset.group}; scrim.classList.remove('show'); renderProg(); return; }
  const ex=e.target.closest('[data-ex]'); if(ex){ progState.sel={type:'ex',name:ex.dataset.ex}; scrim.classList.remove('show'); renderProg(); return; }
});

document.getElementById('seg').onclick=e=>{ const b=e.target.closest('.segbtn'); if(!b) return;
  const train=b.dataset.v==='train';
  [...e.currentTarget.children].forEach(c=>c.classList.toggle('on',c===b));
  document.getElementById('trainNav').style.display=train?'':'none';
  document.getElementById('trainView').style.display=train?'':'none';
  document.getElementById('bodyView').style.display=train?'none':'';
  document.getElementById('fab').style.display=train?'':'none';
  document.getElementById('timer').classList.remove('show');
  if(!train) renderProg();
  window.scrollTo(0,0);
};

/* ---------- boot ---------- */
(async()=>{
  progState.sel={type:'ex', name:DATA.weeks[0].days.mon[0].ex};
  await renderAll();
})();
