// Проверка техники камерой: MediaPipe Pose (нейросеть прямо в телефоне, видео никуда не уходит).
// Считает повторы и подсказывает по углам суставов. Ставь телефон БОКОМ к себе, в 2–3 м, всё тело в кадре.

const VER = '0.10.14';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

// индексы точек
const P = { sh: [11, 12], el: [13, 14], wr: [15, 16], hip: [23, 24], kn: [25, 26], an: [27, 28] };
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

const $ = s => document.querySelector(s);
const cam = $('#cam'), video = $('#camVideo'), canvas = $('#camCanvas'), ctx = canvas.getContext('2d');
const hintEl = $('#camHint'), countEl = $('#camCount'), modeEl = $('#camMode');

let landmarker = null, stream = null, raf = 0, facing = 'user', voice = true, onDone = null;
let mode = 'squat', st = null;

const MODES = {
  squat: { title: 'Приседания · считаю повторы', start: 'Встань боком к камере, всё тело в кадре.' },
  pushup: { title: 'Отжимания · считаю повторы', start: 'Встань в упор лёжа боком к камере.' },
  plank: { title: 'Планка · считаю секунды в правильной позе', start: 'Встань в планку боком к камере.' },
};

async function getLandmarker() {
  if (landmarker) return landmarker;
  const { PoseLandmarker, FilesetResolver } = await import(`${CDN}/vision_bundle.mjs`);
  const fs = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
  const opts = d => ({ baseOptions: { modelAssetPath: MODEL, delegate: d }, runningMode: 'VIDEO', numPoses: 1 });
  try { landmarker = await PoseLandmarker.createFromOptions(fs, opts('GPU')); }
  catch (e) { landmarker = await PoseLandmarker.createFromOptions(fs, opts('CPU')); }
  return landmarker;
}

/* ---------- геометрия ---------- */
const W = () => video.videoWidth || 1, H = () => video.videoHeight || 1;
const pt = l => ({ x: l.x * W(), y: l.y * H(), v: l.visibility ?? 1 });
function angle(a, b, c) { // угол в точке b, градусы
  const ab = Math.atan2(a.y - b.y, a.x - b.x), cb = Math.atan2(c.y - b.y, c.x - b.x);
  let d = Math.abs(ab - cb) * 180 / Math.PI; return d > 180 ? 360 - d : d;
}
const tiltFromHorizontal = (a, b) => Math.abs(Math.atan2(b.y - a.y, Math.abs(b.x - a.x) || 1e-6) * 180 / Math.PI);
const tiltFromVertical = (a, b) => Math.abs(Math.atan2(Math.abs(b.x - a.x), Math.abs(b.y - a.y) || 1e-6) * 180 / Math.PI);
// ниже (+) или выше (−) линии a→c находится точка b, в пикселях по вертикали
function offLine(a, b, c) { const t = (b.x - a.x) / ((c.x - a.x) || 1e-6); return b.y - (a.y + t * (c.y - a.y)); }

function side(lm) { // берём сторону, которую камера видит лучше
  const vis = i => P.sh[i] !== undefined ? [P.sh[i], P.el[i], P.hip[i], P.kn[i], P.an[i]].reduce((s, k) => s + (lm[k].visibility ?? 1), 0) : 0;
  const i = vis(0) >= vis(1) ? 0 : 1;
  const g = k => pt(lm[P[k][i]]);
  const s = { sh: g('sh'), el: g('el'), wr: g('wr'), hip: g('hip'), kn: g('kn'), an: g('an') };
  s.vis = Math.min(s.sh.v, s.hip.v, s.kn.v, s.an.v);
  return s;
}

