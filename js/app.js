/* ============================================================
   BULAVIN AI ANALYZER v2.0 — App Module
   Canvas background, scan animation, all UI rendering
   ============================================================ */

// --- State ---
let refBuffer = null, mineBuffer = null;
let refName = '', mineName = '';
const actx = new (window.AudioContext || window.webkitAudioContext)();

// --- DOM ---
const dropRef = document.getElementById('dropRef');
const dropMine = document.getElementById('dropMine');
const fileRef = document.getElementById('fileRef');
const fileMine = document.getElementById('fileMine');
const btn = document.getElementById('btnAnalyze');

// ============================================================
// BACKGROUND CANVAS — Living Sonar
// ============================================================
const bgCanvas = document.getElementById('bgCanvas');
const bgCtx = bgCanvas.getContext('2d');
let bgTime = 0;
const particles = [];

function resizeBg() {
  bgCanvas.width = window.innerWidth;
  bgCanvas.height = window.innerHeight;
}
resizeBg();
window.addEventListener('resize', resizeBg);

for (let i = 0; i < 40; i++) {
  particles.push({
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.2,
    alpha: Math.random() * 0.15,
    size: Math.random() * 1.5 + 0.5
  });
}

function drawBg() {
  bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
  bgTime += 0.008;
  const cx = bgCanvas.width / 2, cy = bgCanvas.height * 0.35;

  // Grid
  bgCtx.strokeStyle = 'rgba(255,255,255,0.015)';
  bgCtx.lineWidth = 1;
  for (let y = 0; y < bgCanvas.height; y += 60) {
    bgCtx.beginPath(); bgCtx.moveTo(0, y); bgCtx.lineTo(bgCanvas.width, y); bgCtx.stroke();
  }

  // Rings
  for (let i = 0; i < 5; i++) {
    const phase = (bgTime * 0.4 + i * 0.7) % 1;
    const r = phase * 350;
    bgCtx.beginPath(); bgCtx.arc(cx, cy, r, 0, Math.PI * 2);
    bgCtx.strokeStyle = `rgba(0,212,255,${(1 - phase) * 0.04})`;
    bgCtx.lineWidth = 1; bgCtx.stroke();
  }

  // Particles
  particles.forEach(p => {
    p.x += p.vx; p.y += p.vy;
    if (p.x < 0 || p.x > bgCanvas.width) p.vx *= -1;
    if (p.y < 0 || p.y > bgCanvas.height) p.vy *= -1;
    bgCtx.fillStyle = `rgba(0,212,255,${p.alpha})`;
    bgCtx.fillRect(p.x, p.y, p.size, p.size);
  });

  // Wave line
  const waveY = bgCanvas.height * 0.8;
  bgCtx.beginPath();
  for (let x = 0; x < bgCanvas.width; x++) {
    const t = x / bgCanvas.width;
    const y = waveY + Math.sin(t * 8 + bgTime * 2) * 2 + Math.sin(t * 20 + bgTime * 3) * 0.8;
    if (x === 0) bgCtx.moveTo(x, y); else bgCtx.lineTo(x, y);
  }
  bgCtx.strokeStyle = 'rgba(0,212,255,0.08)'; bgCtx.lineWidth = 1; bgCtx.stroke();

  requestAnimationFrame(drawBg);
}
drawBg();

// ============================================================
// SCAN ANIMATION
// ============================================================
let scanX = 0, scanRunning = false;
const scanCanvas = document.getElementById('scanCanvas');
const scanCtx = scanCanvas.getContext('2d');

function animateScan() {
  if (!scanRunning) return;
  const W = scanCanvas.width, H = scanCanvas.height;
  scanCtx.clearRect(0, 0, W, H);

  // Grid
  scanCtx.strokeStyle = 'rgba(0,212,255,0.04)'; scanCtx.lineWidth = 1;
  for (let y = 10; y < H; y += 16) { scanCtx.beginPath(); scanCtx.moveTo(0, y); scanCtx.lineTo(W, y); scanCtx.stroke(); }

  // Scanner line
  scanX = (scanX + 2) % W;
  const grad = scanCtx.createLinearGradient(scanX - 60, 0, scanX, 0);
  grad.addColorStop(0, 'rgba(0,212,255,0)'); grad.addColorStop(1, 'rgba(0,212,255,0.6)');
  scanCtx.fillStyle = grad; scanCtx.fillRect(scanX - 60, 0, 60, H);
  scanCtx.strokeStyle = 'rgba(0,212,255,0.8)'; scanCtx.beginPath(); scanCtx.moveTo(scanX, 0); scanCtx.lineTo(scanX, H); scanCtx.stroke();

  // Data dots
  for (let i = 0; i < 3; i++) {
    scanCtx.fillStyle = `rgba(0,212,255,${Math.random() * 0.3})`;
    scanCtx.fillRect(Math.random() * scanX, Math.random() * H, 1, 1);
  }
  requestAnimationFrame(animateScan);
}

function addScanStep(text, done) {
  const el = document.createElement('div');
  el.className = 'scan-step' + (done ? ' done' : '');
  el.innerHTML = `<span class="step-indicator">${done ? '✓' : '◉'}</span><span>${text}</span>`;
  document.getElementById('scanSteps').appendChild(el);
}

