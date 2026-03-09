/* ============================================================
   BULAVIN AI ANALYZER v2.0 — DSP Core
   FFT, Welch PSD, Autocorrelation, LUFS, Transients, Pitch,
   Spectral Envelope, Noise Floor, Clipping Detection
   ============================================================ */

// --- Utility ---
function dB(v) { return 20 * Math.log10(Math.max(v, 1e-10)); }
function dB10(v) { return 10 * Math.log10(Math.max(v, 1e-10)); }

function rms(arr) {
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i] * arr[i];
    return Math.sqrt(s / arr.length);
}

function peak(arr) {
    let p = 0;
    for (let i = 0; i < arr.length; i++) {
        const a = Math.abs(arr[i]);
        if (a > p) p = a;
    }
    return p;
}

function getSamples(buf) {
    if (buf.numberOfChannels === 1) return buf.getChannelData(0);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const mono = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) mono[i] = (L[i] + R[i]) * 0.5;
    return mono;
}

function getStereoChannels(buf) {
    if (buf.numberOfChannels < 2) return null;
    return { L: buf.getChannelData(0), R: buf.getChannelData(1) };
}

// --- Strip Silence ---
function stripSilence(data, sr) {
    const frameSize = Math.floor(0.02 * sr);
    const hop = Math.floor(frameSize / 2);
    const thresh = -45;
    let firstActive = -1, lastActive = -1;
    for (let i = 0; i + frameSize <= data.length; i += hop) {
        let s = 0;
        for (let j = 0; j < frameSize; j++) s += data[i + j] * data[i + j];
        if (dB(Math.sqrt(s / frameSize)) > thresh) {
            if (firstActive < 0) firstActive = i;
            lastActive = i + frameSize;
        }
    }
    if (firstActive < 0) return data;
    const pad = Math.floor(0.05 * sr);
    return data.slice(Math.max(0, firstActive - pad), Math.min(data.length, lastActive + pad));
}

