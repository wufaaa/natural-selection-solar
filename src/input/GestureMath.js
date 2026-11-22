const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

export const DEFAULT_GESTURE_CONFIG = Object.freeze({
  rangeX: 0.22,
  rangeY: 0.18,
  deadzone: 0.16,
  calibrationMs: 550,
  fireWatchdogMs: 140,
  lostMs: 240,
});

const fingers = [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]];

export class OneEuroFilter {
  constructor(minCutoff, beta, derivativeCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.derivativeCutoff = derivativeCutoff;
    this.reset();
  }

  reset() {
    this.time = null;
    this.derivative = 0;
  }

  update(value, nowMs) {
    if (this.time === null) {
      this.time = nowMs;
      this.raw = value;
      this.filtered = value;
      return value;
    }
    if (nowMs <= this.time) return this.filtered;
    const dt = (nowMs - this.time) / 1000;
    const alpha = (hz) => 1 / (1 + 1 / (2 * Math.PI * hz * dt));
    const velocity = (value - this.raw) / dt;
    this.derivative += alpha(this.derivativeCutoff) * (velocity - this.derivative);
    this.filtered += alpha(this.minCutoff + this.beta * Math.abs(this.derivative)) * (value - this.filtered);
    this.time = nowMs;
    this.raw = value;
    return this.filtered;
  }
}


const lengthGroups = [
  [[0, 5], [0, 9], [0, 17]],
  [[5, 17], [5, 13], [9, 17]],
];
const poseByFinger = [null, 'FINGER_1', 'FINGER_2', 'FINGER_3'];
const weaponHoldMs = { FINGER_1: 85, FINGER_2: 100, FINGER_3: 115 };
const recognitionGraceMs = 45;
const warpHoldMs = 450;
const warpGraceMs = 60;
const rollHoldMs = 85;
const rad = Math.PI / 180;
const zeroInput = { aimX: 0, aimY: 0, throttle: 0, boost: false, firePrimary: false, fireSecondary: false };
const zeroEvents = { missiles: 0, emp: 0, warp: 0, dodgeLeft: 0, dodgeRight: 0 };
const median = (a, b, c) => a + b + c - Math.min(a, b, c) - Math.max(a, b, c);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const anchorDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function normalize(vector) {
  const length = Math.hypot(...vector);
  return length > 1e-6 ? vector.map((value) => value / length) : null;
}

function orthonormalBasis(alongVec, acrossVec) {
  const along = normalize(alongVec);
  if (!along) return null;
  const projection = acrossVec[0] * along[0] + acrossVec[1] * along[1] + acrossVec[2] * along[2];
  const across = normalize([
    acrossVec[0] - projection * along[0],
    acrossVec[1] - projection * along[1],
    acrossVec[2] - projection * along[2],
  ]);
  if (!across) return null;
  return {
    along,
    across,
    normal: [
      along[1] * across[2] - along[2] * across[1],
      along[2] * across[0] - along[0] * across[2],
      along[0] * across[1] - along[1] * across[0],
    ],
  };
}

function palmBasis(world) {
  if (!world) return null;
  // Mirrored player world coordinates: +X screen right (-w.x), +Y screen up (-w.y), +Z toward user (+w.z)
  const mirrorDelta = (a, b) => [a.x - b.x, a.y - b.y, b.z - a.z];
  const knuckleMid = {
    x: 0.5 * world[9].x + 0.25 * (world[5].x + world[17].x),
    y: 0.5 * world[9].y + 0.25 * (world[5].y + world[17].y),
    z: 0.5 * world[9].z + 0.25 * (world[5].z + world[17].z),
  };
  return orthonormalBasis(mirrorDelta(world[0], knuckleMid), mirrorDelta(world[5], world[17]));
}

function angleDelta(angle, baseline) {
  const delta = angle - baseline;
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}

function elevation(vector) {
  return Math.atan2(vector[2], Math.hypot(vector[0], vector[1]));
}

function palmSteer(hand, neutral, { pointMode = false } = {}) {
  const baseTilt = clamp(neutral.tiltX ?? 0, -12 * rad, 12 * rad);
  const tiltDelta = angleDelta(hand.tiltX, baseTilt);
  const pointDelta = angleDelta(hand.pointTiltX, baseTilt);
  let steerX = pointMode ? pointDelta : tiltDelta;
  if (!hand.basis || !neutral.basis) {
    return { steerX, pitch: 0, yaw: 0, roll: -steerX, spatial: false };
  }
  const p = hand.basis.along;
  const p0 = neutral.basis.along;
  const pRefPitch = clamp(neutral.refPitch ?? elevation(p0), -24 * rad, 24 * rad);
  const palmPitch = angleDelta(elevation(p), pRefPitch);
  let pitch = palmPitch;
  if (pointMode && hand.pointAlong) {
    const fp = hand.pointAlong;
    const fRefPitch = clamp(neutral.fingerRefPitch ?? pRefPitch, -24 * rad, 24 * rad);
    const fingerPitch = angleDelta(elevation(fp), fRefPitch);
    pitch = 0.70 * fingerPitch + 0.30 * palmPitch;
  } else if (!pointMode && hand.gripTightness < 0.20 && hand.fingerAlong) {
    const fp = hand.fingerAlong;
    const fRefPitch = clamp(neutral.fingerRefPitch ?? pRefPitch, -24 * rad, 24 * rad);
    const openFingerPitch = angleDelta(elevation(fp), fRefPitch);
    const weight = 0.55 * clamp((0.20 - hand.gripTightness) / 0.12);
    pitch = weight * openFingerPitch + (1 - weight) * palmPitch;
  }
  const down2D = pointMode ? hand.pointDownPitch2D : hand.downPitch2D;
  if (down2D < 0) pitch = Math.min(pitch, down2D);

  const hCols = [hand.basis.along, hand.basis.across, hand.basis.normal];
  const nCols = [neutral.basis.along, neutral.basis.across, neutral.basis.normal];
  const rel = (i, j) => hCols[0][i] * nCols[0][j] + hCols[1][i] * nCols[1][j] + hCols[2][i] * nCols[2][j];
  const yawLeft = Math.atan2(rel(2, 0) - rel(0, 2), rel(0, 0) + rel(2, 2));
  const rollLeft = Math.atan2(rel(1, 0) - rel(0, 1), rel(0, 0) + rel(1, 1));
  const yaw = -yawLeft;
  if (!pointMode && hand.openBlend < 0.65 && hand.facing >= 0.45) {
    const yawMag = Math.abs(yaw);
    const fistYaw = yawMag > 10 * rad ? Math.sign(yaw) * clamp((yawMag - 10 * rad) * 0.92, 0, 20 * rad) : 0;
    const fistWeight = clamp((0.65 - hand.openBlend) / 0.45);
    steerX += fistYaw * fistWeight;
  }
  return {
    steerX,
    pitch,
    yaw,
    roll: -rollLeft,
    spatial: true,
  };
}

function validLandmarks(points) {
  return Array.isArray(points) && points.length === 21
    && points.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
}

