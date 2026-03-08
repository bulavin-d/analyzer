/* ============================================================
   BULAVIN AI ANALYZER v1.1 PRO — Analyzer Module
   Production-grade: silence strip, processing fingerprint,
   smart resonances, weighted scoring, contextual advice
   ============================================================ */

const BANDS = [
    { name: 'Sub', lo: 20, hi: 60, weight: 0.2, desc: 'Зона бита — голос тут не живёт' },
    { name: 'Bass', lo: 60, hi: 120, weight: 0.4, desc: 'Фундамент голоса, proximity effect от микрофона' },
    { name: 'Low-Mid', lo: 120, hi: 250, weight: 1.0, desc: 'Теплота и тело голоса' },
    { name: 'Mid', lo: 250, hi: 500, weight: 1.0, desc: 'Основное мясо голоса' },
    { name: 'Upper-Mid', lo: 500, hi: 1000, weight: 1.0, desc: 'Разборчивость речи' },
    { name: 'Presence', lo: 1000, hi: 3000, weight: 1.0, desc: 'Атака согласных — голос выходит вперёд' },
    { name: 'Clarity', lo: 3000, hi: 6000, weight: 0.9, desc: 'Чёткость, зона де-эссера' },
    { name: 'Brilliance', lo: 6000, hi: 10000, weight: 0.5, desc: 'Воздух и свечение верхов' },
    { name: 'Air', lo: 10000, hi: 20000, weight: 0.2, desc: 'Ультра-верх' },
];