// --- Hann Window ---
function hann(N) {
    const w = new Float32Array(N);
    for (let i = 0; i < N; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
    return w;
}

// --- Radix-2 FFT (in-place, iterative) ---
function fft(re, im) {
    const N = re.length;
    for (let i = 1, j = 0; i < N; i++) {
        let bit = N >> 1;
        while (j & bit) { j ^= bit; bit >>= 1; }
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    for (let len = 2; len <= N; len *= 2) {
        const half = len / 2;
        const angle = -2 * Math.PI / len;
        const wRe = Math.cos(angle), wIm = Math.sin(angle);
        for (let i = 0; i < N; i += len) {
            let curRe = 1, curIm = 0;
            for (let j = 0; j < half; j++) {
                const tRe = curRe * re[i + j + half] - curIm * im[i + j + half];
                const tIm = curRe * im[i + j + half] + curIm * re[i + j + half];
                re[i + j + half] = re[i + j] - tRe;
                im[i + j + half] = im[i + j] - tIm;
                re[i + j] += tRe;
                im[i + j] += tIm;
                const newRe = curRe * wRe - curIm * wIm;
                curIm = curRe * wIm + curIm * wRe;
                curRe = newRe;
            }
        }
    }
}

// --- Welch PSD (FIXED: one-sided scaling) ---
function welchPSD(data, sr, nfft, overlap) {
    nfft = nfft || 4096;
    overlap = overlap || 0.5;
    const step = Math.floor(nfft * (1 - overlap));
    const win = hann(nfft);
    let winPow = 0;
    for (let i = 0; i < nfft; i++) winPow += win[i] * win[i];

    const nBins = nfft / 2 + 1;
    const psd = new Float64Array(nBins);
    let nSeg = 0;

    for (let start = 0; start + nfft <= data.length; start += step) {
        const re = new Float64Array(nfft);
        const im = new Float64Array(nfft);
        for (let i = 0; i < nfft; i++) re[i] = data[start + i] * win[i];
        fft(re, im);
        for (let i = 0; i < nBins; i++) {
            psd[i] += (re[i] * re[i] + im[i] * im[i]);
        }
        nSeg++;
    }

    // FIX 1.6: one-sided scaling — double bins 1..(N/2-1)
    for (let i = 1; i < nBins - 1; i++) {
        psd[i] *= 2;
    }

    const freqs = new Float64Array(nBins);
    const scale = 1.0 / (Math.max(nSeg, 1) * winPow * sr);
    for (let i = 0; i < nBins; i++) {
        psd[i] *= scale;
        freqs[i] = i * sr / nfft;
    }
    return { freqs, psd, nfft };
}

// --- Autocorrelation ---
function autocorrelate(data, sr, minFreq, maxFreq) {
    minFreq = minFreq || 70;
    maxFreq = maxFreq || 500;
    const minLag = Math.floor(sr / maxFreq);
    const maxLag = Math.floor(sr / minFreq);
    const N = data.length;
    if (N < maxLag * 2) return null;
    function corrAtLag(lag) {
        let sum = 0, normA = 0, normB = 0;
        const len = Math.min(N - lag, 2048);
        for (let i = 0; i < len; i++) {
            sum += data[i] * data[i + lag];
            normA += data[i] * data[i];
            normB += data[i + lag] * data[i + lag];
        }
        return sum / (Math.sqrt(normA * normB) + 1e-10);
    }
    let bestLag = minLag, bestCorr = -1;
    for (let lag = minLag; lag <= Math.min(maxLag, N / 2); lag++) {
        const corr = corrAtLag(lag);
        if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
    }
    if (bestCorr < 0.3) return null;
    // Prefer octave-lower candidate if correlation is close and freq stays in vocal range.
    const doubleLag = bestLag * 2;
    if (doubleLag <= Math.min(maxLag, N / 2)) {
        const corr2 = corrAtLag(doubleLag);
        const freq2 = sr / doubleLag;
        const voiceBand = freq2 >= 80 && freq2 <= 350;
        const corrClose = corr2 >= bestCorr * (voiceBand ? 0.86 : 0.96);
        if (corrClose && freq2 >= minFreq && freq2 <= maxFreq) {
            bestLag = doubleLag;
            bestCorr = corr2;
        }
    }
    // Octave-up only with strong evidence to avoid jumping.
    const freqNow = sr / bestLag;
    const halfLag = Math.floor(bestLag / 2);
    if (halfLag >= minLag) {
        const corr3 = corrAtLag(halfLag);
        const freq3 = sr / halfLag;
        const likelyOctaveError = freqNow < 140;
        const strongEvidence = corr3 > bestCorr * (likelyOctaveError ? 1.02 : 1.10);
        if (strongEvidence && freq3 >= 150 && freq3 <= maxFreq) {
            bestLag = halfLag;
            bestCorr = corr3;
        }
    }
    return { freq: sr / bestLag, confidence: bestCorr, lag: bestLag };
}

// --- Stereo Correlation ---
function stereoCorrelation(L, R, frameSize, hop) {
    frameSize = frameSize || 4096;
    hop = hop || 2048;
    const N = Math.min(L.length, R.length);
    let totalCorr = 0, nFrames = 0, minCorr = 1, phaseIssueFrames = 0;

    for (let i = 0; i + frameSize <= N; i += hop) {
        let sumLR = 0, sumLL = 0, sumRR = 0;
        for (let j = 0; j < frameSize; j++) {
            const l = L[i + j], r = R[i + j];
            sumLR += l * r; sumLL += l * l; sumRR += r * r;
        }
        if (sumLL < 1e-8 && sumRR < 1e-8) continue;
        const corr = sumLR / (Math.sqrt(sumLL * sumRR) + 1e-10);
        totalCorr += corr; nFrames++;
        if (corr < minCorr) minCorr = corr;
        if (corr < 0) phaseIssueFrames++;
    }
    if (nFrames === 0) return { avgCorr: 1, minCorr: 1, width: 0, phaseIssues: 0, nFrames: 0 };
    const avgCorr = totalCorr / nFrames;
    return {
        avgCorr, minCorr,
        width: Math.max(0, Math.min(1, 1 - avgCorr)),
        phaseIssues: phaseIssueFrames,
        phaseIssuePercent: (phaseIssueFrames / nFrames) * 100,
        nFrames
    };
}

// --- Harshness / Sibilance (FIXED calibration 1.2) ---
function detectHarshness(data, sr, freqs, psd) {
    let harshEnergy = 0, harshCount = 0;
    let totalEnergy = 0, totalCount = 0;

    for (let i = 0; i < freqs.length; i++) {
        if (freqs[i] >= 20 && freqs[i] <= 20000) { totalEnergy += psd[i]; totalCount++; }
        if (freqs[i] >= 4000 && freqs[i] <= 10000) { harshEnergy += psd[i]; harshCount++; }
    }

    const harshRatio = harshCount > 0 && totalCount > 0
        ? (harshEnergy / harshCount) / (totalEnergy / totalCount) : 0;

    // FIX 1.2: calibrated harshness index
    const rawIndex = Math.log10(Math.max(harshRatio, 0.001) / 0.3) * 60 + 50;
    const index = Math.max(0, Math.min(100, Math.round(rawIndex)));

    // De-esser: energy-weighted centroid 4-10kHz
    let wfSum = 0, weSum = 0;
    for (let i = 0; i < freqs.length; i++) {
        if (freqs[i] >= 4000 && freqs[i] <= 10000) {
            const w = psd[i] * psd[i];
            wfSum += freqs[i] * w; weSum += w;
        }
    }
    let deesserFreq = weSum > 0 ? wfSum / weSum : 6000;
    deesserFreq = Math.round(deesserFreq / 250) * 250;

    return { index, harshRatio, deesserFreq };
}

// --- Cepstral Spectral Envelope ---
function spectralEnvelope(psd, sr, nfft, lifterMs) {
    lifterMs = lifterMs || 4;
    const nBins = psd.length;
    const logPsd = new Float64Array(nBins);
    for (let i = 0; i < nBins; i++) logPsd[i] = Math.log(Math.max(psd[i], 1e-20));

    const cepsRe = new Float64Array(nfft);
    const cepsIm = new Float64Array(nfft);
    cepsRe[0] = logPsd[0];
    for (let i = 1; i < nBins - 1; i++) {
        cepsRe[i] = logPsd[i];
        cepsRe[nfft - i] = logPsd[i];
    }
    cepsRe[nBins - 1] = logPsd[nBins - 1];

    fft(cepsRe, cepsIm);

    const lifterCut = Math.floor(lifterMs / 1000 * sr);
    for (let i = lifterCut + 1; i < nfft - lifterCut; i++) {
        cepsRe[i] = 0; cepsIm[i] = 0;
    }

    // IFFT via conjugate
    for (let i = 0; i < nfft; i++) cepsIm[i] = -cepsIm[i];
    fft(cepsRe, cepsIm);

    const envelope = new Float64Array(nBins);
    for (let i = 0; i < nBins; i++) envelope[i] = Math.exp(cepsRe[i] / nfft);
    return envelope;
}

// --- Onset-Gated PSD (direct sound only, strips reverb) ---
function onsetGatedPSD(data, sr, nfft) {
    nfft = nfft || 2048;
    const frameSize = Math.floor(sr * 0.01);
    const win = hann(nfft);
    const nBins = nfft / 2 + 1;
    const psd = new Float64Array(nBins);
    let nSeg = 0, winPow = 0;
    for (let i = 0; i < nfft; i++) winPow += win[i] * win[i];

    const frameRms = [];
    for (let i = 0; i + frameSize <= data.length; i += frameSize) {
        let s = 0;
        for (let j = 0; j < frameSize; j++) s += data[i + j] ** 2;
        frameRms.push(Math.sqrt(s / frameSize));
    }

    for (let i = 1; i < frameRms.length; i++) {
        const rise = frameRms[i] / Math.max(frameRms[i - 1], 1e-10);
        if (rise > 2.0 && frameRms[i] > 0.001) {
            const onset = i * frameSize;
            if (onset + nfft <= data.length) {
                const re = new Float64Array(nfft);
                const im = new Float64Array(nfft);
                for (let j = 0; j < nfft; j++) re[j] = data[onset + j] * win[j];
                fft(re, im);
                for (let j = 0; j < nBins; j++) psd[j] += re[j] * re[j] + im[j] * im[j];
                nSeg++;
            }
        }
    }
    if (nSeg === 0) return null;

    for (let i = 1; i < nBins - 1; i++) psd[i] *= 2;
    const freqs = new Float64Array(nBins);
    const scale = 1.0 / (nSeg * winPow * sr);
    for (let i = 0; i < nBins; i++) { psd[i] *= scale; freqs[i] = i * sr / nfft; }
    return { freqs, psd, nfft };
}

// --- K-Weighting Coefficients (any SR) ---
function kWeightingCoeffs(sr) {
    const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    const K = Math.tan(Math.PI * f0 / sr);
    const Vh = Math.pow(10, G / 20);
    const Vb = Math.pow(Vh, 0.4996667741545416);
    const a0_ = 1 + K / Q + K * K;

    const f1 = 38.13547087602444, Q2 = 0.5003270373238773;
    const K2 = Math.tan(Math.PI * f1 / sr);
    const a0h = 1 + K2 / Q2 + K2 * K2;

    return {
        shelf: {
            b0: (Vh + Vb * K / Q + K * K) / a0_,
            b1: 2 * (K * K - Vh) / a0_,
            b2: (Vh - Vb * K / Q + K * K) / a0_,
            a1: 2 * (K * K - 1) / a0_,
            a2: (1 - K / Q + K * K) / a0_
        },
        hp: {
            b0: 1 / a0h, b1: -2 / a0h, b2: 1 / a0h,
            a1: 2 * (K2 * K2 - 1) / a0h,
            a2: (1 - K2 / Q2 + K2 * K2) / a0h
        }
    };
}

function applyBiquad(x, b0, b1, b2, a1, a2) {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
        const yi = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x[i]; y2 = y1; y1 = yi; y[i] = yi;
    }
    return y;
}

// --- LUFS Measurement (ITU-R BS.1770-4) ---
function measureLUFS(data, sr) {
    const c = kWeightingCoeffs(sr);
    let filtered = applyBiquad(data, c.shelf.b0, c.shelf.b1, c.shelf.b2, c.shelf.a1, c.shelf.a2);
    filtered = applyBiquad(filtered, c.hp.b0, c.hp.b1, c.hp.b2, c.hp.a1, c.hp.a2);

    const blockSize = Math.floor(sr * 0.4);
    const hopL = Math.floor(sr * 0.1);
    const blockPowers = [];
    for (let i = 0; i + blockSize <= filtered.length; i += hopL) {
        let s = 0;
        for (let j = 0; j < blockSize; j++) s += filtered[i + j] ** 2;
        blockPowers.push(s / blockSize);
    }

    const absThresh = Math.pow(10, -7.0);
    const gated1 = blockPowers.filter(p => p > absThresh);
    if (gated1.length === 0) return { lufsI: -70, lra: 0, truePeak: -70 };

    const meanG1 = gated1.reduce((a, b) => a + b, 0) / gated1.length;
    const relThresh = meanG1 * Math.pow(10, -1.0);
    const gated2 = gated1.filter(p => p > relThresh);
    if (gated2.length === 0) return { lufsI: -70, lra: 0, truePeak: -70 };

    const meanPower = gated2.reduce((a, b) => a + b, 0) / gated2.length;
    const lufsI = -0.691 + 10 * Math.log10(Math.max(meanPower, 1e-20));

    const sortedPow = [...gated2].sort((a, b) => a - b);
    const p10 = sortedPow[Math.floor(sortedPow.length * 0.10)];
    const p95 = sortedPow[Math.floor(sortedPow.length * 0.95)];
    const lra = Math.max(0, 10 * Math.log10(p95 / Math.max(p10, 1e-20)));

    let truePeak = 0;
    for (let i = 0; i < data.length - 1; i++) {
        for (let k = 1; k <= 3; k++) {
            const s = Math.abs(data[i] + (data[i + 1] - data[i]) * (k / 4));
            if (s > truePeak) truePeak = s;
        }
    }

    return {
        lufsI: Math.round(lufsI * 10) / 10,
        lra: Math.round(lra * 10) / 10,
        truePeak: Math.round(dB(truePeak) * 10) / 10
    };
}

// --- Transient Attack Detector ---
function analyzeTransients(data, sr) {
    const frameSize = Math.floor(sr * 0.001);
    const threshold = -20;
    const frameRmsDb = [];
    for (let i = 0; i + frameSize <= data.length; i += frameSize) {
        let s = 0;
        for (let j = 0; j < frameSize; j++) s += data[i + j] ** 2;
        frameRmsDb.push(10 * Math.log10(Math.max(s / frameSize, 1e-20)));
    }

    const attackTimes = [];
    let inAttack = false;
    for (let i = 5; i < frameRmsDb.length - 5; i++) {
        const rise = frameRmsDb[i] - frameRmsDb[i - 5];
        if (rise > 10 && frameRmsDb[i] > threshold) {
            if (!inAttack) {
                let startFrame = i;
                for (let j = i; j > Math.max(0, i - 50); j--) {
                    if (frameRmsDb[j] < threshold - 20) { startFrame = j; break; }
                }
                let peakFrame = i;
                for (let j = i; j < Math.min(frameRmsDb.length, i + 30); j++) {
                    if (frameRmsDb[j] > frameRmsDb[peakFrame]) peakFrame = j;
                }
                const ms = peakFrame - startFrame;
                if (ms >= 1 && ms <= 150) attackTimes.push(ms);
                inAttack = true;
            }
        } else if (rise < -5) { inAttack = false; }
    }

    if (attackTimes.length === 0) return null;
    attackTimes.sort((a, b) => a - b);
    const median = attackTimes[Math.floor(attackTimes.length / 2)];
    return {
        medianAttackMs: Math.round(median),
        attackCount: attackTimes.length,
        compAttackMs: Math.round(median * 0.4),
        compReleaseMs: Math.round(median * 6)
    };
}

function percentileFromSorted(sorted, p) {
    if (!sorted || sorted.length === 0) return 0;
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))));
    return sorted[idx];
}