function readHand(sample, aspect, nowMs) {
  if (!validLandmarks(sample?.landmarks)) return null;
  const points = sample.landmarks;
  const mirrored = points.map(({ x, y, z }) => ({ x: 1 - x, y, z }));
  const palm = (axis) => 0.4 * mirrored[0][axis] + 0.2 * (mirrored[5][axis] + mirrored[9][axis] + mirrored[17][axis]);
  const anchor = { x: palm('x'), y: palm('y') };
  if (anchor.x < 0 || anchor.x > 1 || anchor.y < 0 || anchor.y > 1) return null;

  const world = validLandmarks(sample.worldLandmarks) ? sample.worldLandmarks : null;
  const basis = palmBasis(world);
  const imageRoll = Math.atan2(-(mirrored[9].x - mirrored[0].x) * aspect, mirrored[0].y - mirrored[9].y);
  const curlPoints = world ?? points.map(({ x, y, z }) => ({ x: x * aspect, y, z: z * aspect }));
  const palmEdge = ([a, b]) => {
    const imageLength = Math.hypot((points[a].x - points[b].x) * aspect, points[a].y - points[b].y);
    if (!world) return imageLength;
    const xy = Math.hypot(world[a].x - world[b].x, world[a].y - world[b].y);
    const projected = xy / Math.max(distance(world[a], world[b]), 1e-6);
    return imageLength / clamp(projected, 0.48, 1);
  };
  const [medianHeight, width] = lengthGroups.map((group) => median(...group.map(palmEdge)));
  // The outside wrist edges are diagonal. Bound their contribution so a
  // sideways stretch cannot inflate the apparent wrist-to-knuckle length.
  const centerHeight = palmEdge(lengthGroups[0][1]);
  const height = clamp(medianHeight, centerHeight * 0.97, centerHeight * 1.03);
  if (height < 0.015 || width < 0.015 || height > 1 || width > 1) return null;

  let facing = 1;
  if (world) {
    const a = world[5], b = world[17], o = world[0];
    const ax = a.x - o.x, ay = a.y - o.y, az = a.z - o.z;
    const bx = b.x - o.x, by = b.y - o.y, bz = b.z - o.z;
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    facing = Math.abs(nz) / Math.max(Math.hypot(nx, ny, nz), 1e-9);
  }

  const wrist = curlPoints[0];
  const curls = fingers.map(([m, p, t]) => {
    const mcp = curlPoints[m], pip = curlPoints[p], tip = curlPoints[t];
    const ratio = distance(tip, wrist) / Math.max(distance(mcp, wrist), 1e-6);
    const dot = (mcp.x - pip.x) * (tip.x - pip.x) + (mcp.y - pip.y) * (tip.y - pip.y)
      + (mcp.z - pip.z) * (tip.z - pip.z);
    const cosine = dot / Math.max(distance(mcp, pip) * distance(tip, pip), 1e-8);
    return 0.55 * clamp((1.65 - ratio) / 0.53) + 0.45 * clamp((cosine + 0.75) / 0.95);
  });
  const curlScore = curls.reduce((sum, c) => sum + c, 0) / 4;
  const openFingers = curls.filter((c) => c <= 0.38).length;
  const palmBase = {
    x: 0.5 * curlPoints[0].x + 0.5 * curlPoints[9].x,
    y: 0.5 * curlPoints[0].y + 0.5 * curlPoints[9].y,
    z: 0.5 * curlPoints[0].z + 0.5 * curlPoints[9].z,
  };
  const palmRef = Math.max(distance(curlPoints[0], curlPoints[9]), 1e-6);
  const tightCurls = fingers.map(([m, p, t]) => {
    const mcp = curlPoints[m], pip = curlPoints[p], tip = curlPoints[t];
    const rWrist = distance(tip, wrist) / Math.max(distance(mcp, wrist), 1e-6);
    const sWrist = clamp((1.75 - rWrist) / (1.75 - 0.82));
    const rPalm = distance(tip, palmBase) / palmRef;
    const sPalm = clamp((1.35 - rPalm) / (1.35 - 0.42));
    const dot = (mcp.x - pip.x) * (tip.x - pip.x) + (mcp.y - pip.y) * (tip.y - pip.y)
      + (mcp.z - pip.z) * (tip.z - pip.z);
    const cos = dot / Math.max(distance(mcp, pip) * distance(tip, pip), 1e-8);
    const sBend = clamp((cos + 0.85) / (0.75 + 0.85));
    return 0.35 * sWrist + 0.35 * sPalm + 0.30 * sBend;
  });
  const gripTightness = tightCurls.reduce((sum, v) => sum + v, 0) / 4;
  const fingerWeights = [0.25, 0.45, 0.22, 0.08];
  let fdx = 0;
  let fdy = 0;
  fingers.forEach(([m, , t], index) => {
    const w = fingerWeights[index];
    const vx = (mirrored[t].x - mirrored[m].x) * aspect;
    const vy = mirrored[m].y - mirrored[t].y;
    const len = Math.hypot(vx, vy);
    if (len > 1e-4) {
      fdx += (vx / len) * w;
      fdy += (vy / len) * w;
    }
  });
  const fLen = Math.hypot(fdx, fdy);
  const fingerTiltX = Math.atan2(fdx, Math.max(0.02, fdy));
  const palmTopMir = {
    x: 0.5 * mirrored[9].x + 0.25 * (mirrored[5].x + mirrored[17].x),
    y: 0.5 * mirrored[9].y + 0.25 * (mirrored[5].y + mirrored[17].y),
  };
  const palmDx = (palmTopMir.x - mirrored[0].x) * aspect;
  const palmDy = mirrored[0].y - palmTopMir.y;
  const palmLen = Math.hypot(palmDx, palmDy);
  const pUx = palmLen > 1e-4 ? palmDx / palmLen : 0;
  const pUy = palmLen > 1e-4 ? palmDy / palmLen : 1;
  const kbDx = (mirrored[5].x - mirrored[17].x) * aspect;
  const kbDy = mirrored[17].y - mirrored[5].y;
  const kbLen = Math.hypot(kbDx, kbDy);
  let nUx = pUx;
  let nUy = pUy;
  if (kbLen > 1e-4) {
    let candX = -kbDy / kbLen;
    let candY = kbDx / kbLen;
    if (candX * pUx + candY * pUy < 0) {
      candX = -candX;
      candY = -candY;
    }
    nUx = candX;
    nUy = candY;
  }
  const nWeight = 0.28 * clamp((kbLen / Math.max(palmLen, 1e-4) - 0.55) / 0.45);
  const palmAxisX = nWeight * nUx + (1 - nWeight) * pUx;
  const palmAxisY = nWeight * nUy + (1 - nWeight) * pUy;
  const palmTiltX = Math.atan2(palmAxisX, Math.max(0.02, palmAxisY));
  const openBlend = clamp((0.56 - gripTightness) / 0.32);
  const tiltX = Math.atan2(
    Math.sin(palmTiltX) * (1 - openBlend) + Math.sin(fingerTiltX) * openBlend,
    Math.cos(palmTiltX) * (1 - openBlend) + Math.cos(fingerTiltX) * openBlend
  );
  const axisY = palmAxisY * (1 - openBlend) + (fLen > 1e-4 ? fdy / fLen : 1) * openBlend;
  const downPitch2D = axisY < -0.15 ? -clamp((-axisY - 0.15) / 0.70) * 32 * rad : 0;
  const pIdxDx = (mirrored[8].x - mirrored[5].x) * aspect;
  const pIdxDy = mirrored[5].y - mirrored[8].y;
  const pIdxLen = Math.hypot(pIdxDx, pIdxDy);
  const pDirY = pIdxLen > 1e-4 ? pIdxDy / pIdxLen : 1;
  const pointDownPitch2D = pDirY < -0.15 ? -clamp((-pDirY - 0.15) / 0.70) * 32 * rad : 0;
  const pointTiltX = Math.atan2(pIdxDx, Math.max(0.02, pIdxDy));
  const pointAlong = world ? normalize([world[5].x - world[8].x, world[5].y - world[8].y, world[8].z - world[5].z]) : null;
  let fingerAlong = null;
  if (world) {
    let ax = 0;
    let ay = 0;
    let az = 0;
    for (const [m, , t] of fingers) {
      ax += world[m].x - world[t].x;
      ay += world[m].y - world[t].y;
      az += world[t].z - world[m].z;
    }
    fingerAlong = normalize([ax, ay, az]);
  }
  const fistShape = curlScore >= 0.66 && curls.filter((c) => c >= 0.6).length >= 3;
  const pinch = distance(curlPoints[4], curlPoints[8])
    / Math.max(distance(wrist, curlPoints[9]), distance(curlPoints[5], curlPoints[17]), 1e-6);
  const pinchWarp = pinch <= 0.44 && curls[0] >= 0.20 && curls.slice(1).filter((value) => value <= 0.56).length >= 2;
  const dxMir = (mirrored[4].x - mirrored[2].x) * aspect;
  const dyMir = mirrored[4].y - mirrored[2].y;
  const thumbLength = Math.hypot(dxMir, dyMir);
  let thumbPose = null;
  if (curlScore >= 0.50 && curls.filter((value) => value >= 0.48).length >= 3 && thumbLength >= 0.38 * height) {
    const [base, tip, indexPip, middleRoot, middlePip] = [2, 4, 6, 9, 10].map((i) => curlPoints[i]);
    const palmLength = Math.max(distance(wrist, middleRoot), 1e-6);
    const clearOfFingers = distance(tip, indexPip) >= 0.32 * palmLength
      && distance(tip, middlePip) >= 0.35 * palmLength;
    const pointsAway = distance(tip, middleRoot) >= distance(base, middleRoot) + 0.08 * palmLength;
    if (clearOfFingers && pointsAway) {
      if (-dxMir >= 1.35 * Math.abs(dyMir)) thumbPose = 'THUMB_LEFT';
      else if (dxMir >= 1.35 * Math.abs(dyMir)) thumbPose = 'THUMB_RIGHT';
    }
  }
  const isPointRotate = curls[0] <= 0.44 && curls[1] >= 0.48 && curls[2] >= 0.48 && curls[3] >= 0.48
    && !thumbPose && !pinchWarp;
  let pose = pinchWarp ? 'PINCH' : 'TRANSITION';
  if (!pinchWarp) {
    for (let count = 1; count <= 3; count++) {
      const extended = curls.slice(0, count);
      const folded = curls.slice(count);
      if (extended.every((value, index) => value <= (index === 2 ? 0.48 : 0.42))
        && folded.every((value) => value >= (count === 3 ? 0.46 : 0.50))
        && Math.min(...folded) - Math.max(...extended) >= 0.16) {
        pose = poseByFinger[count];
        break;
      }
    }
  }
  if (pose === 'TRANSITION') {
    if (curlScore <= 0.32 && openFingers >= 3) pose = 'OPEN_PALM';
    else if (fistShape) pose = 'FIST';
  }
  const isFist = pose === 'FIST';
  const isOpen = pose === 'OPEN_PALM';
  return {
    timestampMs: nowMs, anchor, mirrored, width, height, facing, curlScore, gripTightness, tightCurls, openFingers, openBlend, curls, pose, thumbPose, pinchWarp,
    isPointRotate, tiltX, pointTiltX, downPitch2D, pointDownPitch2D, pointAlong, fingerAlong, basis, imageRoll,
    isOpen, isFist, release: Boolean(weaponHoldMs[pose]) || curlScore <= 0.44 || openFingers >= 2,
    label: typeof sample.handedness === 'string' ? sample.handedness.toLowerCase() : null,
    score: sample.handednessScore ?? 0,
  };
}

