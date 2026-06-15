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
try{ const _w=+localStorage.getItem('ll:wk'); if(_w>=1&&_w<=12) state.wk=_w;
  const _d=localStorage.getItem('ll:day'); if(['mon','fri','sat'].includes(_d)) state.day=_d; }catch(_){}
function persistPos(){ try{ localStorage.setItem('ll:wk',String(state.wk)); localStorage.setItem('ll:day',state.day); }catch(_){} }
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
    scheduleCloudPush();
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
function el(tag,cls,html){ const e=document.createElement(tag); if(cls) e.className=cls; if(html!=null) e.innerHTML=html; return e; }

/* ===================== v2: steppers, PR, gamification ===================== */
const BAR=45;
const WRES={
  machine:   {label:'Machine',   step:5, chips:[2.5,5,10,25],          pair:false},
  plates:    {label:'Barbell',   step:5, chips:[45,25,15,10,5,2.5,1.25],pair:true },
  dumbbell:  {label:'Dumbbell',  step:5, chips:[2.5,5,10],             pair:false},
  bodyweight:{label:'Bodyweight',step:5, chips:[5,10,25,45],           pair:false},
};
const RES_ORDER=['machine','plates','dumbbell','bodyweight'];
const RES_OVERRIDE={
  'Leg Press':'plates','Wide-Grip Pull-Up':'bodyweight','Neutral-Grip Pull-Up':'bodyweight',
  '45° Hyperextension':'bodyweight','Nordic Ham Curl':'bodyweight','Bench Dip':'bodyweight','Reverse Nordic':'bodyweight',
};
function resTypeFor(name){
  if(RES_OVERRIDE[name]) return RES_OVERRIDE[name];
  const s=(name||'').toLowerCase();
  if(/\bdb\b|dumbbell|goblet/.test(s)) return 'dumbbell';
  if(/pull-up|chin-up|\bdip\b|hyperextension|nordic|sissy/.test(s)) return 'bodyweight';
  if(/barbell|smith|\brdl\b|bench press|back squat|front squat|leg press|deadlift|snatch/.test(s)) return 'plates';
  return 'machine';
}
const e1rm=(w,r)=> (w>0&&r>0)? Math.round(w*(1+r/30)) : 0;

// live mutable record for the current day (mutations persist via queueSave)
function liveRec(idx){ const k=keyFor(state.wk,state.day); const dc=dayCache[k]||(dayCache[k]={}); return dc[idx]||(dc[idx]={done:false,sets:[]}); }

// ---- PR detection ----
let PR_BASE={}, prFiredSession=new Set(), toastTimer=null, afterEdit=null;
async function computePRBase(){
  PR_BASE={};
  let all={}; try{ all=await gatherAll(); }catch(_){}
  for(const k in all){ if(!k.startsWith('bts:log:')) continue; const m=k.match(/w(\d+):(\w+)/); if(!m) continue;
    const exs=(DATA.weeks[+m[1]-1]&&DATA.weeks[+m[1]-1].days[m[2]])||[]; const log=all[k]||{};
    exs.forEach((ex,i)=>{ const rec=log[i]; if(!rec||!rec.sets) return;
      rec.sets.forEach(st=>{ const e=e1rm(parseFloat(st.w),parseFloat(st.r)); if(e>(PR_BASE[ex.ex]||0)) PR_BASE[ex.ex]=e; }); });
  }
}
function setField(idx, ex, s, f, val){
  const r=liveRec(idx);
  while(r.sets.length<=s) r.sets.push({});
  r.sets[s][f]=val;
  queueSave(state.wk,state.day);
  const sv=r.sets[s]; const e=e1rm(parseFloat(sv.w),parseFloat(sv.r));
  if(e>(PR_BASE[ex.ex]||0) && !prFiredSession.has(ex.ex)){ fireToast(ex.ex, e); PR_BASE[ex.ex]=e; }
  if(afterEdit) afterEdit();
}
function fireToast(name, val){
  prFiredSession.add(name);
  const pm=document.getElementById('prMedal'); pm.className='medal t-gold'; pm.style.width='46px'; pm.innerHTML=medalMarkup('▲','gold',40);
  document.getElementById('prToastBody').innerHTML=esc(name)+' · <b>'+val+' lb</b> est. 1RM';
  const t=document.getElementById('prToast'); t.classList.add('show');
  if(navigator.vibrate) navigator.vibrate(60);
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),3800);
}

