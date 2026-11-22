import { GestureSolver } from './GestureMath.js';

const cameraConstraints = {
  audio: false,
  video: {
    width: { ideal: 480, max: 640 },
    height: { ideal: 360, max: 480 },
    frameRate: { ideal: 30, max: 30 },
  },
};

const frameIntervalMs = 1000 / 30;
const numHands = 2;

function cameraErrorMessage(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError': return '摄像头权限未开启，已切回键鼠。';
    case 'NotFoundError': return '未检测到摄像头，已切回键鼠。';
    case 'NotReadableError':
    case 'AbortError': return '摄像头被占用或已断开，已切回键鼠。';
    default: return '无法启动摄像头，已切回键鼠。';
  }
}

export class HandGestureController {
  constructor({ onStateChange = null, delegate = 'GPU' } = {}) {
    this.onStateChange = onStateChange;
    this.delegate = delegate;
    this.solver = new GestureSolver();
    this.sessionId = 0;
    this.generation = 0;
    this.nextFrameId = 0;
    this.configureId = 0;
    this.telemetry = new Array(300);
    this.telemetryCount = 0;
    this.suspended = false;
    this.phase = 'OFF';
  }

  setPhase(phase, errorMessage = null) {
    this.phase = phase;
    this.status = this.solver.publish(phase, { errorMessage });
    this.onStateChange?.(this.status);
  }

  async enable(videoEl) {
    this.disable();
    this.video = videoEl;
    this.setPhase('LOADING');
    if (!videoEl || !globalThis.navigator?.mediaDevices?.getUserMedia) {
      this.fail('摄像头接口不可用，已切回键鼠。');
      return false;
    }
    return this.openCamera(this.sessionId, videoEl);
  }

  async openCamera(sessionId, videoEl) {
    this.openingCamera = true;
    try {
      let stream;
      for (;;) {
        const generation = this.generation;
        stream = await navigator.mediaDevices.getUserMedia(cameraConstraints);
        if (sessionId === this.sessionId && generation === this.generation) break;
        for (const track of stream.getTracks()) track.stop();
        if (sessionId !== this.sessionId) return false;
        if (this.suspended) return true; // Reopen once the game resumes.
      }
      this.stream = stream;
      this.track = stream.getVideoTracks()[0];
      if (!this.track || this.track.readyState === 'ended') {
        this.fail('未检测到摄像头，已切回键鼠。');
        return false;
      }
      this.track.onended = () => this.fail('摄像头已断开，已切回键鼠。');
      videoEl.srcObject = stream;
      await videoEl.play();
    } catch (error) {
      if (sessionId === this.sessionId) this.fail(cameraErrorMessage(error));
      return false;
    } finally {
      if (sessionId === this.sessionId) this.openingCamera = false;
    }
    if (sessionId !== this.sessionId) return false;
    try {
      const workerUrl = new URL('./mediapipe/hand.worker.js', document.baseURI);
      const worker = new Worker(workerUrl, { type: 'classic' });
      this.worker = worker;
      worker.onerror = (event) => {
        if (this.worker !== worker) return;
        event.preventDefault();
        this.fail('手势识别模型无法运行，已切回键鼠。');
      };
      worker.onmessage = ({ data }) => {
        if (this.worker === worker) this.onWorkerMessage(data);
      };
      worker.onmessageerror = () => {
        if (this.worker === worker) this.fail('手势识别数据异常，已切回键鼠。');
      };
      this.configureWorker('init');
      return true;
    } catch {
      this.fail('手势识别模型无法加载，已切回键鼠。');
      return false;
    }
  }

  onWorkerMessage(data) {
    if (data.type === 'ready') {
      clearTimeout(this.loadTimeout);
      if (data.requestId !== this.configureId || data.numHands !== numHands) return;
      this.setPhase('READY');
      this.scheduleFrame();
      return;
    }
    if (data.type === 'error') {
      this.fail('手势识别发生错误，已切回键鼠。');
      return;
    }
    if (data.type !== 'result' || this.inFlight !== data.frameId) return;
    clearTimeout(this.frameTimeout);
    this.inFlight = null;
    this.hasWorkerResult = true;
    if (this.suspended || data.generation !== this.generation || document.hidden) return;
    const nowMs = performance.now();
    const maxResultAgeMs = Math.max(280, this.solver.config.lostMs + 60);
    if (nowMs - data.timestampMs < maxResultAgeMs) {
      this.lastAcceptedCaptureMs = data.timestampMs;
      this.lastObservationMs = nowMs;
      const snap = this.solver.update(data.sample, data.timestampMs, data.inferenceMs);
      this.recordTelemetry(snap);
    }
    this.dispatchLatestFrame(nowMs);
  }

  dispatchLatestFrame(nowMs) {
    const frameMs = this.latestVideoMs;
    if (this.suspended || this.inFlight !== null || document.hidden
      || !Number.isFinite(frameMs) || nowMs - frameMs > 120
      || frameMs - this.lastCaptureMs < frameIntervalMs - 0.5) return;
    this.lastCaptureMs = frameMs;
    void this.captureFrame(this.video, frameMs, this.generation);
  }

  scheduleFrame() {
    if (this.phase !== 'READY' || this.suspended || this.frameCallback !== undefined) return;
    const video = this.video;
    const session = this.sessionId;
    const generation = this.generation;
    const tick = (nowMs) => {
      if (session !== this.sessionId || generation !== this.generation) return;
      this.frameCallback = undefined;
      this.scheduleFrame();
      if (document.hidden || video.readyState < 2) return;
      if (!this.usesVideoFrameCallback && video.currentTime === this.lastVideoTime) return;
      this.lastVideoTime = video.currentTime;
      this.latestVideoMs = nowMs;
      this.dispatchLatestFrame(nowMs);
    };
    this.usesVideoFrameCallback = typeof video.requestVideoFrameCallback === 'function';
    this.frameCallback = this.usesVideoFrameCallback
      ? video.requestVideoFrameCallback(tick)
      : setTimeout(() => tick(performance.now()), frameIntervalMs);
  }

