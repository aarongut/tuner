const NOTE_NAMES = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"]

const TIMESLICE_MS = 500;

// We don't care about fundamenatls above 4kHz, so setting a lower sample rate
// gives us finer-graned FFT buckets
const TARGET_SAMPLE_RATE = 8000;

let dom_frequency;
let dom_rate;
let dom_note;
let dom_tune;

const setup = () => {
  dom_frequency = document.getElementById("frequency");
  dom_rate = document.getElementById("rate");
  dom_note = document.getElementById("note");
  dom_tune = document.getElementById("tune");

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({
      audio: true,
    }).then(handleStream, err => {
      console.error("Error calling getUserMedia", err);
    });
  };
};

const handleStream = stream => {
  const audioContext = new AudioContext({
    sampleRate: TARGET_SAMPLE_RATE,
  });

  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 8192;
  analyser.minDecibels = -90;
  analyser.maxDecibels = -10;
  analyser.smoothingTimeConstant = 0.1;
  const bufferLength = analyser.frequencyBinCount;
  const data = new Uint8Array(bufferLength);

  const source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);

  setInterval(tune(analyser, data), 200);
};

const tune = (analyser, data) => () => {
  analyser.getByteFrequencyData(data);

  const rate = analyser.context.sampleRate;
  dom_rate.innerText = rate / 1000;

  const bucketWidth = rate / analyser.fftSize;
  let max = 0;
  let maxBucket = -1;



  data.forEach((value, bucket) => {
    if (value > max) {
      max = value;
      maxBucket = bucket;
    }
  });

  const frequency = maxBucket * bucketWidth;
  dom_frequency.innerText = `${frequency} Hz`;

  const semitones = frequencyToSemitones(frequency);
  dom_note.innerText = semitonesToNote(semitones);
  dom_tune.innerText = errorPercentage(semitones);
  document.body.className = semitonesToClassname(semitones);
};

const frequencyToSemitones = frequency =>
  12 * Math.log2(frequency / 440) + 69;

const semitonesToNote = semitones => {
  const rounded = Math.round(semitones - 69);

  const index = rounded >= 0
    ? rounded % 12
    : (12 + (rounded % 12)) % 12

  return NOTE_NAMES[index];
}

const errorPercentage = semitones => {
  const rounded = Math.round(semitones);

  return Math.round((semitones - rounded ) * 100) + "%";
}

const semitonesToClassname = semitones => {
  const rounded = Math.round(semitones);
  const error = Math.abs(semitones-rounded);

  if (error <= 0.05) {
    return "";
  }

  return Math.round(semitones) > semitones
    ? "flat"
    : "sharp";
}