// ---- WeightStepper (tap −/+ · equipment chips · tap-to-type) ----
function makeWeightStepper(idx, ex, s, resType, prefill, onType){
  const cfg=WRES[resType]||WRES.machine; let sub=false;
  const wrap=el('div','wstep');
  const get=()=>{ const sv=(liveRec(idx).sets||[])[s]||{}; return (sv.w!==undefined&&sv.w!==''&&sv.w!=null); };
  const cur=()=>{ const sv=(liveRec(idx).sets||[])[s]||{}; return get()? Number(sv.w) : (prefill!=null?Number(prefill):0); };
  const top=el('div','wtop');
  const minus=el('button','wbig','−'), plus=el('button','wbig','+');
  const plate=el('div','wplate');
  function draw(){
    const touched=get(), v=cur();
    plate.classList.toggle('touched',touched);
    const ps=resType==='plates'? Math.max(0,(v-BAR)/2):null;
    plate.innerHTML=`<div class="wrow">${resType==='bodyweight'?'<span class="wbw">BW +</span>':''}`
      +`<span class="wnum">${touched?esc(String(v)):(prefill!=null?esc(String(prefill)):'–')}</span>`
      +`<span class="wunit">lb</span></div>`
      +(ps!=null&&v>0?`<div class="wside">bar 45 + ${ps%1===0?ps:ps.toFixed(2)}/side</div>`:'');
  }
  function commit(n){ if(n<0)n=0; setField(idx,ex,s,'w',String(Math.round(n*100)/100)); draw(); }
  plate.addEventListener('click',()=>{
    if(plate.querySelector('input')) return;
    plate.innerHTML=`<input inputmode="decimal" value="${get()?esc(String(cur())):''}">`;
    const inp=plate.querySelector('input'); inp.focus(); inp.select();
    const fin=()=>{ const v=inp.value.trim(); if(v!=='') setField(idx,ex,s,'w',String(Number(v)||0)); draw(); };
    inp.addEventListener('blur',fin);
    inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); inp.blur(); } });
  });
  minus.onclick=()=>commit(cur()-cfg.step); plus.onclick=()=>commit(cur()+cfg.step);
  top.append(minus,plate,plus); draw();
  const ctrl=el('div','wctrl');
  const eq=el('button','weq'+(onType?' cyc':''), esc(cfg.label)+(onType?' <span class="car">▾</span>':''));
  if(onType) eq.onclick=onType;
  const tog=el('div','wtog'); const addB=el('button','add on','+'), subB=el('button','sub','−');
  const hint=el('span','whint', cfg.pair?'tap a plate (pair)':'quick add');
  const chips=el('div','wchips');
  function redrawChips(){ chips.innerHTML=''; cfg.chips.forEach(c=>{ const b=el('button','wchip',(sub?'−':'+')+c);
    b.onclick=()=>commit(cur()+(cfg.pair?c*2:c)*(sub?-1:1)); chips.appendChild(b); }); }
  function setSub(v){ sub=v; addB.className='add'+(sub?'':' on'); subB.className='sub'+(sub?' on':'');
    hint.textContent=cfg.pair?'tap a plate (pair)':('quick '+(sub?'remove':'add')); chips.classList.toggle('sub',sub); redrawChips(); }
  addB.onclick=()=>setSub(false); subB.onclick=()=>setSub(true); tog.append(addB,subB);
  ctrl.append(eq,tog,hint); redrawChips();
  wrap.append(top,ctrl,chips); return wrap;
}

// ---- reps Stepper ----
function makeRepsStepper(idx, ex, s, prefill){
  const wrap=el('div','stepper');
  const minus=el('button','sbtn','−'), plus=el('button','sbtn','+'), plate=el('div','splate');
  const get=()=>{ const sv=(liveRec(idx).sets||[])[s]||{}; return (sv.r!==undefined&&sv.r!==''&&sv.r!=null); };
  const cur=()=>{ const sv=(liveRec(idx).sets||[])[s]||{}; return get()? Number(sv.r) : (prefill!=null?Number(prefill):0); };
  function draw(){ const t=get(); plate.classList.toggle('touched',t);
    plate.innerHTML=`<span class="snum">${t?esc(String(cur())):(prefill!=null?esc(String(prefill)):'–')}</span><span class="sunit">reps</span>`; }
  function commit(n){ if(n<0)n=0; if(n>999)n=999; setField(idx,ex,s,'r',String(n)); draw(); }
  plate.addEventListener('click',()=>{
    if(plate.querySelector('input')) return;
    plate.innerHTML=`<input inputmode="numeric" value="${get()?esc(String(cur())):''}"><span class="sunit">reps</span>`;
    const inp=plate.querySelector('input'); inp.focus(); inp.select();
    const fin=()=>{ const v=inp.value.trim(); if(v!=='') setField(idx,ex,s,'r',String(Number(v)||0)); draw(); };
    inp.addEventListener('blur',fin);
    inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); inp.blur(); } });
  });
  minus.onclick=()=>commit(cur()-1); plus.onclick=()=>commit(cur()+1);
  wrap.append(minus,plate,plus); draw(); return wrap;
}

