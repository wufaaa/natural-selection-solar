import * as THREE from 'three';

export const CAMERA_MODES = ['TACTICAL', 'WIDE', 'FIRST_PERSON'];

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.modeIndex = 0; // View 1: TACTICAL dorsal overview
    this.shake = 0;
    this.shakeScale = 0.75;
    this.reduceMotion = true;
    this.onFirstPersonTransition = null;

    this.currentPos = new THREE.Vector3();
    this.currentLook = new THREE.Vector3();
    this.stablePos = new THREE.Vector3();
    this.stableLook = new THREE.Vector3();
    this.stableAimOrigin = new THREE.Vector3();
    this.stableAimDir = new THREE.Vector3(0, 0, -1);
    this._stableTargetOffset = new THREE.Vector3();
    this._stableTargetLook = new THREE.Vector3();
    this._stableFallOrigin = new THREE.Vector3();
    this._stableFallLook = new THREE.Vector3();
    this._hasStableAim = false;
    this.titleAngle = 0.55;
    this.transitionTimer = 0;
    this.isTransitioning = false;
    this.modeBlendTimer = 0;

    // Wheel zoom & [Alt] 360-degree free orbit view
    this.zoomOffset = 0;
    this.orbitYaw = 0;
    this.orbitPitch = 0;

    this._tmpOffset = new THREE.Vector3();
    this._tmpLook = new THREE.Vector3();
    this._upVec = new THREE.Vector3();
    this._fwdVec = new THREE.Vector3();
  }

  get mode() {
    return CAMERA_MODES[this.modeIndex];
  }

  get isFreeOrbitActive() {
    return this.mode !== 'FIRST_PERSON' && (Math.abs(this.orbitYaw) > 0.02 || Math.abs(this.orbitPitch) > 0.02);
  }

  setMode(mode) {
    const idx = CAMERA_MODES.indexOf(mode);
    if (idx !== -1 && idx !== this.modeIndex) {
      const prev = this.mode;
      this.modeIndex = idx;
      this._hasStableAim = false;
      if (prev === 'FIRST_PERSON' || mode === 'FIRST_PERSON') {
        this.onFirstPersonTransition?.(mode);
      } else {
        this.modeBlendTimer = 0.42;
      }
    }
    return this.mode;
  }

  cycleMode() {
    const prev = this.mode;
    this.modeIndex = (this.modeIndex + 1) % CAMERA_MODES.length;
    this._hasStableAim = false;
    const next = this.mode;
    if (prev === 'FIRST_PERSON' || next === 'FIRST_PERSON') {
      this.onFirstPersonTransition?.(next);
    } else {
      this.modeBlendTimer = 0.42;
    }
    return next;
  }

  addShake(amount, scale = null) {
    const mult = scale !== null ? scale : this.shakeScale;
    const comfortMult = this.reduceMotion ? 0.58 : 1.0;
    this.shake = Math.min(1.15, this.shake + amount * mult * comfortMult);
  }

  beginLaunchTransition() {
    this.isTransitioning = true;
    this.transitionTimer = 0;
  }

  _getModeVectors() {
    if (this.mode === 'FIRST_PERSON') {
      // Panorama 3D Star Citizen holographic glass bridge cockpit
      return {
        localOffset: new THREE.Vector3(0, 1.05, -0.55),
        localLook: new THREE.Vector3(0, 0.94, -68),
        baseFov: 70,
      };
    }
    if (this.mode === 'WIDE') {
      // View 2: Fleet-command elevated wide angle showing entire cruiser, wingmen & horizon
      return {
        localOffset: new THREE.Vector3(0, 10.6, 20.6 + this.zoomOffset * 1.1),
        localLook: new THREE.Vector3(0, -0.35, -28),
        baseFov: 61,
      };
    }
    // View 1 (Default): TACTICAL heroic 26° dorsal overview showing gravity ring, spearhead prow & bridge
    return {
      localOffset: new THREE.Vector3(0, 7.6, 13.6 + this.zoomOffset),
      localLook: new THREE.Vector3(0, 0.25, -24),
      baseFov: 58,
    };
  }

  snapToShip(ship) {
    const shipPos = ship.root.position;
    const shipQuat = ship.root.quaternion;
    this._upVec.set(0, 1, 0).applyQuaternion(shipQuat);
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.isTransitioning = false;

    const { localOffset, localLook } = this._getModeVectors();
    this.currentPos.copy(localOffset).applyQuaternion(shipQuat).add(shipPos);
    this.currentLook.copy(localLook).applyQuaternion(shipQuat).add(shipPos);
    this.stablePos.copy(this.currentPos);
    this.stableLook.copy(this.currentLook);
    this.stableAimOrigin.copy(this.stablePos);
    this.stableAimDir.subVectors(this.stableLook, this.stablePos);
    if (this.stableAimDir.lengthSq() > 1e-6) this.stableAimDir.normalize();
    else this.stableAimDir.set(0, 0, -1).applyQuaternion(shipQuat).normalize();
    this._hasStableAim = true;

    this.camera.position.copy(this.currentPos);
    this.camera.up.copy(this._upVec);
    this.camera.lookAt(this.currentLook);
  }

  getStableAimRay(ship, outOrigin = new THREE.Vector3(), outDir = new THREE.Vector3()) {
    if (this._hasStableAim && this.stableAimDir.lengthSq() > 0.5) {
      outOrigin.copy(this.stableAimOrigin);
      outDir.copy(this.stableAimDir);
      return { origin: outOrigin, dir: outDir };
    }
    const shipPos = ship.root.position;
    const shipQuat = ship.root.quaternion;
    const { localOffset, localLook } = this._getModeVectors();
    this._stableFallOrigin.copy(localOffset).applyQuaternion(shipQuat).add(shipPos);
    this._stableFallLook.copy(localLook).applyQuaternion(shipQuat).add(shipPos);
    outOrigin.copy(this._stableFallOrigin);
    outDir.subVectors(this._stableFallLook, this._stableFallOrigin);
    if (outDir.lengthSq() > 1e-6) outDir.normalize();
    else outDir.set(0, 0, -1).applyQuaternion(shipQuat).normalize();
    return { origin: outOrigin, dir: outDir };
  }

  update(dt, time, ship, playMode, input = null) {
    const shipPos = ship.root.position;
    const shipQuat = ship.root.quaternion;
    this._upVec.set(0, 1, 0).applyQuaternion(shipQuat);
    this._fwdVec.set(0, 0, -1).applyQuaternion(shipQuat);

    if (playMode === 'TITLE') {
      this.titleAngle += dt * 0.12;
      const r = 14.5;
      const offset = new THREE.Vector3(
        Math.cos(this.titleAngle) * r,
        3.2 + Math.sin(this.titleAngle * 0.6) * 1.2,
        Math.sin(this.titleAngle) * r
      ).applyQuaternion(shipQuat);

      this.currentPos.copy(shipPos).add(offset);
      const camForward = shipPos.clone().sub(this.currentPos).normalize();
      const camRight = new THREE.Vector3().crossVectors(camForward, this._upVec).normalize();
      const targetLook = shipPos.clone().addScaledVector(camRight, -3.6).addScaledVector(this._upVec, -0.35);
      this.currentLook.copy(targetLook);

      this.camera.position.copy(this.currentPos);
      this.camera.up.copy(this._upVec);
      this.camera.lookAt(this.currentLook);
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 48, dt * 4);
      this.camera.updateProjectionMatrix();
      return;
    }

    // Mouse wheel camera zoom & Alt free-orbit ship inspection
    if (input) {
      if (input.camZoomDelta) {
        this.zoomOffset = THREE.MathUtils.clamp(this.zoomOffset + input.camZoomDelta, -3.5, 8.5);
      }
      if (input.orbitLookActive) {
        if (input.pointerLocked) {
          const dx = THREE.MathUtils.clamp(input.deltaX, -120, 120);
          const dy = THREE.MathUtils.clamp(input.deltaY, -120, 120);
          this.orbitYaw -= dx * 0.0055;
          this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch - dy * 0.0055, -1.15, 1.15);
        } else {
          this.orbitYaw = -input.aimX * 2.2;
          this.orbitPitch = THREE.MathUtils.clamp(-input.aimY * 1.05, -1.15, 1.15);
        }
      } else {
        const decay = Math.exp(-9.0 * dt);
        this.orbitYaw *= decay;
        this.orbitPitch *= decay;
      }
    }

    const { localOffset, localLook, baseFov } = this._getModeVectors();
    const isFP = this.mode === 'FIRST_PERSON';
    const comfort = this.reduceMotion;

    const speed = ship.velocity.length();
    const boostAdd = ship.isBoosting ? 1.8 : 0;
    const warpAdd = ship.warpState === 'WARPING' ? 3.2 : 0;
    if (!isFP) {
      // Pull back & slightly upward together along the elevated chase slope so boosting never hides the hull behind exhaust
      const pull = boostAdd + warpAdd;
      localOffset.z += pull * 1.1;
      localOffset.y += pull * 0.45;
      const latFactor = comfort ? 0.22 : 0.65;
      const vertFactor = comfort ? 0.14 : 0.35;
      localOffset.x += THREE.MathUtils.clamp(-ship.yawVel * latFactor, -1.1, 1.1);
      localOffset.y += THREE.MathUtils.clamp(ship.pitchVel * vertFactor, -0.55, 0.55);
    }

    // Capture stable aim target (with zoom/boost/sway, ZERO Alt-orbit and ZERO screen shake)
    this._stableTargetOffset.copy(localOffset).applyQuaternion(shipQuat).add(shipPos);
    this._stableTargetLook.copy(localLook).applyQuaternion(shipQuat).add(shipPos);

    // Apply Alt free-orbit rotation around ship if active
    if (!isFP && (Math.abs(this.orbitYaw) > 0.002 || Math.abs(this.orbitPitch) > 0.002)) {
      const dist = localOffset.length();
      const qOrbit = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.orbitPitch, this.orbitYaw, 0, 'YXZ'));
      localOffset.set(0, 1.6, dist).applyQuaternion(qOrbit);
      localLook.set(0, 0.25, 0);
    }

    this._tmpOffset.copy(localOffset).applyQuaternion(shipQuat).add(shipPos);
    this._tmpLook.copy(localLook).applyQuaternion(shipQuat).add(shipPos);

    if (this.modeBlendTimer > 0) {
      this.modeBlendTimer = Math.max(0, this.modeBlendTimer - dt);
    }

    if (this.isTransitioning && !isFP) {
      this.transitionTimer += dt;
      const t = Math.min(1, this.transitionTimer / 1.45);
      const ease = 1 - Math.pow(1 - t, 3);
      const blendRate = ease * 0.25 + dt * 5.0;
      const lookRate = ease * 0.3 + dt * 6.0;
      this.currentPos.lerp(this._tmpOffset, blendRate);
      this.currentLook.lerp(this._tmpLook, lookRate);
      if (!this._hasStableAim) {
        this.stablePos.copy(this._stableTargetOffset);
        this.stableLook.copy(this._stableTargetLook);
      } else {
        this.stablePos.lerp(this._stableTargetOffset, blendRate);
        this.stableLook.lerp(this._stableTargetLook, lookRate);
      }
      if (t >= 1) this.isTransitioning = false;
    } else if (isFP) {
      this.currentPos.copy(this._tmpOffset);
      this.currentLook.copy(this._tmpLook);
      this.stablePos.copy(this._stableTargetOffset);
      this.stableLook.copy(this._stableTargetLook);
      this.isTransitioning = false;
    } else {
      const blendMult = this.modeBlendTimer > 0 ? 0.58 : 1.0;
      const posBlend = 1 - Math.exp(-15.0 * blendMult * dt);
      const lookBlend = 1 - Math.exp(-20.0 * blendMult * dt);
      this.currentPos.lerp(this._tmpOffset, posBlend);
      this.currentLook.lerp(this._tmpLook, lookBlend);
      if (!this._hasStableAim) {
        this.stablePos.copy(this._stableTargetOffset);
        this.stableLook.copy(this._stableTargetLook);
      } else {
        this.stablePos.lerp(this._stableTargetOffset, posBlend);
        this.stableLook.lerp(this._stableTargetLook, lookBlend);
      }
    }

    this.stableAimOrigin.copy(this.stablePos);
    this.stableAimDir.subVectors(this.stableLook, this.stablePos);
    if (this.stableAimDir.lengthSq() > 1e-6) {
      this.stableAimDir.normalize();
    } else {
      this.stableAimDir.copy(this._fwdVec);
    }
    this._hasStableAim = true;

    const warpFov = comfort ? baseFov + 8 : baseFov + 14;
    const boostFov = comfort ? baseFov + 2.5 : baseFov + 5.5;
    const speedFov = comfort ? Math.min(2.2, speed * 0.007) : Math.min(4.2, speed * 0.014);
    const targetFov =
      ship.warpState === 'WARPING'
        ? warpFov
        : ship.isBoosting
        ? boostFov
        : baseFov + speedFov;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-6.5 * dt));
    this.camera.updateProjectionMatrix();

    this.camera.position.copy(this.currentPos);
    if (this.shake > 0.001) {
      const mag = this.shake * this.shake * (isFP ? 0.14 : 0.28);
      this.camera.position.x += (Math.random() - 0.5) * mag;
      this.camera.position.y += (Math.random() - 0.5) * mag;
      this.camera.position.z += (Math.random() - 0.5) * mag;
      this.shake = Math.max(0, this.shake - dt * 3.1);
    }

    // Horizon stability: locked 0 in FIRST_PERSON, gentle subtle banking in 3rd-person
    const rollAngle = isFP ? 0 : ship.bankAngle * (comfort ? 0.035 : 0.10);
    if (Math.abs(rollAngle) > 0.0005) {
      const rollFollow = new THREE.Quaternion().setFromAxisAngle(this._fwdVec, rollAngle);
      this._upVec.applyQuaternion(rollFollow);
    }
    this.camera.up.copy(this._upVec);
    this.camera.lookAt(this.currentLook);
  }
}