function medianValue(values) {
    if (!values || values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

function frameDbTrack(data, sr, frameMs, hopMs) {
    const frameSize = Math.max(8, Math.floor(sr * frameMs / 1000));
    const hop = Math.max(4, Math.floor(sr * hopMs / 1000));
    const db = [];
    const starts = [];
    for (let i = 0; i + frameSize <= data.length; i += hop) {
        let s = 0;
        for (let j = 0; j < frameSize; j++) s += data[i + j] * data[i + j];
        db.push(10 * Math.log10(Math.max(s / frameSize, 1e-20)));
        starts.push(i);
    }
    return { db, starts, frameSize, hop };
}

function estimateCompressorFromSignal(data, sr) {
    const env = frameDbTrack(data, sr, 8, 4);
    if (env.db.length < 20) {
        return { detected: false, ratio: 2.0, attackMs: 8, releaseMs: 80, thresholdDb: -24, dynamicRangeDb: 12, confidence: 0 };
    }

    const sorted = [...env.db].sort((a, b) => a - b);
    const noise = percentileFromSorted(sorted, 0.12);
    const active = env.db.filter(v => v > noise + 8);
    if (active.length < 20) {
        return { detected: false, ratio: 2.0, attackMs: 8, releaseMs: 80, thresholdDb: -24, dynamicRangeDb: 14, confidence: 0.2 };
    }

    const activeSorted = [...active].sort((a, b) => a - b);
    const p10 = percentileFromSorted(activeSorted, 0.10);
    const p65 = percentileFromSorted(activeSorted, 0.65);
    const p90 = percentileFromSorted(activeSorted, 0.90);
    const dyn = Math.max(2, p90 - p10);

    const ratio = Math.max(1.2, Math.min(6, 22 / dyn));
    const thresholdDb = Math.round(p65);

    const transient = analyzeTransients(data, sr);
    const attackMs = transient ? Math.max(2, Math.min(30, transient.compAttackMs)) : 8;

    const peaks = [];
    for (let i = 2; i < env.db.length - 4; i++) {
        if (env.db[i] > env.db[i - 1] + 3 && env.db[i] > env.db[i + 1] && env.db[i] > p65) {
            peaks.push(i);
        }
    }

    const releaseArr = [];
    const targetFloor = percentileFromSorted(activeSorted, 0.35);
    for (const idx of peaks.slice(0, 120)) {
        const peakDb = env.db[idx];
        const minTarget = Math.max(targetFloor, peakDb - 10);
        const maxJ = Math.min(env.db.length - 1, idx + Math.round(0.35 * sr / env.hop));
        for (let j = idx + 1; j <= maxJ; j++) {
            if (env.db[j] <= minTarget) {
                const relMs = (j - idx) * env.hop / sr * 1000;
                if (relMs >= 12 && relMs <= 350) releaseArr.push(relMs);
                break;
            }
        }
    }

    const releaseMs = Math.round(Math.max(25, Math.min(250, medianValue(releaseArr) || 90)));
    const detected = dyn < 10.5 || ratio >= 2.3;
    const confidence = Math.max(0.2, Math.min(0.95, active.length / 400 + (releaseArr.length > 6 ? 0.2 : 0)));

    return {
        detected,
        ratio: Math.round(ratio * 10) / 10,
        attackMs: Math.round(attackMs),
        releaseMs,
        thresholdDb,
        dynamicRangeDb: Math.round(dyn * 10) / 10,
        confidence: Math.round(confidence * 100) / 100
    };
}

function estimateReverbRT60(data, sr) {
    const env = frameDbTrack(data, sr, 10, 10);
    if (env.db.length < 30) {
        return { hasReverb: false, rt60Ms: 0, tailMs: 0, type: 'none', confidence: 0, tailsCount: 0 };
    }

    const sorted = [...env.db].sort((a, b) => a - b);
    const p20 = percentileFromSorted(sorted, 0.20);
    const p85 = percentileFromSorted(sorted, 0.85);
    const voiceThresh = Math.max(-52, Math.min(-34, p85 - 12));
    const noiseFloor = p20;

    const ends = [];
    for (let i = 2; i < env.db.length - 3; i++) {
        if (env.db[i - 1] > voiceThresh && env.db[i] <= voiceThresh && env.db[i + 1] <= voiceThresh) ends.push(i);
    }

    const rt60Vals = [];
    const tailVals = [];
    const linearity = [];

    for (const endIdx of ends.slice(0, 80)) {
        const startIdx = endIdx + 1;
        if (startIdx >= env.db.length - 5) continue;
        const startDb = Math.max(env.db[endIdx], env.db[startIdx]);
        const maxIdx = Math.min(env.db.length - 1, startIdx + Math.round(1.2 * sr / env.hop));
        let t20Ms = 0;
        let tailMs = 0;

        for (let j = startIdx + 1; j <= maxIdx; j++) {
            const drop = startDb - env.db[j];
            if (!t20Ms && drop >= 20) t20Ms = (j - startIdx) * env.hop / sr * 1000;
            if (env.db[j] <= noiseFloor + 3) {
                tailMs = (j - startIdx) * env.hop / sr * 1000;
                break;
            }
        }

        if (!tailMs) tailMs = (maxIdx - startIdx) * env.hop / sr * 1000;
        if (tailMs >= 30) tailVals.push(tailMs);
        if (t20Ms >= 25) rt60Vals.push(Math.min(4000, t20Ms * 3));

        const fitEnd = Math.min(maxIdx, startIdx + Math.round(0.35 * sr / env.hop));
        const xs = [], ys = [];
        for (let j = startIdx; j <= fitEnd; j++) {
            xs.push((j - startIdx) * env.hop / sr);
            ys.push(env.db[j]);
        }
        if (xs.length >= 6) {
            const n = xs.length;
            const sumX = xs.reduce((a, b) => a + b, 0);
            const sumY = ys.reduce((a, b) => a + b, 0);
            const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
            const sumXX = xs.reduce((s, x) => s + x * x, 0);
            const slope = (n * sumXY - sumX * sumY) / Math.max(1e-9, (n * sumXX - sumX * sumX));
            const intercept = (sumY - slope * sumX) / n;
            let ssRes = 0, ssTot = 0;
            const meanY = sumY / n;
            for (let i = 0; i < n; i++) {
                const pred = slope * xs[i] + intercept;
                ssRes += (ys[i] - pred) ** 2;
                ssTot += (ys[i] - meanY) ** 2;
            }
            const r2 = ssTot > 1e-9 ? (1 - ssRes / ssTot) : 0;
            linearity.push(Math.max(0, Math.min(1, r2)));
        }
    }

    const rt60Ms = Math.round(medianValue(rt60Vals));
    const tailMs = Math.round(medianValue(tailVals));
    const lin = medianValue(linearity);
    const hasReverb = rt60Ms >= 220 || tailMs >= 180;

    let type = 'none';
    if (hasReverb) {
        if (lin > 0.9) type = rt60Ms > 650 ? 'hall' : 'plate';
        else type = 'room';
    }

    const confidence = Math.max(0.2, Math.min(0.95, (rt60Vals.length / 12) + (linearity.length / 20)));

    return {
        hasReverb,
        rt60Ms: hasReverb ? rt60Ms : 0,
        tailMs,
        type,
        confidence: Math.round(confidence * 100) / 100,
        tailsCount: rt60Vals.length
    };
}

function dynamicEqByLoudness(data, sr, nfft) {
    nfft = nfft || 2048;
    const env = frameDbTrack(data, sr, 30, 15);
    if (env.db.length < 24) {
        return { proximityEffect: false, proximityFreq: 0, proximityDeltaDb: 0, dynamicRecommended: false, groupCounts: { quiet: 0, mid: 0, loud: 0 } };
    }

    const sortedDb = [...env.db].sort((a, b) => a - b);
    const t1 = percentileFromSorted(sortedDb, 0.33);
    const t2 = percentileFromSorted(sortedDb, 0.66);
    const quietStarts = [];
    const midStarts = [];
    const loudStarts = [];

    for (let i = 0; i < env.db.length; i++) {
        const db = env.db[i];
        if (db <= t1) quietStarts.push(env.starts[i]);
        else if (db <= t2) midStarts.push(env.starts[i]);
        else loudStarts.push(env.starts[i]);
    }

    const win = hann(nfft);
    const nBins = nfft / 2 + 1;

    function avgSpec(starts) {
        const out = new Float64Array(nBins);
        if (!starts.length) return out;
        let count = 0;
        for (const start of starts) {
            if (start + nfft > data.length) continue;
            const re = new Float64Array(nfft);
            const im = new Float64Array(nfft);
            for (let i = 0; i < nfft; i++) re[i] = data[start + i] * win[i];
            fft(re, im);
            for (let i = 0; i < nBins; i++) out[i] += re[i] * re[i] + im[i] * im[i];
            count++;
            if (count >= 120) break;
        }
        if (count === 0) return out;
        for (let i = 0; i < nBins; i++) out[i] = 10 * Math.log10(Math.max(out[i] / count, 1e-20));
        return out;
    }

    const quietSpec = avgSpec(quietStarts);
    const loudSpec = avgSpec(loudStarts);

    let bestFreq = 0;
    let bestDiff = -100;
    for (let i = 1; i < nBins; i++) {
        const f = i * sr / nfft;
        if (f < 120 || f > 500) continue;
        const diff = quietSpec[i] - loudSpec[i];
        if (diff > bestDiff) {
            bestDiff = diff;
            bestFreq = f;
        }
    }

    const proximityEffect = bestDiff > 3;
    const dynamicRecommended = proximityEffect;

    return {
        proximityEffect,
        proximityFreq: Math.round(bestFreq),
        proximityDeltaDb: Math.round(bestDiff * 10) / 10,
        dynamicRecommended,
        groupCounts: { quiet: quietStarts.length, mid: midStarts.length, loud: loudStarts.length }
    };
}
// --- Pitch Stability ---
function pitchTrack(data, sr) {
    const frameSize = Math.floor(sr * 0.04);
    const hop = Math.floor(sr * 0.01);
    const pitchFrames = [];

    for (let start = 0; start + frameSize <= data.length; start += hop) {
        const chunk = data.slice(start, start + frameSize);
        const chunkRmsVal = rms(chunk);
        if (dB(chunkRmsVal) < -45) continue;
        const result = autocorrelate(chunk, sr, 70, 600);
        if (result && result.confidence > 0.45) {
            pitchFrames.push({ time: start / sr, freq: result.freq, cents: 1200 * Math.log2(result.freq / 440) });
        }
    }
    if (pitchFrames.length < 3) return null;

    const sortedFreqs = pitchFrames.map(f => f.freq).sort((a, b) => a - b);
    const medianFreq = sortedFreqs[Math.floor(sortedFreqs.length / 2)];
    const medianCents = 1200 * Math.log2(medianFreq / 440);
    const diffs = pitchFrames.map(f => f.cents - medianCents);
    const stdCents = Math.sqrt(diffs.reduce((s, v) => s + v * v, 0) / diffs.length);
    const stabilityScore = Math.max(0, Math.min(100, Math.round(100 * (1 - (stdCents - 15) / 35))));

    return { frames: pitchFrames, medianFreq: Math.round(medianFreq * 10) / 10, stdCents: Math.round(stdCents), stabilityScore };
}

// --- Spectral Tilt ---
function spectralTilt(freqs, psdDb) {
    const logFreqs = [], dbVals = [];
    for (let i = 0; i < freqs.length; i++) {
        if (freqs[i] >= 100 && freqs[i] <= 10000) {
            logFreqs.push(Math.log2(freqs[i])); dbVals.push(psdDb[i]);
        }
    }
    const n = logFreqs.length;
    if (n < 10) return { slopeDbPerOct: -3, character: 'Нейтральный' };
    const sumX = logFreqs.reduce((a, b) => a + b, 0);
    const sumY = dbVals.reduce((a, b) => a + b, 0);
    const sumXY = logFreqs.reduce((s, x, i) => s + x * dbVals[i], 0);
    const sumXX = logFreqs.reduce((s, x) => s + x * x, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

    return {
        slopeDbPerOct: Math.round(slope * 10) / 10,
        character: slope < -5 ? 'Тёмный' : slope < -2 ? 'Нейтральный' : 'Яркий'
    };
}

// --- Noise Floor ---
function noiseFloor(data, sr) {
    const frameSize = Math.floor(sr * 0.05);
    const frameRmsDb = [];
    for (let i = 0; i + frameSize <= data.length; i += frameSize) {
        let s = 0;
        for (let j = 0; j < frameSize; j++) s += data[i + j] ** 2;
        frameRmsDb.push(10 * Math.log10(Math.max(s / frameSize, 1e-20)));
    }
    const sorted = frameRmsDb.filter(v => v > -80).sort((a, b) => a - b);
    if (sorted.length === 0) return { noiseLevel: -80, snr: 60, advice: 'Шум в норме ✅' };

    const noiseLevel = sorted[Math.floor(sorted.length * 0.1)];
    const vocalLevel = sorted[Math.floor(sorted.length * 0.8)];
    const snr = vocalLevel - noiseLevel;

    let advice;
    if (noiseLevel > -50)
        advice = `Шум высокий (${noiseLevel.toFixed(0)} dBFS). Gate: threshold ${(noiseLevel + 6).toFixed(0)} dBFS, attack 2 мс, release 80 мс.`;
    else if (noiseLevel > -60)
        advice = `Умеренный шум (${noiseLevel.toFixed(0)} dBFS). Лёгкий gate или broadband НШ.`;
    else
        advice = `Шум в норме (${noiseLevel.toFixed(0)} dBFS) ✅`;

    return { noiseLevel: Math.round(noiseLevel), snr: Math.round(snr), advice };
}

// --- Micro-Clipping Detector ---
function detectClipping(data) {
    let clipCount = 0;
    for (let i = 0; i < data.length - 3; i++) {
        if (Math.abs(data[i]) >= 0.998 && Math.abs(data[i + 1]) >= 0.998 && Math.abs(data[i + 2]) >= 0.998) {
            clipCount++; i += 2;
        }
    }
    const totalFrames = Math.max(1, Math.floor(data.length / 100));
    const clipPercent = (clipCount / totalFrames) * 100;
    return {
        clipCount, clipPercent: Math.round(clipPercent * 10) / 10,
        isClipping: clipPercent > 0.05, isSevere: clipPercent > 1.0,
        advice: clipPercent > 1.0
            ? `⚠️ Жёсткий клиппинг (${clipPercent.toFixed(1)}%). Перезапиши с -6 dB на входе.`
            : clipPercent > 0.05
                ? `Мелкий клиппинг (${clipPercent.toFixed(1)}%). Небольшой перегруз.`
                : 'Клиппинга нет ✅'
    };
}


