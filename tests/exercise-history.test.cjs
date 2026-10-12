const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function app(){
  const noop=()=>{};
  const element=()=>({children:[],listeners:{},style:{},classList:{add:noop,remove:noop,toggle:noop,contains:()=>false},addEventListener(type,fn){this.listeners[type]=fn;},querySelector:()=>element(),querySelectorAll:()=>[],append(...nodes){this.children.push(...nodes);},appendChild(node){this.children.push(node);},setAttribute:noop,remove:noop,focus:noop});
  const store=new Map();
  const localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k),key:i=>[...store.keys()][i],get length(){return store.size}};
  const c=vm.createContext({console,localStorage,document:{getElementById:()=>element(),querySelector:()=>element(),querySelectorAll:()=>[],createElement:element,addEventListener:noop},navigator:{},setTimeout:()=>1,clearTimeout:noop,setInterval:()=>1,clearInterval:noop,alert:noop,confirm:()=>true,fetch:async()=>({ok:true}),URL,Blob});
  c.window=c; c.addEventListener=noop;
  for(const f of ['data.js','exercise-history.js','program-overview.js','app.js']) vm.runInContext(fs.readFileSync('public/'+f,'utf8').split('/* ---------- boot ---------- */')[0],c,{filename:f});
  return {run:code=>vm.runInContext(code.includes("await") && !code.startsWith("(async") ? "(async()=> ("+code+"))()" : code,c),store,c};
}
const setup=`const planned=DATA.weeks[0].days.mon[0]; const original=EH.identity(planned); const leg=EH.identity({ex:'Leg Press'}); const db=EH.identity({ex:'DB Walking Lunge'});`;
const customSetup=`const added={from:10,active:true,days:['mon','wed','fri'],exercise:{name:'DB Lateral Raise',equipment:'dumbbell',label:'',group:'Shoulders'},sets:3,reps:'10-15'}; const customPlan={version:1,rules:[{id:'side-delts',versions:[added]}]};`;
const editSetup=`const source=pickProgram(null).weeks[0].days.mon[0]; const editVersion={from:10,active:true,exercise:{name:'DB Lateral Raise',equipment:'dumbbell',label:''},sets:4,reps:'12-15',muscle:'Side delts'};`;
test('indirect sets separate pressing assistance from direct triceps work without inflating total sets',()=>{
 const {run}=app();
 assert.equal(run(`(()=>{const s=plannedWeekStats({days:{mon:[{ex:'Barbell Bench Press',sets:4},{ex:'Cable Triceps Pressdown',sets:3},{ex:'Machine Shoulder Press',sets:2}],wed:[],fri:[]}});return s.groups.Triceps===3&&s.indirect.Triceps===6&&s.groups['Front delts']===2&&s.indirect['Front delts']===4&&s.total===9&&s.unmapped===0;})()`),true);
});
test('indirect mapping deduplicates core targets, excludes direct targets and flags unknown movements',()=>{
 const {run}=app();
 assert.equal(run(`(()=>{const s=plannedWeekStats({days:{mon:[{ex:'High-Cable Lateral Raise',sets:3},{ex:'Cable Crunch',sets:3},{ex:'Custom press',sets:4,targetMuscle:'Chest'},{ex:'Barbell Bench Press',sets:2,targetMuscle:'Triceps'}],wed:[],fri:[]}});return s.indirect.Core===0&&s.indirect['Front delts']===2&&s.indirect.Triceps===0&&s.groups.Triceps===2&&s.unmapped===1&&s.total===12;})()`),true);
});
test('completed program snapshots retain removals and unlogged replacements without logging sets',async()=>{
 const {run,store}=app();run(editSetup);run('renderAll=async()=>{}');
 await run(`saveScheduledEdit('mon',source.ex,{...editVersion,sets:0})`);await run('refreshCustomProgram()');
 await run(`snapshotProgramDay(1,'mon');flushDayWrites()`);
 assert.equal(JSON.parse(store.get('bts:log:w1:mon'))[0].plannedRemoved,true);
 await run(`window.storage.set('bts:fin:w1:mon',JSON.stringify({at:'saved'}));saveScheduledEdit('mon',source.ex,{...editVersion,active:false})`);
 run('dayCache={};finCache={}');await run('refreshCustomProgram()');
 assert.equal(run('DATA.weeks[0].days.mon[0].slotKey'),1);
 await run(`saveScheduledEdit('mon',source.ex,{...editVersion,from:20})`);await run('refreshCustomProgram()');
 await run(`snapshotProgramDay(2,'mon');flushDayWrites()`);
 const saved=JSON.parse(store.get('bts:log:w2:mon'))[0];assert.equal(saved.planned.ex,'DB Lateral Raise');assert.equal(saved.sets.length,0);
 await run(`window.storage.set('bts:finwk:w2',JSON.stringify({at:'saved'}));saveScheduledEdit('mon',source.ex,{...editVersion,from:20,active:false})`);
 run('dayCache={};finWkCache={}');await run('refreshCustomProgram()');
 assert.equal(run('DATA.weeks[1].days.mon[0].ex'),'DB Lateral Raise');
});
test('planned overview counts prescriptions once, including side delts, independent of logs',()=>{
 const {run}=app();
 assert.equal(run(`(()=>{const w={days:{mon:[{ex:'High-Cable Lateral Raise',sets:3},{ex:'Barbell Bench Press',sets:4}],wed:[{ex:'Custom raise',sets:2,targetMuscle:'Side delts'}],fri:[]}};const s=plannedWeekStats(w);return s.total===9&&s.groups['Side delts']===5&&s.groups.Chest===4&&s.groups.Triceps===0&&s.workouts===2;})()`),true);
});
test('scheduled edits preserve numeric slots after removing a movement and respect weekday and start week',()=>{
 const {run}=app();run(editSetup);
 assert.equal(run(`(()=>{const base=pickProgram(null),before=JSON.stringify(base),plan={version:1,rules:[],edits:[{day:'mon',source:source.ex,versions:[{...editVersion,from:30,sets:0}]}]};const p=customizedProgram(base,plan,0);return p.weeks[0].days.mon.length===base.weeks[0].days.mon.length&&p.weeks[2].days.mon[0].slotKey===1&&p.weeks[2].days.wed.length===base.weeks[2].days.wed.length&&JSON.stringify(base)===before;})()`),true);
 run(`DATA=customizedProgram(pickProgram(null),{version:1,rules:[],edits:[{day:'mon',source:source.ex,versions:[{...editVersion,sets:0}]}]},0);setField(0,curWeek().days.mon[0],0,'w','50');`);
 assert.equal(run(`dayCache[keyFor(1,'mon')][1].sets[0].w`),'50');
 assert.equal(run(`dayCache[keyFor(1,'mon')][0]===undefined`),true);
});
test('replacement logs retain their identity and prescription after restoring the original plan',async()=>{
 const {run}=app();run(editSetup);run(`renderAll=async()=>{};`);
 await run(`saveScheduledEdit('mon',source.ex,editVersion)`);await run('refreshCustomProgram()');
 run(`setField(0,curWeek().days.mon[0],0,'w','20');setField(0,curWeek().days.mon[0],0,'r','12');`);await run('flushDayWrites()');
 await run(`saveScheduledEdit('mon',source.ex,{...editVersion,active:false})`);run('dayCache={}');await run('refreshCustomProgram()');
 assert.equal(run(`curWeek().days.mon[0].ex`),'DB Lateral Raise');
 assert.equal(run(`curWeek().days.mon[0].sets`),4);
 assert.equal(run(`DATA.weeks[1].days.mon[0].ex`),run('source.ex'));
 assert.equal(await run(`(await historyEntries())[0].id.name`),'DB Lateral Raise');
});
test('legacy saved and completed sessions remain unchanged while future prescriptions update',()=>{
 const {run}=app();run(editSetup);
 assert.equal(run(`(()=>{const base=pickProgram(null),plan={version:1,rules:[],edits:[{day:'mon',source:source.ex,versions:[editVersion]}]};const p=customizedProgram(base,plan,0,{'bts:log:w1:mon':{0:{sets:[{w:'100',r:'8'}]}}},{'bts:fin:w2:mon':{at:'saved'}});return p.weeks[0].days.mon[0].ex===source.ex&&p.weeks[1].days.mon[0].ex===source.ex&&p.weeks[2].days.mon[0].ex==='DB Lateral Raise';})()`),true);
});
test('reset clears unused replacement metadata without changing actual logs',async()=>{
 const {run}=app();run(editSetup);run(`renderAll=async()=>{};`);
 await run(`saveScheduledEdit('mon',source.ex,editVersion)`);await run('refreshCustomProgram()');run('liveRec(0)');
 await run(`saveScheduledEdit('mon',source.ex,{...editVersion,active:false})`);await run('refreshCustomProgram()');
 assert.equal(run(`EH.identity(curWeek().days.mon[0],liveRec(0)).name`),run('source.ex'));
 assert.equal(run(`liveRec(0).sets.length`),0);
});
test('program edits survive cycle rollover, reject invalid saves and are included in backups',async()=>{
 const {run,store}=app();run(editSetup);run(`renderAll=async()=>{};`);
 await run(`saveScheduledEdit('mon',source.ex,editVersion)`);await run('refreshCustomProgram()');
 const before=store.get('bts:custom:program:v1');
 await assert.rejects(run(`saveScheduledEdit('mon',source.ex,{...editVersion,sets:-1})`));assert.equal(store.get('bts:custom:program:v1'),before);
 run(`setField(0,curWeek().days.mon[0],0,'w','20');setField(0,curWeek().days.mon[0],0,'r','12');`);
 assert.ok(JSON.parse(await run(`JSON.stringify(await gatherAll())`))['bts:custom:program:v1'].edits.length);
 await run('startNewProgram(false)');await run('refreshCustomProgram()');
 assert.equal(run(`curWeek().days.mon[0].ex`),'DB Lateral Raise');
 assert.ok(JSON.parse(store.get('bts:arch:c1:bts:custom:program:v1')).edits.length);
 assert.equal(await run(`(await previousSets(editVersion.exercise,1,'mon'))[0].w`),'20');
});
test('recurring additions start at the chosen session, skip duplicate lifts and leave the shipped plan intact',()=>{
 const {run}=app();run(customSetup);
 assert.equal(run(`(()=>{const base=pickProgram(null),before=JSON.stringify(base);const p=customizedProgram(base,{version:1,rules:[{id:'side-delts',versions:[{...added,from:programRank(0,3,'wed'),days:['mon','wed']}]}]},0);return p.weeks[2].days.mon.length===base.weeks[2].days.mon.length&&p.weeks[2].days.wed.at(-1).logKey==='extra:side-delts'&&p.weeks[2].days.fri.length===base.weeks[2].days.fri.length&&p.weeks[3].days.mon.at(-1).ex==='DB Lateral Raise'&&JSON.stringify(base)===before;})()`),true);
 assert.equal(run(`(()=>{const base=pickProgram(null),ex=base.weeks[0].days.mon[0];const p=customizedProgram(base,{version:1,rules:[{id:'duplicate',versions:[{...added,exercise:EH.identity(ex)}]}]},0);return p.weeks[0].days.mon.length===base.weeks[0].days.mon.length;})()`),true);
});
test('recurring sets use stable keys, share history across days and survive removal and swaps',async()=>{
 const {run,store}=app();run(customSetup);
 await run(`window.storage.set(CUSTOM_PROGRAM_KEY,JSON.stringify(customPlan),false)`);await run('refreshCustomProgram()');
 run(`const index=curWeek().days.mon.findIndex(ex=>ex.logKey==='extra:side-delts');const extra=curWeek().days.mon[index];setField(index,extra,0,'w','20');setField(index,extra,0,'r','12');`);
 await run('flushDayWrites()');
 assert.equal(JSON.parse(store.get('bts:log:w1:mon'))['extra:side-delts'].sets[0].w,'20');
 assert.equal(await run(`(await previousSets(added.exercise,1,'wed'))[0].r`),'12');
 run(`dayCache[keyFor(1,'mon')]['extra:side-delts']=EH.select(extra,liveRec(index),{...added.exercise,equipment:'machine'});setField(index,extra,0,'w','40');setField(index,extra,0,'r','10');queueSave(1,'mon');`);
 await run('flushDayWrites()');
 run(`customPlan.rules[0].versions.push({...added,from:10,active:false});`);
 await run(`window.storage.set(CUSTOM_PROGRAM_KEY,JSON.stringify(customPlan),false)`);await run('refreshCustomProgram()');
 assert.equal(run(`curWeek().days.mon.at(-1).logKey`),'extra:side-delts');
 assert.equal(run(`curWeek().days.wed.some(ex=>ex.logKey)`),false);
 assert.equal(await run(`(await historyEntries()).filter(e=>e.ex.plannedName==='DB Lateral Raise').length`),2);
 run('dayCache={}');await run('refreshCustomProgram()');
 assert.equal(await run(`(await historyEntries()).find(e=>e.id.equipment==='machine'&&e.id.name==='DB Lateral Raise').rec.sets[0].w`),'40');
 assert.equal(run(`sessionEntries([],dayCache[keyFor(1,'mon')]).length`),2);
});
test('removing an earlier extra cannot move a later extra onto another log',()=>{
 const {run}=app();run(customSetup);
 assert.equal(run(`(()=>{const later={...added,exercise:{...added.exercise,name:'DB Curl'}};const plan={version:1,rules:[{id:'first',versions:[{...added,active:false}]},{id:'second',versions:[later]}]};const base=pickProgram(null);const logs={'bts:log:w1:mon':{'extra:second':{sets:[{w:'30',r:'8'}],planned:{ex:'DB Curl',sets:3,reps:'8-12',logKey:'extra:second'},exercise:later.exercise}}};const p=customizedProgram(base,plan,0,logs),ex=p.weeks[0].days.mon.at(-1);return ex.logKey==='extra:second'&&dayRecord(logs['bts:log:w1:mon'],ex,9).sets[0].w==='30';})()`),true);
});
test('edits preserve logged prescriptions and do not add exercises to completed workouts',()=>{
 const {run}=app();run(customSetup);
 assert.equal(run(`(()=>{const base=pickProgram(null),original={ex:'DB Lateral Raise',sets:4,reps:'8-12',logKey:'extra:side-delts',customIdentity:added.exercise};const logs={'bts:log:w1:mon':{'extra:side-delts':{planned:original,sets:[{w:'20',r:'8'}]}}};const p=customizedProgram(base,customPlan,0,logs,{'bts:fin:w1:wed':{at:'saved'}});return p.weeks[0].days.mon.at(-1).sets===4&&p.weeks[0].days.wed.length===base.weeks[0].days.wed.length&&p.weeks[0].days.fri.at(-1).sets===3;})()`),true);
});
test('recurring plan and records survive backup and cycle rollover',async()=>{
 const {run,store}=app();run(customSetup);
 await run(`window.storage.set(CUSTOM_PROGRAM_KEY,JSON.stringify(customPlan),false)`);await run('refreshCustomProgram()');
 run(`const i=curWeek().days.mon.length-1;setField(i,curWeek().days.mon[i],0,'w','20');setField(i,curWeek().days.mon[i],0,'r','12');renderAll=async()=>{};`);
 const backup=await run(`JSON.stringify(await gatherAll())`);assert.ok(JSON.parse(backup)['bts:custom:program:v1']);
 await run('startNewProgram(false)');await run('refreshCustomProgram()');
 assert.ok(store.has('bts:arch:c1:bts:custom:program:v1'));
 assert.ok(store.has('bts:arch:c1:bts:log:w1:mon'));
 assert.equal(run(`curWeek().days.mon.at(-1).logKey`),'extra:side-delts');
 assert.equal(await run(`(await previousSets(added.exercise,1,'mon'))[0].w`),'20');
});
test('invalid or failed plan saves keep the existing plan, and profile clear removes customization',async()=>{
 const {run,store}=app();run(customSetup);
 await run(`window.storage.set(CUSTOM_PROGRAM_KEY,JSON.stringify(customPlan),false)`);
 const before=store.get('bts:custom:program:v1');
 await assert.rejects(run(`saveCustomRule('side-delts',{...added,days:[]})`));
 assert.equal(store.get('bts:custom:program:v1'),before);
 run(`window.storage.set=async()=>{throw Error('disk full');};`);
 await assert.rejects(run(`saveCustomRule('side-delts',{...added,sets:4})`),/disk full/);
 assert.equal(store.get('bts:custom:program:v1'),before);
 await run('clearLocal()');await run('refreshCustomProgram()');
 assert.equal(run(`curWeek().days.mon.some(ex=>ex.logKey)`),false);
});
test('rep picker leaves suggestions unlogged and saves an explicit choice only to its set',async()=>{
 const {run,store}=app();run(setup);
 run(`const repControl=makeRepsStepper(0,planned,0,'8');const repSelect=repControl.children[0];`);
 assert.equal(run(`liveRec(0).sets.length`),0);assert.equal(store.size,0);
 run(`repSelect.value='12';repSelect.listeners.change();`);
 await run('flushDayWrites()');
 assert.deepEqual(JSON.parse(store.get('bts:log:w1:mon'))[0].sets,[{r:'12'}]);
 run(`repSelect.value='custom';repSelect.listeners.change();repControl.children[1].children[2].onclick();`);
 assert.equal(run('liveRec(0).sets[0].r'),'12');
});
test('record book compares same-rep milestones, ignores gaps and repeated or lower sets',async()=>{
 const {run,store}=app();run(setup);
 run(`dayCache[keyFor(1,'mon')]={0:{sets:[{w:'186',r:'8'},{w:'176',r:'8'},{w:'140',r:'12'}]}};
 dayCache[keyFor(3,'mon')]={0:{sets:[{w:'196',r:'8'},{w:'196',r:'8'},{w:'150',r:'12'}]}};
 dayCache[keyFor(6,'mon')]={0:{sets:[{w:'190',r:'8'},{w:'206',r:''},{w:'Infinity',r:'8'}]}};`);
 await run('historyEntries()'); // Fill read caches before checking the pure projection.
 const before=run('JSON.stringify(dayCache)');
 assert.equal(await run(`(async()=>{const l=buildRecordBook(await historyEntries())[0];return JSON.stringify({best:l.best.w,eight:l.tracks['8'].map(p=>[p.wk,p.w,p.gain]),twelve:l.tracks['12'].map(p=>p.w)});})()`),JSON.stringify({best:196,eight:[[1,186,0],[3,196,10]],twelve:[140,150]}));
 assert.equal(run('JSON.stringify(dayCache)'),before);assert.equal(store.size,0);
});
test('record book keeps swapped and named equipment separate without recalculating totals',async()=>{
 const {run}=app();run(setup);
 run(`dayCache[keyFor(1,'mon')]={0:EH.select(planned,{sets:[{w:'100',r:'8'}]},{...original,label:'A',baseWeight:116})};
 dayCache[keyFor(1,'mon')][0].sets=[{w:'206',r:'8'}];
 dayCache[keyFor(2,'mon')]={0:{exercise:{...original,label:'B',baseWeight:200},sets:[{w:'50',r:'8'}]}};`);
 assert.equal(await run(`(async()=>{const ls=buildRecordBook(await historyEntries());return ls.length===3&&ls.find(l=>l.id.label==='A').best.w===206&&ls.find(l=>l.id.label==='B').best.w===50&&ls.find(l=>l.id.label==='').best.w===100;})()`),true);
});
test('record book supports bodyweight reps and per-dumbbell units, but not missing weights',async()=>{
 const {run}=app();run(setup);
 run(`const body=EH.identity({ex:'Wide-Grip Pull-Up'});dayCache[keyFor(1,'mon')]={0:{exercise:body,sets:[{w:'0',r:'8'},{r:'20'}]}};
 dayCache[keyFor(2,'mon')]={0:{exercise:body,sets:[{w:'0',r:'10'},{w:'-10',r:'12'}]}};`);
 assert.equal(await run(`(async()=>{const l=buildRecordBook(await historyEntries())[0];return l.tracks.bodyweight.length===2&&l.best.r===10&&l.tracks.bodyweight[1].gain===2;})()`),true);
 assert.equal(run(`bookSet({w:40,r:8},db)`),'40 lb each × 8');
 assert.equal(run(`bookSet({w:0,r:10},body)`),'10 reps · bodyweight');
});
test('record book keeps carried estimates separate from actual-set benchmarks after rollover',async()=>{
 const {run,store}=app();run(setup);
 run(`dayCache[keyFor(1,'mon')]={0:{sets:[{w:'206',r:'8'}]}};renderAll=async()=>{};queueSave(1,'mon');`);
 await run('startNewProgram(false)');
 const before=JSON.stringify([...store]);
 assert.equal(await run(`(async()=>{const ls=buildRecordBook(await historyEntries(),await loadBaseline());return ls.length===1&&ls[0].best===null&&ls[0].milestones.length===0&&ls[0].prior[0].w===206&&ls[0].carried>206;})()`),true);
 assert.equal(JSON.stringify([...store]),before);
});
test('record book handles empty and partial-only logs without inventing a benchmark',async()=>{
 const {run}=app();run(setup);
 assert.equal(await run(`buildRecordBook(await historyEntries()).length`),0);
 run(`dayCache[keyFor(1,'mon')]={0:{sets:[{w:'200'},{r:'8'}]}};`);
 assert.equal(await run(`(async()=>{const l=buildRecordBook(await historyEntries())[0];return l.best===null&&l.milestones.length===0;})()`),true);
});
test('legacy reads are nonmutating, equipment overrides remain separate',()=>{
 const {run}=app();run(setup);
 assert.equal(run(`(()=>{const rec={done:true,resType:'plates',sets:[{w:'100',r:'8'}],note:'keep'};const before=JSON.stringify(rec);const e=EH.entries(planned,rec)[0];return e.id.equipment==='plates'&&JSON.stringify(rec)===before&&e.ex.historyKey!==EH.key(original);})()`),true);
});
test('swaps preserve incomplete, completed and unknown fields, and restore without duplicates',()=>{
 const {run}=app();run(setup);
 assert.equal(run(`(()=>{const rec={done:true,sets:[{w:'100',r:'8',done:true},{w:'80'}],note:'keep'};let r=EH.select(planned,rec,leg);if(r.sets.length||r.done)return false;r.sets=[{w:'208',r:'10'}];r=EH.select(planned,r,db);r.sets=[{w:'30',r:'12'}];r=EH.select(planned,r,original);for(let i=0;i<5;i++){r=EH.select(planned,r,leg);r=EH.select(planned,r,original);}return r.note==='keep'&&r.done&&r.sets[1].w==='80'&&r.variants.length===2&&EH.entries(planned,r).length===3;})()`),true);
});
test('machine labels isolate history; case and whitespace normalize labels',()=>{
 const {run}=app();run(setup);
 assert.equal(run(`EH.key(EH.identity(planned,{exercise:{...original,label:' Upstairs   Cable '}}))===EH.key({...original,label:'upstairs cable'})`),true);
 assert.equal(run(`EH.key({...original,label:'Machine A'})!==EH.key({...original,label:'Machine B'})`),true);
});
test('sparse PR history survives saving, reload, backup, progression, stats and cycle summary',async()=>{
 const {run,store}=app();run(setup);
 await run(`(async()=>{dayCache[keyFor(1,'mon')]={0:{sets:[{w:'100',r:'8'}],done:true}};state={wk:1,day:'mon'};dayCache[keyFor(1,'mon')][0]=EH.select(planned,liveRec(0),leg);setField(0,planned,0,'w','208');setField(0,planned,0,'r','10');await flushDayWrites();})()`);
 const saved=JSON.parse(store.get('bts:log:w1:mon'));
 assert.equal(saved[0].sets.length,1);assert.equal(saved[0].variants[0].sets[0].w,'100');
 run('dayCache={}');
 assert.equal(await run(`(async()=>{const all=await gatherAll();return JSON.stringify(all['bts:log:w1:mon'])===JSON.stringify(await loadDay(1,'mon'));})()`),true);
 assert.equal(await run(`(await daySummary(1,'mon')).vol`),2880);
 assert.equal(await run(`(await progStats()).setsThis`),2);
 assert.equal(await run(`(await overviewData()).byDay.mon.length`),2);
 assert.equal(await run(`(async()=>{progState.sel={type:'ex',key:EH.key(leg)};return (await exPoints())[0].sets[0].w;})()`),208);
 assert.equal(await run(`(async()=>{progState.sel={type:'ex',key:EH.key(original)};return (await exPoints())[0].sets[0].w;})()`),100);
 assert.equal(await run(`(await previousSets(leg,2,'fri'))[0].w`),'208');
 assert.equal(await run(`(await previousSets(db,2,'fri')).length`),0);
 assert.equal(await run(`summariseLogs(await gatherAll(),DATA).volume`),2880);
 assert.equal(await run(`Object.keys(summariseLogs(await gatherAll(),DATA).exBest).length`),2);
 assert.equal(run(`DATA.weeks[1].days.mon[0].ex`),'Hack Squat');
});
test('legacy baseline mapped in memory, explicit equipment identity is respected',async()=>{
 const {run,store}=app();run(setup);
 const old=JSON.stringify({exBest:{'Hack Squat':150},lastSets:{'Hack Squat':[{w:'120',r:'8'}]}});store.set('bts:base:summary',old);
 assert.equal(await run(`(await loadBaseline()).exBest[EH.key(original)]`),150);
 assert.equal(await run(`(await previousSets(original,1,'mon'))[0].w`),'120');
 assert.equal(await run(`(await previousSets({...original,equipment:'plates'},1,'mon')).length`),0);
 assert.equal(store.get('bts:base:summary'),old);
});
test('cycle rollover archives raw variants, carries separate bests, resets only current cycle',async()=>{
 const {run,store}=app();run(setup);
 run(`dayCache[keyFor(1,'mon')]={0:EH.select(planned,{done:true,sets:[{w:'100',r:'8'}]},leg)};liveRec(0).sets=[{w:'200',r:'8'}];renderAll=async()=>{};queueSave(1,'mon');`);
 await run('startNewProgram(false)');
 const archive=JSON.parse(store.get('bts:arch:c1:bts:log:w1:mon'));
 assert.equal(archive[0].variants[0].sets[0].w,'100');
 assert.equal(store.has('bts:log:w1:mon'),false);
 assert.equal(Object.keys(JSON.parse(store.get('bts:base:summary')).exBest).length,2);
 assert.equal(await run(`(await previousSets(leg,1,'mon'))[0].w`),'200');
});
test('archive write failure cannot delete existing logs',async()=>{
 const {run,store}=app();run(setup);
 await run(`(async()=>{dayCache[keyFor(1,'mon')]={0:{sets:[{w:'100',r:'8'}]}};queueSave(1,'mon');await flushDayWrites();const write=window.storage.set;window.storage.set=async(k,v)=>{if(k.startsWith('bts:arch:'))throw Error('full');return write(k,v);};})()`);
 await assert.rejects(run('startNewProgram(false)'),/full/);
 assert.equal(store.has('bts:log:w1:mon'),true);
});
test('pending writes use captured payload and finish before gathering',async()=>{
 const {run,store}=app();run(setup);
 await run(`(async()=>{dayCache[keyFor(1,'mon')]={0:{sets:[{w:'100'}]}};queueSave(1,'mon');dayCache={};await gatherAll();})()`);
 assert.equal(JSON.parse(store.get('bts:log:w1:mon'))[0].sets[0].w,'100');
});

