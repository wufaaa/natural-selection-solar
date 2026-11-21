import * as THREE from 'three';

const NOISE_GLSL = /* glsl */ `
float vHash31(vec3 p) {
  p = fract(p * 0.3183099 + 0.1) * 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(vHash31(i), vHash31(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(vHash31(i + vec3(0.0, 1.0, 0.0)), vHash31(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(vHash31(i + vec3(0.0, 0.0, 1.0)), vHash31(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(vHash31(i + vec3(0.0, 1.0, 1.0)), vHash31(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z
  );
}
float vFbm3(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vNoise3(p);
    p = p * 2.08 + vec3(5.3, 11.1, 3.7);
    a *= 0.5;
  }
  return s;
}
`;

// 3D Enemy Shield Impact Bubble shader: directional expanding hex-energy wave originating at hit vector
function createEnemyShieldBubbleMaterial(hitDirVec, colorHex = '#4ce8ff') {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uProgress: { value: 0 },
      uHitDir: { value: hitDirVec.clone().normalize() },
      uColor: { value: new THREE.Color(colorHex) },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vLocalDir;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        vLocalDir = normalize(position);
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
      uniform float uProgress;
      uniform vec3 uHitDir;
      uniform vec3 uColor;
      varying vec3 vLocalDir;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        float cosA = clamp(dot(normalize(vLocalDir), normalize(uHitDir)), -1.0, 1.0);
        float angDist = acos(cosA) / 3.14159265; // 0 at impact site -> 1 at back pole
        float waveArg = (angDist - uProgress * 0.92) * 11.0;
        float wave = exp(-(waveArg * waveArg));
        float hotspot = exp(-angDist * 5.2) * (1.0 - uProgress * 0.7);
        float hex = abs(sin(vLocalDir.x * 24.0 + vLocalDir.y * 14.0)) * abs(sin(vLocalDir.z * 24.0 - vLocalDir.y * 14.0));
        float lattice = 1.0 - smoothstep(0.06, 0.24, hex);
        float fresnel = pow(1.0 - clamp(abs(dot(normalize(vNormalV), normalize(vViewDir))), 0.0, 1.0), 2.2);

        float alpha = (wave * 1.15 + hotspot * 0.85 + fresnel * 0.35) * (0.35 + 0.85 * lattice) * (1.0 - uProgress);
        vec3 col = mix(uColor * 1.5, vec3(1.8, 2.2, 2.5), clamp(wave * 0.65 + hotspot * 0.5, 0.0, 1.0));
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.96));
        #include <logdepthbuf_fragment>
      }
    `,
  });
}

// Contrast-rich NormalBlending pyroclastic plasma + billowing smoke shader
function createPyroclasticMaterial(coreHex = '#fff2c8', edgeHex = '#ff5418', isPlasma = false) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.NormalBlending,
    uniforms: {
      uProgress: { value: 0 },
      uSeed: { value: Math.random() * 40.0 },
      uCore: { value: new THREE.Color(coreHex) },
      uEdge: { value: new THREE.Color(edgeHex) },
      uIsPlasma: { value: isPlasma ? 1.0 : 0.0 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform float uProgress;
      uniform float uSeed;
      varying vec3 vLocalPos;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      ${NOISE_GLSL}
      void main() {
        vLocalPos = position;
        float disp = (vFbm3(normalize(position) * 3.1 + vec3(uSeed, uProgress * 2.1, -uSeed * 0.4)) - 0.44) * (0.34 + 0.42 * uProgress);
        vec3 displaced = position + normal * disp;
        vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
        vViewDir = normalize(-mv.xyz);
        vNormalV = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uProgress;
      uniform float uSeed;
      uniform vec3 uCore;
      uniform vec3 uEdge;
      uniform float uIsPlasma;
      varying vec3 vLocalPos;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      ${NOISE_GLSL}
      void main() {
        vec3 p = normalize(vLocalPos);
        float turb = vFbm3(p * 4.4 + vec3(uSeed, -uProgress * 3.4, uProgress * 2.1));
        float fine = vNoise3(p * 13.0 + turb * 2.8);
        float density = turb * 0.72 + fine * 0.28;

        float ndv = clamp(abs(dot(normalize(vNormalV), normalize(vViewDir))), 0.0, 1.0);
        float rimSoft = pow(ndv, 1.35);
        float erode = smoothstep(uProgress * 0.85 - 0.14, uProgress * 0.85 + 0.28, density * (0.65 + 0.35 * ndv));
        if (erode < 0.015) discard;

        float temp = clamp(density * (1.25 - uProgress * 1.08) + (1.0 - ndv) * 0.14, 0.0, 1.0);
        vec3 soot = uIsPlasma > 0.5 ? vec3(0.05, 0.14, 0.32) : vec3(0.11, 0.09, 0.09);
        vec3 midFire = uEdge * 1.45;
        vec3 hotCore = uCore * 2.4;

        vec3 col = mix(soot, midFire, smoothstep(0.20, 0.55, temp));
        col = mix(col, hotCore, smoothstep(0.56, 0.90, temp));

        float alpha = erode * rimSoft * pow(max(0.0, 1.0 - uProgress), 1.25);
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.96));
        #include <logdepthbuf_fragment>
      }
    `,
  });
}

