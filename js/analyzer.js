/* ============================================================
   BULAVIN AI ANALYZER — Analyzer Module
   Track analysis, comparison, scoring
   ============================================================ */

const BANDS = [
    { name: 'Sub', lo: 20, hi: 60, desc: 'Зона бита — голос тут не живёт' },
    { name: 'Bass', lo: 60, hi: 120, desc: 'Фундамент голоса, "proximity effect" от микрофона' },
    { name: 'Low-Mid', lo: 120, hi: 250, desc: 'Теплота и тело — то, что делает голос "объёмным"' },
    { name: 'Mid', lo: 250, hi: 500, desc: 'Основное мясо голоса — главная энергия' },
    { name: 'Upper-Mid', lo: 500, hi: 1000, desc: 'Разборчивость — слышно ли каждый слог' },
    { name: 'Presence', lo: 1000, hi: 3000, desc: 'Атака согласных — голос "выходит вперёд" в миксе' },
    { name: 'Clarity', lo: 3000, hi: 6000, desc: 'Чёткость и "ссс" звуки — зона де-эссера' },
    { name: 'Brilliance', lo: 6000, hi: 10000, desc: 'Натуральный воздух и свечение верхов' },
    { name: 'Air', lo: 10000, hi: 20000, desc: 'Ультра-верх — "шёлковый" блеск' },
];

// Note names for fundamental tone display
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function freqToNote(freq) {
    const midi = 12 * Math.log2(freq / 440) + 69;
    const note = NOTE_NAMES[Math.round(midi) % 12];
    const octave = Math.floor(Math.round(midi) / 12) - 1;
    return note + octave;
}

/* ============================================================
   ANALYZE SINGLE TRACK
   ============================================================ */
