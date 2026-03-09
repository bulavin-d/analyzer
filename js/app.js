/* ============================================================
   BULAVIN AI ANALYZER v2.1 — App Module
   Mixing Chain Checklist · Cyber Scanner · Neon Charts
   DSP/Analyzer logic UNTOUCHED
   ============================================================ */

// --- State ---
let refBuffer = null, mineBuffer = null;
const actx = new (window.AudioContext || window.webkitAudioContext)();

// --- DOM ---
const dropRef = document.getElementById('dropRef');
const dropMine = document.getElementById('dropMine');
const fileRef = document.getElementById('fileRef');
const fileMine = document.getElementById('fileMine');
const btn = document.getElementById('btnAnalyze');
const uploadSection = document.querySelector('.upload-section');
let sectionObserver = null;

const RESULT_NAV_ITEMS = [
  { id: 'section-score', mark: '◎', label: 'Итог' },
  { id: 'section-eq', mark: '1', label: 'Эквалайзер' },
  { id: 'section-comp', mark: '2', label: 'Компрессор' },
  { id: 'section-deesser', mark: '3', label: 'Де-эссер' },
  { id: 'section-loudness', mark: '4', label: 'Громкость' },
  { id: 'section-details', mark: '5', label: 'Детали' },
  { id: 'section-export', mark: '6', label: 'Экспорт' }
];

function setAppState(state) {
  document.body.classList.remove('state-upload', 'state-scanning', 'state-results');
  document.body.classList.add(`state-${state}`);
}

// ============================================================
// IDLE PLACEHOLDER SINUSOID (drawn on startup, no audio loaded)
// ============================================================
function drawIdleWave(canvasId, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const parent = canvas.parentElement;
  const DPR = window.devicePixelRatio || 1;
  const W = parent.offsetWidth || 600;
  const H = parent.offsetHeight || 160;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);
  ctx.clearRect(0, 0, W, H);
  // Sinusoid: 2.5 cycles, amplitude 26% of height
  const amp = H * 0.26;
  const mid = H * 0.5;
  const freq = (2.5 * Math.PI * 2) / W;
  // Gradient fill under the sine
  const grd = ctx.createLinearGradient(0, mid - amp, 0, mid + amp);
  grd.addColorStop(0, color + '28');
  grd.addColorStop(0.5, color + '08');
  grd.addColorStop(1, 'transparent');
  ctx.beginPath();
  for (let x = 0; x <= W; x++) ctx[x === 0 ? 'moveTo' : 'lineTo'](x, mid + Math.sin(x * freq) * amp);
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = grd; ctx.fill();
  // Stroke line
  ctx.beginPath();
  for (let x = 0; x <= W; x++) ctx[x === 0 ? 'moveTo' : 'lineTo'](x, mid + Math.sin(x * freq) * amp);
  ctx.strokeStyle = color; ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.55; ctx.shadowColor = color; ctx.shadowBlur = 6;
  ctx.stroke();
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
}
window.addEventListener('load', () => {
  drawIdleWave('idleCanvasRef', '#E024B6');
  drawIdleWave('idleCanvasMine', '#7000FF');
  setAppState('upload');
});

// ============================================================
// MINI WAVEFORM — fills the fixed 160px drop zone
// ============================================================
function drawMiniWave(canvasId, buf, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  // canvas lives inside .drop-loaded (position:absolute inset:0)
  // measure the drop-zone's own fixed height via offsetParent
  const dropLoaded = canvas.parentElement;
  const DPR = window.devicePixelRatio || 1;
  // Use offsetWidth/Height so we get real rendered pixels
  const W = dropLoaded.offsetWidth || 600;
  const H = dropLoaded.offsetHeight || 116;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);
  ctx.clearRect(0, 0, W, H);
  const data = buf.getChannelData(0);
  const step = Math.ceil(data.length / W);
  const mid = H / 2;
  const grd = ctx.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, color + '55');
  grd.addColorStop(0.5, color + '18');
  grd.addColorStop(1, 'transparent');
  ctx.beginPath();
  for (let i = 0; i < W; i++) {
    let mx = 0;
    const s = i * step, e = Math.min(s + step, data.length);
    for (let j = s; j < e; j++) { const a = Math.abs(data[j]); if (a > mx) mx = a; }
    ctx[i === 0 ? 'moveTo' : 'lineTo'](i, mid - mx * mid * 0.85);
  }
  for (let i = W - 1; i >= 0; i--) {
    let mx = 0;
    const s = i * step, e = Math.min(s + step, data.length);
    for (let j = s; j < e; j++) { const a = Math.abs(data[j]); if (a > mx) mx = a; }
    ctx.lineTo(i, mid + mx * mid * 0.85);
  }
  ctx.closePath(); ctx.fillStyle = grd; ctx.fill();
  // Stroke with glow
  ctx.beginPath();
  for (let i = 0; i < W; i++) {
    let mx = 0;
    const s = i * step, e = Math.min(s + step, data.length);
    for (let j = s; j < e; j++) { const a = Math.abs(data[j]); if (a > mx) mx = a; }
    ctx[i === 0 ? 'moveTo' : 'lineTo'](i, mid - mx * mid * 0.85);
  }
  ctx.strokeStyle = color; ctx.lineWidth = 1.5;
  ctx.shadowColor = color; ctx.shadowBlur = 10;
  ctx.stroke(); ctx.shadowBlur = 0;
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
  dropEl.addEventListener('drop', ev => { const f = ev.dataTransfer.files[0]; if (f) handleFile(f, isRef); });
  inputEl.addEventListener('change', ev => { const f = ev.target.files[0]; if (f) handleFile(f, isRef); });
}

