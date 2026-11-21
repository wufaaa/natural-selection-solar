import * as THREE from 'three';
import { SHIP_HARDPOINTS, WEAPON_CONFIG } from '../core/Constants.js';

const aimOffset = new THREE.Vector3();
const aimForward = new THREE.Vector3();
const aimRayOrigin = new THREE.Vector3();
const aimRayDir = new THREE.Vector3();
const aimRayEnd = new THREE.Vector3();
const relativeAimVelocity = new THREE.Vector3();
const manualLead = new THREE.Vector3();
const beamStart = new THREE.Vector3();
const beamEnd = new THREE.Vector3();
const beamFacing = new THREE.Vector3();
const beamHit = new THREE.Vector3();
const projectileStart = new THREE.Vector3();
const projectileHit = new THREE.Vector3();
const missileHeading = new THREE.Vector3();
const missileDesired = new THREE.Vector3();
const missileFacing = new THREE.Vector3();
const trailTangent = new THREE.Vector3();
const trailSide = new THREE.Vector3();
const trailUp = new THREE.Vector3();
const axisY = new THREE.Vector3(0, 1, 0);
const axisX = new THREE.Vector3(1, 0, 0);
const MISSILE_TRAIL_SEGMENTS = 16;
const MISSILE_TRAIL_STEP = 0.022;
const LASER_CLEARANCE = 1.1;
const candidateHit = { t: 0, point: new THREE.Vector3() };
const firstHit = { target: null, crystal: null, t: 0, point: new THREE.Vector3() };
const GAMMA_FEEDBACK_INTERVAL = 0.075;

export function segmentSphereEntryT(start, end, center, radius, result = null) {
  const ox = start.x - center.x;
  const oy = start.y - center.y;
  const oz = start.z - center.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  let t = 0;

  if (c > 0) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const a = dx * dx + dy * dy + dz * dz;
    const b = ox * dx + oy * dy + oz * dz;
    if (a === 0 || b >= 0) return null;
    const discriminant = b * b - a * c;
    if (discriminant < 0) return null;
    // Algebraically equivalent to the smaller quadratic root, without subtracting close values.
    t = c / (-b + Math.sqrt(discriminant));
    if (t > 1) return null;
  }

  const entry = result || { t: 0, point: new THREE.Vector3() };
  entry.t = t;
  entry.point.lerpVectors(start, end, t);
  return entry;
}

function findFirstImpact(start, end, enemies, crystals, enemyScale = 1, extraRadius = 0) {
  firstHit.target = null;
  firstHit.crystal = null;
  firstHit.t = Infinity;
  for (const enemy of enemies) {
    if (enemy.hp <= 0) continue;
    const hit = segmentSphereEntryT(start, end, enemy.mesh.position, enemy.hitRadius * enemyScale + extraRadius, candidateHit);
    if (hit && hit.t < firstHit.t) {
      firstHit.t = hit.t;
      firstHit.target = enemy;
      firstHit.point.copy(hit.point);
    }
  }
  for (const crystal of crystals || []) {
    if (crystal.cooldown > 0) continue;
    const hit = segmentSphereEntryT(start, end, crystal.mesh.position, crystal.hitRadius + extraRadius, candidateHit);
    if (hit && hit.t <= firstHit.t) {
      firstHit.t = hit.t;
      firstHit.target = null;
      firstHit.crystal = crystal;
      firstHit.point.copy(hit.point);
    }
  }
  return Number.isFinite(firstHit.t) ? firstHit : null;
}

const ENERGY_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

function createEnergyMaterial(fragmentShader, uniforms = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: ENERGY_VERTEX,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

function createPulseGeometry() {
  // Two indexed ribbons share the axis, with the tail at z=0 and the tip at z=1.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -1, 0, 0, 1, 0, 0, -1, 0, 1, 1, 0, 1,
    0, -1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1], 2));
  geometry.setIndex([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7]);
  return geometry;
}

function createPulseMaterial(overdrive) {
  return createEnergyMaterial(/* glsl */ `
    #include <common>
    #include <logdepthbuf_pars_fragment>
    uniform vec3 uTint;
    varying vec2 vUv;
    void main() {
      float x = vUv.x * 2.0 - 1.0;
      float xx = x * x;
      float envelope = smoothstep(0.0, 0.22, vUv.y) * (1.0 - smoothstep(0.76, 1.0, vUv.y));
      float core = exp(-xx * 79.0);
      float halo = exp(-xx * 6.4) * (1.0 - smoothstep(0.73, 1.0, abs(x)));
      vec3 color = mix(uTint * 1.9, vec3(3.5, 3.6, 3.8), core);
      gl_FragColor = vec4(color, envelope * (0.66 * core + 0.28 * halo));
      #include <logdepthbuf_fragment>
    }
  `, { uTint: { value: new THREE.Color(overdrive ? '#ffc85c' : '#47d9ff') } });
}

function createFocusMaterial(color, opacity = 1) {
  return createEnergyMaterial(/* glsl */ `
    #include <common>
    #include <logdepthbuf_pars_fragment>
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      float r = length(p);
      float mask = 1.0 - smoothstep(0.76, 0.99, r);
      if (mask < 0.001) discard;
      float rim = (r - 0.62) * 15.0;
      float angle = atan(p.y, p.x + 0.00001);
      float ring = exp(-(rim * rim)) * (0.55 + 0.45 * sin(angle * 7.0 - uTime * 14.0));
      float core = exp(-dot(p, p) * 20.0);
      float star = exp(-min(abs(p.x), abs(p.y)) * 28.0 - r * 4.0);
      vec3 color = mix(uColor * 2.1, vec3(3.2, 3.3, 3.45), core);
      gl_FragColor = vec4(color, mask * uOpacity * clamp(core + 0.65 * star + 0.52 * ring, 0.0, 1.0));
      #include <logdepthbuf_fragment>
    }
  `, { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uTime: { value: 0 } });
}