function fingerSpeed(hand, previous) {
  if (!previous) return 0;
  const elapsed = Math.max(16, hand.timestampMs - previous.timestampMs);
  return Math.max(...hand.curls.map((value, i) => Math.abs(value - previous.curls[i]))) * (1000 / 30) / elapsed;
}

function overlay(role, hand, firing = false, boosting = false) {
  const pose = role === 'FLIGHT'
    ? (hand.thumbPose ?? (hand.isPointRotate ? 'POINT_ROTATE' : (boosting ? 'FULL_FIST' : hand.pose)))
    : hand.pose;
  return { role, anchorMirrored: hand.anchor, landmarksMirrored: hand.mirrored, pose, firing, boosting };
}

export class GestureSolver {
  constructor(config = {}) {
    this.config = Object.freeze({ ...DEFAULT_GESTURE_CONFIG, ...config });
    this.x = new OneEuroFilter(4.5, 6.0, 2.0);
    this.y = new OneEuroFilter(4.5, 6.0, 2.0);
    this.depth = new OneEuroFilter(1.5, 3.5, 2.5);
    this.gripFilter = new OneEuroFilter(6.0, 5.0, 2.0);
    this.seq = 0;
    this.eventEpoch = 0;
    this.events = { ...zeroEvents };
    this.flightHand = 'LEFT';
    this.handMode = 'DUAL';
    this.contextMode = 'FLIGHT';
    this.draftVersion = 0;
    this.warpTarget = null;
    this.reset();
  }

  reset() {
    this.neutral = null;
    this.flightLabel = null;
    this.opsLabel = null;
    this.hasFlightRef = false;
    this.videoWidth = 0;
    this.videoHeight = 0;
    this.interrupt();
  }

  clearMotion() {
    this.motion = zeroInput;
    this.boost = false;
    this.boostReady = false;
    this.boostSince = null;
    this.boostSeenMs = -Infinity;
    this.boostSource = null;
    this.x.reset();
    this.y.reset();
    this.depth.reset();
    this.gripFilter.reset();
    this.depthHistory = [];
    this.rawDepth = 0;
    this.inputThrottle = 0;
    this.pointMode = false;
    this.pointModeSince = null;
    this.pointLostSince = null;
    this.openRestSince = null;
    this.steerAngles = { steerX: 0, pitch: 0 };
    this.gripBias = { steerX: 0, pitch: 0 };
    this.gripClosed = false;
    this.gripSettlesMs = -Infinity;
    this.gripCaptureDeferred = false;
    this.steeringWasRolling = false;
    this.rollSteerUntilMs = -Infinity;
    this.rollCandidate = null;
    this.rollLatched = false;
    this.rollReleasedMs = null;
    this.rollAtMs = -Infinity;
    this.lastRollPose = null;
  }