test('PR thresholds are isolated by equipment and named machines',async()=>{
 const {run}=app();run(setup);
 await run(`(async()=>{dayCache[keyFor(1,'mon')]={0:{sets:[{w:'400',r:'8'}]}};await computePRBase();dayCache[keyFor(2,'mon')]={0:EH.select(planned,{sets:[]},{...original,label:'upstairs'})};state={wk:2,day:'mon'};setField(0,planned,0,'w','30');setField(0,planned,0,'r','8');await flushDayWrites();})()`);
 assert.equal(run('PR_BASE[EH.key(original)]'),507);
 assert.equal(run("PR_BASE[EH.key({...original,label:'upstairs'})]"),38);
 assert.equal(run("prFiredSession.has(EH.key({...original,label:'upstairs'}))"),true);
});
test('legacy program migration attributes old slot names, without changing raw archive',async()=>{
 const {run,store}=app();
 run(`renderAll=async()=>{};dayCache[keyFor(1,'mon')]={0:{sets:[{w:'123',r:'5'}],note:'legacy'}};queueSave(1,'mon');`);
 await run('startNewProgram(true)');
 assert.equal(JSON.parse(store.get('bts:arch:c1:bts:log:w1:mon'))[0].note,'legacy');
 assert.equal(await run(`(await loadBaseline()).exBest[EH.key(EH.identity(window.PROGRAM_LEGACY.weeks[0].days.mon[0]))]>0`),true);
});
test('backup JSON round-trip and CSV export retain active and switched-away exercises',async()=>{
 const {run}=app();run(setup);
 await run(`(async()=>{dayCache[keyFor(1,'mon')]={0:EH.select(planned,{sets:[{w:'100',r:'8'}]},leg)};liveRec(0).sets=[{w:'200',r:'8'}];queueSave(1,'mon');const backup=JSON.parse(JSON.stringify(await gatherAll()));dayCache={};for(const k in backup)await window.storage.set(k,JSON.stringify(backup[k]));download=(name,text)=>{window.csv=text;return true;};await exportCSV();})()`);
 assert.match(run('window.csv'),/Hack Squat,machine,,1,100,8/);
 assert.match(run('window.csv'),/Leg Press,legpress,,1,200,8/);
});
test('failed local writes retain edits and can be retried',async()=>{
 const {run,c,store}=app();run(setup);
 c.console={error:()=>{}};
 await run(`(async()=>{window.realSet=window.storage.set;window.storage.set=async()=>{throw Error('full');};dayCache[keyFor(1,'mon')]={0:{sets:[{w:'55',r:'5'}]}};queueSave(1,'mon');try{await flushDayWrites();}catch(_){};window.storage.set=window.realSet;await flushDayWrites();})()`);
 assert.equal(JSON.parse(store.get('bts:log:w1:mon'))[0].sets[0].w,'55');
});
test('offline profile switch keeps the active profile and all local records',async()=>{
 const {run,c,store}=app();run(setup);c.fetch=async()=>{throw Error('offline')};
 await run(`(async()=>{LL_USER='luke';dayCache[keyFor(1,'mon')]={0:{sets:[{w:'55',r:'5'}]}};queueSave(1,'mon');await switchUser();})()`);
 assert.equal(run('LL_USER'),'luke'); assert.equal(store.has('bts:log:w1:mon'),true);
});
test('successful profile switch flushes variants before clearing caches and cannot carry them to another user',async()=>{
 const {run,c,store}=app();run(setup);let sent;
 c.fetch=async(url,options)=>{sent=JSON.parse(options.body);return {ok:true}};
 await run(`(async()=>{LL_USER='luke';dayCache[keyFor(1,'mon')]={0:EH.select(planned,{sets:[{w:'100',r:'8'}]},leg)};queueSave(1,'mon');await switchUser();})()`);
 assert.equal(sent.user,'luke');assert.equal(JSON.parse(sent.data)['bts:log:w1:mon'][0].variants[0].sets[0].w,'100');
 assert.equal(run('LL_USER'),null);assert.equal(store.has('bts:log:w1:mon'),false);
 assert.equal(run('Object.keys(dayCache).length'),0);
});
test('unreadable stored logs abort rollover before deletion',async()=>{
 const {run,store}=app();store.set('bts:log:w1:mon','{invalid');
 await assert.rejects(run('startNewProgram(false)'));
 assert.equal(store.get('bts:log:w1:mon'),'{invalid');
 assert.equal(store.has('bts:base:summary'),false);
});
test('116 lb hack squat sled plus one 45 per side logs 206 total through the weight control',async()=>{
 const {run}=app();run(setup);
 assert.equal(run(`(()=>{liveRec(0).exercise={...original,baseWeight:116,perSide:true};const control=makeWeightStepper(0,planned,0,'machine',null,null);control.children[2].children.find(b=>b.innerHTML==='+45').onclick();return liveRec(0).sets[0].w;})()`),'206');
 await run('flushDayWrites()');
});
test('single stack mode adds once; plate subtraction cannot go below empty sled',async()=>{
 const {run}=app();run(setup);
 assert.equal(run(`(()=>{liveRec(0).exercise={...original,baseWeight:20,perSide:false};const control=makeWeightStepper(0,planned,0,'machine',null,null);control.children[2].children.find(b=>b.innerHTML==='+25').onclick();return liveRec(0).sets[0].w;})()`),'45');
 assert.equal(run(`(()=>{liveRec(0).exercise={...original,baseWeight:116,perSide:true};liveRec(0).sets=[];const control=makeWeightStepper(0,planned,0,'machine',null,null);control.children[0].children[0].onclick();return liveRec(0).sets[0].w;})()`),'116');
 await run('flushDayWrites()');
});
test('editing sled weight retains totals, PR identity, completion, and variants',()=>{
 const {run}=app();run(setup);
 assert.equal(run(`(()=>{const rec={exercise:{...original,baseWeight:116,perSide:true},done:true,sets:[{w:'206',r:'8'}],variants:[{exercise:leg,sets:[{w:'300',r:'8'}]}]};const next=EH.select(planned,rec,{...original,baseWeight:120,perSide:true});return next.sets[0].w==='206'&&next.done&&next.variants.length===1&&EH.identity(planned,next).baseWeight===120&&EH.key(EH.identity(planned,next))===EH.key(original);})()`),true);
});
test('sled setup persists through save, reload, swaps and cycle archive',async()=>{
 const {run,store}=app();run(setup);
 await run(`(async()=>{liveRec(0).exercise={...original,label:'Hack sled',baseWeight:116,perSide:true};liveRec(0).sets=[{w:'206',r:'8'}];queueSave(1,'mon');await flushDayWrites();dayCache={};await loadDay(1,'mon');})()`);
 assert.equal(run('EH.identity(planned,liveRec(0)).baseWeight'),116);
 assert.equal(run(`(()=>{const id=EH.identity(planned,liveRec(0));let r=EH.select(planned,liveRec(0),leg);r=EH.select(planned,r,id);return r.exercise.baseWeight===116&&r.sets[0].w==='206';})()`),true);
 run('renderAll=async()=>{}');await run('startNewProgram(false)');
 const base=JSON.parse(store.get('bts:base:summary'));assert.equal(Object.values(base.setups)[0].baseWeight,116);
});
test('legacy sled defaults, explicit zero, decimals and invalid imported bases',()=>{
 const {run}=app();run(setup);
 assert.equal(run('EH.equipmentConfig(leg).base'),118);
 assert.equal(run('EH.equipmentConfig({...leg,baseWeight:0}).base'),0);
 assert.equal(run('EH.equipmentConfig({...leg,baseWeight:115.5}).base'),115.5);
 for(const bad of ['-1','Infinity','NaN','10001']) assert.equal(run('EH.equipmentConfig({...leg,baseWeight:'+bad+'}).base'),118);
 assert.equal(run("EH.equipmentConfig({...db,baseWeight:116}).base"),undefined);
});
test('saved loading settings remain selectable in a later untouched workout',async()=>{
 const {run}=app();run(setup);
 await run(`(async()=>{dayCache[keyFor(1,'mon')]={0:{exercise:{...original,baseWeight:116,perSide:true},sets:[]}};state={wk:2,day:'mon'};await showSubstitution(0,planned);})()`);
 assert.equal(run(`(()=>{const form=sheet.children[sheet.children.length-1];const saved=form.children[0].children[0];saved.value=EH.key(original);saved.onchange();const loading=form.children.find(n=>n.className==='loading-settings');return loading.children[0].children[0].value==='116'&&loading.children[1].children[0].value==='pair';})()`),true);
});

