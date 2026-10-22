// Dunne laag om MediaRecorder: kiest een formaat dat de browser kan, houdt de
// opnametijd bij zonder de pauzes mee te tellen, en geeft elk stukje audio
// meteen door zodat het bewaard kan worden voordat de opname af is.

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2', // Safari
  'audio/mp4',
  'audio/webm',
];

// Spraak is met 32 kbit/s Opus goed verstaanbaar; tien minuten is dan zo'n 2,4 MB.
const BITS_PER_SECOND = 32_000;
const CHUNK_MS = 1_000;

export type RecorderState = 'inactive' | 'recording' | 'paused';

export class RecorderError extends Error {
  readonly code: 'unsupported' | 'insecure' | 'denied' | 'no-device' | 'failed';
  constructor(code: RecorderError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

export class Recorder {
  onChunk: (chunk: Blob) => void = () => {};
  /** De microfoon viel weg (losgekoppeld, toestemming ingetrokken) zonder dat wij stopten. */
  onInterrupted: () => void = () => {};

  private stream: MediaStream | null = null;
  private media: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuffer: Uint8Array<ArrayBuffer> | null = null;
  private accumulatedMs = 0;
  private segmentStart = 0;
  private stopped: Promise<void> | null = null;
  mimeType = '';

  get state(): RecorderState {
    return this.media?.state ?? 'inactive';
  }

  /** Opnametijd in ms, pauzes niet meegeteld. */
  elapsedMs(): number {
    const running = this.state === 'recording' ? performance.now() - this.segmentStart : 0;
    return Math.round(this.accumulatedMs + running);
  }

  async start(): Promise<void> {
    if (!window.isSecureContext) {
      throw new RecorderError('insecure', 'Opnemen kan alleen via https.');
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new RecorderError('unsupported', 'Deze browser kan geen audio opnemen.');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new RecorderError('denied', 'Geen toegang tot de microfoon. Sta die toe in de adresbalk en probeer het opnieuw.');
      }
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        throw new RecorderError('no-device', 'Er is geen microfoon gevonden.');
      }
      throw new RecorderError('failed', 'De microfoon kon niet worden gestart.');
    }

    const preferred = pickMimeType();
    const options: MediaRecorderOptions = { audioBitsPerSecond: BITS_PER_SECOND };
    if (preferred) options.mimeType = preferred;
    const media = new MediaRecorder(this.stream, options);
    this.media = media;
    this.mimeType = media.mimeType || preferred || 'audio/webm';

    this.stopped = new Promise((resolve) => media.addEventListener('stop', () => resolve(), { once: true }));
    media.addEventListener('dataavailable', (e) => {
      if (e.data.size > 0) this.onChunk(e.data);
    });
    for (const track of this.stream.getAudioTracks()) {
      track.addEventListener('ended', () => this.onInterrupted(), { once: true });
    }
    media.addEventListener('error', () => this.onInterrupted(), { once: true });
    media.start(CHUNK_MS);
    this.accumulatedMs = 0;
    this.segmentStart = performance.now();
    this.startLevelMeter(this.stream);
  }

  pause(): void {
    if (this.state !== 'recording') return;
    this.media!.pause();
    this.accumulatedMs += performance.now() - this.segmentStart;
    // Ook het spoor zelf uit: wat je in een pauze zegt, hoort niet in de opname.
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = false));
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = true));
    this.media!.resume();
    this.segmentStart = performance.now();
  }

  /** Stopt de opname en geeft de microfoon vrij. Wacht tot het laatste stukje binnen is. */
  async stop(): Promise<void> {
    if (!this.media) return;
    if (this.state === 'recording') this.accumulatedMs += performance.now() - this.segmentStart;
    if (this.state !== 'inactive') this.media.stop();
    await this.stopped;
    this.release();
  }

  /** Niveau 0..1 voor de VU-meter. */
  level(): number {
    if (!this.analyser || !this.levelBuffer || this.state !== 'recording') return 0;
    this.analyser.getByteTimeDomainData(this.levelBuffer);
    let peak = 0;
    for (const v of this.levelBuffer) peak = Math.max(peak, Math.abs(v - 128));
    return Math.min(1, peak / 64);
  }

  release(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.audioContext?.close().catch(() => {});
    this.audioContext = null;
    this.analyser = null;
  }

  private startLevelMeter(stream: MediaStream): void {
    try {
      this.audioContext = new AudioContext();
      // Ontstaat na de await op de microfoon, buiten de klik; Safari start hem dan gepauzeerd.
      void this.audioContext.resume().catch(() => {});
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.levelBuffer = new Uint8Array(this.analyser.fftSize);
      // Bewust niet naar destination: anders hoor je jezelf terug.
      source.connect(this.analyser);
    } catch {
      // Zonder meter kan het ook.
      this.analyser = null;
    }
  }
}
