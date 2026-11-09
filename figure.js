// Человечек, который показывает упражнение (анимация из двух поз).
// Поза — углы в градусах: t корпус от вертикали (90 = вперёд горизонтально),
// ua/fa плечо/предплечье, th/sh бедро/голень (0 = вниз, 90 = вперёд, -90 = назад, 180 = вверх).
// ua2/fa2/th2/sh2 — дальняя рука/нога (если отличаются). front: вид спереди.
// fix — какая точка стоит на месте (A лодыжка, W кисть, H таз, K колено) и где.

(function () {
  const L = { torso: 28, neck: 9, ua: 14, fa: 13, th: 19, sh: 19, foot: 5 };
  const rad = d => d * Math.PI / 180;
  const v = (a, l) => [Math.sin(rad(a)) * l, Math.cos(rad(a)) * l];
  const add = (p, q) => [p[0] + q[0], p[1] + q[1]];

  const ST = { t: 0, ua: 0, fa: 0, th: 0, sh: 0 };
  const P = (o) => Object.assign({}, ST, o);
  const A = {
    warmup: { a: P({ front: 1, ua: 20, fa: 25, th: 6, sh: 6 }), b: P({ front: 1, ua: 160, fa: 170, th: 6, sh: 6 }), fix: ['A', 60, 92] },
    squat: { a: P({ ua: 80, fa: 85 }), b: P({ t: 40, ua: 85, fa: 90, th: 95, sh: -25 }), fix: ['A', 52, 92] },
    goblet: { a: P({ ua: 20, fa: 160 }), b: P({ t: 35, ua: 30, fa: 165, th: 95, sh: -25 }), fix: ['A', 52, 92] },
    bbsquat: { a: P({ ua: -30, fa: 165 }), b: P({ t: 40, ua: -10, fa: 175, th: 95, sh: -25 }), fix: ['A', 52, 92] },
    legpress: { a: P({ t: -45, ua: 20, fa: 60, th: 160, sh: 60 }), b: P({ t: -45, ua: 20, fa: 60, th: 120, sh: 120 }), fix: ['H', 45, 74], props: ['seat'] },
    lunge: { a: P({ th2: 0, sh2: 0 }), b: P({ th: 85, sh: 0, th2: -25, sh2: -100 }), fix: ['A', 68, 92] },
    bulgarian: { a: P({ th: 20, sh: 0, th2: -40, sh2: -120 }), b: P({ t: 15, th: 85, sh: -5, th2: -30, sh2: -125 }), fix: ['A', 72, 92] },
    stepup: { a: P({ th: 80, sh: -5, th2: 0, sh2: 0 }), b: P({ th: 0, sh: 0, th2: -10, sh2: -60 }), fix: ['A', 66, 76], props: ['box'] },
    rdl: { a: P({}), b: P({ t: 75, th: -12, sh: 5 }), fix: ['A', 58, 92] },
    swing: { a: P({ t: 70, th: -15, sh: 8 }), b: P({ ua: 85, fa: 85 }), fix: ['A', 58, 92] },
    slrdl: { a: P({ th2: 0, sh2: 0 }), b: P({ t: 80, th: -5, sh: 5, th2: -95, sh2: -95 }), fix: ['A', 62, 92] },
    bridge: { a: P({ t: 90, ua: -90, fa: -90, th: -150, sh: -20 }), b: P({ t: 105, ua: -100, fa: -95, th: -115, sh: -5 }), fix: ['A', 38, 92] },
    pushup: { a: P({ t: 66, th: -66, sh: -66 }), b: P({ t: 82, ua: -60, fa: 80, th: -82, sh: -82 }), fix: ['A', 22, 91] },
    kneepush: { a: P({ t: 58, th: -50, sh: -90 }), b: P({ t: 78, ua: -60, fa: 80, th: -70, sh: -90 }), fix: ['K', 42, 91] },
    feetpush: { a: P({ t: 80, th: -87, sh: -87 }), b: P({ t: 92, ua: -60, fa: 80, th: -95, sh: -95 }), fix: ['A', 24, 72], props: ['chairFeet'] },
    dips: { a: P({ t: 5, th: 15, sh: -70 }), b: P({ t: 20, ua: -55, fa: 5, th: 20, sh: -70 }), fix: ['W', 60, 46], props: ['bars'] },
    chairdips: { a: P({ t: -5, ua: -15, fa: -5, th: 80, sh: 10 }), b: P({ t: -5, ua: -65, fa: 0, th: 80, sh: 20 }), fix: ['W', 40, 62], props: ['chairHands'] },
    bench: { a: P({ t: 90, ua: 180, fa: 180, th: -95, sh: 0 }), b: P({ t: 90, ua: 15, fa: 175, th: -95, sh: 0 }), fix: ['H', 46, 66], props: ['bench'] },
    pike: { a: P({ t: 130, ua: 50, fa: 50, th: -20, sh: -20 }), b: P({ t: 145, ua: 100, fa: 20, th: -20, sh: -20 }), fix: ['A', 30, 92] },
    press: { a: P({ front: 1, ua: 80, fa: 172, th: 5, sh: 5 }), b: P({ front: 1, ua: 165, fa: 175, th: 5, sh: 5 }), fix: ['A', 60, 92] },
    pullup: { a: P({ ua: 178, fa: 180, th: 8, sh: -15 }), b: P({ t: 5, ua: 40, fa: 175, th: 20, sh: -25 }), fix: ['W', 60, 16], props: ['bar'] },
    hang: { a: P({ ua: 178, fa: 180, th: 4 }), b: P({ ua: 178, fa: 180, th: 8, sh: -8 }), fix: ['W', 60, 16], props: ['bar'] },
    legraise: { a: P({ ua: 178, fa: 180, th: 4 }), b: P({ t: -5, ua: 178, fa: 180, th: 100, sh: 10 }), fix: ['W', 60, 16], props: ['bar'] },
    latpull: { a: P({ t: -5, ua: 178, fa: 180, th: 90 }), b: P({ t: -15, ua: 35, fa: 170, th: 90 }), fix: ['H', 55, 70], props: ['seat', 'handle'] },
    pulldown: { a: P({ front: 1, ua: 160, fa: 165, th: 5, sh: 5 }), b: P({ front: 1, ua: 55, fa: 160, th: 5, sh: 5 }), fix: ['A', 60, 92] },
    towel: { a: P({ t: 85, ua: 95, fa: 95, th: -93, sh: -93 }), b: P({ t: 75, ua: 20, fa: 150, th: -95, sh: -95 }), fix: ['H', 52, 88] },
    superman: { a: P({ t: 90, ua: 92, fa: 92, th: -90, sh: -90 }), b: P({ t: 78, ua: 105, fa: 105, th: -100, sh: -102 }), fix: ['H', 52, 88] },
    row: { a: P({ t: 80, th: -10, sh: 5, ua2: 10, fa2: 0 }), b: P({ t: 80, ua: -75, fa: 0, th: -10, sh: 5, ua2: 10, fa2: 0 }), fix: ['A', 42, 92], props: ['benchHand'] },
    bbrow: { a: P({ t: 50, th: -15, sh: 10 }), b: P({ t: 50, ua: -55, fa: -5, th: -15, sh: 10 }), fix: ['A', 55, 92] },
    invrow: { a: P({ t: 62, ua: 150, fa: 150, th: -62, sh: -62 }), b: P({ t: 62, ua: 35, fa: 170, th: -62, sh: -62 }), fix: ['A', 20, 92], props: ['handle'] },
    seatrow: { a: P({ t: 5, ua: 85, fa: 85, th: 85, sh: 85 }), b: P({ t: -10, ua: -35, fa: 80, th: 85, sh: 85 }), fix: ['H', 42, 86], props: ['handle'] },
    curl: { a: P({ ua: 12, fa: 16 }), b: P({ ua: 6, fa: 150 }), fix: ['A', 58, 92] },
    ext: { a: P({ ua: 158, fa: -10 }), b: P({ ua: 158, fa: 170 }), fix: ['A', 58, 92] },
    pushdown: { a: P({ ua: -5, fa: 95 }), b: P({ ua: -5, fa: 5 }), fix: ['A', 58, 92], props: ['handle'] },
    lateral: { a: P({ front: 1, ua: 12, fa: 12, th: 5, sh: 5 }), b: P({ front: 1, ua: 88, fa: 88, th: 5, sh: 5 }), fix: ['A', 60, 92] },
    calf: { a: P({}), b: P({ lift: 5 }), fix: ['A', 58, 92], props: ['step'] },
    wrist: { a: P({ t: 10, ua: 25, fa: 85, th: 90 }), b: P({ t: 10, ua: 25, fa: 62, th: 90 }), fix: ['H', 50, 66], props: ['chairSeat'] },
    farmer: { a: P({ front: 1, ua: 6, fa: 6, th: 3, sh: 3 }), b: P({ front: 1, ua: 6, fa: 6, th: 7, sh: 7 }), fix: ['A', 60, 92] },
    wring: { a: P({ front: 1, ua: 70, fa: 75, th: 5, sh: 5 }), b: P({ front: 1, ua: 76, fa: 66, th: 5, sh: 5 }), fix: ['A', 60, 92] },
    plank: { a: P({ t: 78, ua: 0, fa: 90, th: -78, sh: -78 }), b: P({ t: 75, ua: 0, fa: 90, th: -80, sh: -80 }), fix: ['A', 22, 91] },
    crunch: { a: P({ t: 90, ua: 150, fa: 20, th: -150, sh: -20 }), b: P({ t: 58, ua: 150, fa: 20, th: -150, sh: -20 }), fix: ['H', 55, 88] },
    lyingraise: { a: P({ t: 90, ua: -90, fa: -90, th: -90, sh: -90 }), b: P({ t: 90, ua: -90, fa: -90, th: -178, sh: -178 }), fix: ['H', 62, 89] },
    stretch: { a: P({ ua: 175, fa: 178 }), b: P({ t: 95 }), fix: ['A', 52, 92] },
  };
  const MAP = {
    pullup: 'pullup', bandPullup: 'pullup', neg: 'pullup', chinup: 'pullup', latPull: 'latpull', bandPulldown: 'pulldown',
    towelPull: 'towel', superman: 'superman', wallAngel: 'superman', row: 'row', bbRow: 'bbrow', invRow: 'invrow', tableRow: 'invrow',
    cableRow: 'seatrow', bandRow: 'seatrow', pushupKnee: 'kneepush', fingerPush: 'kneepush', pushup: 'pushup', diamond: 'pushup',
    pushupFeet: 'feetpush', dips: 'dips', dbBench: 'bench', bench: 'bench', pike: 'pike', dbOhp: 'press', ohp: 'press', kbPress: 'press',
    bandPress: 'press', squat: 'squat', goblet: 'goblet', kbGoblet: 'goblet', bbSquat: 'bbsquat', legPress: 'legpress', bulgarian: 'bulgarian',
    rdl: 'rdl', dbRdl: 'rdl', kbSwing: 'swing', slRdl: 'slrdl', hipThrust: 'bridge', bridge: 'bridge', lunge: 'lunge', dbLunge: 'lunge',
    stepUp: 'stepup', calf: 'calf', plank: 'plank', sidePlank: 'plank', legRaise: 'legraise', lyingRaise: 'lyingraise', crunch: 'crunch',
    hammer: 'curl', curl: 'curl', bbCurl: 'curl', bandCurl: 'curl', chairDips: 'chairdips', dbExt: 'ext', pushdown: 'pushdown',
    lateral: 'lateral', bandLateral: 'lateral', hang: 'hang', wrist: 'wrist', wristExt: 'wrist', farmer: 'farmer', towelWring: 'wring',
    warmup: 'warmup', stretch: 'stretch',
    gravitron: 'pullup', machineChest: 'seatpress', inclineDb: 'bench', cableFly: 'lateral', machineShoulder: 'press',
    legExt: 'legext', legCurl: 'legcurl', cableCurl: 'curl',
  };
  Object.assign(A, {
    seatpress: { a: P({ t: -8, ua: 10, fa: 100, th: 90 }), b: P({ t: -8, ua: 90, fa: 90, th: 90 }), fix: ['H', 48, 66], props: ['chairSeat', 'handle'] },
    legext: { a: P({ t: -5, ua: 10, fa: 30, th: 90, sh: 0 }), b: P({ t: -5, ua: 10, fa: 30, th: 90, sh: 85 }), fix: ['H', 48, 62], props: ['chairSeat'] },
    legcurl: { a: P({ t: 90, ua: 95, fa: 95, th: -90, sh: -90 }), b: P({ t: 90, ua: 95, fa: 95, th: -90, sh: -175 }), fix: ['H', 55, 70], props: ['bench'] },
  });

  function points(p) {
    const H = [0, 0], up = [Math.sin(rad(p.t)), -Math.cos(rad(p.t))];
    const S = [up[0] * L.torso, up[1] * L.torso];
    const Hd = [S[0] + up[0] * L.neck, S[1] + up[1] * L.neck];
    if (p.front) { // вид спереди: руки и ноги симметрично
      const arm = (sx) => { const S1 = [sx * 7, S[1]]; const E = [S1[0] + sx * Math.sin(rad(p.ua)) * L.ua, S1[1] + Math.cos(rad(p.ua)) * L.ua];
        return [S1, E, [E[0] + sx * Math.sin(rad(p.fa)) * L.fa, E[1] + Math.cos(rad(p.fa)) * L.fa]]; };
      const leg = (sx) => { const H1 = [sx * 4, 0]; const K = [H1[0] + sx * Math.sin(rad(p.th)) * L.th, Math.cos(rad(p.th)) * L.th];
        const A2 = [K[0] + sx * Math.sin(rad(p.sh)) * L.sh, K[1] + Math.cos(rad(p.sh)) * L.sh]; return [H1, K, A2, [A2[0] + sx * 4, A2[1]]]; };
      const [S1, E1, W1] = arm(-1), [S2, E2, W2] = arm(1), [H1, K1, A1, T1] = leg(-1), [H2, K2, A2, T2] = leg(1);
      return { front: 1, H, S, Hd, S1, S2, E: E1, W: W1, E2, W2, H1, H2, K: K1, A: A1, T: T1, K2, A2, T2 };
    }
    const E = add(S, v(p.ua, L.ua)), W = add(E, v(p.fa, L.fa));
    const E2 = add(S, v(p.ua2 ?? p.ua, L.ua)), W2 = add(E2, v(p.fa2 ?? p.fa, L.fa));
    const K = add(H, v(p.th, L.th)), Ak = add(K, v(p.sh, L.sh)), T = add(Ak, v(p.sh + 90, L.foot));
    const K2 = add(H, v(p.th2 ?? p.th, L.th)), A2 = add(K2, v(p.sh2 ?? p.sh, L.sh)), T2 = add(A2, v((p.sh2 ?? p.sh) + 90, L.foot));
    return { H, S, Hd, E, W, E2, W2, K, A: Ak, T, K2, A2, T2 };
  }
  const lerp = (a, b, k) => { const o = {}; for (const key in b) o[key] = typeof b[key] === 'number' ? (a[key] ?? 0) + (b[key] - (a[key] ?? 0)) * k : b[key]; return o; };

  function frame(anim, k) {
    const p = lerp(anim.a, anim.b, k);
    const pts = points(p);
    const [fp, fx, fy] = anim.fix;
    const ref = pts[fp]; const dx = fx - ref[0], dy = fy - ref[1] - (p.lift || 0) * (fp === 'A' ? 1 : 0);
    for (const key in pts) if (Array.isArray(pts[key])) pts[key] = [pts[key][0] + dx, pts[key][1] + dy];
    if (p.lift) { pts.T = [pts.T[0], pts.T[1] + p.lift]; pts.T2 = [pts.T2[0], pts.T2[1] + p.lift]; } // носки на месте, пятки вверх
    return pts;
  }
  const f = n => n.toFixed(1);
  const line = (...ps) => 'M' + ps.map(p => f(p[0]) + ' ' + f(p[1])).join('L');

  function draw(svg, anim, k, gear) {
    const P = frame(anim, k);
    const g = (id, d) => { const el = svg.querySelector('#' + id); if (el) el.setAttribute('d', d); };
    if (P.front) {
      g('far', '');
      g('near', line(P.Hd, P.S) + line(P.S1, P.S2) + line(P.S, P.H) + line(P.H1, P.H2) + line(P.S1, P.E, P.W) + line(P.H1, P.K, P.A, P.T)
        + line(P.S2, P.E2, P.W2) + line(P.H2, P.K2, P.A2, P.T2));
    } else {
      g('far', line(P.S, P.E2, P.W2) + line(P.H, P.K2, P.A2, P.T2));
      g('near', line(P.Hd, P.S, P.H) + line(P.S, P.E, P.W) + line(P.H, P.K, P.A, P.T));
    }
    const head = svg.querySelector('#head'); head.setAttribute('cx', f(P.Hd[0] + (P.front ? 0 : 0))); head.setAttribute('cy', f(P.Hd[1] - 4));
    // снаряд в руке
    const gearEl = svg.querySelector('#gear');
    const hands = P.front ? [P.W, P.W2] : [P.W];
    let gd = '';
    if (gear === 'db') hands.forEach(w => { gd += line([w[0] - 5, w[1]], [w[0] + 5, w[1]]) + `M${f(w[0] - 5)} ${f(w[1] - 3)}v6M${f(w[0] + 5)} ${f(w[1] - 3)}v6`; });
    if (gear === 'bb') { const w = P.W; gd += `M${f(w[0])} ${f(w[1] - 7)}a7 7 0 1 0 0.01 0`; }
    if (gear === 'kb') { const w = P.W; gd += `M${f(w[0] - 4)} ${f(w[1] + 2)}a5 5 0 1 0 8 0Z`; }
    if ((anim.props || []).includes('handle')) gd += line([P.W[0] - 7, P.W[1]], [P.W[0] + 7, P.W[1]]);
    gearEl.setAttribute('d', gd);
  }

  function staticProps(anim) {
    const P0 = frame(anim, 0), pr = anim.props || [];
    let d = 'M8 94 Q40 93.4 64 94.2 T116 93.6'; // пол, чуть неровный — нарисовано от руки
    if (pr.includes('bar')) d += 'M22 16 L98 16';
    if (pr.includes('bars')) d += `M${f(P0.W[0] - 12)} 46 L${f(P0.W[0] + 12)} 46M${f(P0.W[0] - 10)} 46 V94`;
    if (pr.includes('chairFeet')) d += `M${f(P0.A[0] - 14)} 73 H${f(P0.A[0] + 8)} M${f(P0.A[0] - 12)} 73 V94 M${f(P0.A[0] + 6)} 73 V94`;
    if (pr.includes('chairHands')) d += `M${f(P0.W[0] - 16)} 63 H${f(P0.W[0] + 4)} M${f(P0.W[0] - 14)} 63 V94 M${f(P0.W[0] + 2)} 63 V94`;
    if (pr.includes('chairSeat') || pr.includes('seat')) d += `M${f(P0.H[0] - 10)} ${f(P0.H[1] + 2)} H${f(P0.H[0] + 10)} M${f(P0.H[0] - 8)} ${f(P0.H[1] + 2)} V94 M${f(P0.H[0] + 8)} ${f(P0.H[1] + 2)} V94`;
    if (pr.includes('bench')) d += `M${f(P0.H[0] - 12)} ${f(P0.H[1] + 3)} H${f(P0.H[0] + 40)} M${f(P0.H[0] - 6)} ${f(P0.H[1] + 3)} V94 M${f(P0.H[0] + 34)} ${f(P0.H[1] + 3)} V94`;
    if (pr.includes('benchHand')) d += `M${f(P0.W2[0] - 10)} ${f(P0.W2[1] + 1)} H${f(P0.W2[0] + 14)} M${f(P0.W2[0] - 8)} ${f(P0.W2[1] + 1)} V94 M${f(P0.W2[0] + 12)} ${f(P0.W2[1] + 1)} V94`;
    if (pr.includes('box')) d += `M${f(P0.A[0] - 12)} 77 H${f(P0.A[0] + 12)} V94 M${f(P0.A[0] - 12)} 77 V94`;
    if (pr.includes('step')) d += `M${f(P0.A[0] - 6)} 92 H${f(P0.A[0] + 14)}`;
    return d;
  }

  let raf = 0;
  window.Figure = {
    has: id => !!MAP[id],
    // Вставляет человечка в el и запускает анимацию (одна активная на экране).
    mount(el, exId, gear) {
      cancelAnimationFrame(raf);
      const anim = A[MAP[exId]]; if (!anim || !el) { if (el) el.innerHTML = ''; return; }
      el.innerHTML = `<svg viewBox="0 0 120 100" class="fig" aria-hidden="true">
        <path class="props" d="${staticProps(anim)}"/>
        <path id="far" class="limb far"/><path id="near" class="limb"/><path id="gear" class="gear"/>
        <circle id="head" r="5.2" class="headc"/></svg>`;
      const svg = el.querySelector('svg'), t0 = performance.now(), period = 2600;
      const tick = now => {
        if (!document.body.contains(svg)) return;
        const ph = ((now - t0) % period) / period; // 0→1→0 с паузами на концах
        const k = ph < 0.1 ? 0 : ph < 0.45 ? (1 - Math.cos((ph - 0.1) / 0.35 * Math.PI)) / 2 : ph < 0.55 ? 1 : ph < 0.9 ? (1 + Math.cos((ph - 0.55) / 0.35 * Math.PI)) / 2 : 0;
        draw(svg, anim, k, gear);
        raf = requestAnimationFrame(tick);
      };
      draw(svg, anim, 0, gear);
      if (!window.matchMedia || !matchMedia('(prefers-reduced-motion: reduce)').matches) raf = requestAnimationFrame(tick);
    },
    stop() { cancelAnimationFrame(raf); },
    _draw(svg, exId, k, gear) { if (svg && A[MAP[exId]]) draw(svg, A[MAP[exId]], k, gear); }, // для проверки кадров
  };
})();
