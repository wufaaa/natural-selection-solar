import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { SHIP_CONFIG, SHIP_HARDPOINTS } from '../core/Constants.js';

function createSeedRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildExhaustPlumeGeometry() {
  const pts = Array.from({ length: 46 }, (_, i) => {
    const r = i / 45;
    const rad = ((1.36 + 3.9 * r) * Math.pow(1 - r, 1.3) + 0.015) * 0.1;
    return new THREE.Vector2(rad, r * 2.7);
  });
  const geo = new THREE.LatheGeometry(pts, 52);
  // Rotate +Y -> +Z (aft)
  geo.rotateX(Math.PI * 0.5);
  return geo;
}

function createExhaustLayerMaterial(layer, phase) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      heat: { value: 0.6 },
      elapsed: { value: 0 },
      layer: { value: layer },
      phase: { value: phase },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 tex;
      varying vec3 nrm;
      varying vec3 view;
      uniform float elapsed;
      uniform float phase;
      void main() {
        tex = uv;
        nrm = normalize(normalMatrix * normal);
        vec3 v = position;
        float a = tex.x * 6.2831853;
        v.xy *= 1.0 + tex.y * (0.09 * sin(a * 5.0 + tex.y * 28.0 - elapsed * 11.0 + phase)
                             + 0.035 * sin(a * 9.0 - tex.y * 35.0 + elapsed * 7.0));
        vec4 p = modelViewMatrix * vec4(v, 1.0);
        view = -p.xyz;
        gl_Position = projectionMatrix * p;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      varying vec2 tex;
      varying vec3 nrm;
      varying vec3 view;
      uniform float heat;
      uniform float elapsed;
      uniform float layer;
      uniform float phase;
      void main() {
        float u = tex.y;
        float a = tex.x * 6.2831853;
        float shell = pow(abs(dot(normalize(nrm), normalize(view))), 2.35);
        float cells = pow(0.5 + 0.5 * cos(u * 44.0 + 0.40 * cos(a * 3.0 + phase)), 4.5) * exp(-u * 3.1);
        float threads = 0.66 + 0.34 * sin(a * 8.0 + u * 48.0 - elapsed * 22.0 + phase + 1.1 * sin(a * 5.0 - u * 19.0));
        float turbulent = 0.69 + 0.31 * sin(u * 79.0 - elapsed * 27.0 + sin(a * 6.0 + u * 18.0) * 1.6);
        float tail = pow(max(0.0, 1.0 - u), 2.36);

        vec3 cold = mix(vec3(0.025, 0.16, 1.25), vec3(0.28, 0.055, 1.15), smoothstep(0.18, 0.90, u));
        vec3 hot = mix(vec3(1.12, 1.82, 3.05), vec3(0.16, 0.56, 2.2), smoothstep(0.07, 0.82, u));
        vec3 tint = layer < 0.5 ? cold : (layer < 1.5 ? mix(cold, hot, 0.58) : hot);
        float strength = layer < 0.5 ? 0.34 : (layer < 1.5 ? 0.52 : 0.66);
        float alpha = shell * tail * heat * strength * (threads * turbulent * 0.69 + 0.31 + cells * 0.48);

        gl_FragColor = vec4(tint, clamp(alpha, 0.0, 1.0));
        #include <logdepthbuf_fragment>
      }
    `,
  });
}

function createHelicalStreakSystem(nozzleIndex) {
  const count = 230;
  const rng = createSeedRng(241 + nozzleIndex);
  const seeds = Array.from({ length: count }, () => [rng(), rng(), rng()]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 6), 3));
  geo.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(count * 2), 1));
  geo.userData.seeds = seeds;

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float glow;
      varying float brightness;
      void main() {
        brightness = glow;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      varying float brightness;
      void main() {
        vec3 col = mix(vec3(0.19, 0.35, 1.0), vec3(0.84, 0.93, 1.0), min(1.0, brightness));
        gl_FragColor = vec4(col, clamp(brightness, 0.0, 1.0));
        #include <logdepthbuf_fragment>
      }
    `,
  });

  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  return lines;
}