  clearOps() {
    this.armed = false;
    this.firing = false;
    this.fistSince = null;
    this.releaseSince = null;
    this.poseCandidate = null;
    this.poseSince = null;
    this.poseNoiseSince = null;
    this.secondaryFiring = false;
    this.committedPose = null;
    this.pulseArmSince = null;
    this.warpCharge = null;
    this.warpPinchLatched = false;
    this.warpReleasedMs = null;
    this.pick = null;
  }

  invalidateEvents() {
    this.eventEpoch++;
    this.warpTargetId = null;
  }

  interrupt() {
    this.lastFlight = null;
    this.lastOps = null;
    this.lastSampleMs = -Infinity;
    this.calibration = null;
    this.flightLost = false;
    this.flightCleared = false;
    this.opsLost = false;
    this.crossingGuard = false;
    this.upgradeCommitted = null;
    this.missileReadyMs = -Infinity;
    this.empReadyMs = -Infinity;
    this.warpReadyMs = -Infinity;
    this.rollReadyMs = -Infinity;
    this.clearMotion();
    this.clearOps();
    this.invalidateEvents();
    this.publish(this.neutral ? 'LOST' : 'CALIBRATING');
  }

  setFlightHand(hand) {
    if ((hand !== 'LEFT' && hand !== 'RIGHT') || hand === this.flightHand) return false;
    this.flightHand = hand;
    this.reset();
    return true;
  }

  setContextMode(mode, draftVersion) {
    if ((mode !== 'FLIGHT' && mode !== 'UPGRADE')
      || (this.contextMode === mode && this.draftVersion === draftVersion)) return false;
    this.contextMode = mode;
    this.draftVersion = draftVersion;
    this.interrupt();
    return true;
  }

  setWarpTarget(target) {
    if (target === this.warpTarget) return;
    this.warpTarget = target ?? null;
    if (this.warpCharge) this.warpPinchLatched = true;
    this.warpCharge = null;
  }

  publish(phase, data = {}) {
    this.state = Object.freeze({
      seq: ++this.seq,
      timestampMs: Number.isFinite(this.lastSampleMs) ? this.lastSampleMs : 0,
      phase,
      tracking: false,
      calibrated: Boolean(this.neutral),
      calibrationProgress: this.neutral ? 1 : 0,
      calibrationHint: null,
      actionHint: null,
      ...zeroInput,
      boostSource: null,
      requireOpenPalmToArm: !this.armed,
      errorMessage: null,
      videoWidth: this.videoWidth,
      videoHeight: this.videoHeight,
      anchorMirrored: null,
      neutralMirrored: this.neutral?.anchor ?? null,
      landmarksMirrored: null,
      config: this.config,
      handMode: this.handMode,
      flightHand: this.flightHand,
      contextMode: this.contextMode,
      draftVersion: this.draftVersion,
      pose: 'NONE',
      flightPose: 'NONE',
      eventEpoch: this.eventEpoch,
      events: { ...this.events },
      warpTargetId: this.warpTargetId,
      warpChargeProgress: 0,
      pendingGestureHint: null,
      flightStatus: { tracked: false, phase, boostReady: this.boostReady },
      opsStatus: { tracked: false, armed: this.armed, pose: 'NONE' },
      crossingGuard: this.crossingGuard,
      handsOverlay: [],
      upgradeSelection: { draftVersion: this.draftVersion, unlocked: this.armed,
        candidateIndex: null, holdProgress: 0, committedIndex: null },
      debug: null,
      logDepth: 0,
      curlScore: 0,
      skew: 0,
      ...data,
    });
    return this.state;
  }

  roleCost(hand, role, nowMs) {
    const flight = role === 'FLIGHT';
    const previous = flight ? this.lastFlight : this.lastOps;
    const previousOther = flight ? this.lastOps : this.lastFlight;
    const label = flight ? this.flightLabel : this.opsLabel;
    const opposite = flight ? this.opsLabel : this.flightLabel;
    const rightSide = flight === (this.flightHand === 'RIGHT');
    const side = rightSide ? hand.anchor.x >= 0.50 : hand.anchor.x < 0.50;
    const matchingLabel = label && hand.label === label && (hand.score >= 0.78 || (side && hand.score >= 0.52));
    if (hand.label && hand.score >= 0.85 && ((label && !matchingLabel) || hand.label === opposite)) return Infinity;
    if (previousOther && nowMs - previousOther.timestampMs < this.config.lostMs
      && anchorDistance(hand.anchor, previousOther.anchor) < 0.10
      && (!previous || anchorDistance(hand.anchor, previous.anchor) > 0.16)) return Infinity;
    if (previous && nowMs - previous.timestampMs < this.config.lostMs) {
      const delta = anchorDistance(hand.anchor, previous.anchor);
      if (delta <= 0.22) return delta + (matchingLabel ? 0 : 0.07);
      return Infinity;
    }
    if (matchingLabel) return 0.16;
    // Once a physical hand was identified, a low-confidence label does not replace it.
    return side && (!label || !hand.label) ? 0.28 : Infinity;
  }

  assignHands(hands, nowMs) {
    if (hands.length === 2 && anchorDistance(hands[0].anchor, hands[1].anchor) < 0.14) {
      return { flight: null, ops: null, crossing: true };
    }
    if (!this.hasFlightRef) {
      if (hands.length === 2) {
        const ordered = hands[0].anchor.x <= hands[1].anchor.x ? [hands[0], hands[1]] : [hands[1], hands[0]];
        const flight = this.flightHand === 'LEFT' ? ordered[0] : ordered[1];
        const ops = this.flightHand === 'LEFT' ? ordered[1] : ordered[0];
        this.hasFlightRef = true;
        return { flight, ops, crossing: false };
      }
      if (hands.length === 1) {
        const h = hands[0];
        const inZone = this.flightHand === 'LEFT' ? h.anchor.x <= 0.64 : h.anchor.x >= 0.36;
        const matchLabel = h.label === this.flightHand.toLowerCase() && h.score >= 0.55;
        if (inZone || matchLabel) {
          this.hasFlightRef = true;
          return { flight: h, ops: null, crossing: false };
        }
      }
      return { flight: null, ops: null, crossing: false };
    }

    if (hands.length === 2) {
      const [a, b] = hands;
      const direct = this.roleCost(a, 'FLIGHT', nowMs) + this.roleCost(b, 'OPS', nowMs);
      const reverse = this.roleCost(b, 'FLIGHT', nowMs) + this.roleCost(a, 'OPS', nowMs);
      if (Number.isFinite(Math.min(direct, reverse))) {
        if (Math.abs(direct - reverse) < 0.06) return { flight: null, ops: null, crossing: true };
        return direct < reverse ? { flight: a, ops: b, crossing: false } : { flight: b, ops: a, crossing: false };
      }
    }
    let flight = null, ops = null;
    for (const hand of hands) {
      const flightCost = this.roleCost(hand, 'FLIGHT', nowMs);
      const opsCost = this.roleCost(hand, 'OPS', nowMs);
      if (flightCost + 0.06 < opsCost && !flight) flight = hand;
      else if (opsCost + 0.06 < flightCost && !ops) ops = hand;
    }
    return { flight, ops, crossing: false };
  }

