'use strict';
/* Тренер в Телеграме: анкета → нормы и программа под человека; тренировки, план, еда, прогресс, профиль.
   Всё хранится навсегда в облаке Телеграма (CloudStorage) — у каждого пользователя своё. Вне Телеграма — в браузере. */

const tg = window.Telegram && window.Telegram.WebApp;
const inTG = !!(tg && tg.initData);
if (tg) {
  tg.ready(); tg.expand();
  try { if (tg.isVersionAtLeast('7.7')) tg.disableVerticalSwipes(); } catch (e) {}
}

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = k => { const d = fromKey(k); return `${d.getDate()}.${pad(d.getMonth() + 1)}`; };
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const WDF = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const WEEK = [1, 2, 3, 4, 5, 6, 0]; // порядок с понедельника
const r1 = x => Math.round(x * 10) / 10;
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const plural = (n, a, b, c) => { const m = n % 10, mm = n % 100; return m === 1 && mm !== 11 ? a : m >= 2 && m <= 4 && (mm < 12 || mm > 14) ? b : c; };
const haptic = (t = 'light') => { try { tg.HapticFeedback.impactOccurred(t); } catch (e) {} };
const notify = (t = 'success') => { try { tg.HapticFeedback.notificationOccurred(t); } catch (e) {} };
const openLink = url => { if (inTG) tg.openLink(url); else window.open(url, '_blank', 'noopener'); };
const ask = (text, cb) => { if (inTG && tg.showConfirm) tg.showConfirm(text, ok => ok && cb()); else if (confirm(text)) cb(); };

// Кнопка «Назад» Телеграма: всегда закрывает то, что открыто сверху (а не весь бот).
let backFn = null;
function setBack(fn) {
  if (!tg) return;
  if (backFn) tg.BackButton.offClick(backFn);
  backFn = fn;
  if (fn) { tg.BackButton.onClick(fn); tg.BackButton.show(); } else tg.BackButton.hide();
}

/* ---------- хранилище ---------- */
const useCloud = inTG && tg.isVersionAtLeast && tg.isVersionAtLeast('6.9') && tg.CloudStorage;
const LS = 'fb_';
const lsGet = k => { try { const v = localStorage.getItem(LS + k); return v ? JSON.parse(v) : null; } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} };
const Store = {
  get(k) {
    const local = lsGet(k);
    if (!useCloud) return Promise.resolve(local);
    return new Promise(res => tg.CloudStorage.getItem(k, (err, v) => {
      if (err || !v) return res(local);
      try { const o = JSON.parse(v); lsSet(k, o); res(o); } catch (e) { res(local); }
    }));
  },
  set(k, v) {
    lsSet(k, v);
    if (!useCloud) return;
    let s = JSON.stringify(v);
    if (s.length > 4000 && v && v.items) { // еда за день не влезает в 4 КБ — укорачиваем названия
      v = { ...v, items: v.items.map(x => ({ ...x, n: String(x.n).slice(0, 18) })) }; s = JSON.stringify(v);
    }
    tg.CloudStorage.setItem(k, s.slice(0, 4096), () => {});
  },
  keys(prefix) {
    if (!useCloud) {
      const out = [];
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(LS + prefix)) out.push(k.slice(LS.length)); } } catch (e) {}
      return Promise.resolve(out);
    }
    return new Promise(res => tg.CloudStorage.getKeys((err, ks) => res(err ? [] : ks.filter(k => k.startsWith(prefix)))));
  },
  async getMany(keys) {
    const o = {};
    if (!useCloud) { keys.forEach(k => o[k] = lsGet(k)); return o; }
    for (let i = 0; i < keys.length; i += 50) {
      await new Promise(res => tg.CloudStorage.getItems(keys.slice(i, i + 50), (err, vals) => {
        if (!err) for (const k in vals) { try { o[k] = JSON.parse(vals[k]); } catch (e) {} }
        res();
      }));
    }
    return o;
  },
};

/* ---------- состояние ---------- */
const S = {
  tab: 'today', today: dateKey(),
  profile: null, program: null, history: {}, workout: null,
  food: null, weights: [], meas: [], ach: [],
  anyway: false, choosing: false, showExtra: false, parsed: null, scanned: null, meal: null,
};

async function load() {
  const [profile, program, f, weights, meas, rec, ach, fav] = await Promise.all(
    ['profile', 'program', 'f_' + S.today, 'weights', 'meas', 'recent', 'ach', 'fav'].map(k => Store.get(k)));
  S.profile = profile; S.program = program; applyTheme();
  if (S.program && (S.program.v || 0) < 4) { S.program.adj = S.program.adj || {}; S.program.v = 4; renameAll(); Store.set('program', S.program); } // старая версия плана
  S.food = f || { date: S.today, items: [], water: 0 };
  S.weights = weights || []; S.meas = meas || []; S.ach = ach || [];
  if (rec) lsSet('recent', rec);
  if (fav) lsSet('fav', fav);
  const keys = await Store.keys('w_');
  const all = await Store.getMany(keys);
  for (const k in all) if (all[k] && all[k].date) S.history[all[k].date] = all[k];
  S.workout = S.history[S.today] || { date: S.today, wid: null, sets: {}, finished: false };
  S.history[S.today] = S.workout;
  if (!S.profile || !S.program) return startOnboarding();
  render();
  checkShared();
}
const saveWorkout = () => { if (S.program && isTrained(S.workout)) S.workout.pct = Math.round(completion({ ...S.workout, pct: null }) * 100) / 100; Store.set('w_' + S.today, S.workout); };
const saveFood = () => Store.set('f_' + S.today, S.food);

// Открыли приложение после полуночи — начинаем новый день.
document.addEventListener('visibilitychange', () => { if (!document.hidden && dateKey() !== S.today) location.reload(); });

/* ---------- нормы по анкете ---------- */
const curWeight = () => (S.weights.length ? S.weights[S.weights.length - 1].w : S.profile.weight);
// Нормы: свои цифры человека важнее формулы. Знает % жира — точнее формула Кетча — МакАрдла (по сухой массе).
// Если спорт прибавляется к еде (по умолчанию), в базовой норме тренировки не учитываем — иначе посчитаем дважды.
const sportToFood = (p = S.profile) => p.sportToFood !== false;
function norms(p = S.profile, w = null) {
  w = w || (p === S.profile ? curWeight() : p.weight);
  const bf = +p.bodyFat;
  const bmr = bf >= 3 && bf <= 60 ? 370 + 21.6 * w * (1 - bf / 100) : 10 * w + 6.25 * p.height - 5 * p.age + (p.sex === 'm' ? 5 : -161);
  const act = { low: 1.35, mid: 1.5, high: 1.7 }[p.activity] + (sportToFood(p) ? 0 : Math.min(5, p.days.length) * 0.025);
  const tdee = bmr * act;
  const mult = { gain: 1.12, lose: 0.82, fit: 1, strength: 1.05 }[p.goal];
  const c = p.custom || {};
  const kcal = c.kcal || Math.round(Math.max(bmr * 1.1, tdee * mult) / 50) * 50;
  const protein = c.protein || Math.round(w * { gain: 1.8, strength: 1.8, lose: 2.0, fit: 1.6 }[p.goal] / 5) * 5;
  const waterMl = Math.round((w * 33 + 300) / 50) * 50; // 33 мл на кг + запас на тренировки
  const water = r1(waterMl / 1000); // литры
  const fat = c.fat || Math.round(w * (p.goal === 'lose' ? 0.8 : 0.9));
  const carbs = c.carbs || Math.max(50, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), kcal, protein, fat, carbs, water, waterMl, own: !!(c.kcal || c.protein || c.fat || c.carbs), katch: bf >= 3 && bf <= 60 };
}

/* ---------- активность за день → прибавка к еде ---------- */
// Чистый расход сверх покоя: (MET − 1) × 3,5 × вес / 200 ккал в минуту (Compendium 2024). Покой уже сидит в базовой норме.
const ACTS = {
  run: { n: 'Бег', met: 9.0 }, bike: { n: 'Велосипед', met: 6.8 }, gym: { n: 'Силовая (без приложения)', met: 5.0 },
  walk: { n: 'Быстрая ходьба', met: 4.3 }, swim: { n: 'Плавание', met: 6.0 }, ball: { n: 'Футбол, игры', met: 7.0 },
  yoga: { n: 'Йога, растяжка', met: 2.5 }, house: { n: 'Дела по дому', met: 3.3 },
  ellip: { n: 'Эллипс', met: 5.0 }, vbike: { n: 'Велотренажёр', met: 6.8 }, rower: { n: 'Гребной тренажёр', met: 7.0 },
  stairs: { n: 'Степпер, лестница', met: 9.0 }, incline: { n: 'Дорожка в горку', met: 6.0 }, box: { n: 'Бокс, единоборства', met: 7.8 },
};
const STEP_BASE = { low: 4000, mid: 7000, high: 10000 }; // столько шагов уже заложено в «обычный день» анкеты
const actKcal = (t, min) => Math.round((ACTS[t].met - 1) * 3.5 * curWeight() / 200 * min);
function stepsKcal(steps) {
  const extra = Math.max(0, steps - STEP_BASE[S.profile.activity]);
  const strideKm = (S.profile.height || 175) * 0.415 / 100000;
  return { extra, k: Math.round(extra * strideKm * 0.5 * curWeight()) }; // ходьба ≈ 0,5 ккал на кг на км сверх покоя
}
function trainKcal() { return Math.round(Object.entries(S.workout.sets || {}).reduce((s, [id, v]) => s + (LIB[id] ? kcalOf(id, v.filter(x => x != null)) : 0), 0)); }
function dayActivity() {
  const tr = trainKcal(), st = stepsKcal(S.food.steps || 0);
  const acts = (S.food.act || []).map(a => ({ ...a, k: ACTS[a.t] ? actKcal(a.t, a.min) : 0 }));
  const total = tr + st.k + acts.reduce((s, a) => s + a.k, 0);
  const share = S.profile.goal === 'lose' ? 0.5 : 1; // при похудении возвращаем в еду половину — запас на неточность
  return { tr, steps: S.food.steps || 0, st, acts, total, share, bonus: sportToFood() ? Math.round(total * share / 10) * 10 : 0 };
}
// Влад, 10.11: «норма + спорт» сбивает с толку. Норма стоит на месте, сожжённое вычитается из съеденного:
// съедено 900 − спорт 440 = 460 из 2600.
function todayNorms() { return { ...norms(), A: dayActivity() }; }
const eatenNet = (k, A) => Math.max(0, k - A.bonus);
const GOAL_NAMES = { gain: 'Набрать мышцы', lose: 'Похудеть', fit: 'Быть в форме', strength: 'Стать сильнее' };
const ACT_NAMES = { low: 'Сидячая (учёба, офис)', mid: 'Средняя (хожу пешком, бываю на ногах)', high: 'Высокая (физическая работа, много движения)' };

/* ---------- сборка программы ---------- */
function availableEq(p) { return p.place === 'home' ? p.equip : PLACES[p.place].eq; }
function levelOf(p) { return p.pushups < 10 && p.pullups < 1 ? 1 : p.pushups >= 25 && p.pullups >= 8 ? 3 : 2; }
function fits(ex, p) {
  const eq = availableEq(p), lvl = levelOf(p);
  return ex.eq.every(e => eq.includes(e)) && ex.lvl <= lvl && !(ex.avoid || []).some(l => p.limits.includes(l))
    && (!ex.needPull || p.pullups >= ex.needPull) && (!ex.maxPush || p.pushups <= ex.maxPush);
}
// Чем выше балл, тем лучше упражнение под человека: инвентарь важнее, новичку в зале — тренажёры (безопаснее),
// облегчённые отжимания — только когда инвентаря нет.
const scoreEx = (e, p) => e.eq.length * 2 + (e.lvl === levelOf(p) ? 1 : 0) + (e.needPull ? 2 : 0)
  + (e.maxPush && !availableEq(p).length ? 3 : 0) + (e.eq.includes('gym') && levelOf(p) === 1 ? 3 : 0) - (e.iso ? 3 : 0) - (e.alt ? 2 : 0); // alt — вариации для замены, не основа плана
function candidates(pat, p) {
  return Object.keys(LIB).filter(id => LIB[id].pat === pat && fits(LIB[id], p)).sort((a, b) => scoreEx(LIB[b], p) - scoreEx(LIB[a], p));
}
function buildProgram(p) {
  const days = WEEK.filter(d => p.days.includes(d));
  const split = SPLITS[days.length] || SPLITS[3];
  const perTime = { 30: 5, 45: 7, 60: 9 }[p.minutes] || 7;
  const use = {};
  const workouts = split.map((t, i) => {
    let slots = t.slots.slice();
    const pr = (p.priority || []).map(k => PRIORITY[k].pat);
    slots.splice(Math.min(3, slots.length), 0, ...pr); // приоритетные — в начало, чтобы не отрезались по времени
    const chosen = [];
    for (const pat of slots) {
      const c = candidates(pat, p).filter(id => !chosen.includes(id));
      if (!c.length) continue;
      const best = scoreEx(LIB[c[0]], p);
      const tol = ISO.includes(pat) ? 3 : 1; // в мелких упражнениях — больше разнообразия
      const top = c.filter(x => scoreEx(LIB[x], p) >= best - tol).slice(0, ISO.includes(pat) ? 3 : 2); // чередуем только лучшие варианты под инвентарь
      const id = top[(use[pat] = (use[pat] || 0)) % top.length]; use[pat]++;
      chosen.push(id);
    }
    const list = ['warmup', ...chosen.slice(0, perTime), 'stretch'];
    return { id: 't' + (i + 1), name: focusOf(list), weekday: days[i], list, extra: chosen.slice(perTime, perTime + 3) };
  });
  return { v: 4, created: S.today, workouts, adj: {} };
}
const W = id => S.program.workouts.find(w => w.id === id);
// Пересборка плана по анкете не трогает свои тренировки человека.
const keepCustom = prog => { if (S.program) prog.workouts.push(...S.program.workouts.filter(w => w.custom)); return prog; };
const dayLabel = w => w.weekday == null ? 'любой день' : WD[w.weekday];
// Своя тренировка с назначенным днём важнее обычной на этот день.
const plannedFor = d => S.program.workouts.filter(w => w.weekday === d.getDay() && w.list.some(id => LIB[id] && !['warmup', 'stretch'].includes(id))).sort((a, b) => (b.custom ? 1 : 0) - (a.custom ? 1 : 0))[0] || null;

/* ---------- история и статистика ---------- */
const doneVals = (w, id) => ((w.sets || {})[id] || []).filter(v => v != null);
const isTrained = w => w && Object.values(w.sets || {}).some(a => a.some(v => v != null));
const trainedDates = () => Object.keys(S.history).filter(d => isTrained(S.history[d])).sort();
// Насколько тренировка сделана: доля выполненных подходов основных упражнений (без разминки и растяжки), 0…1.
// Сохраняется в записи дня (pct), чтобы не зависеть от будущих правок плана; у старых записей считаем по плану.
const MAIN = list => list.filter(id => LIB[id] && !['warmup', 'stretch'].includes(id));
function completion(w) {
  if (!isTrained(w)) return 0;
  if (w.pct != null && w.date !== S.today) return w.pct;
  const pw = w.wid && S.program && W(w.wid);
  const list = pw ? MAIN(pw.list) : MAIN(Object.keys(w.sets || {}));
  if (!list.length) return 1;
  return Math.min(1, list.reduce((s, id) => s + Math.min(1, doneVals(w, id).length / setsOf(E(id))), 0) / list.length);
}
const isFull = w => completion(w) >= 0.85; // 85 % подходов и больше — полная
const fullDates = () => trainedDates().filter(d => isFull(S.history[d]));
function exStats(id) {
  let sessions = 0, total = 0, best = 0, last = null, bestKg = 0;
  for (const d of Object.keys(S.history).sort()) {
    const w = S.history[d], v = doneVals(w, id);
    if (!v.length) continue;
    const kg = ((w.kg || {})[id] || []).filter((x, i) => x != null && w.sets[id][i] != null);
    sessions++; total += v.reduce((a, b) => a + b, 0); best = Math.max(best, ...v);
    if (kg.length) bestKg = Math.max(bestKg, ...kg);
    if (d !== S.today) last = { date: d, vals: v, kg: kg.length ? kg : null };
  }
  return { sessions, total, best, last, bestKg };
}
function nextInOrder() {
  const ds = trainedDates().filter(d => d !== S.today);
  const lastW = ds.length ? S.history[ds[ds.length - 1]].wid : null;
  const ws = S.program.workouts.filter(w => !w.custom), i = ws.findIndex(w => w.id === lastW);
  return ws[(i + 1) % ws.length];
}
const unit = e => e.type === 'time' ? ' с' : '';
const range = e => e.lo === e.hi ? e.lo + unit(e) : `${e.lo}–${e.hi}${unit(e)}`;
const setsOf = e => e.sets || 3;

/* ---------- тренерская логика (см. «Методика тренера (09.11).md») ---------- */
const ISO = ['biceps', 'triceps', 'grip', 'calves', 'delts', 'glute', 'core', 'rear', 'traps'];
const weekNo = () => Math.max(0, Math.floor((fromKey(S.today) - fromKey((S.program && S.program.created) || S.today)) / 864e5 / 7));
const isDeload = () => weekNo() % 8 === 7; // каждая 8-я неделя — разгрузочная
// Упражнение с поправками: цель, уровень, разгрузка и личная подстройка («слишком тяжело»).
function E(id) {
  const e = LIB[id]; if (!e) return null;
  const p = S.profile || {}, g = p.goal, adj = (S.program && S.program.adj && S.program.adj[id]) || null;
  let { lo, hi, rest } = e, sets = e.sets || 3;
  const service = ['warmup', 'stretch'].includes(e.pat);
  if (!service) {
    if (e.type === 'reps') {
      if (g === 'strength' && e.eq.length) { lo = Math.max(3, Math.round(lo * 0.6)); hi = Math.max(lo + 2, Math.round(hi * 0.65)); rest = Math.round(rest * 1.5); }
      if (g === 'lose') { lo = Math.round(lo * 1.2); hi = Math.round(hi * 1.25); }
    }
    if (g === 'lose') rest = Math.round(rest * 0.65);
    if (g === 'fit') rest = Math.round(rest * 0.8);
    if (p.pushups !== undefined && levelOf(p) === 1 && ISO.includes(e.pat)) sets = 2;
    if (p.sets) sets = p.sets; // человек сам выбрал: «я делаю 4 подхода»
    const own = S.program && S.program.nsets && S.program.nsets[id];
    if (own) sets = own; // своё число у конкретного упражнения
    else if (isDeload()) sets = Math.max(1, sets - 1);
    if (adj) { lo = adj.lo; hi = adj.hi; }
  }
  return { ...e, id, lo, hi, rest, sets };
}
// Лестницы прогрессий: легче ← упражнение → сложнее.
const LADDER = [['hang', 'neg', 'bandPullup', 'pullup'], ['pushupKnee', 'pushup', 'pushupFeet'], ['chairDips', 'dips'],
  ['squat', 'bulgarian'], ['crunch', 'lyingRaise', 'legRaise'], ['superman', 'towelPull'], ['tableRow', 'invRow'], ['bridge', 'slRdl'],
  ['lunge', 'bulgarian'], ['plank', 'sidePlank'], ['diamond', 'pushupFeet']];
function ladderStep(id, dir) {
  for (const l of LADDER) { const i = l.indexOf(id); if (i < 0) continue;
    for (let j = i + dir; j >= 0 && j < l.length; j += dir) if (fits(LIB[l[j]], { ...S.profile, pullups: 99, pushups: dir < 0 ? 0 : 99 }) && LIB[l[j]].eq.every(x => availableEq(S.profile).includes(x))) return l[j]; }
  return null;
}
function replaceEverywhere(from, to) {
  const swap = arr => arr.includes(to) ? arr.filter(x => x !== from) : arr.map(x => x === from ? to : x); // без дублей
  S.program.workouts.forEach(w => { w.list = swap(w.list); w.extra = swap(w.extra || []).filter(x => !w.list.includes(x)); });
  renameAll(); saveProgram();
}
// Название тренировки — по мышцам, которые реально в ней работают.
const GROUPS = { 'спина': 'спина', 'поясница': 'спина', 'ноги': 'ноги', 'ягодицы': 'ягодицы', 'грудь': 'грудь', 'плечи': 'плечи', 'бицепс': 'руки', 'трицепс': 'руки',
  'предплечья': 'предплечья', 'хват': 'предплечья', 'пальцы': 'предплечья', 'пресс': 'пресс', 'косые мышцы': 'пресс', 'задняя поверхность': 'задняя поверхность', 'икры': 'ноги', 'задняя дельта': 'плечи', 'трапеции': 'спина' };