/* ---------- подсказки ---------- */
let lastSpoken = '', lastSpokenAt = 0;
function hint(text, kind = '') {
  hintEl.textContent = text; hintEl.className = 'cam-hint ' + kind;
  if (kind === 'bad' && voice && (text !== lastSpoken || Date.now() - lastSpokenAt > 4000) && Date.now() - lastSpokenAt > 2500) say(text);
}
function say(text) {
  try {
    if (!voice || !window.speechSynthesis) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'ru-RU'; u.rate = 1.1;
    speechSynthesis.speak(u); lastSpoken = text; lastSpokenAt = Date.now();
  } catch (e) {}
}
const ema = (prev, v, k = 0.4) => prev == null ? v : prev + (v - prev) * k;

function rep() {
  st.count++; countEl.textContent = st.count; window.beep && window.beep(1040, 120);
  try { Telegram.WebApp.HapticFeedback.impactOccurred('heavy'); } catch (e) {}
  if (voice) say(String(st.count));
}

/* ---------- логика упражнений ---------- */
function stepSquat(s) {
  const knee = st.a = ema(st.a, angle(s.hip, s.kn, s.an));
  const lean = tiltFromVertical(s.hip, s.sh);
  if (st.phase === 'up') {
    if (knee < 140) { st.phase = 'going'; st.min = knee; }
    else hint(st.count ? 'Хорошо. Следующий.' : 'Приседай: таз назад, как на стул.', st.count ? 'good' : '');
  } else {
    st.min = Math.min(st.min, knee);
    if (lean > 50) hint('Грудь выше, спина ровная', 'bad');
    else if (st.min <= 100) hint('Глубина есть — вставай', 'good');
    if (knee > 160) {
      if (st.min <= 100) rep(); else hint('Глубже: бедро до параллели с полом', 'bad');
      st.phase = 'up';
    }
  }
  return `колено ${Math.round(knee)}°`;
}

function stepPushup(s) {
  const body = tiltFromHorizontal(s.sh, s.an);
  if (body > 40) { hint('Встань в упор лёжа боком к камере'); st.phase = 'up'; return ''; }
  const elbow = st.a = ema(st.a, angle(s.sh, s.el, s.wr));
  const line = angle(s.sh, s.hip, s.an), off = offLine(s.sh, s.hip, s.an);
  const bodyLen = Math.hypot(s.an.x - s.sh.x, s.an.y - s.sh.y);
  let bad = '';
  if (line < 158) bad = off > 0 ? 'Не проваливай таз — напряги пресс' : 'Опусти таз, тело в одну линию';
  if (st.phase === 'up') {
    if (elbow < 130) { st.phase = 'down'; st.min = elbow; st.badSeen = false; }
    if (bad) hint(bad, 'bad'); else hint(st.count ? 'Ровно. Дальше.' : 'Опускайся: грудь почти до пола.', st.count ? 'good' : '');
  } else {
    st.min = Math.min(st.min, elbow);
    if (bad) { st.badSeen = true; hint(bad, 'bad'); }
    else if (st.min <= 95) hint('Глубина есть — жми вверх', 'good');
    if (elbow > 155) {
      if (st.min <= 95) rep(); else hint('Ниже: локти до 90°', 'bad');
      st.phase = 'up';
    }
  }
  void bodyLen;
  return `локоть ${Math.round(elbow)}° · корпус ${Math.round(line)}°`;
}

function stepPlank(s, now) {
  const body = tiltFromHorizontal(s.sh, s.an);
  const line = angle(s.sh, s.hip, s.an), off = offLine(s.sh, s.hip, s.an);
  const okPose = body < 35 && line >= 163;
  if (st.t0 == null) st.t0 = now;
  const dt = (now - (st.prev ?? now)) / 1000; st.prev = now;
  if (okPose) {
    st.held += dt; hint('Ровно, держи', 'good');
  } else if (body >= 35) hint('Встань в планку боком к камере');
  else hint(off > 0 ? 'Таз провис — подкрути таз, напряги пресс' : 'Таз высоко — опусти, тело в линию', 'bad');
  const sec = Math.floor(st.held);
  if (sec !== st.count) { st.count = sec; countEl.textContent = sec; if (voice && sec && sec % 10 === 0) say(sec + ' секунд'); }
  return `корпус ${Math.round(line)}°`;
}

