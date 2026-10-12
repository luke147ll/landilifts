// Additive log schema: the active record keeps the original done/sets fields.
// Other exercise/equipment records stay in variants; reading legacy logs never writes them.
(function () {
  const clean = value => String(value || '').trim().replace(/\s+/g, ' ');
  function identity(planned, rec = {}) {
    const saved = rec.exercise || {};
    const name = clean(saved.name) || planned.ex;
    return {name, equipment: saved.equipment || rec.resType || resTypeFor(name),
      label: clean(saved.label), group: saved.group || window.EX_GROUP[name] || window.EX_GROUP[planned.ex] || 'Other'};
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
    if (key(current) === key(id)) return rec;
    const {variants = [], ...active} = rec;
    const saved = variants.map(v => ({...v}));
    const index = saved.findIndex(v => key(identity(planned, v)) === key(id));
    const next = index < 0 ? {done: false, sets: [], exercise: id} : saved.splice(index, 1)[0];
    // Keep even incomplete or completion-only records; never move their weights to a new identity.
    saved.push({...active, exercise: current});
    return {...next, exercise: id, resType: id.equipment, variants: saved};
  }
  function baselineMap(map = {}) {
    const result = {};
    for (const [name, value] of Object.entries(map)) {
      const k = name.startsWith('exercise:') ? name : key(identity({ex: name}));
      result[k] = typeof value === 'number' ? Math.max(result[k] || 0, value) : value;
    }
    return result;
  }
  window.ExerciseHistory = {identity, key, label, entries, select, baselineMap};
})();