  calibrate(hand, nowMs) {
    const { anchor, height, width, facing } = hand;
    const isCalibOpen = hand.curlScore <= 0.44 && hand.openFingers >= 2;
    const safeAnchor = anchor.x >= 0.08 && anchor.x <= 0.92 && anchor.y >= 0.08 && anchor.y <= 0.92;
    const validGeom = isCalibOpen && safeAnchor && height >= 0.045 && height <= 0.50 && facing >= 0.42;
    const box = this.calibration;
    const meanAlong = box?.alongSum ? normalize(box.alongSum) : null;
    const alongDot = meanAlong && hand.basis
      ? meanAlong[0] * hand.basis.along[0] + meanAlong[1] * hand.basis.along[1] + meanAlong[2] * hand.basis.along[2]
      : 1;
    const boxTilt = box ? Math.atan2(box.tiltSinSum, box.tiltCosSum) : hand.tiltX;
    const boxRoll = box ? Math.atan2(box.rollSinSum, box.rollCosSum) : hand.imageRoll;
    const stable = box && anchorDistance(anchor, box.anchor) <= 0.065
      && Math.abs(height / box.height - 1) < 0.15 && Math.abs(width / box.width - 1) < 0.15
      && alongDot >= Math.cos(22 * rad)
      && Math.abs(angleDelta(hand.tiltX, boxTilt)) <= 24 * rad
      && Math.abs(angleDelta(hand.imageRoll, boxRoll)) <= 24 * rad;

    if (!validGeom || !stable) {
      if (box && nowMs - box.lastGoodMs <= 120) {
        return clamp((nowMs - box.since) / this.config.calibrationMs);
      }
      if (!validGeom) {
        this.calibration = null;
        return 0;
      }
      this.calibration = {
        since: nowMs,
        lastGoodMs: nowMs,
        anchor: { ...anchor },
        height,
        width,
        alongSum: hand.basis ? [...hand.basis.along] : null,
        acrossSum: hand.basis ? [...hand.basis.across] : null,
        fingerAlongSum: hand.fingerAlong ? [...hand.fingerAlong] : null,
        tiltSinSum: Math.sin(hand.tiltX),
        tiltCosSum: Math.cos(hand.tiltX),
        rollSinSum: Math.sin(hand.imageRoll),
        rollCosSum: Math.cos(hand.imageRoll),
        count: 1,
      };
      return 0;
    }

    const weight = 1 / ++box.count;
    box.lastGoodMs = nowMs;
    box.anchor.x += (anchor.x - box.anchor.x) * weight;
    box.anchor.y += (anchor.y - box.anchor.y) * weight;
    box.height += (height - box.height) * weight;
    box.width += (width - box.width) * weight;
    box.tiltSinSum += Math.sin(hand.tiltX);
    box.tiltCosSum += Math.cos(hand.tiltX);
    box.rollSinSum += Math.sin(hand.imageRoll);
    box.rollCosSum += Math.cos(hand.imageRoll);
    if (hand.basis) {
      if (box.alongSum && box.acrossSum) {
        for (let axis = 0; axis < 3; axis++) {
          box.alongSum[axis] += hand.basis.along[axis];
          box.acrossSum[axis] += hand.basis.across[axis];
        }
      } else {
        box.alongSum = [...hand.basis.along];
        box.acrossSum = [...hand.basis.across];
      }
    }
    if (hand.fingerAlong) {
      if (box.fingerAlongSum) {
        for (let axis = 0; axis < 3; axis++) {
          box.fingerAlongSum[axis] += hand.fingerAlong[axis];
        }
      } else {
        box.fingerAlongSum = [...hand.fingerAlong];
      }
    }
    const progress = clamp((nowMs - box.since) / this.config.calibrationMs);
    if (progress === 1 && box.count >= 4) {
      const avgBasis = box.alongSum && box.acrossSum ? orthonormalBasis(box.alongSum, box.acrossSum) : hand.basis;
      const finalBasis = avgBasis ?? hand.basis;
      const rawRefPitch = finalBasis ? elevation(finalBasis.along) : 0;
      const avgFingerAlong = box.fingerAlongSum ? normalize(box.fingerAlongSum) : hand.fingerAlong;
      const rawFingerPitch = avgFingerAlong ? elevation(avgFingerAlong) : rawRefPitch;
      this.neutral = {
        anchor: { ...box.anchor },
        height: box.height,
        width: box.width,
        count: box.count,
        basis: finalBasis,
        refPitch: clamp(rawRefPitch, -24 * rad, 24 * rad),
        fingerRefPitch: clamp(rawFingerPitch, -24 * rad, 24 * rad),
        tiltX: clamp(Math.atan2(box.tiltSinSum, box.tiltCosSum), -12 * rad, 12 * rad),
        imageRoll: Math.atan2(box.rollSinSum, box.rollCosSum),
      };
    }
    return progress;
  }

  updateSteering(hand, nowMs, dt, rolling, pointMode) {
    const inPoint = pointMode || hand.isPointRotate;
    const closed = !inPoint && hand.gripTightness >= (this.gripClosed ? 0.32 : 0.44);
    this.gripClosed = closed;
    const angles = palmSteer(hand, this.neutral, { pointMode });
    if (!rolling && this.steeringWasRolling) this.rollSteerUntilMs = nowMs + 140;
    this.steeringWasRolling = Boolean(rolling);
    const recover = rolling || nowMs < this.rollSteerUntilMs;
    if (recover) return { aimX: this.motion.aimX, aimY: this.motion.aimY, ...angles };

    const steerX = clamp(angles.steerX, -75 * rad, 75 * rad);
    const pitch = clamp(angles.pitch, -75 * rad, 75 * rad);
    this.x.minCutoff = this.y.minCutoff = inPoint ? 4.0 : 4.5;
    this.x.beta = this.y.beta = inPoint ? 4.5 : 6.0;
    this.steerAngles.steerX = this.x.update(steerX, nowMs);
    this.steerAngles.pitch = this.y.update(pitch, nowMs);
    const deadX = (inPoint ? 4.0 : (closed ? 5.0 : 4.2)) * rad;
    const maxX = (inPoint ? 22 : 24) * rad;
    const deadY = (inPoint ? 9.0 : (closed ? 11.0 : 9.5)) * rad;
    const maxY = 30 * rad;
    const power = inPoint ? 2.0 : 1.85;
    const outScale = inPoint ? 0.62 : 1.0;
    const shapeAxis = (val, dead, max) => {
      const mag = Math.abs(val);
      if (mag <= dead) return 0;
      return Math.sign(val) * (clamp((mag - dead) / (max - dead)) ** power) * outScale;
    };
    return {
      aimX: shapeAxis(this.steerAngles.steerX, deadX, maxX),
      aimY: -shapeAxis(this.steerAngles.pitch, deadY, maxY),
      ...angles,
    };
  }

