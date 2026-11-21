import * as THREE from 'three';
import { SOLAR_BODIES } from '../core/Constants.js';
import {
  createGlowSpriteTexture,
  createSaturnRingTexture,
} from '../core/ProceduralTextures.js';
import {
  createEarthHaloMaterial,
  createEarthMaterial,
  createPhotographicGasMaterial,
  createPhotographicRockyMaterial,
  createPlanetHaloMaterial,
  createPlanetRingMaterial,
  createRockyPlanetMaterial,
  createSunMaterial,
} from './PlanetShaders.js';

function loadSrgbTex(loader, url) {
  const t = loader.load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class SolarSystem {
  constructor(scene) {
    this.scene = scene;
    this.bodies = new Map();
    this.bodyList = [];
    this.moons = [];
    this.planetShaders = [];
    this.saturnShaders = [];
    this.ringMaterials = [];
    this.orbitLines = new THREE.Group();
    this.scene.add(this.orbitLines);

    // Primary dynamic sun DirectionalLight tracking the player ship
    this.sunLight = new THREE.DirectionalLight(0xfff4e2, 3.2);
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Scratch vectors for zero-allocation queries & swept collision resolution
    this._tmpBodyPos = new THREE.Vector3();
    this._colWorldCenter = new THREE.Vector3();
    this._colDelta = new THREE.Vector3();
    this._colSeg = new THREE.Vector3();

    this.hemiLight = new THREE.HemisphereLight(0x4c78b8, 0x0b1220, 0.34);
    this.scene.add(this.hemiLight);

    // Pre-generate asteroid spatial data for belt collision + volatile plasma crystals
    this.asteroidCount = 2200;
    this.asteroidPos = new Float32Array(this.asteroidCount * 3);
    this.asteroidRadii = new Float32Array(this.asteroidCount);
    this.asteroidMesh = null;
    this.volatileCrystals = [];

    // Saturn ring ice boulders
    this.ringIceCount = 720;
    this.ringIceMesh = null;

    this._initBodies();
    this._initAsteroidBelt();
    this._initSaturnIceRocks();
  }

  _initBodies() {
    const texLoader = new THREE.TextureLoader();
    const glowTex = createGlowSpriteTexture('rgba(255,245,210,1)', 'rgba(255,175,65,0.52)', 256);

    const earthDay = loadSrgbTex(texLoader, './assets/earth_day.webp');
    const earthNight = loadSrgbTex(texLoader, './assets/earth_night.webp');
    const earthClouds = texLoader.load('./assets/earth_clouds.webp');
    earthClouds.anisotropy = 8;

    const sunTex = loadSrgbTex(texLoader, './assets/sun.webp');
    const mercuryTex = loadSrgbTex(texLoader, './assets/mercury.webp');
    const venusTex = loadSrgbTex(texLoader, './assets/venus.webp');
    const marsTex = loadSrgbTex(texLoader, './assets/mars.webp');
    const jupiterTex = loadSrgbTex(texLoader, './assets/jupiter.webp');
    const saturnTex = loadSrgbTex(texLoader, './assets/saturn.webp');
    const uranusTex = loadSrgbTex(texLoader, './assets/uranus.webp');
    const neptuneTex = loadSrgbTex(texLoader, './assets/neptune.webp');
    const moonTex = loadSrgbTex(texLoader, './assets/moon.webp');

    const saturnRingTex = loadSrgbTex(texLoader, './assets/saturn_ring.webp');
    const uranusRingTex = createSaturnRingTexture(true);

    const gasTextures = {
      jupiter: jupiterTex,
      saturn: saturnTex,
      uranus: uranusTex,
      neptune: neptuneTex,
    };

    for (const def of SOLAR_BODIES) {
      if (def.type === 'belt') {
        // Virtual body anchor for Asteroid Belt
        const anchor = new THREE.Group();
        const a = def.initialAngle;
        anchor.position.set(Math.cos(a) * def.orbitRadius, 0, Math.sin(a) * def.orbitRadius);
        this.scene.add(anchor);
        const rec = { def, group: anchor, mesh: anchor, angle: a, clouds: null };
        this.bodies.set(def.id, rec);
        this.bodyList.push(rec);
        continue;
      }

      const group = new THREE.Group();
      const angle = def.initialAngle;
      if (def.orbitRadius > 0) {
        group.position.set(Math.cos(angle) * def.orbitRadius, 0, Math.sin(angle) * def.orbitRadius);
        this._addOrbitLine(def.orbitRadius, def.color);
      }

      const tiltGroup = new THREE.Group();
      tiltGroup.rotation.z = THREE.MathUtils.degToRad(def.axialTiltDeg || 0);
      group.add(tiltGroup);

      let mesh;
      let clouds = null;

      if (def.id === 'sun') {
        this.sunMat = createSunMaterial(sunTex);
        mesh = new THREE.Mesh(new THREE.SphereGeometry(def.radius, 80, 60), this.sunMat);
        tiltGroup.add(mesh);

        // Multi-layer solar corona sprites
        const corona1 = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: glowTex,
            color: '#ff9f45',
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        corona1.scale.set(def.radius * 4.4, def.radius * 4.4, 1);
        group.add(corona1);

        const corona2 = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: glowTex,
            color: '#ffe8b8',
            transparent: true,
            opacity: 0.45,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        corona2.scale.set(def.radius * 7.8, def.radius * 7.8, 1);
        group.add(corona2);
      } else if (def.id === 'earth') {
        const earthMat = createEarthMaterial(earthDay, earthNight, earthClouds);
        this.planetShaders.push(earthMat);
        mesh = new THREE.Mesh(new THREE.SphereGeometry(def.radius, 144, 96), earthMat);
        tiltGroup.add(mesh);

        // Razor-thin 11th-power outer orbital atmosphere halo matching natural-selection.html
        const atmo = new THREE.Mesh(
          new THREE.SphereGeometry(def.radius * 1.012, 128, 96),
          createEarthHaloMaterial()
        );
        atmo.renderOrder = 1;
        tiltGroup.add(atmo);
      } else if (def.type === 'gas' || def.type === 'ice') {
        const rimColor =
          def.id === 'jupiter'
            ? '#ffe0ad'
            : def.id === 'saturn'
            ? '#f5e2ba'
            : def.id === 'uranus'
            ? '#7ef0ff'
            : '#3b82ff';
        const gasMat = createPhotographicGasMaterial(
          gasTextures[def.id],
          { rimColor, hasCloudsDrift: true, isSaturn: def.id === 'saturn' },
          saturnRingTex
        );
        this.planetShaders.push(gasMat);
        if (def.id === 'saturn') {
          this.saturnShaders.push({ mat: gasMat, group, tiltGroup });
        }
        const segsW = def.id === 'jupiter' || def.id === 'saturn' ? 144 : 128;
        mesh = new THREE.Mesh(new THREE.SphereGeometry(def.radius, segsW, 96), gasMat);

        // Authentic gas-giant rotational oblateness
        const oblateY = def.id === 'saturn' ? 0.902 : def.id === 'jupiter' ? 0.935 : 0.98;
        mesh.scale.set(1, oblateY, 1);
        tiltGroup.add(mesh);

        const atmo = new THREE.Mesh(
          new THREE.SphereGeometry(def.radius * 1.013, segsW, 96),
          createPlanetHaloMaterial(rimColor, 11.0, def.id === 'neptune' ? 0.74 : 0.55)
        );
        atmo.scale.set(1, oblateY, 1);
        atmo.renderOrder = 1;
        tiltGroup.add(atmo);

        if (def.ringInner && def.ringOuter) {
          const isUranus = def.id === 'uranus';
          const rTex = isUranus ? uranusRingTex : saturnRingTex;
          const ringGeo = new THREE.RingGeometry(def.ringInner, def.ringOuter, 192, 2);
          const ringMat = createPlanetRingMaterial(rTex, def.radius, def.ringInner, def.ringOuter, isUranus);
          this.ringMaterials.push({ mat: ringMat, parentGroup: group });
          const ringMesh = new THREE.Mesh(ringGeo, ringMat);
          ringMesh.rotation.x = Math.PI * 0.5;
          tiltGroup.add(ringMesh);
        }
      } else {
        // Real 4K NASA MESSENGER/Viking/Akatsuki-grade maps + analytical luminance-gradient relief bump
        let mat;
        if (def.id === 'venus') {
          mat = createPhotographicGasMaterial(venusTex, {
            rimColor: '#ffd580',
            hasCloudsDrift: true,
            isSaturn: false,
          });
        } else if (def.id === 'mars') {
          mat = createPhotographicRockyMaterial(marsTex, { isMars: true, bumpStrength: 2.8 });
        } else {
          mat = createPhotographicRockyMaterial(mercuryTex, { isMars: false, bumpStrength: 3.1 });
        }
        this.planetShaders.push(mat);
        const segsW = def.id === 'mercury' ? 128 : 144;
        mesh = new THREE.Mesh(new THREE.SphereGeometry(def.radius, segsW, 96), mat);
        tiltGroup.add(mesh);

        if (def.id === 'venus' || def.id === 'mars') {
          const atmoCol = def.id === 'venus' ? '#ffd580' : '#ff7b4a';
          const atmo = new THREE.Mesh(
            new THREE.SphereGeometry(def.radius * 1.014, 128, 96),
            createPlanetHaloMaterial(atmoCol, 10.5, def.id === 'venus' ? 0.72 : 0.48)
          );
          atmo.renderOrder = 1;
          tiltGroup.add(atmo);
        }
      }

      // Add high-resolution moons (NASA 4K Moon + procedural Io/Europa/Ganymede/Triton)
      if (def.moons) {
        for (const mDef of def.moons) {
          const mMat =
            mDef.id === 'moon'
              ? createPhotographicRockyMaterial(moonTex, { isMars: false, bumpStrength: 3.0 })
              : createRockyPlanetMaterial(mDef.id);
          this.planetShaders.push(mMat);
          const mMesh = new THREE.Mesh(new THREE.SphereGeometry(mDef.radius, 96, 72), mMat);
          const ma = mDef.initialAngle;
          mMesh.position.set(Math.cos(ma) * mDef.orbitRadius, 0, Math.sin(ma) * mDef.orbitRadius);
          group.add(mMesh);
          this.moons.push({ def: mDef, mesh: mMesh, angle: ma });
        }
      }

      this.scene.add(group);
      const rec = { def, group, tiltGroup, mesh, clouds, angle };
      this.bodies.set(def.id, rec);
      this.bodyList.push(rec);
    }
  }

  _addOrbitLine(radius, colorHex) {
    const pts = [];
    const segs = 192;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.032,
      depthWrite: false,
    });
    this.orbitLines.add(new THREE.Line(geo, mat));
  }

  _initAsteroidBelt() {
    // Sculpted irregular rock geometry
    const geo = new THREE.DodecahedronGeometry(1.0, 1);
    const posAttr = geo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vy = posAttr.getY(i);
      const vz = posAttr.getZ(i);
      const n = 0.78 + 0.38 * Math.sin(vx * 3.7 + vy * 2.1 + vz * 4.3);
      posAttr.setXYZ(i, vx * n, vy * n * 0.82, vz * n);
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: '#7e7870',
      roughness: 0.9,
      metalness: 0.18,
    });

    const inst = new THREE.InstancedMesh(geo, mat, this.asteroidCount);
    const dummy = new THREE.Object3D();
    const beltDef = SOLAR_BODIES.find((b) => b.id === 'belt');
    const inner = beltDef.innerRadius;
    const outer = beltDef.outerRadius;
    const focalAngle = beltDef.initialAngle;

    for (let i = 0; i < this.asteroidCount; i++) {
      // Cluster ~35% denser near the Asteroid Belt warp sector for rich combat cover
      const isCluster = i < this.asteroidCount * 0.35;
      const a = isCluster
        ? focalAngle + (Math.random() - 0.5) * 0.36
        : Math.random() * Math.PI * 2;
      const r = inner + Math.random() * (outer - inner);
      const y = (Math.random() - 0.5) * (isCluster ? 160 : 280);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const scale = 2.2 + Math.pow(Math.random(), 2.8) * 16.5;

      this.asteroidPos[i * 3] = x;
      this.asteroidPos[i * 3 + 1] = y;
      this.asteroidPos[i * 3 + 2] = z;
      this.asteroidRadii[i] = scale * 0.95;

      dummy.position.set(x, y, z);
      dummy.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      dummy.scale.set(
        scale * (0.85 + Math.random() * 0.35),
        scale * (0.75 + Math.random() * 0.4),
        scale * (0.85 + Math.random() * 0.35)
      );
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    this.asteroidMesh = inst;
    this.scene.add(inst);

    // Spawn 18 Volatile Plasma Asteroids near the Asteroid Belt combat arena for tactical chain explosions
    const vGeo = new THREE.OctahedronGeometry(4.2, 0);
    for (let k = 0; k < 18; k++) {
      const a = focalAngle + (Math.random() - 0.5) * 0.14;
      const r = inner + 160 + Math.random() * (outer - inner - 320);
      const y = (Math.random() - 0.5) * 95;
      const mat = new THREE.MeshStandardMaterial({
        color: '#5ceaff',
        emissive: new THREE.Color(k % 2 === 0 ? '#24c8ff' : '#ff7a22'),
        emissiveIntensity: 3.2,
        roughness: 0.25,
        metalness: 0.4,
      });
      const crystal = new THREE.Mesh(vGeo, mat);
      crystal.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      this.scene.add(crystal);
      this.volatileCrystals.push({
        mesh: crystal,
        hp: 75,
        hitRadius: 5.5,
        cooldown: 0,
        colorHex: k % 2 === 0 ? '#4ce8ff' : '#ff9438',
      });
    }
  }

  _initSaturnIceRocks() {
    const saturnRec = this.bodies.get('saturn');
    if (!saturnRec) return;

    const geo = new THREE.IcosahedronGeometry(1.0, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: '#dce8f2',
      roughness: 0.42,
      metalness: 0.25,
    });
    const inst = new THREE.InstancedMesh(geo, mat, this.ringIceCount);
    const dummy = new THREE.Object3D();

    const rMin = saturnRec.def.ringInner + 10;
    const rMax = saturnRec.def.ringOuter - 15;
    for (let i = 0; i < this.ringIceCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rMin + Math.random() * (rMax - rMin);
      const y = (Math.random() - 0.5) * 8;
      const s = 0.9 + Math.pow(Math.random(), 2.5) * 4.5;
      dummy.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      dummy.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      dummy.scale.set(s, s * 0.7, s * 1.15);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    saturnRec.tiltGroup.add(inst);
    this.ringIceMesh = inst;
  }

  getBodyWorldPosition(id, out = new THREE.Vector3()) {
    const rec = this.bodies.get(id);
    if (!rec) return null;
    rec.group.getWorldPosition(out);
    return out;
  }

  getWarpTargetPosition(id, out = new THREE.Vector3()) {
    const rec = this.bodies.get(id);
    if (!rec) return null;
    rec.group.getWorldPosition(out);
    if (id === 'sun' || id === 'belt') {
      out.add(rec.def.warpOffset);
      return out;
    }

    // Dynamic sunlit 3/4 terminator vantage relative to Sol (0,0,0) — includes Earth for cinematic day/night split!
    const toSun = new THREE.Vector3(-out.x, 0, -out.z);
    if (toSun.lengthSq() > 0.001) {
      toSun.normalize();
    } else {
      toSun.set(0, 0, 1);
    }
    const tangent = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), toSun).normalize();
    const R = rec.def.radius;
    let sunF = 1.95;
    let tanF = 2.05;
    let upF = 0.46;
    if (id === 'earth') {
      sunF = 1.35;
      tanF = 2.38;
      upF = 0.52;
    } else if (id === 'saturn') {
      sunF = 2.45;
      tanF = 2.55;
      upF = 1.25;
    } else if (id === 'jupiter') {
      sunF = 1.75;
      tanF = 2.25;
      upF = 0.45;
    } else if (id === 'uranus') {
      sunF = 2.15;
      tanF = 2.20;
      upF = 0.55;
    }
    out.addScaledVector(toSun, R * sunF).addScaledVector(tangent, R * tanF);
    out.y += R * upF;
    return out;
  }

  _getBodyWarpRadii(rec) {
    const isSun = rec.def.id === 'sun';
    const hazardR = rec.def.radius + (isSun ? 54 : 24);
    const safeR = rec.def.radius + (isSun ? 145 : Math.min(58, rec.def.radius * 0.75 + 24));
    const orbitR = safeR + (isSun ? 240 : 120);
    return { hazardR, safeR, orbitR };
  }

  _isSegmentClearOfSphere(a, b, center, safeR, hazardR) {
    const seg = b.clone().sub(a);
    const segLen = seg.length();
    const distStart = a.distanceTo(center);
    if (segLen < 1e-4) return distStart >= hazardR;
    const dir = seg.multiplyScalar(1 / segLen);
    const s = center.clone().sub(a).dot(dir);
    if (s <= 0 && distStart >= hazardR) return true;
    const sClamped = THREE.MathUtils.clamp(s, 0, segLen);
    const closest = a.clone().addScaledVector(dir, sClamped);
    return closest.distanceToSquared(center) >= safeR * safeR;
  }

  _findEarliestBlockingBody(fromPos, toPos) {
    if (!fromPos || !toPos) return null;
    const seg = toPos.clone().sub(fromPos);
    const segLen = seg.length();
    if (segLen < 1) return null;
    const dir = seg.clone().multiplyScalar(1 / segLen);

    const worldCenter = this._colWorldCenter;
    let blocking = null;
    let earliestS = Infinity;

    for (const rec of this.bodyList) {
      if (rec.def.type === 'belt') continue;
      rec.group.getWorldPosition(worldCenter);
      const { hazardR, safeR, orbitR } = this._getBodyWarpRadii(rec);
      const rel = worldCenter.clone().sub(fromPos);
      const s = rel.dot(dir);
      const distStart = fromPos.distanceTo(worldCenter);
      if (s <= 0 && distStart >= hazardR) continue;

      const sClamped = THREE.MathUtils.clamp(s, 0, segLen);
      const closest = fromPos.clone().addScaledVector(dir, sClamped);
      const distSq = closest.distanceToSquared(worldCenter);
      const distEnd = toPos.distanceTo(worldCenter);
      const checkR = distEnd < safeR && s >= segLen ? Math.max(hazardR, Math.min(safeR, distEnd - 2)) : safeR;

      if (distSq < checkR * checkR && sClamped < earliestS) {
        earliestS = sClamped;
        blocking = {
          center: worldCenter.clone(),
          hazardR,
          safeR,
          orbitR,
          closest,
          s: sClamped,
        };
      }
    }
    return blocking;
  }

  isWarpSegmentClear(fromPos, toPos) {
    return !this._findEarliestBlockingBody(fromPos, toPos);
  }

  computeSafeWarpWaypoints(fromPos, toPos) {
    if (!fromPos || !toPos) return [toPos.clone()];
    const route = [fromPos.clone(), toPos.clone()];

    for (let iter = 0; iter < 8 && route.length < 10; iter++) {
      let inserted = false;
      for (let i = 0; i < route.length - 1; i++) {
        const a = route[i];
        const b = route[i + 1];
        const blocking = this._findEarliestBlockingBody(a, b);
        if (!blocking) continue;

        const dir = b.clone().sub(a).normalize();
        const outVec = blocking.closest.clone().sub(blocking.center);
        if (outVec.lengthSq() < 1) {
          outVec.crossVectors(dir, new THREE.Vector3(0, 1, 0));
          if (outVec.lengthSq() < 0.01) outVec.set(0, 1, 0);
        }
        outVec.y += blocking.safeR * 0.75;
        outVec.normalize();

        const mid = blocking.center.clone().addScaledVector(outVec, blocking.orbitR);
        const inserts = [];

        if (!this._isSegmentClearOfSphere(a, mid, blocking.center, blocking.safeR, blocking.hazardR)) {
          const aRad = a.clone().sub(blocking.center);
          if (aRad.lengthSq() < 1e-4) aRad.copy(dir).negate();
          else aRad.normalize();
          const pInDir = aRad.addScaledVector(outVec, 1.15).normalize();
          inserts.push(blocking.center.clone().addScaledVector(pInDir, blocking.orbitR));
        }

        inserts.push(mid);

        if (!this._isSegmentClearOfSphere(mid, b, blocking.center, blocking.safeR, blocking.hazardR)) {
          const bRad = b.clone().sub(blocking.center);
          if (bRad.lengthSq() < 1e-4) bRad.copy(dir);
          else bRad.normalize();
          const pOutDir = bRad.addScaledVector(outVec, 1.15).normalize();
          inserts.push(blocking.center.clone().addScaledVector(pOutDir, blocking.orbitR));
        }

        route.splice(i + 1, 0, ...inserts);
        inserted = true;
        break;
      }
      if (!inserted) break;
    }

    return route.slice(1);
  }

  getNearestBody(pos) {
    let best = null;
    let bestDist = Infinity;
    const tmp = this._tmpBodyPos;
    for (const rec of this.bodyList) {
      rec.group.getWorldPosition(tmp);
      const d = pos.distanceTo(tmp) - rec.def.radius;
      if (d < bestDist) {
        bestDist = d;
        best = { rec, distanceToSurface: d, center: tmp.clone() };
      }
    }
    return best;
  }

  _deflectFromSphere(shipPos, shipVel, center, minDist, bounce, prevPos) {
    const start = prevPos || shipPos;
    const m = this._colDelta.subVectors(start, center);
    const mSq = m.lengthSq();
    const minDistSq = minDist * minDist;
    const surfaceInner = Math.max(0, minDist - 0.05);
    const surfaceInnerSq = surfaceInner * surfaceInner;

    let nx = 0;
    let ny = 1;
    let nz = 0;

    if (prevPos && mSq >= surfaceInnerSq && mSq <= minDistSq) {
      // Resting right at surface boundary: allow outward or tangential motion without sticky re-trigger
      const seg = this._colSeg.subVectors(shipPos, start);
      if (m.dot(seg) >= 0) return false;
      const dist = Math.sqrt(mSq);
      nx = m.x / dist;
      ny = m.y / dist;
      nz = m.z / dist;
    } else if (mSq < (prevPos ? surfaceInnerSq : minDistSq)) {
      // Truly inside or exact center coincidence: separate radially regardless of direction
      if (mSq > 1e-10) {
        const dist = Math.sqrt(mSq);
        nx = m.x / dist;
        ny = m.y / dist;
        nz = m.z / dist;
      } else if (shipVel.lengthSq() > 1e-6) {
        const velLen = shipVel.length();
        nx = -shipVel.x / velLen;
        ny = -shipVel.y / velLen;
        nz = -shipVel.z / velLen;
      }
    } else {
      if (!prevPos) return false;
      const seg = this._colSeg.subVectors(shipPos, start);
      const a = seg.lengthSq();
      if (a <= 1e-8) return false;
      const b = m.dot(seg);
      if (b >= 0) return false; // Moving away or tangentially clear of sphere
      const c = mSq - minDistSq;
      const disc = b * b - a * c;
      if (disc < 0) return false;
      const t = (-b - Math.sqrt(disc)) / a;
      if (t < 0 || t > 1) return false;

      // Exact surface entry contact normal (prevents closest-point perpendicular normal slip)
      const hitX = start.x + seg.x * t - center.x;
      const hitY = start.y + seg.y * t - center.y;
      const hitZ = start.z + seg.z * t - center.z;
      const hitLen = Math.hypot(hitX, hitY, hitZ) || minDist;
      nx = hitX / hitLen;
      ny = hitY / hitLen;
      nz = hitZ / hitLen;
    }

    const pushDist = minDist + 0.002;
    shipPos.set(center.x + nx * pushDist, center.y + ny * pushDist, center.z + nz * pushDist);
    const vn = shipVel.x * nx + shipVel.y * ny + shipVel.z * nz;
    if (vn < 0) {
      shipVel.x -= nx * vn * bounce;
      shipVel.y -= ny * vn * bounce;
      shipVel.z -= nz * vn * bounce;
    }
    return true;
  }

  resolveShipCollisions(shipPos, shipVel, shipRadius, prevPos = null, dt = 0.016, isWarping = false) {
    const worldCenter = this._colWorldCenter;
    const delta = this._colDelta;

    // 1. Soft atmospheric deflection around stars & planets
    for (const rec of this.bodyList) {
      if (rec.def.type === 'belt') continue;
      rec.group.getWorldPosition(worldCenter);
      const minDist = rec.def.radius + shipRadius + (rec.def.id === 'sun' ? 40 : 12);
      if (this._deflectFromSphere(shipPos, shipVel, worldCenter, minDist, 1.35, prevPos)) {
        return rec.def.id === 'sun' ? 'SOLAR_CORONA' : 'ATMOSPHERE';
      }
    }

    // While in warp transit, bypass minor asteroid/moon/ring turbulence so warp lane stays clean
    if (isWarping) return null;

    // 1b. Moon spherical collision deflection (Earth Moon, Galilean Moons, Triton)
    for (const m of this.moons) {
      m.mesh.getWorldPosition(worldCenter);
      const minDist = m.def.radius + shipRadius + 6;
      if (this._deflectFromSphere(shipPos, shipVel, worldCenter, minDist, 1.35, prevPos)) {
        return 'MOON';
      }
    }

    // 1c. Saturn inclined icy ring plane micro-turbulence check (dt-normalized drag)
    const saturnRec = this.bodies.get('saturn');
    if (saturnRec) {
      saturnRec.tiltGroup.worldToLocal(delta.copy(shipPos));
      const rRing = Math.hypot(delta.x, delta.z);
      if (
        Math.abs(delta.y) < 5.2 &&
        rRing > saturnRec.def.ringInner + 8 &&
        rRing < saturnRec.def.ringOuter - 12 &&
        shipVel.lengthSq() > 3600
      ) {
        shipVel.multiplyScalar(Math.exp(-0.92 * Math.max(0.001, dt)));
        return 'RING_ICE';
      }
    }

    // 2. Fast Asteroid Belt swept collision check (only check if near belt radial band)
    const rHoriz = Math.hypot(shipPos.x, shipPos.z);
    if (rHoriz > 5180 && rHoriz < 6720 && Math.abs(shipPos.y) < 310) {
      for (let i = 0; i < this.asteroidCount; i++) {
        const ax = this.asteroidPos[i * 3];
        const ay = this.asteroidPos[i * 3 + 1];
        const az = this.asteroidPos[i * 3 + 2];
        worldCenter.set(ax, ay, az);
        const minR = this.asteroidRadii[i] + shipRadius;
        if (this._deflectFromSphere(shipPos, shipVel, worldCenter, minR, 1.45, prevPos)) {
          return 'ASTEROID';
        }
      }
    }
    return null;
  }

  update(dt, time, shipPos) {
    if (this.sunMat) {
      this.sunMat.uniforms.uTime.value = time;
    }

    // Gentle orbital drift & axial rotation
    for (const rec of this.bodyList) {
      if (rec.def.orbitRadius > 0 && rec.def.orbitSpeed) {
        rec.angle += rec.def.orbitSpeed * dt;
        rec.group.position.set(
          Math.cos(rec.angle) * rec.def.orbitRadius,
          0,
          Math.sin(rec.angle) * rec.def.orbitRadius
        );
      }
      if (rec.mesh && rec.def.rotationSpeed) {
        rec.mesh.rotation.y += rec.def.rotationSpeed * dt;
      }
      if (rec.clouds) {
        rec.clouds.rotation.y += rec.def.rotationSpeed * 1.32 * dt;
      }
    }

    // Moon orbits
    for (const m of this.moons) {
      m.angle += m.def.orbitSpeed * dt;
      m.mesh.position.set(
        Math.cos(m.angle) * m.def.orbitRadius,
        0,
        Math.sin(m.angle) * m.def.orbitRadius
      );
      m.mesh.rotation.y += 0.04 * dt;
    }

    for (const mat of this.planetShaders) {
      if (mat.uniforms.uTime) mat.uniforms.uTime.value = time;
    }

    for (const s of this.saturnShaders) {
      s.group.getWorldPosition(s.mat.uniforms.uPlanetPos.value);
      s.mat.uniforms.uRingNormal.value
        .set(0, 1, 0)
        .applyQuaternion(s.tiltGroup.getWorldQuaternion(new THREE.Quaternion()))
        .normalize();
    }

    for (const r of this.ringMaterials) {
      r.parentGroup.getWorldPosition(r.mat.uniforms.uPlanetPos.value);
    }

    for (const vc of this.volatileCrystals) {
      if (vc.cooldown > 0) {
        vc.cooldown -= dt;
        if (vc.cooldown <= 0) {
          vc.hp = 75;
          vc.mesh.visible = true;
        }
      } else {
        vc.mesh.rotation.y += dt * 0.9;
        vc.mesh.rotation.x += dt * 0.5;
      }
    }

    // Update dynamic Sun DirectionalLight pointing from Sol (0,0,0) -> shipPos
    const sunDir = shipPos.clone().normalize();
    if (sunDir.lengthSq() < 0.0001) sunDir.set(0, 0, 1);
    this.sunLight.position.copy(shipPos).addScaledVector(sunDir, -600);
    this.sunLight.target.position.copy(shipPos);

    // Distance-based solar warmth & intensity (rich at Mercury, crisp at Earth, moody steel-blue at outer system)
    const dist = shipPos.length();
    const tOuter = THREE.MathUtils.clamp((dist - 1200) / 19000, 0, 1);
    this.sunLight.intensity = THREE.MathUtils.lerp(4.0, 2.35, tOuter);
    this.sunLight.color.setRGB(
      1.0,
      THREE.MathUtils.lerp(0.96, 0.90, tOuter),
      THREE.MathUtils.lerp(0.86, 0.98, tOuter)
    );
  }
}