// ---- Medals + achievements ----
const TIER_COLOR={bronze:'var(--peach)',silver:'var(--sub1)',gold:'var(--yellow)',locked:'var(--ovl)'};
function medalMarkup(glyph, tier, size){
  const locked=tier==='locked';
  return `<div class="mwrap" style="width:${size}px;height:${size}px">`
    +`<div class="mplate"></div><div class="minner"></div>`
    +`<div class="mglyph" style="font-size:${(size*0.34).toFixed(1)}px">${locked?'✦':esc(glyph)}</div>`
    +(locked?'':`<div class="mpip">${tier}</div>`)+`</div>`;
}
const ACHIEVEMENTS=[
  {id:'pr',     glyph:'▲', name:'Record Breaker', unit:'PRs',       tiers:[1,5,15],            blurb:'Set a new estimated 1RM on any lift.',                 derive:a=>a.prEvents},
  {id:'streak', glyph:'◆', name:'On a Roll',      unit:'wk streak', tiers:[2,4,8],             blurb:'Log training across consecutive weeks without a gap.', derive:a=>a.streak},
  {id:'volume', glyph:'▣', name:'Heavy Lifter',   unit:'lb total',  tiers:[10000,50000,150000],blurb:'Total weight moved across all logged sets.',          derive:a=>a.volume},
  {id:'weeks',  glyph:'✓', name:'Clean Sweep',    unit:'weeks done',tiers:[1,5,12],            blurb:'Complete every exercise across a full training week.', derive:a=>a.fullWeeks},
  {id:'consist',glyph:'◎', name:'Three for Three',unit:'x all-3',   tiers:[1,4,12],            blurb:'Hit all three training days in the same week.',       derive:a=>a.allThree},
  {id:'failure',glyph:'⚑', name:'To Failure',     unit:'earned',    tiers:[1,25,100],          blurb:'Take a final working set to a true RPE 10.',          derive:a=>a.doneCount},
  {id:'myo',    glyph:'⚡', name:'Myo Master',     unit:'myo sets',  tiers:[1,15,50],           blurb:'Complete a myo-rep extended set.',                    derive:a=>a.myoDone},
];
function tierOf(a){ if(a.value>=a.tiers[2])return'gold'; if(a.value>=a.tiers[1])return'silver'; if(a.value>=a.tiers[0])return'bronze'; return'locked'; }
function nextThreshold(a){ for(const th of a.tiers) if(a.value<th) return th; return null; }
async function computeAchievements(){
  let all={}; try{ all=await gatherAll(); }catch(_){}
  let volume=0, doneCount=0, myoDone=0, prEvents=0; const exBest={};
  const weekHasLog={}, weekDayDone={};
  for(let wk=1; wk<=12; wk++){
    for(const day of ['mon','fri','sat']){
      const log=all[keyFor(wk,day)]; if(!log) continue;
      const exs=(DATA.weeks[wk-1]&&DATA.weeks[wk-1].days[day])||[];
      exs.forEach((ex,i)=>{ const rec=log[i]; if(!rec) return;
        if(rec.done){ doneCount++; if(/myo/i.test(ex.tech||'')) myoDone++; (weekDayDone[wk]=weekDayDone[wk]||{})[day]=true; }
        (rec.sets||[]).forEach(st=>{ const w=parseFloat(st.w), r=parseFloat(st.r); if(w>0&&r>0){
          volume+=w*r; const e=w*(1+r/30);
          if(exBest[ex.ex]===undefined) exBest[ex.ex]=e; else if(e>exBest[ex.ex]){ prEvents++; exBest[ex.ex]=e; }
          weekHasLog[wk]=true;
        } else if(rec.done){ weekHasLog[wk]=true; } });
        if(rec.done) weekHasLog[wk]=true;
      });
    }
  }
  let fullWeeks=0, allThree=0, streak=0, run=0;
  for(let wk=1; wk<=12; wk++){
    if(weekHasLog[wk]){ run++; if(run>streak) streak=run; } else run=0;
    const dd=weekDayDone[wk]||{}; if(dd.mon&&dd.fri&&dd.sat) allThree++;
    let full=true, anyEx=false;
    for(const day of ['mon','fri','sat']){ const exs=(DATA.weeks[wk-1]&&DATA.weeks[wk-1].days[day])||[]; const log=all[keyFor(wk,day)]||{};
      exs.forEach((ex,i)=>{ anyEx=true; if(!(log[i]&&log[i].done)) full=false; }); }
    if(anyEx&&full) fullWeeks++;
  }
  return {volume:Math.round(volume), doneCount, myoDone, prEvents, streak, allThree, fullWeeks};
}
let shelfList=[];
async function renderShelf(){
  const shelf=document.getElementById('shelf'); if(!shelf) return;
  const agg=await computeAchievements();
  shelfList=ACHIEVEMENTS.map(a=>({...a, value:a.derive(agg)}));
  const earned=shelfList.filter(a=>tierOf(a)!=='locked').length;
  const rows=shelfList.map((a,i)=>{ const tier=tierOf(a), next=nextThreshold(a);
    const sub=tier==='gold'?'max tier':(next!=null? a.value+' / '+next : String(a.value));
    return `<div class="medal t-${tier} tap" data-ach="${i}" style="width:80px">${medalMarkup(a.glyph,tier,64)}`
      +`<div class="mcap"><div class="mlabel">${esc(a.name)}</div><div class="msub">${esc(sub)}</div></div></div>`;
  }).join('');
  shelf.innerHTML=`<div class="shelfhead"><span class="shelfttl">Achievements</span>`
    +`<span class="shelfcount"><b>${earned}</b> / ${shelfList.length} unlocked</span></div>`
    +`<div class="shelfrow">${rows}</div>`;
}
function openAch(a){
  if(!a) return; const tier=tierOf(a), next=nextThreshold(a); const names=['bronze','silver','gold'];
  const track=names.map((tn,i)=>{ const reached=a.value>=a.tiers[i]; const col=reached?TIER_COLOR[tn]:'var(--s1)';
    return `<div class="tierbox${reached?' on':''}" style="color:${col}"><div class="tn" style="color:${reached?TIER_COLOR[tn]:'var(--ovl)'}">${tn}</div>`
      +`<div class="tv">${a.tiers[i].toLocaleString()} ${esc(a.unit)}</div></div>`; }).join('');
  const prog=tier==='gold'?'Max tier reached — legend.'
    :`Currently <b>${a.value.toLocaleString()}</b> ${esc(a.unit)}${next!=null?` · <b>${(next-a.value).toLocaleString()}</b> to ${names[a.tiers.indexOf(next)]}`:''}.`;
  sheet.innerHTML=`<div class="grab"></div>`
    +`<div class="achdetail"><div class="medal t-${tier}" style="width:108px">${medalMarkup(a.glyph,tier,92)}</div>`
    +`<h2 style="margin:10px 0 0">${esc(a.name)}</h2><div class="achblurb">${esc(a.blurb)}</div></div>`
    +`<div class="tiertrack">${track}</div><div class="achprog">${prog}</div>`
    +`<button class="databtn" id="achClose" style="margin-top:16px">Close</button>`;
  scrim.classList.add('show');
}

