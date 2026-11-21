import * as THREE from 'three';

const GLSL_NOISE_3D = /* glsl */ `
float pHash31(vec3 p) {
  p = fract(p * 0.3183099 + 0.1) * 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
vec3 pHash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float pNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(pHash31(i), pHash31(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(pHash31(i + vec3(0.0, 1.0, 0.0)), pHash31(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(pHash31(i + vec3(0.0, 0.0, 1.0)), pHash31(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(pHash31(i + vec3(0.0, 1.0, 1.0)), pHash31(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z
  );
}
float pFbm3(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * pNoise3(p);
    p = p * 2.04 + vec3(7.1, 13.7, 3.9);
    a *= 0.5;
  }
  return s;
}
float craterLayer(vec3 p, float scale) {
  vec3 sp = p * scale;
  vec3 ip = floor(sp);
  vec3 fp = fract(sp);
  float dMin = 8.0;
  float seedVal = 0.0;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 nb = vec3(float(x), float(y), float(z));
        vec3 rnd = pHash33(ip + nb);
        vec3 diff = nb + 0.15 + 0.7 * rnd - fp;
        float d = length(diff);
        if (d < dMin) {
          dMin = d;
          seedVal = rnd.x;
        }
      }
    }
  }
  if (seedVal < 0.38) return 0.0;
  float r = 0.24 + 0.24 * fract(seedVal * 13.7);
  float nr = dMin / r;
  if (nr > 1.45) return 0.0;
  float bowl = -0.36 * (1.0 - smoothstep(0.0, 0.86, nr));
  float rimT = (nr - 0.96) * 5.2;
  float rim = 0.24 * exp(-(rimT * rimT));
  return bowl + rim;
}
`;

const COMMON_VERTEX_WITH_BASIS = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  varying vec3 vLocalPos;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  varying vec3 vModelX;
  varying vec3 vModelY;
  varying vec3 vModelZ;
  void main() {
    vUv = uv;
    vLocalPos = normalize(position);
    mat3 m3 = mat3(modelMatrix);
    vWorldNormal = normalize(m3 * normal);
    vModelX = normalize(m3 * vec3(1.0, 0.0, 0.0));
    vModelY = normalize(m3 * vec3(0.0, 1.0, 0.0));
    vModelZ = normalize(m3 * vec3(0.0, 0.0, 1.0));
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }
`;

export function createPlanetHaloMaterial(colorHex = '#217dff', power = 11.0, strength = 0.75) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uSunPos: { value: new THREE.Vector3(0, 0, 0) },
      uPower: { value: power },
      uStrength: { value: strength },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      void main() {
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor;
      uniform vec3 uSunPos;
      uniform float uPower;
      uniform float uStrength;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 L = normalize(uSunPos - vWorldPos);
        float f = 1.0 - max(0.0, dot(N, V));
        float sunlit = smoothstep(-0.45, 0.44, dot(N, L));
        float alpha = pow(f, uPower) * (0.14 + uStrength * sunlit);
        gl_FragColor = vec4(uColor * (1.05 + 0.35 * sunlit), clamp(alpha, 0.0, 1.0));
        #include <logdepthbuf_fragment>
      }
    `,
  });
}

export function createEarthHaloMaterial() {
  return createPlanetHaloMaterial('#217dff', 11.0, 0.65);
}

