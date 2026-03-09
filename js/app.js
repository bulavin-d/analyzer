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

  // Show scanner beam OVER the waveform drop zones (not a grey box)
  const overlay = document.getElementById('scannerOverlay');
  if (overlay) overlay.style.display = 'block';

  const prog = document.getElementById('progress');
  const stepsEl = document.getElementById('scanSteps');
  stepsEl.innerHTML = '';
  document.getElementById('scanBarFill').style.width = '0%';
  prog.style.display = 'flex';
  document.getElementById('results').innerHTML = '';

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
  await sleep(400);

  // Stop scanner beam, show results
  if (overlay) overlay.style.display = 'none';
  renderResults(refResult, mineResult, comp);
  prog.style.display = 'none';
  btn.style.display = 'none';
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
function renderResults(ref, mine, comp) {
  const r = document.getElementById('results');
  const sColor = comp.score >= 85 ? '#22C55E' : comp.score >= 60 ? '#F59E0B' : '#EF4444';
  let html = '<div class="dash-grid">';

  // ── WARNINGS ──
  if (mine.clipping && mine.clipping.isClipping)
    html += `<div class="card span-12"><div class="card-body"><div class="warn-banner" style="color:rgba(239,68,68,0.8);background:rgba(239,68,68,0.06);border-color:rgba(239,68,68,0.1)">${mine.clipping.advice}</div></div></div>`;
  if (comp.durationWarning)
    html += `<div class="card span-12"><div class="card-body"><div class="warn-banner">${comp.durationWarning}</div></div></div>`;
  if (ref.fp.hasReverb && mine.fp.isDry)
    html += `<div class="card span-12"><div class="card-body"><div class="warn-banner" style="color:rgba(224,36,182,0.75);background:rgba(224,36,182,0.06);border-color:rgba(224,36,182,0.1)">Референс содержит реверб (${(ref.fp.reverbAmount * 100).toFixed(0)}%). Анализ учитывает это.</div></div></div>`;

  // ── BLOCK 0: MATCH SCORE (full width) ──
  html += `<div class="card span-8">
        <div class="card-header"><div class="card-title"><div class="card-dot"></div>Match Score</div>
            <div style="display:flex;gap:8px">${fpBadge(ref.fp)} ${fpBadge(mine.fp)}</div>
        </div>
        <div class="card-body">
            <div class="score-hero">
                <div class="score-num" id="scoreNum" style="color:${sColor}">--</div>
                <div class="score-info">
                    <div class="score-verdict">${comp.score >= 85 ? 'Звук близок к референсу' : comp.score >= 60 ? 'Есть что подтянуть' : 'Значительные отличия'}</div>
                    <div class="score-desc">Совпадение спектра по вокальным зонам (Low-Mid – Clarity). Чем выше — тем ближе к референсу.</div>
                </div>
            </div>
        </div>
    </div>`;

  // ── LOUDNESS mini card (4 cols) ──
  html += `<div class="card span-4">
        <div class="card-header"><div class="card-title"><div class="card-dot"></div>Loudness</div></div>
        <div class="card-body">
            <div class="stat-row">
                <div class="stat-box"><div class="stat-box-label">LUFS-I</div><div class="stat-box-value" style="color:var(--accent-pink)">${mine.lufs.lufsI}</div></div>
                <div class="stat-box"><div class="stat-box-label">True Peak</div><div class="stat-box-value" style="color:${mine.lufs.truePeak > -1 ? 'var(--red)' : 'var(--green)'}">${mine.lufs.truePeak}</div><div class="stat-box-sub">dBTP</div></div>
            </div>
            <div class="stat-row" style="margin-top:4px">
                <div class="stat-box"><div class="stat-box-label">Реф LUFS</div><div class="stat-box-value">${ref.lufs.lufsI}</div></div>
                <div class="stat-box"><div class="stat-box-label">LRA</div><div class="stat-box-value">${mine.lufs.lra}</div><div class="stat-box-sub">LU</div></div>
            </div>`;
  const lufsDiff = -14 - mine.lufs.lufsI;
  if (Math.abs(lufsDiff) > 2)
    html += `<div class="advice-pill" style="margin-top:8px">${lufsDiff > 0 ? `Spotify −14 LUFS: нужно +${lufsDiff.toFixed(1)} LU. Лимитер.` : `Громче Spotify на ${Math.abs(lufsDiff).toFixed(1)} LU.`}</div>`;
  html += `</div></div>`;

  // ═══════════════════════════════════════════════════════════
  //  BLOCK 1: ШАГ 1 — ЭКВАЛАЙЗЕР
  // ═══════════════════════════════════════════════════════════
  html += `<div class="chain-step span-12">
        <div class="chain-header">
            <div class="chain-num">1</div>
            <div><div class="chain-title">Эквалайзер</div><div class="chain-subtitle">EQ · High-Pass · Резонансы · Тональный баланс</div></div>
        </div>
        <div class="chain-body">`;

  // 1a. HPF
  if (mine.fundamental) {
    const hpf = Math.round(mine.fundamental.freq * 0.6);
    const note = freqToNote(mine.fundamental.freq);
    html += `<div class="action-item">
            <div class="action-main">Поставь <strong>High-Pass (Low-Cut)</strong> фильтр на <strong>${hpf} Hz</strong></div>
            <div class="action-detail">Твой голос: ${Math.round(mine.fundamental.freq)} Hz (${note}). Всё ниже ${hpf} Hz — мусор, бубнение, гул комнаты.${ref.fundamental ? ` Реф: ${Math.round(ref.fundamental.freq)} Hz.` : ''}</div>
        </div>`;
  }

  // 1b. Resonances
  if (mine.resonances.length > 0) {
    mine.resonances.slice(0, 5).forEach((res, i) => {
      html += `<div class="action-item">
                <div class="action-main">Вырежи <strong>${res.freq} Hz</strong> на <strong style="color:var(--red)">−${res.cutDb} dB</strong> (Q: ${res.Q})</div>
                <div class="action-detail">${res.label} · Превышение +${res.excess.toFixed(1)} dB · ${res.priority === 1 ? 'Критичный резонанс' : res.priority === 2 ? 'Заметный резонанс' : 'Мелкий резонанс'}</div>
            </div>`;
    });
  } else {
    html += `<div class="action-ok">✓ Резонансов не обнаружено</div>`;
  }

  // 1c. Tilt / Balance
  if (comp.tiltAction) {
    html += `<div class="action-item">
            <div class="action-main">${comp.tiltAction.replace(/High-Shelf EQ/g, '<strong>High-Shelf EQ</strong>')}</div>
            <div class="action-detail">${comp.tiltAdvice}</div>
        </div>`;
  } else if (comp.tiltAdvice) {
    html += `<div class="action-ok">✓ ${comp.tiltAdvice}</div>`;
  }

  // 1d. Band EQ corrections
  const eqBands = comp.bandDiffs.filter(b => b.severity !== 'ok' && Math.abs(b.diff) >= 4 && Math.abs(b.diff) < 12);
  eqBands.forEach(b => {
    const mid = Math.round((b.lo + b.hi) / 2);
    const gain = b.diff > 0 ? `+${Math.min(b.diff, 6).toFixed(1)}` : `${Math.max(b.diff, -6).toFixed(1)}`;
    html += `<div class="action-item">
            <div class="action-main">${b.diff > 0 ? 'Добавь' : 'Убери'} <strong>${b.name}</strong> (${b.lo}–${b.hi} Hz): <strong>${gain} dB</strong></div>
            <div class="action-detail">${b.advice}</div>
        </div>`;
  });
  if (eqBands.length === 0 && mine.resonances.length === 0 && !comp.tiltAction) {
    html += `<div class="action-ok">✓ EQ коррекция не требуется — спектр совпадает с рефом</div>`;
  }

  html += `</div></div>`; // close chain-body, chain-step

  // ═══════════════════════════════════════════════════════════
  //  BLOCK 2: ШАГ 2 — КОМПРЕССИЯ
  // ═══════════════════════════════════════════════════════════
  html += `<div class="chain-step span-12">
        <div class="chain-header">
            <div class="chain-num">2</div>
            <div><div class="chain-title">Динамика</div><div class="chain-subtitle">Компрессия · Gain Reduction · Автоматизация</div></div>
        </div>
        <div class="chain-body">`;

  if (comp.compAction) {
    html += `<div class="action-item">
            <div class="action-main">${comp.compAction.replace(/Attack:|Release:|Ratio:|Gain Reduction/g, m => `<strong>${m}</strong>`)}</div>
            <div class="action-detail">${comp.compAdvice}</div>
        </div>`;
  } else {
    html += `<div class="action-ok">✓ ${comp.compAdvice}</div>`;
  }

  html += `<div class="action-item">
        <div class="action-detail" style="margin-top:0">${comp.dynAdvice}</div>
    </div>`;

  // Stats for geeks (small)
  html += `<div class="stat-row" style="margin-top:8px">
        <div class="stat-box"><div class="stat-box-label">Crest Factor</div><div class="stat-box-value">${mine.crest.toFixed(1)}</div><div class="stat-box-sub">Реф: ${ref.crest.toFixed(1)}</div></div>
        <div class="stat-box"><div class="stat-box-label">Dynamic Range</div><div class="stat-box-value">${mine.dynRange.toFixed(1)}</div><div class="stat-box-sub">Реф: ${ref.dynRange.toFixed(1)}</div></div>`;
  if (mine.transients) {
    html += `<div class="stat-box"><div class="stat-box-label">Атака вокала</div><div class="stat-box-value">${mine.transients.medianAttackMs}</div><div class="stat-box-sub">мс</div></div>`;
  }
  html += `</div></div></div>`;

  // ═══════════════════════════════════════════════════════════
  //  BLOCK 3: ШАГ 3 — ДЕ-ЭССЕР
  // ═══════════════════════════════════════════════════════════
  html += `<div class="chain-step span-12">
        <div class="chain-header">
            <div class="chain-num">3</div>
            <div><div class="chain-title">Де-эссер</div><div class="chain-subtitle">Яркость · Сибилянты · 4–10 kHz</div></div>
        </div>
        <div class="chain-body">`;

  if (comp.deesserAction) {
    html += `<div class="action-item">
            <div class="action-main">${comp.deesserAction.replace(/De-Esser|De-esser/g, '<strong>De-Esser</strong>').replace(/\d+ Hz/g, m => `<strong>${m}</strong>`)}</div>
            <div class="action-detail">${comp.harshAdvice}</div>
        </div>`;
  } else {
    html += `<div class="action-ok">✓ ${comp.harshAdvice}</div>`;
  }

  html += `<div class="stat-row" style="margin-top:8px">
        <div class="stat-box"><div class="stat-box-label">Яркость</div><div class="stat-box-value" style="color:${mine.harshness.index > 65 ? 'var(--red)' : mine.harshness.index > 45 ? 'var(--amber)' : 'var(--green)'}">${mine.harshness.index}</div><div class="stat-box-sub">Реф: ${ref.harshness.index}</div></div>
        <div class="stat-box"><div class="stat-box-label">Де-эссер freq</div><div class="stat-box-value" style="color:var(--accent-pink)">${mine.harshness.deesserFreq}</div><div class="stat-box-sub">Hz</div></div>
    </div></div></div>`;

  // ═══════════════════════════════════════════════════════════
  //  BLOCK 4: ШАГ 4 — ПРОСТРАНСТВО
  // ═══════════════════════════════════════════════════════════
  if (mine.isStereo || ref.isStereo) {
    html += `<div class="chain-step span-12">
            <div class="chain-header">
                <div class="chain-num">4</div>
                <div><div class="chain-title">Пространство</div><div class="chain-subtitle">Стерео · Фаза · Ширина</div></div>
            </div>
            <div class="chain-body">`;
    if (mine.stereo) {
      const pOk = mine.stereo.avgCorr > 0.3;
      if (pOk) {
        html += `<div class="action-ok">✓ Стерео в фазе (корреляция: ${mine.stereo.avgCorr.toFixed(2)}). Моно-совместимо.</div>`;
      } else {
        html += `<div class="action-item">
                    <div class="action-main">Фазовые конфликты! Корреляция: <strong style="color:var(--red)">${mine.stereo.avgCorr.toFixed(2)}</strong></div>
                    <div class="action-detail">${mine.stereo.phaseIssuePercent.toFixed(0)}% фреймов с конфликтами. Проверь плагины расширения стерео — возможно, Haas-эффект или MicroShift слишком агрессивные.</div>
                </div>`;
      }
      const widthPct = (mine.stereo.width * 100).toFixed(0);
      if (widthPct < 20) {
        html += `<div class="action-item">
                    <div class="action-main">Стерео слишком узкое (<strong>${widthPct}%</strong>)</div>
                    <div class="action-detail">Попробуй MicroShift, Dimension Expander или лёгкий стерео-дилэй (10–20 мс).</div>
                </div>`;
      }
    } else {
      html += `<div class="action-ok">✓ Моно-трек — фазовых проблем нет</div>`;
    }
    html += `</div></div>`;
  }

  // ═══════════════════════════════════════════════════════════
  //  CHARTS: Spectrum + Envelope (dashboard cards)
  // ═══════════════════════════════════════════════════════════
  html += `<div class="card span-8">
        <div class="card-header"><div class="card-title"><div class="card-dot"></div>Спектр</div></div>
        <div class="card-body"><div class="chart-wrap chart-wrap-tall"><canvas id="chSpec"></canvas></div></div>
    </div>`;

  // Pitch stability (if available)
  if (mine.pitchData) {
    html += `<div class="card span-4">
            <div class="card-header"><div class="card-title"><div class="card-dot"></div>Стабильность питча</div></div>
            <div class="card-body">
                <div class="stat-row">
                    <div class="stat-box"><div class="stat-box-label">Стабильность</div><div class="stat-box-value" style="color:${mine.pitchData.stabilityScore >= 70 ? 'var(--green)' : mine.pitchData.stabilityScore >= 40 ? 'var(--amber)' : 'var(--red)'}">${mine.pitchData.stabilityScore}</div><div class="stat-box-sub">/100</div></div>
                    <div class="stat-box"><div class="stat-box-label">Разброс</div><div class="stat-box-value">±${mine.pitchData.stdCents}</div><div class="stat-box-sub">центов</div></div>
                </div>
                ${mine.pitchData.stabilityScore < 70 ? `<div class="advice-pill" style="margin-top:8px">${mine.pitchData.stabilityScore < 40 ? 'Нужна коррекция: Newtone / Melodyne.' : 'Лёгкий автотюн улучшит звучание.'}</div>` : ''}
                <div class="chart-wrap" style="height:150px"><canvas id="chPitch"></canvas></div>
            </div></div>`;
  } else {
    // Noise + extra stats instead
    html += `<div class="card span-4">
            <div class="card-header"><div class="card-title"><div class="card-dot"></div>Шум</div></div>
            <div class="card-body">
                <div class="stat-row">
                    <div class="stat-box"><div class="stat-box-label">Noise Floor</div><div class="stat-box-value" style="color:${mine.noise.noiseLevel > -50 ? 'var(--red)' : mine.noise.noiseLevel > -60 ? 'var(--amber)' : 'var(--green)'}">${mine.noise.noiseLevel}</div><div class="stat-box-sub">dBFS</div></div>
                    <div class="stat-box"><div class="stat-box-label">SNR</div><div class="stat-box-value">${mine.noise.snr}</div><div class="stat-box-sub">dB</div></div>
                </div>
                <div class="advice-pill" style="margin-top:8px">${mine.noise.advice}</div>
            </div></div>`;
  }

  // Noise card (if pitch was shown)
  if (mine.pitchData) {
    html += `<div class="card span-4">
            <div class="card-header"><div class="card-title"><div class="card-dot"></div>Шум</div></div>
            <div class="card-body">
                <div class="stat-row">
                    <div class="stat-box"><div class="stat-box-label">Noise Floor</div><div class="stat-box-value" style="color:${mine.noise.noiseLevel > -50 ? 'var(--red)' : mine.noise.noiseLevel > -60 ? 'var(--amber)' : 'var(--green)'}">${mine.noise.noiseLevel}</div><div class="stat-box-sub">dBFS</div></div>
                    <div class="stat-box"><div class="stat-box-label">SNR</div><div class="stat-box-value">${mine.noise.snr}</div><div class="stat-box-sub">dB</div></div>
                </div>
                <div class="advice-pill" style="margin-top:8px">${mine.noise.advice}</div>
            </div></div>`;
  }

  // Band detail
  html += `<div class="card span-8">
        <div class="card-header"><div class="card-title"><div class="card-dot"></div>Частотные зоны</div></div>
        <div class="card-body">`;
  comp.bandDiffs.forEach(b => {
    const dCol = Math.abs(b.diff) < 4 ? 'var(--green)' : (b.diff > 0 ? '#E024B6' : '#F59E0B');
    const rW = Math.max(4, Math.round((b.refE + 70) * 1.5));
    const mW = Math.max(4, Math.round((b.mineE + 70) * 1.5));
    html += `<div class="band-item">
            <div class="band-name">${b.name}<small>${b.lo}–${b.hi}</small></div>
            <div class="band-bars">
                <div class="band-bar-row"><div class="band-bar-label" style="color:#E024B6">R</div><div class="band-bar band-bar-ref" style="width:${rW}px"></div></div>
                <div class="band-bar-row"><div class="band-bar-label" style="color:#7000FF">M</div><div class="band-bar band-bar-mine" style="width:${mW}px"></div></div>
            </div>
            <div class="band-diff-val" style="color:${dCol}">${b.diff > 0 ? '+' : ''}${b.diff.toFixed(1)}</div>
        </div>`;
  });
  html += `</div></div>`;

  // Envelope
  html += `<div class="card span-12">
        <div class="card-header"><div class="card-title"><div class="card-dot"></div>Огибающая громкости</div></div>
        <div class="card-body"><div class="chart-wrap"><canvas id="chEnv"></canvas></div></div>
    </div>`;

  // DAW Export
  html += `<div class="card span-12">
        <div class="card-header"><div class="card-title"><div class="card-dot"></div>Экспорт настроек</div></div>
        <div class="card-body">
            <button class="copy-btn" id="copySettingsBtn" onclick="copySettings()">📋 Скопировать настройки</button>
            <pre id="settingsText" style="display:none;font-family:'Inter',sans-serif;font-size:12px;color:var(--text-muted);background:rgba(255,255,255,0.02);padding:16px;border-radius:12px;margin-top:12px;white-space:pre-wrap;border:1px solid var(--border-card);line-height:1.6">${generateSettingsText(ref, mine, comp)}</pre>
        </div></div>`;

  // RESCAN button (at bottom, wide)
  html += `<div class="span-12"><button class="rescan-btn" onclick="location.reload()">↻ Сканировать заново</button></div>`;

  html += '</div>'; // close dash-grid
  r.innerHTML = html;
  r.style.display = 'block';
  window.scrollTo({ top: r.offsetTop - 20, behavior: 'smooth' });

  setTimeout(() => {
    const scoreNum = document.getElementById('scoreNum');
    if (scoreNum) animateNumber(scoreNum, 0, comp.score, 1200);
  }, 200);

  buildCharts(ref, mine);
}

// ============================================================
// SETTINGS TEXT
// ============================================================
function generateSettingsText(ref, mine, comp) {
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
  if (comp.compAction) {
    t += '[Compressor]\n';
    if (mine.transients) t += `• Attack: ${mine.transients.compAttackMs} мс\n• Release: ${mine.transients.compReleaseMs} мс\n`;
    t += `• Ratio: ${mine.crest > 18 ? '4:1' : '3:1'}\n\n`;
  }
  if (comp.deesserAction) {
    t += `[De-Esser]\n• Частота: ${mine.harshness.deesserFreq} Hz\n\n`;
  }
  if (mine.noise.noiseLevel > -60) {
    t += `[Noise Gate]\n• Threshold: ${mine.noise.noiseLevel + 6} dBFS\n• Attack: 2 мс, Release: 80 мс\n\n`;
  }
  t += `[Loudness]\n• Текущий: ${mine.lufs.lufsI} LUFS-I\n• Цель: −14.0 LUFS\n`;
  const diff = -14 - mine.lufs.lufsI;
  if (diff > 2) t += `• Нужно: +${diff.toFixed(1)} LU\n`;
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