  cancelFrame() {
    this.latestVideoMs = undefined;
    this.lastVideoTime = undefined;
    this.lastAcceptedCaptureMs = undefined;
    this.lastObservationMs = undefined;
    if (this.frameCallback === undefined) return;
    if (this.usesVideoFrameCallback) {
      this.video?.cancelVideoFrameCallback?.(this.frameCallback);
    } else {
      clearTimeout(this.frameCallback);
    }
    this.frameCallback = undefined;
  }

  async captureFrame(video, timestampMs, generation) {
    const frameId = ++this.nextFrameId;
    const worker = this.worker;
    this.inFlight = frameId;
    let bitmap;
    try {
      bitmap = await createImageBitmap(video);
      if (worker !== this.worker || this.suspended || generation !== this.generation || document.hidden) return;
      worker.postMessage({ type: 'frame', bitmap, frameId, generation, timestampMs }, [bitmap]);
      bitmap = null;
      this.frameTimeout = setTimeout(() => {
        if (worker === this.worker && this.inFlight === frameId) {
          this.fail('手势识别超时，已切回键鼠。');
        }
      }, this.hasWorkerResult ? 4_000 : 12_000);
    } catch {
      if (worker === this.worker && generation === this.generation) {
        this.fail('无法读取摄像头画面，已切回键鼠。');
      }
    } finally {
      // Transferred bitmaps are closed in the Worker.
      if (bitmap) bitmap.close();
      if (this.inFlight === frameId && (bitmap || generation !== this.generation)) this.inFlight = null;
    }
  }

  stopSession() {
    this.sessionId++;
    this.generation++;
    this.cancelFrame();
    clearTimeout(this.loadTimeout);
    clearTimeout(this.frameTimeout);
    this.worker?.terminate();
    this.worker = null;
    if (this.track) this.track.onended = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    if (this.video) this.video.srcObject = null;
    this.stream = null;
    this.track = null;
    this.video = null;
    this.openingCamera = false;
    this.inFlight = null;
    this.hasWorkerResult = false;
    this.lastCaptureMs = -Infinity;
    this.solver.reset();
    this.telemetryCount = 0;
  }

  fail(message) {
    this.stopSession();
    this.setPhase('ERROR', message);
  }

  disable() {
    this.stopSession();
    if (this.phase !== 'OFF') this.setPhase('OFF');
    else this.status = this.solver.publish('OFF');
  }

  setSuspended(suspended) {
    if (this.suspended === suspended) return;
    this.suspended = suspended;
    this.generation++;
    this.cancelFrame();
    this.solver.interrupt();
    if (!suspended && this.phase === 'LOADING' && this.video && !this.stream && !this.openingCamera) {
      void this.openCamera(this.sessionId, this.video);
    } else if (!suspended) {
      this.scheduleFrame();
    }
  }

  recalibrate() {
    this.generation++;
    this.cancelFrame();
    this.solver.reset();
    this.scheduleFrame();
  }

  configureWorker(type) {
    clearTimeout(this.loadTimeout);
    const worker = this.worker;
    this.loadTimeout = setTimeout(() => {
      if (this.worker === worker && this.phase === 'LOADING') {
        this.fail('手势识别模型加载超时，已切回键鼠。');
      }
    }, 20_000);
    worker.postMessage({ type, delegate: type === 'init' ? this.delegate : undefined,
      numHands, requestId: ++this.configureId });
  }

  setFlightHand(hand) {
    if (!this.solver.setFlightHand(hand)) return;
    this.generation++;
    this.cancelFrame();
    this.scheduleFrame();
  }

  setContextMode(mode, { draftVersion = 0 } = {}) {
    if (!this.solver.setContextMode(mode, draftVersion)) return;
    this.generation++;
    this.cancelFrame();
    this.scheduleFrame();
  }

  setWarpTarget(targetId) {
    this.solver.setWarpTarget(targetId);
  }

  recordTelemetry(snapshot) {
    this.telemetry[this.telemetryCount++ % this.telemetry.length] = {
      t: snapshot.timestampMs,
      pose: snapshot.pose,
      boost: snapshot.boost,
      ...snapshot.debug,
    };
  }

  getTelemetry(limit = this.telemetry.length) {
    const count = Math.max(0, Math.min(this.telemetryCount, this.telemetry.length, Math.trunc(limit) || 0));
    return Array.from({ length: count }, (_, i) => ({ ...this.telemetry[(this.telemetryCount - count + i) % this.telemetry.length] }));
  }

  getSnapshot(nowMs = performance.now()) {
    if (this.phase !== 'READY') return this.status ?? this.solver.state;
    // Count missing observations separately from inference latency, but never
    // keep an input alive past the hard limit measured from camera capture.
    const captureMs = this.lastAcceptedCaptureMs;
    const observedMs = this.lastObservationMs;
    const observationClock = nowMs - captureMs < this.solver.config.lostMs
      ? captureMs + (nowMs - observedMs) : nowMs;
    return this.solver.snapshot(observationClock);
  }

  injectMockSample(sample, nowMs = performance.now()) {
    if (this.suspended || this.phase !== 'READY') return this.getSnapshot(nowMs);
    const snap = this.solver.update(sample, nowMs);
    this.recordTelemetry(snap);
    return snap;
  }
}