function createShockwaveMaterial(colorHex) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uProgress: { value: 0 },
      uColor: { value: new THREE.Color(colorHex) },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uProgress;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        vec2 c = vUv - 0.5;
        float r = length(c) * 2.0;
        float radialFade = 1.0 - smoothstep(0.84, 0.99, r);
        if (radialFade <= 0.001) discard;
        float ang = atan(c.y, c.x);
        float filaments = 0.78 + 0.22 * sin(ang * 16.0 + uProgress * 6.0) * sin(ang * 9.0 - uProgress * 8.0);
        float leadArg = (r - 0.78) * 16.0;
        float lead = exp(-(leadArg * leadArg));
        float wake = exp(-pow(max(0.0, 0.78 - r) * 5.0, 2.0)) * smoothstep(0.25, 0.78, r) * 0.42;
        float alpha = radialFade * (lead + wake * filaments) * pow(max(0.0, 1.0 - uProgress), 1.35);
        vec3 col = mix(uColor, vec3(1.8, 2.0, 2.3), lead * (1.0 - uProgress) * 0.65);
        gl_FragColor = vec4(col * (1.7 - uProgress * 0.5), clamp(alpha, 0.0, 1.0));
        #include <logdepthbuf_fragment>
      }
    `,
  });
}

function createStarburstMaterial(colorHex = '#ffbb66') {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uProgress: { value: 0 },
      uScale: { value: 1.0 },
      uColor: { value: new THREE.Color(colorHex) },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform float uScale;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mvCenter = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mvCenter.xy += position.xy * uScale;
        gl_Position = projectionMatrix * mvCenter;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uProgress;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        vec2 c = (vUv - 0.5) * 2.0;
        float r = length(c);
        float edgeMask = 1.0 - smoothstep(0.76, 0.99, r);
        if (edgeMask <= 0.001) discard;
        float core = exp(-r * 7.2);
        float hStreak = exp(-abs(c.y) * 24.0) * exp(-abs(c.x) * 2.6) * 0.95;
        float vStreak = exp(-abs(c.x) * 26.0) * exp(-abs(c.y) * 5.0) * 0.45;
        float intensity = edgeMask * (core * 1.55 + hStreak + vStreak) * pow(max(0.0, 1.0 - uProgress), 1.7);
        vec3 col = mix(uColor, vec3(2.2, 2.35, 2.65), clamp(core * 1.35, 0.0, 1.0));
        gl_FragColor = vec4(col, clamp(intensity, 0.0, 1.0));
        #include <logdepthbuf_fragment>
      }
    `,
  });
}

const EFFECT_LIMITS = Object.freeze({
  sparks: 120,
  debris: 64,
  flares: 24,
  rings: 24,
  puffs: 32,
  shieldBubbles: 16,
  empWaves: 12,
  arcs: 16,
  pendingSeq: 32,
});

