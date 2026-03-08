/* ============================================================
   BULAVIN AI ANALYZER — DSP Core
   FFT, Welch PSD, Autocorrelation, Utility functions
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

// --- Welch PSD ---
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

    const freqs = new Float64Array(nBins);
    const scale = 1.0 / (Math.max(nSeg, 1) * winPow * sr);
    for (let i = 0; i < nBins; i++) {
        psd[i] *= scale;
        freqs[i] = i * sr / nfft;
    }
    return { freqs, psd };
}

// --- Autocorrelation (for fundamental frequency detection) ---
function autocorrelate(data, sr, minFreq, maxFreq) {
    minFreq = minFreq || 70;
    maxFreq = maxFreq || 500;
    const minLag = Math.floor(sr / maxFreq);
    const maxLag = Math.floor(sr / minFreq);
    const N = data.length;

    if (N < maxLag * 2) return null;

    // Normalized autocorrelation
    let bestLag = minLag;
    let bestCorr = -1;

    for (let lag = minLag; lag <= Math.min(maxLag, N / 2); lag++) {
        let sum = 0, normA = 0, normB = 0;
        const len = Math.min(N - lag, 2048); // limit for speed
        for (let i = 0; i < len; i++) {
            sum += data[i] * data[i + lag];
            normA += data[i] * data[i];
            normB += data[i + lag] * data[i + lag];
        }
        const corr = sum / (Math.sqrt(normA * normB) + 1e-10);
        if (corr > bestCorr) {
            bestCorr = corr;
            bestLag = lag;
        }
    }

    if (bestCorr < 0.3) return null; // not enough periodicity

    return {
        freq: sr / bestLag,
        confidence: bestCorr,
        lag: bestLag
    };
}

// --- Stereo Correlation ---
function stereoCorrelation(L, R, frameSize, hop) {
    frameSize = frameSize || 4096;
    hop = hop || 2048;
    const N = Math.min(L.length, R.length);
    let totalCorr = 0;
    let nFrames = 0;
    let minCorr = 1;
    let phaseIssueFrames = 0;

    for (let i = 0; i + frameSize <= N; i += hop) {
        let sumLR = 0, sumLL = 0, sumRR = 0;
        for (let j = 0; j < frameSize; j++) {
            const l = L[i + j], r = R[i + j];
            sumLR += l * r;
            sumLL += l * l;
            sumRR += r * r;
        }
        // Skip silence
        if (sumLL < 1e-8 && sumRR < 1e-8) continue;

        const corr = sumLR / (Math.sqrt(sumLL * sumRR) + 1e-10);
        totalCorr += corr;
        nFrames++;

        if (corr < minCorr) minCorr = corr;
        if (corr < 0) phaseIssueFrames++;
    }

    if (nFrames === 0) return { avgCorr: 1, minCorr: 1, width: 0, phaseIssues: 0, nFrames: 0 };

    const avgCorr = totalCorr / nFrames;
    // Width: 0 = pure mono, 1 = very wide
    const width = Math.max(0, Math.min(1, 1 - avgCorr));

    return {
        avgCorr,
        minCorr,
        width,
        phaseIssues: phaseIssueFrames,
        phaseIssuePercent: (phaseIssueFrames / nFrames) * 100,
        nFrames
    };
}

// --- Harshness / Sibilance Detector ---
function detectHarshness(data, sr, freqs, psd) {
    const rmsDb = dB(rms(data));

    // Energy ratio: 4-10kHz vs full band
    let harshEnergy = 0, harshCount = 0;
    let totalEnergy = 0, totalCount = 0;
    let presenceEnergy = 0, presenceCount = 0;

    for (let i = 0; i < freqs.length; i++) {
        if (freqs[i] >= 20 && freqs[i] <= 20000) {
            totalEnergy += psd[i];
            totalCount++;
        }
        if (freqs[i] >= 4000 && freqs[i] <= 10000) {
            harshEnergy += psd[i];
            harshCount++;
        }
        if (freqs[i] >= 1000 && freqs[i] <= 4000) {
            presenceEnergy += psd[i];
            presenceCount++;
        }
    }

    const harshRatio = harshCount > 0 && totalCount > 0
        ? (harshEnergy / harshCount) / (totalEnergy / totalCount)
        : 0;

    // Sibilance peaks: find transient spikes in 4-10kHz
    // Frame-based approach for speed
    const frameSize = Math.floor(0.01 * sr); // 10ms frames
    const hop = Math.floor(frameSize / 2);
    let sibilantPeaks = 0;
    let totalFrames = 0;

    const fftSize = 2048;
    const win = hann(fftSize);

    for (let start = 0; start + fftSize <= data.length; start += hop * 4) { // skip frames for speed
        const re = new Float64Array(fftSize);
        const im = new Float64Array(fftSize);
        for (let i = 0; i < fftSize; i++) re[i] = data[start + i] * win[i];
        fft(re, im);

        let highE = 0, lowE = 0;
        for (let i = 0; i < fftSize / 2; i++) {
            const f = i * sr / fftSize;
            const power = re[i] * re[i] + im[i] * im[i];
            if (f >= 4000 && f <= 10000) highE += power;
            if (f >= 200 && f <= 4000) lowE += power;
        }

        totalFrames++;
        if (lowE > 1e-10 && (highE / lowE) > 0.5) sibilantPeaks++;
    }

    // Harshness index 0-100
    // Calibrated: ratio ~0.3 = neutral, > 0.6 = harsh
    const rawIndex = Math.log10(harshRatio + 0.01) * 30 + 60;
    const index = Math.max(0, Math.min(100, Math.round(rawIndex)));

    // De-esser advice
    let deesserFreq = 6000;
    let maxPsdInRange = 0;
    for (let i = 0; i < freqs.length; i++) {
        if (freqs[i] >= 4000 && freqs[i] <= 10000 && psd[i] > maxPsdInRange) {
            maxPsdInRange = psd[i];
            deesserFreq = freqs[i];
        }
    }

    return {
        index,
        harshRatio,
        deesserFreq: Math.round(deesserFreq),
        sibilantPercent: totalFrames > 0 ? (sibilantPeaks / totalFrames * 100) : 0,
        sibilantPeaks,
        totalFrames
    };
}