function createShieldShell() {
  const geo = new THREE.SphereGeometry(1, 42, 30);
  geo.scale(2.85, 1.15, 5.55);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uHitPoint: { value: new THREE.Vector3(0, 0, -5) },
      uHitAge: { value: 10.0 },
      uShieldRatio: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vLocalPos;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        vLocalPos = position;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPos.xyz);
        vNormalV = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mvPos;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uTime;
      uniform vec3 uHitPoint;
      uniform float uHitAge;
      uniform float uShieldRatio;
      varying vec3 vLocalPos;
      varying vec3 vNormalV;
      varying vec3 vViewDir;

      // Crisp procedural hex distance in 2D
      float hexPattern(vec2 p) {
        p *= 3.8;
        vec2 r = vec2(1.0, 1.7320508);
        vec2 h = r * 0.5;
        vec2 a = mod(p, r) - h;
        vec2 b = mod(p - h, r) - h;
        vec2 gv = dot(a, a) < dot(b, b) ? a : b;
        float edgeDist = 0.5 - max(abs(gv.x), dot(abs(gv), normalize(r)));
        return 1.0 - smoothstep(0.0, 0.08, edgeDist);
      }

      void main() {
        if (uHitAge > 0.85 || uShieldRatio <= 0.01) discard;

        float fade = pow(max(0.0, 1.0 - uHitAge / 0.85), 1.6);
        float dHit = distance(vLocalPos, uHitPoint);
        float rippleRadius = uHitAge * 9.5;
        float ringArg = (dHit - rippleRadius) * 1.4;
        float ring = exp(-(ringArg * ringArg));
        float hotspot = exp(-dHit * 0.65);

        float hex = hexPattern(vec2(vLocalPos.x * 1.4 + vLocalPos.y, vLocalPos.z * 1.1));
        float fresnel = pow(1.0 - clamp(dot(normalize(vNormalV), normalize(vViewDir)), 0.0, 1.0), 2.2);

        float intensity = fade * (hotspot * 0.85 + ring * 1.15 + fresnel * 0.35) * (0.28 + 0.85 * hex);
        vec3 col = mix(vec3(0.15, 0.72, 1.6), vec3(1.2, 2.2, 2.8), clamp(ring + hotspot * 0.5, 0.0, 1.0));

        gl_FragColor = vec4(col, clamp(intensity, 0.0, 0.88));
        #include <logdepthbuf_fragment>
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 0.14, -0.15);
  return { mesh, mat };
}

export class NaturalSelectionShip {
  constructor(scene, textures) {
    this.scene = scene;
    this.textures = textures;

    // Flight root (world pos + true flight orientation, -Z forward)
    this.root = new THREE.Group();
    this.scene.add(this.root);

    // Visual sub-root (applies subtle inertial banking/pitch attitude)
    this.visualGroup = new THREE.Group();
    this.root.add(this.visualGroup);

    // Steady bridge cockpit mount attached to flight root so barrel rolls don't spin interior walls around camera
    this.cockpitMount = new THREE.Group();
    this.root.add(this.cockpitMount);

    this.modelGroup = null;
    this.loaded = false;
    this.navBeaconMats = [];
    this.reactorMats = [];
    this.hullArmorMats = [];
    this.loadout = null;
    this.settings = { mouseSensitivity: 1.0, invertPitch: false, autoLevel: true, shakeScale: 0.75, reduceMotion: true };

    // 1:1 Ported triple-nozzle 3-layer LatheGeometry flames + 690 helical plasma streak particles
    this.nozzles = [];
    this.exhaustThrust = 0.55;
    this._setupThrusters();

    // Directional hex shield shell
    const shield = createShieldShell();
    this.shieldMesh = shield.mesh;
    this.shieldMat = shield.mat;
    this.visualGroup.add(this.shieldMesh);

    // Flight & combat state
    this.velocity = new THREE.Vector3();
    this.prevPosition = new THREE.Vector3();
    this.hull = SHIP_CONFIG.maxHull;
    this.shield = SHIP_CONFIG.maxShield;
    this.maxShieldBonus = 0;
    this.shieldRegenMult = 1.0;
    this.boostDrainMult = 1.0;
    this.boost = SHIP_CONFIG.maxBoost;
    this.timeSinceDamage = 10;
    this.damagePulse = 0;
    this.onShieldBreak = null;
    this.onShieldRestore = null;
    this.onPerfectDodge = null;
    this._shieldWasDepleted = false;

    this.isBoosting = false;
    this.gestureBoostExhausted = false;
    this.throttle = 0.25;
    this.bankAngle = 0;
    this.pitchOffset = 0;
    this.yawVel = 0;
    this.pitchVel = 0;

    // Double-tap A / D Phase Barrel-Roll Dodge state
    this.dodgeTimer = 0;
    this.dodgeDir = 0;
    this.dodgeCooldown = 0;
    this.dodgePerfectTriggered = false;
    this._tapLeftTime = -1;
    this._tapRightTime = -1;
    this._wasLeftDown = false;
    this._wasRightDown = false;

    // Warp state
    this.warpState = 'IDLE'; // IDLE | CHARGING | WARPING
    this.warpTimer = 0;
    this.warpTargetId = null;
    this.warpTargetPos = new THREE.Vector3();
    this.warpWaypoints = [];

    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._qYaw = new THREE.Quaternion();
    this._qPitch = new THREE.Quaternion();
    this._qRoll = new THREE.Quaternion();
  }

  _setupThrusters() {
    const plumeGeo = buildExhaustPlumeGeometry();
    const nozzleCoords = [
      new THREE.Vector3(0.825, -0.035, 4.755),
      new THREE.Vector3(0.0, 0.05, 4.755),
      new THREE.Vector3(-0.825, -0.035, 4.755),
    ];

    nozzleCoords.forEach((pos, idx) => {
      const flames = [0, 1, 2].map((layer) => {
        const mesh = new THREE.Mesh(plumeGeo, createExhaustLayerMaterial(layer, pos.x * 3.7));
        mesh.position.copy(pos);
        mesh.frustumCulled = false;
        this.visualGroup.add(mesh);
        return mesh;
      });

      const particles = createHelicalStreakSystem(idx);
      particles.position.copy(pos);
      this.visualGroup.add(particles);

      const spill = new THREE.PointLight('#468cff', 3.5, 4.5, 2.0);
      spill.position.set(pos.x, pos.y, 4.91);
      this.visualGroup.add(spill);

      this.nozzles.push({ flames, particles, spill });
    });
  }