test('week modes restore normal effort and reduce extras without changing the base or adjacent weeks',()=>{
 const {run}=app();run(customSetup);
 assert.equal(run(`(()=>{const base=pickProgram(null),before=JSON.stringify(base),p=customizedProgram(base,{...customPlan,weekModes:{'0:1':'normal','0:2':'light'}},0);return p.weeks[0].deload===false&&p.weeks[0].days.mon[0].lrpe==='10'&&p.weeks[1].days.mon[0].sets===2&&p.weeks[1].days.mon.at(-1).sets===2&&p.weeks[1].days.mon[0].tech==='N/A'&&p.weeks[2].days.mon[0].sets===3&&JSON.stringify(base)===before;})()`),true);
});
test('week choices survive reload and protect logged light prescriptions when switched to normal',async()=>{
 const {run,store}=app();run('renderAll=async()=>{}');
 await run("saveWeekMode(2,'light')");await run('refreshCustomProgram()');run("state={wk:2,day:'mon'};liveRec(0).sets=[{w:'100',r:'8'}];queueSave(2,'mon');");await run('flushDayWrites()');
 await run("saveWeekMode(2,'normal')");run('dayCache={}');await run('refreshCustomProgram()');
 assert.equal(run('DATA.weeks[1].days.mon[0].sets'),2);assert.equal(run('DATA.weeks[1].days.mon[1].sets'),3);
 assert.equal(JSON.parse(store.get('bts:log:w2:mon'))[0].sets[0].w,'100');
 assert.equal(run("DATA.weeks[1].days.mon[0].weekMode"),'light');
});
test('week mode toggles do not compound reductions and preserve legacy logs and completed sessions',async()=>{
 const {run}=app();run('renderAll=async()=>{}');
 await run("saveWeekMode(2,'light')");await run('refreshCustomProgram()');run("state={wk:2,day:'mon'};liveRec(0);");
 await run("saveWeekMode(2,'normal')");await run('refreshCustomProgram()');assert.equal(run('DATA.weeks[1].days.mon[0].sets'),3);
 await run("saveWeekMode(2,'light')");await run('refreshCustomProgram()');assert.equal(run('DATA.weeks[1].days.mon[0].sets'),2);
 assert.equal(run(`(()=>{const base=pickProgram(null),p=customizedProgram(base,{version:1,rules:[],weekModes:{'0:2':'light'}},0,{'bts:log:w2:mon':{0:{sets:[{w:'100',r:'8'}]}}},{'bts:fin:w2:wed':{at:'saved'}});return p.weeks[1].days.mon[0].sets===3&&p.weeks[1].days.mon[1].sets===2&&p.weeks[1].days.wed[0].sets===3;})()`),true);
 await run("saveWeekMode(2,'scheduled')");await run('refreshCustomProgram()');assert.equal(run('DATA.weeks[1].days.mon[0].sets'),3);
});
test('week choices are cycle scoped, validated, backed up and retain the old plan on failed writes',async()=>{
 const {run,c,store}=app();run('renderAll=async()=>{}');await run("saveWeekMode(2,'light')");
 assert.equal(run("customizedProgram(pickProgram(null),JSON.parse(localStorage.getItem(CUSTOM_PROGRAM_KEY)),1).weeks[1].days.mon[0].sets"),3);
 await assert.rejects(run("saveWeekMode(2,'invalid')"));
 const prior=store.get('bts:custom:program:v1');c.window.storage.set=async()=>{throw Error('full')};
 await assert.rejects(run("saveWeekMode(2,'normal')"),/full/);assert.equal(store.get('bts:custom:program:v1'),prior);
});

