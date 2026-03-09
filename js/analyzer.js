/* ============================================================
   BULAVIN AI ANALYZER v2.0 — Analyzer Module
   Track analysis, comparison, scoring — production-grade
   ============================================================ */

const BANDS = [
    { name: 'Sub', lo: 20, hi: 60, weight: 0.2, desc: 'Зона бита — голос тут не живёт' },
    { name: 'Bass', lo: 60, hi: 120, weight: 0.4, desc: 'Proximity effect от микрофона' },
    { name: 'Low-Mid', lo: 120, hi: 250, weight: 1.0, desc: 'Теплота и тело голоса' },
    { name: 'Mid', lo: 250, hi: 500, weight: 1.0, desc: 'Основное мясо голоса' },
    { name: 'Upper-Mid', lo: 500, hi: 1000, weight: 1.0, desc: 'Разборчивость речи' },
    { name: 'Presence', lo: 1000, hi: 3000, weight: 1.0, desc: 'Атака согласных' },
    { name: 'Clarity', lo: 3000, hi: 6000, weight: 0.9, desc: 'Зона де-эссера' },
    { name: 'Brilliance', lo: 6000, hi: 10000, weight: 0.5, desc: 'Воздух верхов' },
    { name: 'Air', lo: 10000, hi: 20000, weight: 0.2, desc: 'Ультра-верх' },
];

const SCORE_BANDS = ['Low-Mid', 'Mid', 'Upper-Mid', 'Presence', 'Clarity'];

