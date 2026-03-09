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
function computeBandEnergies(freqs, psd, normPowerDb) {
    return BANDS.map(b => {
        let sum = 0, count = 0;
        for (let i = 0; i < freqs.length; i++) {
            if (freqs[i] >= b.lo && freqs[i] <= b.hi) { sum += psd[i]; count++; }
        }
        const energy = count > 0 ? dB10(sum / count) - normPowerDb : -80;
        return { ...b, energy };
    });
}
function addToneProfile(bands) {
    const anchors = bands.filter(b => SCORE_BANDS.includes(b.name));
    const anchorMean = anchors.length
        ? anchors.reduce((s, b) => s + b.energy, 0) / anchors.length
        : bands.reduce((s, b) => s + b.energy, 0) / Math.max(1, bands.length);
    return bands.map(b => ({ ...b, tone: b.energy - anchorMean }));
}
function psdToPowerDb(psd, sr, nfft) {
    const df = sr / nfft;
    let power = 0;
    for (let i = 0; i < psd.length; i++) power += psd[i] * df;
    return 10 * Math.log10(Math.max(power, 1e-20));
}
/* ============================================================
   PROCESSING FINGERPRINT (v2.1: pause-based reverb detection)
   ============================================================ */
function fingerprint(crest, dynRange, bandEnergies, data, sr, stereoInfo) {
    // Reverb detection uses two signals for stereo files: pause tails + stereo width.
    const frameSize = Math.floor(0.02 * sr);
    const frameRmsDb = [];
    for (let i = 0; i + frameSize <= data.length; i += frameSize) {
        let s = 0;
        for (let j = 0; j < frameSize; j++) s += data[i + j] ** 2;
        frameRmsDb.push(10 * Math.log10(Math.max(s / frameSize, 1e-20)));
    }

    const sortedFrames = [...frameRmsDb].sort((a, b) => a - b);
    const p85 = sortedFrames[Math.floor(sortedFrames.length * 0.85)] ?? -35;

    const minPauseFrames = Math.ceil(0.08 * sr / frameSize);
    const VOICE_THRESH = Math.max(-52, Math.min(-38, p85 - 16));
    const REVERB_THRESH = Math.max(-60, Math.min(-44, VOICE_THRESH - 10));

    const pauseEnergies = [];
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

    const isStereo = !!(stereoInfo && stereoInfo.isStereo);
    const stereoWidth = isStereo
        ? Math.max(0, Math.min(1, (stereoInfo.width ?? (1 - (stereoInfo.avgCorr ?? 1)))))
        : 0;
    const hasWideStereo = isStereo && stereoWidth > 0.25;

    let hasReverb = false;
    let reverbAmount = 0;
    let avgPauseDb = -90;

    const reverbReliable = pauseEnergies.length > 10 && pauseEnergies.length > frameRmsDb.length * 0.05;
    if (reverbReliable) {
        pauseEnergies.sort((a, b) => b - a);
        const top = pauseEnergies.slice(0, Math.ceil(pauseEnergies.length * 0.3));
        avgPauseDb = top.reduce((a, b) => a + b, 0) / top.length;

        // Mono files rely on tails only (stricter threshold).
        const monoTailThresh = REVERB_THRESH + 2;
        const tailsSuggestReverb = avgPauseDb > REVERB_THRESH;
        const tailsSuggestReverbMono = avgPauseDb > monoTailThresh;

        if (isStereo) {
            hasReverb = tailsSuggestReverb && hasWideStereo;
            reverbAmount = hasReverb ? Math.min(1, (avgPauseDb - REVERB_THRESH) / 10) : 0;
        } else {
            hasReverb = tailsSuggestReverbMono;
            reverbAmount = hasReverb ? Math.min(1, (avgPauseDb - monoTailThresh) / 10) : 0;
        }
    }

    const hasCompression = crest < 13 && dynRange < 9;
    const airPresenceRatio = bandEnergies[8] - bandEnergies[5];
    const hasSaturation = airPresenceRatio > -8;

    let level = 'dry';
    if (hasReverb) level = 'wet';
    else if (hasCompression) level = 'processed';
    else if (hasSaturation) level = 'lightly';

    if (typeof window !== 'undefined' && window.__BULAVIN_DEBUG_FP) {
        console.log('[FP]', {
            VOICE_THRESH,
            REVERB_THRESH,
            pauseFrames: pauseEnergies.length,
            avgPauseDb,
            reverbReliable,
            isStereo,
            stereoWidth,
            hasWideStereo,
            hasReverb,
            crest,
            dynRange
        });
    }

    return {
        isDry: level === 'dry',
        hasReverb,
        reverbAmount,
        hasCompression,
        hasSaturation,
        level,
        reverbReliable,
        stereoWidth,
        hasWideStereo,
        avgPauseDb
    };
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

    // Band energies (normalized to overall level)
    const bands = addToneProfile(computeBandEnergies(freqs, psd, rmsPowerDb));
    // Direct-sound profile: onsets are less contaminated by reverb tails
    let directBands = null;
    const onset = onsetGatedPSD(data, sr, 2048);
    if (onset && onset.psd && onset.psd.length > 0) {
        const directNormPowerDb = psdToPowerDb(onset.psd, sr, onset.nfft);
        directBands = addToneProfile(computeBandEnergies(onset.freqs, onset.psd, directNormPowerDb));
    }

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
    const fp = fingerprint(crest, dynRange, bands.map(b => b.energy), data, sr, {
        isStereo: buf.numberOfChannels >= 2,
        avgCorr: stereo ? stereo.avgCorr : 1,
        width: stereo ? stereo.width : 0
    });
    const lufs = measureLUFS(data, sr);
    const transients = analyzeTransients(data, sr);
    const pitchData = pitchTrack(data, sr);
    const tilt = spectralTilt(freqs, psdDb);
    const noise = noiseFloor(data, sr);
    const clipping = detectClipping(data);
    const compModel = estimateCompressorFromSignal(data, sr);
    const reverbModel = estimateReverbRT60(data, sr);
    const dynamicEqModel = dynamicEqByLoudness(data, sr, 2048);

    return {
        peakDb, rmsDb, activeRmsDb, crest, dynRange, transientSpeed,
        duration: data.length / sr, rawDuration: rawData.length / sr, sr,
        specFreqs, specDb, envelopeNorm, freqs,
        bands, directBands, directAvailable: !!directBands, resonances: resonances.slice(0, 8),
        envTime, envDb: envDbArr,
        fundamental, stereo, harshness,
        isStereo: buf.numberOfChannels >= 2,
        fp, lufs, transients, pitchData, tilt, noise, clipping,
        compModel, reverbModel, dynamicEqModel
    };
}