// ---- session completion ("Finish workout") ----
let finCache={};
async function loadFin(wk,day){ const k='bts:fin:w'+wk+':'+day; if(k in finCache) return finCache[k];
  let v=null; try{ const r=await window.storage.get(k,false); if(r&&r.value) v=JSON.parse(r.value); }catch(_){}
  finCache[k]=v; return v; }
async function daySummary(wk,day){
  const exs=DATA.weeks[wk-1].days[day]; const log=await loadDay(wk,day);
  let done=0, sets=0, vol=0, bestE=0, bestEx='';
  exs.forEach((ex,i)=>{ const rec=log[i]; if(!rec) return; if(rec.done) done++;
    (rec.sets||[]).forEach(st=>{ const w=parseFloat(st.w), r=parseFloat(st.r); if(w>0&&r>0){
      sets++; vol+=w*r; const e=Math.round(w*(1+r/30)); if(e>bestE){ bestE=e; bestEx=ex.ex; } } }); });
  return {total:exs.length, done, sets, vol:Math.round(vol), bestE, bestEx};
}
function showWorkoutSummary(wk,day,fin){
  const dm=DAYS.find(x=>x.k===day);
  (async()=>{ const s=await daySummary(wk,day);
    sheet.innerHTML=`<div class="grab"></div><h2>Workout complete</h2>`
      +`<p>${dm.dow} · ${dm.typ} · Week ${wk}${fin&&fin.at?` · saved ${new Date(fin.at).toLocaleDateString()}`:''}</p>`
      +`<div class="summgrid">`
      +`<div class="scell"><div class="sv">${s.done}/${s.total}</div><div class="sl">movements done</div></div>`
      +`<div class="scell"><div class="sv">${s.sets}</div><div class="sl">sets logged</div></div>`
      +`<div class="scell"><div class="sv">${s.vol.toLocaleString()}</div><div class="sl">lb volume</div></div>`
      +`<div class="scell"><div class="sv">${s.bestE||'–'}</div><div class="sl">top est. 1RM</div></div></div>`
      +(s.bestEx?`<p style="text-align:center">Top lift · <b style="color:var(--text)">${esc(s.bestEx)}</b></p>`:'')
      +`<button class="databtn" id="summClose" style="margin-top:14px">Close</button>`;
    scrim.classList.add('show');
  })();
}
async function finishWorkout(){
  const k='bts:fin:w'+state.wk+':'+state.day; const fin={at:new Date().toISOString()};
  try{ await window.storage.set(k, JSON.stringify(fin), false); }catch(_){}
  finCache[k]=fin;
  scheduleCloudPush();
  await renderAll();
  showWorkoutSummary(state.wk, state.day, fin);
}
function summaryText(ex, rec){
  rec=rec||{};
  const logged=(rec.sets||[]).filter(st=>st&&((st.w&&st.w!=='')||(st.r&&st.r!=='')));
  const parts=logged.map(st=>`${st.w||'–'}×${st.r||'–'}`).join(' · ');
  if(rec.done) return `<b>✓ done</b>${parts?' · '+parts:''}`;
  if(logged.length) return 'in progress · '+parts;
  return 'Not logged yet';
}

