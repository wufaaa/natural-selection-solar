import * as THREE from 'three';

export class Starfield {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.skydome = this._createSkydome();
    this.group.add(this.skydome);

    this.starPoints = this._createSpectralStars(8500);
    this.group.add(this.starPoints);

    this._dummy = new THREE.Object3D();
    this._velDir = new THREE.Vector3(0, 0, -1);
    this._up = new THREE.Vector3(0, 1, 0);
    this._tmpQuat = new THREE.Quaternion();
    this._dustWarmed = false;
    this._targetDustColor = new THREE.Color('#a4ebff');
    this._sectorDustPalette = {
      sun: new THREE.Color('#ffd074'),
      mercury: new THREE.Color('#ffcb78'),
      venus: new THREE.Color('#ffe09e'),
      earth: new THREE.Color('#a4ebff'),
      mars: new THREE.Color('#ff9b6a'),
      belt: new THREE.Color('#b8c6d8'),
      jupiter: new THREE.Color('#ffd39e'),
      saturn: new THREE.Color('#e6f2ff'),
      uranus: new THREE.Color('#7cf4ff'),
      neptune: new THREE.Color('#66a8ff'),
    };

    // Subtle 3D space dust motes / warp speed lines
    this.dustCount = 700;
    this.dustBoxSize = 340;
    this.dustOffsets = new Float32Array(this.dustCount * 3);
    this.dustMesh = this._createVelocityDust();
    this.scene.add(this.dustMesh);
  }

  _createSkydome() {
    const loader = new THREE.TextureLoader();
    const milkyTex = loader.load('./assets/milkyway_8k.webp');
    milkyTex.colorSpace = THREE.SRGBColorSpace;
    milkyTex.anisotropy = 8;
    milkyTex.wrapS = THREE.RepeatWrapping;
    milkyTex.wrapT = THREE.ClampToEdgeWrapping;

    const geo = new THREE.SphereGeometry(42000, 64, 48);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        tMilky: { value: milkyTex },
      },
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform sampler2D tMilky;
        varying vec3 vDir;

        vec3 sampleEquirect(vec3 d) {
          float u = atan(d.z, d.x) / 6.2831853 + 0.5;
          float v = asin(clamp(d.y, -0.9999, 0.9999)) / 3.14159265 + 0.5;
          vec3 c = texture2D(tMilky, vec2(u, v)).rgb;
          vec2 px = vec2(1.0 / 6144.0, 1.0 / 3072.0);
          vec3 nb = (
            texture2D(tMilky, vec2(u + px.x, v)).rgb +
            texture2D(tMilky, vec2(u - px.x, v)).rgb +
            texture2D(tMilky, vec2(u, clamp(v + px.y, 0.001, 0.999))).rgb +
            texture2D(tMilky, vec2(u, clamp(v - px.y, 0.001, 0.999))).rgb
          ) * 0.25;
          return max(vec3(0.0), c + (c - nb) * 0.45);
        }

        // Tilt ~32 deg and align galactic center toward the primary forward/starboard horizon
        void main() {
          vec3 raw = normalize(vDir);
          // Tilt ~32 deg and align galactic center toward the primary forward/starboard horizon!
          float c = cos(0.56);
          float s = sin(0.56);
          vec3 tilted = vec3(
            raw.x,
            raw.y * c - raw.z * s,
            raw.y * s + raw.z * c
          );
          float c2 = cos(-2.15);
          float s2 = sin(-2.15);
          vec3 ray = normalize(vec3(
            tilted.x * c2 - tilted.z * s2,
            tilted.y,
            tilted.x * s2 + tilted.z * c2
          ));

          vec3 col = sampleEquirect(ray);
          // Rich crystal-clear deep-space Milky Way balance: crisp dusty core & azure nebulae against deep cosmos
          col = max(vec3(0.0), pow(col, vec3(1.12)) * 1.48);

          gl_FragColor = vec4(col, 1.0);
          #include <logdepthbuf_fragment>
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    return mesh;
  }

  _createSpectralStars(count) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const heroes = new Float32Array(count);

    // Realistic blackbody stellar spectral classes: O/B blue-white, A pure white, F/G cream, K/M gold-orange
    const palette = [
      new THREE.Color('#9dc8ff'),
      new THREE.Color('#cbe2ff'),
      new THREE.Color('#f7faff'),
      new THREE.Color('#fff5e0'),
      new THREE.Color('#ffd39b'),
    ];

    const qTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.56, -2.15, 0, 'YXZ'));
    const vTmp = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      // Concentrate 55% of pinpoint stars near the tilted Milky Way galactic plane
      const inBand = i < count * 0.55;
      const u = inBand
        ? Math.tanh((Math.random() - 0.5) * 2.2) * 0.34
        : Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const sinPhi = Math.sqrt(Math.max(0, 1 - u * u));
      const dist = 31000 + Math.random() * 8000;

      vTmp.set(
        sinPhi * Math.cos(theta) * dist,
        u * dist,
        sinPhi * Math.sin(theta) * dist
      ).applyQuaternion(qTilt);

      positions[i * 3] = vTmp.x;
      positions[i * 3 + 1] = vTmp.y;
      positions[i * 3 + 2] = vTmp.z;

      const c = palette[i % palette.length];
      const roll = Math.random();
      let lum;
      let sz;
      let isHero = 0.0;
      if (roll > 0.981) {
        isHero = 1.0;
        lum = 1.25;
        sz = 4.2 + Math.random() * 2.2;
      } else if (roll > 0.85) {
        lum = 0.72;
        sz = 1.65 + Math.random() * 0.65;
      } else {
        lum = 0.28 + Math.random() * 0.26;
        sz = 1.05;
      }

      colors[i * 3] = c.r * lum;
      colors[i * 3 + 1] = c.g * lum;
      colors[i * 3 + 2] = c.b * lum;

      sizes[i] = sz;
      phases[i] = Math.random() * Math.PI * 2;
      heroes[i] = isHero;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('aHero', new THREE.BufferAttribute(heroes, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 color;
        attribute float aSize;
        attribute float aPhase;
        attribute float aHero;
        uniform float uTime;
        varying vec3 vColor;
        varying float vTwinkle;
        varying float vHero;
        void main() {
          vColor = color;
          vHero = aHero;
          vTwinkle = 0.90 + 0.10 * sin(uTime * 1.1 + aPhase);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize;
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        varying vec3 vColor;
        varying float vTwinkle;
        varying float vHero;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float d = length(p);
          if (d > 0.5) discard;
          float core = exp(-d * d * (vHero > 0.5 ? 46.0 : 62.0));
          float spike = 0.0;
          if (vHero > 0.5) {
            spike = (exp(-abs(p.x) * 32.0) * exp(-abs(p.y) * 5.5) +
                     exp(-abs(p.y) * 32.0) * exp(-abs(p.x) * 5.5)) * 0.72;
          }
          float alpha = clamp(core + spike, 0.0, 1.0);
          gl_FragColor = vec4(vColor * vTwinkle, alpha);
          #include <logdepthbuf_fragment>
        }
      `,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    return points;
  }

  _createVelocityDust() {
    const geo = new THREE.BoxGeometry(0.03, 1.0, 0.03);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#a4ebff'),
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const inst = new THREE.InstancedMesh(geo, mat, this.dustCount);
    inst.frustumCulled = false;

    for (let i = 0; i < this.dustCount; i++) {
      this.dustOffsets[i * 3] = (Math.random() - 0.5) * this.dustBoxSize;
      this.dustOffsets[i * 3 + 1] = (Math.random() - 0.5) * this.dustBoxSize;
      this.dustOffsets[i * 3 + 2] = (Math.random() - 0.5) * this.dustBoxSize;
      this._dummy.position.set(
        this.dustOffsets[i * 3],
        this.dustOffsets[i * 3 + 1],
        this.dustOffsets[i * 3 + 2]
      );
      this._dummy.scale.set(1, 0.1, 1);
      this._dummy.updateMatrix();
      inst.setMatrixAt(i, this._dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    return inst;
  }

  update(dt, time, focusPos, shipVelocity, isWarping = false, sectorId = null) {
    this.group.position.copy(focusPos);
    this.starPoints.material.uniforms.uTime.value = time;

    const targetTint = (sectorId && this._sectorDustPalette[sectorId]) || this._targetDustColor;
    this.dustMesh.material.color.lerp(targetTint, Math.min(1, dt * 1.8));

    const speed = shipVelocity.length();
    const half = this.dustBoxSize * 0.5;
    if (speed > 1.0) {
      this._velDir.copy(shipVelocity).divideScalar(speed);
    } else {
      this._velDir.set(0, 0, -1);
    }

    const q = this._tmpQuat.setFromUnitVectors(this._up, this._velDir);
    const streakLen = isWarping
      ? 38.0
      : Math.max(0.08, Math.min(7.2, speed * 0.017));
    const thickness = isWarping ? 1.65 : 0.65 + Math.min(0.4, speed / 420);

    this.dustMesh.material.opacity = isWarping
      ? 0.66
      : THREE.MathUtils.clamp((speed - 45) / 380, 0.0, 0.22);

    if (speed < 0.05 && !isWarping && this._dustWarmed) {
      return;
    }
    this._dustWarmed = true;

    const stepX = -shipVelocity.x * dt;
    const stepY = -shipVelocity.y * dt;
    const stepZ = -shipVelocity.z * dt;

    for (let i = 0; i < this.dustCount; i++) {
      const idx = i * 3;
      let dx = this.dustOffsets[idx] + stepX;
      let dy = this.dustOffsets[idx + 1] + stepY;
      let dz = this.dustOffsets[idx + 2] + stepZ;

      if (dx > half) dx -= this.dustBoxSize;
      else if (dx < -half) dx += this.dustBoxSize;
      if (dy > half) dy -= this.dustBoxSize;
      else if (dy < -half) dy += this.dustBoxSize;
      if (dz > half) dz -= this.dustBoxSize;
      else if (dz < -half) dz += this.dustBoxSize;

      this.dustOffsets[idx] = dx;
      this.dustOffsets[idx + 1] = dy;
      this.dustOffsets[idx + 2] = dz;

      this._dummy.position.set(focusPos.x + dx, focusPos.y + dy, focusPos.z + dz);
      this._dummy.quaternion.copy(q);
      this._dummy.scale.set(thickness, streakLen, thickness);
      this._dummy.updateMatrix();
      this.dustMesh.setMatrixAt(i, this._dummy.matrix);
    }
    this.dustMesh.instanceMatrix.needsUpdate = true;
  }
}
