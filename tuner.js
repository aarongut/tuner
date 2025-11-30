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
const TIMEOUT = 120; // 2-minute screen timeout
const NOISE_THRESHOLD = -60; // dBFS threshold for valid pitch detection
const SMOOTHING_FACTOR = 0.8; // Smoothing factor for frequency stability
const MAX_HISTORY = 5; // Moving median filter window size

let dom_frequency, dom_rate, dom_note, dom_tune;
let lastFrequency = null;
const history = [];

let wakeLock = null;

const setup = () => {
  document.body.onclick = undefined;
  dom_frequency = document.getElementById("frequency");
  dom_rate = document.getElementById("rate");
  dom_note = document.getElementById("note");
  dom_tune = document.getElementById("tune");

  dom_note.innerHTML = "Listening...";

  if (navigator?.mediaDevices?.getUserMedia) {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(handleStream)
      .then(aquireWakeLock)
      .catch((err) => console.error("Error getting user media:", err));
  }
};

// Function to request wake lock
const requestWakeLock = async () => {
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () =>
      console.log("Wake Lock released")
    );
  } catch (err) {
    console.error("Failed to acquire wake lock:", err);
  }
};

// Function to acquire wake lock and re-request if lost
const aquireWakeLock = async ({ interval, stream }) => {
  if (navigator?.wakeLock?.request) {
    await requestWakeLock();

    document.addEventListener("visibilitychange", async () => {
      if (wakeLock !== null && document.visibilityState === "visible") {
        await requestWakeLock();
      }
    });

    setTimeout(() => {
      clearInterval(interval);
      if (wakeLock) wakeLock.release();
      stream.getTracks().forEach((track) => track.stop());
      dom_note.innerHTML = "Tap to Start";
      document.body.onclick = setup;
      dom_tune.innerHTML = "";
      dom_frequency.innerHTML = "";
    }, TIMEOUT * 1000);
  }
};

// Handle incoming audio stream
const handleStream = (stream) => {
  const audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
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

// Tuning function
const tune = (analyser, data) => () => {
  analyser.getByteFrequencyData(data);
  const rate = analyser.context.sampleRate;
  dom_rate.innerText = rate / 1000;

  const bucketWidth = rate / analyser.fftSize;
  let max = 0;
  let maxBucket = -1;

  // Use harmonic sum instead of product for better fundamental detection
  data.forEach((value, bucket) => {
    let sum = value;
    for (let j = 2; j < 8 && j * bucket < data.length; j++) {
      sum += data[j * bucket]; // Sum harmonics instead of multiplying
    }

    if (sum > max) {
      max = sum;
      maxBucket = bucket;
    }
  });

  if (maxBucket === -1) return;

  // Ignore weak signals (noise threshold)
  let maxDb = 20 * Math.log10(max);
  if (maxDb < NOISE_THRESHOLD) return;

  // Quadratic Peak Interpolation
  let delta = 0;
  if (maxBucket > 0 && maxBucket < data.length - 1) {
    let left = data[maxBucket - 1];
    let center = data[maxBucket];
    let right = data[maxBucket + 1];

    delta = (0.5 * (right - left)) / (2 * center - left - right);
  }

  let frequency = (maxBucket + delta) * bucketWidth;

  // Apply exponential smoothing
  if (lastFrequency !== null) {
    frequency =
      SMOOTHING_FACTOR * lastFrequency + (1 - SMOOTHING_FACTOR) * frequency;
  }
  lastFrequency = frequency;

  // Moving Median Filter
  history.push(frequency);
  if (history.length > MAX_HISTORY) {
    history.shift();
  }
  frequency = history.slice().sort((a, b) => a - b)[
    Math.floor(history.length / 2)
  ];

  dom_frequency.innerText = `${Number.parseFloat(frequency).toFixed(2)} Hz`;

  const semitones = frequencyToSemitones(frequency);
  const margin = frequencyToSemitones(frequency + bucketWidth / 2) - semitones;

  dom_note.innerText = semitonesToNote(semitones);
  dom_tune.innerText = errorPercentage(semitones, margin);
  document.body.className = semitonesToClassname(semitones, margin);
};

// Converts frequency to MIDI semitone number
const frequencyToSemitones = (frequency) =>
  12 * Math.log2(frequency / 440) + 69;

// Converts semitones to a note name
const semitonesToNote = (semitones) => {
  let noteIndex = Math.round(semitones) % 12;
  if (noteIndex < 0) noteIndex += 12;
  return NOTE_NAMES[noteIndex];
};

// Calculates tuning error in cents
const errorPercentage = (semitones, margin) => {
  const rounded = Math.round(semitones);
  const cents = Math.round((semitones - rounded) * 100);
  const accuracy = Number.parseFloat(margin * 100).toFixed(1);
  const sign = cents > 0 ? "+" : "";
  return `${sign}${cents} cents ± ${accuracy}`;
};

// Determines if the note is flat or sharp
const semitonesToClassname = (semitones, margin) => {
  const rounded = Math.round(semitones);
  const error = Math.abs(semitones - rounded);
  const ok = margin > 0.05 ? margin : 0.05;
  if (error <= ok) return "";
  return Math.round(semitones) > semitones ? "flat" : "sharp";
};