async function handleFile(file, isRef) {
  try {
    const ab = await file.arrayBuffer();
    const audio = await actx.decodeAudioData(ab);
    const dur = audio.duration.toFixed(1);
    const srk = (audio.sampleRate / 1000).toFixed(1);
    if (isRef) {
      refBuffer = audio;
      document.getElementById('nameRef').textContent = file.name;
      document.getElementById('metaRef').textContent = `${dur}s · ${srk}kHz · ${audio.numberOfChannels}ch`;
      document.getElementById('dropRefContent').style.display = 'none';
      document.getElementById('loadedRef').style.display = 'flex';
      dropRef.classList.add('loaded');
      setTimeout(() => drawMiniWave('waveMiniRef', audio, '#E024B6'), 50);
    } else {
      mineBuffer = audio;
      document.getElementById('nameMine').textContent = file.name;
      document.getElementById('metaMine').textContent = `${dur}s · ${srk}kHz · ${audio.numberOfChannels}ch`;
      document.getElementById('dropMineContent').style.display = 'none';
      document.getElementById('loadedMine').style.display = 'flex';
      dropMine.classList.add('loaded');
      setTimeout(() => drawMiniWave('waveMiniMine', audio, '#7000FF'), 50);
    }
    checkReady();
  } catch (e) {
    alert('Ошибка: ' + e.message + '\n\nПоддерживаются WAV, MP3, FLAC, OGG, M4A.');
  }
}

function checkReady() {
  if (refBuffer && mineBuffer) {
    btn.disabled = false; btn.className = 'analyze-btn ready';
    btn.querySelector('.btn-text').textContent = 'Сканировать';
  }
}


function resetDropState(dropEl, contentId, loadedId, nameId, metaId, inputEl) {
  const content = document.getElementById(contentId);
  const loaded = document.getElementById(loadedId);
  if (content) content.style.display = 'flex';
  if (loaded) loaded.style.display = 'none';
  if (nameId && document.getElementById(nameId)) document.getElementById(nameId).textContent = '';
  if (metaId && document.getElementById(metaId)) document.getElementById(metaId).textContent = '';
  if (dropEl) dropEl.classList.remove('loaded');
  if (inputEl) inputEl.value = '';
}

function resetAnalyzerView() {
  if (sectionObserver) {
    sectionObserver.disconnect();
    sectionObserver = null;
  }

  refBuffer = null;
  mineBuffer = null;

  resetDropState(dropRef, 'dropRefContent', 'loadedRef', 'nameRef', 'metaRef', fileRef);
  resetDropState(dropMine, 'dropMineContent', 'loadedMine', 'nameMine', 'metaMine', fileMine);

  const overlay = document.getElementById('scannerOverlay');
  if (overlay) overlay.style.display = 'none';

  const prog = document.getElementById('progress');
  const steps = document.getElementById('scanSteps');
  if (steps) steps.innerHTML = '';
  if (prog) prog.style.display = 'none';
  const bar = document.getElementById('scanBarFill');
  if (bar) bar.style.width = '0%';

  const results = document.getElementById('results');
  results.innerHTML = '';
  results.style.display = 'none';

  btn.style.display = 'inline-flex';
  btn.disabled = true;
  btn.className = 'analyze-btn';
  btn.querySelector('.btn-text').textContent = 'Загрузи оба файла';

  if (uploadSection) uploadSection.style.display = 'block';
  setAppState('upload');

  if (uploadSection) {
    window.scrollTo({ top: uploadSection.offsetTop - 20, behavior: 'smooth' });
  }
}

window.resetAnalyzerView = resetAnalyzerView;

setupDrop(dropRef, fileRef, true);
setupDrop(dropMine, fileMine, false);
btn.addEventListener('click', () => { if (refBuffer && mineBuffer) runAnalysis(); });