test('completed light workouts retain snapshots without creating logged sets',async()=>{
 const {run,store}=app();run('renderAll=async()=>{}');await run("saveWeekMode(2,'light')");await run('refreshCustomProgram()');
 await run("snapshotProgramDay(2,'mon')");await run('flushDayWrites()');
 assert.equal(JSON.parse(store.get('bts:log:w2:mon'))[0].sets.length,0);
 await run("window.storage.set('bts:fin:w2:mon',JSON.stringify({at:'saved'}))");run('finCache={};dayCache={}');
 await run("saveWeekMode(2,'scheduled')");await run('refreshCustomProgram()');
 assert.equal(run('DATA.weeks[1].days.mon[0].sets'),2);assert.equal(run('DATA.weeks[1].days.wed[0].sets'),3);
});

test('recurring catalog offers glute movements, deduplicates names and includes personal primary targets',()=>{
 const {run}=app();run(customSetup);
 assert.equal(run(`(()=>{const choices=recurringExerciseChoices(pickProgram(null),customPlan),glutes=choices.filter(ex=>ex.muscle==='Glutes');return glutes.some(ex=>ex.name==='Machine Hip Abduction')&&glutes.some(ex=>ex.name==='Barbell Hip Thrust'&&ex.equipment==='plates')&&glutes.some(ex=>ex.name==='DB Glute Bridge'&&ex.equipment==='dumbbell')&&choices.some(ex=>ex.name==='DB Lateral Raise'&&ex.muscle==='Side delts')&&choices.every(ex=>RES_ORDER.includes(ex.equipment))&&new Set(choices.map(ex=>ex.name)).size===choices.length&&!glutes.some(ex=>ex.name==='Barbell Bench Press');})()`),true);
});