const RES_ZONES = [
    { lo: 80, hi: 200, zone: 'lowBody', label: '🎤 Proximity / Бас микро', tip: 'Proximity effect. Подрезай если бубнит.' },
    { lo: 200, hi: 400, zone: 'box', label: '📦 Бубнение / Коробка', tip: 'Коробочный звук от комнаты.' },
    { lo: 400, hi: 800, zone: 'nasal', label: '👃 Назальность', tip: 'Гнусавость голоса — подрезается узким EQ.' },
    { lo: 800, hi: 1500, zone: 'honk', label: '📢 Гудение', tip: 'Телефонный звук. Дешёвый микр или комната.' },
    { lo: 1500, hi: 3000, zone: 'presence', label: '🔊 Присутствие', tip: 'Голос торчит вперёд. Убавь если режет.' },
    { lo: 3000, hi: 5500, zone: 'sibilance', label: '🐍 Сибилянты', tip: 'Свистящие ССС. Лечится де-эссером.' },
    { lo: 5500, hi: 8000, zone: 'harshness', label: '⚡ Жёсткость', tip: 'Ядовитые верхние. Яркий микр или буст EQ.' },
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function freqToNote(freq) {
    const midi = 12 * Math.log2(freq / 440) + 69;
    const note = NOTE_NAMES[Math.round(midi) % 12];
    const octave = Math.floor(Math.round(midi) / 12) - 1;
    return note + octave;
}

function classifyResZone(freq) {
    for (const z of RES_ZONES) { if (freq >= z.lo && freq < z.hi) return z; }
    return { zone: 'unknown', label: '🔔 Резонанс', tip: '' };
}

/* ============================================================
   PROCESSING FINGERPRINT (v2.1: pause-based reverb detection)
   ============================================================ */
function fingerprint(crest, dynRange, bandEnergies, data, sr) {
    // REVERB DETECTION via pause analysis
    // Reverb = energy remains > -48 dBFS in pauses between phrases
    // Dry/compressed vocal = pauses are truly silent (< -55 dBFS)

    const frameSize = Math.floor(0.02 * sr); // 20ms frames
    const frameRmsDb = [];
    for (let i = 0; i + frameSize <= data.length; i += frameSize) {
        let s = 0;
        for (let j = 0; j < frameSize; j++) s += data[i + j] ** 2;
        frameRmsDb.push(10 * Math.log10(Math.max(s / frameSize, 1e-20)));
    }

    // Find real pauses: silence > 80ms in a row
    const minPauseFrames = Math.ceil(0.08 * sr / frameSize);
    const VOICE_THRESH = -38;
    const REVERB_THRESH = -48;

    let pauseEnergies = [];
    let silenceRun = 0;
    let silenceBuf = [];

    for (let i = 0; i < frameRmsDb.length; i++) {
        if (frameRmsDb[i] < VOICE_THRESH) {
            silenceRun++;
            silenceBuf.push(frameRmsDb[i]);
            if (silenceRun >= minPauseFrames) {
                pauseEnergies.push(...silenceBuf);
                silenceBuf = [];
            }
        } else {
            silenceRun = 0;
            silenceBuf = [];
        }
    }

    let hasReverb = false;
    let reverbAmount = 0;

    if (pauseEnergies.length > 10) {
        pauseEnergies.sort((a, b) => b - a);
        const top = pauseEnergies.slice(0, Math.ceil(pauseEnergies.length * 0.3));
        const avgPauseDb = top.reduce((a, b) => a + b, 0) / top.length;
        hasReverb = avgPauseDb > REVERB_THRESH;
        reverbAmount = hasReverb ? Math.min(1, (avgPauseDb - REVERB_THRESH) / 12) : 0;
    }
    else if (frameRmsDb.length > 50) {
        hasReverb = crest > 20 && dynRange > 18;
        reverbAmount = hasReverb ? 0.3 : 0;
    }

    const hasCompression = crest < 13 && dynRange < 9;
    const airPresenceRatio = bandEnergies[8] - bandEnergies[5];
    const hasSaturation = airPresenceRatio > -20;

    let level = 'dry';
    if (hasReverb) level = 'wet';
    else if (hasCompression && hasSaturation) level = 'processed';
    else if (hasCompression || hasSaturation) level = 'lightly';

    return { isDry: level === 'dry', hasReverb, reverbAmount, hasCompression, hasSaturation, level };
}

/* ============================================================
   ANALYZE SINGLE TRACK
   ============================================================ */
function analyzeTrack(buf) {
    const sr = buf.sampleRate;
    const rawData = getSamples(buf);
    const data = stripSilence(rawData, sr);

    // Basic stats
    const peakVal = peak(data);
    const peakDb = dB(peakVal);
    const rmsVal = rms(data);
    const rmsDb = dB(rmsVal);
    // FIX 1.1: power-domain RMS for PSD normalization
    const rmsPowerDb = 10 * Math.log10(Math.max(rmsVal * rmsVal, 1e-20));

    // Frame-based dynamics
    const frameSize = Math.floor(0.03 * sr);
    const hop = Math.floor(frameSize / 2);
    const frames = [];
    for (let i = 0; i + frameSize <= data.length; i += hop) {
        let s = 0;
        for (let j = 0; j < frameSize; j++) s += data[i + j] * data[i + j];
        frames.push(Math.sqrt(s / frameSize));
    }
    const framesDb = frames.map(f => dB(f));

    // Adaptive threshold (percentile-based)
    const sortedFrames = [...framesDb].sort((a, b) => a - b);
    const p20 = sortedFrames[Math.floor(sortedFrames.length * 0.2)];
    const p80 = sortedFrames[Math.floor(sortedFrames.length * 0.8)];
    let thresh = Math.max(p20 + (p80 - p20) * 0.25, -55);
    if (framesDb.filter(f => f > thresh).length < 5) thresh = -60;

    const activeFrames = frames.filter((_, i) => framesDb[i] > thresh);
    const activeRmsDb = activeFrames.length > 0 ? dB(rms(new Float32Array(activeFrames))) : rmsDb;
    const crest = peakDb - activeRmsDb;

    // Percentile dynamic range (P5-P95)
    const activeDb = framesDb.filter(f => f > thresh);
    const sortedActive = [...activeDb].sort((a, b) => a - b);
    let dynRange = 0;
    if (sortedActive.length > 4) {
        dynRange = sortedActive[Math.floor(sortedActive.length * 0.95)] - sortedActive[Math.floor(sortedActive.length * 0.05)];
    }

    // Welch PSD
    const { freqs, psd, nfft } = welchPSD(data, sr, 4096, 0.5);
    const psdDb = Array.from(psd).map(v => dB10(v));
    const psdNorm = psdDb.map(v => v - rmsPowerDb); // FIX 1.1

    // Cepstral spectral envelope
    const envelope = spectralEnvelope(psd, sr, nfft, 4);
    const envelopeDb = Array.from(envelope).map(v => dB10(v));
    const envMeanDb = envelopeDb.reduce((a, b) => a + b, 0) / envelopeDb.length;
    const envelopeNorm = envelopeDb.map(v => v - envMeanDb);

    // Downsample for charts
    const specFreqs = [], specDb = [];
    for (let i = 0; i < freqs.length; i += 2) {
        if (freqs[i] >= 20 && freqs[i] <= 20000) {
            specFreqs.push(freqs[i]); specDb.push(psdNorm[i]);
        }
    }

    // Band energies (FIX 1.1: use rmsPowerDb)
    const bands = BANDS.map(b => {
        let sum = 0, count = 0;
        for (let i = 0; i < freqs.length; i++) {
            if (freqs[i] >= b.lo && freqs[i] <= b.hi) { sum += psd[i]; count++; }
        }
        const e = count > 0 ? dB10(sum / count) - rmsPowerDb : -80;
        return { ...b, energy: e };
    });

    // Smart resonances (FIX 1.7: logarithmic smoothing)
    const binBw = sr / nfft;
    const smooth = new Float64Array(psdDb.length);
    for (let i = 0; i < psdDb.length; i++) {
        const centerFreq = freqs[i] || 20;
        const halfBw = centerFreq * 0.2;
        const halfBins = Math.max(2, Math.round(halfBw / binBw));
        const lo = Math.max(0, i - halfBins);
        const hi = Math.min(psdDb.length - 1, i + halfBins);
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

    // Group nearby (FIX 1.5: calibrated EQ cuts)
    const resonances = [];
    const used = new Set();
    for (const r of rawResonances) {
        if (used.has(r.bin)) continue;
        let bestFreq = r.freq, bestExcess = r.excess;
        for (const other of rawResonances) {
            if (Math.abs(other.freq - r.freq) < 80) {
                if (other.excess > bestExcess) { bestFreq = other.freq; bestExcess = other.excess; }
                used.add(other.bin);
            }
        }
        used.add(r.bin);
        const zone = classifyResZone(bestFreq);
        const cutDb = bestExcess > 10 ? Math.min(bestExcess * 0.55, 9.0)
            : bestExcess > 5 ? Math.min(bestExcess * 0.45, 6.0)
                : Math.min(bestExcess * 0.4, 4.0);
        const Q = bestExcess > 8 ? 5.0 : bestExcess > 5 ? 3.5 : 2.0;
        const priority = bestExcess > 8 ? 1 : bestExcess > 5 ? 2 : 3;

        resonances.push({
            freq: Math.round(bestFreq), excess: bestExcess,
            zone: zone.zone, label: zone.label, tip: zone.tip,
            cutDb: +cutDb.toFixed(1), Q: +Q.toFixed(1), priority
        });
    }

    // Envelope chart
    const envStep = Math.max(Math.floor(framesDb.length / 400), 1);
    const envTime = [], envDbArr = [];
    for (let i = 0; i < framesDb.length; i += envStep) {
        envTime.push(i * hop / sr); envDbArr.push(framesDb[i]);
    }

    // Transient speed
    let transientSpeed = 0;
    if (frames.length > 10) {
        const diffs = [];
        for (let i = 1; i < frames.length; i++) diffs.push(Math.abs(frames[i] - frames[i - 1]));
        diffs.sort((a, b) => b - a);
        const top10 = diffs.slice(0, Math.floor(diffs.length * 0.1));
        transientSpeed = top10.reduce((a, b) => a + b, 0) / top10.length;
    }

    // Fundamental tone (multi-chunk median)
    let fundamental = null;
    const activeIndices = [];
    for (let i = 0; i < framesDb.length; i++) { if (framesDb[i] > thresh) activeIndices.push(i); }
    if (activeIndices.length > 20) {
        const pitchResults = [];
        for (let c = 0; c < 8; c++) {
            const idx = activeIndices[Math.floor(activeIndices.length * (c + 0.5) / 8)];
            const sampleStart = idx * hop;
            const chunkSamples = Math.floor(sr * 0.15);
            if (sampleStart + chunkSamples > data.length) continue;
            const chunk = data.slice(sampleStart, sampleStart + chunkSamples);
            if (dB(rms(chunk)) < thresh) continue;
            const result = autocorrelate(chunk, sr, 70, 500);
            if (result && result.confidence > 0.4) pitchResults.push(result);
        }
        if (pitchResults.length >= 2) {
            pitchResults.sort((a, b) => a.freq - b.freq);
            const avgConf = pitchResults.reduce((s, r) => s + r.confidence, 0) / pitchResults.length;
            fundamental = { freq: pitchResults[Math.floor(pitchResults.length / 2)].freq, confidence: avgConf };
        } else if (pitchResults.length === 1) fundamental = pitchResults[0];
    }

    // Stereo
    let stereo = null;
    const channels = getStereoChannels(buf);
    if (channels) stereo = stereoCorrelation(channels.L, channels.R, 4096, 2048);

    // Harshness
    const harshness = detectHarshness(data, sr, freqs, psd);

    // NEW v2.0 metrics
    const fp = fingerprint(crest, dynRange, bands.map(b => b.energy), data, sr);
    const lufs = measureLUFS(data, sr);
    const transients = analyzeTransients(data, sr);
    const pitchData = pitchTrack(data, sr);
    const tilt = spectralTilt(freqs, psdDb);
    const noise = noiseFloor(data, sr);
    const clipping = detectClipping(data);

    return {
        peakDb, rmsDb, activeRmsDb, crest, dynRange, transientSpeed,
        duration: data.length / sr, rawDuration: rawData.length / sr, sr,
        specFreqs, specDb, envelopeNorm, freqs,
        bands, resonances: resonances.slice(0, 8),
        envTime, envDb: envDbArr,
        fundamental, stereo, harshness,
        isStereo: buf.numberOfChannels >= 2,
        fp, lufs, transients, pitchData, tilt, noise, clipping
    };
}

/* ============================================================
   COMPARE TWO TRACKS
   ============================================================ */
function compare(ref, mine) {
    const T_OK = 4, T_WARN = 7;
    const procDiffers = ref.fp.level !== mine.fp.level;
    const refWet = ref.fp.hasReverb, mineDry = mine.fp.isDry;

    // Band comparison
    const bandDiffs = ref.bands.map((r, i) => {
        const m = mine.bands[i];
        const diff = r.energy - m.energy;
        const absDiff = Math.abs(diff);
        const isProcBand = (r.name === 'Sub' || r.name === 'Bass' || r.name === 'Air');

        let severity, advice;
        if (absDiff < T_OK) {
            severity = 'ok';
            advice = `${r.name} — ок (${absDiff.toFixed(1)} дБ) ✅`;
        } else if (absDiff >= 12) {
            severity = diff > 0 ? 'boost' : 'cut';
            advice = `${r.name}: ~${absDiff.toFixed(0)} дБ — разная обработка, не крути EQ тут.`;
        } else if (isProcBand && procDiffers && absDiff >= T_OK) {
            severity = diff > 0 ? 'boost' : 'cut';
            advice = `${r.name}: ${absDiff.toFixed(0)} дБ — вероятно из-за разной обработки.`;
        } else if (absDiff < T_WARN) {
            severity = diff > 0 ? 'boost' : 'cut';
            const plugin = r.lo >= 3000 ? 'EQ / де-эссер' : 'EQ';
            advice = diff > 0
                ? `${r.name}: не хватает ~${absDiff.toFixed(0)} дБ. ${plugin}: буст ${r.lo}–${r.hi} Гц.`
                : `${r.name}: лишних ~${absDiff.toFixed(0)} дБ. ${plugin}: подрежь ${r.lo}–${r.hi} Гц.`;
        } else {
            severity = diff > 0 ? 'boost' : 'cut';
            const plugin = r.lo >= 3000 ? 'EQ / де-эссер' : 'EQ / компрессор';
            advice = diff > 0
                ? `⚠️ ${r.name}: не хватает ~${absDiff.toFixed(0)} дБ. Проверь ${plugin} на ${r.lo}–${r.hi} Гц.`
                : `⚠️ ${r.name}: перебор ~${absDiff.toFixed(0)} дБ. Проверь ${plugin} на ${r.lo}–${r.hi} Гц.`;
        }
        return { ...r, refE: r.energy, mineE: m.energy, diff, severity, advice };
    });

    // Dynamics
    const crestDiff = mine.crest - ref.crest;
    const dynDiff = mine.dynRange - ref.dynRange;

    // --- ACTIONABLE COMPRESSION ADVICE ---
    let compAdvice, compAction;
    const atkMs = mine.transients ? mine.transients.compAttackMs : (mine.crest > 18 ? '3–5' : '8–15');
    const relMs = mine.transients ? mine.transients.compReleaseMs : (mine.crest > 18 ? '40–60' : '80–120');
    const ratioTxt = mine.crest > 18 ? '4:1' : mine.crest > 14 ? '3:1' : '2:1';

    if (crestDiff < -6 && refWet && mineDry) {
        compAdvice = `Реверб на рефе раздувает пики — твой сухой вокал звучит плотнее. Так и должно быть.`;
        compAction = null;
    } else if (crestDiff > 6 && mine.fp.hasReverb && ref.fp.isDry) {
        compAdvice = `У тебя реверб раздувает пики — с компрессией всё ок.`;
        compAction = null;
    } else if (crestDiff > 6) {
        compAdvice = `Вокал слишком дёрганый — пики на ${crestDiff.toFixed(1)} дБ острее рефа.`;
        compAction = `Вешай быстрый компрессор. Attack: ${atkMs} мс, Release: ${relMs} мс, Ratio: ${ratioTxt}. Жми до −4 дБ Gain Reduction.`;
    } else if (crestDiff < -6) {
        compAdvice = `Вокал пережат на ${Math.abs(crestDiff).toFixed(1)} дБ.`;
        compAction = `Расслабь компрессор: сделай атаку медленнее (>15 мс), подними threshold на 3–4 дБ.`;
    } else {
        compAdvice = `Компрессия в порядке — разница ${Math.abs(crestDiff).toFixed(1)} дБ ✓`;
        compAction = null;
    }

    let dynAdvice;
    if (dynDiff < -6 && refWet && mineDry)
        dynAdvice = `Динамика рефа шире из-за хвостов реверба. Для сухого вокала — нормально.`;
    else if (dynDiff > 6)
        dynAdvice = `Динамика шире рефа на ${dynDiff.toFixed(1)} дБ — добавь компрессии или автоматизацию громкости.`;
    else if (dynDiff < -6)
        dynAdvice = `Перекомпрессия — динамика уже на ${Math.abs(dynDiff).toFixed(1)} дБ. Ослабь ratio или подними threshold.`;
    else
        dynAdvice = `Динамический диапазон ок ✓`;

    // FIX 1.4: Score — only vocal bands, capped excess, skip dynamics if ref wet
    let totalDeviation = 0, maxDeviation = 0;
    bandDiffs.forEach(b => {
        if (!SCORE_BANDS.includes(b.name)) return;
        const w = b.weight || 1;
        const excess = Math.max(0, Math.abs(b.diff) - 3);
        const capped = Math.min(excess, 12);
        totalDeviation += capped * capped * w;
        maxDeviation += 144 * w;
    });
    if (!ref.fp.hasReverb) {
        totalDeviation += Math.max(0, Math.abs(crestDiff) - 4) ** 2 * 0.5;
        totalDeviation += Math.max(0, Math.abs(dynDiff) - 4) ** 2 * 0.3;
        maxDeviation += 64 * 0.5 + 64 * 0.3;
    }
    const rawScore = 1 - Math.sqrt(Math.min(1, totalDeviation / Math.max(maxDeviation, 1)));
    const score = Math.max(0, Math.min(100, Math.round(rawScore * 100)));

    // Priorities
    const pris = [];
    const sorted = [...bandDiffs].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    sorted.forEach(b => {
        if (pris.length >= 3 || Math.abs(b.diff) < T_OK) return;
        if (procDiffers && (b.name === 'Sub' || b.name === 'Bass' || b.name === 'Air') && Math.abs(b.diff) < 12) return;
        pris.push(b.advice);
    });
    if (Math.abs(crestDiff) > 6 && !(refWet && mineDry)) pris.push(compAction || compAdvice);

    // --- ACTIONABLE HARSHNESS / DE-ESSER ADVICE ---
    const hDiff = mine.harshness.index - ref.harshness.index;
    let harshAdvice, deesserAction;
    if (hDiff > 15) {
        harshAdvice = `Эски стреляют сильнее рефа (индекс ${mine.harshness.index} vs ${ref.harshness.index}).`;
        deesserAction = `Вешай De-Esser на ${mine.harshness.deesserFreq} Hz. Threshold: средний, чтобы убрать ~${Math.min(hDiff * 0.3, 6).toFixed(0)} дБ на сибилянтах.`;
    } else if (hDiff > 8) {
        harshAdvice = `Чуть ярче рефа (${mine.harshness.index} vs ${ref.harshness.index}).`;
        deesserAction = `Лёгкий De-Esser на ${mine.harshness.deesserFreq} Hz — убери 2–3 дБ на пиках.`;
    } else if (hDiff < -15) {
        harshAdvice = `Тусклее рефа (${mine.harshness.index} vs ${ref.harshness.index}).`;
        deesserAction = `Де-эссер слишком агрессивный — ослабь или убери. Добавь Air EQ буст на 10–12 кГц.`;
    } else {
        harshAdvice = `Яркость на уровне рефа ✓`;
        deesserAction = null;
    }

    // --- ACTIONABLE TILT ADVICE ---
    let tiltAdvice = '', tiltAction = null;
    if (ref.tilt && mine.tilt) {
        const tiltDiff = mine.tilt.slopeDbPerOct - ref.tilt.slopeDbPerOct;
        if (tiltDiff < -2) {
            tiltAdvice = `Спектр темнее рефа (${mine.tilt.character} vs ${ref.tilt.character}).`;
            tiltAction = `Добавь воздуха: High-Shelf EQ на 10–12 кГц, буст +${Math.min(Math.abs(tiltDiff), 4).toFixed(0)}–${Math.min(Math.abs(tiltDiff) + 1, 6).toFixed(0)} дБ.`;
        } else if (tiltDiff > 2) {
            tiltAdvice = `Спектр ярче рефа (${mine.tilt.character} vs ${ref.tilt.character}).`;
            tiltAction = `Убери лишний верх: High-Shelf EQ на 8–10 кГц, срез −${Math.min(tiltDiff, 4).toFixed(0)}–${Math.min(tiltDiff + 1, 6).toFixed(0)} дБ.`;
        } else {
            tiltAdvice = `Тональный баланс совпадает с рефом ✓`;
        }
    }

    // Duration warning
    let durationWarning = null;
    const ratio = ref.rawDuration / Math.max(mine.rawDuration, 0.1);
    if (ratio > 2.5 || ratio < 0.4)
        durationWarning = `Файлы разной длины (реф: ${ref.rawDuration.toFixed(0)}с, твой: ${mine.rawDuration.toFixed(0)}с). Для точности используй одинаковые фрагменты.`;

    return {
        bandDiffs, compAdvice, compAction, dynAdvice, score,
        priorities: pris.slice(0, 4),
        harshAdvice, deesserAction, tiltAdvice, tiltAction, durationWarning, procDiffers
    };
}
