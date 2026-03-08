/* ============================================================
   BULAVIN AI ANALYZER v1.1 PRO — App Module
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
        alert('Ошибка загрузки: ' + e.message + '\n\nПоддерживаются WAV, FLAC, MP3, OGG, M4A.');
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
    text.textContent = '⏳ Обрезка тишины и анализ референса...'; fill.style.width = '20%';
    await sleep(30);
    const refResult = analyzeTrack(refBuffer);

    text.textContent = '⏳ Анализ твоего вокала...'; fill.style.width = '55%';
    await sleep(30);
    const mineResult = analyzeTrack(mineBuffer);

    text.textContent = '⏳ Сравнение и генерация рекомендаций...'; fill.style.width = '85%';
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

// --- Processing badge ---
function fpBadge(fp) {
    const labels = {
        dry: ['🎤 Сухой', 'var(--teal)'],
        lightly: ['🎛️ Лёгкая обработка', 'var(--yellow)'],
        processed: ['⚙️ Обработан', 'var(--orange)'],
        wet: ['🌊 С ревербом', 'var(--purple)']
    };
    const [text, color] = labels[fp.level] || labels.dry;
    return `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:rgba(255,255,255,0.05);color:${color};border:1px solid ${color};font-weight:600">${text}</span>`;
}

// ============================================================
// RENDER RESULTS
// ============================================================
function renderResults(ref, mine, comp) {
    const r = document.getElementById('results');
    const sColor = comp.score >= 85 ? '#2ECC71' : (comp.score >= 60 ? '#F7DC6F' : '#FF6B35');
    let html = '';

    // --- PROCESSING BADGES ---
    html += `<div class="card" style="text-align:center;padding:14px">
    <span style="font-size:12px;color:var(--text-dim)">Референс:</span> ${fpBadge(ref.fp)}
    <span style="margin-left:20px;font-size:12px;color:var(--text-dim)">Твой вокал:</span> ${fpBadge(mine.fp)}
  </div>`;

    // --- DURATION WARNING ---
    if (comp.durationWarning) {
        html += `<div class="card" style="border-left:3px solid var(--yellow);padding:12px 16px">
      <span style="font-size:12px;color:var(--yellow)">⚠️ ${comp.durationWarning}</span>
    </div>`;
    }

    // --- SCORE ---
    html += `<div class="card score-wrap">
    <div class="score-num" style="color:${sColor}">${comp.score}</div>
    <div class="score-label">Match Score — тональный баланс (взвешенный по важности зон)</div>
  </div>`;

    // --- PRIORITIES ---
    html += `<div class="card"><h2><span class="ic">🎯</span> Главное</h2>`;
    if (comp.priorities.length === 0)
        html += `<div class="pri pri-ok">Все зоны в пределах нормы — звук близок к референсу 🔥</div>`;
    else
        comp.priorities.forEach((p, i) => html += `<div class="pri">${i + 1}. ${p}</div>`);
    html += `</div>`;

    // --- DYNAMICS ---
    html += `<div class="card"><h2><span class="ic">📊</span> Динамика и компрессия</h2>
    <div class="hint">Crest Factor = пики vs средняя громкость (меньше = плотнее). Dynamic Range = разброс громкости (P5–P95, без экстремумов).</div>
    <div class="stats">
      <div class="st"><div class="sl">Crest Factor</div><div class="sv">${mine.crest.toFixed(1)}</div><div class="ss">Реф: ${ref.crest.toFixed(1)} dB</div></div>
      <div class="st"><div class="sl">Dynamic Range</div><div class="sv">${mine.dynRange.toFixed(1)}</div><div class="ss">Реф: ${ref.dynRange.toFixed(1)} dB</div></div>
      <div class="st"><div class="sl">Active RMS</div><div class="sv">${mine.activeRmsDb.toFixed(1)}</div><div class="ss">Реф: ${ref.activeRmsDb.toFixed(1)} dBFS</div></div>
      <div class="st"><div class="sl">Peak</div><div class="sv">${mine.peakDb.toFixed(1)}</div><div class="ss">Реф: ${ref.peakDb.toFixed(1)} dBFS</div></div>
    </div>
    <div class="advice-block">💡 ${comp.compAdvice}</div>
    <div class="advice-block" style="border-left-color:#9B59B6">💡 ${comp.dynAdvice}</div>
  </div>`;

    // --- FUNDAMENTAL TONE ---
    html += `<div class="card"><h2><span class="ic">🎵</span> Основной тон голоса</h2>
    <div class="hint">Самая низкая рабочая частота голоса. HPF ставь ниже неё — всё что ниже = грязь от микрофона и комнаты.</div>
    <div class="feature-grid">`;
    if (mine.fundamental) {
        const note = freqToNote(mine.fundamental.freq);
        const hpfSafe = Math.round(mine.fundamental.freq * 0.6);
        html += `<div class="feature-box"><div class="fb-label">Твой голос</div>
      <div class="fb-value" style="color:var(--teal)">${Math.round(mine.fundamental.freq)} Hz</div>
      <div class="fb-sub">Нота: ${note} · Уверенность: ${(mine.fundamental.confidence * 100).toFixed(0)}%</div></div>`;
        html += `<div class="feature-box"><div class="fb-label">HPF безопасно</div>
      <div class="fb-value" style="color:var(--green)">${hpfSafe} Hz</div>
      <div class="fb-sub">Ниже ${hpfSafe} Гц — режь не задумываясь</div></div>`;
    } else {
        html += `<div class="feature-box"><div class="fb-label">Твой голос</div>
      <div class="fb-value" style="color:var(--text-dim)">—</div>
      <div class="fb-sub">Мало тональных фрагментов в записи</div></div>`;
        html += `<div class="feature-box"><div class="fb-label">HPF безопасно</div>
      <div class="fb-value" style="color:var(--text-dim)">~80 Hz</div>
      <div class="fb-sub">Стандарт для мужского вокала</div></div>`;
    }
    if (ref.fundamental) {
        const refNote = freqToNote(ref.fundamental.freq);
        html += `<div class="feature-box"><div class="fb-label">Референс</div>
      <div class="fb-value" style="color:var(--orange)">${Math.round(ref.fundamental.freq)} Hz</div>
      <div class="fb-sub">Нота: ${refNote} · Уверенность: ${(ref.fundamental.confidence * 100).toFixed(0)}%</div></div>`;
    }
    html += `</div></div>`;

    // --- HARSHNESS / SIBILANCE ---
    html += `<div class="card"><h2><span class="ic">🔊</span> Яркость и сибилянты</h2>
    <div class="hint">Индекс ядовитости верхов (4–10 кГц). >65 = нужен де-эссер. <35 = тускло.</div>`;
    const mhc = mine.harshness.index > 65 ? 'var(--red)' : (mine.harshness.index > 45 ? 'var(--yellow)' : 'var(--green)');
    html += `<div class="feature-grid">
    <div class="feature-box"><div class="fb-label">Твой индекс</div>
      <div class="fb-value" style="color:${mhc}">${mine.harshness.index}</div>
      <div class="fb-sub">${mine.harshness.index > 65 ? 'Агрессивно' : mine.harshness.index > 45 ? 'Норма' : 'Тускло'}</div></div>
    <div class="feature-box"><div class="fb-label">Де-эссер на</div>
      <div class="fb-value" style="color:var(--teal)">${mine.harshness.deesserFreq} Hz</div>
      <div class="fb-sub">Центр сибилянтов</div></div>
    <div class="feature-box"><div class="fb-label">Реф: индекс</div>
      <div class="fb-value" style="color:var(--orange)">${ref.harshness.index}</div>
      <div class="fb-sub">${ref.harshness.index > 65 ? 'Агрессивно' : ref.harshness.index > 45 ? 'Норма' : 'Тускло'}</div></div>
    <div class="feature-box"><div class="fb-label">Реф: де-эссер</div>
      <div class="fb-value" style="color:var(--orange)">${ref.harshness.deesserFreq} Hz</div>
      <div class="fb-sub">Центр у рефа</div></div>
  </div>`;
    html += `<div class="advice-block" style="border-left-color:var(--red)">💡 ${comp.harshAdvice}</div></div>`;

    // --- STEREO FIELD ---
    if (mine.isStereo || ref.isStereo) {
        html += `<div class="card"><h2><span class="ic">🔄</span> Стерео и фаза</h2>
      <div class="hint">+1.0 = моно, 0 = широко, минус = фазовые проблемы (пропадёт в моно).</div>`;
        if (mine.stereo) {
            const phaseOk = mine.stereo.avgCorr > 0.3;
            const pColor = phaseOk ? 'var(--green)' : 'var(--red)';
            html += `<div class="feature-grid">
        <div class="feature-box"><div class="fb-label">Корреляция L/R</div>
          <div class="fb-value" style="color:${pColor}">${mine.stereo.avgCorr.toFixed(2)}</div>
          <div class="fb-sub">${phaseOk ? 'Моно-совместим ✅' : '⚠️ Фазовые конфликты!'}</div></div>
        <div class="feature-box"><div class="fb-label">Ширина</div>
          <div class="fb-value" style="color:var(--teal)">${(mine.stereo.width * 100).toFixed(0)}%</div>
          <div class="fb-sub">${mine.stereo.width < 0.1 ? 'Моно' : mine.stereo.width < 0.4 ? 'Узкий' : mine.stereo.width < 0.7 ? 'Средний' : 'Широкий'}</div></div>
      </div>`;
            if (mine.stereo.phaseIssuePercent > 5) {
                html += `<div class="advice-block" style="border-left-color:var(--red)">⚠️ ${mine.stereo.phaseIssuePercent.toFixed(0)}% фреймов с фазовыми конфликтами. Проверь стерео-плагины.</div>`;
            }
        } else {
            html += `<div class="advice-block" style="border-left-color:var(--green)">Моно-файл — фазовых проблем нет 👍</div>`;
        }
        html += `</div>`;
    }

    // --- BAND COMPARISON ---
    html += `<div class="card"><h2><span class="ic">🎚️</span> Частотные зоны</h2>
    <div class="hint">Громкость выровнена автоматически. Сравнивается ФОРМА спектра. Зоны Sub/Bass/Air весят меньше в скоринге — там голос не живёт.</div>`;
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
    </div><div class="badvice">${b.advice}</div>`;
    });
    html += `<div class="leg"><span><div class="dot" style="background:var(--orange)"></div> Референс</span><span><div class="dot" style="background:var(--teal)"></div> Твой вокал</span></div></div>`;

    // --- SPECTRUM ---
    html += `<div class="card"><h2><span class="ic">📈</span> Спектр</h2>
    <div class="hint">Форма голоса по частотам. Оранжевая линия выше = у тебя не хватает. Бирюзовая выше = лишнее.</div>
    <div class="chwrap chwrap-tall"><canvas id="chSpec"></canvas></div></div>`;

    // --- SMART RESONANCES ---
    html += `<div class="card"><h2><span class="ic">🔔</span> Резонансы голоса</h2>
    <div class="hint">Частоты, которые торчат выше нормы — резонансы голоса, микрофона или комнаты. Для каждого показаны зона, причина и точные настройки EQ для исправления.</div>`;
    if (mine.resonances.length > 0) {
        html += `<div style="margin-top:8px">`;
        mine.resonances.forEach(res => {
            const priColor = res.priority === 1 ? 'var(--red)' : res.priority === 2 ? 'var(--orange)' : 'var(--yellow)';
            const priLabel = res.priority === 1 ? '🔴 Критично' : res.priority === 2 ? '🟠 Заметно' : '🟡 Мелочь';
            html += `<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-left:3px solid ${priColor};border-radius:0 10px 10px 0;padding:12px 14px;margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <div>
            <span style="font-size:16px;font-weight:800;color:${priColor}">${res.freq} Hz</span>
            <span style="font-size:10px;color:var(--text-dim);margin-left:8px">+${res.excess.toFixed(1)} дБ</span>
          </div>
          <span style="font-size:9px;color:${priColor}">${priLabel}</span>
        </div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px">${res.label}</div>
        <div style="font-size:11px;color:#888;margin-bottom:6px">${res.tip}</div>
        <div style="font-size:12px;color:var(--text)">
          <strong>EQ:</strong> Частота <strong>${res.freq} Hz</strong> · Gain <strong style="color:var(--red)">-${res.cutDb} dB</strong> · Q <strong>${res.Q}</strong>
        </div>
      </div>`;
        });
        html += `</div>`;
    } else {
        html += `<div class="advice-block pri-ok">Явных резонансов нет 👍</div>`;
    }
    html += `</div>`;

    // --- ENVELOPE ---
    html += `<div class="card"><h2><span class="ic">📉</span> Огибающая</h2>
    <div class="hint">Громкость во времени. Если бирюзовая скачет сильнее — компрессоры не справляются.</div>
    <div class="chwrap"><canvas id="chEnv"></canvas></div></div>`;

    r.innerHTML = html;
    r.style.display = 'block';
    window.scrollTo({ top: r.offsetTop - 20, behavior: 'smooth' });
    buildCharts(ref, mine);
}

// ============================================================
// CHARTS
// ============================================================
function buildCharts(ref, mine) {
    const fmtFreq = f => f < 1000 ? f.toFixed(0) : (f / 1000).toFixed(1) + 'k';
    const chartFont = { family: 'Inter' };

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
                y: { ticks: { color: '#444', font: { ...chartFont, size: 10 } }, grid: { color: 'rgba(255,255,255,0.03)' }, title: { display: true, text: 'Уровень (dB, норм.)', color: '#444' } }
            }
        }
    });

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