// ---- week completion ("Complete week") ----
let finWkCache={};
async function loadFinWk(wk){ const k='bts:finwk:w'+wk; if(k in finWkCache) return finWkCache[k];
  let v=null; try{ const r=await window.storage.get(k,false); if(r&&r.value) v=JSON.parse(r.value); }catch(_){}
  finWkCache[k]=v; return v; }
async function weekSummary(wk){
  let days=0, doneMv=0, totalMv=0, sets=0, vol=0, bestE=0, bestEx='';
  for(const day of ['mon','fri','sat']){
    const s=await daySummary(wk,day);
    totalMv+=s.total; doneMv+=s.done; sets+=s.sets; vol+=s.vol;
    if(s.bestE>bestE){ bestE=s.bestE; bestEx=s.bestEx; }
    if(await loadFin(wk,day)) days++;
  }
  return {days, doneMv, totalMv, sets, vol, bestE, bestEx};
}
async function completeWeek(){
  const k='bts:finwk:w'+state.wk, fin={at:new Date().toISOString()};
  try{ await window.storage.set(k, JSON.stringify(fin), false); }catch(_){}
  finWkCache[k]=fin; scheduleCloudPush();
  await renderAll();
  showWeekSummary(state.wk, fin);
}
function showWeekSummary(wk, fin){
  const w=DATA.weeks[wk-1];
  (async()=>{ const s=await weekSummary(wk);
    const adv = wk<12 ? `<button class="databtn" id="wkAdvance" style="margin-top:8px">Start Week ${wk+1} →</button>` : '';
    sheet.innerHTML=`<div class="grab"></div><h2>Week ${wk} complete</h2>`
      +`<p>${esc(w.block)}${w.deload?' · Deload':(w.vol?' · '+esc(w.vol):'')}${fin&&fin.at?` · closed ${new Date(fin.at).toLocaleDateString()}`:''}</p>`
      +`<div class="summgrid">`
      +`<div class="scell"><div class="sv">${s.days}/3</div><div class="sl">days finished</div></div>`
      +`<div class="scell"><div class="sv">${s.doneMv}/${s.totalMv}</div><div class="sl">movements done</div></div>`
      +`<div class="scell"><div class="sv">${s.sets}</div><div class="sl">sets logged</div></div>`
      +`<div class="scell"><div class="sv">${s.vol.toLocaleString()}</div><div class="sl">lb volume</div></div></div>`
      +(s.bestEx?`<p style="text-align:center">Top lift · <b style="color:var(--text)">${esc(s.bestEx)}</b> · ${s.bestE} lb est. 1RM</p>`:'')
      +adv
      +`<button class="databtn" id="summClose" style="margin-top:8px">Close</button>`;
    scrim.classList.add('show');
  })();
}

/* ---------- render ---------- */
function curWeek(){ return DATA.weeks[state.wk-1]; }

function renderHeader(){
  const w=curWeek();
  document.getElementById('wkLabel').textContent='Week '+w.n;
  let badges='';
  badges += `<span class="badge ${w.block==='Foundation'?'found':'ramp'}">${w.block}</span>`;
  if(w.deload) badges+='<span class="badge deload">Deload</span>';
  else if(w.vol) badges+=`<span class="badge vol">${w.vol}</span>`;
  if(finWkCache['bts:finwk:w'+w.n]) badges+='<span class="badge wkdone">✓ Done</span>';
  document.getElementById('wkMeta').innerHTML = badges;
  document.getElementById('prevWk').disabled = state.wk<=1;
  document.getElementById('nextWk').disabled = state.wk>=12;
}

