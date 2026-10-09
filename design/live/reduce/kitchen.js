/* brew live — kitchen slices: staff, tasks, stations, equipment, prep.

   staff.station / staff.task are derived from the active tasks of that staff member (the sim reports a person as
   working while any of their tasks runs). staff.state: 'absent' | 'off' | 'break' | 'working' | 'idle'.
   stations: one per equipment unit; status 'down' while its equipment is down. util / queue stay null until the
   backend streams station.load (every 60 sim-s), in_use is approximated from the active tasks until then. */
(() => {
  const { U } = BrewStore;

  const staffState = (st) => (st.absent ? 'absent' : !st.present ? 'off' : st.on_break ? 'break' : st.station ? 'working' : 'idle');
  const withState = (st) => ({ ...st, state: staffState(st) });

  /** station/task of a staff member from the active tasks map */
  const activity = (tasks, staff_id) => {
    let last = null;
    for (const t of Object.values(tasks)) {
      if (t.staff_id !== staff_id) continue;
      if (!last || t.started_s > last.started_s || (t.started_s === last.started_s && t.task_id > last.task_id)) last = t;
    }
    return last ? { station: last.station, task: last.step } : { station: null, task: null };
  };

  const refreshStaff = (s, tasks, staff_id) => {
    const st = s.staff[staff_id];
    if (!st) return s.staff;
    const a = activity(tasks, staff_id);
    if (a.station === st.station && a.task === st.task) return s.staff;
    return U.set(s.staff, staff_id, withState({ ...st, ...a }));
  };

  const inUse = (tasks, station, slots) => {
    let n = 0;
    for (const t of Object.values(tasks)) if (t.station === station) n += 1;
    return slots > 0 ? Math.min(n, slots) : n;
  };

  const staffRow = (r) => withState({
    id: r.id, name: r.name, role: r.role, present: r.present, on_break: r.on_break, absent: r.absent, late: false,
    station: r.station, task: r.task, fatigue: r.fatigue, shift: r.shift.slice(), break_due_s: null, break_end_s: null,
    wage_per_h: r.wage_per_h, skills: r.skills, break_rule: r.break_rule ?? null, break_min: r.break_min ?? null,
  });

  const setStation = (s, station, patch) => {
    if (!s.stations[station]) return s.stations;
    return U.upd(s.stations, station, patch);
  };

  const equipPatch = (s, ev, up) => {
    const d = ev.data;
    const key = s.equipment[d.equipment] ? d.equipment : Object.keys(s.equipment).find((k) => s.equipment[k].key === d.equipment && s.equipment[k].station === d.station);
    if (!key) return null;
    const equipment = U.upd(s.equipment, key, { status: up ? 'up' : 'down', down_until_s: up ? null : d.until_s });
    // a station is down when every unit of it is down
    const units = Object.values(equipment).filter((e) => e.station === d.station);
    const allDown = units.every((e) => e.status === 'down');
    const stations = setStation(s, d.station, {
      status: allDown ? 'down' : 'up',
      down_until_s: allDown ? Math.max(...units.map((e) => e.down_until_s || 0)) : null,
    });
    return { equipment, stations };
  };

  BrewStore.register('kitchen', {
    hydrate(snap) {
      const staff = {};
      for (const r of snap.staff) staff[r.id] = staffRow(r);
      const equipment = {};
      const stations = {};
      for (const e of snap.equipment) {
        const key = equipment[e.key] ? e.key + '#' + e.idx : e.key;
        equipment[key] = { key: e.key, idx: e.idx, station: e.station, slots: e.slots, slots_in_use: e.slots_in_use, status: e.status, down_until_s: e.down_until_s, condition: e.condition };
        const st = stations[e.station];
        stations[e.station] = st
          ? { ...st, in_use: st.in_use + e.slots_in_use, slots: st.slots + e.slots, status: st.status === 'up' || e.status === 'up' ? 'up' : 'down', down_until_s: e.status === 'down' ? e.down_until_s : st.down_until_s }
          : { station: e.station, util: null, queue: null, in_use: e.slots_in_use, slots: e.slots, status: e.status, down_until_s: e.down_until_s };
      }
      return { staff, tasks: {}, stations, equipment, prep: {} };
    },
    on: {
      'task.started': ['tasks', (s, ev) => {
        const d = ev.data;
        const tasks = { ...s.tasks, [d.task_id]: { task_id: d.task_id, station: d.station, step: d.step, staff_id: d.staff_id, order_no: d.order_no, est_s: d.est_s, started_s: ev.sim_s } };
        const st = s.stations[d.station];
        return {
          tasks,
          staff: refreshStaff(s, tasks, d.staff_id),
          stations: st ? U.upd(s.stations, d.station, { in_use: inUse(tasks, d.station, st.slots) }) : s.stations,
        };
      }],
      'task.finished': ['tasks', (s, ev) => {
        const d = ev.data;
        // a task that started before the snapshot has no entry: still re-derive what the person is doing now
        const tasks = U.del(s.tasks, d.task_id);
        const st = s.stations[d.station];
        return {
          tasks,
          staff: refreshStaff(s, tasks, d.staff_id),
          stations: st ? U.upd(s.stations, d.station, { in_use: inUse(tasks, d.station, st.slots) }) : s.stations,
        };
      }],

      'equipment.down': ['equipment', (s, ev) => equipPatch(s, ev, false)],
      'equipment.up': ['equipment', (s, ev) => equipPatch(s, ev, true)],
      // every 60 sim-s, one row per station
      'station.load': ['stations', (s, ev) => {
        let stations = s.stations;
        for (const r of ev.data.stations) stations = U.upd(stations, r.station, { station: r.station, util: r.util, queue: r.queue, in_use: r.in_use, slots: r.slots, status: r.status, down_until_s: r.down_until_s }, true);
        return { stations };
      }],

      'staff.clocked_in': ['staff', (s, ev) => ({ staff: U.upd(s.staff, ev.data.staff_id, (st) => withState({ ...st, present: true, absent: false, late: false })) })],
      'staff.clocked_out': ['staff', (s, ev) => ({ staff: U.upd(s.staff, ev.data.staff_id, (st) => withState({ ...st, present: false, on_break: false, break_end_s: null })) })],
      'staff.break_started': ['staff', (s, ev) => ({ staff: U.upd(s.staff, ev.data.staff_id, (st) => withState({ ...st, on_break: true })) })],
      'staff.break_ended': ['staff', (s, ev) => ({ staff: U.upd(s.staff, ev.data.staff_id, (st) => withState({ ...st, on_break: false, break_end_s: null })) })],
      'staff.absent': ['staff', (s, ev) => ({ staff: U.upd(s.staff, ev.data.staff_id, (st) => withState({ ...st, absent: true })) })],
      'staff.late': ['staff', (s, ev) => ({ staff: U.upd(s.staff, ev.data.staff_id, (st) => withState({ ...st, absent: true, late: true })) })],
      // a staff disruption ending brings the person back, even outside their shift (no clocked_in then)
      'chaos.resolved': ['staff', (s, ev) => {
        const d = ev.data;
        if ((d.kind !== 'staff_absent' && d.kind !== 'staff_late') || !d.target || !s.staff[d.target]) return null;
        return { staff: U.upd(s.staff, d.target, (st) => withState({ ...st, absent: false, late: false })) };
      }],
      // every 60 sim-s, fatigue + the break schedule. The task stream is the truth for who is doing what: the row's
      // station/task/state are only taken as given while the stream knows no task for that person (a snapshot that
      // was taken mid-task); a person the sim reports as not working (idle / off / break / absent) cannot have a task
      // in flight, so a task left behind by a lost task.finished is dropped here instead of pinning them to a station.
      'staff.status': ['staff', (s, ev) => {
        let staff = s.staff;
        let tasks = s.tasks;
        for (const r of ev.data.staff) {
          const mine = Object.values(tasks).some((t) => t.staff_id === r.staff_id);
          if (mine && r.state && r.state !== 'working') {
            tasks = Object.fromEntries(Object.entries(tasks).filter(([, t]) => t.staff_id !== r.staff_id));
          }
          const known = Object.values(tasks).some((t) => t.staff_id === r.staff_id);
          staff = U.upd(staff, r.staff_id, (st) => {
            const next = { ...st, fatigue: r.fatigue, break_due_s: r.break_due_s, break_end_s: r.break_end_s };
            // the sim's own verdict on presence (it derives state from absent > present > on_break > active)
            if (r.state === 'absent') next.absent = true;
            else if (r.state === 'off') { next.absent = false; next.present = false; }
            else if (r.state === 'break') { next.absent = false; next.present = true; next.on_break = true; }
            else if (r.state === 'working' || r.state === 'idle') { next.absent = false; next.present = true; next.on_break = false; }
            if (!known) {
              if (r.station !== undefined) { next.station = r.station; next.task = r.task; }
              return withState(next);
            }
            return withState({ ...next, ...activity(tasks, r.staff_id) });
          });
        }
        return tasks === s.tasks ? { staff } : { staff, tasks };
      }],

      'prep.started': ['prep', (s, ev) => ({ prep: { ...s.prep, [ev.data.prep_key]: { prep_key: ev.data.prep_key, qty: ev.data.qty, state: 'cooking', s: ev.sim_s } } })],
      'prep.ready': ['prep', (s, ev) => ({ prep: { ...s.prep, [ev.data.prep_key]: { prep_key: ev.data.prep_key, qty: ev.data.qty, state: 'ready', s: ev.sim_s } } })],
      'prep.expired': ['prep', (s, ev) => ({ prep: { ...s.prep, [ev.data.prep_key]: { prep_key: ev.data.prep_key, qty: ev.data.qty, state: 'expired', s: ev.sim_s } } })],

      // GET /staff: fatigue, shift and wage for everyone (presence and activity stay event-driven)
      'rest.staff': ['staff', (s, ev) => {
        let staff = s.staff;
        for (const r of ev.data.items || []) {
          const prev = staff[r.id];
          staff = U.set(staff, r.id, prev
            ? withState({ ...prev, name: r.name, role: r.role, fatigue: r.fatigue, shift: r.shift.slice(), wage_per_h: r.wage_per_h, skills: r.skills, break_rule: r.break_rule ?? prev.break_rule ?? null, break_min: r.break_min ?? prev.break_min ?? null })
            : staffRow(r));
        }
        return { staff };
      }],
    },
  });
})();
