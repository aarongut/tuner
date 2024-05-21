"use strict";

const NOTE_NAMES = [
  "A",
  "A#",
  "B",
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
];

// We don't care about fundamentals above 4kHz, so setting a lower sample rate
// gives us finer-grained FFT buckets
const TARGET_SAMPLE_RATE = 8000;

// 2 minute screen timeout
const TIMEOUT = 120;

let dom_frequency;
let dom_rate;
let dom_note;
let dom_tune;

const setup = () => {
  document.body.onclick = undefined;
  dom_frequency = document.getElementById("frequency");
  dom_rate = document.getElementById("rate");
  dom_note = document.getElementById("note");
  dom_tune = document.getElementById("tune");

  dom_note.innerHTML = "Listening...";

  if (navigator?.mediaDevices?.getUserMedia) {
    navigator.mediaDevices
      .getUserMedia({
        audio: true,
      })
      .then(handleStream, (err) => {
        console.error("Error calling getUserMedia", err);
      })
      .then(aquireWakeLock);
  }
};

const aquireWakeLock = ({ interval, stream }) => {
  if (navigator?.wakeLock?.request) {
    try {
      navigator.wakeLock.request("screen").then(
        (wakeLock) =>
          setTimeout(() => {
            clearInterval(interval);
            wakeLock.release();
            stream.getTracks().forEach((track) => track.stop());
            dom_note.innerHTML = "Tap to Start";
            document.body.onclick = setup;
            dom_tune.innerHTML = "";
            dom_frequency.innerHTML = "";
          }, TIMEOUT * 1000),
        (err) => console.error("Error requesting wakeLock", err)
      );
    } catch (err) {}
  }
};

const handleStream = (stream) => {
  const audioContext = new AudioContext({
    sampleRate: TARGET_SAMPLE_RATE,
  });

  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 32768;
  analyser.minDecibels = -90;
  analyser.maxDecibels = -10;
  analyser.smoothingTimeConstant = 0;
  const bufferLength = analyser.frequencyBinCount;
  const data = new Uint8Array(bufferLength);

  const source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);

  const interval = setInterval(tune(analyser, data), 500);

  return { interval, stream };
};

const tune = (analyser, data) => () => {
  analyser.getByteFrequencyData(data);

  const rate = analyser.context.sampleRate;
  dom_rate.innerText = rate / 1000;

  const bucketWidth = rate / analyser.fftSize;
  let max = 0;
  let maxBucket = -1;

  data.forEach((value, bucket) => {
    let j = 2;
    let product = value;
    while (bucket > 1 && j * bucket < data.length && j < 8) {
      product *= data[j * bucket];
      j += 1;
    }
    const geoMean = Math.pow(product, 1 / (j - 1));

    if (geoMean > max) {
      max = geoMean;
      maxBucket = bucket;
    }
  });

  if (maxBucket === -1) {
    return;
  }

  const frequency = maxBucket * bucketWidth;
  dom_frequency.innerText = `${Number.parseFloat(frequency).toFixed(2)} Hz`;

  const semitones = frequencyToSemitones(frequency);
  const margin = frequencyToSemitones(frequency + bucketWidth / 2) - semitones;

  dom_note.innerText = semitonesToNote(semitones);
  dom_tune.innerText = errorPercentage(semitones, margin);
  document.body.className = semitonesToClassname(semitones, margin);
};

const frequencyToSemitones = (frequency) =>
  12 * Math.log2(frequency / 440) + 69;

const semitonesToNote = (semitones) => {
  const rounded = Math.round(semitones - 69);

  const index = rounded >= 0 ? rounded % 12 : (12 + (rounded % 12)) % 12;

  return NOTE_NAMES[index];
};

const errorPercentage = (semitones, margin) => {
  const rounded = Math.round(semitones);

  const cents = Math.round((semitones - rounded) * 100);
  const accuracy = Number.parseFloat(margin * 100).toFixed(1);
  const sign = cents > 0 ? "+" : "";

  return `${sign}${cents} cents ± ${accuracy}`;
};

const semitonesToClassname = (semitones, margin) => {
  const rounded = Math.round(semitones);
  const error = Math.abs(semitones - rounded);

  const ok = margin > 0.05 ? margin : 0.05;

  if (error <= ok) {
    return "";
  }

  return Math.round(semitones) > semitones ? "flat" : "sharp";
};
