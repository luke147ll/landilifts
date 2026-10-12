// Additive log schema: the active record keeps the original done/sets fields.
// Other exercise/equipment records stay in variants; reading legacy logs never writes them.
(function () {
  const clean = value => String(value || '').trim().replace(/\s+/g, ' ');
  function identity(planned, rec = {}) {
    const saved = rec.exercise || planned.customIdentity || {};
    const name = clean(saved.name) || planned.ex;
    return {...settings(saved), name, equipment: saved.equipment || rec.resType || resTypeFor(name),
      label: clean(saved.label), group: saved.group || window.EX_GROUP[name] || window.EX_GROUP[planned.ex] || 'Other'};
  }
  function settings(saved){
    const result={};
    if(saved.baseWeight!=='' && saved.baseWeight!=null && Number.isFinite(Number(saved.baseWeight)) && Number(saved.baseWeight)>=0 && Number(saved.baseWeight)<=10000) result.baseWeight=Number(saved.baseWeight);
    if(typeof saved.perSide==='boolean') result.perSide=saved.perSide;
    return result;
  }
  function equipmentConfig(id){
    const cfg={...(WRES[id.equipment]||WRES.machine)};
    if(['machine','plates','legpress'].includes(id.equipment)){
      const saved=settings(id);
      if(saved.baseWeight!=null) cfg.base=saved.baseWeight;
      if(saved.perSide!=null) cfg.pair=saved.perSide;
      if(cfg.pair && id.equipment==='machine') cfg.chips=WRES.legpress.chips;
      if(cfg.base!=null&&!cfg.baseLabel) cfg.baseLabel='machine';
    }
    return cfg;
  }
  function key(id) { return 'exercise:' + JSON.stringify([id.name, id.equipment, id.label.toLowerCase()]); }
  function label(id) { return id.name + ' · ' + (WRES[id.equipment] || WRES.machine).label + (id.label ? ' · ' + id.label : ''); }
  function entries(planned, rec) {
    if (!rec) return [];
    return [rec, ...(rec.variants || [])].map(record => {
      const id = identity(planned, record);
      return {rec: record, ex: {...planned, ex: id.name, group: id.group,
        historyKey: key(id), historyLabel: label(id), plannedName: planned.ex}, id};
    });
  }
  function select(planned, rec, id) {
    const current = identity(planned, rec);
    if (key(current) === key(id)) return {...rec, exercise:{...rec.exercise,...id}, resType:id.equipment};
    const {variants = [], ...active} = rec;
    const saved = variants.map(v => ({...v}));
    const index = saved.findIndex(v => key(identity(planned, v)) === key(id));
    const next = index < 0 ? {done: false, sets: [], exercise: id} : saved.splice(index, 1)[0];
    // Keep even incomplete or completion-only records; never move their weights to a new identity.
    saved.push({...active, exercise: current});
    return {...next, ...(rec.planned?{planned:rec.planned}:{}), exercise: id, resType: id.equipment, variants: saved};
  }
  function baselineMap(map = {}) {
    const result = {};
    for (const [name, value] of Object.entries(map)) {
      const k = name.startsWith('exercise:') ? name : key(identity({ex: name}));
      result[k] = typeof value === 'number' ? Math.max(result[k] || 0, value) : value;
    }
    return result;
  }
  window.ExerciseHistory = {identity, key, label, entries, select, baselineMap, equipmentConfig};
})();