// ============================================================
// MINI WAVEFORM
// ============================================================
function drawMiniWave(canvasId, buf, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const DPR = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth * DPR;
  const H = canvas.offsetHeight * DPR;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);
  const w = canvas.offsetWidth, h = canvas.offsetHeight;
  const data = buf.getChannelData(0);
  const step = Math.ceil(data.length / w);
  const mid = h / 2;

  const grd = ctx.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, color + '60'); grd.addColorStop(1, color + '00');

  ctx.beginPath();
  for (let i = 0; i < w; i++) {
    let mx = 0;
    const start = i * step, end = Math.min(start + step, data.length);
    for (let j = start; j < end; j++) { const a = Math.abs(data[j]); if (a > mx) mx = a; }
    if (i === 0) ctx.moveTo(i, mid - mx * mid * 0.9); else ctx.lineTo(i, mid - mx * mid * 0.9);
  }
  for (let i = w - 1; i >= 0; i--) {
    let mx = 0;
    const start = i * step, end = Math.min(start + step, data.length);
    for (let j = start; j < end; j++) { const a = Math.abs(data[j]); if (a > mx) mx = a; }
    ctx.lineTo(i, mid + mx * mid * 0.9);
  }
  ctx.closePath(); ctx.fillStyle = grd; ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < w; i++) {
    let mx = 0;
    const start = i * step, end = Math.min(start + step, data.length);
    for (let j = start; j < end; j++) { const a = Math.abs(data[j]); if (a > mx) mx = a; }
    if (i === 0) ctx.moveTo(i, mid - mx * mid * 0.9); else ctx.lineTo(i, mid - mx * mid * 0.9);
  }
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
}

// ============================================================
// FILE HANDLING
// ============================================================
function setupDrop(dropEl, inputEl, isRef) {
  ['dragenter', 'dragover'].forEach(e => {
    dropEl.addEventListener(e, ev => { ev.preventDefault(); ev.stopPropagation(); dropEl.classList.add('active'); });
  });
  ['dragleave', 'drop'].forEach(e => {
    dropEl.addEventListener(e, ev => { ev.preventDefault(); ev.stopPropagation(); dropEl.classList.remove('active'); });
  });
  dropEl.addEventListener('drop', ev => {
    const file = ev.dataTransfer.files[0];
    if (file) handleFile(file, isRef);
  });
  inputEl.addEventListener('change', ev => {
    const file = ev.target.files[0];
    if (file) handleFile(file, isRef);
  });
}

async function handleFile(file, isRef) {
  try {
    const ab = await file.arrayBuffer();
    const audio = await actx.decodeAudioData(ab);
    const dur = audio.duration.toFixed(1);
    const srk = (audio.sampleRate / 1000).toFixed(1);
    if (isRef) {
      refBuffer = audio; refName = file.name;
      document.getElementById('nameRef').textContent = file.name;
      document.getElementById('metaRef').textContent = `${dur}s · ${srk}kHz · ${audio.numberOfChannels}ch`;
      document.getElementById('dropRefContent').style.display = 'none';
      document.getElementById('loadedRef').style.display = 'flex';
      dropRef.classList.add('loaded');
      drawMiniWave('waveMiniRef', audio, '#FF9500');
    } else {
      mineBuffer = audio; mineName = file.name;
      document.getElementById('nameMine').textContent = file.name;
      document.getElementById('metaMine').textContent = `${dur}s · ${srk}kHz · ${audio.numberOfChannels}ch`;
      document.getElementById('dropMineContent').style.display = 'none';
      document.getElementById('loadedMine').style.display = 'flex';
      dropMine.classList.add('loaded');
      drawMiniWave('waveMiniMine', audio, '#00D4FF');
    }
    checkReady();
  } catch (e) {
    alert('Ошибка: ' + e.message + '\n\nПоддерживаются WAV, MP3, FLAC, OGG, M4A.');
  }
}

function checkReady() {
  if (refBuffer && mineBuffer) {
    btn.disabled = false; btn.className = 'analyze-btn ready';
    btn.querySelector('.btn-text').textContent = 'СКАНИРОВАТЬ';
  }
}

setupDrop(dropRef, fileRef, true);
setupDrop(dropMine, fileMine, false);
btn.addEventListener('click', () => { if (refBuffer && mineBuffer) runAnalysis(); });