// ============================================================
// SCAN HELPERS
// ============================================================
function addScanStep(text, done) {
  const el = document.createElement('div');
  el.className = 'scan-step' + (done ? ' done' : '');
  el.innerHTML = `<span class="step-indicator">${done ? '✓' : '◉'}</span><span>${text}</span>`;
  document.getElementById('scanSteps').appendChild(el);
}

// ============================================================
// ANALYSIS RUNNER
// ============================================================
async function runAnalysis() {
  btn.disabled = true; btn.className = 'analyze-btn scanning';
  btn.querySelector('.btn-text').textContent = 'Сканирование...';
  setAppState('scanning');
  if (uploadSection) uploadSection.style.display = 'none';
  if (sectionObserver) {
    sectionObserver.disconnect();
    sectionObserver = null;
  }

  const overlay = document.getElementById('scannerOverlay');
  if (overlay) overlay.style.display = 'block';

  const prog = document.getElementById('progress');
  const stepsEl = document.getElementById('scanSteps');
  const resultsEl = document.getElementById('results');

  stepsEl.innerHTML = '';
  document.getElementById('scanBarFill').style.width = '0%';
  prog.style.display = 'flex';

  // When upload section is hidden, keep visible scanning state in results area.
  resultsEl.style.display = 'block';
  resultsEl.innerHTML = '<div class="card" style="max-width:760px;margin:24px auto;"><div class="card-body" style="padding:22px 24px;"><div class="score-verdict" style="font-size:18px;margin-bottom:6px">Сканирование...</div><div class="score-desc">Анализируем референс и строим рецепт цепочки.</div></div></div>';

  try {
    await sleep(80);
    addScanStep('Обрезка тишины · Анализ референса...', false);
    await sleep(20);
    const refResult = analyzeTrack(refBuffer);
    document.getElementById('scanBarFill').style.width = '35%';
    markLastDone(stepsEl);

    addScanStep('Определение тоники · Анализ вокала...', false);
    await sleep(20);
    const mineResult = analyzeTrack(mineBuffer);
    document.getElementById('scanBarFill').style.width = '70%';
    markLastDone(stepsEl);

    addScanStep('Сравнение спектров · Генерация цепочки...', false);
    await sleep(20);
    const comp = compare(refResult, mineResult);
    document.getElementById('scanBarFill').style.width = '100%';
    markLastDone(stepsEl);

    addScanStep('Готово', true);
    await sleep(300);

    if (overlay) overlay.style.display = 'none';
    renderResults(refResult, mineResult, comp);
    prog.style.display = 'none';
    btn.style.display = 'none';
  } catch (err) {
    if (overlay) overlay.style.display = 'none';
    prog.style.display = 'none';
    console.error(err);

    if (uploadSection) uploadSection.style.display = 'block';
    setAppState('upload');

    btn.style.display = 'inline-flex';
    btn.disabled = !(refBuffer && mineBuffer);
    btn.className = btn.disabled ? 'analyze-btn' : 'analyze-btn ready';
    btn.querySelector('.btn-text').textContent = btn.disabled ? 'Загрузи оба файла' : 'Сканировать';

    resultsEl.innerHTML = '';
    resultsEl.style.display = 'none';

    alert('Ошибка анализа. Попробуй снова.\n\nЕсли повторится — пришли два файла и я подгоню алгоритм под кейс.');
  }
}
function markLastDone(el) {
  el.lastChild.className = 'scan-step done';
  el.lastChild.querySelector('.step-indicator').textContent = '✓';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function animateNumber(el, from, to, dur) {
  const start = performance.now();
  function update(now) {
    const t = Math.min((now - start) / dur, 1);
    const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    el.textContent = Math.round(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

// --- FP Badge ---
function fpBadge(fp) {
  const map = {
    dry: ['Сухой', '#22C55E', 'rgba(34,197,94,0.12)'],
    lightly: ['Обработан', '#F59E0B', 'rgba(245,158,11,0.12)'],
    processed: ['Обработан', '#F59E0B', 'rgba(245,158,11,0.12)'],
    wet: ['С ревербом', '#E024B6', 'rgba(224,36,182,0.12)']
  };
  const [text, color, bg] = map[fp.level] || map.dry;
  return `<span class="fp-badge" style="color:${color};background:${bg}">${text}</span>`;
}

function diffBadge(val) {
  const abs = Math.abs(val);
  if (abs < 2) return `<span class="ibadge neutral">${val > 0 ? '+' : ''}${val.toFixed(1)}</span>`;
  if (val > 0) return `<span class="ibadge up">↑${val.toFixed(1)}</span>`;
  return `<span class="ibadge down">↓${abs.toFixed(1)}</span>`;
}

// ============================================================
// RENDER RESULTS — MIXING CHAIN CHECKLIST
// ============================================================
function buildResultsSidebar() {
  const links = RESULT_NAV_ITEMS.map(item => `
    <a class="sidebar-link" href="#${item.id}" data-target="${item.id}">
      <span class="sidebar-mark">${item.mark}</span>
      <span>${item.label}</span>
    </a>
  `).join('');

  return `
    <aside class="results-sidebar" id="resultsSidebar" aria-label="Навигация по результатам">
      <nav class="sidebar-nav">${links}</nav>
    </aside>
  `;
}

function activateResultsSidebar() {
  if (sectionObserver) {
    sectionObserver.disconnect();
    sectionObserver = null;
  }

  const links = Array.from(document.querySelectorAll('.sidebar-link'));
  if (!links.length) return;

  const sections = RESULT_NAV_ITEMS
    .map(item => document.getElementById(item.id))
    .filter(Boolean);

  if (!sections.length) return;

  const visible = new Map();
  RESULT_NAV_ITEMS.forEach(item => visible.set(item.id, 0));

  const setActive = (id) => {
    links.forEach(link => link.classList.toggle('active', link.dataset.target === id));
  };

  setActive(RESULT_NAV_ITEMS[0].id);

  sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      visible.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
    });

    let activeId = RESULT_NAV_ITEMS[0].id;
    let bestRatio = -1;

    RESULT_NAV_ITEMS.forEach(item => {
      const ratio = visible.get(item.id) || 0;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        activeId = item.id;
      }
    });

    if (bestRatio <= 0) {
      const probeY = window.scrollY + 160;
      RESULT_NAV_ITEMS.forEach(item => {
        const el = document.getElementById(item.id);
        if (el && el.offsetTop <= probeY) activeId = item.id;
      });
    }

    setActive(activeId);
  }, {
    root: null,
    rootMargin: '-25% 0px -60% 0px',
    threshold: [0.15, 0.35, 0.6]
  });

  sections.forEach(section => sectionObserver.observe(section));
}

