/* brew live — the event bus (window.BREW_LIVE).
   Same contract menu.js already uses: on(type, fn) / emit(type, data). fn(data, ev) gets the raw payload first and the
   whole envelope second; the wildcard '*' gets fn(type, data, ev). Subscriber errors never break the stream.
   Load this file before menu.js. If something created window.BREW_LIVE earlier (menu.js' stand-in bus), its emit is
   kept in the chain so its subscribers keep working. */
(() => {
  const prev = window.BREW_LIVE;
  const prevEmit = prev && typeof prev.emit === 'function' ? prev.emit.bind(prev) : null;
  const subs = Object.create(null);
  const guard = (fn, args, label) => {
    try { fn(...args); } catch (e) { console.error('[brew bus] subscriber failed on ' + label, e); }
  };

  const bus = {
    on(type, fn) {
      (subs[type] = subs[type] || []).push(fn);
      return () => bus.off(type, fn);
    },
    off(type, fn) {
      const l = subs[type];
      if (!l) return;
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    },
    once(type, fn) {
      const un = bus.on(type, (...a) => { un(); fn(...a); });
      return un;
    },
    emit(type, data, ev) {
      if (prevEmit) guard(prevEmit, [type, data], type);
      const l = subs[type];
      if (l) for (const fn of l.slice()) guard(fn, [data, ev], type);
      const star = subs['*'];
      if (star) for (const fn of star.slice()) guard(fn, [type, data, ev], '*');
    },
    /** number of subscribers (tests) */
    count(type) { return (subs[type] || []).length; },
  };

  window.BREW_LIVE = Object.assign(prev || {}, bus);
})();