// ============================================================
// ANALYSIS RUNNER
// ============================================================
async function runAnalysis() {
  btn.disabled = true; btn.className = 'analyze-btn scanning';
  btn.querySelector('.btn-text').textContent = 'АНАЛИЗ...';
  document.getElementById('statusDot').className = 'status-dot analyzing';
  document.getElementById('statusText').textContent = 'АНАЛИЗ';

  const prog = document.getElementById('progress');
  const stepsEl = document.getElementById('scanSteps');
  stepsEl.innerHTML = '';
  prog.style.display = 'flex';
  document.getElementById('results').style.display = 'none';
  scanRunning = true; animateScan();

  await sleep(60);
  addScanStep('Обрезка тишины и анализ референса...', false);
  await sleep(20);
  const refResult = analyzeTrack(refBuffer);
  stepsEl.lastChild.className = 'scan-step done';
  stepsEl.lastChild.querySelector('.step-indicator').textContent = '✓';

  addScanStep('Анализ твоего вокала...', false);
  await sleep(20);
  const mineResult = analyzeTrack(mineBuffer);
  stepsEl.lastChild.className = 'scan-step done';
  stepsEl.lastChild.querySelector('.step-indicator').textContent = '✓';

  addScanStep('Сравнение и генерация рекомендаций...', false);
  await sleep(20);
  const comp = compare(refResult, mineResult);
  stepsEl.lastChild.className = 'scan-step done';
  stepsEl.lastChild.querySelector('.step-indicator').textContent = '✓';

  addScanStep('Готово!', true);
  await sleep(300);
  scanRunning = false;

  renderResults(refResult, mineResult, comp);
  prog.style.display = 'none';
  btn.className = 'analyze-btn ready';
  btn.querySelector('.btn-text').textContent = 'СКАНИРОВАТЬ ЗАНОВО';
  btn.disabled = false;
  document.getElementById('statusDot').className = 'status-dot';
  document.getElementById('statusText').textContent = 'АНАЛИЗ ЗАВЕРШЁН';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- Score ring ---
function animateScoreRing(canvas, score, color) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2, r = W * 0.4;
  let current = 0;
  const target = score / 100;

  function frame() {
    ctx.clearRect(0, 0, W, H);
    current += (target - current) * 0.06;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 6; ctx.stroke();

    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + current * Math.PI * 2);
    ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.shadowColor = color; ctx.shadowBlur = 12; ctx.stroke();

    const ea = -Math.PI / 2 + current * Math.PI * 2;
    ctx.beginPath(); ctx.arc(cx + r * Math.cos(ea), cy + r * Math.sin(ea), 4, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.shadowBlur = 16; ctx.fill();
    ctx.shadowBlur = 0;

    if (Math.abs(current - target) > 0.001) requestAnimationFrame(frame);
  }
  frame();
}

