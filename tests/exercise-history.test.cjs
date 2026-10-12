const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function app(){
  const noop=()=>{};
  const element=()=>({style:{},classList:{add:noop,remove:noop,toggle:noop,contains:()=>false},addEventListener:noop,querySelector:()=>element(),querySelectorAll:()=>[],append:noop,appendChild:noop,setAttribute:noop,remove:noop});
  const store=new Map();
  const localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k),key:i=>[...store.keys()][i],get length(){return store.size}};
  const c=vm.createContext({console,localStorage,document:{getElementById:()=>element(),querySelector:()=>element(),querySelectorAll:()=>[],createElement:element,addEventListener:noop},navigator:{},setTimeout:()=>1,clearTimeout:noop,setInterval:()=>1,clearInterval:noop,alert:noop,confirm:()=>true,fetch:async()=>({ok:true}),URL,Blob});
  c.window=c; c.addEventListener=noop;
  for(const f of ['data.js','exercise-history.js','app.js']) vm.runInContext(fs.readFileSync('public/'+f,'utf8').split('/* ---------- boot ---------- */')[0],c,{filename:f});
  return {run:code=>vm.runInContext(code.includes("await") && !code.startsWith("(async") ? "(async()=> ("+code+"))()" : code,c),store,c};
}
const setup=`const planned=DATA.weeks[0].days.mon[0]; const original=EH.identity(planned); const leg=EH.identity({ex:'Leg Press'}); const db=EH.identity({ex:'DB Walking Lunge'});`;
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