export class VFXManager {
  constructor(scene) {
    this.scene = scene;
    this.rings = [];
    this.sparks = [];
    this.puffs = [];
    this.flares = [];
    this.debris = [];
    this.shieldBubbles = [];
    this.arcs = [];
    this.lights = [];
    this.empWaves = [];
    this.pendingSeq = [];

    // Droplet high-speed afterimage pool (hard cap 36)
    this.dropletTrails = [];
    this.dropletTrailLimit = 36;
    this._dropletTrailGeo = new THREE.SphereGeometry(1.4, 12, 10);

    this._ringGeo = new THREE.PlaneGeometry(2, 2);
    this._flareGeo = new THREE.PlaneGeometry(2, 2);
    this._sparkGeo = new THREE.ConeGeometry(0.033, 0.74, 5);
    this._sparkGeo.rotateX(Math.PI * 0.5);
    this._puffGeo = new THREE.SphereGeometry(1, 22, 16);
    this._bubbleGeo = new THREE.SphereGeometry(1, 24, 18);
    this._debrisGeo = new THREE.OctahedronGeometry(0.35, 0);
    this._empGeo = new THREE.SphereGeometry(1, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.5);

    // Dynamic glowing ember-trail LineSegments behind spinning debris shards
    this._maxTrails = 240;
    this._trailPositions = new Float32Array(this._maxTrails * 6);
    this._trailColors = new Float32Array(this._maxTrails * 6);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this._trailPositions, 3));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(this._trailColors, 3));
    trailGeo.setDrawRange(0, 0);
    const trailMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this._trailLines = new THREE.LineSegments(trailGeo, trailMat);
    this._trailLines.frustumCulled = false;
    this.scene.add(this._trailLines);

    // Reused scratch vector for per-fragment debris tail math (zero per-frame allocation)
    this._tmpTail = new THREE.Vector3();
  }

  _distScale(pos, camPos) {
    if (!camPos) return 1.25;
    return THREE.MathUtils.clamp(1.0 + pos.distanceTo(camPos) * 0.0045, 1.0, 2.8);
  }

  _addMeshEffect(poolName, effect) {
    const pool = this[poolName];
    if (pool.length >= EFFECT_LIMITS[poolName]) {
      const oldest = pool.shift();
      this.scene.remove(oldest.mesh);
      oldest.mesh.material.dispose();
    }
    pool.push(effect);
  }

  _addArc(effect) {
    if (this.arcs.length >= EFFECT_LIMITS.arcs) {
      const oldest = this.arcs.shift().line;
      this.scene.remove(oldest);
      oldest.geometry.dispose();
      oldest.material.dispose();
    }
    this.arcs.push(effect);
  }

  spawnKillBurst(pos, colorHex = '#4ce8ff', isMajor = false) {
    this._spawnFlare(pos, isMajor ? 10 : 5, colorHex, isMajor ? 0.15 : 0.10);
    this._spawnRing(pos, isMajor ? 16 : 7, colorHex, isMajor ? 0.24 : 0.16);
  }

  _spawnFlare(pos, maxScale, colorHex, life = 0.22) {
    const mat = createStarburstMaterial(colorHex);
    const mesh = new THREE.Mesh(this._flareGeo, mat);
    mesh.position.copy(pos);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this._addMeshEffect('flares', { mesh, age: 0, life, maxScale });
  }

  _spawnRing(pos, maxScale, colorHex, life = 0.5, rotEuler = null, delay = 0) {
    const mat = createShockwaveMaterial(colorHex);
    const mesh = new THREE.Mesh(this._ringGeo, mat);
    mesh.position.copy(pos);
    if (rotEuler) {
      mesh.rotation.copy(rotEuler);
    } else {
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    }
    // update() expands the ring before its first drawable frame.
    mesh.visible = false;
    this.scene.add(mesh);
    this._addMeshEffect('rings', { mesh, age: -delay, life, maxScale });
  }

  _spawnPyroPuff(pos, maxRadius, coreHex, edgeHex, life = 0.85, delay = 0, isPlasma = false) {
    const mat = createPyroclasticMaterial(coreHex, edgeHex, isPlasma);
    const mesh = new THREE.Mesh(this._puffGeo, mat);
    mesh.position.copy(pos);
    mesh.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
    mesh.visible = delay <= 0;
    this.scene.add(mesh);
    this._addMeshEffect('puffs', { mesh, age: -delay, life, maxRadius });
  }

  // True 3D spherical hex-wave shield impact bubble on enemy vessels!
  spawnEnemyShieldBubble(centerPos, enemyRadius, hitPos, colorHex = '#4ce8ff') {
    const hitDir = hitPos.clone().sub(centerPos);
    if (hitDir.lengthSq() < 0.001) hitDir.set(0, 0, 1);
    const mat = createEnemyShieldBubbleMaterial(hitDir, colorHex);
    const mesh = new THREE.Mesh(this._bubbleGeo, mat);
    mesh.position.copy(centerPos);
    mesh.scale.setScalar(enemyRadius * 1.26);
    this.scene.add(mesh);
    this._addMeshEffect('shieldBubbles', { mesh, age: 0, life: 0.34 });

    this._spawnFlare(hitPos, 3.2, '#7ef4ff', 0.16);
    this.spawnImpactSparks(hitPos, '#56eeff', 10, 48, false, null, hitDir);
  }

  // Crackling 3D jagged plasma lightning arcs branching from impacts / beam hits
  spawnLightningArcs(pos, radius = 3.5, colorHex = '#7cf4ff', count = 4, branched = false) {
    const segsPerArc = 6;
    const branchSegments = branched ? 2 : 0;
    const verts = new Float32Array(count * (segsPerArc + branchSegments) * 6);
    let idx = 0;
    const cur = new THREE.Vector3();
    const nxt = new THREE.Vector3();
    const fork = new THREE.Vector3();
    const branch = new THREE.Vector3();
    const writeSegment = (a, b) => {
      verts[idx++] = a.x;
      verts[idx++] = a.y;
      verts[idx++] = a.z;
      verts[idx++] = b.x;
      verts[idx++] = b.y;
      verts[idx++] = b.z;
    };

    for (let a = 0; a < count; a++) {
      cur.copy(pos);
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      for (let s = 0; s < segsPerArc; s++) {
        const step = (radius / segsPerArc) * (0.7 + Math.random() * 0.6);
        nxt.copy(cur).addScaledVector(dir, step);
        nxt.x += (Math.random() - 0.5) * radius * 0.28;
        nxt.y += (Math.random() - 0.5) * radius * 0.28;
        nxt.z += (Math.random() - 0.5) * radius * 0.28;

        writeSegment(cur, nxt);
        if (s === 2) fork.copy(nxt);
        cur.copy(nxt);
      }
      if (branched) {
        branch.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).add(dir).normalize();
        cur.copy(fork).addScaledVector(branch, radius * 0.18);
        nxt.copy(cur).addScaledVector(branch, radius * 0.13).addScaledVector(dir, radius * 0.12);
        writeSegment(fork, cur);
        writeSegment(cur, nxt);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.LineSegments(geo, mat);
    line.frustumCulled = false;
    this.scene.add(line);
    this._addArc({ line, age: 0, life: branched ? 0.24 : 0.16 });
  }

  spawnArmorHit(pos, incomingDir = null, camPos = null, surfaceNormal = null) {
    const ds = this._distScale(pos, camPos);
    this._spawnFlare(pos, 3.0 * ds, '#ffbb52', 0.16);
    this._spawnRing(pos, 3.4 * ds, '#ff8e38', 0.22);
    this._spawnPyroPuff(pos, 1.55 * ds, '#fff2ca', '#ff5b1c', 0.36, 0, false);
    this.spawnImpactSparks(pos, '#ffd26a', 14, 56 * Math.sqrt(ds), false, camPos, null, surfaceNormal || incomingDir, incomingDir);
  }

  spawnCritHit(pos, incomingDir = null, camPos = null, surfaceNormal = null) {
    const ds = this._distScale(pos, camPos);
    this._spawnFlare(pos, 5.2 * ds, '#ffe266', 0.22);
    this._spawnRing(pos, 5.5 * ds, '#ffd452', 0.26);
    this._spawnPyroPuff(pos, 2.2 * ds, '#ffffff', '#ff9424', 0.44, 0, false);
    this.spawnLightningArcs(pos, 4.2 * ds, '#ffe47a', 4);
    this.spawnImpactSparks(pos, '#ffe678', 20, 68 * Math.sqrt(ds), false, camPos, null, surfaceNormal || incomingDir, incomingDir);
  }

  spawnBeamImpact(pos, camPos = null, colorHex = '#7ef6ff', incomingDir = null) {
    const ds = this._distScale(pos, camPos);
    this._spawnFlare(pos, 2.8 * ds, colorHex, 0.12);
    this.spawnLightningArcs(pos, 2.6 * ds, colorHex, 3, true);
    this.spawnImpactSparks(pos, colorHex, 9, 38 * Math.sqrt(ds), false, camPos, null, incomingDir);
  }

  spawnMissileLaunchPuff(pos, launchDir) {
    const exhaustPos = pos.clone().addScaledVector(launchDir, 0.55);
    this._spawnFlare(exhaustPos, 0.85, '#b2eaff', 0.12);
    this.spawnImpactSparks(exhaustPos, '#a6dbf1', 5, 17, false, null, launchDir);
  }

  spawnMissileImpactRings(pos, radius) {
    const equator = new THREE.Euler(Math.PI * 0.5, 0, 0);
    this._spawnRing(pos, radius * 1.5, '#fff0b4', 0.27, equator);
    this._spawnRing(pos, radius * 2.05, '#ffa448', 0.43, equator, 0.065);
  }

  spawnImpactSparks(pos, colorHex = '#7ce8ff', count = 10, speed = 42, withRing = true, camPos = null, biasDir = null, tangentNormal = null, incomingDir = null) {
    const ds = camPos ? this._distScale(pos, camPos) : 1.0;
    if (withRing && count >= 6) {
      this._spawnFlare(pos, 2.4 * ds, colorHex, 0.14);
      this._spawnRing(pos, (3.0 + count * 0.14) * ds, colorHex, 0.22);
    }

    const normal = tangentNormal?.lengthSq() > 1e-8 ? tangentNormal.clone().normalize() : null;
    const tangentIn = normal && incomingDir
      ? incomingDir.clone().addScaledVector(normal, -incomingDir.dot(normal)).normalize()
      : null;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this._sparkGeo, mat);
      mesh.position.copy(pos);
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      if (normal) {
        dir.addScaledVector(normal, -dir.dot(normal)).normalize();
        if (dir.lengthSq() < 1e-8) {
          dir.set(Math.abs(normal.y) < 0.9 ? 0 : 1, Math.abs(normal.y) < 0.9 ? 1 : 0, 0).cross(normal).normalize();
        }
        if (tangentIn && dir.dot(incomingDir) < -0.28) dir.reflect(tangentIn);
      } else if (biasDir && Math.random() < 0.72) {
        dir.addScaledVector(biasDir, 0.95).normalize();
      }
      const vel = dir.multiplyScalar(speed * (0.45 + Math.random() * 0.95));
      mesh.lookAt(pos.clone().add(vel));
      mesh.scale.setScalar(Math.min(1.8, ds * 0.9));
      this.scene.add(mesh);
      this._addMeshEffect('sparks', {
        mesh,
        vel,
        age: 0,
        life: 0.24 + Math.random() * 0.30,
      });
    }
  }

  spawnExplosion(pos, radius = 8, colorHex = '#ff9842', missileImpact = false) {
    const isCyan = colorHex.toLowerCase().includes('4ce') || colorHex.toLowerCase().includes('6ef') || colorHex.toLowerCase().includes('7ce') || colorHex.toLowerCase().includes('5ce') || colorHex.toLowerCase().includes('6be');
    const coreHex = isCyan ? '#e8fcff' : '#fff4d2';
    const edgeHex = isCyan ? '#1b8fff' : '#ff4d18';

    this._spawnFlare(pos, radius * 2.8, colorHex, radius >= 14 ? 0.34 : 0.22);

    const puffCount = radius >= 12 ? 6 : 4;
    for (let k = 0; k < puffCount; k++) {
      const off =
        k === 0
          ? new THREE.Vector3()
          : new THREE.Vector3(
              (Math.random() - 0.5) * radius * 0.65,
              (Math.random() - 0.5) * radius * 0.55,
              (Math.random() - 0.5) * radius * 0.65
            );
      const scaleF = k === 0 ? 1.25 : 0.72 + Math.random() * 0.45;
      const delay = k === 0 ? 0 : 0.03 + k * 0.035;
      this._spawnPyroPuff(pos.clone().add(off), radius * scaleF, coreHex, edgeHex, (radius >= 14 ? 1.15 : 0.85) + Math.random() * 0.2, delay, isCyan);
    }

    if (missileImpact) {
      this.spawnMissileImpactRings(pos, radius);
    } else {
      this._spawnRing(pos, radius * 3.2, colorHex, radius >= 14 ? 0.80 : 0.55);
      this._spawnRing(pos, radius * 2.35, coreHex, 0.42);
    }
    this.spawnLightningArcs(pos, radius * 0.85, coreHex, radius >= 12 ? 6 : 3);

    const shardCount = Math.min(24, Math.round(8 + radius * 0.85));
    for (let i = 0; i < shardCount; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: isCyan ? '#8ceeff' : '#ffc06e',
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(this._debrisGeo, mat);
      mesh.position.copy(pos);
      mesh.scale.set(0.5 + Math.random() * 1.4, 0.25 + Math.random() * 0.7, 0.7 + Math.random() * 1.8);
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const vel = dir.multiplyScalar((28 + radius * 2.4) * (0.45 + Math.random() * 0.9));
      const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(12);
      this.scene.add(mesh);
      this._addMeshEffect('debris', {
        mesh,
        prevPos: pos.clone(),
        vel,
        spin,
        age: 0,
        life: 0.7 + Math.random() * 0.65,
        isCyan,
      });
    }

    const sparkCount = Math.min(58, Math.round(18 + radius * 1.8));
    this.spawnImpactSparks(pos, colorHex, sparkCount, 58 + radius * 4.0, false);

    if (this.lights.length < 3) {
      const light = new THREE.PointLight(colorHex, 26 + radius * 2.0, radius * 14, 1.4);
      light.position.copy(pos);
      this.scene.add(light);
      this.lights.push({ light, age: 0, life: 0.58, peak: 26 + radius * 2.0 });
    }
  }

  spawnCapitalExplosion(pos, radius = 18, colorHex = '#ff4858') {
    const excess = this.pendingSeq.length + 5 - EFFECT_LIMITS.pendingSeq;
    if (excess > 0) this.pendingSeq.splice(0, excess);
    for (let i = 0; i < 4; i++) {
      const offset = new THREE.Vector3(
        (Math.random() - 0.5) * radius * 0.85,
        (Math.random() - 0.5) * radius * 0.65,
        (Math.random() - 0.5) * radius * 0.85
      );
      this.pendingSeq.push({
        timer: i * 0.12,
        fn: () => this.spawnExplosion(pos.clone().add(offset), radius * 0.45, '#ffaa44'),
      });
    }
    this.pendingSeq.push({
      timer: 0.54,
      fn: () => this.spawnExplosion(pos.clone(), radius * 1.25, colorHex),
    });
  }

  spawnEmpWave(pos, maxRadius, colorHex = '#4ce8ff') {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uProgress: { value: 0 },
        uColor: { value: new THREE.Color(colorHex) },
      },
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vLocal;
        varying vec3 vNormalV;
        varying vec3 vViewDir;
        void main() {
          vLocal = position;
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
        uniform float uProgress;
        uniform vec3 uColor;
        varying vec3 vLocal;
        varying vec3 vNormalV;
        varying vec3 vViewDir;
        float hexEdge(vec2 p) {
          vec2 pitch = vec2(1.0, 1.73205);
          vec2 a = mod(p + pitch * 0.5, pitch) - pitch * 0.5;
          vec2 b = mod(p, pitch) - pitch * 0.5;
          vec2 h = abs(dot(a, a) < dot(b, b) ? a : b);
          float d = 0.5 - max(h.x, dot(h, vec2(0.5, 0.866025)));
          return 1.0 - smoothstep(0.028, 0.065 + fwidth(d), d);
        }
        void main() {
          float facing = clamp(abs(dot(normalize(vNormalV), normalize(vViewDir))), 0.0, 1.0);
          float rim = (1.0 - facing) * (1.0 - facing);
          float band = (vLocal.y - uProgress * 0.94) * 8.0;
          float pulse = exp(-(band * band));
          float hex = hexEdge(vLocal.xz * 13.0);
          float fade = (1.0 - uProgress) * (1.0 - uProgress);
          float alpha = fade * (0.055 + 0.33 * rim + hex * (0.12 + 0.63 * pulse));
          vec3 col = mix(uColor * 1.4, uColor * 2.3 + vec3(0.25, 0.42, 0.62), hex * pulse);
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.85));
          #include <logdepthbuf_fragment>
        }
      `,
    });
    const mesh = new THREE.Mesh(this._empGeo, mat);
    mesh.position.copy(pos);
    mesh.scale.setScalar(maxRadius * 0.05);
    this.scene.add(mesh);
    this._addMeshEffect('empWaves', { mesh, age: 0, life: 0.7, maxRadius });
    const equator = new THREE.Euler(Math.PI * 0.5, 0, 0);
    this._spawnRing(pos, maxRadius, colorHex, 0.48, equator);
    this._spawnRing(pos, maxRadius * 0.84, '#b8f3ff', 0.56, equator, 0.085);
    this.spawnLightningArcs(pos, maxRadius * 0.29, colorHex, 8, true);
    this._spawnFlare(pos, Math.min(11, maxRadius * 0.18), '#d9f8ff', 0.20);
  }

  spawnOverdriveBurst(pos) {
    const equator = new THREE.Euler(Math.PI * 0.5, 0, 0);
    this._spawnRing(pos, 48, '#ffe8a1', 0.42, equator);
    this._spawnRing(pos, 62, '#ffb657', 0.66, new THREE.Euler(Math.PI * 0.42, 0.24, 0), 0.095);
    this.spawnLightningArcs(pos, 17, '#ffd371', 8, true);
    this._spawnFlare(pos, 13, '#fff1bb', 0.30);
  }

  // Droplet high-speed ricochet afterimage ghost (pooled, hard cap 36)
  spawnDropletTrail(pos, isPhase2 = false) {
    const colorHex = isPhase2 ? '#4ce8ff' : '#8cf5ff';
    while (this.dropletTrails.length >= this.dropletTrailLimit) {
      const oldest = this.dropletTrails.shift();
      this.scene.remove(oldest.mesh);
      oldest.mesh.material.dispose();
    }
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this._dropletTrailGeo, mat);
    mesh.position.copy(pos);
    mesh.scale.setScalar(isPhase2 ? 1.12 : 0.92);
    mesh.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
    this.scene.add(mesh);
    this.dropletTrails.push({ mesh, age: 0, life: 0.28, peakScale: isPhase2 ? 1.12 : 0.92 });
  }

  // Droplet thermal vent breach:赤橙蒸汽 + 火星喷发
  spawnDropletVentSteam(pos) {
    this._spawnPyroPuff(pos, 5.2, '#ffe8b0', '#ff4818', 0.65, 0, false);
    this._spawnPyroPuff(pos, 5.2, '#ffe8b0', '#ff4818', 0.65, 0, false);
    this.spawnImpactSparks(pos, '#ff9842', 14, 48, false);
  }

  // Crackling arc link between two world points (relay pylon / prism refraction)
  spawnArcLink(fromPos, toPos, colorHex = '#6ef2ff') {
    const segs = 5;
    const verts = new Float32Array(segs * 6);
    const cur = new THREE.Vector3();
    const nxt = new THREE.Vector3();
    const dir = toPos.clone().sub(fromPos);
    const totalLen = dir.length();
    if (totalLen < 0.001) return;
    const jitter = Math.max(0.35, totalLen * 0.045);
    let idx = 0;

    for (let s = 0; s < segs; s++) {
      const t0 = s / segs;
      const t1 = (s + 1) / segs;
      cur.copy(fromPos).addScaledVector(dir, t0);
      nxt.copy(fromPos).addScaledVector(dir, t1);
      if (s > 0) {
        cur.x += (Math.random() - 0.5) * jitter;
        cur.y += (Math.random() - 0.5) * jitter;
        cur.z += (Math.random() - 0.5) * jitter;
      }
      if (s < segs - 1) {
        nxt.x += (Math.random() - 0.5) * jitter;
        nxt.y += (Math.random() - 0.5) * jitter;
        nxt.z += (Math.random() - 0.5) * jitter;
      }
      verts[idx++] = cur.x;
      verts[idx++] = cur.y;
      verts[idx++] = cur.z;
      verts[idx++] = nxt.x;
      verts[idx++] = nxt.y;
      verts[idx++] = nxt.z;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.LineSegments(geo, mat);
    line.frustumCulled = false;
    this.scene.add(line);
    this._addArc({ line, age: 0, life: 0.14 });
  }

  // Warp exit spatial ripple ring at arrival anchor
  spawnWarpExitRipple(pos) {
    this._spawnRing(pos, 26, '#8ef5ff', 0.55);
    this.spawnImpactSparks(pos, '#9cf8ff', 14, 42, false);
  }

  // Heavily damaged capital ship: lingering ember smoke wisp (cap 40)
  spawnDamagedSmoke(pos) {
    if (this.puffs.length < 40) {
      this._spawnPyroPuff(pos, 2.2, '#ff8833', '#222226', 0.55, 0, false);
    }
  }

  /**
   * Hard clear for campaign restart / return-to-title.
   * Removes every live effect object from the scene and disposes its per-instance material.
   * Shared reusable geometries (_bubbleGeo / _ringGeo / _flareGeo / _puffGeo / _sparkGeo /
   * _debrisGeo / _empGeo / _dropletTrailGeo) are NEVER disposed here — they stay alive for reuse.
   */
  clearAll() {
    // Abort queued delayed detonations so a restart can't fire stale explosions.
    this.pendingSeq.length = 0;

    const clearMeshPool = (pool) => {
      for (const item of pool) {
        if (!item || !item.mesh) continue;
        this.scene.remove(item.mesh);
        item.mesh.material?.dispose();
      }
      pool.length = 0;
    };

    clearMeshPool(this.shieldBubbles);
    clearMeshPool(this.flares);
    clearMeshPool(this.puffs);
    clearMeshPool(this.rings);
    clearMeshPool(this.sparks);
    clearMeshPool(this.debris);
    clearMeshPool(this.empWaves);
    clearMeshPool(this.dropletTrails);

    // Arcs own per-instance BufferGeometry, so both geometry and material must go.
    for (const a of this.arcs) {
      if (!a || !a.line) continue;
      this.scene.remove(a.line);
      a.line.geometry?.dispose();
      a.line.material?.dispose();
    }
    this.arcs.length = 0;

    // Point lights carry no disposable resource — only detach from the scene.
    for (const l of this.lights) {
      if (!l || !l.light) continue;
      this.scene.remove(l.light);
    }
    this.lights.length = 0;

    // Retire any ember-trail segments left in the shared line buffer.
    this._trailLines?.geometry?.setDrawRange(0, 0);
  }

  update(dt) {
    for (let i = this.pendingSeq.length - 1; i >= 0; i--) {
      const q = this.pendingSeq[i];
      q.timer -= dt;
      if (q.timer <= 0) {
        q.fn();
        this.pendingSeq.splice(i, 1);
      }
    }

    for (let i = this.shieldBubbles.length - 1; i >= 0; i--) {
      const b = this.shieldBubbles[i];
      b.age += dt;
      const t = b.age / b.life;
      if (t >= 1) {
        this.scene.remove(b.mesh);
        b.mesh.material.dispose();
        this.shieldBubbles.splice(i, 1);
      } else {
        b.mesh.material.uniforms.uProgress.value = t;
      }
    }

    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      a.age += dt;
      const t = a.age / a.life;
      if (t >= 1) {
        this.scene.remove(a.line);
        a.line.geometry.dispose();
        a.line.material.dispose();
        this.arcs.splice(i, 1);
      } else {
        a.line.material.opacity = 1 - t * t;
      }
    }

    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      f.age += dt;
      const t = f.age / f.life;
      if (t >= 1) {
        this.scene.remove(f.mesh);
        f.mesh.material.dispose();
        this.flares.splice(i, 1);
      } else {
        const s = f.maxScale * (0.35 + 0.65 * Math.sin(t * Math.PI * 0.72));
        f.mesh.material.uniforms.uScale.value = s;
        f.mesh.material.uniforms.uProgress.value = t;
      }
    }

    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const fb = this.puffs[i];
      fb.age += dt;
      if (fb.age < 0) continue;
      fb.mesh.visible = true;
      const t = fb.age / fb.life;
      if (t >= 1) {
        this.scene.remove(fb.mesh);
        fb.mesh.material.dispose();
        this.puffs.splice(i, 1);
      } else {
        const ease = 1 - Math.pow(1 - t, 2.7);
        fb.mesh.scale.setScalar(THREE.MathUtils.lerp(fb.maxRadius * 0.18, fb.maxRadius, ease));
        fb.mesh.material.uniforms.uProgress.value = t;
      }
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      if (r.age < 0) continue;
      r.mesh.visible = true;
      const t = r.age / r.life;
      if (t >= 1) {
        this.scene.remove(r.mesh);
        r.mesh.material.dispose();
        this.rings.splice(i, 1);
      } else {
        const ease = 1 - Math.pow(1 - t, 3);
        r.mesh.scale.setScalar(ease * r.maxScale);
        r.mesh.material.uniforms.uProgress.value = t;
      }
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.age += dt;
      const t = s.age / s.life;
      if (t >= 1) {
        this.scene.remove(s.mesh);
        s.mesh.material.dispose();
        this.sparks.splice(i, 1);
      } else {
        s.mesh.position.addScaledVector(s.vel, dt);
        s.vel.multiplyScalar(Math.exp(-2.2 * dt));
        s.mesh.material.opacity = 1 - t * t;
        s.mesh.scale.z = Math.max(0.2, 1.55 * (1 - t * 0.72));
      }
    }

    let trailIdx = 0;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.age += dt;
      const t = d.age / d.life;
      if (t >= 1) {
        this.scene.remove(d.mesh);
        d.mesh.material.dispose();
        this.debris.splice(i, 1);
      } else {
        d.prevPos.copy(d.mesh.position);
        d.mesh.position.addScaledVector(d.vel, dt);
        d.vel.multiplyScalar(Math.exp(-1.1 * dt));
        d.mesh.rotation.x += d.spin.x * dt;
        d.mesh.rotation.y += d.spin.y * dt;
        d.mesh.rotation.z += d.spin.z * dt;
        if (!d.isCyan) {
          d.mesh.material.color.setRGB(
            THREE.MathUtils.lerp(1.0, 0.28, Math.min(1, t * 1.4)),
            THREE.MathUtils.lerp(0.75, 0.12, Math.min(1, t * 1.6)),
            THREE.MathUtils.lerp(0.42, 0.06, Math.min(1, t * 1.8))
          );
        }
        d.mesh.material.opacity = 1 - t * t;

        if (trailIdx < this._maxTrails) {
          const base = trailIdx * 6;
          const tail = this._tmpTail.copy(d.mesh.position).addScaledVector(d.vel, -0.055);
          this._trailPositions[base] = d.mesh.position.x;
          this._trailPositions[base + 1] = d.mesh.position.y;
          this._trailPositions[base + 2] = d.mesh.position.z;
          this._trailPositions[base + 3] = tail.x;
          this._trailPositions[base + 4] = tail.y;
          this._trailPositions[base + 5] = tail.z;

          const glow = 1.0 - t;
          this._trailColors[base] = d.isCyan ? 0.4 * glow : 1.0 * glow;
          this._trailColors[base + 1] = d.isCyan ? 0.9 * glow : 0.6 * glow;
          this._trailColors[base + 2] = d.isCyan ? 1.0 * glow : 0.2 * glow;
          this._trailColors[base + 3] = 0;
          this._trailColors[base + 4] = 0;
          this._trailColors[base + 5] = 0;
          trailIdx++;
        }
      }
    }
    this._trailLines.geometry.attributes.position.needsUpdate = true;
    this._trailLines.geometry.attributes.color.needsUpdate = true;
    this._trailLines.geometry.setDrawRange(0, trailIdx * 2);

    for (let i = this.lights.length - 1; i >= 0; i--) {
      const l = this.lights[i];
      l.age += dt;
      const t = l.age / l.life;
      if (t >= 1) {
        this.scene.remove(l.light);
        this.lights.splice(i, 1);
      } else {
        l.light.intensity = l.peak * Math.pow(1 - t, 2.0);
      }
    }

    for (let i = this.empWaves.length - 1; i >= 0; i--) {
      const w = this.empWaves[i];
      w.age += dt;
      const t = w.age / w.life;
      if (t >= 1) {
        this.scene.remove(w.mesh);
        w.mesh.material.dispose();
        this.empWaves.splice(i, 1);
      } else {
        const ease = 1 - Math.pow(1 - t, 2.4);
        w.mesh.scale.setScalar(Math.max(1, ease * w.maxRadius));
        w.mesh.material.uniforms.uProgress.value = t;
      }
    }

    // Droplet afterimage ghosts: shrink toward 0.1 scale and fade out
    for (let i = this.dropletTrails.length - 1; i >= 0; i--) {
      const g = this.dropletTrails[i];
      g.age += dt;
      const t = g.age / g.life;
      if (t >= 1) {
        this.scene.remove(g.mesh);
        g.mesh.material.dispose();
        this.dropletTrails.splice(i, 1);
      } else {
        const s = THREE.MathUtils.lerp(g.peakScale, 0.1, Math.pow(t, 1.35));
        g.mesh.scale.setScalar(s);
        g.mesh.material.opacity = 0.62 * (1 - t) * (1 - t);
      }
    }
  }
}
