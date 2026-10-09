/* brew · printer.js — thermal bill printer + receipt spike */
(function () {
  const B = window.B, A = B.art;
  const queue = [];
  let busy = false, spikeCount = 0, lastReceipt = null;
  const LH = 9.4; // px per printed line

  const L = (l, r = '', cls = '') => `<div class="rc-line ${cls}"><span>${l}</span>${r !== '' ? `<span>${r}</span>` : ''}</div>`;
  const money = (n) => n.toFixed(2);

  function lines(bill) {
    const out = [];
    const d = new Date(2026, 9, 2 + B.state.day);
    const clk = B.fmtClock(B.gameMin());
    out.push('<div class="rc-line logo"><span>brew</span></div>');
    out.push(L('12, 100 Ft Rd, Indiranagar', '', 'c'));
    out.push(L('GSTIN 29BREW0000C1Z5', '', 'c'));
    out.push('<div class="rc-line rule"></div>');
    out.push(L(`Bill #${String(bill.no).padStart(4, '0')}`, bill.where, 'b'));
    out.push(L(d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }), `${clk.hm} ${clk.ap}`));
    out.push(L(`Guest: ${bill.name}`));
    out.push('<div class="rc-line rule"></div>');
    let sub = 0;
    bill.items.forEach((it) => {
      const m = B.ITEM[it.id];
      const p = it.price * it.qty;
      sub += p;
      out.push(L(`${it.qty} ${m.name.length > 15 ? m.name.slice(0, 14) + '.' : m.name}`, money(p)));
      it.mods.forEach((k) => {
        const md = B.MODS[k];
        if (md.price) { sub += md.price * it.qty; out.push(L(`  + ${md.long}`, money(md.price * it.qty))); }
        else out.push(L(`  ${md.x ? 'no ' + md.label : md.long}`));
      });
    });
    const cg = Math.round(sub * 0.025 * 100) / 100, sg = cg;
    const tot = sub + cg + sg, rnd = Math.round(tot) - tot;
    out.push('<div class="rc-line rule"></div>');
    out.push(L('Subtotal', money(sub)));
    out.push(L('CGST @2.5%', money(cg)));
    out.push(L('SGST @2.5%', money(sg)));
    out.push(L('Round off', (rnd >= 0 ? '+' : '') + rnd.toFixed(2)));
    out.push(L('TOTAL', '₹' + Math.round(tot).toLocaleString('en-IN'), 'big'));
    out.push('<div class="rc-line rule"></div>');
    out.push(L(`Paid · ${bill.pay}`, '✓'));
    out.push(`<div class="rc-qr">${A.qr(bill.no * 13 + 7)}</div>`);
    out.push(L('scan to rate us ♥', '', 'c'));
    out.push(L('thank you · come back soon', '', 'c'));
    return { html: out, total: Math.round(tot) };
  }

  async function run() {
    if (busy || !queue.length) return;
    busy = true;
    const job = queue.shift();
    const { html } = job;
    const paper = B.$('#receipt');
    const led = B.$('#printer-led');
    const fast = B.state.speed >= 10 || queue.length > 2;
    paper.innerHTML = '<div class="rc"></div>';
    const rc = paper.firstChild;
    gsap.set(paper, { height: 0, rotationX: 0, skewX: 0, opacity: 1, x: 0, y: 0 });
    led.classList.add('busy');
    if (fast) {
      html.forEach((l) => rc.insertAdjacentHTML('beforeend', l));
      B.audio.play('printFeed');
    } else {
      B.audio.play('printFeed');
      for (let i = 0; i < html.length; i++) {
        rc.insertAdjacentHTML('beforeend', html[i]);
        const hgt = rc.offsetHeight + 6;
        const curl = B.clamp((hgt - 96) * 0.35, 0, 38);
        gsap.to(paper, { height: Math.min(hgt, 150), rotationX: -curl, skewX: Math.sin(i * 0.7) * 1.2, duration: 0.09, ease: 'none' });
        B.audio.play('printLine', i);
        await wait(html[i].includes('rc-qr') ? 260 : 95);
      }
      await wait(380);
    }
    led.classList.remove('busy');
    lastReceipt = rc.innerHTML;
    // tear off and flutter onto the spike
    B.audio.play('rip');
    await flutter(paper, fast);
    gsap.set(paper, { height: 0 });
    paper.innerHTML = '';
    busy = false;
    run();
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function flutter(paper, fast) {
    return new Promise((res) => {
      const counter = B.$('#counter');
      const pr = paper.getBoundingClientRect(), cr = counter.getBoundingClientRect();
      const k = cr.width / counter.offsetWidth || 1;
      const fl = document.createElement('div');
      fl.className = 'flying-receipt';
      fl.innerHTML = paper.innerHTML;
      const w = paper.offsetWidth, h = Math.max(30, paper.offsetHeight);
      fl.style.cssText = `left:${(pr.left - cr.left) / k}px;top:${(pr.top - cr.top) / k}px;width:${w}px;height:${h}px`;
      counter.appendChild(fl);
      gsap.set(paper, { opacity: 0 });
      const tx = 1282 + 21 - w / 2, ty = 92 + 2;
      const sx = parseFloat(fl.style.left), sy = parseFloat(fl.style.top);
      const tl = gsap.timeline({
        onComplete: () => {
          fl.remove();
          spike();
          res();
        },
      });
      if (fast) {
        tl.to(fl, { left: tx, top: ty, scale: 0.3, rotation: 8, duration: 0.35, ease: 'power2.in' });
      } else {
        tl.to(fl, { top: sy - 30, rotation: -8, duration: 0.3, ease: 'power2.out' })
          .to(fl, { left: (sx + tx) / 2 + 20, top: sy - 10, rotation: 14, scale: 0.62, duration: 0.42, ease: 'sine.inOut' })
          .to(fl, { left: (sx + tx) / 2 + 60, top: ty - 30, rotation: -12, scale: 0.42, duration: 0.42, ease: 'sine.inOut' })
          .to(fl, { left: tx, top: ty, rotation: 4, scale: 0.3, duration: 0.32, ease: 'power2.in' });
      }
    });
  }

  function spike() {
    const st = B.$('#spike-stack');
    spikeCount++;
    if (st.children.length >= 9) {
      Array.from(st.children).forEach((c, i) => gsap.to(c, { opacity: 0, y: -10, duration: 0.3, delay: i * 0.02, onComplete: () => c.remove() }));
    }
    const n = st.children.length;
    const el = B.h(`<i class="spiked"></i>`);
    el.style.bottom = n * 4 + 'px';
    st.appendChild(el);
    gsap.fromTo(el, { y: -30, rotation: B.rand(-30, 30), opacity: 0 }, { y: 0, rotation: B.rand(-14, 14), opacity: 1, duration: 0.3, ease: 'power3.in' });
    B.audio.play('thud', 1300);
  }

  B.printer = {
    /** bill: {no, name, where, items:[{id,qty,price,mods}], pay} → returns total incl. GST */
    print(bill) {
      const l = lines(bill);
      queue.push(l);
      run();
      return l.total;
    },
    total(bill) { return lines(bill).total; },
  };

  // click the spike to read the most recent receipt
  B.$('#spike').addEventListener('click', () => {
    if (!lastReceipt) return B.toast('🧾', 'No receipts yet', 'They’ll land on the spike after each payment.');
    const z = B.h(`<div class="receipt-zoom"><div class="pr-paper"><div class="rc">${lastReceipt}</div></div></div>`);
    document.body.appendChild(z);
    gsap.from(z.firstChild, { y: 40, rotation: -6, scale: 0.6, opacity: 0, duration: 0.5, ease: 'back.out(1.6)' });
    B.audio.play('rustle');
    z.addEventListener('click', () => gsap.to(z, { opacity: 0, duration: 0.25, onComplete: () => z.remove() }));
  });
})();