export function createSunMaterial(sunTex = null) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      tSun: { value: sunTex },
      uHasTex: { value: sunTex ? 1.0 : 0.0 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv;
      varying vec3 vNormalDir;
      varying vec3 vLocalPos;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vLocalPos = normalize(position);
        vNormalDir = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uTime;
      uniform sampler2D tSun;
      uniform float uHasTex;
      varying vec2 vUv;
      varying vec3 vNormalDir;
      varying vec3 vLocalPos;
      varying vec3 vWorldPos;
      ${GLSL_NOISE_3D}

      void main() {
        vec3 p = normalize(vLocalPos);
        float t = uTime * 0.085;
        float q = pFbm3(p * 7.5 + vec3(t, -t * 0.55, t * 0.35));
        float flow = (q - 0.5) * 0.025;

        vec3 texCol = vec3(1.0, 0.62, 0.16);
        if (uHasTex > 0.5) {
          vec3 s1 = texture2D(tSun, fract(vUv + vec2(t * 0.08 + flow, flow * 0.6))).rgb;
          vec3 s2 = texture2D(tSun, fract(vUv + vec2(-t * 0.05 - flow * 0.5, 0.0))).rgb;
          texCol = mix(s1, s2, 0.42);
        }

        float fine = pFbm3(p * 24.0 + vec3(q * 2.2 - t * 1.1));
        vec3 V = normalize(cameraPosition - vWorldPos);
        float ndv = clamp(dot(normalize(vNormalDir), V), 0.0, 1.0);
        float limb = pow(ndv, 0.45);

        vec3 col = texCol * (1.85 + 1.15 * smoothstep(0.35, 0.85, fine)) * (0.48 + 0.72 * limb);
        col += vec3(1.6, 0.48, 0.08) * pow(1.0 - ndv, 3.0) * 0.95;

        gl_FragColor = vec4(col, 1.0);
        #include <logdepthbuf_fragment>
      }
    `,
  });
}

export function createEarthMaterial(dayTex, nightTex, cloudTex = null) {
  return new THREE.ShaderMaterial({
    uniforms: {
      tDay: { value: dayTex },
      tNight: { value: nightTex },
      tClouds: { value: cloudTex },
      uHasCloudsTex: { value: cloudTex ? 1.0 : 0.0 },
      uSunPos: { value: new THREE.Vector3(0, 0, 0) },
      uTime: { value: 0 },
    },
    vertexShader: COMMON_VERTEX_WITH_BASIS,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D tDay;
      uniform sampler2D tNight;
      uniform sampler2D tClouds;
      uniform float uHasCloudsTex;
      uniform vec3 uSunPos;
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vLocalPos;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      varying vec3 vModelX;
      varying vec3 vModelY;
      varying vec3 vModelZ;
      ${GLSL_NOISE_3D}

      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 L = normalize(uSunPos - vWorldPos);
        vec3 V = normalize(cameraPosition - vWorldPos);

        float mu = dot(N, L);
        float day = smoothstep(-0.16, 0.46, mu);
        float dusk = exp(-abs(mu + 0.015) * 8.0);
        float edge = pow(1.0 - max(0.0, dot(N, V)), 4.8);

        // 4-tap unsharp-masked 5K NASA Earth Blue Marble texture
        vec2 pixel = vec2(1.0 / 5400.0, 1.0 / 2700.0);
        vec3 ground = texture2D(tDay, vUv).rgb;
        vec3 nearby = (
          texture2D(tDay, vUv + vec2(pixel.x, 0.0)).rgb +
          texture2D(tDay, vUv - vec2(pixel.x, 0.0)).rgb +
          texture2D(tDay, vUv + vec2(0.0, pixel.y)).rgb +
          texture2D(tDay, vUv - vec2(0.0, pixel.y)).rgb
        ) * 0.25;
        ground = max(vec3(0.0), ground + (ground - nearby) * 0.65);

        vec3 black = texture2D(tNight, vUv).rgb;
        float settlements = pow(max(0.0, max(black.r, black.g) - black.b * 0.62 - 0.012), 0.86);

        // Blend real 4K NASA cyclone/weather clouds with infinite-res 3D vapor wisps
        vec2 cloudUv = vec2(fract(vUv.x + uTime * 0.0022), vUv.y);
        float nasaClouds = uHasCloudsTex > 0.5 ? texture2D(tClouds, cloudUv).r : 0.0;
        float cloudShadowSample = uHasCloudsTex > 0.5 ? texture2D(tClouds, cloudUv - vec2(0.0022, 0.0012)).r : 0.0;

        float drift = uTime * 0.008;
        float cd = cos(drift), sd = sin(drift);
        vec3 lp = normalize(vLocalPos);
        vec3 p = vec3(lp.x * cd - lp.z * sd, lp.y, lp.x * sd + lp.z * cd);
        float warp = pNoise3(p * 12.4);
        float vapor = pNoise3(p * 31.0 + warp * 2.7) + 0.45 * pNoise3(p * 74.0 + warp);
        float wisp = smoothstep(0.98, 1.32, vapor) * 0.35;
        float clouds = clamp(max(nasaClouds * 0.92, wisp), 0.0, 1.0);

        // Subtle cloud shadow on sunlit continents/oceans
        float terrainShadow = 1.0 - smoothstep(0.18, 0.85, cloudShadowSample) * 0.36;

        float isOcean = smoothstep(0.015, 0.075, ground.b - max(ground.r, ground.g));
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 46.0) * isOcean * max(0.0, mu) * (1.0 - clouds * 0.78) * 0.38;

        vec3 c = ground * vec3(0.84, 0.89, 1.02) * (0.032 + day * 1.18 * terrainShadow) + vec3(0.82, 0.92, 1.0) * spec;
        c = mix(c, vec3(0.68, 0.77, 0.88) * (0.04 + day * 1.12) + dusk * vec3(0.18, 0.065, 0.025), clouds * 0.78);

        c += vec3(1.55, 0.78, 0.24) * settlements * (1.0 - day) * 1.18 * (1.0 - clouds * 0.48);
        c += edge * vec3(0.045, 0.20, 0.58) * (0.18 + day * 0.92) + edge * dusk * vec3(0.09, 0.03, 0.018);

        gl_FragColor = vec4(c, 1.0);
        #include <logdepthbuf_fragment>
      }
    `,
  });
}

