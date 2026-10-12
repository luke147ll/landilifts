// Planned-volume overview. One primary target per exercise, not a recovery or
// physiological estimate; all targets can be corrected in the program editor.
const PROGRAM_MUSCLES=['Chest','Back','Front delts','Side delts','Rear delts','Biceps','Triceps','Forearms','Quads','Hamstrings','Glutes','Calves','Adductors','Core','Lower back','Other'];
const EXTRA_EXERCISE_CHOICES=[
  {name:'Barbell Hip Thrust',muscle:'Glutes',equipment:'plates'},
  {name:'Machine Hip Thrust',muscle:'Glutes',equipment:'machine'},
  {name:'DB Glute Bridge',muscle:'Glutes',equipment:'dumbbell'},
  {name:'Cable Glute Kickback',muscle:'Glutes',equipment:'machine'}
];
function recurringExerciseChoices(program,plan){
  const choices=new Map();
  const add=(name,muscle,equipment)=>{if(name)choices.set(name,{name,muscle:muscle||primaryMuscle({ex:name}),equipment:equipment||resTypeFor(name)});};
  Object.keys(EX_MUSCLE).forEach(name=>add(name));
  program.weeks.forEach(w=>PDAYS.forEach(d=>(w.days[d]||[]).forEach(ex=>add(ex.ex,primaryMuscle(ex)))));
  EXTRA_EXERCISE_CHOICES.forEach(ex=>add(ex.name,ex.muscle,ex.equipment));
  plan.rules.forEach(rule=>{const v=rule.versions.at(-1);if(v)add(v.exercise.name,primaryMuscle({ex:v.exercise.name,customIdentity:v.exercise}),v.exercise.equipment);});
  const catalog=new Map([...choices.values()].map(ex=>[EH.key({name:ex.name,equipment:ex.equipment,label:''}),{...ex,label:''}]));
  (plan.library||[]).forEach(ex=>catalog.set(EH.key(ex),{name:ex.name,equipment:ex.equipment,label:ex.label,muscle:ex.targetMuscle}));
  return [...catalog.entries()].map(([key,ex])=>({...ex,key})).sort((a,b)=>a.name.localeCompare(b.name)||a.key.localeCompare(b.key));
}
function validateExerciseLibrary(library){
  if(library===undefined)return;
  if(!Array.isArray(library)||library.length>500)throw Error('Invalid exercise library.');
  const seen=new Set();
  for(const ex of library){
    if(!ex||typeof ex.name!=='string'||!ex.name.trim()||ex.name.length>100||!RES_ORDER.includes(ex.equipment)||typeof ex.label!=='string'||ex.label.length>80||!PROGRAM_MUSCLES.includes(ex.targetMuscle))throw Error('Enter an exercise name, equipment and primary muscle.');
    const key=EH.key(ex);if(seen.has(key))throw Error('Duplicate exercise library entry.');seen.add(key);
  }
}
function addLibraryExercise(plan,exercise){
  const entry={...exercise,name:exercise.name.trim().replace(/\s+/g,' '),label:exercise.label.trim().replace(/\s+/g,' ')};
  validateExerciseLibrary([entry]);
  plan.library=(plan.library||[]).filter(ex=>EH.key(ex)!==EH.key(entry));plan.library.push(entry);
}
async function saveLibraryExercise(exercise){
  const plan=await loadCustomProgram();addLibraryExercise(plan,exercise);validateCustomProgram(plan);
  await window.storage.set(CUSTOM_PROGRAM_KEY,JSON.stringify(plan),false);scheduleCloudPush();return plan;
}
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
function indirectMuscles(ex){
  const map=EX_MUSCLE[ex.ex];
  if(!map)return null;
  const aliases={'Shoulders':'Front delts','Rear Delts':'Rear delts','Lower Back':'Lower back','Upper Abs':'Core','Lower Abs':'Core','Obliques':'Core'};
  return [...new Set(Object.entries(map).filter(([,weight])=>weight>0&&weight<1).map(([m])=>aliases[m]||m))]
    .filter(m=>PROGRAM_MUSCLES.includes(m)&&m!==primaryMuscle(ex));
}
function plannedWeekStats(week){
  const groups=Object.fromEntries(PROGRAM_MUSCLES.map(m=>[m,0])),indirect={...groups},days=[];let total=0,movements=0,unmapped=0;
  for(const day of PDAYS){const exercises=(week.days[day]||[]).map((ex,index)=>({ex,index,muscle:primaryMuscle(ex),indirect:indirectMuscles(ex),sets:Math.max(0,Number(ex.sets)||0)}));
    for(const item of exercises){groups[item.muscle]+=item.sets;total+=item.sets;movements++;if(item.indirect===null)unmapped++;for(const m of item.indirect||[])indirect[m]+=item.sets;}
    days.push({day,exercises,sets:exercises.reduce((n,e)=>n+e.sets,0)});
  }
  return {groups,indirect,unmapped,days,total,movements,workouts:days.filter(d=>d.exercises.length).length};
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
    if((rec?.planned?.programOverride||rec?.planned?.weekMode)&&(hasSessionData(rec)||closed))return [{...rec.planned,slotKey:index,programSource:source}];
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
    if(!ex.logKey&&!ex.programOverride&&!ex.weekMode)return;
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
  const week=DATA.weeks[state.wk-1],stats=plannedWeekStats(week),max=Math.max(1,...Object.values(stats.groups),...Object.values(stats.indirect));
  const openDays=[...root.querySelectorAll('details[open]')].map(e=>e.dataset.day);
  const shown=PROGRAM_MUSCLES.filter(m=>stats.groups[m]>0||stats.indirect[m]>0||m==='Side delts');
  root.innerHTML=`<div class="book-heading"><h1>Your program</h1><button type="button" class="book-action" data-program-export>Export full program</button><p>Plan your week. Make room for your priorities.</p></div><label class="book-label">Program week<select id="programWeek">${DATA.weeks.map(w=>`<option value="${w.n}"${w.n===state.wk?' selected':''}>Week ${w.n}${w.deload?' · Deload':''}</option>`).join('')}</select></label><label class="book-label">Week intensity<select id="weekIntensity"><option value="scheduled"${!week.intensityMode?' selected':''}>Original schedule${pickProgram(LL_USER).weeks[state.wk-1].deload?' · intro/deload':''}</option><option value="normal"${week.intensityMode==='normal'?' selected':''}>Normal training</option><option value="light"${week.intensityMode==='light'?' selected':''}>Lighter week</option></select></label><p class="book-note">For this week and cycle only. Lighter week uses about half the sets (rounded up), including extras, with 3–4 reps in reserve and no intensity techniques. Normal keeps regular sets and effort targets. Saved exercises and completed workouts stay unchanged; totals may include both.</p><p id="weekIntensityError" role="alert" class="recurring-error"></p><div class="program-stats"><div><strong>${stats.total}</strong><span>planned sets</span></div><div><strong>${stats.workouts}</strong><span>workouts</span></div><div><strong>${stats.movements}</strong><span>exercise slots</span></div></div><h2 class="book-section-title">Weekly sets by muscle</h2><p class="book-note">Direct = sets targeting that muscle. Indirect = sets where it assists, such as triceps during pressing. Each assisting set counts once, not as an equivalent direct set. Warm-ups excluded. Tap a muscle to see both sources.</p>${stats.unmapped?`<p class="book-note">Indirect work is not mapped for ${stats.unmapped} exercise slot${stats.unmapped===1?'':'s'} this week; those contributions are not counted.</p>`:''}<div class="program-volume-legend"><span>Muscle</span><span>Direct</span><span>Indirect</span></div><div class="program-muscles">${shown.map(m=>`<button type="button" class="program-muscle" data-muscle="${m}" aria-pressed="${programFilter===m}"><span>${m}</span><span class="program-count"><span class="program-track" aria-hidden="true"><span style="width:${stats.groups[m]/max*100}%"></span></span><strong><span class="sr-only">Direct sets: </span>${stats.groups[m]}</strong></span><span class="program-count indirect"><span class="program-track" aria-hidden="true"><span style="width:${stats.indirect[m]/max*100}%"></span></span><strong><span class="sr-only">Indirect sets: </span>${stats.indirect[m]}</strong></span></button>`).join('')}</div><div class="program-list-heading"><h2 class="book-section-title">${programFilter?esc(programFilter)+' exercises':'Your workouts'}</h2>${programFilter?'<button class="book-action" data-clear-filter>Show all</button>':''}</div><button class="add-exercise" data-program-add>+ Add / manage recurring exercises</button><div class="program-days">${stats.days.map(d=>{
    const items=d.exercises.filter(e=>!programFilter||e.muscle===programFilter||e.indirect?.includes(programFilter));
    const originals=pickProgram(LL_USER).weeks[state.wk-1].days[d.day]||[];
    const removed=originals.map((ex,index)=>({ex,index})).filter(o=>!d.exercises.some(e=>!e.ex.logKey&&(e.ex.slotKey??e.index)===o.index));
    if(programFilter&&!items.length)return '';
    return `<details class="program-day" data-day="${d.day}"${openDays.includes(d.day)||programFilter?' open':''}><summary><span>${DAYS.find(x=>x.k===d.day).dow}</span><span>${programFilter?`${items.filter(e=>e.muscle===programFilter).reduce((n,e)=>n+e.sets,0)} direct · ${items.filter(e=>e.indirect?.includes(programFilter)).reduce((n,e)=>n+e.sets,0)} indirect`:d.sets+' sets'} · ${items.length} exercises</span></summary>${items.map(({ex,index,muscle,sets})=>{
      const locked=hasSessionData(dayRecord(dayCache[keyFor(state.wk,d.day)]||{},ex,index))||finCache['bts:fin:w'+state.wk+':'+d.day]||finWkCache['bts:finwk:w'+state.wk];
      return `<button class="program-exercise" data-program-day="${d.day}" data-program-index="${index}"><span><strong>${esc(ex.ex)}</strong><small>${esc(EH.label(EH.identity(ex)).split(' · ').slice(1).join(' · '))} · ${muscle}</small><small>${ex.logKey?'Recurring extra':ex.programOverride?'Personal plan':'Scheduled'}${locked?' · Saved session protected':''}</small></span><span>${sets} × ${esc(ex.reps)}<small>${programFilter?(muscle===programFilter?'Direct':'Indirect')+' · ':''}Edit ›</small></span></button>`;
    }).join('')}${!programFilter&&removed.length?`<div class="program-removed">${removed.map(o=>`<button data-program-restore="${o.index}" data-program-day="${d.day}">${esc(o.ex.ex)} · removed · Restore / edit</button>`).join('')}</div>`:''}</details>`;
  }).join('')||'<p class="book-note">No exercises assigned to this muscle in this week.</p>'}</div>`;
}
function programReviewText(program,plan,cycle,logs={},finished={}){
  const clean=value=>String(value??'').replace(/[\r\n\t]+/g,' ').trim();
  const lines=['LANDI LIFTS — FULL PROGRAM REVIEW',`Cycle ${cycle+1} · ${program.weeks.length} weeks · Monday / Wednesday / Friday`,
    '', 'SCOPE AND COUNTING',
    'This is the current effective program, including personal edits, recurring additions and week-intensity choices. Saved exercises and completed sessions retain their prescriptions, so a week may contain mixed intensities.',
    'Sets are planned working sets, not proof of completed training. Logging may be PR-only. Warm-ups are separate. Weights, reps actually logged, PR history and account/check-in details are excluded.',
    'Direct sets count once under the assigned primary muscle. Indirect sets count once for each mapped assisting muscle; they are NOT equivalent direct sets. Unknown indirect contributions are flagged. A compound exercise can train more than its single primary label suggests.',
    'Lighter week = half the normal sets rounded up, minimum one, with 3–4 reps in reserve and no intensity techniques. Choices apply only to this cycle. RPE 10 means no reps in reserve.',
    '', 'REVIEW REQUEST',
    'Assess muscle coverage, weekly workload, exercise order, progression and recovery demands. Distinguish observations from assumptions. Ask about goals, experience, recovery and actual progress before prescribing changes. Do not infer completed volume from this plan.', ''];
  for(const w of program.weeks){
    const stats=plannedWeekStats(w);
    lines.push(`WEEK ${w.n} — ${clean(w.block)}`,`Intensity: ${w.intensityMode==='light'?'Lighter week':w.intensityMode==='normal'?'Normal training':w.deload?'Original schedule: intro/deload':'Original schedule: normal'}`,`Planned working sets: ${stats.total} · Workouts: ${stats.workouts} · Exercise slots: ${stats.movements}`, 'Weekly muscle sets (direct / indirect):');
    for(const m of PROGRAM_MUSCLES)if(stats.groups[m]||stats.indirect[m])lines.push(`  ${m}: ${stats.groups[m]} / ${stats.indirect[m]}`);
    if(stats.unmapped)lines.push(`  Indirect work unmapped for ${stats.unmapped} exercise slots.`);
    for(const {day,exercises,sets} of stats.days){
      const log=logs[keyFor(w.n,day)]||{},closed=finished['bts:fin:w'+w.n+':'+day]||finished['bts:finwk:w'+w.n];
      lines.push('',`${day.toUpperCase()} — ${sets} planned sets${closed?' · Completed session protected':''}`);
      if(!exercises.length)lines.push('  No scheduled exercises.');
      for(const {ex,index,muscle,indirect} of exercises){
        const rec=dayRecord(log,ex,index),id=EH.identity(ex);
        lines.push(`${index+1}. ${clean(EH.label(id))} — ${ex.sets} sets × ${clean(ex.reps)} reps`,
          `   Primary: ${muscle}. Assisting: ${indirect===null?'Unmapped':indirect.join(', ')||'None mapped'}.`,
          `   Source: ${ex.logKey?'Recurring addition':ex.programOverride?'Personal program edit':'Scheduled'}. ${hasSessionData(rec)||closed?'Saved prescription protected. ':''}${ex.weekMode==='light'?'Lighter prescription.':''}`);
        if(ex.logKey||ex.programOverride)lines.push(`   Effort: ${ex.weekMode==='light'?'3–4 reps in reserve':'Self-selected; no prescribed failure target'}.`);
        else lines.push(`   Effort: early RPE ${clean(ex.erpe)||'unspecified'}; last-set RPE ${clean(ex.lrpe)||'unspecified'}.`);
        lines.push(`   Rest: ${clean(ex.rest)||'unspecified'}. Warm-up sets: ${clean(ex.wu)||'unspecified'}.`);
        if(!ex.logKey&&!ex.programOverride&&ex.tech&&ex.tech!=='N/A')lines.push(`   Technique: ${clean(ex.tech)}.`);
        if(ex.notes)lines.push(`   Coaching notes: ${clean(ex.notes)}`);
        if(rec)for(const entry of EH.entries(ex,rec))if(EH.key(entry.id)!==EH.key(id))lines.push(`   Session substitution/setup: ${clean(EH.label(entry.id))} (excluded from planned muscle totals).`);
      }
    }
    lines.push('','');
  }
  if(plan.library?.length){lines.push('PERSONAL EXERCISE LIBRARY — reference only, not additional scheduled sets');for(const ex of plan.library)lines.push(`- ${clean(EH.label(ex))} · Primary: ${clean(ex.targetMuscle)}`);}
  return lines.join('\n');
}
async function showProgramExport(){
  try{
    await flushDayWrites();await gatherAll(true);
    const plan=await refreshCustomProgram(),cycle=(await loadBaseline()).cycles||0;
    const report=programReviewText(DATA,plan,cycle,dayCache,{...finCache,...finWkCache});
    sheet.innerHTML='<div class="grab"></div><h2>Export full program</h2><p>All 12 weeks, edits, recurring work, effort targets, coaching notes and muscle-set totals. Download this text file to send to a coach or upload to ChatGPT. Logged weights, PRs and check-in details are excluded.</p>';
    const preview=el('textarea','bigta');preview.readOnly=true;preview.rows=10;preview.value=report;preview.setAttribute('aria-label','Full program export preview');preview.style.cssText='width:100%;box-sizing:border-box;font-size:16px;white-space:pre-wrap;overflow-wrap:anywhere';sheet.appendChild(preview);
    const status=el('p','book-note');status.setAttribute('role','status');
    const save=el('button','databtn','Download program (.txt)');save.onclick=()=>{const ok=download('landi-lifts-program-cycle-'+(cycle+1)+'.txt',report,'text/plain;charset=utf-8');status.textContent=ok?'Program file download requested.':'Download unavailable. Copy the program text instead.';};sheet.appendChild(save);
    const copy=el('button','databtn','Copy program text');copy.onclick=async()=>{try{await navigator.clipboard.writeText(report);status.textContent='Program copied. Paste it into your review conversation.';}catch(_){status.textContent='Copy was unavailable. Use Download program instead.';}};sheet.appendChild(copy);sheet.appendChild(status);
    const close=el('button','databtn','Close');close.onclick=()=>scrim.classList.remove('show');sheet.appendChild(close);scrim.classList.add('show');
  }catch(e){alert('Could not prepare the program export: '+e.message);}
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
  let current=restore?{...originalList[index],slotKey:index}:DATA.weeks[state.wk-1].days[day][index];
  if(!current)return;
  if(current.normalPrescription)current={...current.normalPrescription};
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
  if(e.target.closest('[data-program-export]')){showProgramExport();return;}
  const muscle=e.target.closest('[data-muscle]');if(muscle){programFilter=programFilter===muscle.dataset.muscle?null:muscle.dataset.muscle;renderProgramOverview();return;}
  if(e.target.closest('[data-clear-filter]')){programFilter=null;renderProgramOverview();return;}
  if(e.target.closest('[data-program-add]')){state.day='mon';showCustomProgram();return;}
  const edit=e.target.closest('[data-program-index]');if(edit){showProgramEditor(edit.dataset.programDay,Number(edit.dataset.programIndex));return;}
  const restore=e.target.closest('[data-program-restore]');if(restore)showProgramEditor(restore.dataset.programDay,Number(restore.dataset.programRestore),true);
});