function renderResults(ref, mine, comp) {
  const r = document.getElementById('results');
  const sColor = comp.score >= 85 ? '#22C55E' : comp.score >= 60 ? '#F59E0B' : '#EF4444';
  const verdict = comp.score >= 85
    ? 'Звучит близко к референсу. Остались мелкие правки.'
    : comp.score >= 60
      ? 'Есть над чем поработать. Начни с приоритетов ниже.'
      : 'Сильные отличия. Начни с основной цепочки ниже.';

  const recipe = comp.reverseRecipe || {
    chainLabel: '[Gate] → [HPF] → [EQ] → [Comp] → [De-esser] → [Reverb] → [Loudness]',
    gate: { action: 'Gate по необходимости.', enabled: false },
    hpf: { action: 'HPF около 80-100 Hz.' },
    eq: { staticCuts: [], dynamicEq: { needed: false }, tiltAction: null },
    compressor: { needed: false, action: comp.compAction || 'Компрессия по необходимости.' },
    deesser: { needed: false, action: comp.deesserAction || 'De-Esser по необходимости.' },
    reverb: { needed: false, action: 'Реверб по необходимости.' },
    loudness: { targetLufs: -14, refLufs: ref.lufs.lufsI, mineLufs: mine.lufs.lufsI, toTarget: -14 - mine.lufs.lufsI },
    priorities: comp.priorities || []
  };

  const topActions = (recipe.priorities && recipe.priorities.length)
    ? recipe.priorities.slice(0, 3)
    : (comp.priorities && comp.priorities.length ? comp.priorities.slice(0, 3) : ['Сначала поставь HPF и убери самые заметные резонансы.']);

  let html = '<div class="results-layout">';
  html += buildResultsSidebar();
  html += '<div class="results-content">';

  html += '<section id="section-score" class="result-section">';
  html += `<div class="results-topbar"><button class="rescan-btn rescan-btn-top" onclick="resetAnalyzerView()">↻ Сканировать заново</button></div>`;
  html += '<div class="dash-grid">';

  if (mine.clipping && mine.clipping.isClipping) {
    html += `<div class="card span-12"><div class="card-body"><div class="warn-banner" style="color:rgba(239,68,68,0.8);background:rgba(239,68,68,0.06);border-color:rgba(239,68,68,0.1)">${mine.clipping.advice}</div></div></div>`;
  }
  if (comp.durationWarning) {
    html += `<div class="card span-12"><div class="card-body"><div class="warn-banner">${comp.durationWarning}</div></div></div>`;
  }

  html += `<div class="card span-8">
    <div class="card-header">
      <div class="card-title"><div class="card-dot"></div>Итог</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <div style="display:flex;align-items:center;gap:6px"><span style="font-size:10px;color:var(--text-dim);letter-spacing:.05em">РЕФЕРЕНС</span>${fpBadge(ref.fp)}</div>
        <div style="display:flex;align-items:center;gap:6px"><span style="font-size:10px;color:var(--text-dim);letter-spacing:.05em">ТВОЙ ВОКАЛ</span>${fpBadge(mine.fp)}</div>
      </div>
    </div>
    <div class="card-body">
      <div class="score-hero">
        <div class="score-num" id="scoreNum" style="color:${sColor}">--</div>
        <div class="score-info">
          <div class="score-verdict">${verdict}</div>
          <div class="score-desc">Рецепт собран из анализа референса и адаптирован под твой сухой вокал.</div>
        </div>
      </div>
      <div class="advice-pill"><strong>Цепочка:</strong> ${recipe.chainLabel}</div>
    </div>
  </div>`;

  html += `<div class="card span-4">
    <div class="card-header"><div class="card-title"><div class="card-dot"></div>Топ-3 действия</div></div>
    <div class="card-body">`;
  topActions.forEach((action, i) => {
    html += `<div class="advice-pill" style="margin-bottom:8px"><strong>${i + 1}.</strong> ${action}</div>`;
  });
  html += '</div></div>';

  html += '</div></section>';

  html += '<section id="section-eq" class="result-section"><div class="dash-grid">';
  html += `<div class="chain-step span-12">
    <div class="chain-header">
      <div class="chain-num">1</div>
      <div><div class="chain-title">Эквалайзер</div><div class="chain-subtitle">Gate → HPF → EQ</div></div>
    </div>
    <div class="chain-body">`;

  html += `<div class="action-item"><div class="action-main">${recipe.gate.action}</div><div class="action-detail">${recipe.gate.enabled ? 'Референс с очень чистыми паузами.' : 'Паузы не требуют жёсткого gating.'}</div></div>`;
  html += `<div class="action-item"><div class="action-main">${recipe.hpf.action}</div><div class="action-detail">HPF восстанавливается по перегибу НЧ у референса.</div></div>`;

  if (recipe.eq.dynamicEq && recipe.eq.dynamicEq.needed) {
    html += `<div class="action-item"><div class="action-main">${recipe.eq.dynamicEq.action}</div><div class="action-detail">Резонанс сильнее в тихих фразах — это ближний эффект микрофона.</div></div>`;
  }

  if (recipe.eq.staticCuts && recipe.eq.staticCuts.length > 0) {
    recipe.eq.staticCuts.forEach(c => {
      html += `<div class="action-item"><div class="action-main">Подрежь ${c.freqHz} Hz на ${-Math.abs(c.cutDb)} dB (Q ${c.q})</div><div class="action-detail">${c.label}</div></div>`;
    });
  }

  if (recipe.eq.tiltAction) {
    html += `<div class="action-item"><div class="action-main">${recipe.eq.tiltAction}</div><div class="action-detail">Тональный баланс подгоняется под референс.</div></div>`;
  }

  html += '</div></div></div></section>';

  html += '<section id="section-comp" class="result-section"><div class="dash-grid">';
  html += `<div class="chain-step span-12">
    <div class="chain-header">
      <div class="chain-num">2</div>
      <div><div class="chain-title">Компрессор</div><div class="chain-subtitle">Параметры восстановлены из референса</div></div>
    </div>
    <div class="chain-body">`;
  html += `<div class="action-item"><div class="action-main">${recipe.compressor.action}</div><div class="action-detail">${comp.compAdvice} ${comp.dynAdvice}</div></div>`;
  html += '</div></div></div></section>';

  html += '<section id="section-deesser" class="result-section"><div class="dash-grid">';
  html += `<div class="chain-step span-12">
    <div class="chain-header">
      <div class="chain-num">3</div>
      <div><div class="chain-title">Де-эссер / Реверб</div><div class="chain-subtitle">Сибилянты и хвосты фраз</div></div>
    </div>
    <div class="chain-body">`;
  html += `<div class="action-item"><div class="action-main">${recipe.deesser.action}</div><div class="action-detail">${comp.harshAdvice}</div></div>`;
  html += `<div class="action-item"><div class="action-main">${recipe.reverb.action}</div><div class="action-detail">Хвосты фраз: реф ${recipe.reverb.refTailMs || 0} мс, твой ${recipe.reverb.mineTailMs || 0} мс.</div></div>`;
  html += '</div></div></div></section>';

  html += '<section id="section-loudness" class="result-section"><div class="dash-grid">';
  html += `<div class="chain-step span-12">
    <div class="chain-header">
      <div class="chain-num">4</div>
      <div><div class="chain-title">Громкость</div><div class="chain-subtitle">LUFS и финальный уровень</div></div>
    </div>
    <div class="chain-body">
      <div class="stat-row">
        <div class="stat-box"><div class="stat-box-label">Твой LUFS</div><div class="stat-box-value" style="color:var(--accent-pink)">${recipe.loudness.mineLufs}</div></div>
        <div class="stat-box"><div class="stat-box-label">Реф LUFS</div><div class="stat-box-value">${recipe.loudness.refLufs}</div></div>
        <div class="stat-box"><div class="stat-box-label">Target</div><div class="stat-box-value">${recipe.loudness.targetLufs}</div><div class="stat-box-sub">LUFS</div></div>
      </div>
      <div class="advice-pill">${recipe.loudness.toTarget > 0 ? `До цели не хватает ${recipe.loudness.toTarget.toFixed(1)} LU. Подними лимитером.` : `Ты выше цели на ${Math.abs(recipe.loudness.toTarget).toFixed(1)} LU. Можно слегка отпустить лимитер.`}</div>
    </div>
  </div>`;
  html += '</div></section>';

  html += '<section id="section-details" class="result-section"><div class="dash-grid">';
  html += `<div class="card span-8">
    <div class="card-header"><div class="card-title"><div class="card-dot"></div>Спектр</div></div>
    <div class="card-body"><div class="chart-wrap chart-wrap-tall"><canvas id="chSpec"></canvas></div></div>
  </div>`;

  if (mine.pitchData) {
    html += `<div class="card span-4">
      <div class="card-header"><div class="card-title"><div class="card-dot"></div>Стабильность питча</div></div>
      <div class="card-body">
        <div class="stat-row">
          <div class="stat-box"><div class="stat-box-label">Стабильность</div><div class="stat-box-value" style="color:${mine.pitchData.stabilityScore >= 70 ? 'var(--green)' : mine.pitchData.stabilityScore >= 40 ? 'var(--amber)' : 'var(--red)'}">${mine.pitchData.stabilityScore}</div><div class="stat-box-sub">/100</div></div>
          <div class="stat-box"><div class="stat-box-label">Разброс</div><div class="stat-box-value">±${mine.pitchData.stdCents}</div><div class="stat-box-sub">центов</div></div>
        </div>
        <div class="chart-wrap" style="height:150px"><canvas id="chPitch"></canvas></div>
      </div>
    </div>`;
  } else {
    html += `<div class="card span-4"><div class="card-header"><div class="card-title"><div class="card-dot"></div>Питч</div></div><div class="card-body"><div class="advice-pill">Недостаточно стабильных фрагментов для оценки питча.</div></div></div>`;
  }

  html += `<div class="card span-8">
    <div class="card-header"><div class="card-title"><div class="card-dot"></div>Частотные зоны</div></div>
    <div class="card-body">`;
  comp.bandDiffs.forEach(b => {
    const dCol = Math.abs(b.diff) < 4 ? 'var(--green)' : (b.diff > 0 ? '#E024B6' : '#F59E0B');
    const rW = Math.max(4, Math.round((b.refE + 70) * 1.5));
    const mW = Math.max(4, Math.round((b.mineE + 70) * 1.5));
    html += `<div class="band-item"><div class="band-name">${b.name}<small>${b.lo}-${b.hi}</small></div><div class="band-bars"><div class="band-bar-row"><div class="band-bar-label" style="color:#E024B6">R</div><div class="band-bar band-bar-ref" style="width:${rW}px"></div></div><div class="band-bar-row"><div class="band-bar-label" style="color:#7000FF">M</div><div class="band-bar band-bar-mine" style="width:${mW}px"></div></div></div><div class="band-diff-val" style="color:${dCol}">${b.diff > 0 ? '+' : ''}${b.diff.toFixed(1)}</div></div>`;
  });
  html += '</div></div>';

  html += `<div class="card span-4">
    <div class="card-header"><div class="card-title"><div class="card-dot"></div>Шум</div></div>
    <div class="card-body">
      <div class="stat-row">
        <div class="stat-box"><div class="stat-box-label">Noise Floor</div><div class="stat-box-value" style="color:${mine.noise.noiseLevel > -50 ? 'var(--red)' : mine.noise.noiseLevel > -60 ? 'var(--amber)' : 'var(--green)'}">${mine.noise.noiseLevel}</div><div class="stat-box-sub">dBFS</div></div>
        <div class="stat-box"><div class="stat-box-label">SNR</div><div class="stat-box-value">${mine.noise.snr}</div><div class="stat-box-sub">dB</div></div>
      </div>
      <div class="advice-pill">${mine.noise.advice}</div>
    </div>
  </div>`;

  html += `<div class="card span-12">
    <div class="card-header"><div class="card-title"><div class="card-dot"></div>Огибающая громкости</div></div>
    <div class="card-body"><div class="chart-wrap"><canvas id="chEnv"></canvas></div></div>
  </div>`;

  html += '</div></section>';

  html += '<section id="section-export" class="result-section"><div class="dash-grid">';
  html += `<div class="card span-12">
    <div class="card-header"><div class="card-title"><div class="card-dot"></div>Экспорт</div></div>
    <div class="card-body">
      <button class="copy-btn" id="copySettingsBtn" onclick="copySettings()">📋 Скопировать настройки</button>
      <pre id="settingsText" style="display:none;font-family:'Inter',sans-serif;font-size:12px;color:var(--text-muted);background:rgba(255,255,255,0.02);padding:16px;border-radius:12px;margin-top:12px;white-space:pre-wrap;border:1px solid var(--border-card);line-height:1.6">${generateSettingsText(ref, mine, comp)}</pre>
    </div>
  </div>`;
  html += '</div></section>';

  html += '</div></div>';

  r.innerHTML = html;
  r.style.display = 'block';
  setAppState('results');
  window.scrollTo({ top: r.offsetTop - 20, behavior: 'smooth' });

  setTimeout(() => {
    const scoreNum = document.getElementById('scoreNum');
    if (scoreNum) animateNumber(scoreNum, 0, comp.score, 1200);
  }, 200);

  activateResultsSidebar();
  buildCharts(ref, mine);
}
// SETTINGS TEXT
// ============================================================
function generateSettingsText(ref, mine, comp) {
  const recipe = comp.reverseRecipe;
  if (recipe) {
    let t = '== BULAVIN AI ANALYZER — Рецепт цепочки ==\n\n';
    t += `[Chain]\n${recipe.chainLabel}\n\n`;
    t += `[Gate]\n• ${recipe.gate.action}\n\n`;
    t += `[HPF]\n• ${recipe.hpf.action}\n\n`;

    t += '[EQ]\n';
    if (recipe.eq.dynamicEq && recipe.eq.dynamicEq.needed) {
      t += `• ${recipe.eq.dynamicEq.action}\n`;
    }
    if (recipe.eq.staticCuts && recipe.eq.staticCuts.length) {
      recipe.eq.staticCuts.forEach(c => {
        t += `• ${c.freqHz} Hz: -${Math.abs(c.cutDb)} dB, Q=${c.q}\n`;
      });
    } else {
      t += '• Явных статических срезов не требуется\n';
    }
    if (recipe.eq.tiltAction) t += `• ${recipe.eq.tiltAction}\n`;
    t += '\n';

    t += `[Compressor]\n• ${recipe.compressor.action}\n\n`;
    t += `[De-Esser]\n• ${recipe.deesser.action}\n\n`;
    t += `[Reverb]\n• ${recipe.reverb.action}\n\n`;
    t += `[Loudness]\n• Реф: ${recipe.loudness.refLufs} LUFS\n• Твой: ${recipe.loudness.mineLufs} LUFS\n• Цель: ${recipe.loudness.targetLufs} LUFS\n`;
    return t;
  }

  let t = '== BULAVIN AI ANALYZER v2.0 — Настройки ==\n\n';
  const eqBands = comp.bandDiffs.filter(b => b.severity !== 'ok' && Math.abs(b.diff) >= 4 && Math.abs(b.diff) < 12);
  if (mine.fundamental) {
    t += `[High-Pass Filter]\n• Частота: ${Math.round(mine.fundamental.freq * 0.6)} Hz\n\n`;
  }
  if (mine.resonances.length > 0) {
    t += '[Resonance EQ Cuts]\n';
    mine.resonances.slice(0, 5).forEach(r => t += `• ${r.freq} Hz: −${r.cutDb} dB, Q=${r.Q} (${r.label})\n`);
    t += '\n';
  }
  if (eqBands.length > 0) {
    t += '[Parametric EQ]\n';
    eqBands.forEach(b => {
      const mid = Math.round((b.lo + b.hi) / 2);
      const gain = b.diff > 0 ? `+${Math.min(b.diff, 6).toFixed(1)}` : `${Math.max(b.diff, -6).toFixed(1)}`;
      t += `• ${b.name} ${mid} Hz: ${gain} dB, Q=1.5\n`;
    });
    t += '\n';
  }
  if (comp.compAction) t += `[Compressor]\n• ${comp.compAction}\n\n`;
  if (comp.deesserAction) t += `[De-Esser]\n• ${comp.deesserAction}\n\n`;
  t += `[Loudness]\n• Текущий: ${mine.lufs.lufsI} LUFS-I\n• Цель: −14.0 LUFS\n`;
  return t;
}
function copySettings() {
  const text = document.getElementById('settingsText').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const b = document.getElementById('copySettingsBtn');
    b.className = 'copy-btn copied'; b.innerHTML = '✓ Скопировано!';
    document.getElementById('settingsText').style.display = 'block';
    setTimeout(() => { b.className = 'copy-btn'; b.innerHTML = '📋 Скопировать настройки'; }, 2000);
  });
}