/* ---------- цикл ---------- */
function draw(lm, color) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!lm) return;
  ctx.lineWidth = Math.max(3, W() / 200); ctx.strokeStyle = color; ctx.fillStyle = '#fff';
  for (const [a, b] of BONES) {
    if ((lm[a].visibility ?? 1) < 0.4 || (lm[b].visibility ?? 1) < 0.4) continue;
    ctx.beginPath(); ctx.moveTo(lm[a].x * W(), lm[a].y * H()); ctx.lineTo(lm[b].x * W(), lm[b].y * H()); ctx.stroke();
  }
  for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    if ((lm[i].visibility ?? 1) < 0.4) continue;
    ctx.beginPath(); ctx.arc(lm[i].x * W(), lm[i].y * H(), ctx.lineWidth * 1.3, 0, 7); ctx.fill();
  }
}

let lastTs = -1;
function loop() {
  raf = requestAnimationFrame(loop);
  if (!landmarker || video.readyState < 2) return;
  const now = performance.now();
  if (now - lastTs < 33) return; // ~30 кадров/с хватает
  lastTs = now;
  if (canvas.width !== W()) { canvas.width = W(); canvas.height = H(); }
  let res; try { res = landmarker.detectForVideo(video, now); } catch (e) { return; }
  const lm = res && res.landmarks && res.landmarks[0];
  if (!lm) { draw(null); hint('Не вижу тебя. Отойди дальше, чтобы было видно всё тело.'); return; }
  const s = side(lm);
  if (s.vis < 0.5) { draw(lm, '#bbb'); hint('Не видно ноги/корпус. Отойди дальше или поставь телефон ниже.'); return; }
  const info = mode === 'squat' ? stepSquat(s) : mode === 'pushup' ? stepPushup(s) : stepPlank(s, now);
  draw(lm, hintEl.classList.contains('bad') ? '#ff5a3c' : '#5be37a');
  modeEl.textContent = MODES[mode].title + (info ? ' · ' + info : '');
}

async function startStream() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  video.srcObject = stream; await video.play();
  cam.classList.toggle('mirror', facing === 'user');
}

async function open(m, cb) {
  mode = m; onDone = cb;
  st = { phase: 'up', count: 0, held: 0, a: null };
  countEl.textContent = '0'; modeEl.textContent = MODES[mode].title;
  cam.hidden = false;
  hint('Загружаю нейросеть… (первый раз 5–15 секунд)');
  try {
    await startStream();
  } catch (e) {
    hint('Нет доступа к камере. Разреши камеру для Телеграма в настройках телефона.', 'bad'); return;
  }
  try { await getLandmarker(); }
  catch (e) { hint('Не загрузилась нейросеть. Проверь интернет и открой ещё раз.', 'bad'); return; }
  hint(MODES[mode].start + ' Телефон в 2–3 м.');
  cancelAnimationFrame(raf); loop();
}

function close(save) {
  cancelAnimationFrame(raf);
  if (stream) stream.getTracks().forEach(t => t.stop()); stream = null;
  try { speechSynthesis.cancel(); } catch (e) {}
  cam.hidden = true;
  const result = st && st.count > 0 ? st.count : null;
  if (onDone) onDone(save ? result : null);
  onDone = null;
}

$('#camClose').onclick = () => close(false);
$('#camSave').onclick = () => close(true);
$('#camFlip').onclick = async () => { facing = facing === 'user' ? 'environment' : 'user'; try { await startStream(); } catch (e) {} };
$('#camVoice').onclick = e => { voice = !voice; e.target.textContent = 'Голос: ' + (voice ? 'вкл' : 'выкл'); if (!voice) try { speechSynthesis.cancel(); } catch (x) {} };

window.PoseCheck = { open, close };
