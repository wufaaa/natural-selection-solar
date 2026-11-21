import * as THREE from 'three';

function hash2(x, y, seed = 1337) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise2(x, y, seed = 1337) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm2(x, y, octaves = 5, seed = 1337) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * freq, y * freq, seed + i * 71);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

function periodicFbm(u, v, freqX, freqY, octaves = 5, seed = 1337) {
  // Seamless horizontal wrap for equirectangular maps via 2D torus-like blend
  const angle = u * Math.PI * 2;
  const cx = Math.cos(angle) * (freqX * 0.32) + freqX * 0.5;
  const cy = Math.sin(angle) * (freqX * 0.32) + freqX * 0.5;
  const vy = v * freqY;
  return 0.55 * fbm2(cx + vy * 0.15, cy + vy, octaves, seed) +
         0.45 * fbm2(vy * 0.9 + cy * 0.5, cx * 0.7 + vy * 0.3, octaves, seed + 503);
}

export function createArmorDetailTextures() {
  const size = 512;
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const fineGrain = fbm2(u * 48, v * 48, 3, 91) * 0.14;
      const brushed = valueNoise2(u * 120, v * 10, 404) * 0.12;

      // Rectangular hull panel seams
      const px = (u * 4) % 1;
      const py = (v * 4) % 1;
      const seamX = Math.min(px, 1 - px);
      const seamY = Math.min(py, 1 - py);
      const seam = Math.min(seamX, seamY);
      let panel = 0.72;
      if (seam < 0.018) {
        panel = 0.18;
      } else if (seam < 0.036) {
        panel = 0.88;
      }

      // Micro corner rivets
      const rdx = Math.abs(px - 0.07);
      const rdy = Math.abs(py - 0.07);
      const rdx2 = Math.abs(px - 0.93);
      const rdy2 = Math.abs(py - 0.93);
      let rivet = 0;
      if (Math.min(rdx * rdx + rdy * rdy, rdx2 * rdx2 + rdy2 * rdy2) < 0.00025) {
        rivet = 0.25;
      }

      height[y * size + x] = THREE.MathUtils.clamp(panel + fineGrain + brushed + rivet, 0, 1);
    }
  }

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = size;
  normalCanvas.height = size;
  const nCtx = normalCanvas.getContext('2d');
  const nImg = nCtx.createImageData(size, size);

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d');
  const rImg = rCtx.createImageData(size, size);

  const strength = 2.4;
  for (let y = 0; y < size; y++) {
    const ym = (y - 1 + size) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;

      const dx = (height[y * size + xp] - height[y * size + xm]) * strength;
      const dy = (height[yp * size + x] - height[ym * size + x]) * strength;
      const invLen = 1.0 / Math.sqrt(dx * dx + dy * dy + 1.0);
      const nx = -dx * invLen;
      const ny = -dy * invLen;
      const nz = invLen;

      const idx = (y * size + x) * 4;
      nImg.data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      nImg.data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      nImg.data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      nImg.data[idx + 3] = 255;

      const h = height[y * size + x];
      const roughVal = Math.round(THREE.MathUtils.clamp(0.75 + (0.72 - h) * 0.45, 0.35, 1.0) * 255);
      rImg.data[idx] = roughVal;
      rImg.data[idx + 1] = roughVal;
      rImg.data[idx + 2] = roughVal;
      rImg.data[idx + 3] = 255;
    }
  }
  nCtx.putImageData(nImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.anisotropy = 4;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.anisotropy = 4;

  return { normalMap, roughnessMap };
}

function generateCraterList(count, seed) {
  const craters = [];
  for (let i = 0; i < count; i++) {
    craters.push({
      u: hash2(i, 1, seed),
      v: 0.08 + hash2(i, 2, seed) * 0.84,
      r: 0.012 + Math.pow(hash2(i, 3, seed), 2.4) * 0.09,
      depth: 0.4 + hash2(i, 4, seed) * 0.6,
    });
  }
  return craters;
}