/* ============================================================
   COMPARE TWO TRACKS
   ============================================================ */
function clampNum(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function estimateHpfCutoff(track) {
    if (!track || !track.specFreqs || !track.specDb || track.specFreqs.length < 20) {
        return track && track.fundamental ? Math.round(clampNum(track.fundamental.freq * 0.6, 55, 180)) : 90;
    }

    let bodySum = 0;
    let bodyCount = 0;
    for (let i = 0; i < track.specFreqs.length; i++) {
        const f = track.specFreqs[i];
        if (f >= 180 && f <= 350) {
            bodySum += track.specDb[i];
            bodyCount++;
        }
    }
    const bodyMean = bodyCount ? (bodySum / bodyCount) : -20;

    let bestFreq = 0;
    let bestRise = -999;
    for (let i = 3; i < track.specFreqs.length - 3; i++) {
        const f = track.specFreqs[i];
        if (f < 45 || f > 180) continue;
        const lo = track.specDb[Math.max(0, i - 2)];
        const hi = track.specDb[Math.min(track.specDb.length - 1, i + 2)];
        const rise = hi - lo;
        const belowBody = track.specDb[i] < bodyMean - 5;
        if (belowBody && rise > bestRise) {
            bestRise = rise;
            bestFreq = f;
        }
    }

    if (bestFreq > 0) return Math.round(clampNum(bestFreq, 55, 180));
    if (track.fundamental) return Math.round(clampNum(track.fundamental.freq * 0.6, 55, 180));
    return 90;
}

function buildReverseRecipe(ref, mine, bandDiffs, context) {
    const bandByName = {};
    bandDiffs.forEach(b => { bandByName[b.name] = b; });

    const pauseDb = Number.isFinite(ref.fp.avgPauseDb) ? ref.fp.avgPauseDb : ref.noise.noiseLevel;
    const gateEnabled = pauseDb < -65;
    const gateThresholdDb = Math.round(clampNum(pauseDb + 6, -70, -35));

    const refHpfHz = estimateHpfCutoff(ref);
    const mineBaseHpf = mine.fundamental
        ? clampNum(mine.fundamental.freq * 0.6, 55, 180)
        : estimateHpfCutoff(mine);
    const hpfHz = Math.round(clampNum(refHpfHz * 0.65 + mineBaseHpf * 0.35, 55, 180));

    const staticCuts = mine.resonances.slice(0, 3).map(r => ({
        freqHz: r.freq,
        cutDb: r.cutDb,
        q: r.Q,
        label: r.label
    }));

    const dynamicEq = mine.dynamicEqModel && mine.dynamicEqModel.proximityEffect
        ? {
            needed: true,
            freqHz: mine.dynamicEqModel.proximityFreq,
            deltaDb: mine.dynamicEqModel.proximityDeltaDb,
            action: `Динамический EQ: приглушай ${mine.dynamicEqModel.proximityFreq} Hz на 2-4 dB только в тихих фразах.`
        }
        : { needed: false, freqHz: 0, deltaDb: 0, action: null };

    const airNeed = ((bandByName.Air ? bandByName.Air.diff : 0) * 0.7) + (bandByName.Brilliance ? bandByName.Brilliance.diff : 0) > 4;

    const refComp = ref.compModel || {};
    const mineComp = mine.compModel || {};
    const refDyn = Number.isFinite(refComp.dynamicRangeDb) ? refComp.dynamicRangeDb : ref.dynRange;
    const mineDyn = Number.isFinite(mineComp.dynamicRangeDb) ? mineComp.dynamicRangeDb : mine.dynRange;

    const compNeeded = !!refComp.detected || mineDyn > refDyn + 2;
    const ratio = Math.round(clampNum(refComp.ratio || (mineDyn > 12 ? 3.5 : 2.5), 1.5, 6) * 10) / 10;
    const attackMs = Math.round(clampNum(refComp.attackMs || (mine.transients ? mine.transients.compAttackMs : 8), 2, 30));
    const releaseMs = Math.round(clampNum(refComp.releaseMs || (mine.transients ? mine.transients.compReleaseMs : 90), 30, 260));
    const thresholdDb = Math.round(refComp.thresholdDb || -22);

    const compAction = compNeeded
        ? `Компрессор: Ratio ${ratio}:1, Attack ${attackMs} мс, Release ${releaseMs} мс, Threshold около ${thresholdDb} dB.`
        : 'Компрессия уже близка к референсу, оставь мягкий контроль 1-2 dB GR.';

    const hDiff = context.hDiff;
    const clarityDiff = bandByName.Clarity ? bandByName.Clarity.diff : 0;
    const deesserNeeded = (hDiff > 6 && clarityDiff < 2) || (mine.harshness.index > ref.harshness.index + 8);
    const deesserFreqHz = ref.harshness.deesserFreq || mine.harshness.deesserFreq;
    const deesserAmountDb = Math.round(clampNum((mine.harshness.index - ref.harshness.index) / 6 + 2, 1, 6));
    const deesserAction = deesserNeeded
        ? `De-Esser: ${deesserFreqHz} Hz, подавление ${deesserAmountDb} dB по "с/ш".`
        : 'De-Esser можно оставить минимальным или выключить.';

    const refRev = ref.reverbModel || {};
    const mineRev = mine.reverbModel || {};
    const reverbNeeded = !!(refRev.hasReverb || ref.fp.hasReverb);
    const decayMs = reverbNeeded
        ? Math.round(clampNum(refRev.rt60Ms || 350, 180, 2400))
        : 0;
    const type = reverbNeeded
        ? ((refRev.type && refRev.type !== 'none') ? refRev.type : (decayMs > 700 ? 'hall' : 'plate'))
        : 'none';
    const preDelayMs = reverbNeeded ? (type === 'hall' ? 28 : type === 'plate' ? 18 : 10) : 0;
    const mixPct = reverbNeeded ? (mine.fp.isDry ? 14 : 10) : 0;
    const reverbAction = reverbNeeded
        ? `Реверб: ${type}, decay ${decayMs} мс, pre-delay ${preDelayMs} мс, mix ${mixPct}%.`
        : 'Реверб не обязателен — у референса сухая/плотная подача.';

    const targetLufs = -14;
    const refLufs = ref.lufs.lufsI;
    const mineLufs = mine.lufs.lufsI;
    const toTarget = Math.round((targetLufs - mineLufs) * 10) / 10;

    const priorities = [];
    if (staticCuts.length > 0) {
        const cut = staticCuts[0];
        priorities.push(`Подрежь ${cut.freqHz} Hz на ${-Math.abs(cut.cutDb)} dB (Q ${cut.q}).`);
    }
    if (dynamicEq.needed) priorities.push(dynamicEq.action);
    if (compNeeded) priorities.push(compAction);
    if (deesserNeeded && priorities.length < 3) priorities.push(deesserAction);
    if (reverbNeeded && priorities.length < 3) priorities.push(`Добавь ${type} реверб с decay ${decayMs} мс.`);
    if (gateEnabled && priorities.length < 3) priorities.push(`Поставь gate с threshold около ${gateThresholdDb} dBFS.`);
    if (airNeed && priorities.length < 3) priorities.push('Добавь high-shelf на 10-12 kHz (+2..+4 dB).');

    const chainLabel = `[Gate] → [HPF ${hpfHz}Hz] → [EQ] → [Comp ${ratio}:1] → [De-esser ${deesserFreqHz}Hz] → [Reverb ${reverbNeeded ? decayMs + 'ms' : 'off'}] → [Loudness]`;

    return {
        chainLabel,
        gate: {
            enabled: gateEnabled,
            thresholdDb: gateThresholdDb,
            pauseDb: Math.round(pauseDb),
            action: gateEnabled
                ? `Gate: threshold ${gateThresholdDb} dBFS, release 70-100 мс.`
                : 'Gate не обязателен: паузы и так достаточно чистые.'
        },
        hpf: {
            refHz: refHpfHz,
            hz: hpfHz,
            action: `HPF: поставь срез около ${hpfHz} Hz (ориентир по референсу ${refHpfHz} Hz).`
        },
        eq: {
            staticCuts,
            dynamicEq,
            airNeed,
            tiltAction: context.tiltAction || null
        },
        compressor: {
            needed: compNeeded,
            ratio,
            attackMs,
            releaseMs,
            thresholdDb,
            action: compAction
        },
        deesser: {
            needed: deesserNeeded,
            freqHz: deesserFreqHz,
            amountDb: deesserAmountDb,
            action: deesserAction
        },
        reverb: {
            needed: reverbNeeded,
            type,
            decayMs,
            preDelayMs,
            mixPct,
            mineTailMs: mineRev.tailMs || 0,
            refTailMs: refRev.tailMs || 0,
            action: reverbNeeded
        ? `Реверб: ${type}, decay ${decayMs} мс, pre-delay ${preDelayMs} мс, mix ${mixPct}%.`
                : 'Реверб не нужен для этого референса.'
        },
        loudness: {
            targetLufs,
            refLufs,
            mineLufs,
            toTarget
        },
        priorities: priorities.slice(0, 3)
    };
}

function compare(ref, mine) {
    const T_OK = 4;
    const procDiffers = ref.fp.level !== mine.fp.level;
    const wetDryMismatch = (ref.fp.hasReverb && mine.fp.isDry) || (mine.fp.hasReverb && ref.fp.isDry);
    const stageMismatch = wetDryMismatch || procDiffers;

    const bandDiffs = ref.bands.map((r, i) => {
        const m = mine.bands[i];
        const canUseDirect = stageMismatch && SCORE_BANDS.includes(r.name) && ref.directAvailable && mine.directAvailable;
        const refCmp = canUseDirect ? ref.directBands[i].tone : r.tone;
        const mineCmp = canUseDirect ? mine.directBands[i].tone : m.tone;
        const diff = refCmp - mineCmp;
        const absDiff = Math.abs(diff);
        const severity = absDiff < T_OK ? 'ok' : (diff > 0 ? 'boost' : 'cut');

        let advice = `${r.name}: близко к референсу.`;
        if (absDiff >= T_OK) {
            const gain = Math.min(absDiff, 6).toFixed(1);
            advice = diff > 0
                ? `Подними ${r.name} примерно на +${gain} dB.`
                : `Опусти ${r.name} примерно на -${gain} dB.`;
        }

        return { ...r, refE: refCmp, mineE: mineCmp, diff, severity, advice, canUseDirect };
    });

    const crestDiff = mine.crest - ref.crest;
    const dynDiff = mine.dynRange - ref.dynRange;
    const compressionMismatch = ref.fp.hasCompression !== mine.fp.hasCompression;

    let compAdvice = 'По компрессии всё близко к референсу.';
    let compAction = null;
    if (ref.fp.hasCompression && !mine.fp.hasCompression) {
        compAdvice = 'Твой вокал звучит слишком сырой и неровный по динамике.';
    } else if (!ref.fp.hasCompression && mine.fp.hasCompression) {
        compAdvice = 'Компрессия у тебя сильнее, чем в референсе.';
    } else if (crestDiff > 4 || dynDiff > 4) {
        compAdvice = 'Вокал прыгает по громкости сильнее, чем у референса.';
    } else if (crestDiff < -4 && !wetDryMismatch) {
        compAdvice = 'Вокал слишком зажат по сравнению с референсом.';
    }

    let dynAdvice = 'Динамика в целом близка к референсу.';
    if (wetDryMismatch) {
        dynAdvice = 'Сравнение динамики частично искажено из-за разной стадии обработки (dry/wet).';
    } else if (dynDiff > 5) {
        dynAdvice = 'Диапазон громкости слишком широкий: лучше сильнее контролировать компрессором.';
    } else if (dynDiff < -5) {
        dynAdvice = 'Диапазон громкости слишком узкий: компрессия может быть пережата.';
    }

    let totalDeviation = 0;
    let maxDeviation = 0;
    bandDiffs.forEach(b => {
        if (!SCORE_BANDS.includes(b.name)) return;
        const w = b.weight || 1;
        const excess = Math.max(0, Math.abs(b.diff) - 3);
        const capped = Math.min(excess, 12);
        totalDeviation += capped * capped * w;
        maxDeviation += 144 * w;
    });

    const dynamicsComparable = ref.fp.hasReverb === mine.fp.hasReverb;
    if (dynamicsComparable) {
        totalDeviation += Math.max(0, Math.abs(crestDiff) - 4) ** 2 * 0.5;
        totalDeviation += Math.max(0, Math.abs(dynDiff) - 4) ** 2 * 0.3;
        maxDeviation += 64 * 0.5 + 64 * 0.3;
    }
    const rawScore = 1 - Math.sqrt(Math.min(1, totalDeviation / Math.max(maxDeviation, 1)));
    const score = Math.max(0, Math.min(100, Math.round(rawScore * 100)));

    const hDiff = mine.harshness.index - ref.harshness.index;
    const tiltDiff = (ref.tilt && mine.tilt) ? (mine.tilt.slopeDbPerOct - ref.tilt.slopeDbPerOct) : 0;

    let harshAdvice = 'Сибилянты близки к референсу.';
    let deesserAction = null;
    if (hDiff > 12) {
        harshAdvice = 'Свистящие согласные звучат агрессивнее, чем в референсе.';
        deesserAction = `Поставь De-Esser в зоне ${mine.harshness.deesserFreq} Hz, дави 2-4 dB по "с/ш".`;
    } else if (hDiff > 7) {
        harshAdvice = 'Есть лёгкий избыток сибилянтов.';
        deesserAction = `Слегка подожми De-Esser около ${mine.harshness.deesserFreq} Hz (1-2 dB).`;
    } else if (tiltDiff < -2) {
        harshAdvice = 'Верхов не хватает. Проблема скорее в EQ, а не в де-эссере.';
    }

    let tiltAdvice = 'Тональный баланс по верхам близок к референсу.';
    let tiltAction = null;
    if (tiltDiff < -2) {
        tiltAdvice = 'Голос звучит тусклее референса.';
        tiltAction = 'В EQ добавь high-shelf на 10-12 kHz примерно +2..+4 dB.';
    } else if (tiltDiff > 2) {
        tiltAdvice = 'Голос звучит ярче и жёстче референса.';
        tiltAction = 'В EQ убери high-shelf на 8-10 kHz примерно -2..-4 dB.';
    }

    const reverseRecipe = buildReverseRecipe(ref, mine, bandDiffs, {
        hDiff,
        tiltDiff,
        tiltAction
    });

    if (!compAction && reverseRecipe.compressor.needed) compAction = reverseRecipe.compressor.action;
    if (!deesserAction && reverseRecipe.deesser.needed) deesserAction = reverseRecipe.deesser.action;

    let durationWarning = null;
    const ratio = ref.rawDuration / Math.max(mine.rawDuration, 0.1);
    if (ratio > 2.5 || ratio < 0.4) {
        durationWarning = `Файлы сильно различаются по длине (реф ${ref.rawDuration.toFixed(1)}s, твой ${mine.rawDuration.toFixed(1)}s). Сравнение может быть неточным.`;
    }

    return {
        bandDiffs,
        compAdvice,
        compAction,
        dynAdvice,
        score,
        priorities: reverseRecipe.priorities,
        harshAdvice,
        deesserAction,
        tiltAdvice,
        tiltAction,
        durationWarning,
        procDiffers,
        compressionMismatch,
        stageMismatch,
        reverseRecipe
    };
}
