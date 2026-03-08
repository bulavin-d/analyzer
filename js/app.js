/* ============================================================
   BULAVIN AI ANALYZER — App Module
   File handling, UI rendering, Chart.js integration
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

// --- File Handling ---
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
        if (isRef) {
            refBuffer = audio; refName = file.name;
            document.getElementById('nameRef').textContent = '✅ ' + file.name;
            dropRef.classList.add('loaded');
        } else {
            mineBuffer = audio; mineName = file.name;
            document.getElementById('nameMine').textContent = '✅ ' + file.name;
            dropMine.classList.add('loaded');
        }
        checkReady();
    } catch (e) {
        alert('Ошибка загрузки файла: ' + e.message + '\n\nПоддерживаются только WAV файлы.');
    }
}

function checkReady() {
    if (refBuffer && mineBuffer) {
        btn.disabled = false;
        btn.className = 'analyze-btn ready';
        btn.textContent = '🔥 СРАВНИТЬ';
    }
}

setupDrop(dropRef, fileRef, true);
setupDrop(dropMine, fileMine, false);
btn.addEventListener('click', () => { if (refBuffer && mineBuffer) runAnalysis(); });

// --- Analysis Runner ---
async function runAnalysis() {
    btn.disabled = true;
    btn.className = 'analyze-btn disabled';
    btn.textContent = 'Анализирую...';
    const prog = document.getElementById('progress');
    const fill = document.getElementById('progFill');
    const text = document.getElementById('progText');
    prog.style.display = 'block';
    document.getElementById('results').style.display = 'none';

    await sleep(80);
    text.textContent = '⏳ Анализ референса...'; fill.style.width = '20%';
    await sleep(30);
    const refResult = analyzeTrack(refBuffer);

    text.textContent = '⏳ Анализ твоего вокала...'; fill.style.width = '55%';
    await sleep(30);
    const mineResult = analyzeTrack(mineBuffer);

    text.textContent = '⏳ Сравнение...'; fill.style.width = '85%';
    await sleep(30);
    const comp = compare(refResult, mineResult);

    text.textContent = '✅ Готово!'; fill.style.width = '100%';
    await sleep(250);

    renderResults(refResult, mineResult, comp);
    prog.style.display = 'none';
    btn.className = 'analyze-btn ready';
    btn.textContent = '🔄 СРАВНИТЬ ЗАНОВО';
    btn.disabled = false;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// RENDER RESULTS
// ============================================================
function renderResults(ref, mine, comp) {
    const r = document.getElementById('results');
    const sColor = comp.score >= 80 ? '#2ECC71' : (comp.score >= 55 ? '#F7DC6F' : '#FF6B35');
    let html = '';

    // --- SCORE ---
    html += `<div class="card score-wrap">
    <div class="score-num" style="color:${sColor}">${comp.score}</div>
    <div class="score-label">Match Score — насколько тональный баланс совпадает</div>
  </div>`;

    // --- PRIORITIES ---
    html += `<div class="card"><h2><span class="ic">🎯</span> На что обратить внимание</h2>`;
    if (comp.priorities.length === 0)
        html += `<div class="pri pri-ok">Все зоны в пределах нормы — звук близок к референсу 🔥</div>`;
    else
        comp.priorities.forEach((p, i) => html += `<div class="pri">${i + 1}. ${p}</div>`);
    html += `</div>`;

    // --- DYNAMICS ---
    html += `<div class="card"><h2><span class="ic">📊</span> Динамика и компрессия</h2>
    <div class="hint">Эти числа показывают, насколько ровно звучит голос. Crest Factor = разница между пиками и средней громкостью. Чем меньше — тем плотнее вокал.</div>
    <div class="stats">
      <div class="st"><div class="sl">Crest Factor</div><div class="sv">${mine.crest.toFixed(1)}</div><div class="ss">Реф: ${ref.crest.toFixed(1)} dB</div></div>
      <div class="st"><div class="sl">Dynamic Range</div><div class="sv">${mine.dynRange.toFixed(1)}</div><div class="ss">Реф: ${ref.dynRange.toFixed(1)} dB</div></div>
      <div class="st"><div class="sl">Active RMS</div><div class="sv">${mine.activeRmsDb.toFixed(1)}</div><div class="ss">Реф: ${ref.activeRmsDb.toFixed(1)} dBFS</div></div>
      <div class="st"><div class="sl">Peak</div><div class="sv">${mine.peakDb.toFixed(1)}</div><div class="ss">Реф: ${ref.peakDb.toFixed(1)} dBFS</div></div>
    </div>
    <div class="advice-block">💡 ${comp.compAdvice}</div>
    <div class="advice-block" style="border-left-color:#9B59B6">💡 ${comp.dynAdvice}</div>
  </div>`;

    // --- NEW: FUNDAMENTAL TONE ---
    html += `<div class="card"><h2><span class="ic">🎵</span> Основной тон голоса</h2>
    <div class="hint">Это самая низкая частота, на которой реально вибрирует твой голос. Всё что ниже — шум и "proximity effect" от микрофона. HPF (high-pass filter) ставь ниже этой ноты.</div>
    <div class="feature-grid">`;

    if (mine.fundamental) {
        const note = freqToNote(mine.fundamental.freq);
        const hpfSafe = Math.round(mine.fundamental.freq * 0.55);
        html += `<div class="feature-box"><div class="fb-label">Твой голос</div>
      <div class="fb-value" style="color:var(--teal)">${Math.round(mine.fundamental.freq)} Hz</div>
      <div class="fb-sub">Нота: ${note} · Уверенность: ${(mine.fundamental.confidence * 100).toFixed(0)}%</div></div>`;
        html += `<div class="feature-box"><div class="fb-label">Безопасный HPF</div>
      <div class="fb-value" style="color:var(--green)">${hpfSafe} Hz</div>
      <div class="fb-sub">Всё что ниже ${hpfSafe} Гц — мусор, можно резать</div></div>`;
    } else {
        html += `<div class="feature-box"><div class="fb-label">Твой голос</div>
      <div class="fb-value" style="color:var(--text-dim)">—</div>
      <div class="fb-sub">Не удалось определить (мало тональных фрагментов)</div></div>`;
        html += `<div class="feature-box"><div class="fb-label">Безопасный HPF</div>
      <div class="fb-value" style="color:var(--text-dim)">~80 Hz</div>
      <div class="fb-sub">Стандартное значение для мужского вокала</div></div>`;
    }

    if (ref.fundamental) {
        const refNote = freqToNote(ref.fundamental.freq);
        html += `<div class="feature-box"><div class="fb-label">Референс</div>
      <div class="fb-value" style="color:var(--orange)">${Math.round(ref.fundamental.freq)} Hz</div>
      <div class="fb-sub">Нота: ${refNote} · Уверенность: ${(ref.fundamental.confidence * 100).toFixed(0)}%</div></div>`;
    }
    html += `</div></div>`;

    // --- NEW: HARSHNESS / SIBILANCE ---
    html += `<div class="card"><h2><span class="ic">🔊</span> Яркость и сибилянты</h2>
    <div class="hint">Индекс показывает, насколько "ядовитые" верхние частоты (4–10 кГц). Выше 65 = скорее всего нужен де-эссер или вырез в EQ. Ниже 35 = голос может звучать тускло.</div>`;

    // Mine
    const mhc = mine.harshness.index > 65 ? 'var(--red)' : (mine.harshness.index > 45 ? 'var(--yellow)' : 'var(--green)');
    html += `<div class="feature-grid">
    <div class="feature-box"><div class="fb-label">Твой индекс яркости</div>
      <div class="fb-value" style="color:${mhc}">${mine.harshness.index}</div>
      <div class="fb-sub">${mine.harshness.index > 65 ? 'Верха агрессивные' : mine.harshness.index > 45 ? 'Норма' : 'Верха приглушены'}</div></div>
    <div class="feature-box"><div class="fb-label">Пик сибилянтов</div>
      <div class="fb-value" style="color:var(--teal)">${mine.harshness.deesserFreq} Hz</div>
      <div class="fb-sub">Де-эссер ставь на эту частоту</div></div>
    <div class="feature-box"><div class="fb-label">Реф: индекс яркости</div>
      <div class="fb-value" style="color:var(--orange)">${ref.harshness.index}</div>
      <div class="fb-sub">${ref.harshness.index > 65 ? 'Верха агрессивные' : ref.harshness.index > 45 ? 'Норма' : 'Верха приглушены'}</div></div>
    <div class="feature-box"><div class="fb-label">Реф: пик сибилянтов</div>
      <div class="fb-value" style="color:var(--orange)">${ref.harshness.deesserFreq} Hz</div>
      <div class="fb-sub">У рефа максимум тут</div></div>
  </div>`;
    html += `<div class="advice-block" style="border-left-color:var(--red)">💡 ${comp.harshAdvice}</div></div>`;

    // --- NEW: STEREO FIELD ---
    if (mine.isStereo || ref.isStereo) {
        html += `<div class="card"><h2><span class="ic">🔄</span> Стерео и фаза</h2>
      <div class="hint">Корреляция = насколько левый и правый каналы "согласованы". +1.0 = чистый моно, 0 = широкий стерео, минус = фазовые проблемы (в моно пропадёт звук).</div>`;

        if (mine.stereo) {
            const phaseOk = mine.stereo.avgCorr > 0.3;
            const pColor = phaseOk ? 'var(--green)' : 'var(--red)';
            html += `<div class="feature-grid">
        <div class="feature-box"><div class="fb-label">Корреляция L/R</div>
          <div class="fb-value" style="color:${pColor}">${mine.stereo.avgCorr.toFixed(2)}</div>
          <div class="fb-sub">${phaseOk ? 'Моно-совместим ✅' : '⚠️ Фазовые проблемы!'}</div></div>
        <div class="feature-box"><div class="fb-label">Ширина стерео</div>
          <div class="fb-value" style="color:var(--teal)">${(mine.stereo.width * 100).toFixed(0)}%</div>
          <div class="fb-sub">${mine.stereo.width < 0.1 ? 'Моно' : mine.stereo.width < 0.4 ? 'Узкий' : mine.stereo.width < 0.7 ? 'Средний' : 'Широкий'}</div></div>
      </div>`;
            if (mine.stereo.phaseIssuePercent > 5) {
                html += `<div class="advice-block" style="border-left-color:var(--red)">⚠️ ${mine.stereo.phaseIssuePercent.toFixed(0)}% фреймов с отрицательной корреляцией — в моно эти участки пропадут. Проверь стерео-расширители.</div>`;
            }
        } else {
            html += `<div class="advice-block" style="border-left-color:var(--green)">Файл моно — фазовых проблем быть не может 👍</div>`;
        }
        html += `</div>`;
    }

    // --- BAND COMPARISON ---
    html += `<div class="card"><h2><span class="ic">🎚️</span> Сравнение по частотным зонам</h2>
    <div class="hint">Программа выровняла громкость файлов. Сравнивается ФОРМА звука, а не кто громче записан. Тут видно какие частоты у тебя перекачаны или недокачаны.</div>`;

    comp.bandDiffs.forEach(b => {
        const sCls = b.severity === 'ok' ? 'bv-ok' : (b.severity === 'boost' ? 'bv-boost' : 'bv-cut');
        const sText = b.severity === 'ok' ? '✅' : (b.severity === 'boost' ? '🔺' : '🔻');
        const dCol = Math.abs(b.diff) < 4 ? '#2ECC71' : (b.diff > 0 ? '#4ECDC4' : '#FF6B35');
        const rW = Math.max(4, Math.round((b.refE + 70) * 1.4));
        const mW = Math.max(4, Math.round((b.mineE + 70) * 1.4));
        html += `<div class="brow">
      <div class="bn">${b.name}</div><div class="bf">${b.lo}–${b.hi}</div>
      <div class="bb"><div class="bbar" style="width:${rW}px;background:var(--orange)"></div><div class="bbar" style="width:${mW}px;background:var(--teal)"></div></div>
      <div class="bd" style="color:${dCol}">${b.diff > 0 ? '+' : ''}${b.diff.toFixed(1)}</div>
      <div class="bv ${sCls}">${sText}</div>
    </div><div class="badvice">${b.desc} — ${b.advice}</div>`;
    });
    html += `<div class="leg"><span><div class="dot" style="background:var(--orange)"></div> Референс</span><span><div class="dot" style="background:var(--teal)"></div> Твой вокал</span></div></div>`;

    // --- SPECTRUM CHART ---
    html += `<div class="card"><h2><span class="ic">📈</span> Спектр</h2>
    <div class="hint">Это "форма" каждого голоса по частотам. Где оранжевая линия выше — у тебя не хватает. Где бирюзовая выше — лишнее. Наведи мышкой на любую точку.</div>
    <div class="chwrap chwrap-tall"><canvas id="chSpec"></canvas></div></div>`;

    // --- RESONANCES ---
    html += `<div class="card"><h2><span class="ic">🔔</span> Резонансы голоса</h2>
    <div class="hint">Эти частоты "торчат" в твоём вокале больше остальных — это личные резонансы голоса и микрофона. Если звучит грязно — подрежь их узким EQ.</div>`;
    if (mine.resonances.length > 0) {
        mine.resonances.slice(0, 6).forEach(res => {
            const cut = Math.min(res.excess * 0.4, 3.5).toFixed(1);
            const q = Math.min(res.excess / 3, 4.5).toFixed(1);
            html += `<span class="rtag"><span class="rfreq">${res.freq.toFixed(0)} Hz</span> <span class="rexc">+${res.excess.toFixed(1)} дБ → подрежь на -${cut}, Q ${q}</span></span>`;
        });
    } else {
        html += `<div class="advice-block pri-ok">Явных резонансов не обнаружено 👍</div>`;
    }
    html += `</div>`;

    // --- ENVELOPE CHART ---
    html += `<div class="card"><h2><span class="ic">📉</span> Динамическая огибающая</h2>
    <div class="hint">График громкости во времени. Если бирюзовая линия скачет сильнее оранжевой — компрессоры не справляются. У хорошо сжатого вокала линия ровная.</div>
    <div class="chwrap"><canvas id="chEnv"></canvas></div></div>`;

    r.innerHTML = html;
    r.style.display = 'block';
    window.scrollTo({ top: r.offsetTop - 20, behavior: 'smooth' });

    // --- CHARTS ---
    buildCharts(ref, mine);
}

// ============================================================
// CHART.JS
// ============================================================
function buildCharts(ref, mine) {
    const fmtFreq = f => f < 1000 ? f.toFixed(0) : (f / 1000).toFixed(1) + 'k';
    const chartFont = { family: 'Inter' };

    // Spectrum
    new Chart(document.getElementById('chSpec'), {
        type: 'line',
        data: {
            labels: ref.specFreqs.map(fmtFreq),
            datasets: [
                { label: 'Референс', data: ref.specDb, borderColor: '#FF6B35', borderWidth: 2, pointRadius: 0, tension: 0.3, fill: false },
                { label: 'Твой вокал', data: mine.specDb.slice(0, ref.specFreqs.length), borderColor: '#4ECDC4', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { color: '#777', font: chartFont } },
                tooltip: {
                    callbacks: {
                        title: c => c[0].label + ' Hz',
                        label: c => c.dataset.label + ': ' + c.parsed.y.toFixed(1) + ' dB'
                    }
                }
            },
            scales: {
                x: { ticks: { color: '#444', maxTicksLimit: 20, font: { ...chartFont, size: 10 } }, grid: { color: 'rgba(255,255,255,0.025)' }, title: { display: true, text: 'Частота (Hz)', color: '#444' } },
                y: { ticks: { color: '#444', font: { ...chartFont, size: 10 } }, grid: { color: 'rgba(255,255,255,0.03)' }, title: { display: true, text: 'Уровень (dB, нормализовано)', color: '#444' } }
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
                { label: 'Референс', data: ref.envDb.slice(0, minLen), borderColor: '#FF6B35', borderWidth: 1, pointRadius: 0, tension: 0.1, fill: false },
                { label: 'Твой вокал', data: mine.envDb.slice(0, minLen), borderColor: '#4ECDC4', borderWidth: 1, pointRadius: 0, tension: 0.1, fill: false }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { labels: { color: '#777', font: chartFont } } },
            scales: {
                x: { ticks: { color: '#444', maxTicksLimit: 20, font: { ...chartFont, size: 10 } }, grid: { color: 'rgba(255,255,255,0.025)' }, title: { display: true, text: 'Время (сек)', color: '#444' } },
                y: { min: -65, max: 0, ticks: { color: '#444', font: { ...chartFont, size: 10 } }, grid: { color: 'rgba(255,255,255,0.03)' }, title: { display: true, text: 'dBFS', color: '#444' } }
            }
        }
    });
}