export function createPhotographicRockyMaterial(albedoTex, { isMars = false, bumpStrength = 2.6 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      tAlbedo: { value: albedoTex },
      uSunPos: { value: new THREE.Vector3(0, 0, 0) },
      uTime: { value: 0 },
      uIsMars: { value: isMars ? 1.0 : 0.0 },
      uBump: { value: bumpStrength },
    },
    vertexShader: COMMON_VERTEX_WITH_BASIS,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D tAlbedo;
      uniform vec3 uSunPos;
      uniform float uTime;
      uniform float uIsMars;
      uniform float uBump;
      varying vec2 vUv;
      varying vec3 vLocalPos;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      varying vec3 vModelX;
      varying vec3 vModelY;
      varying vec3 vModelZ;
      ${GLSL_NOISE_3D}

      float lum(vec3 c) {
        return dot(c, vec3(0.299, 0.587, 0.114));
      }

      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 L = normalize(uSunPos - vWorldPos);
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 p = normalize(vLocalPos);

        // 4-tap unsharp-mask sharpen the 4K NASA imagery + analytical luminance-gradient crater relief bump
        vec2 px = vec2(1.0 / 4096.0, 1.0 / 2048.0);
        vec3 baseCol = texture2D(tAlbedo, vUv).rgb;
        vec3 cR = texture2D(tAlbedo, vUv + vec2(px.x, 0.0)).rgb;
        vec3 cL = texture2D(tAlbedo, vUv - vec2(px.x, 0.0)).rgb;
        vec3 cU = texture2D(tAlbedo, vUv + vec2(0.0, px.y)).rgb;
        vec3 cD = texture2D(tAlbedo, vUv - vec2(0.0, px.y)).rgb;
        vec3 nearby = (cR + cL + cU + cD) * 0.25;
        vec3 sharp = max(vec3(0.0), baseCol + (baseCol - nearby) * 0.72);

        // Tangent-space normal perturbation in world space using vertex-supplied model basis (zero fragment modelMatrix!)
        float dU = (lum(cR) - lum(cL)) * uBump;
        float dV = (lum(cU) - lum(cD)) * uBump;
        vec3 upRef = abs(p.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 T = normalize(cross(upRef, p));
        vec3 B = normalize(cross(p, T));
        mat3 mRot = mat3(normalize(vModelX), normalize(vModelY), normalize(vModelZ));
        vec3 worldT = normalize(mRot * T);
        vec3 worldB = normalize(mRot * B);
        vec3 Nb = normalize(N - worldT * dU - worldB * dV);

        float muSmooth = dot(N, L);
        float muBump = max(0.0, dot(Nb, L));
        float terminatorMask = smoothstep(-0.12, 0.16, muSmooth);
        float diff = mix(smoothstep(-0.14, 0.55, muSmooth), muBump, 0.52) * terminatorMask;

        // Subtle close-range geological micro-grain so flybys stay crisp even below texel scale
        float microDetail = 0.94 + 0.12 * pNoise3(p * 120.0);
        vec3 c = sharp * microDetail * (0.025 + 1.24 * diff);

        if (uIsMars > 0.5) {
          // Thin drifting Martian water-ice clouds + salmon Rayleigh atmospheric rim & twilight glow
          float clouds = smoothstep(0.62, 0.88, pNoise3(p * 11.0 + vec3(uTime * 0.004, 0.0, 0.0)));
          c = mix(c, vec3(0.92, 0.76, 0.64) * (0.04 + 1.1 * diff), clouds * 0.16);
          float dusk = exp(-abs(muSmooth + 0.015) * 8.0);
          float edge = pow(1.0 - max(0.0, dot(N, V)), 4.6);
          c += edge * vec3(0.45, 0.19, 0.10) * (0.12 + 0.78 * smoothstep(-0.2, 0.5, muSmooth))
             + edge * dusk * vec3(0.14, 0.05, 0.02);
        }

        gl_FragColor = vec4(c, 1.0);
        #include <logdepthbuf_fragment>
      }
    `,
  });
}

export function createPhotographicGasMaterial(
  albedoTex,
  { rimColor = '#ffe0ad', hasCloudsDrift = true, isSaturn = false } = {},
  ringTex = null
) {
  return new THREE.ShaderMaterial({
    uniforms: {
      tAlbedo: { value: albedoTex },
      tRing: { value: ringTex },
      uSunPos: { value: new THREE.Vector3(0, 0, 0) },
      uTime: { value: 0 },
      uRimColor: { value: new THREE.Color(rimColor) },
      uDrift: { value: hasCloudsDrift ? 1.0 : 0.0 },
      uIsSaturn: { value: isSaturn ? 1.0 : 0.0 },
      uPlanetPos: { value: new THREE.Vector3() },
      uRingNormal: { value: new THREE.Vector3(0, 1, 0) },
      uRingInner: { value: 295.0 },
      uRingOuter: { value: 575.0 },
    },
    vertexShader: COMMON_VERTEX_WITH_BASIS,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D tAlbedo;
      uniform sampler2D tRing;
      uniform vec3 uSunPos;
      uniform float uTime;
      uniform vec3 uRimColor;
      uniform float uDrift;
      uniform float uIsSaturn;
      uniform vec3 uPlanetPos;
      uniform vec3 uRingNormal;
      uniform float uRingInner;
      uniform float uRingOuter;
      varying vec2 vUv;
      varying vec3 vLocalPos;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      ${GLSL_NOISE_3D}

      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 L = normalize(uSunPos - vWorldPos);
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 p = normalize(vLocalPos);

        // Subtle zonal jet-stream differential micro-shear on real 4K NASA gas-giant map
        float shear = uDrift * sin(p.y * 12.0) * 0.004 * sin(uTime * 0.12);
        vec2 uvSample = vec2(fract(vUv.x + shear), vUv.y);
        vec2 px = vec2(1.0 / 4096.0, 1.0 / 2048.0);
        vec3 tex = texture2D(tAlbedo, uvSample).rgb;
        vec3 nb = (
          texture2D(tAlbedo, uvSample + vec2(px.x, 0.0)).rgb +
          texture2D(tAlbedo, uvSample - vec2(px.x, 0.0)).rgb +
          texture2D(tAlbedo, uvSample + vec2(0.0, px.y)).rgb +
          texture2D(tAlbedo, uvSample - vec2(0.0, px.y)).rgb
        ) * 0.25;
        vec3 albedo = max(vec3(0.0), tex + (tex - nb) * 0.58);

        // Close-up micro-turbulence wispy detail (single-octave GPU-fast) so 100m flybys stay crisp
        float microCloud = 0.97 + 0.06 * pNoise3(vec3(p.x * 22.0, p.y * 46.0, p.z * 22.0));
        albedo *= microCloud;

        // Real 4K Cassini-grade Ring Shadow projected onto Saturn's cloud tops!
        float ringShadow = 1.0;
        if (uIsSaturn > 0.5) {
          vec3 rN = normalize(uRingNormal);
          float denom = dot(L, rN);
          if (abs(denom) > 0.001) {
            float tHit = dot(uPlanetPos - vWorldPos, rN) / denom;
            if (tHit > 0.0) {
              vec3 hitPt = vWorldPos + L * tHit;
              float distR = length(hitPt - uPlanetPos);
              if (distR > uRingInner && distR < uRingOuter) {
                float ru = clamp((distR - uRingInner) / (uRingOuter - uRingInner), 0.0, 1.0);
                float ringTau = texture2D(tRing, vec2(ru, 0.5)).a;
                ringShadow = 1.0 - ringTau * 0.85;
              }
            }
          }
        }

        float mu = dot(N, L);
        float day = smoothstep(-0.16, 0.72, mu) * ringShadow;
        float dusk = exp(-abs(mu + 0.02) * 7.0);
        float limb = pow(1.0 - max(0.0, dot(N, V)), 4.4);

        vec3 c = albedo * (0.027 + 1.18 * day) + dusk * uRimColor * 0.05 * ringShadow;
        c += uRimColor * limb * (0.12 + 0.52 * smoothstep(-0.2, 0.5, mu) * ringShadow);

        gl_FragColor = vec4(c, 1.0);
        #include <logdepthbuf_fragment>
      }
    `,
  });
}

