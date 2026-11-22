/* global Vision */
'use strict';

let detector;
let fileset;
let delegate;
let numHands = 1;
let lastTimestamp = -1;

async function openDetector(requestedDelegate) {
  detector?.close();
  detector = null;
  const options = {
    baseOptions: {
      modelAssetPath: new URL('models/hand_landmarker.task', self.location.href).href,
      delegate: requestedDelegate,
    },
    runningMode: 'VIDEO',
    numHands,
    minHandDetectionConfidence: 0.42,
    minHandPresenceConfidence: 0.42,
    minTrackingConfidence: 0.38,
  };
  if (requestedDelegate === 'GPU' && typeof OffscreenCanvas === 'function') {
    options.canvas = new OffscreenCanvas(1, 1);
  }
  detector = await Vision.HandLandmarker.createFromOptions(fileset, options);
  // Compile the delegate's first-frame kernels while the HUD still shows loading.
  if (typeof OffscreenCanvas === 'function') {
    detector.detectForVideo(new OffscreenCanvas(320, 240), 0);
    lastTimestamp = 0;
  }
  delegate = requestedDelegate;
}

async function configure(requestedDelegate, requestedHands, requestId) {
  numHands = requestedHands === 2 ? 2 : 1;
  if (!fileset) {
    importScripts('./vision_bundle.js');
    fileset = await Vision.FilesetResolver.forVisionTasks(new URL('wasm', self.location.href).href, false);
  }
  try {
    await openDetector(requestedDelegate === 'CPU' ? 'CPU' : 'GPU');
  } catch (error) {
    if (requestedDelegate === 'CPU') throw error;
    await openDetector('CPU');
  }
  self.postMessage({ type: 'ready', delegate, numHands, requestId });
}

let configuring = false;
self.onmessage = async ({ data }) => {
  const frame = data.bitmap;
  try {
    if (data.type === 'init' || data.type === 'configure') {
      configuring = true;
      try {
        await configure(data.delegate ?? delegate, data.numHands, data.requestId);
      } finally {
        configuring = false;
      }
      return;
    }
    if (data.type !== 'frame' || !frame || !detector || configuring) return;
    const timestamp = Math.max(lastTimestamp + 1, Math.round(data.timestampMs));
    lastTimestamp = timestamp;
    const started = performance.now();
    let result;
    try {
      result = detector.detectForVideo(frame, timestamp);
    } catch (error) {
      if (delegate !== 'GPU') throw error;
      await openDetector('CPU');
      result = detector.detectForVideo(frame, timestamp);
    }
    lastTimestamp = timestamp;
    const hands = result.landmarks.map((landmarks, index) => ({
      landmarks,
      worldLandmarks: result.worldLandmarks[index] ?? null,
      handedness: result.handedness[index]?.[0]?.categoryName ?? null,
      handednessScore: result.handedness[index]?.[0]?.score ?? null,
    }));
    self.postMessage({
      type: 'result',
      frameId: data.frameId,
      generation: data.generation,
      timestampMs: data.timestampMs,
      inferenceMs: performance.now() - started,
      delegate,
      sample: {
        width: frame.width,
        height: frame.height,
        hands,
        landmarks: hands[0]?.landmarks ?? null,
        worldLandmarks: hands[0]?.worldLandmarks ?? null,
        handedness: hands[0]?.handedness ?? null,
      },
    });
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error?.message ?? error) });
  } finally {
    frame?.close();
  }
};