  async load() {
    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('./draco/gltf/');
    loader.setDRACOLoader(dracoLoader);

    const gltf = await loader.loadAsync('./assets/natural_selection.glb');
    this.modelGroup = gltf.scene;

    const { normalMap, roughnessMap } = this.textures;
    const processedMats = new Set();

    this.modelGroup.traverse((child) => {
      if (!child.isMesh) return;
      child.frustumCulled = false;
      const mat = child.material;
      if (!mat || processedMats.has(mat.uuid)) return;
      processedMats.add(mat.uuid);

      const name = mat.name || '';
      if (name.includes('Blue-white reactor light')) {
        mat.emissiveIntensity = 3.8;
        this.reactorMats.push(mat);
      } else if (name.includes('Ion-blue plasma ring')) {
        mat.emissiveIntensity = 2.8;
        this.reactorMats.push(mat);
      } else if (name.includes('Warm cabin lamps')) {
        mat.emissiveIntensity = 2.15;
      } else if (name.includes('Cold task lamps')) {
        mat.emissiveIntensity = 1.85;
      } else if (name.includes('Red navigation lamps')) {
        mat.emissiveIntensity = 3.0;
        this.navBeaconMats.push(mat);
      } else if (
        name.includes('Armor') ||
        name.includes('Gunmetal') ||
        name.includes('Machined titanium') ||
        name.includes('Heat-stained bronze') ||
        name.includes('Oxide-red')
      ) {
        mat.normalMap = normalMap;
        mat.normalScale = new THREE.Vector2(0.42, 0.42);
        mat.roughnessMap = roughnessMap;
        mat.envMapIntensity = 1.45;
        if (name.includes('Armor') || name.includes('Machined titanium')) {
          this.hullArmorMats.push({ mat, baseColor: mat.color.clone() });
        }
      } else {
        mat.envMapIntensity = 1.25;
      }
      mat.needsUpdate = true;
    });

    this.visualGroup.add(this.modelGroup);
    this.loaded = true;
    if (this.loadout) this.applyLoadout(this.loadout);
  }

  applyLoadout(loadoutDef, refillShield = false) {
    this.loadout = loadoutDef || null;
    if (!loadoutDef) return;
    this.shield = refillShield ? this.effectiveMaxShield : Math.min(this.shield, this.effectiveMaxShield);
    if (this.shieldMat?.uniforms) {
      this.shieldMat.uniforms.uShieldRatio.value = this.shield / this.effectiveMaxShield;
    }
    const tint = new THREE.Color(loadoutDef.hullTint || '#ffffff');
    for (const entry of this.hullArmorMats) {
      entry.mat.color.copy(entry.baseColor).lerp(tint, 0.45);
    }
    if (loadoutDef.reactorColor) {
      const rCol = new THREE.Color(loadoutDef.reactorColor);
      for (const n of this.nozzles) {
        n.spill.color.copy(rCol);
      }
    }
  }

  get effectiveMaxShield() {
    return Math.max(120, SHIP_CONFIG.maxShield + (this.loadout?.shieldBonus || 0) + (this.maxShieldBonus || 0));
  }

  get isInvulnerable() {
    return this.dodgeTimer > 0.05;
  }

  triggerPerfectDodge() {
    if (!this.isInvulnerable || this.dodgePerfectTriggered) return false;
    this.dodgePerfectTriggered = true;
    this.onPerfectDodge?.();
    return true;
  }

  resetAt(position, lookTarget) {
    this.gestureBoostExhausted = false;
    this.root.position.copy(position);
    this.prevPosition.copy(position);
    this.velocity.set(0, 0, 0);
    this.maxShieldBonus = 0;
    this.shieldRegenMult = 1.0;
    this.boostDrainMult = 1.0;
    this.hull = SHIP_CONFIG.maxHull;
    this.shield = this.effectiveMaxShield;
    this.boost = SHIP_CONFIG.maxBoost;
    this._shieldWasDepleted = false;
    this.warpState = 'IDLE';
    this.warpTimer = 0;
    this.warpTargetId = null;
    this.throttle = 0;
    this.isBoosting = false;
    this.timeSinceDamage = 999;
    this.damagePulse = 0;
    this.yawVel = 0;
    this.pitchVel = 0;
    this.bankAngle = 0;
    this.pitchOffset = 0;
    this.dodgeTimer = 0;
    this.dodgeDir = 0;
    this.dodgeCooldown = 0;
    this.dodgePerfectTriggered = false;
    this._tapLeftTime = -1;
    this._tapRightTime = -1;
    this._wasLeftDown = false;
    this._wasRightDown = false;
    if (this.shieldMat?.uniforms) {
      this.shieldMat.uniforms.uHitAge.value = 10.0;
      this.shieldMat.uniforms.uShieldRatio.value = 1.0;
    }

    if (lookTarget) {
      const m = new THREE.Matrix4().lookAt(position, lookTarget, new THREE.Vector3(0, 1, 0));
      this.root.quaternion.setFromRotationMatrix(m);
    }
    this.visualGroup.rotation.set(0, 0, 0);
  }

