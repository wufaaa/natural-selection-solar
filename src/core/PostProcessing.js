import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { QUALITY_PRESETS } from './Constants.js';

const CinematicShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uChromatic: { value: 0.0008 },
    uDamagePulse: { value: 0.0 },
    uVignette: { value: 0.34 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uChromatic;
    uniform float uDamagePulse;
    uniform float uVignette;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 dir = vUv - 0.5;
      float dist = length(dir);
      vec2 offset = dir * uChromatic * (0.6 + dist * 2.2);

      float r = texture2D(tDiffuse, vUv + offset).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - offset).b;
      vec3 col = vec3(r, g, b);

      // Subtle vignette + edge red flash on hull impact
      float vig = smoothstep(0.32, 0.92, dist);
      col *= 1.0 - vig * uVignette;
      col += vec3(0.75, 0.06, 0.08) * (vig * uDamagePulse * 0.55);

      // Very light tactical sensor grain
      float grain = (rand(vUv + fract(uTime * 0.37)) - 0.5) * 0.015;
      col += grain;

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

export class PostProcessing {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.qualityKey = 'HIGH';

    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    const preset = QUALITY_PRESETS[this.qualityKey];
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      preset.bloomStrength,
      preset.bloomRadius,
      preset.bloomThreshold
    );
    this.composer.addPass(this.bloomPass);

    this.cinematicPass = new ShaderPass(CinematicShader);
    this.composer.addPass(this.cinematicPass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  setQuality(key) {
    if (!QUALITY_PRESETS[key]) return;
    this.qualityKey = key;
    const p = QUALITY_PRESETS[key];
    this.bloomPass.strength = p.bloomStrength;
    this.bloomPass.radius = p.bloomRadius;
    this.bloomPass.threshold = p.bloomThreshold;
    this.resize(window.innerWidth, window.innerHeight);
  }

  resize(width, height) {
    const p = QUALITY_PRESETS[this.qualityKey];
    const dpr = Math.min(window.devicePixelRatio || 1, p.maxPixelRatio);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(width, height);
  }

  render(dt, { speedRatio = 0, isWarping = false, isChargingWarp = false, damagePulse = 0, hullRatio = 1.0, reduceMotion = true } = {}) {
    const u = this.cinematicPass.uniforms;
    u.uTime.value += dt;
    const rawChrom = isWarping
      ? (reduceMotion ? 0.0018 : 0.0046)
      : (isChargingWarp ? 0.0014 : 0.00035) + speedRatio * (reduceMotion ? 0.00025 : 0.0011) + damagePulse * (reduceMotion ? 0.0008 : 0.0024);
    const targetChrom = reduceMotion ? Math.min(isWarping ? 0.0018 : 0.0007, rawChrom) : rawChrom;
    u.uChromatic.value = THREE.MathUtils.lerp(u.uChromatic.value, targetChrom, Math.min(1, dt * 8));
    u.uVignette.value = THREE.MathUtils.lerp(u.uVignette.value, reduceMotion ? 0.26 : 0.34, Math.min(1, dt * 6));
    const lowHullPulse = hullRatio < 0.35 ? (0.12 + (reduceMotion ? 0.05 : 0.11) * Math.sin(u.uTime.value * (reduceMotion ? 4.2 : 7.5))) * (1 - hullRatio / 0.35) : 0;
    u.uDamagePulse.value = Math.max(damagePulse * (reduceMotion ? 0.65 : 1.0), lowHullPulse);
    this.composer.render();
  }
}