test('library-only save survives reload and backup without creating schedules or logs',async()=>{
 const {run,store}=app();
 await run("saveLibraryExercise({name:'Custom glute press',equipment:'machine',label:'Gym A',targetMuscle:'Glutes'})");
 assert.equal(run("JSON.parse(localStorage.getItem(CUSTOM_PROGRAM_KEY)).rules.length"),0);
 assert.equal([...store.keys()].some(k=>k.startsWith('bts:log:')),false);
 assert.equal(await run("(async()=>{const plan=await loadCustomProgram();return recurringExerciseChoices(pickProgram(null),plan).some(ex=>ex.name==='Custom glute press'&&ex.label==='Gym A'&&ex.muscle==='Glutes');})()"),true);
 assert.equal(await run("(async()=>{const backup=await gatherAll();return backup[CUSTOM_PROGRAM_KEY].library.length;})()"),1);
});
test('library updates exact setups while keeping different equipment and setup histories separate',async()=>{
 const {run}=app();
 for(const [equipment,label,muscle] of [['machine','A','Glutes'],['machine','B','Glutes'],['dumbbell','A','Glutes'],['machine','A','Quads']])await run(`saveLibraryExercise({name:'Custom press',equipment:'${equipment}',label:'${label}',targetMuscle:'${muscle}'})`);
 assert.equal(await run("(async()=>{const plan=await loadCustomProgram();return plan.library.length===3&&plan.library.find(ex=>ex.equipment==='machine'&&ex.label==='A').targetMuscle==='Quads';})()"),true);
});
test('invalid or failed library saves preserve previous data and cycle rollover retains library',async()=>{
 const {run,c,store}=app();run('renderAll=async()=>{}');
 await run("saveLibraryExercise({name:'Custom press',equipment:'machine',label:'A',targetMuscle:'Glutes'})");
 const before=store.get('bts:custom:program:v1');
 await assert.rejects(run("saveLibraryExercise({name:'',equipment:'machine',label:'',targetMuscle:'Glutes'})"));assert.equal(store.get('bts:custom:program:v1'),before);
 await run('startNewProgram(false)');assert.equal(JSON.parse(store.get('bts:custom:program:v1')).library.length,1);
 c.window.storage.set=async()=>{throw Error('full')};
 await assert.rejects(run("saveLibraryExercise({name:'Second press',equipment:'machine',label:'',targetMuscle:'Glutes'})"),/full/);
 assert.equal(store.get('bts:custom:program:v1'),before);
});