function focusOf(list) {
  const cnt = {};
  list.filter(id => LIB[id] && !['warmup', 'stretch'].includes(id)).forEach(id => {
    LIB[id].mus.split(', ').forEach((m, j) => { const g = GROUPS[m] || m; cnt[g] = (cnt[g] || 0) + (j ? 0.3 : 1); });
  });
  const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
  const s = top.join(', ') || 'тренировка';
  return s[0].toUpperCase() + s.slice(1);
}
function renameAll() { if (S.program) S.program.workouts.forEach(w => { w.name = w.custom && w.cname ? w.cname : focusOf(w.list); }); }
// Расход калорий по MET (Compendium 2024): ккал/мин = MET × 3,5 × вес / 200.
function metOf(e) {
  if (e.pat === 'stretch') return 2.3; if (e.pat === 'warmup') return 3.5;
  if (['core'].includes(e.pat)) return 2.8;
  if (['squat', 'hinge', 'lunge'].includes(e.pat) && e.eq.some(x => ['bb', 'db', 'kb'].includes(x))) return 5.0;
  if (e.eq.some(x => ['bb', 'db', 'kb', 'gym', 'band'].includes(x))) return 3.5;
  return ISO.includes(e.pat) ? 2.8 : 3.8;
}
function kcalOf(id, doneVals) {
  const e = E(id); if (!e) return 0;
  const w = curWeight(), perMin = met => (met - 1) * 3.5 * w / 200; // чистый расход сверх покоя (покой уже в базовой норме)
  const vals = doneVals || Array(e.sets).fill(Math.round((e.lo + e.hi) / 2));
  const work = vals.reduce((s, v) => s + (e.type === 'time' ? v : v * 3.2 * (e.side ? 2 : 1)), 0) / 60;
  const rest = Math.max(0, vals.length - 1) * e.rest / 60;
  return (work + rest) * perMin(metOf(e)); // MET из Compendium дан на всю тренировку вместе с паузами
}
const workoutKcal = list => Math.round(list.reduce((s, id) => s + kcalOf(id), 0));
const workoutMin = list => Math.round(list.reduce((s, id) => { const e = E(id); if (!e) return s;
  const work = e.sets * (e.type === 'time' ? (e.lo + e.hi) / 2 : (e.lo + e.hi) / 2 * 3.2 * (e.side ? 2 : 1)); return s + (work + (e.sets - 1) * e.rest) / 60 + 1; }, 0));

/* ---------- раскрывающиеся секции: помнят, открыты или закрыты ---------- */
const secState = () => lsGet('sec') || {};
function sec(id, title, right, body, defOpen) {
  const st = secState(), open = st[id] ?? defOpen;
  return `<details class="sec" data-sec="${id}" ${open ? 'open' : ''}><summary><span class="st">${title}</span>${right ? `<span class="sr">${right}</span>` : ''}</summary><div class="sb">${body}</div></details>`;
}
document.addEventListener('toggle', ev => { const d = ev.target; if (d && d.dataset && d.dataset.sec) { const st = secState(); st[d.dataset.sec] = d.open; lsSet('sec', st); } }, true);