// Resonance zone classifier
const RES_ZONES = [
    { lo: 80, hi: 200, zone: 'lowBody', label: '🎤 Proximity / Бас микрофона', tip: 'Если бубнит — подрежь. Это proximity effect от микрофона.' },
    { lo: 200, hi: 400, zone: 'box', label: '📦 Бубнение / "Коробка"', tip: 'Типичный коробочный звук. Тесная комната или плохая акустика.' },
    { lo: 400, hi: 800, zone: 'nasal', label: '👃 Назальность', tip: 'Гнусавость — обычно природа голоса. Подрезается узким EQ.' },
    { lo: 800, hi: 1500, zone: 'honk', label: '📢 Гудение / Honk', tip: 'Телефонный звук. Часто от дешёвого микры или маленькой комнаты.' },
    { lo: 1500, hi: 3000, zone: 'presence', label: '🔊 Присутствие', tip: 'Голос торчит вперёд. Если режет уши — убавь.' },
    { lo: 3000, hi: 5500, zone: 'sibilance', label: '🐍 Сибилянты / "ССС"', tip: 'Свистящие звуки. Лечится де-эссером на этой частоте.' },
    { lo: 5500, hi: 8000, zone: 'harshness', label: '⚡ Жёсткость / Harshness', tip: 'Ядовитые верхние. Слишком яркий микрофон или буст в EQ.' },
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function freqToNote(freq) {
    const midi = 12 * Math.log2(freq / 440) + 69;
    const note = NOTE_NAMES[Math.round(midi) % 12];
    const octave = Math.floor(Math.round(midi) / 12) - 1;
    return note + octave;
}

function classifyResZone(freq) {
    for (const z of RES_ZONES) {
        if (freq >= z.lo && freq < z.hi) return z;
    }
    return { zone: 'unknown', label: '🔔 Резонанс', tip: 'Неклассифицированный пик.' };
}

/* ============================================================
   PROCESSING FINGERPRINT
   Classifies a track as dry / lightly processed / heavily processed
   ============================================================ */
function fingerprint(crest, dynRange, subEnergy, airEnergy, bandEnergies) {
    // Sub energy relative to mid = reverb indicator
    const midEnergy = bandEnergies[3]; // Mid 250-500
    const subRatio = subEnergy - midEnergy; // dB difference
    const hasReverb = subRatio > -10 && crest > 16 && dynRange > 14;
    const hasSaturation = airEnergy > -45; // hot Air band = likely saturation/exciter
    const hasCompression = crest < 14 && dynRange < 10;
    const isDry = crest < 17 && dynRange < 13 && subRatio < -15;

    let level = 'dry';
    if (hasReverb) level = 'wet';
    else if (hasCompression && hasSaturation) level = 'processed';
    else if (hasCompression || hasSaturation) level = 'lightly';

    return { isDry, hasReverb, hasCompression, hasSaturation, level };
}

/* ============================================================
   ANALYZE SINGLE TRACK
   ============================================================ */
function analyzeTrack(buf) {
    const sr = buf.sampleRate;
    const rawData = getSamples(buf);

    // 1. STRIP SILENCE — only analyze real audio
    const data = stripSilence(rawData, sr);

    // 2. Basic stats on clean audio
    const peakVal = peak(data);
    const peakDb = dB(peakVal);
    const rmsVal = rms(data);
    const rmsDb = dB(rmsVal);

    // 3. Frame-based dynamics
    const frameSize = Math.floor(0.03 * sr);
    const hop = Math.floor(frameSize / 2);
    const frames = [];
    for (let i = 0; i + frameSize <= data.length; i += hop) {
        let s = 0;
        for (let j = 0; j < frameSize; j++) s += data[i + j] * data[i + j];
        frames.push(Math.sqrt(s / frameSize));
    }
    const framesDb = frames.map(f => dB(f));

    // Adaptive activity threshold (percentile-based)
    const sortedFrames = [...framesDb].sort((a, b) => a - b);
    const p20 = sortedFrames[Math.floor(sortedFrames.length * 0.2)];
    const p80 = sortedFrames[Math.floor(sortedFrames.length * 0.8)];
    let thresh = Math.max(p20 + (p80 - p20) * 0.25, -55);
    if (framesDb.filter(f => f > thresh).length < 5) thresh = -60;

    const activeFrames = frames.filter((_, i) => framesDb[i] > thresh);
    const activeRmsDb = activeFrames.length > 0 ? dB(rms(new Float32Array(activeFrames))) : rmsDb;
    const crest = peakDb - activeRmsDb;

    const activeDb = framesDb.filter(f => f > thresh);
    // Percentile-based dynamic range (P5-P95, robust to outliers)
    const sortedActive = [...activeDb].sort((a, b) => a - b);
    let dynRange = 0;
    if (sortedActive.length > 4) {
        const p5 = sortedActive[Math.floor(sortedActive.length * 0.05)];
        const p95 = sortedActive[Math.floor(sortedActive.length * 0.95)];
        dynRange = p95 - p5;
    }

    // 4. Spectrum (Welch PSD) on ACTIVE audio only
    const { freqs, psd } = welchPSD(data, sr, 4096, 0.5);
    const psdDb = Array.from(psd).map(v => dB10(v));
    const psdNorm = psdDb.map(v => v - rmsDb);

    const specFreqs = [], specDb = [];
    for (let i = 0; i < freqs.length; i += 2) {
        if (freqs[i] >= 20 && freqs[i] <= 20000) {
            specFreqs.push(freqs[i]);
            specDb.push(psdNorm[i]);
        }
    }

    // 5. Band energies
    const bands = BANDS.map(b => {
        let sum = 0, count = 0;
        for (let i = 0; i < freqs.length; i++) {
            if (freqs[i] >= b.lo && freqs[i] <= b.hi) { sum += psd[i]; count++; }
        }
        const e = count > 0 ? dB10(sum / count) - rmsDb : -80;
        return { ...b, energy: e };
    });

    // 6. SMART RESONANCES — group peaks, classify zones, calibrate EQ
    const smoothSize = 25;
    const smooth = new Float64Array(psdDb.length);
    for (let i = 0; i < psdDb.length; i++) {
        const lo = Math.max(0, i - smoothSize);
        const hi = Math.min(psdDb.length - 1, i + smoothSize);
        let s = 0;
        for (let j = lo; j <= hi; j++) s += psdDb[j];
        smooth[i] = s / (hi - lo + 1);
    }

    const rawResonances = [];
    for (let i = 3; i < psdDb.length - 3; i++) {
        if (freqs[i] < 80 || freqs[i] > 8000) continue;
        const excess = psdDb[i] - smooth[i];
        if (excess > 3.5) {
            let isPeak = true;
            for (let k = -3; k <= 3; k++) {
                if (k !== 0 && psdDb[i] < psdDb[i + k]) isPeak = false;
            }
            if (isPeak) rawResonances.push({ freq: freqs[i], excess, bin: i });
        }
    }
    rawResonances.sort((a, b) => b.excess - a.excess);

    // Group nearby resonances (within 80 Hz)
    const resonances = [];
    const used = new Set();
    for (const r of rawResonances) {
        if (used.has(r.bin)) continue;
        // Find neighbors
        let bestFreq = r.freq, bestExcess = r.excess;
        for (const other of rawResonances) {
            if (Math.abs(other.freq - r.freq) < 80 && other.excess > bestExcess) {
                bestFreq = other.freq; bestExcess = other.excess;
            }
            if (Math.abs(other.freq - r.freq) < 80) used.add(other.bin);
        }
        used.add(r.bin);

        const zone = classifyResZone(bestFreq);
        // Calibrated EQ: cut proportional to excess, Q tighter for higher excess
        const cutDb = Math.min(bestExcess * 0.35, 4.0);
        const Q = bestExcess > 8 ? 6.0 : bestExcess > 5 ? 4.0 : 2.5;
        const priority = bestExcess > 8 ? 1 : bestExcess > 5 ? 2 : 3;

        resonances.push({
            freq: Math.round(bestFreq),
            excess: bestExcess,
            zone: zone.zone,
            label: zone.label,
            tip: zone.tip,
            cutDb: +cutDb.toFixed(1),
            Q: +Q.toFixed(1),
            priority
        });
    }

    // 7. Envelope (downsampled)
    const envStep = Math.max(Math.floor(framesDb.length / 400), 1);
    const envTime = [], envDb = [];
    for (let i = 0; i < framesDb.length; i += envStep) {
        envTime.push(i * hop / sr);
        envDb.push(framesDb[i]);
    }

    // 8. Transient speed
    let transientSpeed = 0;
    if (frames.length > 10) {
        const diffs = [];
        for (let i = 1; i < frames.length; i++) diffs.push(Math.abs(frames[i] - frames[i - 1]));
        diffs.sort((a, b) => b - a);
        const top10 = diffs.slice(0, Math.floor(diffs.length * 0.1));
        transientSpeed = top10.reduce((a, b) => a + b, 0) / top10.length;
    }

    // 9. Fundamental tone (multi-chunk median)
    let fundamental = null;
    const activeIndices = [];
    for (let i = 0; i < framesDb.length; i++) {
        if (framesDb[i] > thresh) activeIndices.push(i);
    }
    if (activeIndices.length > 20) {
        const pitchResults = [];
        const nChunks = 8;
        const chunkSamples = Math.floor(sr * 0.15);
        for (let c = 0; c < nChunks; c++) {
            const idx = activeIndices[Math.floor(activeIndices.length * (c + 0.5) / nChunks)];
            const sampleStart = idx * hop;
            if (sampleStart + chunkSamples > data.length) continue;
            const chunk = data.slice(sampleStart, sampleStart + chunkSamples);
            const chunkRms = rms(chunk);
            if (dB(chunkRms) < thresh) continue;
            const result = autocorrelate(chunk, sr, 70, 500);
            if (result && result.confidence > 0.4) pitchResults.push(result);
        }
        if (pitchResults.length >= 2) {
            pitchResults.sort((a, b) => a.freq - b.freq);
            const mid = Math.floor(pitchResults.length / 2);
            const avgConf = pitchResults.reduce((s, r) => s + r.confidence, 0) / pitchResults.length;
            fundamental = { freq: pitchResults[mid].freq, confidence: avgConf };
        } else if (pitchResults.length === 1) {
            fundamental = pitchResults[0];
        }
    }

    // 10. Stereo Field
    let stereo = null;
    const channels = getStereoChannels(buf);
    if (channels) {
        stereo = stereoCorrelation(channels.L, channels.R, 4096, 2048);
    }

    // 11. Harshness/Sibilance
    const harshness = detectHarshness(data, sr, freqs, psd);

    // 12. Processing fingerprint
    const fp = fingerprint(
        crest, dynRange,
        bands[0].energy, // Sub
        bands[8].energy, // Air
        bands.map(b => b.energy)
    );

    return {
        peakDb, rmsDb, activeRmsDb, crest, dynRange, transientSpeed,
        duration: data.length / sr, rawDuration: rawData.length / sr, sr,
        specFreqs, specDb, bands,
        resonances: resonances.slice(0, 8),
        envTime, envDb,
        fundamental, stereo, harshness,
        isStereo: buf.numberOfChannels >= 2,
        fp // processing fingerprint
    };
}

/* ============================================================
   COMPARE TWO TRACKS
   ============================================================ */
function compare(ref, mine) {
    const T_OK = 4;
    const T_WARN = 7;

    // Processing context
    const procDiffers = ref.fp.level !== mine.fp.level;
    const refWet = ref.fp.hasReverb;
    const mineDry = mine.fp.isDry;

    // Band diffs with weighted scoring
    const bandDiffs = ref.bands.map((r, i) => {
        const m = mine.bands[i];
        const diff = r.energy - m.energy;
        const absDiff = Math.abs(diff);
        const isProcessingBand = (r.name === 'Sub' || r.name === 'Bass' || r.name === 'Air');

        let severity, advice;
        if (absDiff < T_OK) {
            severity = 'ok';
            advice = `${r.name} — ок (${absDiff.toFixed(1)} дБ) 👍`;
        } else if (absDiff >= 12) {
            severity = diff > 0 ? 'boost' : 'cut';
            advice = `${r.name}: ~${absDiff.toFixed(0)} дБ разницы. Это из-за обработки (реверб/сатурация), а не EQ. Не крути эквалайзер тут.`;
        } else if (isProcessingBand && procDiffers && absDiff >= T_OK) {
            severity = diff > 0 ? 'boost' : 'cut';
            advice = `${r.name}: ${absDiff.toFixed(0)} дБ разницы — вероятно из-за разной обработки. Сначала сравни на одинаковой цепочке.`;
        } else if (absDiff < T_WARN) {
            severity = diff > 0 ? 'boost' : 'cut';
            const plugin = r.lo >= 3000 ? 'де-эссер или EQ' : 'EQ';
            if (diff > 0) {
                advice = `${r.name}: не хватает ~${absDiff.toFixed(0)} дБ. ${plugin}: буст ${r.lo}–${r.hi} Гц.`;
            } else {
                advice = `${r.name}: лишних ~${absDiff.toFixed(0)} дБ. ${plugin}: подрежь ${r.lo}–${r.hi} Гц.`;
            }
        } else {
            severity = diff > 0 ? 'boost' : 'cut';
            const plugin = r.lo >= 3000 ? 'де-эссер / EQ' : 'EQ / компрессор';
            if (diff > 0) {
                advice = `⚠️ ${r.name}: серьёзно не хватает ~${absDiff.toFixed(0)} дБ. Проверь ${plugin} в зоне ${r.lo}–${r.hi} Гц.`;
            } else {
                advice = `⚠️ ${r.name}: перебор ~${absDiff.toFixed(0)} дБ. Проверь буст в ${plugin} на ${r.lo}–${r.hi} Гц.`;
            }
        }
        return { ...r, refE: r.energy, mineE: m.energy, diff, severity, advice };
    });

    // Dynamics (context-aware)
    const crestDiff = mine.crest - ref.crest;
    const dynDiff = mine.dynRange - ref.dynRange;

    let compAdvice;
    if (crestDiff < -6 && refWet && mineDry) {
        compAdvice = `Crest фактор ниже на ${Math.abs(crestDiff).toFixed(1)} дБ — это реверб/эффекты на рефе раздувают пики. Твой сухой вокал в порядке. 👍`;
    } else if (crestDiff > 6 && mine.fp.hasReverb && ref.fp.isDry) {
        compAdvice = `Crest выше на ${crestDiff.toFixed(1)} дБ — у тебя реверб/дилей, это нормально.`;
    } else if (crestDiff > 6) {
        compAdvice = `Пики острее рефа на ${crestDiff.toFixed(1)} дБ. Компрессор: ускорь attack или опусти threshold.`;
    } else if (crestDiff < -6) {
        compAdvice = `Пережат на ${Math.abs(crestDiff).toFixed(1)} дБ. Компрессор: замедли attack или подними threshold.`;
    } else {
        compAdvice = `Компрессия ок — разница ${Math.abs(crestDiff).toFixed(1)} дБ 👍`;
    }

    let dynAdvice;
    if (dynDiff < -6 && refWet && mineDry) {
        dynAdvice = `Динамика рефа шире на ${Math.abs(dynDiff).toFixed(1)} дБ — реверб создаёт тихие хвосты. Это нормально для сухого вокала. 👍`;
    } else if (dynDiff > 6) {
        dynAdvice = `Динамика шире рефа на ${dynDiff.toFixed(1)} дБ. Добавь компрессии — голос будет ровнее.`;
    } else if (dynDiff < -6) {
        dynAdvice = `Динамика уже рефа на ${Math.abs(dynDiff).toFixed(1)} дБ. Возможно перекомпрессия.`;
    } else {
        dynAdvice = `Динамический диапазон ок — разница ${Math.abs(dynDiff).toFixed(1)} дБ 👍`;
    }

    // WEIGHTED SCORE — vocal bands matter more
    let totalDeviation = 0, maxDeviation = 0;
    bandDiffs.forEach(b => {
        const w = b.weight || 1;
        const excess = Math.max(0, Math.abs(b.diff) - 3);
        totalDeviation += excess * excess * w;
        maxDeviation += 144 * w; // max 12^2 * weight
    });
    totalDeviation += Math.max(0, Math.abs(crestDiff) - 4) ** 2 * 0.4;
    totalDeviation += Math.max(0, Math.abs(dynDiff) - 4) ** 2 * 0.2;
    maxDeviation += 64 + 32;

    const rawScore = 1 - Math.sqrt(totalDeviation / maxDeviation);
    const score = Math.max(0, Math.min(100, Math.round(rawScore * 100)));

    // PRIORITIES — skip Sub/Bass/Air when processing differs
    const pris = [];
    const sorted = [...bandDiffs].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    sorted.forEach(b => {
        if (pris.length >= 3) return;
        if (Math.abs(b.diff) < T_OK) return;
        // Skip processing-dependent bands from priorities if processing levels differ
        if (procDiffers && (b.name === 'Sub' || b.name === 'Bass' || b.name === 'Air') && Math.abs(b.diff) < 12) return;
        pris.push(b.advice);
    });
    if (Math.abs(crestDiff) > 6 && !(refWet && mineDry)) pris.push(compAdvice);

    // Harshness comparison
    let harshAdvice = '';
    const hDiff = mine.harshness.index - ref.harshness.index;
    if (hDiff > 15) {
        harshAdvice = `Вокал ярче/жёстче рефа (${mine.harshness.index} vs ${ref.harshness.index}). Проверь де-эссер и бусты 4–10 кГц.`;
    } else if (hDiff < -15) {
        harshAdvice = `Вокал тусклее рефа (${mine.harshness.index} vs ${ref.harshness.index}). Возможно слишком агрессивный де-эссер.`;
    } else {
        harshAdvice = `Яркость верхов на уровне рефа 👍`;
    }

    // Duration mismatch warning
    let durationWarning = null;
    const durRatio = ref.rawDuration / Math.max(mine.rawDuration, 0.1);
    if (durRatio > 2.5 || durRatio < 0.4) {
        durationWarning = `Длительности файлов отличаются значительно (реф: ${ref.rawDuration.toFixed(0)}с, твой: ${mine.rawDuration.toFixed(0)}с). Анализ работает, но для лучшей точности используй похожие по длине фрагменты.`;
    }

    return { bandDiffs, compAdvice, dynAdvice, score, priorities: pris.slice(0, 4), harshAdvice, durationWarning, procDiffers };
}