  updateFlight(hand, previous, nowMs) {
    const hRatio = hand.height / this.neutral.height;
    const wRatio = hand.width / this.neutral.width;
    const small = Math.min(hRatio, wRatio);
    const large = Math.max(hRatio, wRatio);
    const skew = (large - small) / large;
    const curlVel = fingerSpeed(hand, previous);
    const dt = previous ? (nowMs - previous.timestampMs) / 1000 : 0;
    const latVel = dt > 0 ? (hand.anchor.x - previous.anchor.x) / dt : 0;
    const rollPose = this.updateThumbRoll(hand.thumbPose, nowMs);
    const freeze = rollPose && (!this.rollLatched || nowMs - this.rollAtMs <= 90);

    if (hand.isPointRotate) {
      this.pointLostSince = null;
      this.pointModeSince ??= nowMs;
      if (nowMs - this.pointModeSince >= 40) this.pointMode = true;
    } else if (this.pointMode) {
      this.pointLostSince ??= nowMs;
      if (nowMs - this.pointLostSince > recognitionGraceMs) {
        this.pointMode = false;
        this.pointModeSince = null;
        this.pointLostSince = null;
      }
    } else {
      this.pointModeSince = null;
      this.pointLostSince = null;
    }

    // Calm resting open-palm pitch auto-trim (never drifts while flying, pointing, or clenching)
    if (!this.pointMode && !rollPose && hand.gripTightness <= 0.22 && hand.basis
      && Math.abs(angleDelta(hand.tiltX, this.neutral.tiltX ?? 0)) < 7 * rad) {
      const rawP = elevation(hand.basis.along);
      const pVel = previous?.basis && dt > 0
        ? Math.abs(angleDelta(rawP, elevation(previous.basis.along))) / dt : 0;
      if (Math.abs(rawP) <= 24 * rad && pVel < 18 * rad) {
        this.openRestSince ??= nowMs;
        if (nowMs - this.openRestSince >= 650 && dt > 0) {
          const trimAlpha = 1 - Math.exp(-2.5 * dt);
          const targetRef = clamp(rawP, -24 * rad, 24 * rad);
          this.neutral.refPitch += angleDelta(targetRef, this.neutral.refPitch ?? rawP) * trimAlpha;
          if (hand.fingerAlong) {
            const rawFP = elevation(hand.fingerAlong);
            const targetFP = clamp(rawFP, -24 * rad, 24 * rad);
            this.neutral.fingerRefPitch += angleDelta(targetFP, this.neutral.fingerRefPitch ?? rawFP) * trimAlpha;
          }
        }
      } else {
        this.openRestSince = null;
      }
    } else {
      this.openRestSince = null;
    }

    const steering = this.updateSteering(hand, nowMs, dt, rollPose, this.pointMode);
    const neutralScale = this.neutral.height;

    let scale = Math.sqrt(hRatio * wRatio);
    if (scale > 1) {
      const skewWeight = clamp((skew - 0.14) / 0.12);
      scale += (small - scale) * skewWeight;
      if (small < 1.03) scale = 1;
    }
    if (scale < 1 && large >= 0.93) scale = 1;
    const rawLogDepth = Math.log(scale);
    this.depthHistory.push(rawLogDepth);
    if (this.depthHistory.length > 3) this.depthHistory.shift();
    let raw = this.depthHistory.length === 3 ? median(...this.depthHistory) : rawLogDepth;
    if (curlVel >= 0.08 && dt > 0) raw = clamp(raw, this.rawDepth - 1.2 * dt, this.rawDepth + 1.2 * dt);
    this.rawDepth = raw;
    const before = this.depth.filtered ?? 0;
    let logDepth = this.depth.update(raw, nowMs);
    if (dt > 0 && raw * before >= 0 && Math.abs(raw) < Math.abs(before)) {
      const release = raw + (before - raw) * Math.exp(-34 * dt);
      if (Math.abs(release) < Math.abs(logDepth)) logDepth = this.depth.filtered = release;
    }

    const smoothGrip = this.gripFilter.update(hand.gripTightness, nowMs);
    const fullFistCurl = !this.pointMode && !rollPose
      && smoothGrip >= (this.boost ? 0.66 : 0.76)
      && hand.tightCurls.filter((c) => c >= (this.boost ? 0.60 : 0.70)).length >= 3;
    const absSteerX = Math.abs(steering.aimX);
    let throttle = 0;
    if (!this.pointMode) {
      const u = clamp((smoothGrip - 0.18) / (0.76 - 0.18));
      const curlThrottle = u > 0 ? clamp(u ** 0.55) : 0;
      const swayFloor = smoothGrip <= 0.28 && absSteerX > 0.14 ? clamp(absSteerX * 0.42, 0, 0.36) : 0;
      throttle = Math.max(curlThrottle, swayFloor);
      if (throttle === 0 && smoothGrip <= 0.20 && absSteerX < 0.18 && Math.abs(steering.aimY) < 0.18
        && logDepth < -0.22 && raw < -0.22 && large < 0.86) {
        throttle = -(clamp((-logDepth - 0.22) / 0.18) ** 1.3);
      }
    }

    this.boostReady = true;
    const reversing = throttle < -0.05;
    if (freeze) throttle = this.inputThrottle;
    this.inputThrottle = throttle;
    this.updateBoost(nowMs, fullFistCurl, reversing || this.pointMode, rollPose);
    if (this.boost && this.boostSource === 'FULL_FIST') throttle = 1.0;
    this.motion = { aimX: steering.aimX, aimY: steering.aimY, throttle, boost: this.boost };
    return { hRatio, wRatio, skew, facing: hand.facing, rawLogDepth, logDepth, throttle, smoothCurl: smoothGrip, gripTightness: smoothGrip, pointMode: this.pointMode,
      steerAxisAngle: this.pointMode ? hand.pointTiltX : hand.tiltX,
      boostHoldMs: this.boostSince === null ? 0 : nowMs - this.boostSince, curlVel, latVel, neutralScale,
      pitchAngle: steering.pitch, yawAngle: steering.yaw, rollAngle: steering.roll, spatialAim: steering.spatial };
  }

  updateBoost(nowMs, fullFist, reversing, rolling) {
    const blocked = !this.boostReady || reversing || rolling;
    const request = blocked ? null : fullFist ? 'FULL_FIST' : null;
    if (request) {
      if (this.boostSource !== request) {
        this.boostSince = nowMs;
        this.boostSource = request;
      }
      this.boostSeenMs = nowMs;
      this.boost ||= nowMs - this.boostSince >= 90;
    } else if (blocked || nowMs - this.boostSeenMs > recognitionGraceMs) {
      this.boost = false;
      this.boostSince = null;
      this.boostSource = null;
    }
  }


