// Planned-volume overview. One primary target per exercise, not a recovery or
// physiological estimate; all targets can be corrected in the program editor.
const PROGRAM_MUSCLES=['Chest','Back','Front delts','Side delts','Rear delts','Biceps','Triceps','Forearms','Quads','Hamstrings','Glutes','Calves','Adductors','Core','Lower back','Other'];
function primaryMuscle(ex){
  const explicit=ex.targetMuscle||ex.customIdentity?.targetMuscle;
  if(PROGRAM_MUSCLES.includes(explicit))return explicit;
  const name=ex.ex||'';
  if(/lateral raise/i.test(name))return 'Side delts';
  if(/rear delt|face pull|reverse pec deck/i.test(name))return 'Rear delts';
  if(/shoulder press|front raise/i.test(name))return 'Front delts';
  if(/triceps|tricep|pressdown|skull crusher/i.test(name))return 'Triceps';
  if(/leg curl|nordic|\bRDL\b/i.test(name))return 'Hamstrings';
  if(/curl/i.test(name))return 'Biceps';
  if(/calf|calves/i.test(name))return 'Calves';
  if(/hip abduction|hip thrust|glute/i.test(name))return 'Glutes';
  if(/adduct/i.test(name))return 'Adductors';
  if(/squat|leg press|leg extension|lunge/i.test(name))return 'Quads';
  const map=typeof EX_MUSCLE!=='undefined'?EX_MUSCLE[name]:null;
  if(map){const target=Object.keys(map).sort((a,b)=>map[b]-map[a])[0];
    const translated={'Shoulders':'Front delts','Rear Delts':'Rear delts','Lower Back':'Lower back','Upper Abs':'Core','Lower Abs':'Core','Obliques':'Core'}[target]||target;
    if(PROGRAM_MUSCLES.includes(translated))return translated;
  }
  const group=ex.customIdentity?.group||(typeof EX_GROUP!=='undefined'?EX_GROUP[name]:null);
  return PROGRAM_MUSCLES.includes(group)?group:'Other';
}
function plannedWeekStats(week){
  const groups=Object.fromEntries(PROGRAM_MUSCLES.map(m=>[m,0])),days=[];let total=0,movements=0;
  for(const day of PDAYS){const exercises=(week.days[day]||[]).map((ex,index)=>({ex,index,muscle:primaryMuscle(ex),sets:Math.max(0,Number(ex.sets)||0)}));
    for(const item of exercises){groups[item.muscle]+=item.sets;total+=item.sets;movements++;}
    days.push({day,exercises,sets:exercises.reduce((n,e)=>n+e.sets,0)});
  }
  return {groups,days,total,movements,workouts:days.filter(d=>d.exercises.length).length};
}
function validateProgramEdits(edits){
  if(!Array.isArray(edits)||edits.length>200)throw Error('Invalid saved program edits.');
  const seen=new Set();
  for(const edit of edits){
    const key=edit.day+'|'+edit.source;
    if(!PDAYS.includes(edit.day)||typeof edit.source!=='string'||!edit.source||seen.has(key)||!Array.isArray(edit.versions)||!edit.versions.length)throw Error('Invalid saved program edit.');seen.add(key);
    for(const v of edit.versions){
      if(!Number.isSafeInteger(v.from)||v.from<0||typeof v.active!=='boolean'||!v.exercise||typeof v.exercise.name!=='string'||!v.exercise.name.trim()||v.exercise.name.length>100||!RES_ORDER.includes(v.exercise.equipment)||typeof v.exercise.label!=='string'||v.exercise.label.length>80||!Number.isInteger(v.sets)||v.sets<0||v.sets>10||typeof v.reps!=='string'||!/^\d{1,3}(?:-\d{1,3})?$/.test(v.reps)||!PROGRAM_MUSCLES.includes(v.muscle))throw Error('Check the movement, sets (0–10), rep range and muscle group.');
      const range=v.reps.split('-').map(Number);if(range.some(n=>n<1)||(range.length===2&&range[1]<range[0]))throw Error('Enter a rep range such as 8-12.');
    }
  }
}
function applyScheduledEdits(scheduled,edits,rank,day,log,closed){
  return scheduled.flatMap((original,index)=>{
    const rec=log[index],source=original.ex;
    if(closed&&rec?.plannedRemoved&&!hasSessionData(rec))return [];
    // Recorded prescriptions win even if the edit was later stopped or changed.
    if(rec?.planned?.programOverride&&hasSessionData(rec)||closed&&rec?.planned?.programOverride)return [{...rec.planned,slotKey:index,programSource:source}];
    if(closed||hasSessionData(rec))return [{...original,slotKey:index,programSource:source}];
    const edit=edits.find(e=>e.day===day&&e.source===source),v=edit?ruleAt(edit,rank):null;
    if(!v?.active)return [{...original,slotKey:index,programSource:source}];
    if(v.sets===0)return [];
    return [{...original,ex:v.exercise.name,sets:v.sets,reps:v.reps,demo:v.exercise.name===source?original.demo:null,
      targetMuscle:v.muscle,customIdentity:{...v.exercise},programOverride:true,programSource:source,slotKey:index}];
  });
}
let programFilter=null;
async function snapshotProgramDay(wk,day){
  if(await loadFin(wk,day)||await loadFinWk(wk))return;
  const log=await loadDay(wk,day),exs=DATA.weeks[wk-1].days[day]||[];
  const original=pickProgram(LL_USER).weeks[wk-1].days[day]||[];
  original.forEach((ex,index)=>{
    if(!exs.some((row,i)=>!row.logKey&&logSlot(row,i)===index)&&!hasSessionData(log[index]))log[index]={...log[index],plannedRemoved:true};
  });
  exs.forEach((ex,i)=>{
    if(!ex.logKey&&!ex.programOverride)return;
    const slot=logSlot(ex,i),rec=log[slot]||(log[slot]={done:false,sets:[]});
    if(!hasSessionData(rec)){
      rec.planned={...ex};
      if(!rec.exercise||(!rec.resType&&!rec.variants?.length))rec.exercise={...ex.customIdentity};
    }
  });
  queueSave(wk,day);
}
function renderProgramOverview(){
  const root=document.getElementById('programView');if(!root)return;
  const week=DATA.weeks[state.wk-1],stats=plannedWeekStats(week),max=Math.max(1,...Object.values(stats.groups));
  const openDays=[...root.querySelectorAll('details[open]')].map(e=>e.dataset.day);
  const shown=PROGRAM_MUSCLES.filter(m=>stats.groups[m]>0||m==='Side delts');
  root.innerHTML=`<div class="book-heading"><h1>Your program</h1><p>Plan your week. Make room for your priorities.</p></div><label class="book-label">Program week<select id="programWeek">${DATA.weeks.map(w=>`<option value="${w.n}"${w.n===state.wk?' selected':''}>Week ${w.n}${w.deload?' · Deload':''}</option>`).join('')}</select></label><div class="program-stats"><div><strong>${stats.total}</strong><span>planned sets</span></div><div><strong>${stats.workouts}</strong><span>workouts</span></div><div><strong>${stats.movements}</strong><span>exercise slots</span></div></div><h2 class="book-section-title">Weekly sets by muscle</h2><p class="book-note">Working sets, assigned once to each lift’s primary target. Warm-ups and indirect work are excluded. Tap a muscle to see its exercises.</p><div class="program-muscles">${shown.map(m=>`<button type="button" class="program-muscle" data-muscle="${m}" aria-pressed="${programFilter===m}"><span>${m}</span><span class="program-track" aria-hidden="true"><span style="width:${stats.groups[m]/max*100}%"></span></span><strong>${stats.groups[m]}</strong></button>`).join('')}</div><div class="program-list-heading"><h2 class="book-section-title">${programFilter?esc(programFilter)+' exercises':'Your workouts'}</h2>${programFilter?'<button class="book-action" data-clear-filter>Show all</button>':''}</div><button class="add-exercise" data-program-add>+ Add / manage recurring exercises</button><div class="program-days">${stats.days.map(d=>{
    const items=d.exercises.filter(e=>!programFilter||e.muscle===programFilter);
    const originals=pickProgram(LL_USER).weeks[state.wk-1].days[d.day]||[];
    const removed=originals.map((ex,index)=>({ex,index})).filter(o=>!d.exercises.some(e=>!e.ex.logKey&&(e.ex.slotKey??e.index)===o.index));
    if(programFilter&&!items.length)return '';
    return `<details class="program-day" data-day="${d.day}"${openDays.includes(d.day)||programFilter?' open':''}><summary><span>${DAYS.find(x=>x.k===d.day).dow}</span><span>${programFilter?items.reduce((n,e)=>n+e.sets,0):d.sets} sets · ${items.length} exercises</span></summary>${items.map(({ex,index,muscle,sets})=>{
      const locked=hasSessionData(dayRecord(dayCache[keyFor(state.wk,d.day)]||{},ex,index))||finCache['bts:fin:w'+state.wk+':'+d.day]||finWkCache['bts:finwk:w'+state.wk];
      return `<button class="program-exercise" data-program-day="${d.day}" data-program-index="${index}"><span><strong>${esc(ex.ex)}</strong><small>${esc(EH.label(EH.identity(ex)).split(' · ').slice(1).join(' · '))} · ${muscle}</small><small>${ex.logKey?'Recurring extra':ex.programOverride?'Personal plan':'Scheduled'}${locked?' · Saved session protected':''}</small></span><span>${sets} × ${esc(ex.reps)}<small>Edit ›</small></span></button>`;
    }).join('')}${!programFilter&&removed.length?`<div class="program-removed">${removed.map(o=>`<button data-program-restore="${o.index}" data-program-day="${d.day}">${esc(o.ex.ex)} · removed · Restore / edit</button>`).join('')}</div>`:''}</details>`;
  }).join('')||'<p class="book-note">No exercises assigned to this muscle in this week.</p>'}</div>`;
}
async function saveScheduledEdit(day,source,version){
  await flushDayWrites();const plan=await loadCustomProgram();plan.edits=plan.edits||[];
  let edit=plan.edits.find(e=>e.day===day&&e.source===source);
  if(!edit){edit={day,source,versions:[]};plan.edits.push(edit);}
  edit.versions=edit.versions.filter(v=>v.from<version.from);edit.versions.push(version);
  validateCustomProgram(plan);await window.storage.set(CUSTOM_PROGRAM_KEY,JSON.stringify(plan),false);
  scheduleCloudPush();await renderAll();
}
async function showProgramEditor(day,index,restore=false){
  const originalList=pickProgram(LL_USER).weeks[state.wk-1].days[day]||[];
  const current=restore?{...originalList[index],slotKey:index}:DATA.weeks[state.wk-1].days[day][index];
  if(!current)return;
  state.day=day;
  if(current.logKey){await showCustomProgram(current.logKey.slice(6));return;}
  const source=current.programSource||originalList[current.slotKey??index].ex;
  const id=EH.identity(current),cycle=(await loadBaseline()).cycles||0,from=programRank(cycle,state.wk,day);
  sheet.innerHTML=`<div class="grab"></div><h2>Edit program exercise</h2><p>Applies to ${esc(source)} on ${day.toUpperCase()} from Week ${state.wk} onward, including future cycles. Sessions with saved data stay unchanged.</p>`;
  const form=el('form','recurring-form');
  form.innerHTML=`<label>Exercise<input name="exercise" required maxlength="100"></label><label>Equipment<select name="equipment">${RES_ORDER.map(k=>`<option value="${k}">${WRES[k].label}</option>`).join('')}</select></label><label>Setup name (optional)<input name="setup" maxlength="80"></label><label>Primary muscle<select name="muscle">${PROGRAM_MUSCLES.map(m=>`<option>${m}</option>`).join('')}</select></label><div class="recurring-fields"><label>Sets (0 removes)<input name="sets" type="number" min="0" max="10" required step="1"></label><label>Rep range<input name="reps" required pattern="[0-9]{1,3}(-[0-9]{1,3})?"></label></div><p class="recurring-error" role="alert"></p><button class="databtn" type="submit">Save program changes</button><button class="databtn" type="button" data-reset-program>Restore original prescription</button><button class="databtn" type="button" data-cancel-program>Cancel</button>`;
  const field=n=>form.querySelector(`[name="${n}"]`);
  field('exercise').value=id.name;field('equipment').value=id.equipment;field('setup').value=id.label;
  field('muscle').value=primaryMuscle(current);field('sets').value=restore?0:current.sets;field('reps').value=current.reps;
  field('exercise').addEventListener('change',()=>{field('equipment').value=resTypeFor(field('exercise').value);field('muscle').value=primaryMuscle({ex:field('exercise').value});});
  let saving=false;
  async function apply(active){
    if(saving)return;if(active&&!form.reportValidity())return;
    const original=originalList[current.slotKey??index];
    const exercise=active?{name:field('exercise').value.trim().replace(/\s+/g,' '),equipment:field('equipment').value,label:field('setup').value.trim()}:EH.identity(original);
    exercise.group=EX_GROUP[exercise.name]||'Other';
    const v={from,active,exercise,sets:active?Number(field('sets').value):original.sets,reps:active?field('reps').value.trim():original.reps,muscle:active?field('muscle').value:primaryMuscle(original)};
    saving=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{await saveScheduledEdit(day,source,v);scrim.classList.remove('show');}
    catch(e){form.querySelector('.recurring-error').textContent=e.message||'Could not save this change.';}
    finally{saving=false;form.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  form.addEventListener('submit',e=>{e.preventDefault();apply(true);});
  form.querySelector('[data-reset-program]').onclick=()=>apply(false);
  form.querySelector('[data-cancel-program]').onclick=()=>scrim.classList.remove('show');
  sheet.appendChild(form);scrim.classList.add('show');
}
document.getElementById('programView').addEventListener('change',e=>{if(e.target.id==='programWeek'){state.wk=Number(e.target.value);renderAll();}});
document.getElementById('programView').addEventListener('click',e=>{
  const muscle=e.target.closest('[data-muscle]');if(muscle){programFilter=programFilter===muscle.dataset.muscle?null:muscle.dataset.muscle;renderProgramOverview();return;}
  if(e.target.closest('[data-clear-filter]')){programFilter=null;renderProgramOverview();return;}
  if(e.target.closest('[data-program-add]')){state.day='mon';showCustomProgram();return;}
  const edit=e.target.closest('[data-program-index]');if(edit){showProgramEditor(edit.dataset.programDay,Number(edit.dataset.programIndex));return;}
  const restore=e.target.closest('[data-program-restore]');if(restore)showProgramEditor(restore.dataset.programDay,Number(restore.dataset.programRestore),true);
});
