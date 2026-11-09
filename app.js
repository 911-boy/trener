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
  const [profile, program, f, weights, meas, rec, ach] = await Promise.all(
    ['profile', 'program', 'f_' + S.today, 'weights', 'meas', 'recent', 'ach'].map(k => Store.get(k)));
  S.profile = profile; S.program = program;
  if (S.program && (S.program.v || 0) < 4) { S.program.adj = S.program.adj || {}; S.program.v = 4; renameAll(); Store.set('program', S.program); } // старая версия плана
  S.food = f || { date: S.today, items: [], water: 0 };
  S.weights = weights || []; S.meas = meas || []; S.ach = ach || [];
  if (rec) lsSet('recent', rec);
  const keys = await Store.keys('w_');
  const all = await Store.getMany(keys);
  for (const k in all) if (all[k] && all[k].date) S.history[all[k].date] = all[k];
  S.workout = S.history[S.today] || { date: S.today, wid: null, sets: {}, finished: false };
  S.history[S.today] = S.workout;
  if (!S.profile || !S.program) return startOnboarding();
  render();
}
const saveWorkout = () => Store.set('w_' + S.today, S.workout);
const saveFood = () => Store.set('f_' + S.today, S.food);

// Открыли приложение после полуночи — начинаем новый день.
document.addEventListener('visibilitychange', () => { if (!document.hidden && dateKey() !== S.today) location.reload(); });

/* ---------- нормы по анкете ---------- */
const curWeight = () => (S.weights.length ? S.weights[S.weights.length - 1].w : S.profile.weight);
function norms(p = S.profile, w = null) {
  w = w || (p === S.profile ? curWeight() : p.weight);
  const bmr = 10 * w + 6.25 * p.height - 5 * p.age + (p.sex === 'm' ? 5 : -161);
  const act = { low: 1.35, mid: 1.5, high: 1.7 }[p.activity] + Math.min(5, p.days.length) * 0.025;
  const tdee = bmr * act;
  const mult = { gain: 1.12, lose: 0.82, fit: 1, strength: 1.05 }[p.goal];
  const kcal = Math.round(Math.max(bmr * 1.1, tdee * mult) / 50) * 50;
  const protein = Math.round(w * { gain: 1.8, strength: 1.8, lose: 2.0, fit: 1.6 }[p.goal] / 5) * 5;
  const waterMl = Math.round((w * 33 + 300) / 50) * 50; // 33 мл на кг + запас на тренировки
  const water = r1(waterMl / 1000); // литры
  const fat = Math.round(w * (p.goal === 'lose' ? 0.8 : 0.9));
  const carbs = Math.max(50, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), kcal, protein, fat, carbs, water, waterMl };
}
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
  + (e.maxPush && !availableEq(p).length ? 3 : 0) + (e.eq.includes('gym') && levelOf(p) === 1 ? 3 : 0) - (e.iso ? 3 : 0);
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
const plannedFor = d => S.program.workouts.find(w => w.weekday === d.getDay()) || null;

/* ---------- история и статистика ---------- */
const doneVals = (w, id) => ((w.sets || {})[id] || []).filter(v => v != null);
const isTrained = w => w && Object.values(w.sets || {}).some(a => a.some(v => v != null));
const trainedDates = () => Object.keys(S.history).filter(d => isTrained(S.history[d])).sort();
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
  const ws = S.program.workouts, i = ws.findIndex(w => w.id === lastW);
  return ws[(i + 1) % ws.length];
}
const unit = e => e.type === 'time' ? ' с' : '';
const range = e => e.lo === e.hi ? e.lo + unit(e) : `${e.lo}–${e.hi}${unit(e)}`;
const setsOf = e => e.sets || 3;

/* ---------- тренерская логика (см. «Методика тренера (09.11).md») ---------- */
const ISO = ['biceps', 'triceps', 'grip', 'calves', 'delts', 'glute', 'core'];
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
    if (isDeload()) sets = Math.max(1, sets - 1);
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
  'предплечья': 'предплечья', 'хват': 'предплечья', 'пальцы': 'предплечья', 'пресс': 'пресс', 'косые мышцы': 'пресс', 'задняя поверхность': 'задняя поверхность', 'икры': 'ноги' };