function analyzeTrack(buf) {
    const sr = buf.sampleRate;
    const data = getSamples(buf);

    // 1. Basic stats
    const peakVal = peak(data);
    const peakDb = dB(peakVal);
    const rmsVal = rms(data);
    const rmsDb = dB(rmsVal);

    // 2. Frame-based dynamics
    const frameSize = Math.floor(0.03 * sr);
    const hop = Math.floor(frameSize / 2);
    const frames = [];
    for (let i = 0; i + frameSize <= data.length; i += hop) {
        let s = 0;
        for (let j = 0; j < frameSize; j++) s += data[i + j] * data[i + j];
        frames.push(Math.sqrt(s / frameSize));
    }
    const framesDb = frames.map(f => dB(f));

    // Active speech detection (adaptive threshold)
    let thresh = -40;
    if (framesDb.filter(f => f > thresh).length < 10) thresh = -50;
    if (framesDb.filter(f => f > thresh).length < 10) thresh = -60;

    const activeFrames = frames.filter((_, i) => framesDb[i] > thresh);
    const activeRmsDb = dB(rms(new Float32Array(activeFrames)));
    const crest = peakDb - activeRmsDb;

    const activeDb = framesDb.filter(f => f > thresh);
    let dynMax = -999, dynMin = 999;
    for (let i = 0; i < activeDb.length; i++) {
        if (activeDb[i] > dynMax) dynMax = activeDb[i];
        if (activeDb[i] < dynMin) dynMin = activeDb[i];
    }
    const dynRange = activeDb.length > 2 ? dynMax - dynMin : 0;

    // 3. Spectrum (Welch PSD)
    const { freqs, psd } = welchPSD(data, sr, 4096, 0.5);
    const psdDb = Array.from(psd).map(v => dB10(v));
    const psdNorm = psdDb.map(v => v - rmsDb);

    // Downsample for charts
    const specFreqs = [], specDb = [];
    for (let i = 0; i < freqs.length; i += 2) {
        if (freqs[i] >= 20 && freqs[i] <= 20000) {
            specFreqs.push(freqs[i]);
            specDb.push(psdNorm[i]);
        }
    }

    // 4. Band energies
    const bands = BANDS.map(b => {
        let sum = 0, count = 0;
        for (let i = 0; i < freqs.length; i++) {
            if (freqs[i] >= b.lo && freqs[i] <= b.hi) { sum += psd[i]; count++; }
        }
        const e = count > 0 ? dB10(sum / count) - rmsDb : -80;
        return { ...b, energy: e };
    });

    // 5. Resonances
    const smoothSize = 30;
    const smooth = new Float64Array(psdDb.length);
    for (let i = 0; i < psdDb.length; i++) {
        const lo = Math.max(0, i - smoothSize);
        const hi = Math.min(psdDb.length - 1, i + smoothSize);
        let s = 0;
        for (let j = lo; j <= hi; j++) s += psdDb[j];
        smooth[i] = s / (hi - lo + 1);
    }
    const resonances = [];
    for (let i = 3; i < psdDb.length - 3; i++) {
        if (freqs[i] < 80 || freqs[i] > 8000) continue;
        const excess = psdDb[i] - smooth[i];
        if (excess > 4.0) {
            let isPeak = true;
            for (let k = -3; k <= 3; k++) {
                if (k !== 0 && psdDb[i] < psdDb[i + k]) isPeak = false;
            }
            if (isPeak) resonances.push({ freq: freqs[i], excess });
        }
    }
    resonances.sort((a, b) => b.excess - a.excess);

    // 6. Envelope (downsampled for chart)
    const envStep = Math.max(Math.floor(framesDb.length / 400), 1);
    const envTime = [], envDb = [];
    for (let i = 0; i < framesDb.length; i += envStep) {
        envTime.push(i * hop / sr);
        envDb.push(framesDb[i]);
    }

    // 7. Transient speed (frame-based, fast)
    let transientSpeed = 0;
    if (frames.length > 10) {
        const diffs = [];
        for (let i = 1; i < frames.length; i++) diffs.push(Math.abs(frames[i] - frames[i - 1]));
        diffs.sort((a, b) => b - a);
        const top10 = diffs.slice(0, Math.floor(diffs.length * 0.1));
        transientSpeed = top10.reduce((a, b) => a + b, 0) / top10.length;
    }

    // 8. NEW: Fundamental tone detection
    // Multi-chunk: sample 8 spots across the active audio, take median
    let fundamental = null;
    const activeIndices = [];
    for (let i = 0; i < framesDb.length; i++) {
        if (framesDb[i] > thresh) activeIndices.push(i);
    }
    if (activeIndices.length > 20) {
        const pitchResults = [];
        const nChunks = 8;
        const chunkSamples = Math.floor(sr * 0.15); // 150ms chunks
        for (let c = 0; c < nChunks; c++) {
            const idx = activeIndices[Math.floor(activeIndices.length * (c + 0.5) / nChunks)];
            const sampleStart = idx * hop;
            if (sampleStart + chunkSamples > data.length) continue;
            const chunk = data.slice(sampleStart, sampleStart + chunkSamples);
            // Check chunk has enough energy
            const chunkRms = rms(chunk);
            if (dB(chunkRms) < thresh) continue;
            const result = autocorrelate(chunk, sr, 70, 500);
            if (result && result.confidence > 0.4) pitchResults.push(result);
        }
        if (pitchResults.length >= 2) {
            // Take median frequency
            pitchResults.sort((a, b) => a.freq - b.freq);
            const mid = Math.floor(pitchResults.length / 2);
            const medianResult = pitchResults[mid];
            // Average confidence from all results
            const avgConf = pitchResults.reduce((s, r) => s + r.confidence, 0) / pitchResults.length;
            fundamental = { freq: medianResult.freq, confidence: avgConf, lag: medianResult.lag };
        } else if (pitchResults.length === 1) {
            fundamental = pitchResults[0];
        }
    }

    // 9. NEW: Stereo Field
    let stereo = null;
    const channels = getStereoChannels(buf);
    if (channels) {
        stereo = stereoCorrelation(channels.L, channels.R, 4096, 2048);
    }

    // 10. NEW: Harshness/Sibilance
    const harshness = detectHarshness(data, sr, freqs, psd);

    return {
        peakDb, rmsDb, activeRmsDb, crest, dynRange, transientSpeed,
        duration: data.length / sr, sr,
        specFreqs, specDb, bands,
        resonances: resonances.slice(0, 8),
        envTime, envDb,
        fundamental, stereo, harshness,
        isStereo: buf.numberOfChannels >= 2
    };
}

/* ============================================================
   COMPARE TWO TRACKS
   ============================================================ */