function createMissileTrailGeometry() {
  const geometry = new THREE.BufferGeometry();
  const rows = MISSILE_TRAIL_SEGMENTS + 1;
  const uv = new Float32Array(rows * 4 * 2);
  const indices = [];
  for (let row = 0; row < rows; row++) {
    for (let side = 0; side < 4; side++) {
      uv.set([side % 2, row / MISSILE_TRAIL_SEGMENTS], (row * 4 + side) * 2);
    }
    if (row === rows - 1) continue;
    for (const side of [0, 2]) {
      const i = row * 4 + side;
      indices.push(i, i + 1, i + 4, i + 4, i + 1, i + 5);
    }
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rows * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.setDrawRange(0, 0);
  return geometry;
}

function createMissileTrailMaterial() {
  return createEnergyMaterial(/* glsl */ `
    #include <common>
    #include <logdepthbuf_pars_fragment>
    varying vec2 vUv;
    void main() {
      float t = vUv.y;
      float x = vUv.x * 2.0 - 1.0;
      float edge = 1.0 - smoothstep(0.7, 1.0, abs(x));
      float core = exp(-x * x * (14.0 - 9.0 * t));
      vec3 color = mix(vec3(3.3, 3.15, 2.7), vec3(1.8, 0.53, 0.08), smoothstep(0.0, 0.30, t));
      color = mix(color, vec3(0.08, 0.23, 0.27), smoothstep(0.23, 0.85, t));
      float fade = 1.0 - smoothstep(0.22, 1.0, t);
      gl_FragColor = vec4(color, edge * fade * (0.32 + 0.58 * core));
      #include <logdepthbuf_fragment>
    }
  `);
}

function createGammaBeamMaterial(isCore = false) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uOverdrive: { value: 0 },
      uIsCore: { value: isCore ? 1.0 : 0.0 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mv.xyz);
        vNormalV = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uTime;
      uniform float uOverdrive;
      uniform float uIsCore;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        float ndv = pow(clamp(abs(dot(normalize(vNormalV), normalize(vViewDir))), 0.0, 1.0), uIsCore > 0.5 ? 1.1 : 1.9);
        float axial = vUv.y;
        float theta = vUv.x * 6.2831853;
        float phase = theta * 2.0 + axial * 58.0 - uTime * 24.0;
        float strand = pow(max(0.0, cos(phase)), 15.0);
        float surge = 0.72 + 0.28 * sin(axial * 23.0 - uTime * 36.0);
        float packets = pow(clamp(0.5 + 0.5 * cos(axial * 76.0 - uTime * 53.0), 0.0, 1.0), 5.0);
        float envelope = smoothstep(0.0, 0.026, axial) * (1.0 - smoothstep(0.95, 1.0, axial));

        vec3 beamCol = uIsCore > 0.5
          ? mix(vec3(1.6, 2.3, 2.6), vec3(2.5, 2.5, 2.8), surge)
          : mix(vec3(0.15, 0.66, 1.8), vec3(0.8, 2.0, 3.2), strand);
        if (uOverdrive > 0.5) {
          beamCol = mix(beamCol, vec3(2.2, 1.65, 0.55), 0.45);
        }

        float alpha = envelope * ndv * (uIsCore > 0.5 ? 0.92 : 0.10 + strand * (0.40 + packets * 0.38)) * surge;
        gl_FragColor = vec4(beamCol, clamp(alpha, 0.0, 1.0));
        #include <logdepthbuf_fragment>
      }
    `,
  });
}

export class WeaponSystem {
  constructor(scene, audio, vfx) {
    this.scene = scene;
    this.audio = audio;
    this.vfx = vfx;

    this.bolts = [];
    this.missiles = [];
    this.muzzleFlashes = [];

    this.railTimer = 0;
    this.barrelIndex = 0;

    this.gammaHeat = 0;
    this.gammaOverheated = false;
    this.gammaActive = false;

    this.missileAmmo = WEAPON_CONFIG.missileMaxAmmo;
    this.missileRegenTimer = 0;
    this.lockedTargets = [];
    this.shotCounter = 0;
    this.overdriveMissileTimer = 0;
    this.gammaArcTimer = 0;
    this.gammaFeedbackTimer = 0;
    this.pendingGammaKillFeedback = false;
    this.reticleBloom = 0;
    this._progressiveLockTimer = 0;

    this.empCooldown = 0;
    this.bonusMissileMax = 0;
    this.bonusSalvo = 0;
    this.upgradeSystem = null;
    this.solarSystem = null;
    this.cockpit = null;

    // Multi-layer Aim Assist & Fire-Control Lock state
    this.aimAssistModes = ['STRONG', 'STANDARD', 'OFF'];
    this.aimAssistIndex = 0; // default: STRONG
    this.aimAssistTarget = null;
    this.aimAssistLeadPos = new THREE.Vector3();
    this.hasAimAssistLock = false;
    this.manualTargetId = null;

    this._pulseGeo = createPulseGeometry();
    this._pulseMaterials = [createPulseMaterial(false), createPulseMaterial(true)];
    this._focusGeo = new THREE.PlaneGeometry(2, 2);
    this._missileGeo = new THREE.LatheGeometry([
      new THREE.Vector2(0, -0.67), new THREE.Vector2(0.21, -0.67),
      new THREE.Vector2(0.29, -0.35), new THREE.Vector2(0.27, 0.33),
      new THREE.Vector2(0.15, 0.72), new THREE.Vector2(0, 1.12),
    ], 12);
    this._missileGeo.rotateX(Math.PI * 0.5);
    this._missileMat = new THREE.MeshStandardMaterial({
      color: '#283747', metalness: 0.65, roughness: 0.38, emissive: '#29190d', emissiveIntensity: 0.45,
    });
    this._exhaustGeo = new THREE.SphereGeometry(1, 10, 6);
    this._exhaustMat = new THREE.MeshBasicMaterial({
      color: '#ffba67', transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this._missileTrailMat = createMissileTrailMaterial();

    // Animated GLSL Gamma Particle Lance continuous beam group
    this.gammaGroup = new THREE.Group();
    this.gammaCoreMat = createGammaBeamMaterial(true);
    this.gammaOuterMat = createGammaBeamMaterial(false);
    this.gammaCore = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.34, 1.0, 12, 1, true),
      this.gammaCoreMat
    );
    this.gammaCore.geometry.rotateX(Math.PI * 0.5);
    this.gammaCore.geometry.translate(0, 0, 0.5);

    this.gammaOuter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 1.02, 1.0, 14, 1, true),
      this.gammaOuterMat
    );
    this.gammaOuter.geometry.rotateX(Math.PI * 0.5);
    this.gammaOuter.geometry.translate(0, 0, 0.5);
    this.gammaFocus = new THREE.Mesh(this._focusGeo, createFocusMaterial('#55eaff'));
    this.gammaFocus.position.z = LASER_CLEARANCE;
    this.gammaImpact = new THREE.Mesh(this._focusGeo, createFocusMaterial('#9df2ff'));
    this.gammaGroup.add(this.gammaCore, this.gammaOuter, this.gammaFocus, this.gammaImpact);
    this.gammaGroup.visible = false;
    this.scene.add(this.gammaGroup);

    this.onHitFeedback = null; // callback('hit' | 'crit' | 'kill')
  }

  reset() {
    for (const bolt of this.bolts) this.scene.remove(bolt.mesh);
    for (const missile of this.missiles) this._removeMissile(missile);
    for (const flash of this.muzzleFlashes) this._removeMuzzleFlash(flash);
    this.bolts.length = 0;
    this.missiles.length = 0;
    this.muzzleFlashes.length = 0;
    this.railTimer = 0;
    this.barrelIndex = 0;
    this.shotCounter = 0;
    this.overdriveMissileTimer = 0;
    this.gammaArcTimer = 0;
    this.gammaFeedbackTimer = 0;
    this.pendingGammaKillFeedback = false;
    this.reticleBloom = 0;
    this._progressiveLockTimer = 0;
    this.gammaHeat = 0;
    this.gammaOverheated = false;
    this.gammaActive = false;
    this.gammaGroup.visible = false;
    this.gammaImpact.visible = false;
    this.audio.setGammaActive?.(false);
    this.empCooldown = 0;
    this.bonusMissileMax = 0;
    this.bonusSalvo = 0;
    this.missileAmmo = WEAPON_CONFIG.missileMaxAmmo;
    this.missileRegenTimer = 0;
    this.lockedTargets.length = 0;
    this.aimAssistTarget = null;
    this.aimAssistLeadPos.set(0, 0, 0);
    this.hasAimAssistLock = false;
    this.manualTargetId = null;
  }

  _removeMissile(missile) {
    this.scene.remove(missile.mesh, missile.ribbon);
    missile.ribbon.geometry.dispose();
  }

  _removeMuzzleFlash(flash) {
    this.scene.remove(flash.mesh);
    flash.mesh.material.dispose();
  }

  get aimAssistMode() {
    return this.aimAssistModes[this.aimAssistIndex];
  }

  cycleAimAssist() {
    this.aimAssistIndex = (this.aimAssistIndex + 1) % this.aimAssistModes.length;
    return this.aimAssistMode;
  }

  cycleManualTarget(ship, enemyManager) {
    const origin = ship.root.position;
    const nearby = enemyManager.enemies
      .filter((e) => e.hp > 0 && e.mesh.position.distanceTo(origin) < 1600)
      .sort((a, b) => a.mesh.position.distanceTo(origin) - b.mesh.position.distanceTo(origin));
    if (nearby.length === 0) {
      this.manualTargetId = null;
      return null;
    }
    const idx = nearby.findIndex((e) => e.id === this.manualTargetId);
    const next = nearby[(idx + 1) % nearby.length];
    this.manualTargetId = next.id;
    return next;
  }

  _leadTarget(enemy, ship, out) {
    const speed = WEAPON_CONFIG.railgunSpeed * (this.upgradeSystem?.isOverdriveActive ? 1.15 : 1);
    const offset = aimOffset.subVectors(enemy.mesh.position, ship.root.position);
    const vel = relativeAimVelocity.copy(enemy.vel).addScaledVector(ship.velocity, -0.35);
    const d2 = offset.lengthSq();
    const b = offset.dot(vel);
    const discriminant = b * b + (speed * speed - vel.lengthSq()) * d2;
    const denom = discriminant > 0 ? Math.sqrt(discriminant) - b : 0;
    const eta = denom > 1e-8 ? d2 / denom : Math.sqrt(d2) / speed;
    return out.copy(enemy.mesh.position).addScaledVector(vel, Math.min(1.25, eta));
  }

  getManualTrackPoint(ship, enemyManager) {
    let nearest = null;
    let nearestSq = 1800 ** 2;
    for (const enemy of enemyManager.enemies) {
      if (enemy.hp <= 0) continue;
      const d2 = enemy.mesh.position.distanceToSquared(ship.root.position);
      if (d2 >= 1800 ** 2) continue;
      if (enemy.id === this.manualTargetId) return this._leadTarget(enemy, ship, manualLead);
      if (d2 < nearestSq) {
        nearest = enemy;
        nearestSq = d2;
      }
    }
    const lock = this.aimAssistTarget;
    const target = lock?.hp > 0 && lock.mesh.position.distanceToSquared(ship.root.position) < 1800 ** 2 ? lock : nearest;
    return target ? this._leadTarget(target, ship, manualLead) : null;
  }

  _getStableAimRay(ship, cameraRig, outOrigin, outDir) {
    if (cameraRig?.getStableAimRay) return cameraRig.getStableAimRay(ship, outOrigin, outDir);
    outOrigin.copy(ship.root.position);
    outDir.copy(ship.getForward(outDir));
    return { origin: outOrigin, dir: outDir };
  }

  _updateAimAssist(ship, enemyManager, cameraRig, range = 1180, tracking = false) {
    const previous = this.aimAssistTarget;
    this.aimAssistTarget = null;
    this.hasAimAssistLock = false;
    if (this.aimAssistMode === 'OFF') return null;
    const { origin, dir } = this._getStableAimRay(ship, cameraRig, aimRayOrigin, aimRayDir);
    const minDot = this.aimAssistMode === 'STRONG' ? 0.958 : 0.978;
    let bestScore = -Infinity;
    for (const enemy of enemyManager.enemies) {
      if (enemy.hp <= 0) continue;
      const offset = aimOffset.subVectors(enemy.mesh.position, origin);
      const distance = offset.length();
      if (distance > range || distance < 6) continue;
      const dot = offset.dot(dir) / distance;
      if (dot < minDot) continue;
      const manual = enemy.id === this.manualTargetId;
      if (tracking && manual) {
        this.aimAssistTarget = enemy;
        break;
      }
      const score = dot - distance * 0.00004 + (enemy === previous ? 0.006 : 0) + (manual ? 0.015 : 0);
      if (score > bestScore) {
        this.aimAssistTarget = enemy;
        bestScore = score;
      }
    }
    if (!this.aimAssistTarget) return null;
    this.hasAimAssistLock = true;
    return this._leadTarget(this.aimAssistTarget, ship, this.aimAssistLeadPos);
  }

  _getAimPoint(ship, enemyManager, cameraRig, range = 900) {
    if (this.aimAssistMode !== 'OFF' && this.hasAimAssistLock && this.aimAssistTarget?.hp > 0) {
      return this.aimAssistLeadPos.clone();
    }
    return this._getReticleAimPoint(ship, enemyManager, cameraRig, range);
  }

  _getReticleAimPoint(ship, enemyManager, cameraRig, range) {
    const { origin, dir } = this._getStableAimRay(ship, cameraRig, aimRayOrigin, aimRayDir);
    aimRayEnd.copy(origin).addScaledVector(dir, range);
    const impact = findFirstImpact(origin, aimRayEnd, enemyManager?.enemies ?? [], this.solarSystem?.volatileCrystals, 1);
    if (impact && aimOffset.subVectors(impact.point, ship.root.position).dot(dir) > 8) {
      return impact.point.clone();
    }
    return aimRayEnd.clone();
  }

  _fireRailgun(ship, enemyManager, cameraRig) {
    const ocLv = this.upgradeSystem ? this.upgradeSystem.getLevel('railgun_overclock') : 0;
    const isOverdrive = this.upgradeSystem ? this.upgradeSystem.isOverdriveActive : false;
    this.shotCounter++;
    this.reticleBloom = Math.min(1, this.reticleBloom + 0.28);
    const shatter = this.shotCounter % 5 === 0 && this.upgradeSystem?.hasSynergy('shatter_rail');
    const dmgScale = (1 + ocLv * 0.18) * (isOverdrive ? 1.35 : 1.0) *
      (ship.loadout?.weaponDmgMult || 1) * (shatter ? 1.8 : 1);

    const barrels = ocLv > 0 || isOverdrive
      ? [SHIP_HARDPOINTS.railgunL, SHIP_HARDPOINTS.railgunR, SHIP_HARDPOINTS.gammaLance]
      : [this.barrelIndex % 2 === 0 ? SHIP_HARDPOINTS.railgunL : SHIP_HARDPOINTS.railgunR];

    const aimPoint = this._getAimPoint(ship, enemyManager, cameraRig, WEAPON_CONFIG.railgunRange);
    const hasGimbalLead = this.aimAssistMode !== 'OFF' && this.hasAimAssistLock && this.aimAssistTarget?.hp > 0;
    const projectileSpeed = WEAPON_CONFIG.railgunSpeed * (isOverdrive ? 1.15 : 1);

    for (const hardpoint of barrels) {
      const muzzleWorld = ship.getHardpointWorld(hardpoint);
      const dir = aimPoint.clone().sub(muzzleWorld).normalize();
      const velocity = dir.clone().multiplyScalar(projectileSpeed);
      if (hasGimbalLead) {
        velocity.addScaledVector(ship.velocity, 0.35);
      } else {
        // Keep forward momentum without letting side thrust move an unassisted shot off the reticle.
        velocity.addScaledVector(dir, 0.35 * ship.velocity.dot(dir));
      }

      const flightDir = velocity.clone().normalize();
      const pulse = new THREE.Mesh(this._pulseGeo, this._pulseMaterials[isOverdrive ? 1 : 0]);
      pulse.position.copy(muzzleWorld).addScaledVector(dir, LASER_CLEARANCE);
      pulse.lookAt(beamFacing.addVectors(pulse.position, flightDir));
      pulse.visible = false;
      this.scene.add(pulse);

      this.bolts.push({
        mesh: pulse,
        pos: muzzleWorld.clone(),
        dir,
        vel: velocity,
        flightDir,
        clearance: LASER_CLEARANCE / Math.max(0.1, flightDir.dot(dir)),
        traveled: 0,
        age: 0,
        life: WEAPON_CONFIG.railgunRange / WEAPON_CONFIG.railgunSpeed,
        damage: WEAPON_CONFIG.railgunDamage * dmgScale,
        shatter,
      });

      const flash = new THREE.Mesh(this._focusGeo, createFocusMaterial(isOverdrive ? '#ffc85c' : '#75eaff'));
      flash.position.copy(muzzleWorld).addScaledVector(dir, LASER_CLEARANCE);
      flash.lookAt(beamFacing.addVectors(flash.position, dir));
      this.scene.add(flash);
      this.muzzleFlashes.push({ mesh: flash, age: 0, life: 0.095 });
    }

    this.cockpit?.triggerMuzzleLight(isOverdrive ? '#ffd95e' : '#6ef2ff', 4.4);
    this.audio.playRailgun(this.barrelIndex, ocLv > 0 || isOverdrive);
    this.barrelIndex++;
  }

  _updateLocks(dt, ship, enemyManager) {
    this._progressiveLockTimer += dt;
    if (this._progressiveLockTimer < 0.08) return;
    this._progressiveLockTimer %= 0.08;

    const fwd = ship.getForward();
    const origin = ship.root.position;
    const candidates = [];

    for (const e of enemyManager.enemies) {
      if (e.hp <= 0) continue;
      const toE = aimOffset.subVectors(e.mesh.position, origin);
      const dist = toE.length();
      if (dist > 1100 || dist < 12) continue;
      const dot = toE.divideScalar(dist).dot(fwd);
      if (dot > 0.72) {
        candidates.push({ enemy: e, score: dot - dist * 0.00018 });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const maxLocks = WEAPON_CONFIG.missileSalvoCount + (this.bonusSalvo || 0);
    const eligible = candidates.map(({ enemy }) => enemy);
    this.lockedTargets = this.lockedTargets.filter((enemy) => eligible.includes(enemy)).slice(0, maxLocks);
    const next = eligible.find((enemy) => !this.lockedTargets.includes(enemy));
    if (this.lockedTargets.length < maxLocks && next) {
      this.lockedTargets.push(next);
      this.audio.playMissileLock(this.lockedTargets.length);
    }
  }

  _fireOverdriveMicroMissiles(ship, enemyManager) {
    this._launchMissiles(ship, enemyManager, true);
  }

  _launchMissiles(ship, enemyManager, micro = false) {
    if (!micro && this.missileAmmo <= 0) return;
    this.reticleBloom = Math.min(1, this.reticleBloom + 0.45);
    const targets = this.lockedTargets.filter((enemy) => enemy.hp > 0);
    if (targets.length === 0) {
      let nearest = null;
      let nearestSq = 1100 ** 2;
      for (const enemy of enemyManager.enemies) {
        if (enemy.hp <= 0) continue;
        const distanceSq = enemy.mesh.position.distanceToSquared(ship.root.position);
        if (distanceSq < nearestSq) {
          nearest = enemy;
          nearestSq = distanceSq;
        }
      }
      if (nearest) targets.push(nearest);
    }

    const count = micro ? 2 : Math.min(WEAPON_CONFIG.missileSalvoCount + this.bonusSalvo, this.missileAmmo);
    const speed = WEAPON_CONFIG.missileSpeed * (micro ? 1.15 : 1);
    const turnRate = WEAPON_CONFIG.missileTurnRate * (micro ? 1.35 : 1);
    const damage = WEAPON_CONFIG.missileDamage * (micro ? 0.65 : 1) * (ship.loadout?.weaponDmgMult || 1);
    const fwd = ship.getForward();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(ship.root.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ship.root.quaternion);

    for (let i = 0; i < count; i++) {
      const pod = SHIP_HARDPOINTS.missilePods[i % SHIP_HARDPOINTS.missilePods.length];
      const spawnPos = ship.getHardpointWorld(pod);
      const sideSign = i % 2 === 0 ? 1 : -1;
      const ejectDir = fwd
        .clone()
        .addScaledVector(right, sideSign * 0.52)
        .addScaledVector(up, 0.28 + (i > 1 ? -0.45 : 0))
        .normalize();

      const mesh = new THREE.Group();
      const exhaust = new THREE.Mesh(this._exhaustGeo, this._exhaustMat);
      exhaust.position.z = -0.79;
      exhaust.scale.set(0.24, 0.24, 0.39);
      mesh.add(new THREE.Mesh(this._missileGeo, this._missileMat), exhaust);
      if (micro) mesh.scale.setScalar(0.65);
      mesh.position.copy(spawnPos);
      mesh.lookAt(spawnPos.clone().add(ejectDir));
      this.scene.add(mesh);

      const nozzleOffset = micro ? 0.60 : 0.92;
      const trailHead = spawnPos.clone().addScaledVector(ejectDir, -nozzleOffset);
      const ribbon = new THREE.Mesh(createMissileTrailGeometry(), this._missileTrailMat);
      ribbon.frustumCulled = false;
      this.scene.add(ribbon);
      this.vfx.spawnMissileLaunchPuff?.(spawnPos, ejectDir);

      const target = targets.length > 0 ? targets[i % targets.length] : null;
      this.missiles.push({
        mesh,
        exhaust,
        ribbon,
        trailHead,
        trailNext: trailHead.clone(),
        historyPts: Array.from({ length: MISSILE_TRAIL_SEGMENTS }, () => trailHead.clone()),
        trailSamples: 0,
        trailSide: right.clone(),
        nozzleOffset,
        trailWidth: micro ? 0.40 : 0.67,
        pos: spawnPos.clone(),
        vel: ejectDir.multiplyScalar(speed),
        speed,
        turnRate,
        damage,
        target,
        age: 0,
        life: 5.5,
        trailTimer: 0,
      });
    }

    if (!micro) this.missileAmmo -= count;
    this.audio.playMissileLaunch();
  }

  _triggerEmp(ship, enemyManager, cameraRig) {
    if (this.empCooldown > 0) return;
    const cryoLv = this.upgradeSystem?.getLevel('cryo_singularity') || 0;
    this.empCooldown = WEAPON_CONFIG.empCooldown * Math.max(0.45, 1 - cryoLv * 0.18);
    const radius = WEAPON_CONFIG.empRadius + cryoLv * 22;
    const damage = WEAPON_CONFIG.empDamage * (ship.loadout?.weaponDmgMult || 1);
    const origin = ship.root.position.clone();

    this.vfx.spawnEmpWave(origin, radius, cryoLv ? '#7ef2ff' : '#4ce8ff');
    this.audio.playEmp();
    cameraRig.addShake(0.45);

    // Vaporize enemy projectiles inside EMP radius
    enemyManager.clearProjectilesInRadius(origin, radius);
    for (const crystal of this.solarSystem?.volatileCrystals || []) {
      if (crystal.mesh.position.distanceToSquared(origin) <= radius * radius) this._hitVolatileCrystal(crystal, damage * 1.5, enemyManager);
    }

    // Shock nearby enemies & force Droplet into vulnerable vent state
    for (const e of [...enemyManager.enemies]) {
      const dist = e.mesh.position.distanceTo(origin);
      if (dist <= radius + e.hitRadius && e.hp > 0) {
        const res = enemyManager.applyDamage(e, damage, e.mesh.position, 'emp');
        if (cryoLv && !res.killed) enemyManager.applyStatusEffect(e, { slowTimer: 4, vulnMult: 1.25 });
        if (e.type === 'droplet' && !res.killed) enemyManager.staggerDropletFromEmp(e, 4);
        if (this.onHitFeedback) {
          this.onHitFeedback(res.killed ? 'kill' : 'crit');
        }
      }
    }
  }

  _hitVolatileCrystal(crystal, damage, enemyManager) {
    if (crystal.cooldown > 0) return;
    crystal.hp -= damage;
    if (crystal.hp > 0) return;
    crystal.cooldown = 18;
    crystal.mesh.visible = false;
    const center = crystal.mesh.position;
    this.vfx.spawnExplosion(center, 18, crystal.colorHex);
    this.audio.playExplosion('capital', 0, 1);
    for (const enemy of [...enemyManager.enemies]) {
      if (enemy.hp <= 0 || enemy.mesh.position.distanceToSquared(center) > 68 ** 2) continue;
      enemyManager.applyDamage(enemy, 340, enemy.mesh.position, 'emp');
      enemyManager.applyStatusEffect(enemy, { slowTimer: 2.5, vulnMult: 1.15 });
    }
  }

  update(dt, ship, input, enemyManager, cameraRig, playMode, camera = null, elapsed = null) {
    this.reticleBloom = Math.max(0, this.reticleBloom - dt * 3.2);
    this.gammaArcTimer = Math.max(0, this.gammaArcTimer - dt);
    const railHeld = playMode === 'PLAYING' && ship.warpState === 'IDLE' && input.isActionDown('firePrimary');
    this.railTimer -= dt;
    if (!railHeld) this.railTimer = Math.max(0, this.railTimer);
    this.empCooldown = Math.max(0, this.empCooldown - dt);

    // Regenerate swarm missiles over time
    const maxAmmo = WEAPON_CONFIG.missileMaxAmmo + this.bonusMissileMax;
    if (this.missileAmmo < maxAmmo) {
      this.missileRegenTimer += dt;
      while (this.missileAmmo < maxAmmo && this.missileRegenTimer >= WEAPON_CONFIG.missileRegenTime) {
        this.missileRegenTimer -= WEAPON_CONFIG.missileRegenTime;
        this.missileAmmo++;
      }
      if (this.missileAmmo === maxAmmo) this.missileRegenTimer = 0;
    } else {
      this.missileRegenTimer = 0;
    }

    const ocLv = this.upgradeSystem ? this.upgradeSystem.getLevel('railgun_overclock') : 0;
    const prismLv = this.upgradeSystem ? this.upgradeSystem.getLevel('gamma_prism') : 0;
    const isOverdrive = this.upgradeSystem ? this.upgradeSystem.isOverdriveActive : false;

    const canFire = playMode === 'PLAYING' && ship.warpState === 'IDLE';

    if (canFire) {
      this._updateAimAssist(ship, enemyManager, cameraRig, WEAPON_CONFIG.railgunRange, input.isActionDown('autoTrack'));
      this._updateLocks(dt, ship, enemyManager);

      // Primary: Twin Railguns
      if (railHeld) {
        const rateMult = (1 + ocLv * 0.28) * (isOverdrive ? 1.45 : 1.0);
        const cooldown = WEAPON_CONFIG.railgunCooldown / rateMult;
        for (let shots = 0; this.railTimer <= 0 && shots < 2; shots++) {
          this.railTimer += cooldown;
          this._fireRailgun(ship, enemyManager, cameraRig);
        }
        this.railTimer = Math.max(0, this.railTimer);
      }

      // Secondary: Prow Gamma Particle Lance (Mouse Right or backup [R] to avoid browser right-drag gestures)
      const prismOverdrive = isOverdrive && this.upgradeSystem?.hasSynergy('prism_overdrive');
      if (prismOverdrive) {
        this.gammaHeat = 0;
        this.gammaOverheated = false;
      }
      const wantGamma = (input.isActionDown('fireSecondary') || input.isDown('KeyR')) && !this.gammaOverheated;
      if (wantGamma) {
        this.gammaActive = true;
        this.reticleBloom = Math.max(0.32, this.reticleBloom);
        if (!isOverdrive) {
          const heatMult = Math.max(0.45, 1 - prismLv * 0.22);
          this.gammaHeat = Math.min(100, this.gammaHeat + WEAPON_CONFIG.gammaHeatRate * heatMult * dt);
        }
        if (this.gammaHeat >= 100) {
          this.gammaOverheated = true;
          this.gammaActive = false;
        }
      } else {
        this.gammaActive = false;
      }

      if (isOverdrive && input.isActionDown('firePrimary')) {
        this.overdriveMissileTimer -= dt;
        if (this.overdriveMissileTimer <= 0) {
          this.overdriveMissileTimer = 0.85;
          this._fireOverdriveMicroMissiles(ship, enemyManager);
        }
      }

      // Swarm Missiles
      if (input.consumeAction('missiles')) {
        this._launchMissiles(ship, enemyManager);
      }

      // EMP Pulse
      if (input.consumeAction('emp')) {
        this._triggerEmp(ship, enemyManager, cameraRig);
      }
    } else {
      this.gammaActive = false;
      this.lockedTargets = [];
      this.hasAimAssistLock = false;
      this.aimAssistTarget = null;
    }

    // Cool down Gamma Lance
    if (!this.gammaActive) {
      this.gammaHeat = Math.max(0, this.gammaHeat - WEAPON_CONFIG.gammaCoolRate * dt);
      if (this.gammaOverheated && this.gammaHeat <= 38) {
        this.gammaOverheated = false;
      }
    }

    if (!isOverdrive) this.overdriveMissileTimer = 0;
    this.audio.setGammaActive(this.gammaActive);
    this._updateGammaBeam(dt, ship, enemyManager, cameraRig, elapsed);
    this._updateBolts(dt, enemyManager, camera);
    this._updateMissiles(dt, enemyManager);
    this._updateMuzzleFlashes(dt);
  }

  _updateGammaBeam(dt, ship, enemyManager, cameraRig = null, elapsed = null) {
    this.gammaFeedbackTimer = Math.max(0, this.gammaFeedbackTimer - dt);
    if (this.pendingGammaKillFeedback && this.gammaFeedbackTimer === 0) {
      this.pendingGammaKillFeedback = false;
      this.gammaFeedbackTimer = GAMMA_FEEDBACK_INTERVAL;
      this.onHitFeedback?.('kill');
    }
    if (!this.gammaActive) {
      this.gammaGroup.visible = false;
      return;
    }
    const muzzle = ship.getHardpointWorld(SHIP_HARDPOINTS.gammaLance, beamStart);
    const lockedTarget = this.aimAssistMode !== 'OFF' && this.hasAimAssistLock && this.aimAssistTarget?.hp > 0
      ? this.aimAssistTarget
      : null;
    const beamTarget = lockedTarget && muzzle.distanceTo(lockedTarget.mesh.position) <= WEAPON_CONFIG.gammaRange + 60
      ? lockedTarget.mesh.position
      : this._getReticleAimPoint(ship, enemyManager, cameraRig, WEAPON_CONFIG.gammaRange);
    const fwd = aimForward.subVectors(beamTarget, muzzle).normalize();
    const camera = cameraRig?.camera;

    beamEnd.copy(muzzle).addScaledVector(fwd, WEAPON_CONFIG.gammaRange);
    const impact = findFirstImpact(muzzle, beamEnd, enemyManager.enemies, this.solarSystem?.volatileCrystals, 1.18);
    const beamLen = WEAPON_CONFIG.gammaRange * (impact?.t ?? 1);
    const hitEnemy = impact?.target;
    const hitCrystal = impact?.crystal;
    const hitPos = impact && beamHit.copy(impact.point);
    this.gammaGroup.visible = true;
    this.gammaGroup.position.copy(muzzle);
    this.gammaGroup.lookAt(beamFacing.addVectors(muzzle, fwd));

    const tSec = elapsed ?? performance.now() * 0.001;
    const isOd = this.upgradeSystem ? this.upgradeSystem.isOverdriveActive : false;
    this.gammaCoreMat.uniforms.uTime.value = tSec;
    this.gammaCoreMat.uniforms.uOverdrive.value = isOd ? 1.0 : 0.0;
    this.gammaOuterMat.uniforms.uTime.value = tSec;
    this.gammaOuterMat.uniforms.uOverdrive.value = isOd ? 1.0 : 0.0;

    const pulse = 0.88 + 0.22 * Math.sin(tSec * 45.0);
    this.gammaCore.scale.set(pulse, pulse, beamLen);
    this.gammaOuter.scale.set(pulse * 1.15, pulse * 1.15, beamLen);
    this.gammaFocus.visible = beamLen > LASER_CLEARANCE;
    this.gammaFocus.rotation.z = tSec * 2.8;
    this.gammaFocus.scale.setScalar(1.1 + 0.28 * pulse);
    this.gammaFocus.material.uniforms.uColor.value.set(isOd ? '#ffd371' : '#55eaff');
    this.gammaFocus.material.uniforms.uTime.value = tSec;
    this.gammaImpact.visible = Boolean(hitPos) && beamLen > LASER_CLEARANCE;
    this.gammaImpact.position.z = Math.max(0, beamLen - 0.12);
    this.gammaImpact.scale.setScalar(1.3 + 0.40 * pulse);
    this.gammaImpact.material.uniforms.uColor.value.set(isOd ? '#ffe098' : '#a0f5ff');
    this.gammaImpact.material.uniforms.uTime.value = tSec;
    this.cockpit?.triggerMuzzleLight(isOd ? '#ffd95e' : '#58f2ff', 3.4);

    const prismLv = this.upgradeSystem?.getLevel('gamma_prism') || 0;
    const dps = WEAPON_CONFIG.gammaDps * (1 + prismLv * 0.38) * (isOd ? 1.5 : 1) * (ship.loadout?.weaponDmgMult || 1);
    const gDmg = dps * dt;
    if (hitCrystal) {
      if (this.gammaFeedbackTimer <= 0) {
        this.gammaFeedbackTimer = GAMMA_FEEDBACK_INTERVAL;
        this.vfx.spawnBeamImpact(hitPos, camera?.position, isOd ? '#ffe26a' : '#7ef6ff', fwd);
      }
      this._hitVolatileCrystal(hitCrystal, gDmg, enemyManager);
    } else if (hitEnemy && hitPos) {
      if (isOd && this.gammaArcTimer === 0 && this.upgradeSystem?.hasSynergy('prism_overdrive')) {
        let nearest = null;
        let distance = 26 ** 2;
        for (const other of enemyManager.enemies) {
          if (other === hitEnemy || other.hp <= 0) continue;
          const squared = other.mesh.position.distanceToSquared(hitPos);
          if (squared <= distance) {
            nearest = other;
            distance = squared;
          }
        }
        if (nearest) {
          this.gammaArcTimer = 0.18;
          this.vfx.spawnArcLink?.(hitPos, nearest.mesh.position, '#ffd95e');
          enemyManager.applyDamage(nearest, dps * 0.18 * 0.48, nearest.mesh.position, 'gamma');
        }
      }
      const res = enemyManager.applyDamage(hitEnemy, gDmg, hitPos, 'gamma');
      if (prismLv > 0) {
        for (const other of [...enemyManager.enemies]) {
          if (other.id !== hitEnemy.id && other.hp > 0 && other.mesh.position.distanceTo(hitPos) < 26 + prismLv * 8) {
            enemyManager.applyDamage(other, gDmg * 0.45, other.mesh.position, 'gamma');
          }
        }
      }
      if (this.gammaFeedbackTimer <= 0) {
        this.gammaFeedbackTimer = GAMMA_FEEDBACK_INTERVAL;
        if (res.shielded) {
          this.vfx.spawnEnemyShieldBubble(hitEnemy.mesh.position, hitEnemy.hitRadius, hitPos, '#52eeff');
        } else {
          this.vfx.spawnBeamImpact(hitPos, camera?.position, isOd ? '#ffe26a' : '#7ef6ff', fwd);
        }
        this.onHitFeedback?.(res.killed ? 'kill' : res.crit ? 'crit' : res.shielded ? 'shield' : 'hit');
      } else if (res.killed) {
        // Preserve a fatal-hit cue without adding a second effect in the same interval.
        this.pendingGammaKillFeedback = true;
      }
    }
  }

  _updateBolts(dt, enemyManager, camera = null) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.age += dt;
      if (b.age >= b.life) {
        this.scene.remove(b.mesh);
        this.bolts.splice(i, 1);
        continue;
      }

      projectileStart.copy(b.pos);
      b.pos.addScaledVector(b.vel, dt);
      const impact = findFirstImpact(projectileStart, b.pos, enemyManager.enemies, this.solarSystem?.volatileCrystals, 1.12);
      if (!impact) {
        b.traveled += b.vel.length() * dt;
        const length = Math.min(18, Math.max(0, b.traveled - b.clearance));
        const width = b.shatter ? 0.56 : 0.41;
        b.mesh.visible = length > 0;
        b.mesh.position.copy(b.pos).addScaledVector(b.flightDir, -length);
        b.mesh.scale.set(width, width, length);
        continue;
      }
      const { target, crystal } = impact;
      const point = projectileHit.copy(impact.point);
      if (target) {
        const result = enemyManager.applyDamage(target, b.damage, point, 'railgun');
        if (result.crit) {
          this.vfx.spawnCritHit(point, b.dir, camera?.position, aimOffset.subVectors(point, target.mesh.position));
        } else if (result.shielded) {
          this.vfx.spawnEnemyShieldBubble(target.mesh.position, target.hitRadius, point, '#52eeff');
        } else {
          this.vfx.spawnArmorHit(point, b.dir, camera?.position, aimOffset.subVectors(point, target.mesh.position));
        }
        this.onHitFeedback?.(result.killed ? 'kill' : result.crit ? 'crit' : result.shielded ? 'shield' : 'hit');
      } else {
        this.vfx.spawnEnemyShieldBubble(crystal.mesh.position, crystal.hitRadius, point, crystal.colorHex);
        this._hitVolatileCrystal(crystal, b.damage, enemyManager);
      }
      if (b.shatter) this._shatterBolt(b, point, target, enemyManager);
      this.scene.remove(b.mesh);
      this.bolts.splice(i, 1);
    }
  }

  _shatterBolt(bolt, point, directTarget, enemyManager) {
    this.vfx.spawnExplosion(point, 4.5, '#ff8844');
    for (const enemy of [...enemyManager.enemies]) {
      if (enemy !== directTarget && enemy.hp > 0 && enemy.mesh.position.distanceToSquared(point) <= 18 ** 2) {
        enemyManager.applyDamage(enemy, bolt.damage * 0.55, point, 'railgun');
      }
    }
  }

  _detonateMissile(missile, point, target, directCrystal, enemyManager) {
    const rackLv = this.upgradeSystem?.getLevel('swarm_rack') || 0;
    const damage = missile.damage * (1 + rackLv * 0.2);
    const splashRadiusSquared = (16 + rackLv * 9) ** 2;
    const cryo = this.upgradeSystem?.hasSynergy('cryo_swarm');
    let directResult = null;
    for (const enemy of [...enemyManager.enemies]) {
      if (enemy.hp <= 0 || (enemy !== target && enemy.mesh.position.distanceToSquared(point) > splashRadiusSquared)) continue;
      const result = enemyManager.applyDamage(enemy, enemy === target ? damage : damage * 0.55, point, 'missile');
      if (enemy === target) directResult = result;
      if (cryo) enemyManager.applyStatusEffect(enemy, { slowTimer: 2.8, vulnMult: 1.15 });
    }
    for (const crystal of this.solarSystem?.volatileCrystals || []) {
      if (crystal === directCrystal || crystal.mesh.position.distanceToSquared(point) <= splashRadiusSquared) {
        this._hitVolatileCrystal(crystal, crystal === directCrystal ? damage : damage * 0.55, enemyManager);
      }
    }
    this.vfx.spawnExplosion(point, 8.2 + rackLv * 1.4, '#ff9e38', true);
    this.audio.playExplosion('small');
    if (directResult) this.onHitFeedback?.(directResult.killed ? 'kill' : directResult.crit ? 'crit' : directResult.shielded ? 'shield' : 'hit');
  }

  _updateMissiles(dt, enemyManager) {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.age += dt;
      if (m.age >= m.life) {
        this._removeMissile(m);
        this.missiles.splice(i, 1);
        continue;
      }

      missileHeading.copy(m.vel).normalize();
      if (m.target && m.target.hp > 0 && m.age > 0.14) {
        missileDesired.subVectors(m.target.mesh.position, m.pos).normalize();
        missileHeading.lerp(missileDesired, Math.min(1, dt * m.turnRate)).normalize();
      }
      m.vel.copy(missileHeading).multiplyScalar(m.speed);

      projectileStart.copy(m.pos);
      m.pos.addScaledVector(m.vel, dt);
      m.mesh.position.copy(m.pos);
      m.mesh.lookAt(missileFacing.addVectors(m.pos, m.vel));

      m.exhaust.scale.z = 0.35 + 0.13 * Math.sin(m.age * 78);
      this._updateMissileTrail(m, dt);

      const impact = findFirstImpact(projectileStart, m.pos, enemyManager.enemies, this.solarSystem?.volatileCrystals, 1, 2.4);
      if (impact) {
        const point = projectileHit.copy(impact.point);
        this._detonateMissile(m, point, impact.target, impact.crystal, enemyManager);
        this._removeMissile(m);
        this.missiles.splice(i, 1);
      }
    }
  }

  _updateMissileTrail(missile, dt) {
    if (dt <= 0) return;
    const previousSamples = missile.trailSamples;
    missile.trailNext.copy(missile.pos).addScaledVector(missileHeading, -missile.nozzleOffset);
    let sampleTime = MISSILE_TRAIL_STEP - missile.trailTimer;
    while (sampleTime <= dt) {
      const point = missile.historyPts.pop();
      point.lerpVectors(missile.trailHead, missile.trailNext, sampleTime / dt);
      missile.historyPts.unshift(point);
      missile.trailSamples = Math.min(MISSILE_TRAIL_SEGMENTS, missile.trailSamples + 1);
      sampleTime += MISSILE_TRAIL_STEP;
    }
    missile.trailTimer = MISSILE_TRAIL_STEP - (sampleTime - dt);
    missile.trailHead.copy(missile.trailNext);

    const geometry = missile.ribbon.geometry;
    const positions = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    const samples = missile.trailSamples;
    const grew = samples !== previousSamples;
    for (let row = 0; row <= samples; row++) {
      const point = row === 0 ? missile.trailHead : missile.historyPts[row - 1];
      const before = row <= 1 ? missile.trailHead : missile.historyPts[row - 2];
      const after = row < samples ? missile.historyPts[row] : point;
      trailTangent.subVectors(before, after);
      if (trailTangent.lengthSq() < 1e-8) trailTangent.copy(missileHeading);
      trailTangent.normalize();
      // Keep the two ribbon planes from spinning when a missile climbs through vertical.
      const previousSide = row === 0 ? missile.trailSide : trailSide;
      const dot = previousSide.dot(trailTangent);
      trailSide.copy(previousSide).addScaledVector(trailTangent, -dot);
      if (trailSide.lengthSq() < 1e-6) {
        trailSide.crossVectors(trailTangent, Math.abs(trailTangent.y) < 0.9 ? axisY : axisX);
      }
      trailSide.normalize();
      if (row === 0) missile.trailSide.copy(trailSide);
      trailUp.crossVectors(trailTangent, trailSide).normalize();
      const progress = samples ? row / samples : 0;
      const width = missile.trailWidth * (1 - progress);
      for (let side = 0; side < 4; side++) {
        const axis = side < 2 ? trailSide : trailUp;
        const offset = side % 2 ? width : -width;
        const index = row * 4 + side;
        positions.setXYZ(index, point.x + axis.x * offset, point.y + axis.y * offset, point.z + axis.z * offset);
        if (grew) uv.setY(index, progress);
      }
    }
    positions.needsUpdate = true;
    if (grew) {
      uv.needsUpdate = true;
      geometry.setDrawRange(0, samples * 12);
    }
  }

  _updateMuzzleFlashes(dt) {
    for (let i = this.muzzleFlashes.length - 1; i >= 0; i--) {
      const f = this.muzzleFlashes[i];
      f.age += dt;
      if (f.age >= f.life) {
        this._removeMuzzleFlash(f);
        this.muzzleFlashes.splice(i, 1);
      } else {
        const t = f.age / f.life;
        f.mesh.scale.setScalar(0.38 + t * 0.34);
        f.mesh.material.uniforms.uOpacity.value = (1 - t) ** 1.6;
        f.mesh.material.uniforms.uTime.value = f.age;
      }
    }
  }
}