function animateNumber(el, from, to, dur, suffix) {
  suffix = suffix || '';
  const start = performance.now();
  function update(now) {
    const t = Math.min((now - start) / dur, 1);
    const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    el.textContent = Math.round(from + (to - from) * eased) + suffix;
    if (t < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

// --- FP Badge ---
function fpBadge(fp) {
  const map = { dry: ['🎤 Сухой', '#00D4FF'], lightly: ['🎛️ Лёгкая обработка', '#FF9500'], processed: ['⚙️ Обработан', '#FF9500'], wet: ['🌊 С ревербом', '#BF5FFF'] };
  const [text, color] = map[fp.level] || map.dry;
  return `<span class="fp-badge" style="color:${color};border-color:${color}">${text}</span>`;
}

// ============================================================
// RENDER RESULTS
// ============================================================
function renderResults(ref, mine, comp) {
  const r = document.getElementById('results');
  const sColor = comp.score >= 85 ? '#00FF87' : comp.score >= 60 ? '#FF9500' : '#FF3B5C';
  let html = '';

  // --- CLIPPING WARNING ---
  if (mine.clipping && mine.clipping.isClipping) {
    html += `<div class="warn-banner">⚠️ ${mine.clipping.advice}</div>`;
  }

  // --- PROCESSING BADGES ---
  html += `<div class="card"><div class="card-body" style="text-align:center;padding:12px 18px">
        <span style="font-size:11px;color:rgba(255,255,255,0.3);font-family:'DM Mono',monospace;letter-spacing:0.1em">РЕФЕРЕНС</span> ${fpBadge(ref.fp)}
        <span style="margin-left:20px;font-size:11px;color:rgba(255,255,255,0.3);font-family:'DM Mono',monospace;letter-spacing:0.1em">ТВОЙ ВОКАЛ</span> ${fpBadge(mine.fp)}
    </div></div>`;

  // --- DURATION WARNING ---
  if (comp.durationWarning) {
    html += `<div class="warn-banner">${comp.durationWarning}</div>`;
  }

  // --- DRY vs WET BANNER ---
  if (ref.fp.hasReverb && mine.fp.isDry) {
    html += `<div class="warn-banner" style="border-left-color:#BF5FFF;background:rgba(191,95,255,0.06);color:#BF5FFF">
            Референс содержит реверб (сила: ${(ref.fp.reverbAmount * 100).toFixed(0)}%). Сравнение выполнено с учётом этого.
        </div>`;
  }

  // --- SCORE ---
  html += `<div class="card">
        <div class="card-header"><div class="card-title"><div class="card-title-icon">◎</div>MATCH SCORE</div><span style="font-size:9px;color:rgba(255,255,255,0.2);font-family:'DM Mono',monospace">тональный баланс</span></div>
        <div class="score-body">
            <div class="score-ring-wrap"><canvas id="scoreRing" width="140" height="140"></canvas><div class="score-number" id="scoreNum">--</div></div>
            <div class="score-verdict" id="scoreVerdict">${comp.score >= 85 ? 'Звук близок к референсу' : comp.score >= 60 ? 'Есть что подтянуть' : 'Значительные отличия'}</div>
            <div class="score-scale"><div class="scale-track"><div class="scale-fill" id="scaleFill" style="width:0%"></div><div class="scale-cursor" id="scaleCursor" style="left:0%"></div></div>
            <div class="scale-labels"><span>Далеко</span><span>Норма</span><span>Идеально</span></div></div>
        </div></div>`;

  // --- PRIORITIES ---
  html += `<div class="card"><div class="card-header"><div class="card-title"><div class="card-title-icon">🎯</div>ПРИОРИТЕТЫ</div></div><div class="card-body">`;
  if (comp.priorities.length === 0)
    html += `<div class="advice-block" style="border-left-color:var(--green)">Все зоны в норме — звук близок к референсу 🔥</div>`;
  else
    comp.priorities.forEach((p, i) => html += `<div class="priority-item"><div class="priority-num">${String(i + 1).padStart(2, '0')}</div><div class="priority-text">${p}</div></div>`);
  html += `</div></div>`;

  // --- LUFS ---
  html += `<div class="card"><div class="card-header"><div class="card-title"><div class="card-title-icon">📏</div>LOUDNESS (LUFS)</div></div><div class="card-body">
        <div class="card-hint">LUFS — стандарт громкости для стриминга. Spotify/Apple Music таргетируют −14 LUFS. LRA — разброс громкости.</div>
        <div class="stats-grid">
            <div class="stat-box"><div class="stat-label">Твой LUFS-I</div><div class="stat-value" style="color:var(--cyan)">${mine.lufs.lufsI}</div><div class="stat-sub">LUFS</div></div>
            <div class="stat-box"><div class="stat-label">Реф LUFS-I</div><div class="stat-value" style="color:var(--amber)">${ref.lufs.lufsI}</div><div class="stat-sub">LUFS</div></div>
            <div class="stat-box"><div class="stat-label">Твой LRA</div><div class="stat-value">${mine.lufs.lra}</div><div class="stat-sub">LU${mine.lufs.lra > 9 ? ' — широко' : ''}</div></div>
            <div class="stat-box"><div class="stat-label">True Peak</div><div class="stat-value" style="color:${mine.lufs.truePeak > -1 ? 'var(--red)' : 'var(--green)'}">${mine.lufs.truePeak}</div><div class="stat-sub">dBTP${mine.lufs.truePeak > -1 ? ' ⚠️' : ''}</div></div>
        </div>`;
  const lufsDiff = -14 - mine.lufs.lufsI;
  if (Math.abs(lufsDiff) > 2) {
    html += `<div class="advice-block">${lufsDiff > 0 ? `До Spotify (−14 LUFS) нужно +${lufsDiff.toFixed(1)} LU. Добавь лимитер/компрессор.` : `Громче Spotify на ${Math.abs(lufsDiff).toFixed(1)} LU. Если это вокал без мастеринга — нормально.`}</div>`;
  }
  html += `</div></div>`;

  // --- DYNAMICS ---
  html += `<div class="card"><div class="card-header"><div class="card-title"><div class="card-title-icon">📊</div>ДИНАМИКА</div></div><div class="card-body">
        <div class="card-hint">Crest = пики vs среднее. Dynamic Range = P5–P95 (без выбросов).</div>
        <div class="stats-grid">
            <div class="stat-box"><div class="stat-label">Crest Factor</div><div class="stat-value">${mine.crest.toFixed(1)}</div><div class="stat-sub">Реф: ${ref.crest.toFixed(1)} dB</div></div>
            <div class="stat-box"><div class="stat-label">Dynamic Range</div><div class="stat-value">${mine.dynRange.toFixed(1)}</div><div class="stat-sub">Реф: ${ref.dynRange.toFixed(1)} dB</div></div>
            <div class="stat-box"><div class="stat-label">Active RMS</div><div class="stat-value">${mine.activeRmsDb.toFixed(1)}</div><div class="stat-sub">Реф: ${ref.activeRmsDb.toFixed(1)} dBFS</div></div>
            <div class="stat-box"><div class="stat-label">Peak</div><div class="stat-value">${mine.peakDb.toFixed(1)}</div><div class="stat-sub">Реф: ${ref.peakDb.toFixed(1)} dBFS</div></div>
        </div>`;
  // Transients
  if (mine.transients) {
    html += `<div class="stats-grid" style="margin-top:4px">
            <div class="stat-box"><div class="stat-label">Атака вокала</div><div class="stat-value">${mine.transients.medianAttackMs}</div><div class="stat-sub">мс (медиана)</div></div>
            <div class="stat-box"><div class="stat-label">Компрессор Attack</div><div class="stat-value" style="color:var(--cyan)">${mine.transients.compAttackMs}</div><div class="stat-sub">мс</div></div>
            <div class="stat-box"><div class="stat-label">Компрессор Release</div><div class="stat-value" style="color:var(--cyan)">${mine.transients.compReleaseMs}</div><div class="stat-sub">мс</div></div>
        </div>`;
  }
  html += `<div class="advice-block">${comp.compAdvice}</div>`;
  html += `<div class="advice-block" style="border-left-color:#BF5FFF">${comp.dynAdvice}</div>`;
  html += `</div></div>`;

  // --- FUNDAMENTAL TONE ---
  html += `<div class="card"><div class="card-header"><div class="card-title"><div class="card-title-icon">🎵</div>ОСНОВНОЙ ТОН</div></div><div class="card-body">
        <div class="card-hint">Самая низкая рабочая частота. HPF ставь ниже — остальное мусор.</div>
        <div class="stats-grid">`;
  if (mine.fundamental) {
    const note = freqToNote(mine.fundamental.freq);
    const hpf = Math.round(mine.fundamental.freq * 0.6);
    html += `<div class="stat-box"><div class="stat-label">Твой голос</div><div class="stat-value" style="color:var(--cyan)">${Math.round(mine.fundamental.freq)}</div><div class="stat-sub">${note} · ${(mine.fundamental.confidence * 100).toFixed(0)}%</div></div>`;
    html += `<div class="stat-box"><div class="stat-label">HPF</div><div class="stat-value" style="color:var(--green)">${hpf}</div><div class="stat-sub">Hz — ниже режь</div></div>`;
  } else {
    html += `<div class="stat-box"><div class="stat-label">Твой голос</div><div class="stat-value" style="color:var(--text-muted)">—</div><div class="stat-sub">Мало тональных фрагментов</div></div>`;
    html += `<div class="stat-box"><div class="stat-label">HPF</div><div class="stat-value" style="color:var(--text-muted)">~80</div><div class="stat-sub">Hz — стандарт</div></div>`;
  }
  if (ref.fundamental) {
    html += `<div class="stat-box"><div class="stat-label">Референс</div><div class="stat-value" style="color:var(--amber)">${Math.round(ref.fundamental.freq)}</div><div class="stat-sub">${freqToNote(ref.fundamental.freq)}</div></div>`;
  }
  html += `</div></div></div>`;

  // --- PITCH STABILITY ---
  if (mine.pitchData) {
    html += `<div class="card"><div class="card-header"><div class="card-title"><div class="card-title-icon">🎼</div>СТАБИЛЬНОСТЬ ПИТЧА</div></div><div class="card-body">
            <div class="card-hint">Насколько ровно держишь ноту. 100 = идеально, < 50 = нужна автотюн-коррекция.</div>
            <div class="stats-grid">
                <div class="stat-box"><div class="stat-label">Стабильность</div><div class="stat-value" style="color:${mine.pitchData.stabilityScore >= 70 ? 'var(--green)' : mine.pitchData.stabilityScore >= 40 ? 'var(--amber)' : 'var(--red)'}">${mine.pitchData.stabilityScore}</div><div class="stat-sub">/100</div></div>
                <div class="stat-box"><div class="stat-label">Разброс</div><div class="stat-value">±${mine.pitchData.stdCents}</div><div class="stat-sub">центов</div></div>
                <div class="stat-box"><div class="stat-label">Медиана</div><div class="stat-value">${mine.pitchData.medianFreq}</div><div class="stat-sub">Hz</div></div>
            </div>`;
    if (mine.pitchData.stabilityScore < 70) {
      html += `<div class="advice-block" style="border-left-color:var(--amber)">Разброс ±${mine.pitchData.stdCents} центов. ${mine.pitchData.stabilityScore < 40 ? 'Нужна коррекция в Newtone/Melodyne.' : 'Лёгкая автотюн-коррекция улучшит звучание.'}</div>`;
    }
    // Pitch chart
    html += `<div class="chart-wrap" style="height:160px;margin-top:10px"><canvas id="chPitch"></canvas></div>`;
    html += `</div></div>`;
  }

  // --- HARSHNESS ---
  html += `<div class="card"><div class="card-header"><div class="card-title"><div class="card-title-icon">⚡</div>ЯРКОСТЬ</div></div><div class="card-body">
        <div class="card-hint">Индекс 4–10 кГц. >65 = де-эссер нужен. <35 = тускло.</div>
        <div class="stats-grid">
            <div class="stat-box"><div class="stat-label">Твой индекс</div><div class="stat-value" style="color:${mine.harshness.index > 65 ? 'var(--red)' : mine.harshness.index > 45 ? 'var(--amber)' : 'var(--green)'}">${mine.harshness.index}</div><div class="stat-sub">${mine.harshness.index > 65 ? 'Агрессивно' : mine.harshness.index > 45 ? 'Норма' : 'Тускло'}</div></div>
            <div class="stat-box"><div class="stat-label">Де-эссер</div><div class="stat-value" style="color:var(--cyan)">${mine.harshness.deesserFreq}</div><div class="stat-sub">Hz</div></div>
            <div class="stat-box"><div class="stat-label">Реф индекс</div><div class="stat-value" style="color:var(--amber)">${ref.harshness.index}</div><div class="stat-sub">${ref.harshness.index > 65 ? 'Агрессивно' : ref.harshness.index > 45 ? 'Норма' : 'Тускло'}</div></div>
        </div>
        <div class="advice-block" style="border-left-color:var(--red)">${comp.harshAdvice}</div>
    </div></div>`;

  // --- SPECTRAL TILT ---
  if (mine.tilt && ref.tilt) {
    html += `<div class="card"><div class="card-header"><div class="card-title"><div class="card-title-icon">📐</div>СПЕКТРАЛЬНЫЙ ТИЛТ</div></div><div class="card-body">
            <div class="card-hint">Наклон спектра в дБ/октаву. Нейтральный ≈ −3. Тёмный: −6. Яркий: −1.</div>
            <div class="stats-grid">
                <div class="stat-box"><div class="stat-label">Твой тилт</div><div class="stat-value">${mine.tilt.slopeDbPerOct}</div><div class="stat-sub">дБ/окт · ${mine.tilt.character}</div></div>
                <div class="stat-box"><div class="stat-label">Реф тилт</div><div class="stat-value" style="color:var(--amber)">${ref.tilt.slopeDbPerOct}</div><div class="stat-sub">дБ/окт · ${ref.tilt.character}</div></div>
            </div>`;
    if (comp.tiltAdvice) html += `<div class="advice-block">${comp.tiltAdvice}</div>`;
    html += `</div></div>`;
  }

  // --- NOISE FLOOR ---
  html += `<div class="card"><div class="card-header"><div class="card-title"><div class="card-title-icon">🔇</div>ШУМ</div></div><div class="card-body">
        <div class="stats-grid">
            <div class="stat-box"><div class="stat-label">Noise Floor</div><div class="stat-value" style="color:${mine.noise.noiseLevel > -50 ? 'var(--red)' : mine.noise.noiseLevel > -60 ? 'var(--amber)' : 'var(--green)'}">${mine.noise.noiseLevel}</div><div class="stat-sub">dBFS</div></div>
            <div class="stat-box"><div class="stat-label">SNR</div><div class="stat-value">${mine.noise.snr}</div><div class="stat-sub">dB</div></div>
        </div>
        <div class="advice-block">${mine.noise.advice}</div>
    </div></div>`;

  // --- STEREO ---
  if (mine.isStereo || ref.isStereo) {
    html += `<div class="card"><div class="card-header"><div class="card-title"><div class="card-title-icon">🔄</div>СТЕРЕО</div></div><div class="card-body">`;
    if (mine.stereo) {
      const pOk = mine.stereo.avgCorr > 0.3;
      html += `<div class="stats-grid">
                <div class="stat-box"><div class="stat-label">Корреляция</div><div class="stat-value" style="color:${pOk ? 'var(--green)' : 'var(--red)'}">${mine.stereo.avgCorr.toFixed(2)}</div><div class="stat-sub">${pOk ? 'Моно-совместим' : '⚠️ Фазовые конфликты'}</div></div>
                <div class="stat-box"><div class="stat-label">Ширина</div><div class="stat-value">${(mine.stereo.width * 100).toFixed(0)}</div><div class="stat-sub">%</div></div>
            </div>`;
      if (mine.stereo.phaseIssuePercent > 5)
        html += `<div class="advice-block" style="border-left-color:var(--red)">⚠️ ${mine.stereo.phaseIssuePercent.toFixed(0)}% фреймов с фазовыми конфликтами.</div>`;
    } else {
      html += `<div class="advice-block" style="border-left-color:var(--green)">Моно — фазовых проблем нет 👍</div>`;
    }
    html += `</div></div>`;
  }

  // --- BANDS ---
  html += `<div class="card"><div class="card-header"><div class="card-title"><div class="card-title-icon">🎚️</div>ЧАСТОТНЫЕ ЗОНЫ</div><span style="font-size:8px;color:rgba(255,255,255,0.15);font-family:'DM Mono',monospace">НОРМАЛИЗОВАНО</span></div><div class="card-body">
        <div class="card-hint">Громкость выровнена. Сравнивается форма спектра. Sub/Air весят меньше.</div>`;
  comp.bandDiffs.forEach(b => {
    const dCol = Math.abs(b.diff) < 4 ? 'var(--green)' : (b.diff > 0 ? 'var(--cyan)' : 'var(--amber)');
    const tag = b.severity === 'ok' ? '✅' : (b.severity === 'boost' ? '🔺' : '🔻');
    const rW = Math.max(4, Math.round((b.refE + 70) * 1.4));
    const mW = Math.max(4, Math.round((b.mineE + 70) * 1.4));
    html += `<div class="brow">
            <div class="band-name">${b.name}<br><span style="font-size:8px;color:rgba(255,255,255,0.15)">${b.lo}–${b.hi}</span></div>
            <div class="bars-wrap">
                <div class="bar-row"><div class="bar-label" style="color:var(--amber)">R</div><div class="bbar bbar-ref" style="width:${rW}px"></div></div>
                <div class="bar-row"><div class="bar-label" style="color:var(--cyan)">M</div><div class="bbar bbar-mine" style="width:${mW}px"></div></div>
            </div>
            <div class="band-diff" style="color:${dCol}">${b.diff > 0 ? '+' : ''}${b.diff.toFixed(1)}</div>
            <div class="band-tag" style="color:${dCol}">${tag}</div>
        </div>
        <div class="band-advice">${b.advice}</div>`;
  });
  html += `</div></div>`;

  // --- SPECTRUM ---
  html += `<div class="card"><div class="card-header"><div class="card-title"><div class="card-title-icon">📈</div>СПЕКТР</div></div><div class="card-body">
        <div class="card-hint">Форма голоса. Оранжевая = реф. Бирюзовая = ты.</div>
        <div class="chart-wrap chart-wrap-tall"><canvas id="chSpec"></canvas></div>
    </div></div>`;

  // --- RESONANCES ---
  html += `<div class="card"><div class="card-header"><div class="card-title"><div class="card-title-icon">🔔</div>РЕЗОНАНСЫ</div></div><div class="card-body">
        <div class="card-hint">Торчащие частоты — резонансы голоса, микрофона, комнаты. Для каждого: зона, причина, точный EQ.</div>`;
  if (mine.resonances.length > 0) {
    mine.resonances.forEach(res => {
      const pc = res.priority === 1 ? 'var(--red)' : res.priority === 2 ? 'var(--amber)' : 'rgba(0,212,255,0.6)';
      const pl = res.priority === 1 ? 'КРИТИЧНО' : res.priority === 2 ? 'ЗАМЕТНО' : 'МЕЛОЧЬ';
      html += `<div class="res-item" style="border-left:3px solid ${pc}">
                <div class="res-header">
                    <div><span class="res-freq" style="color:${pc}">${res.freq} Hz</span><span class="res-excess">+${res.excess.toFixed(1)} dB</span></div>
                    <span class="res-pri" style="color:${pc}">${pl}</span>
                </div>
                <div class="res-zone">${res.label}</div>
                <div class="res-tip">${res.tip}</div>
                <div class="res-eq">EQ: <strong>${res.freq} Hz</strong> · Gain <strong style="color:var(--red)">−${res.cutDb} dB</strong> · Q <strong>${res.Q}</strong></div>
            </div>`;
    });
  } else {
    html += `<div class="advice-block" style="border-left-color:var(--green)">Резонансов нет 👍</div>`;
  }
  html += `</div></div>`;

  // --- ENVELOPE CHART ---
  html += `<div class="card"><div class="card-header"><div class="card-title"><div class="card-title-icon">📉</div>ОГИБАЮЩАЯ</div></div><div class="card-body">
        <div class="card-hint">Громкость во времени. Ровная линия = хорошая компрессия.</div>
        <div class="chart-wrap"><canvas id="chEnv"></canvas></div>
    </div></div>`;

  // --- DAW EXPORT ---
  html += `<div class="card"><div class="card-header"><div class="card-title"><div class="card-title-icon">📋</div>ЭКСПОРТ НАСТРОЕК</div></div><div class="card-body">
        <div class="card-hint">Скопируй и вставь рекомендованные настройки в любую DAW.</div>
        <button class="copy-btn" id="copySettingsBtn" onclick="copySettings()"><span>◎</span> СКОПИРОВАТЬ НАСТРОЙКИ</button>
        <pre id="settingsText" style="display:none;font-family:'DM Mono',monospace;font-size:10px;color:var(--text-secondary);background:var(--bg-overlay);padding:12px;border-radius:8px;margin-top:8px;white-space:pre-wrap;border:1px solid var(--border-subtle)">${generateSettingsText(ref, mine, comp)}</pre>
    </div></div>`;

  r.innerHTML = html;
  r.style.display = 'block';
  window.scrollTo({ top: r.offsetTop - 20, behavior: 'smooth' });

  // Animate score
  setTimeout(() => {
    const scoreRing = document.getElementById('scoreRing');
    if (scoreRing) animateScoreRing(scoreRing, comp.score, sColor);
    const scoreNum = document.getElementById('scoreNum');
    if (scoreNum) animateNumber(scoreNum, 0, comp.score, 1200);
    const scaleFill = document.getElementById('scaleFill');
    const scaleCursor = document.getElementById('scaleCursor');
    if (scaleFill) scaleFill.style.width = comp.score + '%';
    if (scaleCursor) scaleCursor.style.left = comp.score + '%';
  }, 200);

  buildCharts(ref, mine);
}

// ============================================================
// GENERATE SETTINGS TEXT
// ============================================================
function generateSettingsText(ref, mine, comp) {
  let t = '== BULAVIN AI ANALYZER v2.0 — Настройки ==\n\n';

  // EQ
  const eqBands = comp.bandDiffs.filter(b => b.severity !== 'ok' && Math.abs(b.diff) >= 4 && Math.abs(b.diff) < 12);
  if (eqBands.length > 0) {
    t += '[Parametric EQ]\n';
    eqBands.forEach(b => {
      const mid = Math.round((b.lo + b.hi) / 2);
      const gain = b.diff > 0 ? `+${Math.min(b.diff, 6).toFixed(1)}` : `${Math.max(b.diff, -6).toFixed(1)}`;
      t += `• ${b.name} ${mid} Hz: ${gain} dB, Q=1.5\n`;
    });
    t += '\n';
  }

  // Resonance cuts
  if (mine.resonances.length > 0) {
    t += '[Resonance EQ Cuts]\n';
    mine.resonances.slice(0, 4).forEach(r => {
      t += `• ${r.freq} Hz: −${r.cutDb} dB, Q=${r.Q} (${r.label})\n`;
    });
    t += '\n';
  }

  // Compressor
  if (mine.transients) {
    t += '[Compressor]\n';
    t += `• Attack: ${mine.transients.compAttackMs} мс\n`;
    t += `• Release: ${mine.transients.compReleaseMs} мс\n`;
    t += `• Ratio: ${mine.crest > 18 ? '4:1' : '3:1'}\n\n`;
  }

  // Noise gate
  if (mine.noise.noiseLevel > -60) {
    t += '[Noise Gate]\n';
    t += `• Threshold: ${(mine.noise.noiseLevel + 6)} dBFS\n`;
    t += `• Attack: 2 мс, Release: 80 мс\n\n`;
  }

  // HPF
  if (mine.fundamental) {
    const hpf = Math.round(mine.fundamental.freq * 0.6);
    t += `[High-Pass Filter]\n• Частота: ${hpf} Hz\n\n`;
  }

  // LUFS
  t += `[Loudness]\n• Текущий: ${mine.lufs.lufsI} LUFS-I\n• Цель (Spotify): −14.0 LUFS\n`;
  const diff = -14 - mine.lufs.lufsI;
  if (diff > 2) t += `• Нужно: +${diff.toFixed(1)} LU\n`;

  return t;
}

function copySettings() {
  const text = document.getElementById('settingsText').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copySettingsBtn');
    btn.className = 'copy-btn copied';
    btn.innerHTML = '<span>✓</span> СКОПИРОВАНО!';
    document.getElementById('settingsText').style.display = 'block';
    setTimeout(() => { btn.className = 'copy-btn'; btn.innerHTML = '<span>◎</span> СКОПИРОВАТЬ НАСТРОЙКИ'; }, 2000);
  });
}

// ============================================================
// CHARTS
// ============================================================
function buildCharts(ref, mine) {
  const fmtFreq = f => f < 1000 ? f.toFixed(0) : (f / 1000).toFixed(1) + 'k';
  const chartFont = { family: 'DM Mono, monospace' };
  const gridColor = 'rgba(255,255,255,0.03)';
  const tickColor = 'rgba(255,255,255,0.18)';

  // Spectrum
  new Chart(document.getElementById('chSpec'), {
    type: 'line',
    data: {
      labels: ref.specFreqs.map(fmtFreq),
      datasets: [
        { label: 'Референс', data: ref.specDb, borderColor: '#FF9500', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false },
        { label: 'Твой вокал', data: mine.specDb.slice(0, ref.specFreqs.length), borderColor: '#00D4FF', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: tickColor, font: chartFont } },
        tooltip: { callbacks: { title: c => c[0].label + ' Hz', label: c => c.dataset.label + ': ' + c.parsed.y.toFixed(1) + ' dB' } }
      },
      scales: {
        x: { ticks: { color: tickColor, maxTicksLimit: 20, font: { ...chartFont, size: 9 } }, grid: { color: gridColor } },
        y: { ticks: { color: tickColor, font: { ...chartFont, size: 9 } }, grid: { color: gridColor } }
      }
    }
  });

  // Envelope
  const minLen = Math.min(ref.envTime.length, mine.envTime.length);
  new Chart(document.getElementById('chEnv'), {
    type: 'line',
    data: {
      labels: mine.envTime.slice(0, minLen).map(t => t.toFixed(1)),
      datasets: [
        { label: 'Референс', data: ref.envDb.slice(0, minLen), borderColor: '#FF9500', borderWidth: 1, pointRadius: 0, tension: 0.1, fill: false },
        { label: 'Твой вокал', data: mine.envDb.slice(0, minLen), borderColor: '#00D4FF', borderWidth: 1, pointRadius: 0, tension: 0.1, fill: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: tickColor, font: chartFont } } },
      scales: {
        x: { ticks: { color: tickColor, maxTicksLimit: 20, font: { ...chartFont, size: 9 } }, grid: { color: gridColor } },
        y: { min: -65, max: 0, ticks: { color: tickColor, font: { ...chartFont, size: 9 } }, grid: { color: gridColor } }
      }
    }
  });

  // Pitch chart (if available)
  const pitchCanvas = document.getElementById('chPitch');
  if (pitchCanvas && mine.pitchData) {
    new Chart(pitchCanvas, {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'Питч',
          data: mine.pitchData.frames.map(f => ({ x: f.time, y: f.freq })),
          borderColor: '#00D4FF',
          backgroundColor: mine.pitchData.frames.map(f => {
            const dev = Math.abs(1200 * Math.log2(f.freq / mine.pitchData.medianFreq));
            return dev < 15 ? '#00FF8740' : dev < 30 ? '#FF950040' : '#FF3B5C40';
          }),
          pointRadius: 2, pointHoverRadius: 4
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: 'Время (с)', color: tickColor }, ticks: { color: tickColor, font: { ...chartFont, size: 9 } }, grid: { color: gridColor } },
          y: { title: { display: true, text: 'Hz', color: tickColor }, ticks: { color: tickColor, font: { ...chartFont, size: 9 } }, grid: { color: gridColor } }
        }
      }
    });
  }
}