export function createPlanetSurfaceTexture(type, width = 512, height = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  const data = img.data;

  // Pre-bake craters via sparse local bounding boxes (300x faster than O(W*H*C))
  const craterBuf =
    type === 'mercury' || type === 'moon' || type === 'mars'
      ? new Float32Array(width * height)
      : null;

  if (craterBuf) {
    const craters = generateCraterList(
      type === 'mars' ? 40 : 90,
      type === 'mercury' ? 77 : type === 'moon' ? 199 : 311
    );
    for (let c = 0; c < craters.length; c++) {
      const cr = craters[c];
      const latScale = Math.max(0.25, Math.cos((cr.v - 0.5) * Math.PI));
      const cx = Math.round(cr.u * width);
      const cy = Math.round(cr.v * height);
      const maxR = cr.r * 1.45;
      const rx = Math.min(Math.floor(width * 0.4), Math.ceil((maxR / latScale) * width));
      const ry = Math.ceil(maxR * height);

      for (let dy = -ry; dy <= ry; dy++) {
        const py = cy + dy;
        if (py < 0 || py >= height) continue;
        const dv = dy / height;
        for (let dx = -rx; dx <= rx; dx++) {
          const px = ((cx + dx) % width + width) % width;
          const du = (dx / width) * latScale;
          const dist = Math.sqrt(du * du + dv * dv);
          if (dist < maxR) {
            const nr = dist / cr.r;
            let delta = 0;
            if (nr < 0.78) {
              delta = -(1 - (nr / 0.78) ** 2) * 0.28 * cr.depth;
            } else if (nr < 1.12) {
              delta = (1 - Math.abs(nr - 0.94) / 0.18) * 0.22 * cr.depth;
            } else {
              delta = (1 - (nr - 1.12) / 0.33) * 0.08 * cr.depth;
            }
            craterBuf[py * width + px] += delta;
          }
        }
      }
    }
  }

  for (let y = 0; y < height; y++) {
    const v = y / height;
    const lat = Math.abs(v - 0.5) * 2.0; // 0 equator -> 1 poles

    for (let x = 0; x < width; x++) {
      const u = x / width;
      const idx = (y * width + x) * 4;
      let r = 128;
      let g = 128;
      let b = 128;
      let a = 255;

      if (type === 'mercury' || type === 'moon') {
        const maria = periodicFbm(u, v, 4.5, 4.5, 4, type === 'mercury' ? 21 : 88);
        const detail = periodicFbm(u, v, 16, 11, 3, type === 'mercury' ? 23 : 89);
        const h = THREE.MathUtils.clamp(
          maria * 0.65 + detail * 0.35 + craterBuf[y * width + x],
          0.05,
          0.98
        );
        if (type === 'mercury') {
          r = 108 + h * 112;
          g = 100 + h * 102;
          b = 94 + h * 92;
        } else {
          const base = 75 + h * 145;
          r = base;
          g = base * 1.01;
          b = base * 1.03;
        }
      } else if (type === 'venus') {
        const swirl = periodicFbm(u, v, 6, 8, 4, 501);
        const band = Math.sin((v + swirl * 0.16) * Math.PI * 10.0) * 0.5 + 0.5;
        const mixVal = THREE.MathUtils.clamp(swirl * 0.68 + band * 0.32, 0, 1);
        r = 188 + mixVal * 58;
        g = 135 + mixVal * 68;
        b = 64 + mixVal * 54;
      } else if (type === 'mars') {
        const continent = periodicFbm(u, v, 5, 5, 4, 610);
        const canyon = Math.abs(v - 0.52 + Math.sin(u * Math.PI * 4) * 0.03);
        let h = continent + craterBuf[y * width + x] * 0.35;
        if (canyon < 0.022 && u > 0.28 && u < 0.58) {
          h *= 0.45;
        }
        const iceNoise = valueNoise2(u * 22, v * 22, 615) * 0.08;
        if (lat + iceNoise > 0.875) {
          r = 236;
          g = 232;
          b = 228;
        } else {
          const darkBasalt = h < 0.42 ? (0.42 - h) * 1.6 : 0;
          r = THREE.MathUtils.clamp(192 + h * 48 - darkBasalt * 95, 55, 240);
          g = THREE.MathUtils.clamp(92 + h * 36 - darkBasalt * 48, 35, 165);
          b = THREE.MathUtils.clamp(58 + h * 20 - darkBasalt * 28, 25, 110);
        }
      } else if (type === 'earth_clouds') {
        const warp = periodicFbm(u, v, 5, 5, 3, 701);
        const w = periodicFbm(u + warp * 0.1, v + warp * 0.07, 11, 9, 4, 709);
        const density = THREE.MathUtils.clamp((w - 0.56) * 2.9, 0, 1);
        r = 248;
        g = 251;
        b = 255;
        a = Math.round(density * 185);
      } else if (type === 'io') {
        const s = periodicFbm(u, v, 7, 7, 3, 811);
        r = 205 + s * 45;
        g = 155 + s * 80;
        b = 40 + (1 - s) * 45;
      } else if (type === 'europa') {
        const base = periodicFbm(u, v, 5, 5, 3, 822);
        const cracks = Math.abs(Math.sin((u * 14 + base * 2.5) * Math.PI) * Math.cos((v * 11 - base * 2) * Math.PI));
        const line = cracks < 0.08 ? 1 : 0;
        r = line ? 142 : 206 + base * 38;
        g = line ? 115 : 212 + base * 34;
        b = line ? 105 : 222 + base * 28;
      } else {
        const n = periodicFbm(u, v, 8, 8, 4, 835);
        r = 115 + n * 95;
        g = 122 + n * 96;
        b = 135 + n * 98;
      }

      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createSaturnRingTexture(isUranus = false) {
  const width = 1024;
  const height = 8;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);

  for (let x = 0; x < width; x++) {
    const t = x / (width - 1); // 0 = inner, 1 = outer
    let alpha = 0;
    let r = 225;
    let g = 212;
    let b = 185;

    if (isUranus) {
      const fine = Math.sin(t * 95) * 0.5 + 0.5;
      const ringBands =
        (t > 0.12 && t < 0.22) ||
        (t > 0.36 && t < 0.44) ||
        (t > 0.62 && t < 0.72) ||
        (t > 0.85 && t < 0.94);
      alpha = ringBands ? (0.35 + fine * 0.35) : 0.04;
      r = 155;
      g = 215;
      b = 230;
    } else {
      const microBand =
        0.78 +
        0.12 * Math.sin(t * 160) +
        0.07 * Math.sin(t * 390 + 1.2) +
        0.05 * hash2(x, 7, 991);

      if (t < 0.18) {
        // C Ring (faint dusky inner ring)
        alpha = THREE.MathUtils.smoothstep(t, 0.02, 0.16) * 0.34;
        r = 165;
        g = 152;
        b = 135;
      } else if (t < 0.58) {
        // B Ring (bright dense icy main ring)
        alpha = (0.78 + 0.18 * Math.sin((t - 0.18) * 32)) * microBand;
        r = 236;
        g = 219;
        b = 186;
      } else if (t < 0.65) {
        // Cassini Division (crisp dark gap)
        alpha = 0.04;
        r = 95;
        g = 88;
        b = 80;
      } else if (t < 0.91) {
        // A Ring + Encke Gap around 0.83
        const encke = Math.abs(t - 0.835) < 0.012 ? 0.08 : 1.0;
        alpha = 0.62 * microBand * encke;
        r = 218;
        g = 205;
        b = 178;
      } else if (t > 0.945 && t < 0.975) {
        // F Ring
        alpha = 0.45;
        r = 230;
        g = 222;
        b = 205;
      } else {
        alpha = 0;
      }
      alpha = THREE.MathUtils.clamp(alpha, 0, 0.96);
    }

    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4;
      img.data[idx] = r;
      img.data[idx + 1] = g;
      img.data[idx + 2] = b;
      img.data[idx + 3] = Math.round(alpha * 255);
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createGlowSpriteTexture(innerColor = 'rgba(255,255,255,1)', midColor = 'rgba(130,210,255,0.45)', size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size * 0.5;
  const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grad.addColorStop(0.0, innerColor);
  grad.addColorStop(0.24, midColor);
  grad.addColorStop(0.65, 'rgba(60,120,255,0.08)');
  grad.addColorStop(1.0, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createSpaceEnvMap(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x03060d);

  // Primary solar key light sphere + subtle chromatic corona
  const sunSphere = new THREE.Mesh(
    new THREE.SphereGeometry(4.2, 20, 20),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(6.4, 5.4, 3.8) })
  );
  sunSphere.position.set(-18, 9, -14);
  envScene.add(sunSphere);

  // Rich Milky Way azure/indigo dust ribbon for liquid-mirror Droplet & titanium hull reflections
  const galacticBand = new THREE.Mesh(
    new THREE.TorusGeometry(26, 4.4, 16, 64),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.36, 0.56, 0.92), transparent: true, opacity: 0.65 })
  );
  galacticBand.rotation.set(0.56, 0.42, 0.28);
  envScene.add(galacticBand);

  const warmNebulaArc = new THREE.Mesh(
    new THREE.TorusGeometry(24, 2.2, 12, 48),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.68, 0.44, 0.28), transparent: true, opacity: 0.42 })
  );
  warmNebulaArc.rotation.set(-0.35, 1.15, 0.52);
  envScene.add(warmNebulaArc);

  // Atmospheric planet-shine fill dome below
  const planetBounce = new THREE.Mesh(
    new THREE.SphereGeometry(8.5, 16, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.22, 0.42, 0.78) })
  );
  planetBounce.position.set(14, -18, 12);
  envScene.add(planetBounce);

  // Scattered high-contrast stellar highlights so Droplet reflects real star pinpoints
  const starDots = [];
  const starGeo = new THREE.SphereGeometry(0.22, 6, 6);
  const coolMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 3.1, 4.2) });
  const warmMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.6, 2.7, 1.8) });
  for (let i = 0; i < 48; i++) {
    const theta = (i * 2.39996) % (Math.PI * 2);
    const y = ((i % 13) - 6) * 0.14;
    const r = Math.sqrt(Math.max(0.05, 1 - y * y));
    const dot = new THREE.Mesh(starGeo, i % 3 === 0 ? warmMat : coolMat);
    dot.position.set(Math.cos(theta) * r * 28, y * 28, Math.sin(theta) * r * 28);
    envScene.add(dot);
    starDots.push(dot);
  }

  const rt = pmrem.fromScene(envScene, 0.025);
  sunSphere.geometry.dispose();
  sunSphere.material.dispose();
  galacticBand.geometry.dispose();
  galacticBand.material.dispose();
  warmNebulaArc.geometry.dispose();
  warmNebulaArc.material.dispose();
  planetBounce.geometry.dispose();
  planetBounce.material.dispose();
  starGeo.dispose();
  coolMat.dispose();
  warmMat.dispose();
  pmrem.dispose();
  return rt.texture;
}