  updateThumbRoll(pose, nowMs) {
    const lateral = pose === 'THUMB_LEFT' || pose === 'THUMB_RIGHT';
    if (!lateral) {
      if (this.rollCandidate && nowMs - this.rollCandidate.lastSeen <= recognitionGraceMs) return this.rollCandidate.pose;
      this.rollCandidate = null;
      this.rollReleasedMs ??= nowMs;
      if (nowMs - this.rollReleasedMs >= 160) this.rollLatched = false;
      return null;
    }
    this.rollReleasedMs = null;
    if (this.rollLatched || nowMs < this.rollReadyMs) return pose;
    if (this.rollCandidate?.pose !== pose) this.rollCandidate = { pose, started: nowMs, lastSeen: nowMs };
    else this.rollCandidate.lastSeen = nowMs;
    if (nowMs - this.rollCandidate.started >= rollHoldMs) {
      this.events[pose === 'THUMB_LEFT' ? 'dodgeLeft' : 'dodgeRight']++;
      this.rollCandidate = null;
      this.rollLatched = true;
      this.rollAtMs = nowMs;
      this.lastRollPose = pose;
      this.rollReadyMs = nowMs + 650;
    }
    return pose;
  }

  updateWarpPinch(hand, nowMs) {
    if (!hand.pinchWarp) {
      this.warpReleasedMs ??= nowMs;
      if (nowMs - this.warpReleasedMs > warpGraceMs) {
        this.warpCharge = null;
        this.warpPinchLatched = false;
      }
      return this.warpCharge !== null;
    }
    if (this.warpReleasedMs !== null && nowMs - this.warpReleasedMs > warpGraceMs) {
      this.warpCharge = null;
      this.warpPinchLatched = false;
    }
    this.warpReleasedMs = null;
    if (!this.warpTarget || this.warpPinchLatched || nowMs < this.warpReadyMs) return true;
    this.warpCharge ??= { target: this.warpTarget, started: nowMs, lastSeen: nowMs };
    this.warpCharge.lastSeen = nowMs;
    if (nowMs - this.warpCharge.started >= warpHoldMs) {
      this.events.warp++;
      this.warpTargetId = this.warpCharge.target;
      this.warpCharge = null;
      this.warpPinchLatched = true;
      this.warpReadyMs = nowMs + 1200;
    }
    return true;
  }

  updateOps(hand, previous, nowMs) {
    const still = fingerSpeed(hand, previous) < 0.16;
    if (!this.armed) {
      if (hand.isOpen) this.armed = true;
      return zeroInput;
    }
    if (this.contextMode === 'UPGRADE') {
      if (this.upgradeCommitted !== null) return zeroInput;
      const index = poseByFinger.indexOf(hand.pose) - 1;
      if (index < 0 || !still) {
        this.pick = null;
      } else {
        if (this.pick?.index !== index) this.pick = { index, at: nowMs };
        if (nowMs - this.pick.at >= 650) this.upgradeCommitted = index;
      }
      return zeroInput;
    }
    if (!this.neutral) return zeroInput;
    if (this.updateWarpPinch(hand, nowMs)) {
      this.firing = false;
      this.fistSince = null;
      this.releaseSince = null;
      this.poseCandidate = null;
      this.poseSince = null;
      this.poseNoiseSince = null;
      this.secondaryFiring = false;
      return;
    }
    if (!this.firing) {
      this.fistSince = hand.isFist ? (this.fistSince ?? nowMs) : null;
      this.firing = this.fistSince !== null && nowMs - this.fistSince >= 70;
    } else {
      this.releaseSince = hand.release ? (this.releaseSince ?? nowMs) : null;
      if (this.releaseSince !== null && nowMs - this.releaseSince >= 50) {
        this.firing = false;
        this.fistSince = null;
        this.releaseSince = null;
      }
    }

    const identified = !this.firing && weaponHoldMs[hand.pose] ? hand.pose : null;
    const recovered = identified !== null && identified === this.poseCandidate && this.poseNoiseSince !== null
      && nowMs - this.poseNoiseSince <= recognitionGraceMs;
    const candidate = still || recovered ? identified : null;
    if (candidate) {
      if (candidate !== this.poseCandidate) this.poseSince = nowMs;
      this.poseCandidate = candidate;
      this.poseNoiseSince = null;
    } else if (hand.isOpen || this.firing
      || (this.poseNoiseSince !== null && nowMs - this.poseNoiseSince >= recognitionGraceMs)) {
      this.poseCandidate = null;
      this.poseSince = null;
      this.poseNoiseSince = null;
    } else if (this.poseCandidate !== null) {
      this.poseNoiseSince ??= nowMs;
    }
    if (hand.pose !== this.committedPose) {
      this.pulseArmSince ??= nowMs;
      if (nowMs - this.pulseArmSince >= 180) this.committedPose = null;
    } else {
      this.pulseArmSince = null;
    }
    const ready = candidate && nowMs - this.poseSince >= weaponHoldMs[candidate];
    this.secondaryFiring = this.poseCandidate === 'FINGER_1' && (Boolean(ready) || this.secondaryFiring);
    if (ready && this.committedPose !== candidate) {
      if (candidate === 'FINGER_2' && nowMs >= this.missileReadyMs) {
        this.events.missiles++;
        this.missileReadyMs = nowMs + 450;
      } else if (candidate === 'FINGER_3' && nowMs >= this.empReadyMs) {
        this.events.emp++;
        this.empReadyMs = nowMs + 600;
      }
      this.committedPose = candidate;
    }
  }

  loseRoles(flightMissing, opsMissing, nowMs) {
    if (opsMissing && !this.opsLost) {
      this.opsLost = true;
      this.clearOps();
      this.invalidateEvents();
    }
    if (!flightMissing) return;
    const age = this.lastFlight ? nowMs - this.lastFlight.timestampMs : Infinity;
    this.rollCandidate = null;
    this.boost = false;
    this.boostSince = null;
    this.boostSource = null;
    this.boostReady = false;
    if (!this.flightLost) {
      this.flightLost = true;
      this.calibration = null;
      this.invalidateEvents();
    }
    const stopAfter = this.crossingGuard ? 120 : this.config.lostMs;
    if (age >= stopAfter && !this.flightCleared) {
      this.clearMotion();
      this.rollLatched = true;
      this.flightCleared = true;
      if (!this.neutral) this.hasFlightRef = false;
    }
  }

  motionWhenMissing(nowMs) {
    const age = this.lastFlight ? nowMs - this.lastFlight.timestampMs : Infinity;
    const decay = this.flightCleared || age >= this.config.lostMs ? 0 : Math.exp(-Math.max(0, age - 65) / 80);
    return { aimX: this.motion.aimX * decay, aimY: this.motion.aimY * decay, throttle: this.motion.throttle * decay, boost: false };
  }

  snapshot(nowMs = performance.now()) {
    const flightStale = this.lastFlight && nowMs - this.lastFlight.timestampMs >= this.config.lostMs;
    const opsStale = this.lastOps && nowMs - this.lastOps.timestampMs >= this.config.fireWatchdogMs;
    if ((!flightStale || this.flightLost) && (!opsStale || this.opsLost)
      && !(this.flightLost && !this.flightCleared)) return this.state;
    this.loseRoles(flightStale || this.flightLost, opsStale || this.opsLost, nowMs);
    const flight = this.flightLost ? null : this.lastFlight;
    const ops = this.opsLost ? null : this.lastOps;
    return this.compose(flight, ops, nowMs, this.state.debug, this.state.calibrationProgress, [flight, ops].filter(Boolean));
  }