/* ---------- вкладки ---------- */
$$('.tabs button').forEach(b => b.onclick = () => {
  S.tab = b.dataset.tab; S.choosing = false;
  $$('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  haptic(); render(); scrollTo(0, 0);
});
function render() {
  document.body.classList.remove('onb');
  ({ today: renderToday, plan: renderPlan, food: renderFood, progress: renderProgress, profile: renderProfile })[S.tab]();
}

/* =================== АНКЕТА =================== */
let D = null, step = 0;
function startOnboarding(edit = false) {
  const u = inTG && tg.initDataUnsafe && tg.initDataUnsafe.user;
  D = edit && S.profile ? JSON.parse(JSON.stringify(S.profile)) : {
    name: (u && u.first_name) || '', sex: 'm', age: '', height: '', weight: '', goal: 'gain', target: '',
    activity: 'low', place: 'home', equip: [], pushups: '', pullups: '', days: [1, 3, 5], minutes: 45, priority: [], limits: [],
  };
  D._edit = edit; step = 0;
  document.body.classList.add('onb');
  drawStep();
}
const STEPS = [
  () => `<h1>Привет!</h1><p class="sub">Я соберу тебе программу тренировок, посчитаю калории, белок и воду. Пара минут вопросов — и поехали.</p>
    <label class="fld">Как тебя зовут?<input id="q_name" value="${esc(D.name)}" placeholder="Имя"></label>`,
  () => `<h1>О тебе</h1><p class="sub">Нужно для расчёта калорий. Никому не передаётся.</p>
    <div class="pick2">${opt('sex', 'm', 'Мужчина')}${opt('sex', 'f', 'Женщина')}</div>
    <div class="grid3"><label class="fld">Возраст<input id="q_age" type="number" inputmode="numeric" value="${esc(D.age)}" placeholder="20"></label>
    <label class="fld">Рост, см<input id="q_height" type="number" inputmode="numeric" value="${esc(D.height)}" placeholder="180"></label>
    <label class="fld">Вес, кг<input id="q_weight" type="text" inputmode="decimal" value="${esc(D.weight)}" placeholder="70"></label></div>`,
  () => `<h1>Цель</h1><p class="sub">От неё зависят калории и как строится нагрузка.</p>
    <div class="cards">${Object.entries(GOAL_NAMES).map(([k, n]) => card('goal', k, n, { gain: 'Больше мышц, вес растёт медленно', lose: 'Меньше жира, мышцы сохраняем', fit: 'Стройность и здоровье, вес держим', strength: 'Больше повторов и рабочего веса' }[k])).join('')}</div>
    <label class="fld">Желаемый вес, кг (можно пропустить)<input id="q_target" type="text" inputmode="decimal" value="${esc(D.target)}" placeholder="—"></label>`,
  () => `<h1>Обычный день</h1><p class="sub">Сколько двигаешься без тренировок?</p>
    <div class="cards">${Object.entries(ACT_NAMES).map(([k, n]) => card('activity', k, n.split(' (')[0], cap(n.split(' (')[1].replace(')', '')))).join('')}</div>`,
  () => `<h1>Где тренируешься?</h1><p class="sub">Программа соберётся под то, что у тебя есть.</p>
    <div class="cards">${Object.entries(PLACES).map(([k, p]) => card('place', k, p.name, p.hint)).join('')}</div>
    ${D.place === 'home' ? `<h3>Что есть дома?</h3><div class="chips">${Object.entries(EQUIP).filter(([k]) => k !== 'gym').map(([k, n]) => chip('equip', k, n)).join('')}</div><p class="muted">Ничего не отметишь — будут упражнения без инвентаря. Стул и пол есть у всех.</p>` : ''}`,
  () => `<h1>Твой уровень</h1><p class="sub">Честно, сколько получится сейчас за один подход? От этого зависит, с каких упражнений начать.</p>
    <div class="grid2"><label class="fld">Отжиманий<input id="q_pushups" type="number" inputmode="numeric" value="${esc(D.pushups)}" placeholder="0"></label>
    <label class="fld">Подтягиваний<input id="q_pullups" type="number" inputmode="numeric" value="${esc(D.pullups)}" placeholder="0"></label></div>
    <p class="muted">0 — нормально. Начнём с облегчённых вариантов.</p>`,
  () => `<h1>Когда тренируешься?</h1><p class="sub">Выбери дни. Новичкам лучше 3 дня через день.</p>
    <div class="chips week">${WEEK.map(d => `<button class="chip ${D.days.includes(d) ? 'on' : ''}" data-day="${d}">${WD[d]}</button>`).join('')}</div>
    <h3>Сколько времени на тренировку?</h3><div class="pick3">${[30, 45, 60].map(m => opt('minutes', m, m + ' мин')).join('')}</div>`,
  () => `<h1>Акценты</h1><p class="sub">Что хочешь подтянуть в первую очередь? Можно несколько или ничего.</p>
    <div class="chips">${Object.entries(PRIORITY).map(([k, p]) => chip('priority', k, p.name)).join('')}</div>
    <h3>Что-то болит или травмировано?</h3><p class="muted">Такие упражнения не попадут в план. Если сильно болит — сначала к врачу.</p>
    <div class="chips">${Object.entries(LIMITS).map(([k, n]) => chip('limits', k, n)).join('')}</div>`,
  () => {
    const n = norms(D), prog = buildProgram(D);
    return `<h1>Готово${D.name ? ', ' + esc(D.name) : ''}!</h1><p class="sub">Вот что получилось. Всё можно поменять потом.</p>
      <div class="stats"><div><b>${n.kcal}</b><span>ккал в день</span></div><div><b>${n.protein} г</b><span>белка</span></div><div><b>${n.water} л</b><span>воды</span></div></div>
      <p class="muted">Базовый обмен ${n.bmr} ккал (формула Миффлина — Сан-Жеора) × активность = ${n.tdee} ккал. Цель «${GOAL_NAMES[D.goal].toLowerCase()}» → ${n.kcal} ккал.</p>
      <h3>Программа: ${prog.workouts.length} ${plural(prog.workouts.length, 'тренировка', 'тренировки', 'тренировок')} в неделю</h3>
      ${prog.workouts.map(w => `<div class="wcard"><b>${WD[w.weekday]} · ${esc(w.name)}</b><span>${w.list.filter(id => !['warmup', 'stretch'].includes(id)).map(id => esc(LIB[id].name)).join(', ')}</span></div>`).join('')}
      ${D._edit ? '<p class="muted">Программа соберётся заново. История тренировок, еда и вес сохранятся.</p>' : ''}`;
  },
];
const opt = (f, v, t) => `<button class="opt ${String(D[f]) === String(v) ? 'on' : ''}" data-f="${f}" data-v="${v}">${t}</button>`;
const card = (f, v, t, s) => `<button class="opt card ${D[f] === v ? 'on' : ''}" data-f="${f}" data-v="${v}"><b>${t}</b><span>${s}</span></button>`;
const chip = (f, v, t) => `<button class="chip ${D[f].includes(v) ? 'on' : ''}" data-m="${f}" data-v="${v}">${t}</button>`;

function readStep() {
  const num = (id, lo, hi) => { const el = $('#' + id); if (!el) return undefined; const v = parseFloat(String(el.value).replace(',', '.')); return v >= lo && v <= hi ? v : null; };
  const n = $('#q_name'); if (n) D.name = n.value.trim().slice(0, 30);
  for (const [k, lo, hi] of [['age', 10, 90], ['height', 120, 230], ['weight', 30, 250], ['pushups', 0, 200], ['pullups', 0, 100]]) {
    const v = num('q_' + k, lo, hi); if (v !== undefined) D[k] = v === null ? '' : v;
  }
  const t = num('q_target', 30, 250); if (t !== undefined) D.target = t === null ? '' : t;
}
function stepError() {
  if (step === 1 && (D.age === '' || D.height === '' || D.weight === '')) return 'Заполни возраст (10–90), рост (120–230) и вес (30–250).';
  if (step === 5) { if (D.pushups === '') D.pushups = 0; if (D.pullups === '') D.pullups = 0; }
  if (step === 6 && !D.days.length) return 'Выбери хотя бы один день.';
  return '';
}
function drawStep() {
  const last = step === STEPS.length - 1;
  $('#screen').innerHTML = `<div class="onbar"><i style="width:${(step + 1) / STEPS.length * 100}%"></i></div>${STEPS[step]()}
    <p class="err" id="err"></p>
    <div class="exbtns">${step ? '<button class="btn ghost" id="qback">Назад</button>' : ''}<button class="btn" id="qnext">${last ? 'Начать' : 'Дальше'}</button></div>`;
  setBack(step ? () => { readStep(); step--; drawStep(); } : (D._edit ? () => { setBack(null); render(); } : null));
  $$('.opt').forEach(b => b.onclick = () => { readStep(); const v = b.dataset.v; D[b.dataset.f] = isNaN(+v) ? v : +v; haptic(); drawStep(); });
  $$('[data-m]').forEach(b => b.onclick = () => { readStep(); const f = b.dataset.m, v = b.dataset.v; D[f] = D[f].includes(v) ? D[f].filter(x => x !== v) : D[f].concat(v); haptic(); drawStep(); });
  $$('[data-day]').forEach(b => b.onclick = () => { readStep(); const d = +b.dataset.day; D.days = D.days.includes(d) ? D.days.filter(x => x !== d) : D.days.concat(d); haptic(); drawStep(); });
  const bk = $('#qback'); if (bk) bk.onclick = () => { readStep(); step--; drawStep(); };
  $('#qnext').onclick = () => {
    readStep();
    const e = stepError(); if (e) { $('#err').textContent = e; notify('error'); return; }
    if (!last) { step++; drawStep(); scrollTo(0, 0); return; }
    const p = { ...D }; delete p._edit;
    if (!p.created) p.created = S.today;
    S.profile = p; Store.set('profile', p);
    S.program = keepCustom(buildProgram(p)); Store.set('program', S.program);
    if (!S.weights.length) { S.weights = [{ d: S.today, w: p.weight }]; Store.set('weights', S.weights); }
    S.workout.wid = null; setBack(null); notify();
    S.tab = 'today'; $$('.tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === 'today'));
    render(); scrollTo(0, 0);
  };
}

/* =================== СЕГОДНЯ =================== */
const FEEL = ['Легко', 'Нормально', 'Тяжело'];
let clockIv = null;
const mins = t0 => Math.max(1, Math.round((Date.now() - t0) / 60000)) + ' мин';
const setsDone = id => doneVals(S.workout, id).length;

function renderToday() {
  const d = new Date();
  const planned = plannedFor(d);
  const started = isTrained(S.workout);
  if (S.workout.wid && !W(S.workout.wid)) S.workout.wid = null; // тренировку удалили из плана
  let h = `<h1>${WDF[d.getDay()]}, ${d.getDate()}.${pad(d.getMonth() + 1)}</h1>` + dayStrip();

  if (S.choosing) {
    h += `<p class="sub">Какую тренировку делаем сегодня?</p>` + S.program.workouts.map(w =>
      `<button class="wcard pick" data-w="${w.id}"><b>${esc(w.name)}${w.id === (planned && planned.id) ? ' <span class="tag">по плану</span>' : ''}${w.custom ? ' <span class="tag">своя</span>' : ''}</b><span>${dayLabel(w)} · ${MAIN(w.list).length} упражнений · ~${workoutMin(w.list)} мин</span></button>`).join('') +
      `<button class="btn" id="chBuild">Собрать свою тренировку</button><button class="btn ghost" id="chCancel">Отмена</button>`;
    $('#screen').innerHTML = h;
    $$('[data-w]').forEach(b => b.onclick = () => { S.workout.wid = b.dataset.w; S.choosing = false; S.anyway = true; saveWorkout(); haptic(); renderToday(); });
    $('#chCancel').onclick = () => { S.choosing = false; renderToday(); };
    $('#chBuild').onclick = () => { S.choosing = false; openBuilder(); };
    setBack(() => { S.choosing = false; setBack(null); renderToday(); });
    return;
  }

  const firstTime = !trainedDates().filter(d => d !== S.today).length;
  if (!S.workout.wid && !planned && !S.anyway && !started && firstTime && !S.waitFirst) {
    const nx = nextTraining();
    h += `<p class="sub">Твоя первая тренировка по плану — ${nx ? nx.label : 'скоро'}${nx ? `: <b>${esc(nx.w.name)}</b>` : ''}. Можно начать и сегодня.</p>
      <button class="btn" id="startNow">Начать сегодня</button><button class="btn ghost" id="waitFirst">Подожду${nx ? ' до ' + nx.label : ''}</button>${firstTips()}${actSection()}`;
    $('#screen').innerHTML = h; bindActivity();
    $('#startNow').onclick = () => { S.workout.wid = (nx ? nx.w : S.program.workouts[0]).id; S.anyway = true; haptic(); renderToday(); };
    $('#waitFirst').onclick = () => { S.waitFirst = true; renderToday(); };
    bindStrip();
    return;
  }
  if (!S.workout.wid && !planned && !S.anyway && !started) {
    const nx = nextTraining();
    h += `<p class="sub">Сегодня день отдыха.${nx ? ` Следующая тренировка — ${nx.label}: <b>${esc(nx.w.name)}</b>.` : ''}</p>
      <div class="banner">Мышцы растут, пока отдыхаешь. Сегодня главное — еда, белок и вода.</div>
      <button class="btn ghost" id="anyway">Всё равно потренироваться</button>${actSection()}`;
    $('#screen').innerHTML = h; bindActivity();
    $('#anyway').onclick = () => { S.choosing = true; renderToday(); };
    bindStrip();
    return;
  }
  const w = W(S.workout.wid) || planned || nextInOrder();
  if (S.workout.wid !== w.id) { S.workout.wid = w.id; if (started) saveWorkout(); }
  const core = w.list.filter(id => LIB[id]);
  const done = core.filter(id => setsDone(id) >= setsOf(E(id))).length;
  const nextId = core.find(id => setsDone(id) < setsOf(E(id)));
  const regular = S.program.workouts.filter(x => !x.custom), idx = regular.indexOf(w) + 1, burned = trainKcal();

  h += `<div class="hero">
    <span class="hero-k">${w.custom ? 'Своя тренировка' : `Тренировка ${idx} из ${regular.length}`}${planned && planned.id === w.id ? ' · по плану' : ''}</span>
    <h2>${esc(w.name)}</h2>
    <div class="hero-meta"><span>${core.length - 2} упражнений</span><span>~${workoutMin(core)} мин</span><span>≈ ${workoutKcal(core)} ккал</span></div>
    ${started ? `<div class="bar"><i style="width:${done / core.length * 100}%"></i></div>
      <div class="hero-sub">Сделано ${done} из ${core.length} · сожжено ≈ ${burned} ккал${sportToFood() ? ' → минус из еды' : ''}${S.workout.start && !S.workout.finished ? ` · <span id="clock">${mins(S.workout.start)}</span>` : ''}</div>` : ''}
    ${S.workout.finished ? `<div class="hero-done ${isFull(S.workout) ? '' : 'part'}">${isFull(S.workout) ? 'Тренировка завершена' : `Неполная тренировка · ${Math.round(completion(S.workout) * 100)} %`}${S.workout.start && S.workout.end ? ` · ${Math.max(1, Math.round((S.workout.end - S.workout.start) / 60000))} мин` : ''}</div>
      ${burned && sportToFood() ? `<div class="hero-sub">${burned} ккал вычтено из съеденного</div>` : ''}`
      : nextId ? `<button class="btn big" id="go">${started ? `Продолжить: ${esc(LIB[nextId].name)}` : 'Начать тренировку'}</button>`
      : `<button class="btn big" id="toFinish">Завершить тренировку</button>`}
  </div>`;
  if (isDeload()) h += `<div class="tip"><b>Разгрузочная неделя.</b> На подход меньше и вес полегче — тело восстанавливается и потом растёт быстрее.</div>`;
  if (firstTime && !S.workout.finished) h += firstTips();

  const extra = (w.extra || []).filter(id => LIB[id]);
  h += sec('ex', 'Упражнения', `${done} / ${core.length}`, `<div class="exlist">` + core.map((id, i) => rowHTML(id, i)).join('') + `</div>`, true);
  if (extra.length) h += sec('extra', 'Ещё по желанию', extra.length, `<div class="exlist">${extra.map((id, i) => rowHTML(id, core.length + i)).join('')}</div>`, false);

  if (!S.workout.finished && started) {
    h += `<div class="card" id="finishBox"><b>Закончить тренировку</b><p class="muted">Как далось?</p>
      <div class="seg feel">${FEEL.map((f, i) => `<button data-feel="${i}" class="${S.workout.feel === i ? 'on' : ''}">${f}</button>`).join('')}</div>
      <textarea id="wnote" rows="2" maxlength="300" placeholder="Заметка: болело плечо, взял вес тяжелее…">${esc(S.workout.note || '')}</textarea>
      <button class="btn" id="finish">Завершить тренировку</button></div>`;
  } else if (S.workout.finished) {
    if (S.workout.feel != null || S.workout.note) h += `<div class="card">${S.workout.feel != null ? 'Далось: ' + FEEL[S.workout.feel].toLowerCase() + '. ' : ''}${esc(S.workout.note || '')}</div>`;
  }
  h += actSection();
  if (!S.workout.finished) h += `<button class="btn ghost" id="choose">Сделать другую тренировку</button>`;
  $('#screen').innerHTML = h;
  bindActivity();

  $$('.exrow').forEach(b => b.onclick = () => openExercise(b.dataset.id));
  bindStrip();
  const go = $('#go'); if (go) go.onclick = () => openExercise(nextId);
  const tf = $('#toFinish'); if (tf) tf.onclick = () => $('#finishBox') && $('#finishBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
  const ch = $('#choose'); if (ch) ch.onclick = () => { S.choosing = true; renderToday(); scrollTo(0, 0); };
  $$('[data-feel]').forEach(b => b.onclick = () => { S.workout.feel = +b.dataset.feel; saveWorkout(); haptic(); $$('[data-feel]').forEach(x => x.classList.toggle('on', x === b)); });
  const note = $('#wnote'); if (note) note.onchange = () => { S.workout.note = note.value.trim().slice(0, 300); saveWorkout(); };
  const f = $('#finish'); if (f) f.onclick = () => {
    if (note) S.workout.note = note.value.trim().slice(0, 300);
    S.workout.finished = true; S.workout.end = Date.now(); S.workout.name = w.name; saveWorkout(); notify(); renderToday(); scrollTo(0, 0);
    if (!isFull(S.workout)) toast(`Записала как неполную (${Math.round(completion(S.workout) * 100)} %). В прогрессе она будет отмечена отдельно.`);
    checkAch();
  };
  clearInterval(clockIv);
  if (S.workout.start && !S.workout.finished) clockIv = setInterval(() => { const c = $('#clock'); if (c) c.textContent = mins(S.workout.start); else clearInterval(clockIv); }, 15000);
}
// Сводка дня одной строкой: сколько съел из нормы (с учётом спорта), вода, шаги. Нажал — открылась «Еда».
function dayStrip() {
  if (S.choosing) return '';
  const G = todayNorms(), k = eatenNet(Math.round(S.food.items.reduce((s, x) => s + (+x.k || 0), 0)), G.A), wml = S.food.waterMl ?? (S.food.water || 0) * 250;
  const cell = (v, of, n, cls) => `<button class="dcell ${cls}" data-go="${cls === 'a' ? 'act' : 'food'}"><b>${v}</b><span>${of}</span><i style="--v:${n}%"></i><em>${cls === 'k' ? 'еда' : cls === 'w' ? 'вода' : 'активность'}</em></button>`;
  return `<div class="daystrip">${cell(k, '/ ' + G.kcal, Math.min(100, k / G.kcal * 100), 'k')}${cell(r1(wml / 1000), '/ ' + G.water + ' л', Math.min(100, wml / G.waterMl * 100), 'w')}${cell(G.A.total, 'ккал', G.A.total ? 100 : 0, 'a')}</div>`;
}
function bindStrip() { $$('[data-go]').forEach(b => b.onclick = () => {
  if (b.dataset.go === 'act') { const d = $('[data-sec="act"]'); if (d) { d.open = true; haptic(); setTimeout(() => d.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30); } return; } S.tab = b.dataset.go; $$('.tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === S.tab)); haptic(); render(); scrollTo(0, 0); }); }
function rowHTML(id, i) {
  const e = E(id), n = setsDone(id), ok = n >= setsOf(e);
  return `<button class="exrow ${ok ? 'done' : n ? 'part' : ''}" data-id="${id}">
    <span class="num">${ok ? '✓' : i + 1}</span>
    <span class="n"><b>${esc(e.name)}</b><small>${setsOf(e) > 1 ? setsOf(e) + ' × ' : ''}${range(e)}${e.type === 'reps' ? ' повт.' : ''}${n && !ok ? ` · сделано ${n}` : ''}</small></span>
    <span class="chev">›</span></button>`;
}
function firstTips() {
  const gym = S.profile.place === 'gym';
  return `<details class="first"><summary>${gym ? 'Первый раз в зале — что знать' : 'Первая тренировка — что знать'}</summary><ol class="steps">
    ${gym ? '<li><b>Что взять:</b> удобную одежду и кроссовки, воду, полотенце.</li>' : '<li><b>Что нужно:</b> удобная одежда, вода, немного места.</li>'}
    <li><b>Иди по списку сверху вниз.</b> Нажми на упражнение — там человечек, шаги и «Видео техники».</li>
    <li><b>Вес — лёгкий.</b> Первые 1–2 недели учим технику. Приложение подскажет, с какого веса начать, и потом само скажет, когда добавлять.</li>
    <li><b>После подхода — «Готово».</b> Таймер отдыха включится сам и пикнет, когда пора.</li>
    ${gym ? '<li><b>Не знаешь, как настроить тренажёр</b> — посмотри видео или спроси тренера зала. Это нормально, все так начинали.</li>' : ''}
    <li><b>Не получается</b> — жми «Слишком тяжело?» под подходами: подберу вариант полегче.</li>
    <li><b>На следующий день мышцы могут болеть</b> — это нормально, проходит за 2–3 дня. Острая боль в суставе — не нормально: остановись.</li>
  </ol></details>`;
}
function cardHTML(id) {
  const e = E(id), n = setsDone(id);
  return `<button class="ex ${n >= setsOf(e) ? 'done' : ''}" data-id="${id}">
    <div class="n"><b>${esc(e.name)}</b><span>${setsOf(e) > 1 ? setsOf(e) + ' × ' : ''}${range(e)}${e.side ? ' на сторону' : ''} · ${esc(e.mus)}</span></div>
    <div class="prog">${n}/${setsOf(e)}</div></button>`;
}
function nextTraining() {
  for (let i = 1; i <= 7; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    const w = plannedFor(d);
    if (w) return { w, label: i === 1 ? 'завтра' : `${WD[d.getDay()]} ${d.getDate()}.${pad(d.getMonth() + 1)}` };
  }
  return null;
}

/* ---------- экран упражнения ---------- */
let swTimer = null, sheetClose = null;
// Экран упражнения на телефоне: один активный подход с крупными кнопками − / +, внизу одна главная кнопка.
function curWorkout() { return W(S.workout.wid) || plannedFor(new Date()) || null; }
function startKg(e) {
  const f = S.profile.sex === 'f';
  if (e.id === 'gravitron') return Math.round(curWeight() / 2 / 5) * 5;
  if (e.eq.includes('bb')) return f ? 15 : 20;
  if (e.eq.includes('kb')) return f ? 8 : 12;
  if (e.eq.includes('gym')) return f ? 10 : 15;
  if (['biceps', 'triceps', 'delts', 'grip'].includes(e.pat)) return f ? 2 : 5;
  return f ? 4 : 8;
}
function openExercise(id) {
  const e = E(id); const ns = setsOf(e);
  const vals = S.workout.sets[id] || (S.workout.sets[id] = Array(ns).fill(null));
  while (vals.length < ns) vals.push(null);
  while (vals.length > ns && vals[vals.length - 1] == null) vals.pop(); // подходов стало меньше
  const st = exStats(id), last = st.last;
  const allTop = last && last.vals.length >= ns && last.vals.every(v => v >= e.hi);
  const easier = ladderStep(id, -1), harder = ladderStep(id, 1);
  const adj = S.program.adj && S.program.adj[id];
  const service = ['warmup', 'stretch'].includes(id);
  const wtd = isWeighted(e), kgs = wtd ? (S.workout.kg = S.workout.kg || {}, S.workout.kg[id] || (S.workout.kg[id] = Array(ns).fill(null))) : null;
  if (kgs) while (kgs.length < vals.length) kgs.push(null);
  const inc = wtd ? kgStep(e) : 0;
  const lastKg = last && last.kg ? Math.max(...last.kg) : null;
  const nextKg = lastKg != null ? (allTop ? lastKg + inc : lastKg) : null;
  const w = curWorkout(), order = w ? w.list.filter(x => LIB[x]) : [id], pos = order.indexOf(id);
  const nextEx = pos >= 0 ? order.slice(pos + 1).find(x => doneVals(S.workout, x).length < setsOf(E(x))) : null;
  const cur = vals.findIndex(v => v == null);
  const repsDef = e.type === 'time' ? e.lo : (last && last.vals[cur] != null && !allTop ? Math.min(e.hi, last.vals[cur] + 1) : e.lo);
  const kgDef = wtd ? (kgs.slice(0, Math.max(0, cur)).filter(x => x != null).pop() ?? nextKg ?? startKg(e)) : 0;

  let h = `<div class="exhead"><button class="back" id="back" aria-label="Назад">←</button>
      <div><small>${pos >= 0 ? `Упражнение ${pos + 1} из ${order.length}` : 'Упражнение'}</small><h2>${esc(e.name)}</h2></div></div>
    <div class="figbox" id="fig"></div>
    <div class="meta">${ns > 1 ? `<span>${ns} подхода</span>` : ''}<span>${range(e)}${e.type === 'reps' ? ' повторов' : ''}${e.side ? ' на сторону' : ''}</span>${e.rest ? `<span>отдых ${e.rest} с</span>` : ''}<span>≈ ${Math.round(kcalOf(id))} ккал</span></div>`;
  let info = '';
  if (last) {
    const lastTxt = last.kg ? `${lastKg} кг × ${last.vals.join(', ')}` : `${last.vals.join(', ')}${unit(e)}`;
    const up = wtd ? `Пора добавить вес: ${nextKg} кг.` : harder ? `Пора переходить на «${LIB[harder].name}».` : adj ? 'Пора вернуть обычную цель.' : (e.harder || 'Делай медленнее: 3 с вниз.');
    info += `<div class="lastbox"><span>В прошлый раз · ${fmtDate(last.date)}</span><b>${lastTxt}</b>${allTop ? `<em>${esc(up)}</em>` : ''}</div>`;
    if (allTop && harder && !wtd) info += `<button class="btn ghost" id="goHarder">Перейти на «${esc(LIB[harder].name)}»</button>`;
    if (allTop && !harder && adj) info += `<button class="btn ghost" id="clearAdj">Вернуть цель ${LIB[id].lo}–${LIB[id].hi}</button>`;
  }
  if (wtd && !last) info += `<div class="tip"><b>Первый раз?</b> ${startHint(e)} Легко — прибавь, тяжело — убавь. Приложение запомнит вес.</div>`;

  h += `<div class="logger">`;
  if (cur >= 0) {
    h += `<div class="lg-title">Подход ${cur + 1} <span class="nsets">из ${ns}${service ? '' : `<button id="setsDn" aria-label="Меньше подходов">−</button><button id="setsUp" aria-label="Больше подходов">+</button>`}</span></div>`;
    if (wtd) h += stepper('kg', kgDef, 'кг', 'decimal');
    if (e.type === 'time') h += stepper('reps', repsDef, 'сек', 'numeric') + `<button class="btn ghost" id="sw">▶ Засечь время</button>`;
    else h += stepper('reps', repsDef, e.side ? 'повт. на сторону' : 'повторов', 'numeric');
  } else h += `<div class="lg-done">Все подходы сделаны${service ? '' : '<button class="link" id="setsUp">+ ещё подход</button>'}</div>`;
  const doneChips = vals.map((v, i) => v == null ? '' : `<button class="donechip" data-undo="${i}">✓ ${wtd && kgs[i] != null ? kgs[i] + ' × ' : ''}${v}${unit(e)}</button>`).join('');
  if (doneChips) h += `<div class="donerow">${doneChips}</div>`;
  h += `</div>`;

  h += info;
  h += `<details ${last ? '' : 'open'}><summary>Как делать</summary><ol class="steps">${e.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      <div class="exbtns"><button class="btn ghost" id="vid">Видео техники</button>${e.cam ? '<button class="btn ghost" id="camBtn">Камера</button>' : ''}</div></details>`;
  if (!service) h += `<details><summary>Подсказки</summary><p class="muted">Последние 1–3 повтора должны идти тяжело, но с чистой техникой — до отказа не нужно.${levelOf(S.profile) === 1 ? ' Первые 2 недели вес лёгкий: учим технику.' : ''}</p>
      ${wtd && WARMUP_PATS.includes(e.pat) && e.eq.some(x => ['bb', 'gym'].includes(x)) ? '<p class="muted">Перед первым подходом — разминочный: половина веса × 10 (не записывай).</p>' : ''}
      ${st.sessions ? `<p class="muted">Всего: ${st.sessions} ${plural(st.sessions, 'тренировка', 'тренировки', 'тренировок')}, рекорд ${st.bestKg ? st.bestKg + ' кг' : st.best + unit(e)}.</p>` : ''}</details>
      <div class="exlinks"><button class="link" id="tooHard">Слишком тяжело?</button><button class="link" id="swapEx">Заменить упражнение</button></div><div id="hardBox"></div>`;
  const primary = cur >= 0 ? `Готово · подход ${cur + 1}` : nextEx ? `Дальше: ${LIB[nextEx].name} →` : 'Закончить тренировку';
  h += `<div class="actionbar"><button class="btn big" id="primary">${esc(primary)}</button></div>`;

  const sh = $('#sheet');
  const keepScroll = sh.dataset.ex === id ? sh.scrollTop : 0;
  sh.innerHTML = h; sh.hidden = false; sh.dataset.ex = id; sh.scrollTop = keepScroll;
  if (window.Figure) Figure.mount($('#fig'), id, e.eq.includes('bb') ? 'bb' : e.eq.includes('db') ? 'db' : e.eq.includes('kb') ? 'kb' : null);
  sheetClose = () => { stopSW(); if (window.Figure) Figure.stop(); sh.hidden = true; sh.dataset.ex = ''; setBack(null); render(); };
  $('#back').onclick = sheetClose; setBack(sheetClose);
  $('#vid').onclick = () => openLink('https://www.youtube.com/results?search_query=' + encodeURIComponent(e.video));
  if (e.cam) $('#camBtn').onclick = () => openCam(id, e, vals);

  // кнопки − / +
  $$('.stepper', sh).forEach(sp => {
    const inp = $('input', sp), k = sp.dataset.k, step = k === 'kg' ? inc : e.type === 'time' ? 5 : 1;
    $$('button', sp).forEach(b => b.onclick = () => {
      const v = parseFloat(String(inp.value).replace(',', '.')) || 0;
      inp.value = Math.max(0, Math.round((v + (b.dataset.d === '+' ? step : -step)) * 100) / 100); haptic();
    });
  });
  const sw = $('#sw'); if (sw) sw.onclick = () => {
    const inp = $('.stepper[data-k="reps"] input', sh);
    if (swTimer) { clearInterval(swTimer.iv); swTimer = null; sw.textContent = '▶ Засечь время'; sw.classList.remove('run'); haptic('medium'); return; }
    const t0 = Date.now(); inp.value = 0; sw.textContent = '■ Стоп'; sw.classList.add('run'); haptic('medium');
    swTimer = { iv: setInterval(() => inp.value = Math.floor((Date.now() - t0) / 1000), 250), sw: { classList: { remove() {} }, set textContent(x) {} } };
  };
  $$('[data-undo]', sh).forEach(b => b.onclick = () => {
    const i = +b.dataset.undo, pv = vals[i], pk = kgs ? kgs[i] : null;
    vals[i] = null; if (kgs) kgs[i] = null; saveWorkout(); openExercise(id);
    toast(`Подход ${i + 1} удалён`, () => { vals[i] = pv; if (kgs) kgs[i] = pk; saveWorkout(); openExercise(id); });
  });
  // Сколько подходов: своё число у упражнения, запоминается в плане.
  const setN = nn => {
    nn = Math.max(1, Math.min(8, nn));
    if (nn < vals.filter(v => v != null).length) { toast('Сначала убери записанный подход (нажми на него)'); return; }
    S.program.nsets = S.program.nsets || {}; S.program.nsets[id] = nn; saveProgram();
    while (vals.length < nn) vals.push(null);
    while (vals.length > nn && vals[vals.length - 1] == null) vals.pop();
    if (kgs) { while (kgs.length < vals.length) kgs.push(null); kgs.length = vals.length; }
    saveWorkout(); haptic(); openExercise(id);
    toast(`${nn} ${plural(nn, 'подход', 'подхода', 'подходов')} в «${e.name}» — запомнила`);
  };
  const sd = $('#setsDn'); if (sd) sd.onclick = () => setN(ns - 1);
  const su = $('#setsUp'); if (su) su.onclick = () => setN(ns + 1);
  $('#primary').onclick = () => {
    if (cur < 0) { if (nextEx) openExercise(nextEx); else { sheetClose(); setTimeout(() => { const fb = $('#finishBox'); if (fb) fb.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50); } return; }
    if (swTimer) { clearInterval(swTimer.iv); swTimer = null; }
    const rIn = $('.stepper[data-k="reps"] input', sh), kIn = $('.stepper[data-k="kg"] input', sh);
    const v = Math.min(9999, Math.max(0, Math.round(parseFloat(String(rIn.value).replace(',', '.')) || 0)));
    if (!v) { toast(e.type === 'time' ? 'Сколько секунд продержался?' : 'Сколько повторов сделал?'); return; }
    vals[cur] = v;
    if (kIn) { const kg = parseFloat(String(kIn.value).replace(',', '.')); kgs[cur] = kg >= 0 && kg < 1000 ? Math.round(kg * 4) / 4 : null; }
    if (!S.workout.start) S.workout.start = Date.now();
    saveWorkout(); notify(); checkAch();
    if (vals.some(x => x == null)) { openExercise(id); if (e.rest) startRest(e.rest); return; }
    const dn = vals.filter(x => x != null), mx = Math.max(...dn);
    if (!service && mx < e.lo && mx > 0) {
      const lo = Math.max(1, Math.round(dn.reduce((a, b) => a + b, 0) / dn.length)), hi = Math.max(lo + 2, Math.round(mx * 1.4));
      setAdj(id, lo, hi);
      toast(`Подстроила цель под тебя: ${lo}–${hi}${unit(e)}. Станет легче — приложение поднимет.`);
    } else toast(nextEx ? 'Упражнение готово! Дальше — ' + LIB[nextEx].name : 'Последнее упражнение готово!');
    openExercise(id);
  };
  // Замена прямо с экрана упражнения: в этой тренировке (без «Изменить» в плане). Нет тренажёра, занят, не нравится — поменял.
  const se = $('#swapEx'); if (se) se.onclick = () => {
    stopSW(); if (window.Figure) Figure.stop();
    openPicker(`Заменить «${e.name}»`, LIB[id].pat, w ? w.list : [id], to => {
      if (w) { const i = w.list.indexOf(id); if (i >= 0) w.list[i] = to; w.extra = (w.extra || []).filter(x => x !== to); saveProgram(); }
      moveSets(id, to); toast(`Теперь в «${w ? w.name : 'тренировке'}»: ${LIB[to].name}`); openExercise(to);
    }, null, () => openExercise(id));
  };
  const gh = $('#goHarder'); if (gh) gh.onclick = () => { replaceEverywhere(id, harder); moveSets(id, harder); notify(); toast(`Теперь в плане: ${LIB[harder].name}`); openExercise(harder); };
  const ca = $('#clearAdj'); if (ca) ca.onclick = () => { delete S.program.adj[id]; saveProgram(); notify(); openExercise(id); };
  const th = $('#tooHard'); if (th) th.onclick = () => {
    const lo2 = Math.max(1, Math.round(e.lo * 0.5)), hi2 = Math.max(lo2 + 2, Math.round(e.hi * 0.6));
    $('#hardBox').innerHTML = `<div class="card"><p>Ничего страшного — так у всех в начале. ${wtd ? '<b>Сначала просто возьми вес на 10–20 % легче.</b> ' : ''}Сделай сколько можешь и запиши — я подстрою план.</p>
      ${easier ? `<button class="btn" id="goEasier">Заменить на «${esc(LIB[easier].name)}»</button>` : ''}
      <button class="btn ghost" id="lower">Снизить цель до ${lo2}–${hi2}</button></div>`;
    const ge = $('#goEasier'); if (ge) ge.onclick = () => { replaceEverywhere(id, easier); moveSets(id, easier); notify(); toast(`Заменила на «${LIB[easier].name}» во всём плане`); openExercise(easier); };
    $('#lower').onclick = () => { setAdj(id, lo2, hi2); notify(); toast('Цель снижена. Окрепнешь — приложение предложит вернуть.'); openExercise(id); };
    $('#hardBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
}
const stepper = (k, v, label, mode) => `<div class="stepper" data-k="${k}"><button data-d="-" aria-label="Меньше">−</button>
  <label><input type="text" inputmode="${mode}" value="${v}"><span>${label}</span></label><button data-d="+" aria-label="Больше">+</button></div>`;
const WARMUP_PATS = ['squat', 'hinge', 'push_h', 'push_v', 'pull_v', 'pull_h'];
const isWeighted = e => !['warmup', 'stretch'].includes(e.pat) && e.type === 'reps' && e.eq.some(x => ['db', 'bb', 'kb', 'gym'].includes(x));
const kgStep = e => e.eq.includes('bb') ? 2.5 : e.eq.includes('kb') ? 4 : e.eq.includes('gym') ? 5 : 1;
function startHint(e) {
  const f = S.profile.sex === 'f';
  if (e.id === 'gravitron') return 'В гравитроне вес — это помощь: начни с противовеса примерно в половину своего веса.';
  if (e.eq.includes('bb')) return f ? 'Начни с лёгкого грифа 10–15 кг или пустого олимпийского (20 кг).' : 'Начни с пустого грифа — обычно он весит 20 кг.';
  if (e.eq.includes('kb')) return f ? 'Начни с гири 6–8 кг.' : 'Начни с гири 12–16 кг.';
  if (e.eq.includes('gym')) return f ? 'Начни с 1–2 плиток (5–10 кг).' : 'Начни с 2–4 плиток (10–20 кг).';
  if (['biceps', 'triceps', 'delts', 'grip'].includes(e.pat)) return f ? 'Начни с гантелей 2–3 кг.' : 'Начни с гантелей 4–6 кг.';
  return f ? 'Начни с гантелей 3–5 кг.' : 'Начни с гантелей 6–10 кг.';
}
function setAdj(id, lo, hi) { S.program.adj = S.program.adj || {}; S.program.adj[id] = { lo, hi }; saveProgram(); }
function moveSets(from, to) { // записанные сегодня подходы переносим на новое упражнение
  if (S.workout.sets[from] && !isTrained({ sets: { x: S.workout.sets[to] || [] } })) {
    S.workout.sets[to] = S.workout.sets[from]; delete S.workout.sets[from];
    if (S.workout.kg && S.workout.kg[from]) { S.workout.kg[to] = S.workout.kg[from]; delete S.workout.kg[from]; }
    saveWorkout();
  }
}
let toastT = null, toastUndo = null;
function toast(text, undo) {
  const t = $('#toast'); toastUndo = undo || null;
  t.innerHTML = `<span>${esc(text)}</span>${undo ? '<button id="toastUndo">Отменить</button>' : ''}`;
  t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, undo ? 5000 : 3500);
  const u = $('#toastUndo'); if (u) u.onclick = () => { t.hidden = true; if (toastUndo) toastUndo(); };
}
function stopSW() {
  if (!swTimer) return;
  clearInterval(swTimer.iv); swTimer.sw.classList.remove('run'); swTimer.sw.textContent = 'Секундомер'; swTimer = null; haptic('medium');
}

/* ---------- таймер отдыха ---------- */
let restIv = null, restEnd = 0;
function startRest(sec) { restEnd = Date.now() + sec * 1000; $('#rest').hidden = false; tickRest(); clearInterval(restIv); restIv = setInterval(tickRest, 250); }
function tickRest() {
  const left = Math.ceil((restEnd - Date.now()) / 1000);
  $('#restTime').textContent = Math.max(0, left);
  if (left <= 0) { stopRest(); beep(); notify('warning'); try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) {} }
}
function stopRest() { clearInterval(restIv); $('#rest').hidden = true; }
$('#restPlus').onclick = () => { restEnd += 15000; tickRest(); };
$('#restSkip').onclick = stopRest;

let actx = null;
function beep(freq = 880, ms = 180) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = freq; o.connect(g); g.connect(actx.destination);
    g.gain.setValueAtTime(0.25, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + ms / 1000);
    o.start(); o.stop(actx.currentTime + ms / 1000);
  } catch (e) {}
}
window.beep = beep;

function openCam(id, e, vals) {
  if (!window.PoseCheck) { alert('Модуль камеры ещё грузится, попробуй через пару секунд.'); return; }
  setBack(() => window.PoseCheck.close(false));
  window.PoseCheck.open(e.cam, result => {
    setBack(sheetClose);
    const i = vals.findIndex(v => v == null);
    if (i < 0 || !result) return;
    vals[i] = result; if (!S.workout.start) S.workout.start = Date.now(); saveWorkout(); openExercise(id);
    if (vals.some(v => v == null) && e.rest) startRest(e.rest);
  });
}

/* =================== ПЛАН =================== */
function renderPlan() {
  const created = (S.profile && S.profile.created) || S.today;
  const perWeek = S.program.workouts.filter(w => w.weekday != null).length;
  let h = `<div class="row"><h1>План</h1><button class="btn sm ${S.editPlan ? '' : 'ghost'} fit" id="editPlan">${S.editPlan ? 'Готово' : 'Изменить'}</button></div>
    <p class="sub">${perWeek} ${plural(perWeek, 'тренировка', 'тренировки', 'тренировок')} в неделю</p><div class="wk">${WEEK.map(d => `<span class="wkh">${WD[d]}</span>`).join('')}`;
  // 2 недели клетками: зелёная — сделано, жёлтая — неполная, красная точка — пропуск, рамка — сегодня, точка — запланировано
  const start = new Date(); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  for (let i = 0; i < 14; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = dateKey(d), rec = S.history[k], trained = isTrained(rec), w = plannedFor(d);
    const past = k < S.today, counted = k >= created;
    const cls = trained ? (isFull(rec) ? 'ok' : 'part') : past && w && counted ? 'miss' : w ? 'plan' : '';
    h += `<span class="dc ${cls} ${k === S.today ? 'now' : ''} ${past ? 'past' : ''}"${trained && !isFull(rec) ? ` style="--p:${Math.round(completion(rec) * 100)}%"` : ''}><b>${d.getDate()}</b><i></i></span>`;
  }
  h += `</div><div class="legend"><span><i class="on"></i>сделано</span><span><i class="half"></i>неполная</span><span><i class="dot"></i>по плану</span></div>`;
  h += `<h3>Тренировки</h3>`;
  const ws = S.program.workouts.slice().sort((a, b) => (a.weekday == null) - (b.weekday == null) || WEEK.indexOf(a.weekday) - WEEK.indexOf(b.weekday));
  ws.forEach(w => {
    const empty = !MAIN(w.list).length;
    const body = (empty ? `<p class="muted small">Пока пусто — ${S.editPlan ? 'добавь упражнения кнопкой ниже' : 'нажми «Изменить» и добавь упражнения'}.</p>` : '') + w.list.map((id, i) => LIB[id] ? `<div class="prow"><button class="pname" data-open="${id}"><b>${esc(LIB[id].name)}</b><span>${setsOf(E(id)) > 1 ? setsOf(E(id)) + ' × ' : ''}${range(E(id))}</span></button>
        ${!S.editPlan || ['warmup', 'stretch'].includes(id) ? '' : `<span class="pctl"><button class="mini sets" data-act="sets" data-w="${w.id}" data-i="${i}" aria-label="Подходов: ${setsOf(E(id))}">${setsOf(E(id))}×</button><button class="mini" data-act="up" data-w="${w.id}" data-i="${i}" aria-label="Выше">↑</button><button class="mini" data-act="down" data-w="${w.id}" data-i="${i}" aria-label="Ниже">↓</button><button class="mini" data-act="swap" data-w="${w.id}" data-i="${i}" aria-label="Заменить">⇄</button><button class="mini" data-act="del" data-w="${w.id}" data-i="${i}" aria-label="Убрать">×</button></span>`}</div>` : '').join('') +
      (S.editPlan ? `<div class="pedit"><label>День <select data-wd="${w.id}">${w.custom ? `<option value="" ${w.weekday == null ? 'selected' : ''}>любой</option>` : ''}${WEEK.map(d => `<option value="${d}" ${d === w.weekday ? 'selected' : ''}>${WD[d]}</option>`).join('')}</select></label>
        <button class="btn ghost sm" data-add="${w.id}">+ Упражнение</button></div>${w.custom ? `<div class="exbtns"><button class="btn ghost sm" data-cedit="${w.id}">В калькулятор</button><button class="btn ghost sm danger" data-cdel="${w.id}">Удалить</button></div>` : ''}`
        : empty ? '' : `<button class="link share" data-share="${w.id}">Поделиться тренировкой</button>`);
    const title = `<small class="wd">${w.weekday == null ? 'любой' : WD[w.weekday]}</small>${esc(w.name)}${w.custom ? ' <span class="tag">своя</span>' : ''}`;
    // В «Изменить» секции открыты, но если закрыл — остаются закрытыми и после правок (баг 13.11: вторник открывался сам).
    h += sec((S.editPlan ? 'we_' : 'w_') + w.id, title, empty ? 'пусто' : `${MAIN(w.list).length} упр · ~${workoutMin(w.list)} мин`, body, !!S.editPlan);
  });
  h += `<button class="btn ghost" id="build">+ Собрать свою тренировку</button>`;
  h += `<button class="link center" id="importW">Вставить тренировку от друга или тренера</button>`;
  h += S.editPlan ? `<button class="link center" id="rebuild">Пересобрать план по анкете</button><p class="muted small center">Свои тренировки при пересборке останутся.</p>` : '';
  h += sec('howgrow', 'Как растёт нагрузка', '', `<p class="muted">У каждого упражнения диапазон, например 10–15. Дошёл до верхней цифры во всех подходах — приложение скажет «пора усложнять» и как. Пропустил день — просто делай следующую тренировку.</p>`, false);
  $('#screen').innerHTML = h;

  $('#editPlan').onclick = () => { S.editPlan = !S.editPlan; haptic(); renderPlan(); };
  $$('[data-open]').forEach(b => b.onclick = () => openExercise(b.dataset.open));
  $$('[data-wd]').forEach(s => s.onchange = () => { W(s.dataset.wd).weekday = s.value === '' ? null : +s.value; saveProgram(); renderPlan(); });
  $('#build').onclick = () => { S.builder = null; openBuilder(); };
  $('#importW').onclick = () => openImport();
  $$('[data-share]').forEach(b => b.onclick = () => shareWorkout(W(b.dataset.share)));
  $$('[data-cedit]').forEach(b => b.onclick = () => { const w = W(b.dataset.cedit); S.builder = { place: S.profile.place, focus: 'full', min: 30, list: w.list.slice(), name: w.cname || w.name, day: w.weekday }; openBuilder(w.id); });
  $$('[data-cdel]').forEach(b => b.onclick = () => ask(`Удалить «${W(b.dataset.cdel).name}»? История тренировок останется.`, () => {
    const i = S.program.workouts.findIndex(w => w.id === b.dataset.cdel), w = S.program.workouts[i];
    S.program.workouts.splice(i, 1); saveProgram(); renderPlan();
    toast('Тренировка удалена', () => { S.program.workouts.splice(i, 0, w); saveProgram(); renderPlan(); });
  }));
  $$('[data-act]').forEach(b => b.onclick = () => {
    const w = W(b.dataset.w), i = +b.dataset.i, a = b.dataset.act, L = w.list;
    if (a === 'up' && i > 1) [L[i - 1], L[i]] = [L[i], L[i - 1]];
    else if (a === 'down' && i < L.length - 2) [L[i + 1], L[i]] = [L[i], L[i + 1]];
    else if (a === 'del') { const was = L.slice(); L.splice(i, 1); saveProgram(); haptic(); renderPlan(); toast('Упражнение убрано', () => { w.list = was; saveProgram(); renderPlan(); }); return; }
    else if (a === 'sets') { const nn = setsOf(E(L[i])) >= 5 ? 2 : setsOf(E(L[i])) + 1; S.program.nsets = S.program.nsets || {}; S.program.nsets[L[i]] = nn; }
    else if (a === 'swap') return openPicker(`Заменить «${LIB[L[i]].name}»`, LIB[L[i]].pat, L, id => { L[i] = id; saveProgram(); renderPlan(); });
    saveProgram(); haptic(); renderPlan();
  });
  $$('[data-add]').forEach(b => b.onclick = () => {
    const w = W(b.dataset.add);
    openPicker('Добавить упражнение', null, w.list, id => { w.list.splice(Math.max(1, w.list.length - 1), 0, id); saveProgram(); renderPlan(); });
  });
  const rb = $('#rebuild'); if (rb) rb.onclick = () => ask('Собрать план заново по анкете? Твои правки плана сбросятся, история тренировок останется.', () => {
    S.program = keepCustom(buildProgram(S.profile)); saveProgram(); notify(); renderPlan();
  });
}
const saveProgram = () => { renameAll(); Store.set('program', S.program); };

// Выбор упражнения: поиск по названию и мышцам, «глаз» — предпросмотр (человечек, шаги, видео), «+» — выбрать.
const norm = t => String(t).toLowerCase().replace(/ё/g, 'е');
function openPicker(title, pat, exclude, onPick, prof, onClose) {
  const p = prof || S.profile;
  const pats = Object.keys(PATTERNS);
  let h = `<div class="exhead"><button class="back" id="pback" aria-label="Назад">←</button><div><small>${pat ? 'Похожие под твой инвентарь' : 'Все упражнения'}</small><h2>${esc(title)}</h2></div></div>
    <div class="psearch"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
      <input id="psearch" type="search" placeholder="Поиск: становая, присед, пресс…" autocomplete="off" enterkeyhint="search"></div>
    <p class="muted small" id="pnone" hidden>Ничего не нашла. Попробуй другое слово: «тяга», «спина», «гантели».</p>`;
  for (const pt of pats) {
    const ids = Object.keys(LIB).filter(id => LIB[id].pat === pt && !exclude.includes(id));
    if (!ids.length) continue;
    const ok = ids.filter(id => fits(LIB[id], p)), other = ids.filter(id => !fits(LIB[id], p));
    const near = !pat || pt === pat; // в режиме «заменить» сначала видно только похожие; поиск ищет по всем
    h += `<section class="pgroup" data-near="${near ? 1 : 0}" ${near ? '' : 'hidden'}><h3>${esc(PATTERNS[pt])}</h3>` + ok.map(id => pickRow(id, '', true)).join('') +
      other.map(id => pickRow(id, needs(LIB[id], p), false)).join('') + `</section>`;
  }
  if (pat) h += `<button class="btn ghost sm" id="pall">Показать все упражнения</button>`;
  if (window.MACHINES && availableEq(p).includes('gym')) h = h.replace('<p class="muted small" id="pnone"', `<div class="chiprow mach">${MACHINES.map((m, i) => `<button data-mach="${i}">${esc(m[0])}</button>`).join('')}</div><p class="muted small" id="pnone"`);
  const sh = $('#sheet'); sh.innerHTML = h; sh.hidden = false; sh.scrollTop = 0; sh.dataset.ex = '';
  const close = () => { sh.hidden = true; setBack(null); };
  const back = () => { close(); if (onClose) onClose(); };
  $('#pback').onclick = back; setBack(back);
  let showAll = !pat, mach = null;
  const filter = () => {
    const q = norm($('#psearch').value.trim());
    let any = false;
    $$('.pgroup', sh).forEach(g => {
      let vis = 0;
      $$('.pick', g).forEach(r => { const hit = mach ? mach.includes(r.dataset.id) : q ? q.split(/\s+/).every(w => r.dataset.s.includes(w)) : (r.dataset.fit === '1' || pat); r.hidden = !hit; if (hit) vis++; });
      g.hidden = !vis || (!q && !mach && !showAll && g.dataset.near !== '1'); if (!g.hidden) any = true;
    });
    $('#pnone').hidden = any;
    const pa = $('#pall'); if (pa) pa.hidden = !!q || showAll;
  };
  $('#psearch').oninput = filter; filter();
  const pa = $('#pall'); if (pa) pa.onclick = () => { showAll = true; filter(); };
  $$('[data-mach]', sh).forEach(b => b.onclick = () => {
    const on = b.classList.contains('on'); $$('[data-mach]', sh).forEach(x => x.classList.remove('on'));
    mach = on ? null : MACHINES[+b.dataset.mach][1]; if (!on) b.classList.add('on'); haptic(); filter();
  });
  $$('[data-pick]', sh).forEach(b => b.onclick = () => { close(); onPick(b.dataset.pick); notify(); });
  $$('[data-prev]', sh).forEach(b => b.onclick = () => previewEx(b.dataset.prev, id => { close(); onPick(id); notify(); }));
}
const pickRow = (id, note, fit) => { const e = LIB[id];
  const mach = (window.MACHINES || []).filter(m => m[1].includes(id)).map(m => m[0]).join(' ');
  return `<div class="pick ${fit ? '' : 'nofit'}" data-id="${id}" data-fit="${fit ? 1 : 0}" data-s="${esc(norm(e.name + ' ' + e.mus + ' ' + (PATTERNS[e.pat] || '') + ' ' + e.eq.map(x => EQUIP[x] || '').join(' ') + ' ' + mach + (e.eq.includes('gym') ? ' тренажер' : '')))}">
    <button class="pinfo" data-prev="${id}"><b>${esc(e.name)}</b><span>${esc(e.mus)}${note ? ' · ' + esc(note) : ''}</span></button>
    <button class="peye" data-prev="${id}" aria-label="Посмотреть"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button>
    <button class="padd" data-pick="${id}" aria-label="Выбрать">+</button></div>`; };
// Предпросмотр: как выглядит упражнение, шаги и видео — до того, как добавить.
function previewEx(id, onPick) {
  const e = E(id) || LIB[id];
  let el = $('#pv'); if (!el) { el = document.createElement('div'); el.id = 'pv'; el.className = 'pv'; document.body.appendChild(el); }
  el.innerHTML = `<div class="pvcard"><div class="row"><h2>${esc(e.name)}</h2><button class="back" id="pvx" aria-label="Закрыть">×</button></div>
    <div class="figbox" id="pvfig"></div>
    <div class="meta"><span>${esc(e.mus)}</span>${e.eq.length ? `<span>${e.eq.map(x => esc(EQUIP[x] || x)).join(', ')}</span>` : '<span>без инвентаря</span>'}<span>${setsOf(e) > 1 ? setsOf(e) + ' × ' : ''}${range(e)}${e.type === 'reps' ? ' повт.' : ''}</span></div>
    <ol class="steps">${(e.steps || []).map(s => `<li>${esc(s)}</li>`).join('')}</ol>
    <div class="exbtns"><button class="btn ghost" id="pvvid">Видео техники</button><button class="btn" id="pvok">Выбрать</button></div></div>`;
  el.hidden = false;
  if (window.Figure) Figure.mount($('#pvfig'), id, e.eq.includes('bb') ? 'bb' : e.eq.includes('db') ? 'db' : e.eq.includes('kb') ? 'kb' : null);
  const prevBack = backFn;
  const shut = () => { if (window.Figure) Figure.stop(); el.hidden = true; setBack(prevBack); };
  setBack(shut);
  $('#pvx').onclick = shut;
  el.onclick = ev => { if (ev.target === el) shut(); };
  $('#pvvid').onclick = () => openLink('https://www.youtube.com/results?search_query=' + encodeURIComponent(e.video || e.name + ' техника'));
  $('#pvok').onclick = () => { shut(); onPick(id); };
}
const needs = (e, prof) => {
  const p = prof || S.profile, have = availableEq(p), miss = e.eq.filter(x => !have.includes(x));
  return [miss.length ? 'нужно: ' + miss.map(x => EQUIP[x].toLowerCase()).join(', ') : '',
    e.lvl > levelOf(p) ? 'для уровня выше' : '',
    e.needPull && p.pullups < e.needPull ? `когда будешь подтягиваться ${e.needPull}+ раз` : '',
    e.maxPush && p.pushups > e.maxPush ? 'тебе уже легко' : '',
    (e.avoid || []).some(l => p.limits.includes(l)) ? 'нагрузка на больное место' : ''].filter(Boolean).join(', ');
};

/* =================== ЕДА =================== */
const NUMW = { 'один': 1, 'одна': 1, 'одно': 1, 'одну': 1, 'два': 2, 'две': 2, 'пару': 2, 'пара': 2, 'три': 3, 'четыре': 4, 'пять': 5, 'шесть': 6, 'семь': 7, 'восемь': 8, 'девять': 9, 'десять': 10, 'пол': 0.5, 'половину': 0.5, 'половина': 0.5, 'полтора': 1.5, 'полторы': 1.5, 'несколько': 3 };
// Цифры с упаковки прямо в тексте: «греческий йогурт 21 г белка», «батончик 200 ккал», «белок 30».
const MACRO_KEY = w => /^(бел|прот)/.test(w) ? 'p' : /^жир/.test(w) ? 'f' : /^угл/.test(w) ? 'c' : 'k';
function takeMacros(seg) {
  const ov = {}, put = (w, n) => { ov[MACRO_KEY(w)] = Math.min(5000, parseFloat(n.replace(',', '.'))); return ' '; };
  seg = seg.replace(/(\d+(?:[.,]\d+)?)\s*(?:г|гр|грамм(?:а|ов)?)?\.?\s*(белк[а-я]*|белок|протеин[а-я]*|жир[а-я]*|углевод[а-я]*|угл\.?|ккал|калори[а-я]*|кал)(?![а-я])/g, (m, n, w) => put(w, n));
  seg = seg.replace(/(белк[а-я]*|белок|жир[а-я]*|углевод[а-я]*|ккал|калори[а-я]*)\s*[:\-–]?\s*(\d+(?:[.,]\d+)?)\s*(?:г|гр)?(?![а-я])/g, (m, w, n) => put(w, n));
  return { seg, ov };
}
// Ключ из нескольких слов совпадает, если каждое его слово — начало слов подряд в тексте: «котлет кури» = «котлета куриная».
function keyHit(key, words) {
  if (!key.includes(' ')) return words.some(w => w.startsWith(key));
  const kw = key.split(' ');
  for (let i = 0; i + kw.length <= words.length; i++) if (kw.every((k, j) => words[i + j].startsWith(k))) return true;
  return false;
}
function parseFood(text) {
  const items = [], unknown = [];
  const clean = (' ' + text.toLowerCase().replace(/ё/g, 'е').replace(/[()«»"]/g, ' ') + ' ')
    .replace(/\sбез\s+[а-я]+/g, ' ')
    .replace(/\s(я|съел|съела|скушал|скушала|поел|поела|выпил|выпила|сегодня|утром|днем|вечером|на завтрак|на обед|на ужин|примерно|где-то|около|штук[аи]?)(?=\s)/g, ' ');
  const segs = clean.split(/[,;\n+]|\s(?:и|с|со|плюс|ещё|еще|потом|запил|заел)\s/).map(x => x.trim()).filter(Boolean);
  for (let seg0 of segs) {
    let { seg, ov } = takeMacros(' ' + seg0 + ' ');
    let pct = null;
    seg = seg.replace(/(\d+(?:[.,]\d+)?)\s*%/g, (m, n) => { pct = parseFloat(n.replace(',', '.')); return ' '; }); // «творог 5%» — это жирность, не 5 пачек
    seg = seg.trim();
    const words = seg.split(/[^a-zа-я0-9.]+/).filter(Boolean);
    let best = null, bestLen = 0, mod = null;
    for (const f of FOOD_DICT) for (const key of f.keys) {
      if (!keyHit(key, words)) continue;
      if (f.modifier) { mod = f; continue; }
      const sc = key.length + (f.boost || 0); // boost — бренд/уточнение важнее общего слова («батончик bombbar»)
      if (sc > bestLen) { best = f; bestLen = sc; }
    }
    const hasOv = Object.keys(ov).length > 0;
    if (!best) {
      if (hasOv && (ov.k || ov.p)) { // продукта нет в словаре, но цифры сказал — берём их
        const nm = cap(words.filter(w => !/^\d/.test(w)).join(' ')) || 'Своё';
        const pp = ov.p || 0, ff = ov.f || 0, cc = ov.c || 0;
        items.push({ n: nm, k: Math.round(ov.k || pp * 4 + ff * 9 + cc * 4), p: r1(pp), f: r1(ff), c: r1(cc) });
      } else if (/[а-я]{3,}/.test(seg)) unknown.push(seg0);
      continue;
    }
    let f = best;
    if (pct != null && best.v) { // ближайшая жирность
      const v = best.v.slice().sort((x, y) => Math.abs(x[0] - pct) - Math.abs(y[0] - pct))[0];
      f = { ...best, name: `${best.name} ${String(v[0]).replace('.', ',')} %`, k: v[1], p: v[2], f: v[3], c: v[4] };
    }
    let grams = null, count = null, ml = false;
    const mg = seg.match(/(\d+(?:[.,]\d+)?)\s*(кг|г|гр|грамм\S*|мл|л)(?![а-я])/);
    if (mg) { const n = parseFloat(mg[1].replace(',', '.')); grams = /^(кг|л)$/.test(mg[2]) ? n * 1000 : n; ml = /^(мл|л)$/.test(mg[2]); }
    else {
      const mn = seg.match(/(\d+(?:[.,]\d+)?)/);
      if (mn) count = parseFloat(mn[1].replace(',', '.'));
      else { const w = words.find(w => NUMW[w] != null); if (w) count = NUMW[w]; }
    }
    if (grams == null && count == null) count = f.spoonDefault || 1;
    // «20 пельменей» — штуки, а не 20 тарелок; «йогурт 140» — граммы
    if (count != null && count > 6 && f.pc) { grams = count * f.pc; f = { ...f, name: f.name + ` (${count} шт)` }; count = null; }
    else if (count != null && (count >= 30 || (count > 6 && f.ug >= 150))) { grams = count; count = null; }
    if (count != null) count = Math.min(count, 50);
    if (grams != null) grams = Math.min(grams, 5000);
    const it = foodItem(f, count, grams, ml);
    if (hasOv) { // цифры с упаковки важнее словаря
      const was = { ...it };
      for (const key of ['p', 'f', 'c']) if (ov[key] != null) it[key] = r1(ov[key]);
      it.k = ov.k != null ? Math.round(ov.k) : Math.max(0, Math.round(was.k + (it.p - was.p) * 4 + (it.f - was.f) * 9 + (it.c - was.c) * 4));
      it.n += ' · с упаковки';
    }
    items.push(it);
    if (mod) items.push({ ...foodItem(mod, 1, null), n: 'Масло при жарке' });
  }
  return { items, unknown };
}
const MEALS = ['Завтрак', 'Обед', 'Ужин', 'Перекус'];
const mealNow = () => { const h = new Date().getHours(); return h >= 5 && h < 11 ? 0 : h >= 11 && h < 16 ? 1 : h >= 17 && h < 22 ? 2 : 3; };

// «На завтрак 4 яйца, на обед гречка с курицей» — раскладываем по приёмам пищи.
const MEAL_WORDS = { 'завтрак': 0, 'обед': 1, 'ужин': 2, 'перекус': 3, 'полдник': 3 };
function parseFoodMeals(text) {
  const t = ' ' + text.toLowerCase().replace(/ё/g, 'е') + ' ';
  const re = /(?:на\s+)?(?:по)?(завтрак|обед|ужин|перекус|полдник)[а-я]*/g;
  const marks = []; let m;
  while ((m = re.exec(t))) marks.push({ at: m.index, end: m.index + m[0].length, meal: MEAL_WORDS[m[1]] });
  if (!marks.length) return parseFood(text);
  const items = [], unknown = [];
  const take = (chunk, meal) => { if (!chunk.trim()) return; const r = parseFood(chunk); r.items.forEach(x => { if (meal != null) x.m = meal; }); items.push(...r.items); unknown.push(...r.unknown); };
  take(t.slice(0, marks[0].at), null);
  marks.forEach((x, i) => take(t.slice(x.end, i + 1 < marks.length ? marks[i + 1].at : t.length), x.meal));
  return { items, unknown };
}

function renderFood() {
  const G = todayNorms(), A = G.A, it = S.food.items;
  const sum = key => Math.round(it.reduce((s, x) => s + (+x[key] || 0), 0));
  const k = sum('k'), p = sum('p'), fsum = sum('f'), csum = sum('c');
  const pct = (v, g) => Math.min(100, v / g * 100);
  const cup = S.profile.cup || 250, wml = S.food.waterMl ?? (S.food.water || 0) * 250;
  const rec = lsGet('recent') || [], fav = lsGet('fav') || [];
  const quick = fav.map(x => ({ ...x, star: 1 })).concat(rec.filter(r => !fav.some(f => f.n === r.n))).slice(0, 6);
  const net = eatenNet(k, A), left = G.kcal - net, pLeft = G.protein - p;

  // Сводка: съедено минус сожжённое спортом. На шкале сожжённое — зелёная штриховка, «стёртая» с конца съеденного.
  let h = `<h1>Еда</h1>
    <div class="card sum"><div class="row"><div><span class="big">${net}</span><span class="muted"> / ${G.kcal} ккал</span></div><span class="muted">${left > 0 ? 'осталось ' + left : 'норма есть'}</span></div>
    <div class="bar burn ${net > G.kcal * 1.1 && S.profile.goal === 'lose' ? 'over' : ''}"><i style="width:${pct(net, G.kcal)}%"></i>${A.bonus && k ? `<b style="left:${pct(net, G.kcal)}%;width:${pct(k, G.kcal) - pct(net, G.kcal)}%"></b>` : ''}</div>
    ${A.bonus ? `<div class="eqline"><span>съедено ${k}</span><span>−</span><span class="earn">спорт ${A.bonus}</span><span>=</span><b>${net}</b>${A.share < 1 ? '<span>(при похудении — половина)</span>' : ''}</div>` : ''}
    <div class="macros">${[['Белки', p, G.protein, 'p'], ['Жиры', fsum, G.fat, 'f'], ['Углеводы', csum, G.carbs, 'c']].map(([n, v, g, cl]) =>
      `<div><span>${n}</span><b>${v}<small> / ${g} г</small></b><div class="bar thin ${cl}"><i style="width:${pct(v, g)}%"></i></div></div>`).join('')}</div></div>`;

  h += `<div class="card inputcard"><textarea id="ftext" rows="2" placeholder="Что съел? Скажи или напиши: «на завтрак 4 яйца и чай, на обед гречка с курицей»"></textarea>
    <div class="inrow"><button class="icon big" id="fmic" aria-label="Сказать голосом"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>
    <button class="icon big" id="fscan" aria-label="Сканировать штрихкод"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7V5h3M17 5h3v2M20 17v2h-3M7 19H4v-2M8 9v6M11 9v6M14 9v6M17 9v6"/></svg></button>
    <button class="btn" id="fcalc">Посчитать</button></div>
    <p class="muted small" id="fmicHint">${S.meal != null ? `Добавится в «${MEALS[S.meal]}»` : 'Скажи «на завтрак / обед / ужин / перекус» — разложу сама'}</p>
    <div id="fprev"></div>
    ${quick.length ? `<div class="chiprow">${quick.map((r, i) => `<button data-rec="${i}" class="${r.star ? 'fav' : ''}">+ ${esc(r.n)}</button>`).join('')}</div>` : ''}
    ${rec.length || fav.length ? `<button class="link" id="myFood">История и избранное${fav.length ? ' · ' + fav.length + ' ★' : ''}</button>` : ''}</div>`;

  // вода — крупно и видно в любой теме
  h += `<div class="card water"><div class="row"><b>Вода</b><span><b>${r1(wml / 1000)}</b> / ${G.water} л</span></div>
    <div class="wbar"><i style="width:${Math.min(100, wml / G.waterMl * 100)}%"></i></div>
    <div class="wbtns"><button class="btn ghost" id="wMinus" aria-label="Убрать">−</button><button class="btn wplus" id="wPlus">+ ${cup >= 1000 ? cup / 1000 + ' л' : cup + ' мл'}</button>
    <select id="cupSel" aria-label="Объём тары">${[...new Set([150, 200, 250, 300, 330, 500, 750, 1000, 1500, cup])].sort((a, b) => a - b).map(v => `<option value="${v}" ${v === cup ? 'selected' : ''}>${v >= 1000 ? v / 1000 + ' л' : v + ' мл'}</option>`).join('')}<option value="custom">своё…</option></select></div>
    ${S.cupEdit ? `<div class="weight"><input id="cupIn" type="number" inputmode="numeric" placeholder="Объём твоей тары, мл"><button id="cupOk">ОК</button></div>` : ''}</div>`;

  // приёмы пищи — всегда все четыре, у каждого «+»
  h += MEALS.map((mn, mi) => {
    const rows = it.map((x, i) => [x, i]).filter(([x]) => (x.m ?? 3) === mi);
    const mk = Math.round(rows.reduce((s, [x]) => s + x.k, 0));
    return `<div class="meal"><div class="mealhd"><b>${mn}</b><span class="muted">${mk ? mk + ' ккал' : ''}</span><button class="addm" data-addm="${mi}" aria-label="Добавить в ${mn}">+</button></div>` +
      (rows.length ? `<ul class="list">${rows.map(([x, i]) => `<li><span>${esc(x.n)}${x.q && x.q !== 1 ? ` <b class="q">×${r1(x.q)}</b>` : ''}</span><em>${Math.round(x.k)}</em>
        <span class="qty"><button data-dec="${i}" aria-label="Меньше">−</button><button data-inc="${i}" aria-label="Больше">+</button></span></li>`).join('')}</ul>` : '') + `</div>`;
  }).join('');

  // идеи правильной еды — всегда
  const m = S.meal ?? mealNow();
  const pool = MEAL_IDEAS.filter(x => x.m === m && (left <= 150 || x.k <= left + 100));
  const list = (pool.length ? pool : MEAL_IDEAS.filter(x => x.m === 3)).sort((a, b) => (pLeft > 20 ? b.p / b.k - a.p / a.k : 0));
  const off = (S.ideaOff || 0) % Math.max(1, list.length);
  const ideas = list.slice(off).concat(list.slice(0, off)).slice(0, 3);
  h += `<div class="row" style="margin-top:22px"><h3 style="margin:0">Идеи на ${MEALS[m].toLowerCase()}</h3><button class="link" id="moreIdeas">Ещё</button></div>
    <div class="ideas">${ideas.map(x => `<button data-idea="${MEAL_IDEAS.indexOf(x)}"><b>${esc(x.n)}</b><span>${x.k} ккал · белок ${x.p} г${x.tip ? ' · ' + esc(x.tip) : ''}</span></button>`).join('')}</div>
    <details><summary>Своё с цифрами (с упаковки)</summary>
      <p class="muted">На упаковке цифры на 100 г — впиши их и сколько грамм съел, посчитаю сама. Или просто итог за порцию (тогда граммы оставь пустыми).</p>
      <div class="form2"><input id="fn" placeholder="Название" maxlength="40" class="wide">
      <label>ккал<input id="fk" type="text" inputmode="decimal"></label><label>белки<input id="fp" type="text" inputmode="decimal"></label>
      <label>жиры<input id="ff" type="text" inputmode="decimal"></label><label>углев.<input id="fc" type="text" inputmode="decimal"></label>
      <label class="wide">съел, грамм (если цифры на 100 г)<input id="fg" type="text" inputmode="numeric" placeholder="—"></label></div>
      <button class="btn" id="fadd">Добавить</button></details>
    <details id="wkd"><summary>Последние 7 дней</summary><div id="fweek" class="muted">Считаю…</div></details>`;
  $('#screen').innerHTML = h;
  $('#wkd').ontoggle = () => { if ($('#wkd').open) foodWeek(G); };

  if (S.parsed) showParsed();
  if (S.scanned) showScanned();
  const ta = $('#ftext');
  $('#fcalc').onclick = () => { const t = ta.value.trim(); if (!t) { ta.focus(); toast('Напиши или скажи, что съел'); return; } S.parsed = parseFoodMeals(t); S.scanned = null; showParsed(); };
  $('#fmic').onclick = startVoice;
  $('#fscan').onclick = startScan;
  $$('[data-addm]').forEach(b => b.onclick = () => { S.meal = +b.dataset.addm; renderFood(); scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(() => $('#ftext') && $('#ftext').focus(), 300); });
  $$('[data-rec]').forEach(b => b.onclick = () => { const r = quick[+b.dataset.rec]; addFood([{ n: r.n, k: r.k, p: r.p, f: r.f || 0, c: r.c || 0 }]); });
  const mf = $('#myFood'); if (mf) mf.onclick = () => openMyFood();
  $$('[data-idea]').forEach(b => b.onclick = () => { const x = MEAL_IDEAS[+b.dataset.idea]; addFood([{ n: x.n, k: x.k, p: x.p, f: x.f, c: x.c, m }]); });
  $('#moreIdeas').onclick = () => { S.ideaOff = (S.ideaOff || 0) + 3; renderFood(); };
  const setW = v => { S.food.waterMl = Math.max(0, v); delete S.food.water; saveFood(); haptic(); renderFood(); checkAch(); };
  $('#wPlus').onclick = () => setW(wml + cup);
  $('#wMinus').onclick = () => setW(wml - cup);
  $('#cupSel').onchange = ev => {
    const v = ev.target.value;
    if (v === 'custom') { S.cupEdit = true; renderFood(); const ci = $('#cupIn'); if (ci) ci.focus(); return; }
    S.cupEdit = false; S.profile.cup = +v; Store.set('profile', S.profile); haptic(); renderFood();
  };
  const cok = $('#cupOk'); if (cok) cok.onclick = () => {
    const v = parseInt($('#cupIn').value, 10);
    if (!(v >= 50 && v <= 3000)) { toast('Введи объём от 50 до 3000 мл'); return; }
    S.cupEdit = false; S.profile.cup = v; Store.set('profile', S.profile); notify(); renderFood();
  };
  $('#fadd').onclick = () => {
    const num = id => Math.max(0, parseFloat(String($('#' + id).value).replace(',', '.')) || 0);
    const g = Math.min(5000, num('fg')), m = g ? g / 100 : 1;
    const n = ($('#fn').value.trim() || 'Своё') + (g ? `, ${g} г` : '');
    const kk = num('fk') * m, pr = num('fp') * m, ff = num('ff') * m, cc = num('fc') * m;
    if (!kk && !pr) { toast('Впиши хотя бы калории'); return; }
    addFood([{ n, k: Math.round(Math.min(kk || pr * 4 + ff * 9 + cc * 4, 5000)), p: r1(Math.min(pr, 300)), f: r1(ff), c: r1(cc) }]);
  };
  const scale = (x, q) => { if (!x.b) { x.b = { k: x.k, p: x.p, f: x.f || 0, c: x.c || 0 }; x.q = 1; } x.q = q; for (const key of ['k', 'p', 'f', 'c']) x[key] = key === 'k' ? Math.round(x.b.k * q) : r1(x.b[key] * q); };
  $$('[data-inc]').forEach(b => b.onclick = () => { const x = it[+b.dataset.inc]; scale(x, (x.q || 1) + 0.5); saveFood(); haptic(); renderFood(); });
  $$('[data-dec]').forEach(b => b.onclick = () => {
    const i = +b.dataset.dec, x = it[i], q = (x.q || 1) - 0.5;
    if (q > 0.01) { scale(x, q); saveFood(); haptic(); renderFood(); return; }
    const snap = JSON.parse(JSON.stringify(it));
    it.splice(i, 1); saveFood(); renderFood();
    toast(`Убрано: ${x.n}`, () => { S.food.items = snap; saveFood(); renderFood(); });
  });
}
// Блок «Активность»: тренировка из приложения считается сама, шаги и другой спорт вписываются руками.
function actSection() {
  const A = dayActivity();
  return sec('act', 'Активность за день', A.total ? `<span class="earn">${A.total} ккал</span>` : 'шаги, бег, велик', activityBody(A), false);
}
function activityBody(A) {
  const st = A.st, base = STEP_BASE[S.profile.activity];
  const rows = [];
  if (A.tr) rows.push(`<li><span>Тренировка в приложении</span><em class="earn">${A.tr}</em></li>`);
  if (A.steps) rows.push(`<li><span>Шаги ${A.steps.toLocaleString('ru')}<br><small class="muted">${st.extra ? `сверх обычных ${base.toLocaleString('ru')}: ${st.extra.toLocaleString('ru')}` : `обычные ${base.toLocaleString('ru')} уже в норме`}</small></span><em class="earn">${st.k}</em></li>`);
  A.acts.forEach((a, i) => rows.push(`<li><span>${esc(ACTS[a.t] ? ACTS[a.t].n : a.t)} · ${a.min} мин</span><em class="earn">${a.k}</em><button data-actdel="${i}" aria-label="Убрать">×</button></li>`));
  const pick = S.actPick;
  return `<div class="act">
    ${rows.length ? `<ul class="list">${rows.join('')}</ul>` : '<p class="muted">Шаги, бег, велик, своя силовая — впиши, и сожжённое вычтется из съеденного во вкладке «Еда». Тренировка из приложения считается сама.</p>'}
    ${A.total && sportToFood() && A.share < 1 ? `<p class="muted small">Ты худеешь — из еды вычитаю половину (${A.bonus}): часы и формулы часто завышают расход.</p>` : ''}
    ${A.total && !sportToFood() ? '<p class="muted small">Вычитание из еды выключено в Профиле.</p>' : ''}
    <div class="weight"><input id="stepsIn" type="text" inputmode="numeric" placeholder="Шаги за день${A.steps ? ' · сейчас ' + A.steps : ''}"><button id="stepsOk">Записать</button></div>
    ${S.actOpen || pick ? `<div class="chiprow acts">${Object.entries(ACTS).map(([t, a]) => `<button data-act-t="${t}" class="${pick === t ? 'on' : ''}">${esc(a.n)}</button>`).join('')}</div>`
      : '<button class="btn ghost sm" id="actOpen">+ Бег, велик, силовая…</button>'}
    ${pick ? `<div class="actadd"><b>${esc(ACTS[pick].n)}: сколько минут?</b><div class="pick4">${[15, 30, 45, 60].map(m => `<button data-actmin="${m}">${m}</button>`).join('')}</div>
      <div class="weight"><input id="actMin" type="text" inputmode="numeric" placeholder="Своё, мин"><button id="actOk">Добавить</button></div></div>` : ''}</div>`;
}
function bindActivity() {
  const save = () => { saveFood(); const y = scrollY; render(); scrollTo(0, y); checkAch(); };
  $('#stepsOk').onclick = () => {
    const v = parseInt(String($('#stepsIn').value).replace(/\s/g, ''), 10);
    if (!(v >= 0 && v <= 100000)) { toast('Впиши шаги числом, например 8500'); return; }
    const pv = S.food.steps; S.food.steps = v; notify(); save();
    toast(`Шаги: ${v.toLocaleString('ru')}`, () => { S.food.steps = pv; save(); });
  };
  const re = () => { const y = scrollY; render(); scrollTo(0, y); };
  const ao = $('#actOpen'); if (ao) ao.onclick = () => { S.actOpen = true; haptic(); re(); };
  $$('[data-act-t]').forEach(b => b.onclick = () => { S.actPick = S.actPick === b.dataset.actT ? null : b.dataset.actT; haptic(); re(); });
  const add = min => {
    if (!(min >= 1 && min <= 600)) { toast('От 1 до 600 минут'); return; }
    S.food.act = (S.food.act || []).concat({ t: S.actPick, min }); const n = ACTS[S.actPick].n; S.actPick = null; S.actOpen = false; notify(); save();
    toast(`${n} · ${min} мин добавлено`, () => { S.food.act.pop(); save(); });
  };
  $$('[data-actmin]').forEach(b => b.onclick = () => add(+b.dataset.actmin));
  const ok = $('#actOk'); if (ok) ok.onclick = () => add(parseInt($('#actMin').value, 10));
  $$('[data-actdel]').forEach(b => b.onclick = () => {
    const i = +b.dataset.actdel, x = S.food.act[i]; S.food.act.splice(i, 1); save();
    toast('Убрано', () => { S.food.act.splice(i, 0, x); save(); });
  });
}
function addFood(list) {
  const m = S.meal ?? mealNow();
  list.forEach(x => { if (x.m == null) x.m = m; });
  S.food.items.push(...list); saveFood(); S.meal = null;
  if (lsGet('foodDayLast') !== S.today) { lsSet('foodDays', (lsGet('foodDays') || 0) + 1); lsSet('foodDayLast', S.today); } // для достижения
  let rec = lsGet('recent') || [];
  list.forEach(x => { rec = rec.filter(r => r.n !== x.n); rec.unshift({ n: x.n, k: x.k, p: x.p, f: x.f || 0, c: x.c || 0 }); });
  rec = rec.slice(0, 30); Store.set('recent', rec); lsSet('recent', rec);
  notify(); renderFood(); checkAch();
  const n = list.length;
  toast(n === 1 ? `Добавлено: ${list[0].n}` : `Добавлено ${n} ${plural(n, 'блюдо', 'блюда', 'блюд')}`, () => { S.food.items.splice(S.food.items.length - n, n); saveFood(); renderFood(); });
}
function showParsed() {
  const { items, unknown } = S.parsed;
  const t = key => Math.round(items.reduce((s, x) => s + (+x[key] || 0), 0));
  let h = `<div class="prev">`;
  const dm = S.meal ?? mealNow();
  if (items.length) h += `<ul class="list">${items.map((x, i) => `<li><span><small class="mtag">${MEALS[x.m ?? dm]}</small> ${esc(x.n)}</span><em>${x.k} ккал</em><button data-pdel="${i}" aria-label="Убрать">×</button></li>`).join('')}</ul>
    <div class="row" style="margin-top:8px"><b>Итого ${t('k')} ккал</b><span class="muted">Б ${t('p')} · Ж ${t('f')} · У ${t('c')} г</span></div>`;
  if (unknown.length) h += `<p class="muted">Не знаю: «${unknown.map(esc).join('», «')}». Впиши это ниже в «Своё с цифрами» (калории есть на упаковке).</p>`;
  if (!items.length && !unknown.length) h += `<p class="muted">Ничего не понял. Пиши через запятую: «2 яйца, гречка 200 г».</p>`;
  if (items.length) h += `<div class="exbtns"><button class="btn" id="padd">Добавить</button><button class="btn ghost" id="pcancel">Отмена</button></div>`;
  h += `<p class="muted">Цифры примерные: «штука/тарелка» — средняя порция. Точнее — граммы: «гречка 200 г».</p></div>`;
  $('#fprev').innerHTML = h;
  $$('[data-pdel]').forEach(b => b.onclick = () => { items.splice(+b.dataset.pdel, 1); showParsed(); });
  const a = $('#padd'); if (a) a.onclick = () => { const l = items.slice(); S.parsed = null; addFood(l); };
  const c = $('#pcancel'); if (c) c.onclick = () => { S.parsed = null; $('#fprev').innerHTML = ''; };
}
// История и избранное: не надо сканировать и писать заново — нашёл, нажал «+», отметил звёздочкой.
function openMyFood() {
  const sh = $('#sheet');
  const draw = () => {
    const rec = lsGet('recent') || [], fav = lsGet('fav') || [];
    const q = norm(($('#mfq') && $('#mfq').value) || '').trim();
    const row = (x, isFav) => `<li><span>${esc(x.n)}<br><small class="muted">${Math.round(x.k)} ккал · Б ${r1(x.p || 0)} · Ж ${r1(x.f || 0)} · У ${r1(x.c || 0)}</small></span>
      <button class="star ${isFav ? 'on' : ''}" data-star="${esc(x.n)}" aria-label="${isFav ? 'Убрать из избранного' : 'В избранное'}">${isFav ? '★' : '☆'}</button><button class="padd" data-mfadd="${esc(x.n)}" aria-label="Добавить">+</button></li>`;
    const hit = x => !q || norm(x.n).includes(q);
    const fl = fav.filter(hit), rl = rec.filter(x => hit(x) && !fav.some(f => f.n === x.n));
    $('#mfl').innerHTML = (fl.length ? `<h3>Избранное</h3><ul class="list mf">${fl.map(x => row(x, true)).join('')}</ul>` : '') +
      (rl.length ? `<h3>Недавнее</h3><ul class="list mf">${rl.map(x => row(x, false)).join('')}</ul>` : '') +
      (!fl.length && !rl.length ? '<p class="muted">Ничего не нашла.</p>' : '') +
      (!fav.length ? '<p class="muted small">Нажми ☆ у того, что ешь часто, — оно будет первым в быстрых кнопках.</p>' : '');
    const find = n => fav.find(x => x.n === n) || rec.find(x => x.n === n);
    $$('[data-star]', sh).forEach(b => b.onclick = () => {
      const n = b.dataset.star, f2 = lsGet('fav') || [], on = f2.some(x => x.n === n);
      const nf = on ? f2.filter(x => x.n !== n) : [find(n)].concat(f2).slice(0, 30);
      lsSet('fav', nf); Store.set('fav', nf); haptic(); draw();
    });
    $$('[data-mfadd]', sh).forEach(b => b.onclick = () => { const x = find(b.dataset.mfadd); close(); addFood([{ n: x.n, k: x.k, p: x.p, f: x.f || 0, c: x.c || 0 }]); });
  };
  sh.innerHTML = `<div class="exhead"><button class="back" id="mfback" aria-label="Назад">←</button><div><small>Еда</small><h2>История и избранное</h2></div></div>
    <div class="psearch"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input id="mfq" type="search" placeholder="Поиск: йогурт, гречка…" autocomplete="off"></div>
    <div id="mfl"></div>`;
  sh.hidden = false; sh.scrollTop = 0; sh.dataset.ex = '';
  const close = () => { sh.hidden = true; setBack(null); renderFood(); };
  $('#mfback').onclick = close; setBack(close);
  $('#mfq').oninput = draw; draw();
}

/* ---------- поделиться тренировкой и вставить чужую ---------- */
const BOT = 'vlad_trenererer_bot';
const b64e = t => btoa(unescape(encodeURIComponent(t))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64d = t => decodeURIComponent(escape(atob(t.replace(/-/g, '+').replace(/_/g, '/'))));
function packWorkout(w) {
  const ids = MAIN(w.list);
  const ns = ids.map(id => setsOf(E(id)));
  return 'w' + b64e(['1', (w.cname || w.name).slice(0, 40), ids.join('.'), ns.join('.')].join('~'));
}
function unpackWorkout(code) {
  try {
    const [v, name, ids, ns] = b64d(code.replace(/^w_?/, '')).split('~');
    if (v !== '1') return null;
    const list = ids.split('.').filter(id => LIB[id]);
    if (!list.length) return null;
    const sets = {}; (ns || '').split('.').forEach((n, i) => { const id = ids.split('.')[i]; if (LIB[id] && +n) sets[id] = Math.min(8, +n); });
    return { name: name || 'Тренировка', list, sets };
  } catch (e) { return null; }
}
function shareWorkout(w) {
  const code = packWorkout(w);
  const link = `https://t.me/${BOT}?startapp=${code}`;
  const text = `Моя тренировка «${w.cname || w.name}» — ${MAIN(w.list).length} упр, ~${workoutMin(w.list)} мин. Открой и добавь к себе:`;
  try { navigator.clipboard && navigator.clipboard.writeText(text + '\n' + link); } catch (e) {}
  if (inTG && tg.openTelegramLink) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  else if (navigator.share) navigator.share({ text, url: link }).catch(() => {});
  toast('Ссылка скопирована — отправь другу');
}
function sharedCode() {
  const sp = (inTG && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || new URLSearchParams(location.search).get('tgWebAppStartParam') || new URLSearchParams(location.search).get('startapp') || '';
  return /^w/.test(sp) ? sp : null;
}
function checkShared() {
  const code = sharedCode(); if (!code || lsGet('sharedDone') === code) return;
  lsSet('sharedDone', code);
  const w = unpackWorkout(code); if (w) showImport(w);
}
function openImport() {
  const sh = $('#sheet');
  sh.innerHTML = `<div class="exhead"><button class="back" id="imback" aria-label="Назад">←</button><div><small>План</small><h2>Тренировка от друга</h2></div></div>
    <p class="muted">Вставь сообщение со ссылкой, которое тебе прислали (кнопка «Поделиться тренировкой» в Плане).</p>
    <textarea id="imtext" rows="4" placeholder="Вставь сюда сообщение или ссылку"></textarea>
    <button class="btn" id="imgo">Показать тренировку</button>`;
  sh.hidden = false; sh.scrollTop = 0; sh.dataset.ex = '';
  const close = () => { sh.hidden = true; setBack(null); renderPlan(); };
  $('#imback').onclick = close; setBack(close);
  $('#imgo').onclick = () => {
    const m = $('#imtext').value.match(/startapp=(w[A-Za-z0-9_-]+)/) || $('#imtext').value.match(/\b(w[A-Za-z0-9_-]{12,})/);
    const w = m && unpackWorkout(m[1]);
    if (!w) { toast('Не вижу тут тренировку. Скопируй сообщение целиком.'); return; }
    showImport(w);
  };
}
function showImport(w) {
  const sh = $('#sheet');
  sh.innerHTML = `<div class="exhead"><button class="back" id="imback" aria-label="Назад">←</button><div><small>Тебе прислали тренировку</small><h2>${esc(w.name)}</h2></div></div>
    <ul class="list">${w.list.map(id => `<li><span>${esc(LIB[id].name)}</span><em>${w.sets[id] || setsOf(LIB[id])} × ${range(LIB[id])}</em></li>`).join('')}</ul>
    <p class="muted small">Добавлю как твою тренировку на «любой день». Чего нет в твоём зале — заменишь в Плане.</p>
    <div class="actionbar"><button class="btn big" id="imadd">Добавить к себе</button></div>`;
  sh.hidden = false; sh.scrollTop = 0; sh.dataset.ex = '';
  const close = () => { sh.hidden = true; setBack(null); render(); };
  $('#imback').onclick = close; setBack(close);
  $('#imadd').onclick = () => {
    const id = 'c' + Date.now().toString(36);
    S.program.workouts.push({ id, name: w.name, cname: w.name, custom: true, weekday: null, list: ['warmup', ...w.list, 'stretch'], extra: [] });
    // берём подходы автора только там, где они отличаются от обычных, и не трогаем свои числа человека
    S.program.nsets = S.program.nsets || {};
    Object.entries(w.sets).forEach(([k, v]) => { if (S.program.nsets[k] == null && v !== setsOf(E(k))) S.program.nsets[k] = v; });
    saveProgram(); notify(); sh.hidden = true; setBack(null);
    S.tab = 'plan'; $$('.tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === 'plan')); render();
    toast(`«${w.name}» добавлена в План`);
  };
}

async function foodWeek(G) {
  const keys = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); keys.push('f_' + dateKey(d)); }
  const all = await Store.getMany(keys.filter(k => k !== 'f_' + S.today));
  all['f_' + S.today] = S.food;
  const days = keys.map(k => { const f = all[k]; return { d: k.slice(2), k: f ? f.items.reduce((s, x) => s + x.k, 0) : 0, p: f ? f.items.reduce((s, x) => s + x.p, 0) : 0 }; });
  const logged = days.filter(x => x.k > 0);
  const el = $('#fweek'); if (!el) return;
  if (!logged.length) { el.textContent = 'Записывай еду несколько дней — тут появятся средние цифры.'; return; }
  const ak = Math.round(logged.reduce((s, x) => s + x.k, 0) / logged.length), ap = Math.round(logged.reduce((s, x) => s + x.p, 0) / logged.length);
  const lose = S.profile.goal === 'lose';
  const advice = lose ? (ak > G.kcal * 1.1 ? 'В среднем выше нормы — вес будет стоять.' : ap < G.protein * 0.8 ? 'Калории в норме, белка мало — мышцы могут уходить.' : 'Отлично, так держать.')
    : (ak < G.kcal * 0.85 ? 'Недоедаешь — мышцам не из чего расти. Добавь перекус.' : ap < G.protein * 0.8 ? 'Калорий хватает, белка мало — творог, яйца, курица.' : 'Отлично, так держать.');
  el.innerHTML = `<div class="weekbars">${days.map(x => `<div><i style="height:${Math.min(100, x.k / G.kcal * 100)}%" class="${Math.abs(x.k - G.kcal) <= G.kcal * 0.1 ? 'ok' : ''}"></i><span>${WD[fromKey(x.d).getDay()]}</span></div>`).join('')}</div>
    <p>В среднем: <b>${ak} ккал</b> и <b>${ap} г белка</b> (записано ${logged.length} из 7 дней). ${advice}</p>`;
}

/* ---------- голосовой ввод ---------- */
let recog = null;
function startVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const hint = $('#fmicHint'), ta = $('#ftext'), mic = $('#fmic');
  if (!SR) {
    hint.textContent = 'В этом телефоне голос внутри Телеграма не поддерживается. Нажми на поле и скажи через микрофон на клавиатуре — потом «Посчитать».';
    ta.focus(); return;
  }
  if (recog) { recog.stop(); return; }
  recog = new SR(); recog.lang = 'ru-RU'; recog.interimResults = true; recog.maxAlternatives = 1;
  const before = ta.value ? ta.value.trim() + ', ' : '';
  mic.classList.add('rec'); hint.textContent = 'Слушаю… Скажи, что съел. Например: «четыре яйца и две сосиски».'; haptic('medium');
  recog.onresult = ev => {
    const txt = [...ev.results].map(r => r[0].transcript).join(' ');
    ta.value = before + txt;
    if (ev.results[ev.results.length - 1].isFinal) { S.parsed = parseFoodMeals(ta.value); S.scanned = null; showParsed(); }
  };
  recog.onerror = ev => { hint.textContent = ev.error === 'not-allowed' ? 'Нет доступа к микрофону. Можно сказать через микрофон на клавиатуре.' : 'Не расслышал. Попробуй ещё раз или скажи через клавиатуру.'; };
  recog.onend = () => { mic.classList.remove('rec'); recog = null; if (hint.textContent.startsWith('Слушаю')) hint.textContent = ''; };
  try { recog.start(); } catch (e) { recog = null; mic.classList.remove('rec'); hint.textContent = 'Голос не включился. Скажи через микрофон на клавиатуре.'; }
}

/* ---------- штрихкод ---------- */
let scanner = null;
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
async function startScan() {
  $('#scan').hidden = false; $('#scanMsg').textContent = 'Наведи камеру на штрихкод (полоски на упаковке)';
  setBack(stopScan);
  try {
    if (!window.Html5Qrcode) await loadScript('https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js');
    const F = window.Html5QrcodeSupportedFormats;
    scanner = new Html5Qrcode('scanView', { formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E], verbose: false });
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 140 } }, code => { stopScan(); lookup(code); }, () => {});
  } catch (e) {
    $('#scanMsg').textContent = 'Не получилось включить камеру. Разреши камеру для Телеграма в настройках телефона.';
  }
}
async function stopScan() { $('#scan').hidden = true; setBack(null); const s = scanner; scanner = null; try { if (s) { await s.stop(); s.clear(); } } catch (e) {} }
$('#scanClose').onclick = stopScan;
async function lookup(code) {
  notify(); S.parsed = null; S.scanned = { code, loading: true }; renderFood();
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,product_name_ru,brands,nutriments,serving_quantity,status`);
    const j = await r.json();
    const n = j.product && j.product.nutriments;
    const kcal = n && (n['energy-kcal_100g'] ?? (n.energy_100g ? n.energy_100g / 4.184 : null));
    S.scanned = j.status !== 1 || kcal == null ? { code, notFound: true } : {
      code, name: [j.product.product_name_ru || j.product.product_name, j.product.brands].filter(Boolean).join(' · ').slice(0, 40) || 'Продукт ' + code,
      k100: kcal, p100: n.proteins_100g || 0, f100: n.fat_100g || 0, c100: n.carbohydrates_100g || 0, grams: Math.round(j.product.serving_quantity) || 100 };
  } catch (e) { S.scanned = { code, error: true }; }
  showScanned();
}
function showScanned() {
  const s = S.scanned, el = $('#fprev'); if (!el || !s) return;
  if (s.loading) { el.innerHTML = `<div class="prev muted">Ищу продукт ${esc(s.code)}…</div>`; return; }
  if (s.notFound || s.error) {
    el.innerHTML = `<div class="prev"><p>${s.error ? 'Нет связи с базой продуктов.' : `Продукта ${esc(s.code)} нет в базе.`} Посмотри калории и белок на упаковке и впиши в «Своё с цифрами».</p><button class="btn ghost" id="sok">Ок</button></div>`;
    $('#sok').onclick = () => { S.scanned = null; el.innerHTML = ''; };
    return;
  }
  el.innerHTML = `<div class="prev"><b>${esc(s.name)}</b><p class="muted">На 100 г: ${Math.round(s.k100)} ккал · Б ${r1(s.p100)} · Ж ${r1(s.f100)} · У ${r1(s.c100)}</p>
    <div class="weight"><input id="sg" type="number" inputmode="numeric" value="${s.grams}"><button id="sadd">Добавить, г</button></div>
    <button class="btn ghost" id="scancel">Отмена</button></div>`;
  $('#sadd').onclick = () => {
    const g = Math.min(5000, +$('#sg').value || 0); if (!g) return;
    const item = { n: `${s.name}, ${g} г`, k: Math.round(s.k100 * g / 100), p: r1(s.p100 * g / 100), f: r1(s.f100 * g / 100), c: r1(s.c100 * g / 100) };
    S.scanned = null; addFood([item]);
  };
  $('#scancel').onclick = () => { S.scanned = null; el.innerHTML = ''; };
}

/* =================== ПРОГРЕСС =================== */
function weekStart(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function weekStreak(dates) { // недель подряд с хотя бы одной тренировкой; текущая неделя не обрывает серию
  const mon = weekStart(); let streak = 0;
  for (let i = 0; i < 260; i++) {
    const a = new Date(mon); a.setDate(mon.getDate() - 7 * i);
    const b = new Date(a); b.setDate(a.getDate() + 6);
    if (dates.some(d => d >= dateKey(a) && d <= dateKey(b))) streak++; else if (i > 0) break;
  }
  return streak;
}
async function renderProgress() {
  const dates = trainedDates(), full = fullDates(), mon = weekStart();
  const part = dates.length - full.length;
  const wk = dates.filter(d => d >= dateKey(mon)), wkFull = wk.filter(d => isFull(S.history[d])).length;
  const planW = S.program.workouts.filter(w => w.weekday != null).length || S.program.workouts.length;
  const streak = weekStreak(dates);
  const lastW = S.weights.length ? S.weights[S.weights.length - 1] : null;
  checkAch();

  let h = `<h1>Прогресс</h1><p class="sub">Всё сохраняется навсегда, ничего не сбрасывается.</p>
    <div class="stats"><div><b>${full.length}</b><span>${plural(full.length, 'полная тренировка', 'полные тренировки', 'полных тренировок')}</span>${part ? `<small class="parttag">+${part} неполн.</small>` : ''}</div>
    <div><b>${wkFull}/${planW}</b><span>на этой неделе</span>${wk.length > wkFull ? `<small class="parttag">+${wk.length - wkFull} неполн.</small>` : ''}</div><div><b>${streak}</b><span>${plural(streak, 'неделя', 'недели', 'недель')} подряд</span></div></div>
    <h3>Последние 4 недели</h3><div class="heat">${heatmap(dates)}</div>
    <div class="legend"><span><i class="on"></i>полная</span><span><i class="half"></i>неполная</span></div>
    <details><summary>Нагрузка по мышцам за неделю</summary>${muscleVolume(wk)}</details>
    ${achHTML()}
    <h3>Вес (раз в неделю, утром натощак)</h3>
    <div class="weight"><input id="wIn" type="text" inputmode="decimal" placeholder="${lastW ? lastW.w : S.profile.weight}"><button id="wSave">Записать</button></div>
    <canvas id="chart"></canvas><p class="muted">${weightAdvice()}</p>
    <details><summary>Замеры тела, см</summary>
    <div class="meas">${MEAS.map(([k, n]) => `<label>${n}<input data-ms="${k}" type="text" inputmode="decimal" placeholder="${lastMeas(k) ?? ''}"></label>`).join('')}</div>
    <button class="btn ghost" id="mSave">Записать замеры</button>
    ${S.meas.length ? `<ul class="list">${S.meas.slice().reverse().slice(0, 6).map(m => `<li><span><b>${fmtDate(m.d)}</b> ${MEAS.filter(([k]) => m[k]).map(([k, n]) => `${n.toLowerCase()} ${m[k]}`).join(' · ')}</span></li>`).join('')}</ul>` : '<p class="muted">Сантиметровая лента: талия по пупку, грудь по соскам, бицепс, предплечье и бедро — в самом широком месте, мышца расслаблена. Раз в 2 недели.</p>'}</details>
    <details><summary>Рекорды по упражнениям</summary><ul class="list">${Object.keys(LIB).filter(id => !['warmup', 'stretch'].includes(id)).map(id => [id, exStats(id)]).filter(([, s]) => s.sessions)
      .map(([id, s]) => `<li><span>${esc(LIB[id].name)}</span><em>${s.sessions}× · рекорд ${s.bestKg ? s.bestKg + ' кг' : s.best + unit(LIB[id])}</em></li>`).join('') || '<li><span class="muted">Появятся после первой тренировки.</span></li>'}</ul></details>
    <details><summary>История тренировок</summary><ul class="list">${dates.slice().reverse().slice(0, 40).map(d => {
      const w = S.history[d], name = (w.wid && W(w.wid) && W(w.wid).name) || w.name || 'Тренировка';
      const parts = Object.entries(w.sets).filter(([id, v]) => LIB[id] && !['warmup', 'stretch'].includes(id) && v.some(x => x != null))
        .map(([id, v]) => { const kg = ((w.kg || {})[id] || []).filter(x => x != null); return `${LIB[id].name.split(' ')[0].toLowerCase()} ${kg.length ? Math.max(...kg) + 'кг×' : ''}${v.filter(x => x != null).join('/')}`; });
      const c = completion(w);
      return `<li><span><b>${fmtDate(d)}</b> ${esc(name)}${c < 0.85 ? ` <small class="parttag">неполная · ${Math.round(c * 100)} %</small>` : ''}<br><span class="muted small">${esc(parts.join(' · ') || 'разминка')}</span>${w.feel != null ? ' · ' + FEEL[w.feel].toLowerCase() : ''}</span></li>`;
    }).join('') || '<li><span class="muted">Первая тренировка появится здесь.</span></li>'}</ul></details>`;
  $('#screen').innerHTML = h;
  drawChart();
  $('#wSave').onclick = () => {
    const w = parseFloat(String($('#wIn').value).replace(',', '.'));
    if (!(w >= 30 && w <= 250)) { notify('error'); return; }
    S.weights = S.weights.filter(x => x.d !== S.today).concat({ d: S.today, w }).sort((a, b) => a.d < b.d ? -1 : 1);
    Store.set('weights', S.weights); notify(); renderProgress(); checkAch();
  };
  $('#mSave').onclick = () => {
    const m = { d: S.today };
    $$('[data-ms]').forEach(i => { const v = parseFloat(String(i.value).replace(',', '.')); if (v > 5 && v < 250) m[i.dataset.ms] = v; });
    if (Object.keys(m).length < 2) { notify('error'); return; }
    S.meas = S.meas.filter(x => x.d !== S.today).concat(m).sort((a, b) => a.d < b.d ? -1 : 1);
    Store.set('meas', S.meas); notify(); renderProgress();
  };
}
const MEAS = [['waist', 'Талия'], ['chest', 'Грудь'], ['biceps', 'Бицепс'], ['forearm', 'Предплечье'], ['thigh', 'Бедро']];
const lastMeas = k => { for (let i = S.meas.length - 1; i >= 0; i--) if (S.meas[i][k]) return S.meas[i][k]; return null; };
function muscleVolume(weekDates) {
  const vol = {};
  for (const d of weekDates) for (const [id, v] of Object.entries(S.history[d].sets || {})) {
    const e = LIB[id]; if (!e || ['warmup', 'stretch'].includes(id)) continue;
    const n = v.filter(x => x != null).length; if (!n) continue;
    e.mus.split(', ').forEach(g => vol[g] = (vol[g] || 0) + n);
  }
  const rows = Object.entries(vol).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '<p class="muted">Пока нет подходов на этой неделе.</p>';
  const max = Math.max(10, ...rows.map(r => r[1]));
  return `<div class="vol">${rows.map(([g, n]) => `<div><span>${esc(g)}</span><i style="width:${n / max * 100}%"></i><b>${n}</b></div>`).join('')}</div>
    <p class="muted">Для роста мышцы нужно примерно 10+ подходов на группу в неделю.</p>`;
}
function heatmap(dates) {
  const set = new Set(dates), start = weekStart(); start.setDate(start.getDate() - 21);
  let h = WEEK.map(d => `<i class="hd">${WD[d]}</i>`).join('');
  for (let i = 0; i < 28; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i); const k = dateKey(d);
    const st = set.has(k) ? (isFull(S.history[k]) ? 'on' : 'half') : '';
    h += `<i class="${st} ${k === S.today ? 'now' : ''} ${k > S.today ? 'fut' : ''}"${st === 'half' ? ` style="--p:${Math.round(completion(S.history[k]) * 100)}%"` : ''}>${d.getDate()}</i>`;
  }
  return h;
}
function weightAdvice() {
  const w = S.weights, p = S.profile;
  if (w.length < 2) return `Старт — ${p.weight} кг. Взвешивайся раз в неделю, утром натощак.`;
  const a = w[Math.max(0, w.length - 3)], b = w[w.length - 1];
  const days = (fromKey(b.d) - fromKey(a.d)) / 864e5 || 1;
  const perWeek = (b.w - a.w) / days * 7;
  const total = `С начала: ${(b.w - p.weight >= 0 ? '+' : '') + r1(b.w - p.weight)} кг.`;
  if (days < 6) return total;
  if (p.goal === 'lose') {
    if (perWeek > -0.1) return `Вес стоит (${perWeek.toFixed(2)} кг/нед). Убери 200 ккал в день: меньше сладкого и жареного. ${total}`;
    if (perWeek < -1) return `Уходит очень быстро (${perWeek.toFixed(2)} кг/нед) — мышцы тоже уйдут. Добавь 200 ккал. ${total}`;
    return `Темп ${perWeek.toFixed(2)} кг/нед — отлично (норма −0,3…−0,8). ${total}`;
  }
  if (p.goal === 'fit') return `Темп ${perWeek >= 0 ? '+' : ''}${perWeek.toFixed(2)} кг/нед. Для формы норма — около нуля. ${total}`;
  if (perWeek < 0.1 && days >= 13) return `Вес стоит (${perWeek.toFixed(2)} кг/нед). Добавь +200 ккал в день: бутерброд с арахисовой пастой или молоко с бананом. ${total}`;
  if (perWeek > 0.6) return `Растёшь быстро (${perWeek.toFixed(2)} кг/нед). Если уходит в живот — убери 200 ккал. ${total}`;
  return `Темп ${perWeek >= 0 ? '+' : ''}${perWeek.toFixed(2)} кг/нед. Норма — +0,25…0,5. ${total}`;
}
function drawChart() {
  const c = $('#chart'); if (!c) return;
  const dpr = window.devicePixelRatio || 1, Wd = c.clientWidth, H = c.clientHeight;
  c.width = Wd * dpr; c.height = H * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement), col = n => css.getPropertyValue(n).trim() || '#888';
  const pts = S.weights.slice(-20), target = +S.profile.target || null;
  const vals = pts.map(p => p.w).concat(target ? [target] : []).concat([S.profile.weight]);
  const lo = Math.min(...vals) - 1, hi = Math.max(...vals) + 1;
  const y = v => H - 18 - (v - lo) / (hi - lo) * (H - 28);
  g.font = '11px system-ui';
  if (target) {
    g.fillStyle = col('--ok'); g.globalAlpha = 0.14; g.fillRect(0, y(target + 0.5), Wd, y(target - 0.5) - y(target + 0.5)); g.globalAlpha = 1;
    g.fillStyle = col('--hint'); g.fillText(`цель ${target} кг`, 6, y(target + 0.5) - 4);
  }
  if (!pts.length) { g.fillStyle = col('--hint'); g.fillText('Тут появится график веса', 6, H / 2); return; }
  const x = i => pts.length === 1 ? Wd / 2 : 14 + i * (Wd - 28) / (pts.length - 1);
  g.strokeStyle = col('--accent'); g.lineWidth = 2.2; g.lineJoin = 'round'; g.beginPath();
  pts.forEach((p, i) => i ? g.lineTo(x(i), y(p.w)) : g.moveTo(x(i), y(p.w))); g.stroke();
  pts.forEach((p, i) => {
    g.fillStyle = col('--accent'); g.beginPath(); g.arc(x(i), y(p.w), 3.5, 0, 7); g.fill();
    if (i === pts.length - 1 || i === 0) { g.fillStyle = col('--text'); g.fillText(p.w, Math.min(Wd - 30, Math.max(2, x(i) - 10)), y(p.w) - 8); }
  });
  g.fillStyle = col('--hint'); g.fillText(fmtDate(pts[0].d), 4, H - 3);
  if (pts.length > 1) g.fillText(fmtDate(pts[pts.length - 1].d), Wd - 34, H - 3);
}

/* =================== СВОИ НОРМЫ =================== */
function normsEditor(p) {
  const c = p.custom || {}, f = norms({ ...p, custom: null });
  const fld = (k, n, ph) => `<label>${n}<input data-norm="${k}" type="text" inputmode="numeric" value="${c[k] || ''}" placeholder="${ph}"></label>`;
  return `<details ${S.normOpen ? 'open' : ''} id="normBox"><summary>Свои нормы КБЖУ</summary>
    <p class="muted">Знаешь свои цифры — от тренера, диетолога или часов? Впиши. Пустое поле — считаю по формуле (серые цифры).</p>
    <div class="form2">${fld('kcal', 'ккал', f.kcal)}${fld('protein', 'белки, г', f.protein)}${fld('fat', 'жиры, г', f.fat)}${fld('carbs', 'углеводы, г', f.carbs)}
    <label class="wide">% жира в теле — если знаешь (весы, замер). Формула станет точнее<input id="bfIn" type="text" inputmode="decimal" value="${p.bodyFat || ''}" placeholder="—"></label></div>
    <button class="btn" id="normSave">Сохранить</button>${p.custom || p.bodyFat ? '<button class="btn ghost" id="normReset">Вернуть всё по формуле</button>' : ''}</details>`;
}
function bindNormsEditor() {
  const box = $('#normBox'); box.ontoggle = () => { S.normOpen = box.open; };
  $('#normSave').onclick = () => {
    const lim = { kcal: [800, 6000], protein: [20, 400], fat: [15, 300], carbs: [0, 900] }, c = {};
    let bad = '';
    $$('[data-norm]').forEach(i => { const v = parseInt(i.value, 10), [lo, hi] = lim[i.dataset.norm]; if (i.value.trim() === '') return; if (v >= lo && v <= hi) c[i.dataset.norm] = v; else bad = `${i.parentElement.firstChild.textContent}: от ${lo} до ${hi}`; });
    const bf = parseFloat(String($('#bfIn').value).replace(',', '.'));
    if ($('#bfIn').value.trim() && !(bf >= 3 && bf <= 60)) bad = '% жира: от 3 до 60';
    if (bad) { toast(bad); notify('error'); return; }
    S.profile.custom = Object.keys(c).length ? c : null; S.profile.bodyFat = bf || null;
    Store.set('profile', S.profile); notify(); toast(Object.keys(c).length ? 'Свои нормы сохранены' : 'Нормы — по формуле'); renderProfile();
  };
  const rs = $('#normReset'); if (rs) rs.onclick = () => { const pc = S.profile.custom, pb = S.profile.bodyFat; S.profile.custom = null; S.profile.bodyFat = null; Store.set('profile', S.profile); renderProfile();
    toast('Вернула нормы по формуле', () => { S.profile.custom = pc; S.profile.bodyFat = pb; Store.set('profile', S.profile); renderProfile(); }); };
}

/* =================== ТЕМЫ =================== */
const THEMES = {
  tg: { n: 'Как в Телеграме' },
  light: { n: 'Светлая', bg: '#f6f5f2', text: '#1d1c1a', hint: '#7d7a73', accent: '#2f7d5b' },
  dark: { n: 'Тёмная', bg: '#161615', text: '#eeede9', hint: '#93908a', accent: '#49a27a' },
  paper: { n: 'Бумага', bg: '#efe6d4', text: '#2b2418', hint: '#85796a', accent: '#b4482d' },
  night: { n: 'Ночь', bg: '#000000', text: '#f0efe9', hint: '#8a8984', accent: '#e8ad3e' },
  forest: { n: 'Лес', bg: '#14211b', text: '#e4ede7', hint: '#8ea497', accent: '#7fcf98' },
  sea: { n: 'Море', bg: '#0f1b26', text: '#e3ecf3', hint: '#8698a8', accent: '#4fb0e8' },
};
const ACCENTS = ['#2f7d5b', '#b4482d', '#e8ad3e', '#4fb0e8', '#8a63d2', '#d6457a', '#3a3a3a', '#6b8e23'];
const lum = hex => { const n = parseInt(hex.slice(1), 16), c = [n >> 16, n >> 8 & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
function applyTheme() {
  const p = S.profile || {}, t = THEMES[p.theme] || THEMES.tg, st = document.documentElement.style;
  ['--bg', '--text', '--hint', '--accent', '--accent-text'].forEach(v => st.removeProperty(v));
  let bg = t.bg, accent = p.accent || t.accent;
  if (t.bg) { st.setProperty('--bg', t.bg); st.setProperty('--text', t.text); st.setProperty('--hint', t.hint); }
  if (accent) { st.setProperty('--accent', accent); st.setProperty('--accent-text', lum(accent) > 0.45 ? '#141414' : '#ffffff'); }
  try { if (tg && bg) { tg.setHeaderColor(bg); tg.setBackgroundColor(bg); if (tg.setBottomBarColor) tg.setBottomBarColor(bg); } else if (tg) { tg.setHeaderColor('bg_color'); tg.setBackgroundColor('bg_color'); } } catch (e) {}
}
function themeEditor() {
  const p = S.profile, cur = p.theme || 'tg';
  return `<details ${S.themeOpen ? 'open' : ''} id="themeBox"><summary>Оформление</summary>
    <div class="themes">${Object.entries(THEMES).map(([k, t]) => `<button data-theme="${k}" class="${cur === k ? 'on' : ''}" style="${t.bg ? `--tb:${t.bg};--tt:${t.text};--ta:${t.accent}` : ''}"><i></i><span>${t.n}</span></button>`).join('')}</div>
    <h3>Свой цвет кнопок</h3>
    <div class="swatches">${ACCENTS.map(c => `<button data-acc="${c}" style="background:${c}" class="${p.accent === c ? 'on' : ''}" aria-label="Цвет ${c}"></button>`).join('')}
      <label class="swpick" aria-label="Любой цвет"><input type="color" id="accPick" value="${p.accent || '#2f7d5b'}">своё</label></div>
    ${p.accent ? '<button class="link" id="accReset">Вернуть цвет темы</button>' : ''}</details>`;
}
function bindThemeEditor() {
  const box = $('#themeBox'); box.ontoggle = () => { S.themeOpen = box.open; };
  const set = (k, v) => { S.profile[k] = v; Store.set('profile', S.profile); applyTheme(); haptic(); renderProfile(); if (v && !S.ach.includes('style')) checkAch(); };
  $$('[data-theme]').forEach(b => b.onclick = () => set('theme', b.dataset.theme === 'tg' ? null : b.dataset.theme));
  $$('[data-acc]').forEach(b => b.onclick = () => set('accent', b.dataset.acc));
  $('#accPick').onchange = ev => set('accent', ev.target.value);
  const r = $('#accReset'); if (r) r.onclick = () => set('accent', null);
}

/* =================== СВОЯ ТРЕНИРОВКА (калькулятор) =================== */
const FOCUS = {
  full: { n: 'Всё тело', pats: ['pull_v', 'squat', 'push_h', 'hinge', 'pull_h', 'lunge', 'core', 'push_v', 'biceps', 'triceps'] },
  upper: { n: 'Верх', pats: ['push_h', 'pull_v', 'push_v', 'pull_h', 'rear', 'biceps', 'triceps', 'delts', 'core'] },
  lower: { n: 'Ноги и ягодицы', pats: ['squat', 'hinge', 'lunge', 'glute', 'calves', 'core', 'squat'] },
  back: { n: 'Спина', pats: ['pull_v', 'pull_h', 'hinge', 'pull_h', 'biceps', 'grip'] },
  chest: { n: 'Грудь и плечи', pats: ['push_h', 'push_v', 'push_h', 'delts', 'rear', 'triceps', 'core'] },
  arms: { n: 'Руки', pats: ['biceps', 'triceps', 'grip', 'biceps', 'triceps', 'delts'] },
  core: { n: 'Пресс', pats: ['core', 'core', 'core', 'glute', 'core'] },
};
const BUILD_PLACES = { none: 'Дома без инвентаря', home: 'Дома с инвентарём', street: 'Улица', gym: 'Зал' };
function buildCustom(cfg) {
  const prof = { ...S.profile, place: cfg.place, equip: cfg.place === 'home' ? (S.profile.equip || []) : [] };
  const n = { 15: 3, 30: 5, 45: 7, 60: 9 }[cfg.min] || 5, chosen = [];
  const pats = FOCUS[cfg.focus].pats;
  for (let i = 0; chosen.length < n && i < pats.length * 3; i++) {
    const c = candidates(pats[i % pats.length], prof).filter(id => !chosen.includes(id));
    if (c.length) chosen.push(c[Math.floor(i / pats.length) % Math.min(3, c.length)] || c[0]);
  }
  return { prof, list: ['warmup', ...chosen, 'stretch'] };
}
function openBuilder(edit) {
  const sh = $('#sheet');
  const B = S.builder = S.builder || { place: S.profile.place, focus: 'full', min: 30, list: null, name: '', day: null };
  if (!B.list) { B.list = buildCustom(B).list; B.name = ''; }
  const prof = { ...S.profile, place: B.place, equip: B.place === 'home' ? (S.profile.equip || []) : [] };
  const auto = `${FOCUS[B.focus].n} · ${BUILD_PLACES[B.place].toLowerCase()}`;
  let h = `<div class="exhead"><button class="back" id="bback" aria-label="Назад">←</button><div><small>Калькулятор тренировок</small><h2>Своя тренировка</h2></div></div>
    <h3>Где</h3><div class="pick2">${Object.entries(BUILD_PLACES).map(([k, n]) => `<button class="opt ${B.place === k ? 'on' : ''}" data-bp="${k}">${n}</button>`).join('')}</div>
    <h3>Что качаем</h3><div class="chips">${Object.entries(FOCUS).map(([k, f]) => `<button class="chip ${B.focus === k ? 'on' : ''}" data-bf="${k}">${f.n}</button>`).join('')}</div>
    <h3>Сколько времени</h3><div class="pick4">${[15, 30, 45, 60].map(m => `<button class="opt ${B.min === m ? 'on' : ''}" data-bm="${m}">${m} мин</button>`).join('')}</div>
    <h3>Упражнения · ~${workoutMin(B.list)} мин · ≈ ${workoutKcal(B.list)} ккал</h3>
    <div class="wsec">${B.list.map((id, i) => LIB[id] ? `<div class="prow"><span class="pname"><b>${esc(LIB[id].name)}</b><span>${esc(LIB[id].mus)}</span></span>
      ${['warmup', 'stretch'].includes(id) ? '' : `<button class="mini" data-bswap="${i}">Заменить</button><button class="mini" data-bdel="${i}" aria-label="Убрать">×</button>`}</div>` : '').join('')}
      <button class="btn ghost sm" id="badd">+ Добавить упражнение</button><button class="link" id="bshuffle">Подобрать другие</button></div>
    <label class="fld">Название<input id="bname" maxlength="30" value="${esc(B.name)}" placeholder="${esc(auto)}"></label>
    <h3>День недели</h3><div class="chips week"><button class="chip ${B.day == null ? 'on' : ''}" data-bd="">любой</button>${WEEK.map(d => `<button class="chip ${B.day === d ? 'on' : ''}" data-bd="${d}">${WD[d]}</button>`).join('')}</div>
    <p class="muted">«Любой» — тренировка лежит в списке и запускается, когда захочешь. С днём — встаёт в план вместо обычной на этот день.</p>
    <div class="actionbar"><div class="exbtns"><button class="btn ghost" id="bnow">Сделать сейчас</button><button class="btn" id="bsave">Сохранить</button></div></div>`;
  sh.innerHTML = h; sh.hidden = false;
  const close = () => { sh.hidden = true; S.builder = null; setBack(null); render(); };
  $('#bback').onclick = close; setBack(close);
  const keepName = () => { B.name = $('#bname').value.trim(); };
  const rebuild = () => { keepName(); B.list = buildCustom(B).list; haptic(); openBuilder(edit); };
  $$('[data-bp]').forEach(b => b.onclick = () => { B.place = b.dataset.bp; rebuild(); });
  $$('[data-bf]').forEach(b => b.onclick = () => { B.focus = b.dataset.bf; rebuild(); });
  $$('[data-bm]').forEach(b => b.onclick = () => { B.min = +b.dataset.bm; rebuild(); });
  $('#bshuffle').onclick = () => { keepName(); const pats = FOCUS[B.focus].pats; B.list = ['warmup', ...MAIN(B.list).map(id => { const c = candidates(LIB[id].pat, prof).filter(x => x !== id && !B.list.includes(x)); return c.length ? c[Math.floor(Math.random() * Math.min(3, c.length))] : id; }), 'stretch']; void pats; haptic(); openBuilder(edit); };
  $$('[data-bdel]').forEach(b => b.onclick = () => { keepName(); B.list.splice(+b.dataset.bdel, 1); haptic(); openBuilder(edit); });
  $$('[data-bswap]').forEach(b => b.onclick = () => { keepName(); const i = +b.dataset.bswap; openPicker(`Заменить «${LIB[B.list[i]].name}»`, LIB[B.list[i]].pat, B.list, id => { B.list[i] = id; openBuilder(edit); }, prof, () => openBuilder(edit)); });
  $('#badd').onclick = () => { keepName(); openPicker('Добавить упражнение', null, B.list, id => { B.list.splice(B.list.length - 1, 0, id); openBuilder(edit); }, prof, () => openBuilder(edit)); };
  $$('[data-bd]').forEach(b => b.onclick = () => { keepName(); B.day = b.dataset.bd === '' ? null : +b.dataset.bd; haptic(); openBuilder(edit); });
  const save = () => {
    keepName();
    if (MAIN(B.list).length < 1) { toast('Добавь хотя бы одно упражнение'); return null; }
    const name = B.name || auto;
    let w = edit && W(edit);
    if (w) Object.assign(w, { list: B.list.slice(), cname: name, weekday: B.day });
    else { w = { id: 'c' + Date.now().toString(36), custom: true, cname: name, weekday: B.day, list: B.list.slice(), extra: [] }; S.program.workouts.push(w); }
    if (B.day != null) S.program.workouts.forEach(x => { if (x !== w && x.weekday === B.day) x.weekday = x.custom ? null : x.weekday; });
    saveProgram(); checkAch(); return w;
  };
  $('#bsave').onclick = () => { const w = save(); if (!w) return; notify(); toast(`«${w.name}» сохранена${w.weekday != null ? ' на ' + WD[w.weekday] : ''}`); close(); };
  $('#bnow').onclick = () => { const w = save(); if (!w) return; S.workout.wid = w.id; S.anyway = true; S.choosing = false; saveWorkout(); notify(); sh.hidden = true; S.builder = null; setBack(null);
    S.tab = 'today'; $$('.tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === 'today')); render(); scrollTo(0, 0); };
}

/* =================== ДОСТИЖЕНИЯ (скрытые, всплывают как в играх) =================== */
function achievements() {
  const dates = trainedDates(), full = fullDates(), best = id => exStats(id).best, p = S.profile;
  const perWeek = {};
  full.forEach(d => { const k = dateKey(weekStart(fromKey(d))); perWeek[k] = (perWeek[k] || 0) + 1; });
  const regular = S.program.workouts.filter(w => w.weekday != null).length || 3;
  const fullWeeks = Object.values(perWeek).filter(n => n >= Math.min(3, regular)).length;
  const diff = curWeight() - p.weight, dir = p.goal === 'lose' ? -1 : 1, target = +p.target;
  const hours = dates.map(d => S.history[d].start).filter(Boolean).map(t => new Date(t).getHours());
  const tonnage = d => { const w = S.history[d]; return Object.entries(w.kg || {}).reduce((s, [id, kg]) => s + kg.reduce((a, x, i) => a + (x && w.sets[id] && w.sets[id][i] ? x * w.sets[id][i] : 0), 0), 0); };
  const gaps = dates.slice(1).some((d, i) => (fromKey(d) - fromKey(dates[i])) / 864e5 >= 14);
  const T = todayNorms(), it = S.food.items, eatP = it.reduce((s, x) => s + (+x.p || 0), 0);
  const wml = S.food.waterMl ?? (S.food.water || 0) * 250;
  return [
    { id: 'first', t: 'Первый шаг', d: 'Сделал первую тренировку', ok: dates.length >= 1 },
    { id: 'fullone', t: 'Без халтуры', d: 'Сделал тренировку целиком, все подходы', ok: full.length >= 1 },
    { id: 't10', t: 'Десятка', d: '10 полных тренировок', ok: full.length >= 10 },
    { id: 't25', t: 'Четверть сотни', d: '25 полных тренировок', ok: full.length >= 25 },
    { id: 't50', t: 'Полтинник', d: '50 полных тренировок', ok: full.length >= 50 },
    { id: 't100', t: 'Сотка', d: '100 полных тренировок', ok: full.length >= 100 },
    { id: 'week', t: 'Неделя по плану', d: 'Все тренировки недели — полностью', ok: fullWeeks >= 1 },
    { id: 'week4', t: 'Месяц дисциплины', d: '4 недели по плану', ok: fullWeeks >= 4 },
    { id: 'streak8', t: 'Не сломался', d: '8 недель подряд с тренировками', ok: weekStreak(dates) >= 8 },
    { id: 'comeback', t: 'Возвращение', d: 'Вернулся после перерыва в 2 недели', ok: gaps },
    { id: 'early', t: 'Ранняя пташка', d: 'Тренировка до 8 утра', ok: hours.some(h => h < 8) },
    { id: 'owl', t: 'Сова', d: 'Тренировка после 22:00', ok: hours.some(h => h >= 22) },
    { id: 'tonne', t: 'Тонна', d: 'Поднял за тренировку больше 1000 кг суммарно', ok: dates.some(d => tonnage(d) >= 1000) },
    { id: 'pullup1', t: 'Первое подтягивание', d: 'Подтянулся хотя бы раз', ok: best('pullup') >= 1 || best('chinup') >= 1 },
    { id: 'pullup10', t: 'Турникмен', d: '10 подтягиваний за подход', ok: best('pullup') >= 10 },
    { id: 'push25', t: '25 отжиманий', d: '25 отжиманий за подход', ok: best('pushup') >= 25 },
    { id: 'hang45', t: 'Железный хват', d: 'Вис 45 секунд', ok: best('hang') >= 45 },
    { id: 'plank60', t: 'Минута в планке', d: 'Планка 60 секунд', ok: best('plank') >= 60 },
    { id: 'kg2', t: p.goal === 'lose' ? 'Минус 2 кг' : 'Плюс 2 кг', d: 'Вес сдвинулся к цели на 2 кг', ok: diff * dir >= 2 && p.goal !== 'fit' },
    { id: 'target', t: 'Цель по весу', d: 'Дошёл до желаемого веса', ok: !!target && (p.goal === 'lose' ? curWeight() <= target : curWeight() >= target) },
    { id: 'food7', t: 'Дневник еды', d: '7 дней записывал еду', ok: (lsGet('foodDays') || 0) >= 7 },
    { id: 'protein', t: 'Белковый день', d: 'Добрал норму белка за день', ok: eatP >= T.protein },
    { id: 'water', t: 'Водный баланс', d: 'Выпил норму воды', ok: wml >= T.waterMl },
    { id: 'steps10k', t: '10 000 шагов', d: 'Прошёл 10 000 шагов за день', ok: (S.food.steps || 0) >= 10000 },
    { id: 'earn300', t: 'Заработал ужин', d: 'Сжёг спортом 300+ ккал за день', ok: T.A.total >= 300 },
    { id: 'builder', t: 'Сам себе тренер', d: 'Собрал свою тренировку', ok: S.program.workouts.some(w => w.custom) },
    { id: 'style', t: 'Со вкусом', d: 'Сменил оформление', ok: !!(p.theme || p.accent) },
  ];
}
const achQ = [];
function checkAch() {
  if (!S.profile || !S.program) return;
  const fresh = achievements().filter(a => a.ok && !S.ach.includes(a.id));
  if (!fresh.length) return;
  S.ach = S.ach.concat(fresh.map(a => a.id)); Store.set('ach', S.ach);
  achQ.push(...fresh); if (achQ.length === fresh.length) setTimeout(showAch, 350);
}
const MEDAL = `<svg viewBox="0 0 120 150" class="medal"><path class="rib" d="M40 8 L52 62 L60 56 L68 62 L80 8"/><path class="rib2" d="M44 8 L80 8"/>
  <path class="disc" d="M60 58 C83 57 99 74 98 97 C97 120 80 136 59 135 C37 134 21 118 22 96 C23 74 39 59 60 58 Z"/>
  <path class="disc in" d="M60 70 C76 70 87 82 86 97 C85 112 74 123 59 122 C45 121 34 110 34 96 C35 81 45 70 60 70 Z"/>
  <path class="star" d="M60 80 L65 92 L78 93 L68 101 L71 114 L60 107 L49 114 L52 101 L42 93 L55 92 Z"/></svg>`;
function showAch() {
  const a = achQ[0]; if (!a) return;
  let el = $('#achPop');
  if (!el) { el = document.createElement('div'); el.id = 'achPop'; el.className = 'achpop'; document.body.appendChild(el); }
  const left = achQ.length - 1;
  el.innerHTML = `<div class="achcard"><div class="achk">Новое достижение</div>${MEDAL}<h2>${esc(a.t)}</h2><p>${esc(a.d)}</p>
    <button class="btn" id="achOk">${left ? `Круто · ещё ${left}` : 'Круто'}</button></div>`;
  el.hidden = false; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  notify(); [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 140), i * 110));
  try { navigator.vibrate && navigator.vibrate([60, 40, 60, 40, 140]); } catch (e) {}
  $('#achOk').onclick = () => { achQ.shift(); el.hidden = true; if (achQ.length) setTimeout(showAch, 200); };
}
function achHTML() {
  const list = achievements(), got = list.filter(a => S.ach.includes(a.id) || a.ok), hid = list.length - got.length;
  return sec('ach', 'Достижения', `${got.length} / ${list.length}`, `<div class="achgrid">${got.map(a => `<div class="achtile on"><b>${esc(a.t)}</b><span>${esc(a.d)}</span></div>`).join('')}
    ${Array(hid).fill('<div class="achtile"><b>?</b><span>скрыто</span></div>').join('')}</div>
    ${hid ? `<p class="muted small">${hid} ${plural(hid, 'достижение скрыто', 'достижения скрыты', 'достижений скрыто')}. Узнаешь, когда получишь.</p>` : ''}`, false);
}

/* =================== ПРОФИЛЬ =================== */
function renderProfile() {
  const p = S.profile, n = norms();
  const eq = availableEq(p);
  let h = `<h1>${esc(p.name || 'Профиль')}</h1><p class="sub">${p.sex === 'm' ? 'Мужчина' : 'Женщина'}, ${p.age} ${plural(p.age, 'год', 'года', 'лет')}, ${p.height} см, ${curWeight()} кг</p>
    <div class="themerow">${Object.entries(THEMES).map(([k, t]) => `<button data-theme="${k}" class="${(S.profile.theme || 'tg') === k ? 'on' : ''}" style="${t.bg ? `--tb:${t.bg};--ta:${t.accent}` : ''}" aria-label="Тема: ${t.n}" title="${t.n}"><i></i></button>`).join('')}<button class="themelink" id="toTheme">Оформление</button></div>
    <h3>Нормы в день</h3>
    <div class="stats"><div><b>${n.kcal}</b><span>ккал</span></div><div><b>${n.protein} г</b><span>белка</span></div><div><b>${n.water} л</b><span>воды</span></div>
    <div><b>${n.fat} г</b><span>жиров</span></div><div><b>${n.carbs} г</b><span>углеводов</span></div><div><b>${levelOf(p) === 1 ? 'новичок' : levelOf(p) === 2 ? 'средний' : 'опытный'}</b><span>уровень</span></div></div>
    ${sec('calc', 'Как посчитано', n.own ? 'свои цифры' : '', `<p class="muted">${n.own ? '<b>Стоят твои цифры.</b> Пустые поля посчитаны по формуле. ' : ''}Базовый обмен по формуле ${n.katch ? `Кетча — МакАрдла (по % жира ${p.bodyFat})` : 'Миффлина — Сан-Жеора'} = <b>${n.bmr} ккал</b> (столько тело тратит в покое). × обычная активность = <b>${n.tdee} ккал</b>. Цель «${GOAL_NAMES[p.goal].toLowerCase()}» → <b>${n.kcal} ккал</b>. ${sportToFood() ? 'Тренировки, шаги и спорт за день вычитаются из съеденного — норма стоит на месте.' : 'Тренировки уже заложены в норму.'} Белок — ${{ gain: 1.8, strength: 1.8, lose: 2, fit: 1.6 }[p.goal]} г на кг веса. Вода — ~33 мл на кг. Нормы пересчитываются, когда записываешь новый вес.</p>`, false)}
    ${normsEditor(p)}
    <details><summary>Спорт и еда</summary><p class="muted">Сжёг на тренировке или пробежке 300 ккал — из съеденного за день вычтется 300 (при похудении — половина).</p>
      <div class="seg" id="s2f"><button data-s2f="1" class="${sportToFood() ? 'on' : ''}">Вычитать из еды</button><button data-s2f="0" class="${sportToFood() ? '' : 'on'}">Не вычитать</button></div></details>
    <details><summary>Подходы в упражнениях</summary><p class="muted">Многие тренируются в 4–5 подходов. «Авто» — как советует методика (обычно 3, новичку в мелких упражнениях — 2). Отдельному упражнению число меняется прямо на его экране: «из 3 − +».</p>
      <div class="seg" id="setsPref">${[0, 3, 4, 5].map(nn => `<button data-sp="${nn}" class="${(p.sets || 0) === nn ? 'on' : ''}">${nn || 'Авто'}</button>`).join('')}</div></details>
    ${themeEditor()}
    <h3>Анкета</h3><ul class="list">
      <li><span>Цель</span><em>${GOAL_NAMES[p.goal]}${p.target ? ', ' + p.target + ' кг' : ''}</em></li>
      <li><span>Активность</span><em>${ACT_NAMES[p.activity].split(' (')[0]}</em></li>
      <li><span>Где</span><em>${PLACES[p.place].name}</em></li>
      <li><span>Инвентарь</span><em>${eq.length ? eq.map(x => EQUIP[x]).join(', ') : 'нет'}</em></li>
      <li><span>Уровень</span><em>${['', 'новичок', 'средний', 'опытный'][levelOf(p)]} (${p.pushups} отж., ${p.pullups} подт.)</em></li>
      <li><span>Дни</span><em>${WEEK.filter(d => p.days.includes(d)).map(d => WD[d]).join(', ')} · ${p.minutes} мин</em></li>
      <li><span>Акценты</span><em>${(p.priority || []).map(k => PRIORITY[k].name).join(', ') || 'нет'}</em></li>
      <li><span>Ограничения</span><em>${(p.limits || []).map(k => LIMITS[k]).join(', ') || 'нет'}</em></li></ul>
    <button class="btn" id="edit">Изменить анкету</button>
    <details><summary>Резервная копия</summary><p class="muted">Данные и так в облаке Телеграма. Копия — на всякий случай: скопируй и сохрани в «Избранное».</p>
    <button class="btn ghost" id="backup">Скопировать все данные</button><div id="bkout"></div></details>
    <p class="muted" style="margin-top:18px">${useCloud ? 'Данные сохраняются в облаке Телеграма.' : 'Открыто не в Телеграме — данные хранятся только в этом браузере.'}</p>`;
  $('#screen').innerHTML = h;
  $('#edit').onclick = () => startOnboarding(true);
  bindNormsEditor(); bindThemeEditor();
  $('#toTheme').onclick = () => { const d = $('#themeBox'); d.open = true; S.themeOpen = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  $$('[data-sp]').forEach(b => b.onclick = () => { const v = +b.dataset.sp; if (v) S.profile.sets = v; else delete S.profile.sets; Store.set('profile', S.profile); haptic(); renderProfile(); toast(v ? `Теперь ${v} ${plural(v, 'подход', 'подхода', 'подходов')} в каждом упражнении` : 'Подходы — как советует методика'); });
  $$('[data-s2f]').forEach(b => b.onclick = () => { S.profile.sportToFood = b.dataset.s2f === '1'; Store.set('profile', S.profile); haptic(); renderProfile(); });
  $('#backup').onclick = async () => {
    const keys = [...await Store.keys('w_'), ...await Store.keys('f_'), 'profile', 'program', 'weights', 'meas', 'recent', 'fav', 'ach'];
    const txt = 'trener-backup ' + JSON.stringify(await Store.getMany(keys));
    try { await navigator.clipboard.writeText(txt); notify(); $('#backup').textContent = `Скопировано (${Math.round(txt.length / 1024)} КБ)`; }
    catch (e) { $('#bkout').innerHTML = `<p class="muted">Скопируй текст вручную:</p><textarea rows="4" readonly>${esc(txt)}</textarea>`; $('#bkout textarea').select(); }
  };
}

load();