  setFirstPersonMode(isFP) {
    if (this.modelGroup) {
      this.modelGroup.visible = !isFP;
    }
  }

  startWarp(targetId, targetWorldPos, waypoints = null) {
    this.warpTargetId = targetId;
    this.warpTargetPos.copy(targetWorldPos);
    this.warpWaypoints = Array.isArray(waypoints) && waypoints.length
      ? waypoints.map((p) => p.clone())
      : [targetWorldPos.clone()];
    this.warpState = 'CHARGING';
    this.warpTimer = 0;
  }

  updateWarpTarget(liveWorldPos) {
    if (!liveWorldPos || this.warpState === 'IDLE') return;
    this.warpTargetPos.copy(liveWorldPos);
    if (this.warpWaypoints.length > 0) {
      this.warpWaypoints[this.warpWaypoints.length - 1].copy(liveWorldPos);
    }
  }

  replaceWarpWaypoints(waypoints) {
    if (this.warpState === 'IDLE' || !Array.isArray(waypoints) || !waypoints.length) return;
    this.warpWaypoints = waypoints.map((p) => p.clone());
    this.warpTargetPos.copy(this.warpWaypoints[this.warpWaypoints.length - 1]);
  }

  cancelWarp() {
    this.warpState = 'IDLE';
    this.warpTimer = 0;
    this.warpWaypoints.length = 0;
  }