  compose(flight, ops, nowMs, debug, calibrationProgress, hands) {
    const isUpgrade = this.contextMode === 'UPGRADE';
    const motion = isUpgrade || !this.neutral ? zeroInput
      : this.flightLost ? this.motionWhenMissing(nowMs) : this.motion;
    const flightTracked = !this.flightLost && Boolean(flight ?? this.lastFlight);
    const opsTracked = !this.opsLost && Boolean(ops ?? this.lastOps);
    const phase = this.neutral || isUpgrade
      ? (flightTracked || opsTracked || this.crossingGuard ? 'ACTIVE'
        : (motion.throttle || motion.aimX || motion.aimY ? 'LOST_GRACE' : 'LOST'))
      : 'CALIBRATING';
    const firePrimary = phase === 'ACTIVE' && !isUpgrade && opsTracked && this.firing;
    const opsHand = opsTracked ? (ops ?? this.lastOps) : null;
    const flightHand = flightTracked ? (flight ?? this.lastFlight) : null;
    const fireSecondary = phase === 'ACTIVE' && !isUpgrade && opsTracked && this.secondaryFiring;
    const overlayHands = hands?.map((hand) => overlay(hand === flight ? 'FLIGHT' : hand === ops ? 'OPS' : 'UNASSIGNED',
      hand, hand === ops && (firePrimary || fireSecondary), hand === flight && Boolean(motion.boost))) ?? [];
    const candidateIndex = this.pick?.index ?? null;
    const committedIndex = opsTracked && candidateIndex !== null ? this.upgradeCommitted : null;
    const holdProgress = committedIndex !== null ? 1 : this.pick && opsHand ? clamp((opsHand.timestampMs - this.pick.at) / 650) : 0;
    const warpChargeProgress = !isUpgrade && opsTracked && this.warpCharge
      ? clamp((this.warpCharge.lastSeen - this.warpCharge.started) / warpHoldMs) : 0;
    const rollHint = this.rollCandidate?.pose === 'THUMB_LEFT' ? '左翻滚准备'
      : this.rollCandidate?.pose === 'THUMB_RIGHT' ? '右翻滚准备' : null;
    const flightSide = this.flightHand === 'LEFT' ? '左手' : '右手';
    const opsSide = this.flightHand === 'LEFT' ? '右手' : '左手';
    let actionHint = null;
    if (this.crossingGuard) actionHint = '请分开双手，避免遮挡';
    else if (!isUpgrade && !flightTracked) actionHint = `请把${flightSide}飞控手移回画面`;
    else if (!opsTracked) actionHint = `请把${opsSide}操作手移回画面`;
    else if (!this.armed) actionHint = `${opsSide}张掌${isUpgrade ? '解锁选卡' : '解锁武器'}`;
    else if (!isUpgrade && flightHand && this.lastRollPose && nowMs - this.rollAtMs <= 160) {
      const direction = this.lastRollPose === 'THUMB_LEFT' ? '左' : '右';
      actionHint = `${flightSide}向${direction}翻滚`;
    } else if (!isUpgrade && opsHand?.pinchWarp && !this.warpTarget && !this.warpPinchLatched) {
      actionHint = '请先锁定跃迁行星';
    } else if (!isUpgrade && !motion.boost && this.boostSince !== null) {
      actionHint = '握紧全拳，冲刺准备中';
    } else if (!isUpgrade && this.pointMode) {
      actionHint = '1指原地精瞄';
    }
    return this.publish(phase, {
      ...motion, firePrimary, fireSecondary, boostSource: motion.boost ? this.boostSource : null,
      tracking: flightTracked || opsTracked, calibrationProgress,
      actionHint,
      calibrationHint: flight && !this.neutral
        ? flight.facing < 0.42 ? '请稍微朝向镜头，保持自然手腕角度'
          : flight.height < 0.05 ? '飞控手离镜头偏远' : flight.height > 0.45 ? '飞控手离镜头偏近' : null
        : null,
      anchorMirrored: flight?.anchor ?? null, landmarksMirrored: flight?.mirrored ?? null,
      pose: opsHand?.pose ?? 'NONE',
      flightPose: this.pointMode ? 'POINT_ROTATE' : (flightHand?.thumbPose ?? (motion.boost ? 'FULL_FIST' : (flightHand?.pose ?? 'NONE'))),
      flightStatus: { tracked: flightTracked, phase: flightTracked ? (this.neutral ? 'ACTIVE' : 'CALIBRATING') : phase, boostReady: this.boostReady },
      opsStatus: { tracked: opsTracked, armed: this.armed, pose: opsHand?.pose ?? 'NONE' },
      handsOverlay: overlayHands,
      upgradeSelection: { draftVersion: this.draftVersion, unlocked: this.armed, candidateIndex, holdProgress,
        committedIndex },
      warpChargeProgress,
      pendingGestureHint: this.warpCharge && opsTracked ? `捏合跃迁充能 ${Math.round(warpChargeProgress * 100)}%` : rollHint,
      debug, logDepth: debug?.logDepth ?? 0, skew: debug?.skew ?? 0, curlScore: ops?.curlScore ?? 0,
    });
  }

  update(sample, nowMs = performance.now(), inferenceMs = null) {
    if (!Number.isFinite(nowMs) || nowMs <= this.lastSampleMs) return this.state;
    this.snapshot(nowMs);
    const width = sample?.width;
    const height = sample?.height;
    const validImage = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
    if (validImage && this.videoWidth && (this.videoWidth !== width || this.videoHeight !== height)) this.reset();
    this.lastSampleMs = nowMs;
    if (validImage) {
      this.videoWidth = width;
      this.videoHeight = height;
    }
    const detections = Array.isArray(sample?.hands) ? sample.hands : [sample];
    const hands = validImage ? detections.slice(0, 2)
      .map((hand) => readHand(hand, width / height, nowMs)).filter(Boolean) : [];
    const { flight, ops, crossing } = this.assignHands(hands, nowMs);
    this.crossingGuard = crossing;
    this.loseRoles(!flight, !ops, nowMs);
    let calibrationProgress = this.neutral ? 1 : 0;
    let debug = { handCount: hands.length, inferenceMs };
    if (flight) {
      const previous = this.flightLost ? null : this.lastFlight;
      this.lastFlight = flight;
      this.flightLost = false;
      this.flightCleared = false;
      if (this.contextMode === 'FLIGHT') {
        if (!this.neutral) calibrationProgress = this.calibrate(flight, nowMs);
        if (this.neutral) debug = { ...this.updateFlight(flight, previous, nowMs), ...debug };
      }
      if (this.neutral && flight.score >= 0.75 && !this.flightLabel && flight.label !== this.opsLabel) this.flightLabel = flight.label;
    }
    if (ops) {
      const previous = this.opsLost ? null : this.lastOps;
      this.lastOps = ops;
      this.opsLost = false;
      if (this.neutral && ops.score >= 0.75 && !this.opsLabel && ops.label !== this.flightLabel) this.opsLabel = ops.label;
      this.updateOps(ops, previous, nowMs);
    }
    return this.compose(flight, ops, nowMs, debug, calibrationProgress, hands);
  }
}