// ============================================================
// CHART.JS — Neon Glow
// ============================================================
function buildCharts(ref, mine) {
  const fmtFreq = f => f < 1000 ? f.toFixed(0) : (f / 1000).toFixed(1) + 'k';
  const chartFont = { family: 'Inter, sans-serif' };
  const gridColor = 'rgba(255,255,255,0.04)';
  const tickColor = '#55566A';

  const glowPlugin = {
    id: 'neonGlow',
    beforeDatasetsDraw(chart) { chart.ctx.save(); chart.ctx.shadowColor = '#E024B6'; chart.ctx.shadowBlur = 15; },
    afterDatasetsDraw(chart) { chart.ctx.restore(); }
  };

  const specCtx = document.getElementById('chSpec').getContext('2d');
  const sg1 = specCtx.createLinearGradient(0, 0, 0, 300);
  sg1.addColorStop(0, 'rgba(224,36,182,0.25)'); sg1.addColorStop(0.5, 'rgba(224,36,182,0.05)'); sg1.addColorStop(1, 'transparent');
  const sg2 = specCtx.createLinearGradient(0, 0, 0, 300);
  sg2.addColorStop(0, 'rgba(112,0,255,0.15)'); sg2.addColorStop(1, 'transparent');

  new Chart(specCtx, {
    type: 'line', plugins: [glowPlugin],
    data: {
      labels: ref.specFreqs.map(fmtFreq),
      datasets: [
        { label: 'Референс', data: ref.specDb, borderColor: '#E024B6', borderWidth: 2.5, pointRadius: 0, tension: 0.3, fill: true, backgroundColor: sg1 },
        { label: 'Твой вокал', data: mine.specDb.slice(0, ref.specFreqs.length), borderColor: '#7000FF', borderWidth: 2, pointRadius: 0, tension: 0.3, fill: true, backgroundColor: sg2 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: '#8A8C9B', font: chartFont, usePointStyle: true, pointStyle: 'circle' } }, tooltip: { backgroundColor: '#1C1C24', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, titleColor: '#fff', bodyColor: '#8A8C9B' } },
      scales: {
        x: { ticks: { color: tickColor, maxTicksLimit: 18, font: { ...chartFont, size: 10 } }, grid: { color: gridColor } },
        y: { ticks: { color: tickColor, font: { ...chartFont, size: 10 } }, grid: { color: gridColor } }
      }
    }
  });

  const minLen = Math.min(ref.envTime.length, mine.envTime.length);
  const envCtx = document.getElementById('chEnv').getContext('2d');
  const eg = envCtx.createLinearGradient(0, 0, 0, 220);
  eg.addColorStop(0, 'rgba(224,36,182,0.15)'); eg.addColorStop(1, 'transparent');

  new Chart(envCtx, {
    type: 'line', plugins: [glowPlugin],
    data: {
      labels: mine.envTime.slice(0, minLen).map(t => t.toFixed(1)),
      datasets: [
        { label: 'Референс', data: ref.envDb.slice(0, minLen), borderColor: '#E024B6', borderWidth: 2, pointRadius: 0, tension: 0.1, fill: true, backgroundColor: eg },
        { label: 'Твой вокал', data: mine.envDb.slice(0, minLen), borderColor: '#7000FF', borderWidth: 1.5, pointRadius: 0, tension: 0.1, fill: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: '#8A8C9B', font: chartFont, usePointStyle: true, pointStyle: 'circle' } } },
      scales: {
        x: { ticks: { color: tickColor, maxTicksLimit: 20, font: { ...chartFont, size: 10 } }, grid: { color: gridColor } },
        y: { min: -65, max: 0, ticks: { color: tickColor, font: { ...chartFont, size: 10 } }, grid: { color: gridColor } }
      }
    }
  });

  const pitchCanvas = document.getElementById('chPitch');
  if (pitchCanvas && mine.pitchData) {
    new Chart(pitchCanvas, {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'Питч', data: mine.pitchData.frames.map(f => ({ x: f.time, y: f.freq })),
          borderColor: '#E024B6',
          backgroundColor: mine.pitchData.frames.map(f => {
            const dev = Math.abs(1200 * Math.log2(f.freq / mine.pitchData.medianFreq));
            return dev < 15 ? 'rgba(34,197,94,0.4)' : dev < 30 ? 'rgba(245,158,11,0.4)' : 'rgba(239,68,68,0.4)';
          }),
          pointRadius: 2.5, pointHoverRadius: 5
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: 'с', color: tickColor }, ticks: { color: tickColor, font: { ...chartFont, size: 10 } }, grid: { color: gridColor } },
          y: { title: { display: true, text: 'Hz', color: tickColor }, ticks: { color: tickColor, font: { ...chartFont, size: 10 } }, grid: { color: gridColor } }
        }
      }
    });
  }
}