  takeDamage(amount, hitWorldPos = null) {
    if (this.isInvulnerable) {
      return { shielded: true, hullDamaged: false, evaded: true };
    }
    this.timeSinceDamage = 0;
    this.damagePulse = Math.min(1, this.damagePulse + 0.55);

    if (hitWorldPos) {
      const localHit = this.visualGroup.worldToLocal(hitWorldPos.clone());
      this.shieldMat.uniforms.uHitPoint.value.set(
        localHit.x / 2.85,
        (localHit.y - 0.14) / 1.15,
        (localHit.z + 0.15) / 5.55
      );
      this.shieldMat.uniforms.uHitAge.value = 0.0;
    } else {
      this.shieldMat.uniforms.uHitPoint.value.set(0, 0.2, -0.9);
      this.shieldMat.uniforms.uHitAge.value = 0.0;
    }

    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, amount);
      this.shield -= absorbed;
      const leftover = amount - absorbed;
      if (this.shield <= 0) {
        this._shieldWasDepleted = true;
        if (this.onShieldBreak) this.onShieldBreak();
      }
      if (leftover > 0) {
        this.hull = Math.max(0, this.hull - leftover);
      }
      return { shielded: absorbed > 0, hullDamaged: leftover > 0 };
    } else {
      this._shieldWasDepleted = true;
      this.hull = Math.max(0, this.hull - amount);
      return { shielded: false, hullDamaged: true };
    }
  }

  healHull(amount) {
    if (this.hull <= 0) return;
    this.hull = Math.min(SHIP_CONFIG.maxHull, this.hull + amount);
  }

  rechargeShield(amount) {
    if (this.hull <= 0) return;
    const prev = this.shield;
    this.shield = Math.min(this.effectiveMaxShield, this.shield + amount);
    if (this._shieldWasDepleted && prev <= 0 && this.shield > 0) {
      this._shieldWasDepleted = false;
      this.onShieldRestore?.();
    }
  }

  getForward(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.root.quaternion).normalize();
  }

  getHardpointWorld(localVec, out = new THREE.Vector3()) {
    out.copy(localVec);
    return this.visualGroup.localToWorld(out);
  }

  triggerDodge(direction) {
    if ((direction !== 'LEFT' && direction !== 'RIGHT') || this.hull <= 0
      || this.warpState !== 'IDLE' || this.dodgeCooldown > 0) return false;
    this.dodgeTimer = 0.46;
    this.dodgeDir = direction === 'LEFT' ? 1 : -1;
    this.dodgeCooldown = 1.4 * (this.loadout?.dodgeCdMult || 1.0);
    this.dodgePerfectTriggered = false;
    this.onDodge?.();
    return true;
  }

  update(dt, time, input, playMode, onWarpComplete, assistOptions = null, isWarpSegmentClear = null) {
    this.prevPosition.copy(this.root.position);
    this.timeSinceDamage += dt;
    this.damagePulse = Math.max(0, this.damagePulse - dt * 2.2);

    // Shield hit ripple timer + passive regeneration
    this.shieldMat.uniforms.uTime.value = time;
    this.shieldMat.uniforms.uHitAge.value += dt;
    this.shieldMat.uniforms.uShieldRatio.value = this.shield / this.effectiveMaxShield;

    if (this.timeSinceDamage > SHIP_CONFIG.shieldRegenDelay && this.shield < this.effectiveMaxShield && playMode === 'PLAYING' && this.hull > 0) {
      this.shield = Math.min(this.effectiveMaxShield, this.shield + SHIP_CONFIG.shieldRegenRate * (this.shieldRegenMult || 1.0) * dt);
      if (this._shieldWasDepleted && this.shield > 0) {
        this._shieldWasDepleted = false;
        this.onShieldRestore?.();
      }
    }

    // Navigation strobe beacon pulse
    const strobe = 0.5 + 0.5 * Math.sin(time * 4.5);
    const pulse = 1.1 + Math.pow(strobe, 6.0) * 3.8;
    for (const m of this.navBeaconMats) {
      m.emissiveIntensity = pulse;
    }

    // If on Title screen, gentle majestic autopilot cruise above Earth
    if (playMode === 'TITLE') {
      this._updateThrusters(dt, time, 0.52, false);
      const fwd = this.getForward(this._forward);
      this.velocity.copy(fwd).multiplyScalar(14);
      this.root.position.addScaledVector(this.velocity, dt);
      this.root.rotateY(dt * 0.045);
      return;
    }

    if (playMode !== 'PLAYING') {
      this._updateThrusters(dt, time, 0.25, false);
      return;
    }

    // Quantum Warp autopilot sequence (supports elevated waypoint detour around solar/planetary obstacles)
    if (this.warpState !== 'IDLE') {
      const finalTarget = this.warpTargetPos;
      if (this.warpState === 'WARPING' && this.warpWaypoints.length > 1) {
        const wp = this.warpWaypoints[0];
        const nextWp = this.warpWaypoints[1];
        const distToWp = wp.distanceTo(this.root.position);
        // Never skip a protective detour via unbounded half-space projection; advance only upon reaching
        // the detour node or once within outer shoulder proximity with a verified clear next leg.
        if (
          distToWp < 95 ||
          (distToWp < 220 && typeof isWarpSegmentClear === 'function' && isWarpSegmentClear(this.root.position, nextWp))
        ) {
          this.warpWaypoints.shift();
        }
      }
      const steerTarget = this.warpWaypoints.length > 0 ? this.warpWaypoints[0] : finalTarget;
      const toTarget = steerTarget.clone().sub(this.root.position);
      const dist = toTarget.length();
      const desiredDir = dist > 0.001 ? toTarget.clone().normalize() : this.getForward();
      const targetMatrix = new THREE.Matrix4().lookAt(
        this.root.position,
        steerTarget,
        new THREE.Vector3(0, 1, 0)
      );
      const targetQuat = new THREE.Quaternion().setFromRotationMatrix(targetMatrix);

      if (this.warpState === 'CHARGING') {
        this.warpTimer += dt;
        const chargeFrac = Math.min(1, this.warpTimer / SHIP_CONFIG.warpChargeTime);
        this.root.quaternion.slerp(targetQuat, Math.min(1, dt * 5.2));
        this.velocity.multiplyScalar(Math.exp(-4.0 * dt));
        this._updateThrusters(dt, time, 0.95 + chargeFrac * 0.45, true);

        const jitter = chargeFrac * (this.settings?.reduceMotion ? 0.008 : 0.018);
        this.visualGroup.rotation.z = Math.sin(time * 58) * jitter;
        this.visualGroup.rotation.x = Math.cos(time * 47) * jitter * 0.7;

        if (this.warpTimer >= SHIP_CONFIG.warpChargeTime) {
          this.warpState = 'WARPING';
        }
      } else if (this.warpState === 'WARPING') {
        const finalDist = this.warpTargetPos.distanceTo(this.root.position);
        const speed = this.warpWaypoints.length <= 1 && finalDist < 480
          ? Math.max(180, finalDist * 4.2)
          : SHIP_CONFIG.warpSpeed;
        this.root.quaternion.slerp(targetQuat, Math.min(1, dt * 8.0));
        this.velocity.copy(desiredDir).multiplyScalar(speed);
        const stepLen = Math.min(speed * dt, this.warpWaypoints.length > 1 ? Math.max(dist, 0) : finalDist);
        this.root.position.addScaledVector(desiredDir, stepLen);
        if (this.warpWaypoints.length > 1 && this.warpWaypoints[0].distanceTo(this.root.position) < 95) {
          this.warpWaypoints.shift();
        }
        this._updateThrusters(dt, time, 1.35, true);
        this.visualGroup.rotation.z = THREE.MathUtils.lerp(this.visualGroup.rotation.z, 0, dt * 6);
        this.visualGroup.rotation.x = THREE.MathUtils.lerp(this.visualGroup.rotation.x, 0, dt * 6);

        const endDist = this.warpTargetPos.distanceTo(this.root.position);
        if ((this.warpWaypoints.length <= 1 && endDist < 42) || input.isActionDown('thrustBack')) {
          const completed = this.warpWaypoints.length <= 1 && endDist < 42;
          const targetId = this.warpTargetId;
          this.warpState = 'IDLE';
          this.warpWaypoints.length = 0;
          this.velocity.copy(desiredDir).multiplyScalar(95);
          if (completed && onWarpComplete) {
            onWarpComplete(targetId);
          }
        }
      }
      return;
    }

    // Zero-overshoot crisp 6DoF pilot flight (clamped pointer-lock delta + smooth unlocked steering)
    const localYAxis = new THREE.Vector3(0, 1, 0);
    const localXAxis = new THREE.Vector3(1, 0, 0);
    const localZAxis = new THREE.Vector3(0, 0, 1);

    const sensMult = this.settings?.mouseSensitivity ?? 1.0;
    const pitchSign = this.settings?.invertPitch ? -1 : 1;
    const gestureFlight = input.controlMode === 'GESTURE';
    const reduceMotion = this.settings?.reduceMotion;

    let stepYaw = 0;
    let stepPitch = 0;
    let rawX = 0;
    let rawY = 0;

    if (!input.orbitLookActive) {
      if (gestureFlight) {
        const sensitivity = this.settings?.gestureSensitivity;
        const gain = Number.isFinite(sensitivity) ? THREE.MathUtils.clamp(sensitivity, 0.6, 1.6) : 1;
        const yaw = THREE.MathUtils.clamp(input.gestureAimX * gain, -1, 1);
        const pitch = THREE.MathUtils.clamp(input.gestureAimY * gain, -1, 1);
        const yawMax = SHIP_CONFIG.yawRate * (reduceMotion ? 0.96 : 1.18);
        const pitchMax = SHIP_CONFIG.pitchRate * (reduceMotion ? 0.90 : 1.10);
        const turnAlpha = 1 - Math.exp(-(reduceMotion ? 26 : 32) * dt);
        this.yawVel = THREE.MathUtils.lerp(THREE.MathUtils.clamp(this.yawVel, -yawMax, yawMax), -yaw * yawMax, turnAlpha);
        this.pitchVel = THREE.MathUtils.lerp(THREE.MathUtils.clamp(this.pitchVel, -pitchMax, pitchMax), -pitch * pitchSign * pitchMax, turnAlpha);
        stepYaw = this.yawVel * dt;
        stepPitch = this.pitchVel * dt;
      } else if (input.pointerLocked) {
        const sens = 0.0024 * sensMult;
        stepYaw = THREE.MathUtils.clamp(-input.deltaX * sens, -0.28, 0.28);
        stepPitch = THREE.MathUtils.clamp(-input.deltaY * sens * pitchSign, -0.28, 0.28);
        const safeDt = Math.max(0.004, dt);
        const instYaw = THREE.MathUtils.clamp(stepYaw / safeDt, -SHIP_CONFIG.yawRate * 1.6, SHIP_CONFIG.yawRate * 1.6);
        const instPitch = THREE.MathUtils.clamp(stepPitch / safeDt, -SHIP_CONFIG.pitchRate * 1.6, SHIP_CONFIG.pitchRate * 1.6);
        this.yawVel = THREE.MathUtils.lerp(this.yawVel, instYaw, 1 - Math.exp(-15 * dt));
        this.pitchVel = THREE.MathUtils.lerp(this.pitchVel, instPitch, 1 - Math.exp(-15 * dt));
      } else {
        const dead = 0.13;
        rawX = Math.abs(input.aimX) < dead ? 0 : (input.aimX - Math.sign(input.aimX) * dead) / (1 - dead);
        rawY = Math.abs(input.aimY) < dead ? 0 : (input.aimY - Math.sign(input.aimY) * dead) / (1 - dead);
        const targetYawVel = -Math.sign(rawX) * Math.pow(Math.abs(rawX), 1.65) * SHIP_CONFIG.yawRate * 0.78 * sensMult;
        const targetPitchVel = -Math.sign(rawY) * Math.pow(Math.abs(rawY), 1.65) * SHIP_CONFIG.pitchRate * 0.78 * sensMult * pitchSign;
        this.yawVel = THREE.MathUtils.lerp(this.yawVel, targetYawVel, 1 - Math.exp(-14 * dt));
        this.pitchVel = THREE.MathUtils.lerp(this.pitchVel, targetPitchVel, 1 - Math.exp(-14 * dt));
        stepYaw = THREE.MathUtils.clamp(this.yawVel * dt, -0.28, 0.28);
        stepPitch = THREE.MathUtils.clamp(this.pitchVel * dt, -0.28, 0.28);
      }
    } else {
      this.yawVel *= Math.exp(-10 * dt);
      this.pitchVel *= Math.exp(-10 * dt);
    }

    const rollInput = (input.isActionDown('rollLeft') ? 1 : 0) - (input.isActionDown('rollRight') ? 1 : 0);
    let stepRoll = rollInput * SHIP_CONFIG.rollRate * dt;

    // Gentle ecliptic horizon auto-leveling with smooth pole taper (zero hard cutoff jitter near 90°)
    if (rollInput === 0 && (this.settings?.autoLevel ?? true)) {
      this._forward.set(0, 0, -1).applyQuaternion(this.root.quaternion);
      const poleFade = THREE.MathUtils.clamp(1 - Math.max(0, Math.abs(this._forward.y) - 0.72) / 0.22, 0, 1);
      if (poleFade > 0.01) {
        this._right.set(1, 0, 0).applyQuaternion(this.root.quaternion);
        this._up.set(0, 1, 0).applyQuaternion(this.root.quaternion);
        const eclipticUp = new THREE.Vector3(0, 1, 0);
        const projUp = eclipticUp.addScaledVector(this._forward, -eclipticUp.dot(this._forward));
        if (projUp.lengthSq() > 0.001) {
          projUp.normalize();
          const rollErr = Math.atan2(projUp.dot(this._right), projUp.dot(this._up));
          stepRoll = THREE.MathUtils.clamp(-rollErr * 1.45, -0.95, 0.95) * poleFade * dt;
        }
      }
    }

    this._qYaw.setFromAxisAngle(localYAxis, stepYaw);
    this._qPitch.setFromAxisAngle(localXAxis, stepPitch);
    this._qRoll.setFromAxisAngle(localZAxis, stepRoll);

    this.root.quaternion.multiply(this._qYaw).multiply(this._qPitch).multiply(this._qRoll).normalize();

    // Gentle magnetic Aim Assist & auto-track nudge
    if (assistOptions?.leadPos && assistOptions.strength > 0) {
      const toLead = assistOptions.leadPos.clone().sub(this.root.position);
      if (toLead.lengthSq() > 4) {
        toLead.normalize();
        this._forward.set(0, 0, -1).applyQuaternion(this.root.quaternion);
        this._right.set(1, 0, 0).applyQuaternion(this.root.quaternion);
        this._up.set(0, 1, 0).applyQuaternion(this.root.quaternion);

        const errYaw = Math.atan2(toLead.dot(this._right), toLead.dot(this._forward));
        const errPitch = Math.atan2(toLead.dot(this._up), toLead.dot(this._forward));
        const maxRate = assistOptions.rate || 1.65;
        const yawStep = THREE.MathUtils.clamp(-errYaw * assistOptions.strength, -maxRate, maxRate) * dt;
        const pitchStep = THREE.MathUtils.clamp(errPitch * assistOptions.strength, -maxRate, maxRate) * dt;

        this._qYaw.setFromAxisAngle(localYAxis, yawStep);
        this._qPitch.setFromAxisAngle(localXAxis, pitchStep);
        this.root.quaternion.multiply(this._qYaw).multiply(this._qPitch).normalize();
      }
    }

    // Basis vectors in world space
    this._forward.set(0, 0, -1).applyQuaternion(this.root.quaternion);
    this._right.set(1, 0, 0).applyQuaternion(this.root.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(this.root.quaternion);

    const thrustFwd = input.getThrottleAxis?.()
      ?? (Number(input.isActionDown('thrustFwd')) - Number(input.isActionDown('thrustBack')));
    const leftDown = input.isActionDown('strafeLeft');
    const rightDown = input.isActionDown('strafeRight');
    const thrustStrafe = (rightDown ? 1 : 0) - (leftDown ? 1 : 0);
    const thrustVert = (input.isActionDown('thrustUp') ? 1 : 0) - (input.isActionDown('thrustDown') ? 1 : 0);

    // Double-tap A / D Phase Barrel-Roll Dodge (0.46s evasion window)
    this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt);
    this.dodgeTimer = Math.max(0, this.dodgeTimer - dt);
    if (leftDown && !this._wasLeftDown) {
      if (time - this._tapLeftTime < 0.28) this.triggerDodge('LEFT');
      this._tapLeftTime = time;
    }
    if (rightDown && !this._wasRightDown) {
      if (time - this._tapRightTime < 0.28) this.triggerDodge('RIGHT');
      this._tapRightTime = time;
    }
    this._wasLeftDown = leftDown;
    this._wasRightDown = rightDown;
    if (gestureFlight) {
      const dodgeLeft = input.consumeAction('dodgeLeft');
      const dodgeRight = input.consumeAction('dodgeRight');
      if (dodgeLeft || dodgeRight) this.triggerDodge(dodgeLeft ? 'LEFT' : 'RIGHT');
    }

    const boostHeld = input.isActionDown('boost');
    if (!gestureFlight || !boostHeld || this.boost >= 16) this.gestureBoostExhausted = false;
    else if (this.boost <= 4) this.gestureBoostExhausted = true;
    this.isBoosting = boostHeld && this.boost > 4 && thrustFwd >= 0 && !this.gestureBoostExhausted;

    if (this.isBoosting) {
      this.boost = Math.max(0, this.boost - SHIP_CONFIG.boostDrainRate * (this.boostDrainMult || 1.0) * dt);
    } else {
      const regenMult = this.loadout?.boostRegenMult || 1.0;
      this.boost = Math.min(SHIP_CONFIG.maxBoost, this.boost + SHIP_CONFIG.boostRegenRate * regenMult * dt);
    }

    // True tactical hover when W/S released (0 forward drift) + Phase Barrel-Roll lateral impulse
    const cruiseCap = gestureFlight ? 255 : SHIP_CONFIG.cruiseSpeed;
    const fwdSpeed = this.isBoosting
      ? SHIP_CONFIG.boostSpeed
      : thrustFwd * (thrustFwd >= 0 ? cruiseCap : SHIP_CONFIG.reverseSpeed);

    const dodgeImpulse = this.dodgeTimer > 0 ? -this.dodgeDir * 245 : 0;

    const targetVel = new THREE.Vector3()
      .addScaledVector(this._forward, fwdSpeed)
      .addScaledVector(this._right, thrustStrafe * SHIP_CONFIG.strafeSpeed + dodgeImpulse)
      .addScaledVector(this._up, thrustVert * SHIP_CONFIG.strafeSpeed * 0.9);

    const accel = this.dodgeTimer > 0 ? 11.0 : this.isBoosting ? 6.5 : SHIP_CONFIG.damping;
    this.velocity.lerp(targetVel, 1 - Math.exp(-accel * dt));
    this.root.position.addScaledVector(this.velocity, dt);

    // Responsive banking & pitch attitude driven by angular velocity + lateral strafe + 360 barrel roll
    const maxBank = reduceMotion ? (gestureFlight ? 0.10 : 0.16) : 0.28;
    const bankGainYaw = reduceMotion ? (gestureFlight ? 0.08 : 0.12) : 0.19;
    const targetBank = THREE.MathUtils.clamp(this.yawVel * bankGainYaw - thrustStrafe * (this.settings?.reduceMotion ? 0.09 : 0.14), -maxBank, maxBank);
    const targetPitchOff = THREE.MathUtils.clamp(this.pitchVel * 0.05, -0.10, 0.10);
    this.bankAngle = THREE.MathUtils.lerp(this.bankAngle, targetBank, 1 - Math.exp(-9.0 * dt));
    this.pitchOffset = THREE.MathUtils.lerp(this.pitchOffset, targetPitchOff, 1 - Math.exp(-9.0 * dt));
    const dodgeRoll = this.dodgeTimer > 0 ? this.dodgeDir * (1 - this.dodgeTimer / 0.46) * Math.PI * 2 : 0;
    this.visualGroup.rotation.set(this.pitchOffset, 0, this.bankAngle + dodgeRoll);

    const powerTarget = this.isBoosting ? 1.2 : 0.35 + thrustFwd * (thrustFwd >= 0 ? 0.50 : 0.17);
    this.throttle = THREE.MathUtils.lerp(this.throttle, powerTarget, 1 - Math.exp(-8 * dt));
    this._updateThrusters(dt, time, this.throttle, false);
  }

  _updateThrusters(dt, time, power, isWarping) {
    const targetThrust = isWarping ? 1.35 : Math.max(0.25, power);
    this.exhaustThrust = THREE.MathUtils.damp(this.exhaustThrust, targetThrust, 4.2, dt);
    const tVal = this.exhaustThrust;

    for (const mat of this.reactorMats) {
      mat.emissiveIntensity = 1.25 + tVal * 1.55;
    }

    const widths = [1.47, 0.94, 0.58];
    const lengths = [1.17, 0.92, 0.65];

    for (const { flames, particles, spill } of this.nozzles) {
      spill.intensity = 4.6 * tVal;
      flames.forEach((mesh, layerIdx) => {
        const w = widths[layerIdx];
        const l = (0.3 + 0.8 * tVal) * lengths[layerIdx];
        mesh.scale.set(w, w, l);
        mesh.material.uniforms.heat.value = Math.min(1.3, tVal);
        mesh.material.uniforms.elapsed.value = time;
      });

      const posAttr = particles.geometry.getAttribute('position');
      const glowAttr = particles.geometry.getAttribute('glow');
      const seeds = particles.geometry.userData.seeds;
      const count = seeds.length;

      for (let d = 0; d < count; d++) {
        const [p, g, v] = seeds[d];
        const m = (p + time * (0.54 + v * 0.76)) % 1;
        const f = g * Math.PI * 2 + m * (0.26 + v * 1.1);
        const rad = (0.38 + v * 2.42) * (0.54 + 0.59 * Math.sin(m * Math.PI)) * 0.1;
        const z = m * (1.2 + 2.9 * tVal);
        const ax = Math.cos(f) * rad;
        const ay = Math.sin(f) * rad;
        const segLen = (0.17 + v * v * 0.8) * (0.23 + 0.77 * tVal) * 0.1;
        const bright = Math.min(1, m * 13) * Math.pow(1 - m, 1.6) * Math.min(1.25, tVal);

        posAttr.setXYZ(2 * d, ax, ay, z);
        posAttr.setXYZ(2 * d + 1, ax * 1.022, ay * 1.022, z + segLen);
        glowAttr.setX(2 * d, bright * (0.39 + 0.59 * v));
        glowAttr.setX(2 * d + 1, 0);
      }
      posAttr.needsUpdate = true;
      glowAttr.needsUpdate = true;
    }
  }
}