function focusOf(list) {
  const cnt = {};
  list.filter(id => LIB[id] && !['warmup', 'stretch'].includes(id)).forEach(id => {
    LIB[id].mus.split(', ').forEach((m, j) => { const g = GROUPS[m] || m; cnt[g] = (cnt[g] || 0) + (j ? 0.3 : 1); });
  });
  const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
  const s = top.join(', ') || 'тренировка';
  return s[0].toUpperCase() + s.slice(1);
}
function renameAll() { if (S.program) S.program.workouts.forEach(w => { w.name = focusOf(w.list); }); }
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
  const w = curWeight(), perMin = met => met * 3.5 * w / 200;
  const vals = doneVals || Array(e.sets).fill(Math.round((e.lo + e.hi) / 2));
  const work = vals.reduce((s, v) => s + (e.type === 'time' ? v : v * 3.2 * (e.side ? 2 : 1)), 0) / 60;
  const rest = Math.max(0, vals.length - 1) * e.rest / 60;
  return (work + rest) * perMin(metOf(e)); // MET из Compendium дан на всю тренировку вместе с паузами
}
const workoutKcal = list => Math.round(list.reduce((s, id) => s + kcalOf(id), 0));
const workoutMin = list => Math.round(list.reduce((s, id) => { const e = E(id); if (!e) return s;
  const work = e.sets * (e.type === 'time' ? (e.lo + e.hi) / 2 : (e.lo + e.hi) / 2 * 3.2 * (e.side ? 2 : 1)); return s + (work + (e.sets - 1) * e.rest) / 60 + 1; }, 0));

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
    S.program = buildProgram(p); Store.set('program', S.program);
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
  let h = `<h1>${WDF[d.getDay()]}, ${d.getDate()}.${pad(d.getMonth() + 1)}</h1>`;

  if (S.choosing) {
    h += `<p class="sub">Какую тренировку делаем сегодня?</p>` + S.program.workouts.map(w =>
      `<button class="wcard pick" data-w="${w.id}"><b>${esc(w.name)}${w.id === (planned && planned.id) ? ' <span class="tag">по плану</span>' : ''}</b><span>${WD[w.weekday]} · ${w.list.length - 2} упражнений · ~${workoutMin(w.list)} мин</span></button>`).join('') +
      `<button class="btn ghost" id="chCancel">Отмена</button>`;
    $('#screen').innerHTML = h;
    $$('[data-w]').forEach(b => b.onclick = () => { S.workout.wid = b.dataset.w; S.choosing = false; S.anyway = true; saveWorkout(); haptic(); renderToday(); });
    $('#chCancel').onclick = () => { S.choosing = false; renderToday(); };
    setBack(() => { S.choosing = false; setBack(null); renderToday(); });
    return;
  }

  const firstTime = !trainedDates().filter(d => d !== S.today).length;
  if (!S.workout.wid && !planned && !S.anyway && !started && firstTime && !S.waitFirst) {
    const nx = nextTraining();
    h += `<p class="sub">Твоя первая тренировка по плану — ${nx ? nx.label : 'скоро'}${nx ? `: <b>${esc(nx.w.name)}</b>` : ''}. Можно начать и сегодня.</p>
      <button class="btn" id="startNow">Начать сегодня</button><button class="btn ghost" id="waitFirst">Подожду${nx ? ' до ' + nx.label : ''}</button>${firstTips()}`;
    $('#screen').innerHTML = h;
    $('#startNow').onclick = () => { S.workout.wid = (nx ? nx.w : S.program.workouts[0]).id; S.anyway = true; haptic(); renderToday(); };
    $('#waitFirst').onclick = () => { S.waitFirst = true; renderToday(); };
    return;
  }
  if (!S.workout.wid && !planned && !S.anyway && !started) {
    const nx = nextTraining();
    h += `<p class="sub">Сегодня день отдыха.${nx ? ` Следующая тренировка — ${nx.label}: <b>${esc(nx.w.name)}</b>.` : ''}</p>
      <div class="banner">Мышцы растут, пока отдыхаешь. Сегодня главное — еда, белок и вода.</div>
      <button class="btn ghost" id="anyway">Всё равно потренироваться</button>`;
    $('#screen').innerHTML = h;
    $('#anyway').onclick = () => { S.choosing = true; renderToday(); };
    return;
  }
  const w = W(S.workout.wid) || planned || nextInOrder();
  if (S.workout.wid !== w.id) { S.workout.wid = w.id; if (started) saveWorkout(); }
  const core = w.list.filter(id => LIB[id]);
  const done = core.filter(id => setsDone(id) >= setsOf(E(id))).length;
  const nextId = core.find(id => setsDone(id) < setsOf(E(id)));
  const idx = S.program.workouts.indexOf(w) + 1, burned = Math.round(Object.entries(S.workout.sets).reduce((s, [id, v]) => s + (LIB[id] ? kcalOf(id, v.filter(x => x != null)) : 0), 0));

  h += `<div class="hero">
    <span class="hero-k">Тренировка ${idx} из ${S.program.workouts.length}${planned && planned.id === w.id ? ' · по плану' : ''}</span>
    <h2>${esc(w.name)}</h2>
    <div class="hero-meta"><span>${core.length - 2} упражнений</span><span>~${workoutMin(core)} мин</span><span>≈ ${workoutKcal(core)} ккал</span></div>
    ${started ? `<div class="bar"><i style="width:${done / core.length * 100}%"></i></div>
      <div class="hero-sub">Сделано ${done} из ${core.length} · сожжено ≈ ${burned} ккал${S.workout.start && !S.workout.finished ? ` · <span id="clock">${mins(S.workout.start)}</span>` : ''}</div>` : ''}
    ${S.workout.finished ? `<div class="hero-done">Тренировка завершена${S.workout.start && S.workout.end ? ` · ${Math.max(1, Math.round((S.workout.end - S.workout.start) / 60000))} мин` : ''}</div>`
      : nextId ? `<button class="btn big" id="go">${started ? `Продолжить: ${esc(LIB[nextId].name)}` : 'Начать тренировку'}</button>`
      : `<button class="btn big" id="toFinish">Завершить тренировку</button>`}
  </div>`;
  if (isDeload()) h += `<div class="tip"><b>Разгрузочная неделя.</b> На подход меньше и вес полегче — тело восстанавливается и потом растёт быстрее.</div>`;
  if (firstTime && !S.workout.finished) h += firstTips();

  h += `<h3>Упражнения</h3><div class="exlist">` + core.map((id, i) => rowHTML(id, i)).join('') + `</div>`;
  const extra = (w.extra || []).filter(id => LIB[id]);
  if (extra.length) h += `<details><summary>Ещё по желанию (${extra.length})</summary><div class="exlist">${extra.map((id, i) => rowHTML(id, core.length + i)).join('')}</div></details>`;

  if (!S.workout.finished && started) {
    h += `<div class="card" id="finishBox"><b>Закончить тренировку</b><p class="muted">Как далось?</p>
      <div class="seg feel">${FEEL.map((f, i) => `<button data-feel="${i}" class="${S.workout.feel === i ? 'on' : ''}">${f}</button>`).join('')}</div>
      <textarea id="wnote" rows="2" maxlength="300" placeholder="Заметка: болело плечо, взял вес тяжелее…">${esc(S.workout.note || '')}</textarea>
      <button class="btn" id="finish">Завершить тренировку</button></div>`;
  } else if (S.workout.finished) {
    if (S.workout.feel != null || S.workout.note) h += `<div class="card">${S.workout.feel != null ? 'Далось: ' + FEEL[S.workout.feel].toLowerCase() + '. ' : ''}${esc(S.workout.note || '')}</div>`;
    const fresh = newAchievements();
    if (fresh.length) h += `<div class="tip"><b>Новое достижение:</b> ${fresh.map(a => esc(a.t)).join(', ')}</div>`;
  }
  if (!S.workout.finished) h += `<button class="btn ghost" id="choose">Сделать другую тренировку</button>`;
  $('#screen').innerHTML = h;

  $$('.exrow').forEach(b => b.onclick = () => openExercise(b.dataset.id));
  const go = $('#go'); if (go) go.onclick = () => openExercise(nextId);
  const tf = $('#toFinish'); if (tf) tf.onclick = () => $('#finishBox') && $('#finishBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
  const ch = $('#choose'); if (ch) ch.onclick = () => { S.choosing = true; renderToday(); scrollTo(0, 0); };
  $$('[data-feel]').forEach(b => b.onclick = () => { S.workout.feel = +b.dataset.feel; saveWorkout(); haptic(); $$('[data-feel]').forEach(x => x.classList.toggle('on', x === b)); });
  const note = $('#wnote'); if (note) note.onchange = () => { S.workout.note = note.value.trim().slice(0, 300); saveWorkout(); };
  const f = $('#finish'); if (f) f.onclick = () => {
    if (note) S.workout.note = note.value.trim().slice(0, 300);
    S.workout.finished = true; S.workout.end = Date.now(); S.workout.name = w.name; saveWorkout(); notify(); renderToday(); scrollTo(0, 0);
  };
  clearInterval(clockIv);
  if (S.workout.start && !S.workout.finished) clockIv = setInterval(() => { const c = $('#clock'); if (c) c.textContent = mins(S.workout.start); else clearInterval(clockIv); }, 15000);
}
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
  const st = exStats(id), last = st.last;
  const allTop = last && last.vals.length >= ns && last.vals.every(v => v >= e.hi);
  const easier = ladderStep(id, -1), harder = ladderStep(id, 1);
  const adj = S.program.adj && S.program.adj[id];
  const service = ['warmup', 'stretch'].includes(id);
  const wtd = isWeighted(e), kgs = wtd ? (S.workout.kg = S.workout.kg || {}, S.workout.kg[id] || (S.workout.kg[id] = Array(ns).fill(null))) : null;
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
    h += `<div class="lg-title">Подход ${cur + 1} <span>из ${ns}</span></div>`;
    if (wtd) h += stepper('kg', kgDef, 'кг', 'decimal');
    if (e.type === 'time') h += stepper('reps', repsDef, 'сек', 'numeric') + `<button class="btn ghost" id="sw">▶ Засечь время</button>`;
    else h += stepper('reps', repsDef, e.side ? 'повт. на сторону' : 'повторов', 'numeric');
  } else h += `<div class="lg-done">Все подходы сделаны</div>`;
  const doneChips = vals.map((v, i) => v == null ? '' : `<button class="donechip" data-undo="${i}">✓ ${wtd && kgs[i] != null ? kgs[i] + ' × ' : ''}${v}${unit(e)}</button>`).join('');
  if (doneChips) h += `<div class="donerow">${doneChips}</div>`;
  h += `</div>`;

  h += info;
  h += `<details ${last ? '' : 'open'}><summary>Как делать</summary><ol class="steps">${e.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      <div class="exbtns"><button class="btn ghost" id="vid">Видео техники</button>${e.cam ? '<button class="btn ghost" id="camBtn">Камера</button>' : ''}</div></details>`;
  if (!service) h += `<details><summary>Подсказки</summary><p class="muted">Последние 1–3 повтора должны идти тяжело, но с чистой техникой — до отказа не нужно.${levelOf(S.profile) === 1 ? ' Первые 2 недели вес лёгкий: учим технику.' : ''}</p>
      ${wtd && WARMUP_PATS.includes(e.pat) && e.eq.some(x => ['bb', 'gym'].includes(x)) ? '<p class="muted">Перед первым подходом — разминочный: половина веса × 10 (не записывай).</p>' : ''}
      ${st.sessions ? `<p class="muted">Всего: ${st.sessions} ${plural(st.sessions, 'тренировка', 'тренировки', 'тренировок')}, рекорд ${st.bestKg ? st.bestKg + ' кг' : st.best + unit(e)}.</p>` : ''}</details>
      <button class="link center" id="tooHard">Слишком тяжело?</button><div id="hardBox"></div>`;
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
  $('#primary').onclick = () => {
    if (cur < 0) { if (nextEx) openExercise(nextEx); else { sheetClose(); setTimeout(() => { const fb = $('#finishBox'); if (fb) fb.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50); } return; }
    if (swTimer) { clearInterval(swTimer.iv); swTimer = null; }
    const rIn = $('.stepper[data-k="reps"] input', sh), kIn = $('.stepper[data-k="kg"] input', sh);
    const v = Math.min(9999, Math.max(0, Math.round(parseFloat(String(rIn.value).replace(',', '.')) || 0)));
    if (!v) { toast(e.type === 'time' ? 'Сколько секунд продержался?' : 'Сколько повторов сделал?'); return; }
    vals[cur] = v;
    if (kIn) { const kg = parseFloat(String(kIn.value).replace(',', '.')); kgs[cur] = kg >= 0 && kg < 1000 ? Math.round(kg * 4) / 4 : null; }
    if (!S.workout.start) S.workout.start = Date.now();
    saveWorkout(); notify();
    if (vals.some(x => x == null)) { openExercise(id); if (e.rest) startRest(e.rest); return; }
    const dn = vals.filter(x => x != null), mx = Math.max(...dn);
    if (!service && mx < e.lo && mx > 0) {
      const lo = Math.max(1, Math.round(dn.reduce((a, b) => a + b, 0) / dn.length)), hi = Math.max(lo + 2, Math.round(mx * 1.4));
      setAdj(id, lo, hi);
      toast(`Подстроила цель под тебя: ${lo}–${hi}${unit(e)}. Станет легче — приложение поднимет.`);
    } else toast(nextEx ? 'Упражнение готово! Дальше — ' + LIB[nextEx].name : 'Последнее упражнение готово!');
    openExercise(id);
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
  let h = `<div class="row"><h1>План</h1><button class="btn sm ${S.editPlan ? '' : 'ghost'}" id="editPlan">${S.editPlan ? 'Готово' : 'Изменить'}</button></div>
    <p class="sub">${S.program.workouts.length} ${plural(S.program.workouts.length, 'тренировка', 'тренировки', 'тренировок')} в неделю.${S.editPlan ? ' Меняй дни, порядок, заменяй и добавляй упражнения.' : ''}</p><h3>Ближайшие 2 недели</h3><ul class="cal">`;
  const start = new Date(); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  for (let i = 0; i < 14; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = dateKey(d), rec = S.history[k], trained = isTrained(rec);
    const w = (trained && rec.wid && W(rec.wid)) || plannedFor(d);
    const past = k < S.today, isToday = k === S.today, counted = k >= created;
    if (!w && !trained && !isToday) continue; // дни отдыха не показываем — меньше шума
    const cls = trained ? 'ok' : isToday ? 'now' : past && w && counted ? 'miss' : '';
    h += `<li class="${cls}"><span>${WD[d.getDay()]} ${d.getDate()}</span><b>${w ? esc(w.name) : trained ? 'Тренировка' : '<i>отдых</i>'}</b><em>${trained ? 'сделано' : isToday && w ? 'сегодня' : past && w && counted ? 'пропуск' : ''}</em></li>`;
  }
  h += `</ul>`;
  S.program.workouts.forEach(w => {
    h += `<div class="wsec"><div class="wsechd"><b>${esc(w.name)}</b>
      ${S.editPlan ? `<select data-wd="${w.id}" aria-label="День недели">${WEEK.map(d => `<option value="${d}" ${d === w.weekday ? 'selected' : ''}>${WD[d]}</option>`).join('')}</select>` : `<span class="muted">${WD[w.weekday]}</span>`}</div>
      <p class="muted">${w.list.length - 2} упражнений · ~${workoutMin(w.list)} мин · ≈ ${workoutKcal(w.list)} ккал</p>` +
      w.list.map((id, i) => LIB[id] ? `<div class="prow"><button class="pname" data-open="${id}"><b>${esc(LIB[id].name)}</b><span>${setsOf(E(id)) > 1 ? setsOf(E(id)) + ' × ' : ''}${range(E(id))}</span></button>
        ${!S.editPlan || ['warmup', 'stretch'].includes(id) ? '' : `<button class="mini" data-act="up" data-w="${w.id}" data-i="${i}" aria-label="Выше">↑</button><button class="mini" data-act="down" data-w="${w.id}" data-i="${i}" aria-label="Ниже">↓</button><button class="mini" data-act="swap" data-w="${w.id}" data-i="${i}">Заменить</button><button class="mini" data-act="del" data-w="${w.id}" data-i="${i}" aria-label="Убрать">×</button>`}</div>` : '').join('') +
      (S.editPlan ? `<button class="btn ghost sm" data-add="${w.id}">+ Добавить упражнение</button>` : '') + `</div>`;
  });
  h += S.editPlan ? `<button class="btn ghost" id="rebuild">Пересобрать план по анкете</button>` : '';
  h += `<details><summary>Как растёт нагрузка</summary><p class="muted">У каждого упражнения диапазон, например 10–15. Дошёл до верхней цифры во всех подходах — приложение скажет «пора усложнять» и как. Пропустил день — просто делай следующую тренировку.</p></details>`;
  $('#screen').innerHTML = h;

  $('#editPlan').onclick = () => { S.editPlan = !S.editPlan; haptic(); renderPlan(); };
  $$('[data-open]').forEach(b => b.onclick = () => openExercise(b.dataset.open));
  $$('[data-wd]').forEach(s => s.onchange = () => { W(s.dataset.wd).weekday = +s.value; saveProgram(); renderPlan(); });
  $$('[data-act]').forEach(b => b.onclick = () => {
    const w = W(b.dataset.w), i = +b.dataset.i, a = b.dataset.act, L = w.list;
    if (a === 'up' && i > 1) [L[i - 1], L[i]] = [L[i], L[i - 1]];
    else if (a === 'down' && i < L.length - 2) [L[i + 1], L[i]] = [L[i], L[i + 1]];
    else if (a === 'del') L.splice(i, 1);
    else if (a === 'swap') return openPicker(`Заменить «${LIB[L[i]].name}»`, LIB[L[i]].pat, L, id => { L[i] = id; saveProgram(); renderPlan(); });
    saveProgram(); haptic(); renderPlan();
  });
  $$('[data-add]').forEach(b => b.onclick = () => {
    const w = W(b.dataset.add);
    openPicker('Добавить упражнение', null, w.list, id => { w.list.splice(Math.max(1, w.list.length - 1), 0, id); saveProgram(); renderPlan(); });
  });
  const rb = $('#rebuild'); if (rb) rb.onclick = () => ask('Собрать план заново по анкете? Твои правки плана сбросятся, история тренировок останется.', () => {
    S.program = buildProgram(S.profile); saveProgram(); notify(); renderPlan();
  });
}
const saveProgram = () => { renameAll(); Store.set('program', S.program); };

function openPicker(title, pat, exclude, onPick) {
  const p = S.profile;
  const pats = pat ? [pat] : Object.keys(PATTERNS);
  let h = `<div class="head"><button class="back" id="pback">←</button><h2>${esc(title)}</h2></div>
    <p class="muted">${pat ? 'Похожие упражнения, которые подходят под твой инвентарь и уровень.' : 'Все упражнения под твой инвентарь и уровень.'}</p>`;
  for (const pt of pats) {
    const ok = Object.keys(LIB).filter(id => LIB[id].pat === pt && !exclude.includes(id) && fits(LIB[id], p));
    const other = pat ? Object.keys(LIB).filter(id => LIB[id].pat === pt && !exclude.includes(id) && !fits(LIB[id], p)) : [];
    if (!ok.length && !other.length) continue;
    h += `<h3>${esc(PATTERNS[pt])}</h3>` + ok.map(id => pickRow(id, '')).join('') +
      (other.length ? `<p class="muted">Нужен другой инвентарь или уровень:</p>` + other.map(id => pickRow(id, needs(LIB[id]))).join('') : '');
  }
  const sh = $('#sheet'); sh.innerHTML = h; sh.hidden = false; sh.scrollTop = 0;
  const close = () => { sh.hidden = true; setBack(null); };
  $('#pback').onclick = close; setBack(close);
  $$('[data-pick]', sh).forEach(b => b.onclick = () => { close(); onPick(b.dataset.pick); notify(); });
}
const pickRow = (id, note) => `<button class="ex" data-pick="${id}"><div class="n"><b>${esc(LIB[id].name)}</b><span>${esc(LIB[id].mus)}${note ? ' · ' + esc(note) : ''}</span></div><div class="prog">+</div></button>`;
const needs = e => {
  const p = S.profile, have = availableEq(p), miss = e.eq.filter(x => !have.includes(x));
  return [miss.length ? 'нужно: ' + miss.map(x => EQUIP[x].toLowerCase()).join(', ') : '',
    e.lvl > levelOf(p) ? 'для уровня выше' : '',
    e.needPull && p.pullups < e.needPull ? `когда будешь подтягиваться ${e.needPull}+ раз` : '',
    e.maxPush && p.pushups > e.maxPush ? 'тебе уже легко' : '',
    (e.avoid || []).some(l => p.limits.includes(l)) ? 'нагрузка на больное место' : ''].filter(Boolean).join(', ');
};

/* =================== ЕДА =================== */
const NUMW = { 'один': 1, 'одна': 1, 'одно': 1, 'одну': 1, 'два': 2, 'две': 2, 'пару': 2, 'пара': 2, 'три': 3, 'четыре': 4, 'пять': 5, 'шесть': 6, 'семь': 7, 'восемь': 8, 'девять': 9, 'десять': 10, 'пол': 0.5, 'половину': 0.5, 'половина': 0.5, 'полтора': 1.5, 'полторы': 1.5, 'несколько': 3 };
function parseFood(text) {
  const items = [], unknown = [];
  const clean = (' ' + text.toLowerCase().replace(/ё/g, 'е') + ' ')
    .replace(/\sбез\s+[а-я]+/g, ' ')
    .replace(/\s(я|съел|съела|скушал|скушала|поел|поела|выпил|выпила|сегодня|утром|днем|вечером|на завтрак|на обед|на ужин|примерно|где-то|штук[аи]?)(?=\s)/g, ' ');
  const segs = clean.split(/[,;\n+]|\s(?:и|с|со|плюс|ещё|еще|потом|запил|заел)\s/).map(s => s.trim()).filter(Boolean);
  for (const seg of segs) {
    const words = seg.split(/[^a-zа-я0-9.]+/).filter(Boolean);
    let best = null, bestLen = 0, mod = null;
    for (const f of FOOD_DICT) for (const key of f.keys) {
      const hit = key.includes(' ') ? seg.includes(key) : words.some(w => w.startsWith(key));
      if (!hit) continue;
      if (f.modifier) { mod = f; continue; }
      if (key.length > bestLen) { best = f; bestLen = key.length; }
    }
    if (!best) { if (/[а-я]{3,}/.test(seg)) unknown.push(seg); continue; }
    let grams = null, count = null, ml = false;
    const mg = seg.match(/(\d+(?:[.,]\d+)?)\s*(кг|г|гр|грамм\S*|мл|л)(?![а-я])/);
    if (mg) { const n = parseFloat(mg[1].replace(',', '.')); grams = /^(кг|л)$/.test(mg[2]) ? n * 1000 : n; ml = /^(мл|л)$/.test(mg[2]); }
    else {
      const mn = seg.match(/(\d+(?:[.,]\d+)?)/);
      if (mn) count = parseFloat(mn[1].replace(',', '.'));
      else { const w = words.find(w => NUMW[w] != null); if (w) count = NUMW[w]; }
    }
    if (grams == null && count == null) count = best.spoonDefault || 1;
    if (count != null) count = Math.min(count, 50);
    if (grams != null) grams = Math.min(grams, 5000);
    items.push(foodItem(best, count, grams, ml));
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
  const G = norms(), it = S.food.items;
  const sum = key => Math.round(it.reduce((s, x) => s + (+x[key] || 0), 0));
  const k = sum('k'), p = sum('p'), fsum = sum('f'), csum = sum('c');
  const pct = (v, g) => Math.min(100, v / g * 100);
  const cup = S.profile.cup || 250, wml = S.food.waterMl ?? (S.food.water || 0) * 250;
  const rec = lsGet('recent') || [];
  const left = G.kcal - k, pLeft = G.protein - p;

  let h = `<h1>Еда</h1>
    <div class="card sum"><div class="row"><div><span class="big">${k}</span><span class="muted"> / ${G.kcal} ккал</span></div><span class="muted">${left > 0 ? 'осталось ' + left : 'норма есть'}</span></div>
    <div class="bar ${k > G.kcal * 1.1 && S.profile.goal === 'lose' ? 'over' : ''}"><i style="width:${pct(k, G.kcal)}%"></i></div>
    <div class="macros">${[['Белки', p, G.protein, 'p'], ['Жиры', fsum, G.fat, 'f'], ['Углеводы', csum, G.carbs, 'c']].map(([n, v, g, cl]) =>
      `<div><span>${n}</span><b>${v}<small> / ${g} г</small></b><div class="bar thin ${cl}"><i style="width:${pct(v, g)}%"></i></div></div>`).join('')}</div></div>`;

  h += `<div class="card inputcard"><textarea id="ftext" rows="2" placeholder="Что съел? Скажи или напиши: «на завтрак 4 яйца и чай, на обед гречка с курицей»"></textarea>
    <div class="inrow"><button class="icon big" id="fmic" aria-label="Сказать голосом"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>
    <button class="icon big" id="fscan" aria-label="Сканировать штрихкод"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7V5h3M17 5h3v2M20 17v2h-3M7 19H4v-2M8 9v6M11 9v6M14 9v6M17 9v6"/></svg></button>
    <button class="btn" id="fcalc">Посчитать</button></div>
    <p class="muted small" id="fmicHint">${S.meal != null ? `Добавится в «${MEALS[S.meal]}»` : 'Скажи «на завтрак / обед / ужин / перекус» — разложу сама'}</p>
    <div id="fprev"></div>
    ${rec.length ? `<div class="chiprow">${rec.slice(0, 4).map((r, i) => `<button data-rec="${i}">+ ${esc(r.n)}</button>`).join('')}</div>` : ''}</div>`;

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
    <details><summary>Своё с цифрами (с упаковки)</summary><div class="form">
      <input id="fn" placeholder="Название" maxlength="40"><input id="fk" type="number" inputmode="numeric" placeholder="ккал"><input id="fp" type="number" inputmode="numeric" placeholder="белок">
      <button id="fadd" aria-label="Добавить">+</button></div></details>
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
  $$('[data-rec]').forEach(b => b.onclick = () => { const r = rec[+b.dataset.rec]; addFood([{ n: r.n, k: r.k, p: r.p, f: r.f || 0, c: r.c || 0 }]); });
  $$('[data-idea]').forEach(b => b.onclick = () => { const x = MEAL_IDEAS[+b.dataset.idea]; addFood([{ n: x.n, k: x.k, p: x.p, f: x.f, c: x.c, m }]); });
  $('#moreIdeas').onclick = () => { S.ideaOff = (S.ideaOff || 0) + 3; renderFood(); };
  const setW = v => { S.food.waterMl = Math.max(0, v); delete S.food.water; saveFood(); haptic(); renderFood(); };
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
    const n = $('#fn').value.trim() || 'Своё', kk = Math.max(0, +$('#fk').value || 0), pr = Math.max(0, +$('#fp').value || 0);
    if (kk || pr) addFood([{ n, k: Math.min(kk, 5000), p: Math.min(pr, 300), f: 0, c: 0 }]);
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
function addFood(list) {
  const m = S.meal ?? mealNow();
  list.forEach(x => { if (x.m == null) x.m = m; });
  S.food.items.push(...list); saveFood(); S.meal = null;
  if (lsGet('foodDayLast') !== S.today) { lsSet('foodDays', (lsGet('foodDays') || 0) + 1); lsSet('foodDayLast', S.today); } // для достижения
  let rec = lsGet('recent') || [];
  list.forEach(x => { rec = rec.filter(r => r.n !== x.n); rec.unshift({ n: x.n, k: x.k, p: x.p, f: x.f || 0, c: x.c || 0 }); });
  rec = rec.slice(0, 10); Store.set('recent', rec);
  notify(); renderFood();
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
function achievements() {
  const dates = trainedDates(), best = id => exStats(id).best, p = S.profile;
  const perWeek = {};
  dates.forEach(d => { const k = dateKey(weekStart(fromKey(d))); perWeek[k] = (perWeek[k] || 0) + 1; });
  const fullWeeks = Object.values(perWeek).filter(n => n >= Math.min(3, p.days.length)).length;
  const diff = curWeight() - p.weight, dir = p.goal === 'lose' ? -1 : 1;
  const target = +p.target;
  return [
    { id: 'first', t: 'Первая тренировка', ok: dates.length >= 1 },
    { id: 't10', t: '10 тренировок', ok: dates.length >= 10 },
    { id: 't25', t: '25 тренировок', ok: dates.length >= 25 },
    { id: 't50', t: '50 тренировок', ok: dates.length >= 50 },
    { id: 't100', t: '100 тренировок', ok: dates.length >= 100 },
    { id: 'week', t: 'Неделя по плану', ok: fullWeeks >= 1 },
    { id: 'week4', t: '4 недели по плану', ok: fullWeeks >= 4 },
    { id: 'streak8', t: '8 недель подряд', ok: weekStreak(dates) >= 8 },
    { id: 'pullup1', t: 'Первое подтягивание', ok: best('pullup') >= 1 || best('chinup') >= 1 },
    { id: 'pullup10', t: '10 подтягиваний', ok: best('pullup') >= 10 },
    { id: 'push25', t: '25 отжиманий', ok: best('pushup') >= 25 },
    { id: 'hang45', t: 'Вис 45 секунд', ok: best('hang') >= 45 },
    { id: 'plank60', t: 'Планка минута', ok: best('plank') >= 60 },
    { id: 'kg2', t: p.goal === 'lose' ? 'Минус 2 кг' : 'Плюс 2 кг', ok: diff * dir >= 2 && p.goal !== 'fit' },
    { id: 'target', t: 'Цель по весу', ok: !!target && (p.goal === 'lose' ? curWeight() <= target : curWeight() >= target) },
    { id: 'food7', t: 'Неделя записей еды', ok: (lsGet('foodDays') || 0) >= 7 },
  ];
}
function newAchievements() {
  const fresh = achievements().filter(a => a.ok && !S.ach.includes(a.id));
  if (fresh.length) { S.ach = S.ach.concat(fresh.map(a => a.id)); Store.set('ach', S.ach); notify(); }
  return fresh;
}
async function renderProgress() {
  const dates = trainedDates(), mon = weekStart();
  const week = dates.filter(d => d >= dateKey(mon)).length, planW = S.program.workouts.length;
  const streak = weekStreak(dates);
  const best = id => exStats(id).best;
  const lastW = S.weights.length ? S.weights[S.weights.length - 1] : null;
  newAchievements();

  let h = `<h1>Прогресс</h1><p class="sub">Всё сохраняется навсегда, ничего не сбрасывается.</p>
    <div class="stats"><div><b>${dates.length}</b><span>тренировок всего</span></div>
    <div><b>${week}/${planW}</b><span>на этой неделе</span></div><div><b>${streak}</b><span>${plural(streak, 'неделя', 'недели', 'недель')} подряд</span></div></div>
    <h3>Последние 4 недели</h3><div class="heat">${heatmap(dates)}</div>
    <details><summary>Нагрузка по мышцам за неделю</summary>${muscleVolume(dates.filter(d => d >= dateKey(mon)))}</details>
    <h3>Достижения</h3><div class="ach">${achievements().map(a => `<span class="${a.ok ? 'on' : ''}">${esc(a.t)}</span>`).join('')}</div>
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
      return `<li><span><b>${fmtDate(d)}</b> ${esc(name)}<br><span class="muted small">${esc(parts.join(' · ') || 'разминка')}</span>${w.feel != null ? ' · ' + FEEL[w.feel].toLowerCase() : ''}</span></li>`;
    }).join('') || '<li><span class="muted">Первая тренировка появится здесь.</span></li>'}</ul></details>`;
  $('#screen').innerHTML = h;
  drawChart();
  $('#wSave').onclick = () => {
    const w = parseFloat(String($('#wIn').value).replace(',', '.'));
    if (!(w >= 30 && w <= 250)) { notify('error'); return; }
    S.weights = S.weights.filter(x => x.d !== S.today).concat({ d: S.today, w }).sort((a, b) => a.d < b.d ? -1 : 1);
    Store.set('weights', S.weights); notify(); renderProgress();
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
    h += `<i class="${set.has(k) ? 'on' : ''} ${k === S.today ? 'now' : ''} ${k > S.today ? 'fut' : ''}">${d.getDate()}</i>`;
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

/* =================== ПРОФИЛЬ =================== */
function renderProfile() {
  const p = S.profile, n = norms();
  const eq = availableEq(p);
  let h = `<h1>${esc(p.name || 'Профиль')}</h1><p class="sub">${p.sex === 'm' ? 'Мужчина' : 'Женщина'}, ${p.age} ${plural(p.age, 'год', 'года', 'лет')}, ${p.height} см, ${curWeight()} кг</p>
    <h3>Нормы в день</h3>
    <div class="stats"><div><b>${n.kcal}</b><span>ккал</span></div><div><b>${n.protein} г</b><span>белка</span></div><div><b>${n.water} л</b><span>воды</span></div>
    <div><b>${n.fat} г</b><span>жиров</span></div><div><b>${n.carbs} г</b><span>углеводов</span></div><div><b>${levelOf(p) === 1 ? 'новичок' : levelOf(p) === 2 ? 'средний' : 'опытный'}</b><span>уровень</span></div></div>
    <div class="tip">Как посчитано: базовый обмен по формуле Миффлина — Сан-Жеора = <b>${n.bmr} ккал</b> (столько тело тратит в покое). × активность и тренировки = <b>${n.tdee} ккал</b>. Цель «${GOAL_NAMES[p.goal].toLowerCase()}» → <b>${n.kcal} ккал</b>. Белок — ${{ gain: 1.8, strength: 1.8, lose: 2, fit: 1.6 }[p.goal]} г на кг веса. Вода — ~33 мл на кг. Нормы пересчитываются, когда записываешь новый вес.</div>
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
  $('#backup').onclick = async () => {
    const keys = [...await Store.keys('w_'), ...await Store.keys('f_'), 'profile', 'program', 'weights', 'meas', 'recent', 'ach'];
    const txt = 'trener-backup ' + JSON.stringify(await Store.getMany(keys));
    try { await navigator.clipboard.writeText(txt); notify(); $('#backup').textContent = `Скопировано (${Math.round(txt.length / 1024)} КБ)`; }
    catch (e) { $('#bkout').innerHTML = `<p class="muted">Скопируй текст вручную:</p><textarea rows="4" readonly>${esc(txt)}</textarea>`; $('#bkout textarea').select(); }
  };
}

load();