// Keep high-detail procedural bump shader for outer solar-system moons (Io, Europa, Ganymede, Triton)
export function createRockyPlanetMaterial(presetId) {
  const modeMap = { mercury: 0, moon: 1, mars: 2, io: 3, europa: 4, ganymede: 5, triton: 5 };
  const mode = modeMap[presetId] ?? 3;

  return new THREE.ShaderMaterial({
    uniforms: {
      uSunPos: { value: new THREE.Vector3(0, 0, 0) },
      uTime: { value: 0 },
      uMode: { value: mode },
    },
    vertexShader: COMMON_VERTEX_WITH_BASIS,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uSunPos;
      uniform float uTime;
      uniform int uMode;
      varying vec2 vUv;
      varying vec3 vLocalPos;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      varying vec3 vModelX;
      varying vec3 vModelY;
      varying vec3 vModelZ;
      ${GLSL_NOISE_3D}

      float rockyHeight(vec3 p) {
        if (uMode == 4) {
          float base = pFbm3(p * 6.0) * 0.25;
          float c1 = abs(sin((p.x * 9.0 + p.y * 5.0 + pFbm3(p * 4.5) * 2.8) * 3.14159));
          float c2 = abs(cos((p.z * 8.0 - p.y * 6.0 + pFbm3(p * 5.2 + 2.0) * 2.6) * 3.14159));
          float ridge = 1.0 - smoothstep(0.0, 0.11, min(c1, c2));
          return base - ridge * 0.42;
        }
        float macro = pFbm3(p * 4.6);
        float micro = pNoise3(p * 22.0) * 0.1;
        float cr = craterLayer(p, 5.5) * 0.85 + craterLayer(p + vec3(2.3), 13.0) * 0.55;
        return macro * 0.62 + micro + cr;
      }

      void main() {
        vec3 p = normalize(vLocalPos);
        vec3 N = normalize(vWorldNormal);
        vec3 L = normalize(uSunPos - vWorldPos);
        vec3 V = normalize(cameraPosition - vWorldPos);

        float eps = clamp(max(0.009, length(fwidth(p))), 0.009, 0.035);
        float h0 = rockyHeight(p);
        vec3 upRef = abs(p.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 T = normalize(cross(upRef, p));
        vec3 B = normalize(cross(p, T));
        float hT = rockyHeight(normalize(p + T * eps));
        float hB = rockyHeight(normalize(p + B * eps));
        mat3 mRot = mat3(normalize(vModelX), normalize(vModelY), normalize(vModelZ));
        vec3 worldT = normalize(mRot * T);
        vec3 worldB = normalize(mRot * B);
        float bumpScale = (uMode == 4) ? 0.10 : 0.12;
        vec2 slope = (vec2(hT, hB) - h0) / eps * bumpScale;
        slope *= min(1.0, 0.26 / max(length(slope), 0.001));
        vec3 Nb = normalize(N - worldT * slope.x - worldB * slope.y);

        vec3 albedo = vec3(0.5);
        vec3 emission = vec3(0.0);
        float specMask = 0.0;

        if (uMode == 3) {
          float s = pFbm3(p * 6.5);
          float caldera = smoothstep(0.76, 0.88, pNoise3(p * 14.0 + vec3(3.1)));
          albedo = mix(vec3(0.72, 0.45, 0.08), vec3(0.92, 0.84, 0.28), s);
          albedo = mix(albedo, vec3(0.12, 0.08, 0.05), caldera);
          emission = vec3(1.6, 0.35, 0.02) * smoothstep(0.82, 0.94, pNoise3(p * 14.0 + vec3(3.1)));
        } else if (uMode == 4) {
          float cracks = clamp(-h0 * 2.2, 0.0, 1.0);
          albedo = mix(vec3(0.80, 0.82, 0.86), vec3(0.42, 0.25, 0.18), cracks);
          specMask = (1.0 - cracks) * 0.42;
        } else {
          float h = clamp(h0 + 0.25, 0.0, 1.0);
          albedo = mix(vec3(0.26, 0.28, 0.32), vec3(0.64, 0.68, 0.74), h);
          specMask = 0.18;
        }

        float muSmooth = dot(N, L);
        float muBump = max(0.0, dot(Nb, L));
        float shadowTerm = smoothstep(-0.08, 0.12, muSmooth);
        float diff = muBump * shadowTerm;

        vec3 H = normalize(L + V);
        float spec = pow(max(dot(Nb, H), 0.0), 36.0) * specMask * diff;

        vec3 col = albedo * (0.020 + 1.24 * diff) + vec3(0.85, 0.92, 1.0) * spec;
        col += emission * (1.0 - smoothstep(-0.1, 0.25, muSmooth));

        gl_FragColor = vec4(col, 1.0);
        #include <logdepthbuf_fragment>
      }
    `,
  });
}

export function createPlanetRingMaterial(ringTex, planetRadius, innerRadius, outerRadius, isUranus = false) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      tRing: { value: ringTex },
      uPlanetPos: { value: new THREE.Vector3() },
      uPlanetRadius: { value: planetRadius },
      uSunPos: { value: new THREE.Vector3(0, 0, 0) },
      uInner: { value: innerRadius },
      uOuter: { value: outerRadius },
      uIsUranus: { value: isUranus ? 1.0 : 0.0 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vLocalPos;
      varying vec3 vWorldPos;
      void main() {
        vLocalPos = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D tRing;
      uniform vec3 uPlanetPos;
      uniform float uPlanetRadius;
      uniform vec3 uSunPos;
      uniform float uInner;
      uniform float uOuter;
      uniform float uIsUranus;
      varying vec3 vLocalPos;
      varying vec3 vWorldPos;

      void main() {
        float r = length(vLocalPos.xy);
        float u = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
        vec4 tex = texture2D(tRing, vec2(u, 0.5));
        if (tex.a < 0.015) discard;

        float fineRinglets = 0.88
          + 0.07 * sin(u * 340.0)
          + 0.04 * sin(u * 960.0 + 1.1);

        // Analytical sphere-shadow projection from parent planet onto the ring plane
        vec3 toSun = normalize(uSunPos - uPlanetPos);
        vec3 rel = vWorldPos - uPlanetPos;
        float proj = dot(rel, toSun);
        float shadow = 1.0;
        if (proj < 0.0) {
          float perpDist = length(rel - toSun * proj);
          shadow = smoothstep(uPlanetRadius * 0.90, uPlanetRadius * 1.03, perpDist);
        }

        // Backlit ice-crystal forward Mie scatter toward the Sun
        vec3 V = normalize(cameraPosition - vWorldPos);
        float fwd = pow(clamp(dot(-V, toSun), 0.0, 1.0), 4.0) * 0.42;

        vec3 tint = uIsUranus > 0.5 ? vec3(0.55, 0.78, 0.88) : vec3(1.0);
        vec3 col = tex.rgb * tint * fineRinglets * (0.06 + 1.18 * shadow + fwd * shadow);
        float alpha = tex.a * (uIsUranus > 0.5 ? 0.48 : 0.95);
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.96));
        #include <logdepthbuf_fragment>
      }
    `,
  });
}