function compare(ref, mine) {
    const T_OK = 4;
    const T_WARN = 7;

    // Band diffs
    const bandDiffs = ref.bands.map((r, i) => {
        const m = mine.bands[i];
        const diff = r.energy - m.energy;
        const absDiff = Math.abs(diff);

        let severity, advice;
        if (absDiff < T_OK) {
            severity = 'ok';
            advice = `${r.name} — в пределах нормы (${absDiff.toFixed(1)} дБ разницы) 👍`;
        } else if (absDiff < T_WARN) {
            severity = diff > 0 ? 'boost' : 'cut';
            if (diff > 0) {
                advice = `${r.name}: тебе не хватает ~${absDiff.toFixed(0)} дБ. Попробуй буст в зоне ${r.lo}–${r.hi} Гц на эквалайзере.`;
            } else {
                advice = `${r.name}: у тебя на ~${absDiff.toFixed(0)} дБ лишнего. Убери буст или подрежь ${r.lo}–${r.hi} Гц эквалайзером.`;
            }
        } else {
            severity = diff > 0 ? 'boost' : 'cut';
            if (diff > 0) {
                advice = `⚠️ ${r.name}: серьёзная нехватка ~${absDiff.toFixed(0)} дБ. Скорее всего что-то в цепочке жёстко режет зону ${r.lo}–${r.hi} Гц.`;
            } else {
                advice = `⚠️ ${r.name}: перебор ~${absDiff.toFixed(0)} дБ. Ищи что бустит зону ${r.lo}–${r.hi} Гц и прикручивай.`;
            }
        }
        return { ...r, refE: r.energy, mineE: m.energy, diff, severity, advice };
    });

    // Dynamics (threshold 6 dB — natural take-to-take variation is 3-5 dB)
    const crestDiff = mine.crest - ref.crest;
    let compAdvice;
    if (crestDiff > 6)
        compAdvice = `Твои пики на ${crestDiff.toFixed(1)} дБ острее, чем на рефе. Компрессоры пропускают удары — сделай attack быстрее или опусти threshold.`;
    else if (crestDiff < -6)
        compAdvice = `Ты пережат на ${Math.abs(crestDiff).toFixed(1)} дБ — голос может звучать "плоско". Подними threshold или замедли attack.`;
    else
        compAdvice = `Компрессия в норме — разница с рефом всего ${Math.abs(crestDiff).toFixed(1)} дБ 👍`;

    const dynDiff = mine.dynRange - ref.dynRange;
    let dynAdvice;
    if (dynDiff > 4)
        dynAdvice = `Динамика шире рефа на ${dynDiff.toFixed(1)} дБ — голос может "гулять" по громкости. Добавь компрессии.`;
    else if (dynDiff < -4)
        dynAdvice = `Динамика уже рефа на ${Math.abs(dynDiff).toFixed(1)} дБ — голос может быть чуть "зажатым".`;
    else
        dynAdvice = `Динамический диапазон ок — разница ${Math.abs(dynDiff).toFixed(1)} дБ 👍`;

    // Score (exponential, calibrated)
    let totalDeviation = 0;
    bandDiffs.forEach(b => {
        const excess = Math.max(0, Math.abs(b.diff) - 3);
        totalDeviation += excess * excess;
    });
    totalDeviation += Math.max(0, Math.abs(crestDiff) - 3) ** 2 * 0.5;
    totalDeviation += Math.max(0, Math.abs(dynDiff) - 3) ** 2 * 0.3;

    const maxDev = 9 * 144 + 72 + 43;
    const rawScore = 1 - Math.sqrt(totalDeviation / maxDev);
    const score = Math.max(0, Math.min(100, Math.round(rawScore * 100)));

    // Priorities
    const pris = [];
    const sorted = [...bandDiffs].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    sorted.forEach(b => { if (Math.abs(b.diff) >= T_OK && pris.length < 3) pris.push(b.advice); });
    if (Math.abs(crestDiff) > 6) pris.push(compAdvice);

    // Harshness comparison
    let harshAdvice = '';
    const hDiff = mine.harshness.index - ref.harshness.index;
    if (hDiff > 15) {
        harshAdvice = `Твой вокал ощутимо ярче/жёстче рефа (индекс ${mine.harshness.index} vs ${ref.harshness.index}). Проверь де-эссер и бусты в зоне 4–10 кГц.`;
    } else if (hDiff < -15) {
        harshAdvice = `Твой вокал ощутимо тусклее рефа в верхах (индекс ${mine.harshness.index} vs ${ref.harshness.index}). Возможно слишком агрессивный де-эссер.`;
    } else {
        harshAdvice = `Яркость верхов примерно на уровне рефа 👍`;
    }

    return { bandDiffs, compAdvice, dynAdvice, score, priorities: pris.slice(0, 4), harshAdvice };
}
