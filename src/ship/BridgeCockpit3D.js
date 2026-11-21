import * as THREE from 'three';
import { SHIP_CONFIG, WEAPON_CONFIG } from '../core/Constants.js';

function createHoloCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 4;
  return { canvas, ctx, tex };
}

function drawHoloGlassBackdrop(ctx, accentRgb, cornersAlpha = 0.55) {
  ctx.clearRect(0, 0, 512, 256);
  ctx.save();
  ctx.scale(2, 2);

  // Feathered optical projection tint: transparent glass edges, subtle readability tint only near glyph core
  const rad = ctx.createRadialGradient(128, 66, 12, 128, 66, 134);
  rad.addColorStop(0.0, 'rgba(6, 16, 28, 0.34)');
  rad.addColorStop(0.68, 'rgba(5, 14, 24, 0.16)');
  rad.addColorStop(1.0, 'rgba(4, 10, 18, 0.0)');
  ctx.fillStyle = rad;
  ctx.fillRect(0, 0, 256, 128);

  // Delicate upper hairline baseline
  ctx.strokeStyle = `rgba(${accentRgb}, 0.24)`;
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(14, 19);
  ctx.lineTo(242, 19);
  ctx.stroke();

  // Chamfered optical L-corner registration ticks (zero boxy closed rectangles)
  ctx.strokeStyle = `rgba(${accentRgb}, ${cornersAlpha})`;
  ctx.lineWidth = 1.25;
  const leg = 10;
  for (const [x, y, sx, sy] of [
    [6, 6, 1, 1],
    [250, 6, -1, 1],
    [6, 122, 1, -1],
    [250, 122, -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x + sx * leg, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * leg);
    ctx.stroke();
  }
}

export class BridgeCockpit3D {
  constructor(parentGroup, armorTextures) {
    this.root = new THREE.Group();
    this.root.visible = false;
    parentGroup.add(this.root);

    this._mfdTimer = 0;
    this._muzzleTimer = 0;
    this._tmpLocal = new THREE.Vector3();

    // Matte dark anodized titanium struts & glareshield (zero bright plastic neon sticks)
    const carbonMat = new THREE.MeshStandardMaterial({
      color: '#111822',
      metalness: 0.9,
      roughness: 0.32,
      normalMap: armorTextures?.normalMap || null,
      normalScale: new THREE.Vector2(0.26, 0.26),
      roughnessMap: armorTextures?.roughnessMap || null,
      envMapIntensity: 1.25,
    });

    const brushedTrimMat = new THREE.MeshStandardMaterial({
      color: '#253142',
      metalness: 0.94,
      roughness: 0.22,
      envMapIntensity: 1.35,
    });

    this.statusLedMat = new THREE.MeshStandardMaterial({
      color: '#2b5570',
      emissive: new THREE.Color('#66c8ea'),
      emissiveIntensity: 0.85,
      metalness: 0.6,
      roughness: 0.35,
    });

    // 1. Wide-Span Swept Canopy Struts tucked cleanly to periphery (>85% sky & planet clarity)
    const pillarGeo = new THREE.CylinderGeometry(0.014, 0.024, 1.12, 8);
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(pillarGeo, carbonMat);
      pillar.position.set(side * 0.72, 1.16, -1.04);
      pillar.rotation.z = side * 0.42;
      pillar.rotation.x = 0.54;
      this.root.add(pillar);

      // Subtle micro status pip at strut foot (replaces old blinding neon tubes)
      const pip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.022, 0.012), this.statusLedMat);
      pip.position.set(side * 0.64, 0.82, -0.96);
      this.root.add(pip);

      const sill = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.032, 0.88), brushedTrimMat);
      sill.position.set(side * 0.74, 0.77, -0.78);
      sill.rotation.y = side * 0.16;
      this.root.add(sill);
    }

    // High slender canopy crown well above upper viewport frame
    const topArch = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.024, 0.06), carbonMat);
    topArch.position.set(0, 1.56, -1.24);
    this.root.add(topArch);

    // 2. Low-Profile Chamfered Titanium Glareshield Cowling (sits strictly along bottom ~14% margin)
    const dashBase = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.072, 0.46), carbonMat);
    dashBase.position.set(0, 0.645, -1.16);
    dashBase.rotation.x = 0.32;
    this.root.add(dashBase);

    const dashLip = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.18, 12), brushedTrimMat);
    dashLip.rotation.z = Math.PI * 0.5;
    dashLip.position.set(0, 0.705, -1.27);
    this.root.add(dashLip);

    // Three recessed micro amber console pips along centerline cowling
    const microLampMat = new THREE.MeshStandardMaterial({
      color: '#4a3518',
      emissive: new THREE.Color('#e09e3e'),
      emissiveIntensity: 0.75,
    });
    for (const dx of [-0.06, 0, 0.06]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.008, 0.012), microLampMat);
      lamp.position.set(dx, 0.70, -1.14);
      lamp.rotation.x = 0.32;
      this.root.add(lamp);
    }

    // 3. Three High-Res (512x256) Star Citizen Translucent Holographic Glass Projection Panes
    this.mfdLeft = createHoloCanvas();
    this.mfdCenter = createHoloCanvas();
    this.mfdRight = createHoloCanvas();

    const makeScreen = (mfd, width, height, pos, rot) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({
          map: mfd.tex,
          transparent: true,
          opacity: 0.98,
          depthTest: false,
          depthWrite: false,
        })
      );
      mesh.renderOrder = 5;
      mesh.position.copy(pos);
      mesh.rotation.set(rot.x, rot.y, rot.z);
      this.root.add(mesh);
      return mesh;
    };

    makeScreen(
      this.mfdLeft,
      0.30,
      0.15,
      new THREE.Vector3(-0.31, 0.818, -1.03),
      new THREE.Euler(-0.34, 0.25, 0)
    );
    makeScreen(
      this.mfdCenter,
      0.26,
      0.13,
      new THREE.Vector3(0.0, 0.805, -1.02),
      new THREE.Euler(-0.36, 0, 0)
    );
    makeScreen(
      this.mfdRight,
      0.30,
      0.15,
      new THREE.Vector3(0.31, 0.818, -1.03),
      new THREE.Euler(-0.34, -0.25, 0)
    );

    // 4. Subtle Canopy Glass Edge Optical Glint Shader (logdepthbuf compliant)
    this.glassMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uAlert: { value: 0 },
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
        uniform float uTime;
        uniform float uAlert;
        varying vec2 vUv;
        void main() {
          vec2 c = vUv - 0.5;
          float edge = pow(max(abs(c.x) * 2.0, abs(c.y) * 2.0), 4.2);
          float crack = smoothstep(0.95, 0.995, abs(sin(c.x * 22.0 + c.y * 17.0)) * abs(cos(c.y * 29.0 - c.x * 13.0))) * edge;
          float pulse = 0.65 + 0.35 * sin(uTime * 8.5);
          vec3 tint = mix(vec3(0.28, 0.74, 0.92), vec3(0.95, 0.25, 0.32), uAlert * pulse);
          float alpha = edge * (0.045 + uAlert * 0.14 * pulse) + crack * uAlert * 0.26;
          gl_FragColor = vec4(tint, clamp(alpha, 0.0, 0.48));
          #include <logdepthbuf_fragment>
        }
      `,
    });
    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.52, 0.86), this.glassMat);
    windshield.position.set(0, 1.18, -1.16);
    windshield.rotation.x = 0.42;
    this.root.add(windshield);

    // 5. Soft Cockpit Fill & Weapon Muzzle Reflection Lights
    this.consoleLight = new THREE.PointLight('#4eaad4', 0.65, 2.8, 2.0);
    this.consoleLight.position.set(0, 0.92, -0.88);
    this.root.add(this.consoleLight);

    this.muzzleLight = new THREE.PointLight('#7ed8ff', 0, 5.2, 1.8);
    this.muzzleLight.position.set(0, 1.12, -2.1);
    this.root.add(this.muzzleLight);
  }

  setVisible(visible) {
    const changed = this.root.visible !== visible;
    this.root.visible = visible;
    if (visible && changed) {
      this._mfdTimer = 0; // immediate fresh draw on cockpit enter
    }
  }

  triggerMuzzleLight(colorHex = '#7aefff', intensity = 3.2) {
    if (!this.root.visible) return;
    this.muzzleLight.color.set(colorHex);
    this.muzzleLight.intensity = intensity;
    this._muzzleTimer = 0.075;
  }

  _drawMiniSilhouette(ctx, cx, cy, shieldFrac, hullFrac) {
    ctx.save();
    ctx.translate(cx, cy);
    // Faint shield elliptical halo around mini hull
    const sCol = shieldFrac <= 0.02 ? 'rgba(240, 76, 104, 0.35)' : `rgba(110, 212, 250, ${0.22 + shieldFrac * 0.42})`;
    ctx.strokeStyle = sCol;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 26, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Natural Selection saucer ring + spearhead bow top-down icon
    ctx.strokeStyle = hullFrac < 0.35 ? '#f04c68' : '#d8ecff';
    ctx.fillStyle = hullFrac < 0.35 ? 'rgba(240, 76, 104, 0.16)' : 'rgba(120, 210, 245, 0.14)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(0, 4, 9.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(3, 18);
    ctx.lineTo(-3, 18);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  _redrawMfds(ship, weaponSystem, upgradeSystem, nearestName, enemyManager = null) {
    const sansFont = '"Microsoft YaHei UI", "PingFang SC", "Segoe UI", sans-serif';
    const monoFont = '"Cascadia Mono", Consolas, monospace';

    // Left Holo-Pane: Ship Integrity Silhouette + Segmented Optical Bars
    {
      const { ctx, tex } = this.mfdLeft;
      const shAlert = ship.shield <= 1;
      drawHoloGlassBackdrop(ctx, shAlert ? '240, 82, 108' : '118, 206, 246', 0.56);

      ctx.shadowColor = 'rgba(0, 6, 14, 0.85)';
      ctx.shadowBlur = 3;
      ctx.font = `600 9.5px ${sansFont}`;
      ctx.fillStyle = shAlert ? '#ff647e' : '#9ed4f2';
      ctx.fillText(shAlert ? '护盾击穿告警' : '舰体与能量系统', 14, 15);

      if (upgradeSystem && upgradeSystem.comboCount >= 2) {
        ctx.font = `bold 10px ${monoFont}`;
        ctx.fillStyle = '#f2b84d';
        ctx.textAlign = 'right';
        ctx.fillText(`×${upgradeSystem.comboCount}`, 242, 15);
        ctx.textAlign = 'left';
      }

      const maxSh = ship.effectiveMaxShield || SHIP_CONFIG.maxShield;
      const shFrac = THREE.MathUtils.clamp(ship.shield / maxSh, 0, 1);
      const hullFrac = THREE.MathUtils.clamp(ship.hull / SHIP_CONFIG.maxHull, 0, 1);
      const bstFrac = THREE.MathUtils.clamp(ship.boost / SHIP_CONFIG.maxBoost, 0, 1);

      this._drawMiniSilhouette(ctx, 34, 72, shFrac, hullFrac);

      const drawSegBar = (y, label, valText, frac, col) => {
        ctx.font = `500 8.5px ${sansFont}`;
        ctx.fillStyle = 'rgba(205, 228, 245, 0.78)';
        ctx.fillText(label, 62, y);

        ctx.font = `bold 9.5px ${monoFont}`;
        ctx.fillStyle = '#eef7ff';
        ctx.textAlign = 'right';
        ctx.fillText(valText, 242, y);
        ctx.textAlign = 'left';

        const bx = 62;
        const bw = 180;
        const by = y + 4;
        const bh = 4.5;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.11)';
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = col;
        ctx.fillRect(bx, by, bw * frac, bh);
      };

      drawSegBar(41, '能量护盾', `${Math.ceil(ship.shield)}`, shFrac, shAlert ? '#f04c68' : '#6ecff6');
      drawSegBar(71, '舰体装甲', `${Math.ceil(ship.hull)}`, hullFrac, hullFrac < 0.35 ? '#f04c68' : '#58df9e');
      drawSegBar(101, '聚变电容', `${Math.round(ship.boost)}%`, bstFrac, '#f2b04d');

      ctx.restore();
      tex.needsUpdate = true;
    }

    // Center Holo-Collimator: Velocity, Solar Overdrive & Evade/Warp State
    {
      const { ctx, tex } = this.mfdCenter;
      const od = upgradeSystem ? upgradeSystem.overdriveCharge : 0;
      const odActive = Boolean(upgradeSystem?.isOverdriveActive);
      drawHoloGlassBackdrop(ctx, odActive ? '92, 232, 165' : '118, 206, 246', 0.52);

      ctx.shadowColor = 'rgba(0, 6, 14, 0.85)';
      ctx.shadowBlur = 3;
      ctx.textAlign = 'center';

      const spd = Math.round(ship.velocity.length() * 14);
      ctx.font = `bold 24px ${monoFont}`;
      ctx.fillStyle = '#eff8ff';
      ctx.fillText(`${spd}`, 128, 42);
      ctx.font = `600 8px ${sansFont}`;
      ctx.fillStyle = 'rgba(170, 214, 242, 0.72)';
      ctx.fillText('KM / S  相对航速', 128, 54);

      const statusText =
        ship.warpState !== 'IDLE'
          ? ship.warpState === 'CHARGING'
            ? '曲率引擎充能中'
            : '超巡航曲率航行'
          : odActive
          ? `恒星超载激活 ${upgradeSystem.overdriveTimer.toFixed(1)}s`
          : od >= 100
          ? '[Z] 聚变超载就绪'
          : `聚变超载 ${Math.round(od)}%`;
      ctx.font = `600 9.5px ${sansFont}`;
      ctx.fillStyle = odActive ? '#6eeea8' : od >= 100 ? '#f5c45e' : '#8ed2f2';
      ctx.fillText(statusText, 128, 76);

      const odFrac = THREE.MathUtils.clamp(odActive ? upgradeSystem.overdriveTimer / 8.5 : od / 100, 0, 1);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(36, 84, 184, 4);
      ctx.fillStyle = odActive ? '#5ce69d' : od >= 100 ? '#f2b84d' : '#6ecff6';
      ctx.fillRect(36, 84, 184 * odFrac, 4);

      ctx.font = `500 8.5px ${sansFont}`;
      ctx.fillStyle = ship.dodgeTimer > 0 ? '#7aefff' : ship.dodgeCooldown > 0 ? 'rgba(176, 206, 232, 0.68)' : '#6de6a8';
      ctx.fillText(
        ship.dodgeTimer > 0
          ? '相位翻滚规避中'
          : ship.dodgeCooldown > 0
          ? `闪避充能 ${ship.dodgeCooldown.toFixed(1)}s`
          : '双击 A / D 闪避就绪',
        128,
        108
      );

      ctx.restore();
      tex.needsUpdate = true;
    }

    // Right Holo-Pane: Weapon Thermal + Ordnance + 46px Enlarged Threat Radar (replaces hidden 2D CSS radar)
    {
      const { ctx, tex } = this.mfdRight;
      const overheat = Boolean(weaponSystem.gammaOverheated);
      drawHoloGlassBackdrop(ctx, overheat ? '240, 82, 108' : '238, 178, 84', 0.52);

      ctx.shadowColor = 'rgba(0, 6, 14, 0.85)';
      ctx.shadowBlur = 3;
      ctx.font = `600 9.5px ${sansFont}`;
      ctx.fillStyle = overheat ? '#ff647e' : '#f2c16b';
      ctx.fillText(overheat ? '光矛过热冷却' : '火控与战术雷达', 14, 15);

      // Left column telemetry
      ctx.font = `500 8.5px ${sansFont}`;
      ctx.fillStyle = 'rgba(205, 228, 245, 0.8)';
      ctx.fillText('光矛热容', 14, 38);
      ctx.font = `bold 9.5px ${monoFont}`;
      ctx.fillStyle = overheat || weaponSystem.gammaHeat > 75 ? '#ff647e' : '#eef7ff';
      ctx.fillText(`${Math.round(weaponSystem.gammaHeat)}%`, 86, 38);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(14, 43, 108, 4.5);
      ctx.fillStyle = overheat || weaponSystem.gammaHeat > 75 ? '#f04c68' : '#6ecff6';
      ctx.fillRect(14, 43, 108 * THREE.MathUtils.clamp(weaponSystem.gammaHeat / 100, 0, 1), 4.5);

      const maxM = WEAPON_CONFIG.missileMaxAmmo + (weaponSystem.bonusMissileMax || 0);
      ctx.font = `500 8.5px ${sansFont}`;
      ctx.fillStyle = 'rgba(205, 228, 245, 0.78)';
      ctx.fillText('蜂群导弹', 14, 68);
      ctx.font = `bold 9.5px ${monoFont}`;
      ctx.fillStyle = '#f2b84d';
      ctx.fillText(`${weaponSystem.missileAmmo}/${maxM}`, 72, 68);

      ctx.font = `500 8.5px ${sansFont}`;
      ctx.fillStyle = 'rgba(205, 228, 245, 0.78)';
      ctx.fillText('EMP 震荡', 14, 88);
      ctx.font = `bold 9.5px ${monoFont}`;
      ctx.fillStyle = weaponSystem.empCooldown > 0 ? '#9ab8d4' : '#6ecff6';
      ctx.fillText(weaponSystem.empCooldown > 0 ? `${weaponSystem.empCooldown.toFixed(0)}s` : '就绪', 72, 88);

      ctx.font = `500 8.5px ${sansFont}`;
      ctx.fillStyle = 'rgba(130, 212, 248, 0.85)';
      ctx.fillText(`空域: ${(nearestName || '太阳系').slice(0, 10)}`, 14, 111);

      // Enlarged 46px Holographic Forward-Up Threat Radar
      const rcx = 194;
      const rcy = 71;
      const rr = 44;

      ctx.strokeStyle = 'rgba(110, 207, 246, 0.34)';
      ctx.lineWidth = 0.9;
      for (const frac of [0.5, 1.0]) {
        ctx.beginPath();
        ctx.arc(rcx, rcy, rr * frac, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(110, 207, 246, 0.18)';
      ctx.beginPath();
      ctx.moveTo(rcx - rr, rcy);
      ctx.lineTo(rcx + rr, rcy);
      ctx.moveTo(rcx, rcy - rr);
      ctx.lineTo(rcx, rcy + rr);
      ctx.stroke();

      // Forward FOV cone
      ctx.fillStyle = 'rgba(110, 207, 246, 0.11)';
      ctx.beginPath();
      ctx.moveTo(rcx, rcy);
      ctx.arc(rcx, rcy, rr, -Math.PI * 0.72, -Math.PI * 0.28);
      ctx.closePath();
      ctx.fill();

      // Rotating sweep wedge
      const sweep = (performance.now() * 0.0022) % (Math.PI * 2);
      ctx.fillStyle = 'rgba(110, 207, 246, 0.13)';
      ctx.beginPath();
      ctx.moveTo(rcx, rcy);
      ctx.arc(rcx, rcy, rr, sweep - 0.5, sweep);
      ctx.closePath();
      ctx.fill();

      if (enemyManager?.enemies) {
        const tmpLoc = this._tmpLocal;
        for (const e of enemyManager.enemies) {
          if (e.hp <= 0) continue;
          ship.root.worldToLocal(tmpLoc.copy(e.mesh.position));
          const dist = Math.hypot(tmpLoc.x, tmpLoc.z);
          if (dist > 1600) continue;
          const s = Math.min(1, dist / 950) * (rr - 4);
          const a = Math.atan2(tmpLoc.z, tmpLoc.x);
          const bx = rcx + Math.cos(a) * s;
          const by = rcy + Math.sin(a) * s;
          const alt = THREE.MathUtils.clamp(tmpLoc.y / 140, -1, 1) * 7;
          const col = e.type === 'droplet' || e.type === 'relay' ? '#ff556e' : '#f2b84d';

          ctx.strokeStyle = col;
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx, by - alt);
          ctx.stroke();

          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(bx, by - alt, e.type === 'droplet' || e.type === 'relay' ? 2.8 : 1.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Ownship chevron
      ctx.fillStyle = '#eff8ff';
      ctx.beginPath();
      ctx.moveTo(rcx, rcy - 3.5);
      ctx.lineTo(rcx + 3, rcy + 3);
      ctx.lineTo(rcx - 3, rcy + 3);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
      tex.needsUpdate = true;
    }
  }

  update(dt, time, ship, weaponSystem, upgradeSystem, nearestName, enemyManager = null) {
    if (!this.root.visible) return;

    if (this._muzzleTimer > 0) {
      this._muzzleTimer -= dt;
      if (this._muzzleTimer <= 0) this.muzzleLight.intensity = 0;
    }

    const lowHullAlert = ship.hull < 350 ? Math.min(1, (350 - ship.hull) / 250) : 0;
    this.glassMat.uniforms.uTime.value = time;
    this.glassMat.uniforms.uAlert.value = Math.max(lowHullAlert, ship.damagePulse * 0.72);

    // Subtle status pip color feedback (restrained intensities)
    if (ship.damagePulse > 0.2 || (ship.hull < 350 && Math.sin(time * 9) > 0)) {
      this.statusLedMat.emissive.set('#e84a62');
      this.statusLedMat.emissiveIntensity = 1.25;
    } else if (weaponSystem?.gammaOverheated || ship.warpState === 'CHARGING') {
      this.statusLedMat.emissive.set('#e8a23e');
      this.statusLedMat.emissiveIntensity = 1.05;
    } else if (upgradeSystem?.isOverdriveActive) {
      this.statusLedMat.emissive.set('#5ee29c');
      this.statusLedMat.emissiveIntensity = 1.1;
    } else {
      this.statusLedMat.emissive.set('#5ebee8');
      this.statusLedMat.emissiveIntensity = 0.75;
    }

    this._mfdTimer -= dt;
    if (this._mfdTimer <= 0) {
      this._mfdTimer = 0.068;
      this._redrawMfds(ship, weaponSystem, upgradeSystem, nearestName, enemyManager);
    }
  }
}