async function renderTabs(){
  const tabs=document.getElementById('tabs'); tabs.innerHTML='';
  for(const d of DAYS){
    const exs=curWeek().days[d.k];
    const log=await loadDay(state.wk,d.k);
    const fin=await loadFin(state.wk,d.k);
    let done=0; exs.forEach((_,i)=>{ if(log[i]&&log[i].done) done++; });
    const el=document.createElement('button');
    el.className='tab'+(state.day===d.k?' on':''); el.dataset.d=d.k;
    el.innerHTML=`${fin?'<div class="tfin">✓</div>':''}<div class="ring">${done}/${exs.length}</div><div class="dow">${d.dow}</div><div class="typ">${d.typ}</div>`;
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
  const cards=[];
  // accordion: open the first not-yet-done lift (all done -> all collapsed)
  let openIdx=exs.findIndex((_,i)=>!(log[i]&&log[i].done));
  function updateStatuses(){
    const dc=dayCache[keyFor(state.wk,state.day)]||{};
    cards.forEach((c,i)=>{ const r=dc[i]||{}; c.classList.toggle('complete', !!r.done);
      const cs=c.querySelector('.csum'); if(cs) cs.innerHTML=summaryText(exs[i], r); });
  }
  function setOpen(idx){ updateStatuses(); openIdx=(openIdx===idx?-1:idx); cards.forEach((c,i)=>c.classList.toggle('collapsed', i!==openIdx)); }
  afterEdit=updateStatuses;
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

    const prevSets = prevByName[ex.ex]||[];
    card.innerHTML=`
      <div class="chead">
        <div class="cnum">${String(idx+1).padStart(2,'0')}</div>
        <div class="cttl">${nameHTML}<div class="tags">${tags}</div><div class="csum"></div></div>
        <span class="ccol">▾</span>
        <button class="done${rec.done?' on':''}" data-done="${idx}" aria-label="Mark done">✓</button>
      </div>
      <div class="sets" id="setbox-${idx}"></div>
      <div class="cmprow"><button class="cmpbtn" data-cmp="${idx}">Mark complete</button></div>
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
    cards.push(card);
    if(idx!==openIdx) card.classList.add('collapsed');
    card.querySelector('.chead').addEventListener('click',e=>{
      if(e.target.closest('[data-done]')||e.target.closest('a')) return;
      setOpen(idx);
    });

    const setbox=card.querySelector('#setbox-'+idx);
    function renderSets(){
      const resType=liveRec(idx).resType||resTypeFor(ex.ex);
      setbox.innerHTML='<div class="blocklbl"><span class="bln">Working sets</span></div>';
      for(let s=0;s<nSets;s++){
        const last=s===nSets-1, pv=prevSets[s];
        const wPre=(pv&&pv.w!=null&&pv.w!=='')?pv.w:null;
        const rPre=(pv&&pv.r!=null&&pv.r!=='')?pv.r:8;
        const sv=(liveRec(idx).sets||[])[s]||{};
        const hasVal=(sv.w&&sv.w!=='')||(sv.r&&sv.r!=='');
        const hint=(pv&&(pv.w||pv.r))?`<span class="lasthint">last wk <b>${esc(pv.w||'–')}</b> × ${esc(pv.r||'–')}</span>`:'';
        const clearBtn=hasVal?`<button class="setclear" aria-label="Clear this set" title="Clear this set">✕</button>`:'';
        const right=(hint||clearBtn)?`<span class="wtright">${hint}${clearBtn}</span>`:'';
        const ws=el('div','workset',`<div class="worktop"><span class="sn${last?' last':''}">Set ${s+1}</span>${last?'<span class="failpill">FAILURE</span>':''}${right}</div>`);
        const cb=ws.querySelector('.setclear');
        if(cb) cb.addEventListener('click',()=>{ const r=liveRec(idx); if(r.sets&&r.sets[s]) r.sets[s]={};
          queueSave(state.wk,state.day); renderSets(); refreshCounts(); updateStatuses(); });
        const fields=el('div','workfields');
        const wf=el('div',null,'<div class="fieldlbl">Weight</div>');
        wf.appendChild(makeWeightStepper(idx, ex, s, resType, wPre, s===0?()=>{
          const r=liveRec(idx); r.resType=RES_ORDER[(RES_ORDER.indexOf(resType)+1)%RES_ORDER.length];
          queueSave(state.wk,state.day); renderSets();
        }:null));
        const rf=el('div','repsrow','<div class="rl"><div class="fieldlbl">Reps</div></div>');
        rf.appendChild(makeRepsStepper(idx, ex, s, rPre));
        fields.append(wf, rf);
        ws.appendChild(fields);
        setbox.appendChild(ws);
      }
    }
    renderSets();

    const doneBtn=card.querySelector('[data-done]'), cmpBtn=card.querySelector('[data-cmp]');
    function refreshDone(){
      const on=!!liveRec(idx).done;
      doneBtn.classList.toggle('on',on);
      cmpBtn.classList.toggle('complete',on);
      cmpBtn.textContent=on?'✓ Completed':'Mark complete';
      updateStatuses();
    }
    function toggleDone(){ const r=liveRec(idx); r.done=!r.done; queueSave(state.wk,state.day); refreshCounts(); refreshDone(); }
    doneBtn.addEventListener('click',toggleDone);
    cmpBtn.addEventListener('click',toggleDone);
    refreshDone();
    card.querySelector('[data-more]').addEventListener('click',function(){
      const mb=document.getElementById('mb-'+idx); mb.classList.toggle('open'); this.classList.toggle('open');
    });
  });
  updateStatuses();

  // finish-workout bar
  const fin=await loadFin(state.wk, state.day);
  const bar=el('div','finbar');
  bar.innerHTML=fin
    ? `<button class="finbtn done" id="finBtn">✓ Workout saved — view summary</button>`
    : `<button class="finbtn" id="finBtn">Finish workout</button>`;
  bar.querySelector('#finBtn').addEventListener('click',()=> fin? showWorkoutSummary(state.wk,state.day,fin) : finishWorkout());
  list.appendChild(bar);

  // complete-week bar
  const finwk=await loadFinWk(state.wk);
  const wkbar=el('div','wkbar');
  wkbar.innerHTML=finwk
    ? `<button class="wkbtn done" id="wkBtn">✓ Week ${state.wk} complete — view summary</button>`
    : `<button class="wkbtn" id="wkBtn">Complete Week ${state.wk}</button>`;
  wkbar.querySelector('#wkBtn').addEventListener('click',()=> finwk? showWeekSummary(state.wk,finwk) : completeWeek());
  list.appendChild(wkbar);
}

function refreshCounts(){
  const w=curWeek(); const exs=w.days[state.day]; const log=dayCache[keyFor(state.wk,state.day)]||{};
  let done=0; exs.forEach((_,i)=>{ if(log[i]&&log[i].done) done++; });
  const pb=document.querySelector('.daybar .prog'); if(pb) pb.innerHTML=`<b>${done}</b>/${exs.length} done`;
  // tab ring
  const tab=document.querySelector(`.tab[data-d="${state.day}"] .ring`); if(tab) tab.textContent=`${done}/${exs.length}`;
}

async function renderAll(){
  await loadFinWk(state.wk);
  persistPos();
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
  <h3>Sync &amp; account</h3>
  <p>You're signed in as <b style="color:var(--text)">${LL_USER?LL_USER.charAt(0).toUpperCase()+LL_USER.slice(1):'—'}</b>. Your logs save to the cloud automatically and load on any device when you open the app and pick your name. Tap your name in the top bar to switch between Walt and Luke.</p>
  <h3>Backup &amp; restore</h3>
  <p>Cloud sync is automatic, but you can still export a backup to keep your own copy or restore after a reset.</p>
  <button class="databtn" id="expJson">⬇  Download backup file (.json)</button>
  <button class="databtn" id="expCsv">⬇  Export training log (.csv)</button>
  <button class="databtn" id="impBtn">↺  Restore from a backup file</button>
  <input type="file" id="impFile" accept="application/json,.json" style="display:none">
  <button class="dangerbtn" id="resetBtn">Reset all logged data</button>
  <div class="tiny">Your sets save to the cloud as you log them.<br>Adapted from Jeff Nippard’s Intermediate-Advanced program · personal use.</div>`;
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
    dayCache={}; finCache={}; finWkCache={}; prFiredSession.clear(); scheduleCloudPush(); scrim.classList.remove('show'); await renderAll(); await computePRBase();
    try{ if(document.getElementById('bodyView').style.display!=='none'){ await renderProg(); await renderShelf(); } }catch(_){}
    alert('Backup restored.'); })();
}
sheet.addEventListener('click',async(e)=>{
  const id=e.target.id;
  if(id==='resetBtn'){
    if(!confirm('Erase every logged set across all 12 weeks? This cannot be undone.')) return;
    try{ const r=await window.storage.list('bts:', false); for(const k of ((r&&r.keys)||[])){ try{ await window.storage.delete(k,false);}catch(_){} } }
    catch(_){ for(let wk=1;wk<=12;wk++) for(const d of ['mon','fri','sat']){ try{ await window.storage.delete(keyFor(wk,d),false);}catch(__){} } }
    dayCache={}; finCache={}; finWkCache={}; prFiredSession.clear(); scheduleCloudPush(); scrim.classList.remove('show'); await renderAll(); await computePRBase(); renderShelf();
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
  if(!train){ renderProg(); renderShelf(); }
  window.scrollTo(0,0);
};

/* ---------- gamification wiring ---------- */
document.getElementById('shelf').addEventListener('click',e=>{
  const m=e.target.closest('[data-ach]'); if(m) openAch(shelfList[+m.dataset.ach]);
});
sheet.addEventListener('click',e=>{
  if(e.target.id==='achClose'||e.target.id==='summClose') scrim.classList.remove('show');
  if(e.target.id==='wkAdvance'){ if(state.wk<12){ state.wk++; persistPos(); } scrim.classList.remove('show'); renderAll(); }
});

/* ===================== cloud sync (Walt / Luke) ===================== */
const LL_USERS=['walt','luke'];
let LL_USER=null;
try{ LL_USER=localStorage.getItem('ll:user'); }catch(_){}
if(!LL_USERS.includes(LL_USER)) LL_USER=null;

function llGet(k){ try{ return localStorage.getItem(k); }catch(_){ return null; } }
function llSet(k,v){ try{ localStorage.setItem(k,v); }catch(_){} }
function llDel(k){ try{ localStorage.removeItem(k); }catch(_){} }
function setDirty(){ llSet('ll:dirty','1'); }
function clearDirty(){ llDel('ll:dirty'); }
function isDirty(){ return llGet('ll:dirty')==='1'; }

async function localKeys(){ try{ const r=await window.storage.list('bts:',false); return (r&&r.keys)||[]; }catch(_){ return []; } }
async function localHasData(){ return (await localKeys()).length>0; }
async function clearLocal(){ for(const k of await localKeys()){ try{ await window.storage.delete(k,false); }catch(_){} } }

let pushTimer=null;
function scheduleCloudPush(){ if(!LL_USER) return; setDirty(); clearTimeout(pushTimer); pushTimer=setTimeout(flushCloud,1200); }
async function flushCloud(){
  if(!LL_USER) return;
  let blob; try{ blob=JSON.stringify(await gatherAll()); }catch(_){ return; }
  try{
    const res=await fetch('/api/state',{method:'PUT',headers:{'content-type':'application/json'},
      body:JSON.stringify({user:LL_USER,data:blob})});
    if(res&&res.ok) clearDirty();
  }catch(_){ /* offline — stay dirty, retry on next change / online / open */ }
}
async function cloudPull(){
  if(!LL_USER) return false;
  let obj;
  try{ const res=await fetch('/api/state?user='+encodeURIComponent(LL_USER)); if(!res||!res.ok) return false;
    const j=await res.json(); obj=JSON.parse((j&&j.data)||'{}'); }
  catch(_){ return false; }
  await clearLocal();
  for(const k in obj){ try{ await window.storage.set(k, JSON.stringify(obj[k]), false); }catch(_){} }
  dayCache={}; finCache={}; finWkCache={};
  return true;
}

function updateUserChip(){
  const c=document.getElementById('userChip');
  if(LL_USER){ c.style.display=''; c.className='userchip '+LL_USER; c.textContent=LL_USER.charAt(0).toUpperCase()+LL_USER.slice(1); }
  else c.style.display='none';
}
function showSignin(){ document.getElementById('signin').classList.add('show'); }
function hideSignin(){ document.getElementById('signin').classList.remove('show'); }

async function bootSync(){
  if(isDirty()) await flushCloud();   // unpushed local work wins — push it, don't clobber
  else await cloudPull();             // get latest from the cloud
  await renderAll();
  await computePRBase();
  try{ if(document.getElementById('bodyView').style.display!=='none'){ await renderProg(); await renderShelf(); } }catch(_){}
}
async function pickUser(u){
  if(!LL_USERS.includes(u)) return;
  LL_USER=u; llSet('ll:user',u);
  if(await localHasData()) setDirty();  // first sign-in carries existing local data up to this name
  updateUserChip(); hideSignin();
  await bootSync();
}
async function switchUser(){
  await flushCloud();                   // push current user's pending changes first
  await clearLocal();
  dayCache={}; finCache={}; finWkCache={}; prFiredSession.clear(); PR_BASE={}; clearDirty();
  LL_USER=null; llDel('ll:user');
  updateUserChip(); showSignin();
}

document.querySelectorAll('.sibtn').forEach(b=>b.addEventListener('click',()=>pickUser(b.dataset.user)));
document.getElementById('userChip').addEventListener('click',switchUser);
window.addEventListener('online',()=>{ if(isDirty()) flushCloud(); });

/* ---------- boot ---------- */
(async()=>{
  progState.sel={type:'ex', name:DATA.weeks[0].days.mon[0].ex};
  updateUserChip();
  if(LL_USER){ await bootSync(); }
  else { await renderAll(); showSignin(); }
})();