function validateWeekModes(modes){
  if(modes===undefined)return;
  if(!modes||typeof modes!=='object'||Array.isArray(modes)||Object.entries(modes).some(([key,value])=>!/^\d+:(?:[1-9]|1[0-2])$/.test(key)||!['normal','light'].includes(value)))throw Error('Invalid saved week intensity.');
}
function applyWeekModes(program,base,plan,cycle,logs,finished){
  return {...program,weeks:program.weeks.map(w=>{
    const mode=plan.weekModes?.[cycle+':'+w.n];
    return {...w,intensityMode:mode||null,deload:mode?mode==='light':w.deload,days:Object.fromEntries(Object.entries(w.days).map(([day,exs])=>[day,exs.map((ex,i)=>{
      const rec=dayRecord(logs[keyFor(w.n,day)]||{},ex,i),closed=finished['bts:fin:w'+w.n+':'+day]||finished['bts:finwk:w'+w.n];
      if(hasSessionData(rec)||closed)return rec?.planned?.weekMode?{...rec.planned}:ex;
      if(!mode)return ex;
      // Keep personal prescriptions; borrow regular effort cues for scheduled intro weeks.
      let normal={...ex};
      if(base.weeks[w.n-1].deload&&!ex.logKey&&!ex.programOverride){
        const regular=base.weeks.find(next=>next.n>w.n&&!next.deload)?.days[day]?.find(row=>row.ex===ex.ex);
        if(regular)normal={...normal,erpe:regular.erpe,lrpe:regular.lrpe,tech:regular.tech};
      }
      return mode==='normal'?{...normal,weekMode:mode,customIdentity:normal.customIdentity||EH.identity(normal)}:
        {...normal,sets:Math.max(1,Math.ceil(normal.sets/2)),erpe:'6–7',lrpe:'6–7',tech:'N/A',weekMode:mode,normalPrescription:normal,customIdentity:normal.customIdentity||EH.identity(normal)};
    })]))};
  })};
}
async function saveWeekMode(wk,mode){
  if(!['scheduled','normal','light'].includes(mode))throw Error('Choose a week intensity.');
  await flushDayWrites();const plan=await loadCustomProgram(),cycle=(await loadBaseline()).cycles||0;
  plan.weekModes=plan.weekModes||{};const key=cycle+':'+wk;
  if(mode==='scheduled')delete plan.weekModes[key];else plan.weekModes[key]=mode;
  validateCustomProgram(plan);await window.storage.set(CUSTOM_PROGRAM_KEY,JSON.stringify(plan),false);
  scheduleCloudPush();await renderAll();
}
document.getElementById('programView').addEventListener('change',async e=>{
  if(e.target.id!=='weekIntensity')return;
  const select=e.target,wk=state.wk;select.disabled=true;
  try{await saveWeekMode(wk,select.value);}catch(error){select.value=DATA.weeks[wk-1].intensityMode||'scheduled';document.getElementById('weekIntensityError').textContent=error.message||'Could not save week intensity.';}finally{select.disabled=false;}
});
