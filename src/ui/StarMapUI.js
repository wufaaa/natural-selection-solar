import { LANDMARK_SECTORS, SHIP_CONFIG, SOLAR_BODIES } from '../core/Constants.js';

export class StarMapUI {
  constructor(solarSystem, missionManager, enemyManager, onWarpRequested, onCloseRequested) {
    this.solarSystem = solarSystem;
    this.missionManager = missionManager;

    // Contract G: accept enemyManager as the 3rd arg while staying compatible with the legacy
    // 4-argument call shape new StarMapUI(solarSystem, missionManager, onWarp, onClose).
    if (typeof enemyManager === 'function') {
      this.enemyManager = null;
      this.onWarpRequested = enemyManager;
      this.onCloseRequested = onWarpRequested;
    } else {
      this.enemyManager = enemyManager || null;
      this.onWarpRequested = onWarpRequested;
      this.onCloseRequested = onCloseRequested;
    }

    this.overlay = document.getElementById('starmap-overlay');
    this.canvas = document.getElementById('starmap-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.quickList = document.getElementById('planet-quick-list');

    this.elName = document.getElementById('dossier-name');
    this.elEn = document.getElementById('dossier-en');
    this.elAu = document.getElementById('dossier-au');
    this.elThreat = document.getElementById('dossier-threat');
    this.elLore = document.getElementById('dossier-lore');
    this.btnWarp = document.getElementById('btn-warp-selected');
    this.btnClose = document.getElementById('btn-close-map');

    this.isOpen = false;
    this.selectedId = 'earth';
    this.lockedTargetId = null;
    this.hoveredId = null;
    this.planetScreenCoords = [];

    // Deterministic background stars & belt astrometrics particles
    this._bgStars = Array.from({ length: 95 }, (_, i) => {
      const s1 = Math.sin(i * 127.1 + 31.7) * 43758.5453;
      const s2 = Math.sin(i * 269.5 + 183.3) * 43758.5453;
      const s3 = Math.sin(i * 419.2 + 91.1) * 43758.5453;
      return {
        nx: s1 - Math.floor(s1),
        ny: s2 - Math.floor(s2),
        r: 0.55 + (s3 - Math.floor(s3)) * 1.1,
        a: 0.14 + (s3 - Math.floor(s3)) * 0.32,
      };
    });

    this._beltParticles = Array.from({ length: 140 }, (_, i) => {
      const s1 = Math.sin(i * 73.1 + 19.3) * 19384.23;
      const s2 = Math.sin(i * 159.7 + 47.1) * 28471.71;
      const r1 = s1 - Math.floor(s1);
      const r2 = s2 - Math.floor(s2);
      return {
        ang: (i / 140) * Math.PI * 2 + r1 * 0.14,
        frac: r2,
        size: 0.8 + (i % 3) * 0.45,
        speed: 0.015 + r1 * 0.012,
      };
    });

    this._buildQuickList();
    this._bindEvents();
    this._observeResize();
  }

  // Watch the canvas wrapper itself so height-only and DPR-only changes also re-rasterise.
  // Falls back to the window resize listener when ResizeObserver is unavailable.
  _observeResize() {
    const wrap = this.canvas?.parentElement;
    if (!wrap) return;
    if (typeof ResizeObserver === 'function') {
      this._resizeObserver = new ResizeObserver(() => {
        if (this.isOpen) this._resizeCanvas();
      });
      this._resizeObserver.observe(wrap);
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      this._onWindowResize = () => {
        if (this.isOpen) this._resizeCanvas();
      };
      window.addEventListener('resize', this._onWindowResize);
    }
  }

  _buildQuickList() {
    this.quickList.innerHTML = '';
    for (const b of SOLAR_BODIES) {
      const btn = document.createElement('button');
      btn.className = 'planet-chip';
      btn.dataset.id = b.id;
      btn.innerHTML = `<span>${b.name}</span><small style="color:${b.color}">${b.distanceAU}</small>`;
      btn.addEventListener('click', () => this.selectBody(b.id, { userExplicit: true }));
      this.quickList.appendChild(btn);
    }
  }

  _bindEvents() {
    this.btnClose.addEventListener('click', () => this.onCloseRequested?.());
    this.btnWarp.addEventListener('click', () => {
      if (this.selectedId) {
        this.onWarpRequested?.(this.selectedId);
      }
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      let bestId = null;
      let bestD = 26;
      for (const p of this.planetScreenCoords) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestD) {
          bestD = d;
          bestId = p.id;
        }
      }
      this.hoveredId = bestId;
      this.canvas.style.cursor = bestId ? 'pointer' : 'crosshair';
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.hoveredId = null;
    });

    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      let bestId = null;
      let bestD = 26;
      for (const p of this.planetScreenCoords) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestD) {
          bestD = d;
          bestId = p.id;
        }
      }
      if (bestId) {
        this.selectBody(bestId, { userExplicit: true });
      }
    });
  }

  open() {
    this.isOpen = true;
    this.overlay.classList.remove('hidden');
    const targetId = this.lockedTargetId || this.missionManager.activeTargetSectorId || 'earth';
    this.selectBody(targetId, { userExplicit: false });
    this._resizeCanvas();
  }

  close() {
    this.isOpen = false;
    this.overlay.classList.add('hidden');
  }

  getLockedTargetId() {
    return this.lockedTargetId;
  }

  clearLockedTarget() {
    this.lockedTargetId = null;
    for (const chip of this.quickList.querySelectorAll('.planet-chip')) {
      chip.classList.remove('locked-waypoint');
    }
  }

  selectBody(id, { userExplicit = false } = {}) {
    this.selectedId = id;
    if (userExplicit) {
      this.lockedTargetId = id;
    }
    const body = SOLAR_BODIES.find((b) => b.id === id);
    if (!body) return;

    this.elName.textContent = body.name;
    this.elEn.textContent = body.enName;
    this.elAu.textContent = body.distanceAU;
    this.elThreat.textContent = body.threat;
    this.elLore.textContent = body.lore;

    const missionId = this.missionManager.activeTargetSectorId;
    for (const chip of this.quickList.querySelectorAll('.planet-chip')) {
      chip.classList.toggle('selected', chip.dataset.id === id);
      chip.classList.toggle('mission-target', chip.dataset.id === missionId);
      chip.classList.toggle('locked-waypoint', Boolean(this.lockedTargetId) && chip.dataset.id === this.lockedTargetId);
    }
  }

  _resizeCanvas() {
    const wrap = this.canvas.parentElement;
    if (!wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Remember what we sized against, so height-only and DPR-only changes are detected too.
    this._lastSize = { w, h, dpr };
  }

  _needsResize() {
    const wrap = this.canvas.parentElement;
    if (!wrap || !this._lastSize) return true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return (
      Math.abs(wrap.clientWidth - this._lastSize.w) > 2 ||
      Math.abs(wrap.clientHeight - this._lastSize.h) > 2 ||
      Math.abs(dpr - this._lastSize.dpr) > 0.001
    );
  }

  _worldToMapRadius(worldR, maxMapR) {
    if (worldR <= 1) return 0;
    const maxWorldR = 20800;
    const norm = Math.log10(1 + worldR * 0.008) / Math.log10(1 + maxWorldR * 0.008);
    return 24 + norm * (maxMapR - 28);
  }

  render(ship) {
    if (!this.isOpen) return;
    if (this._needsResize()) {
      this._resizeCanvas();
    }

    const w = this.canvas.clientWidth || 700;
    const h = this.canvas.clientHeight || 560;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const maxR = Math.min(w, h) * 0.455;
    const ctx = this.ctx;
    const nowSec = performance.now() * 0.001;

    ctx.clearRect(0, 0, w, h);

    // 1. Subtle deep-space astrometrics starfield & holographic micro-grid
    for (const st of this._bgStars) {
      ctx.fillStyle = `rgba(165, 220, 255, ${st.a})`;
      ctx.beginPath();
      ctx.arc(st.nx * w, st.ny * h, st.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = 'rgba(76, 232, 255, 0.04)';
    ctx.lineWidth = 1;
    const gridStep = 48;
    for (let gx = cx % gridStep; gx < w; gx += gridStep) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
    }
    for (let gy = cy % gridStep; gy < h; gy += gridStep) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }

    // 2. Holographic Rotating Radar Sweep Cone & Polar Azimuth Dial
    const sweepAng = (nowSec * 0.52) % (Math.PI * 2);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, maxR, sweepAng - 0.52, sweepAng);
    ctx.closePath();
    const sweepGrad = ctx.createRadialGradient(cx, cy, 10, cx, cy, maxR);
    sweepGrad.addColorStop(0, 'rgba(76, 232, 255, 0.14)');
    sweepGrad.addColorStop(1, 'rgba(76, 232, 255, 0.015)');
    ctx.fillStyle = sweepGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(76, 232, 255, 0.24)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweepAng) * maxR, cy + Math.sin(sweepAng) * maxR);
    ctx.stroke();
    ctx.restore();

    // Radial spokes + Outer 360-deg bearing compass ticks
    ctx.strokeStyle = 'rgba(76, 232, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * maxR, cy + Math.sin(a) * maxR);
      ctx.stroke();
    }

    const dialR = maxR + 6;
    ctx.strokeStyle = 'rgba(76, 232, 255, 0.18)';
    ctx.beginPath();
    ctx.arc(cx, cy, dialR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = '9px "Cascadia Mono", monospace';
    ctx.fillStyle = 'rgba(120, 200, 240, 0.5)';
    ctx.textAlign = 'center';
    for (let deg = 0; deg < 360; deg += 45) {
      const a = ((deg - 90) * Math.PI) / 180;
      const tx = cx + Math.cos(a) * (dialR + 10);
      const ty = cy + Math.sin(a) * (dialR + 10) + 3;
      ctx.fillText(`${String(deg).padStart(3, '0')}°`, tx, ty);
    }

    // 3. Concentric AU Calibration Rings + Asteroid Belt Particle Band
    const beltDef = SOLAR_BODIES.find((b) => b.id === 'belt');
    if (beltDef) {
      const rIn = this._worldToMapRadius(beltDef.innerRadius, maxR);
      const rOut = this._worldToMapRadius(beltDef.outerRadius, maxR);
      ctx.strokeStyle = 'rgba(170, 165, 150, 0.12)';
      ctx.lineWidth = Math.max(6, rOut - rIn);
      ctx.beginPath();
      ctx.arc(cx, cy, (rIn + rOut) * 0.5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = 'rgba(195, 205, 220, 0.55)';
      for (const p of this._beltParticles) {
        const a = p.ang + nowSec * p.speed;
        const rr = rIn + (rOut - rIn) * p.frac;
        ctx.fillRect(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, p.size, p.size);
      }
    }

    const auMarks = [
      { worldR: 2950, label: '1.0 AU' },
      { worldR: 8500, label: '5.2 AU' },
      { worldR: 12700, label: '9.6 AU' },
      { worldR: 20800, label: '30.1 AU' },
    ];
    ctx.font = '8.5px "Cascadia Mono", monospace';
    ctx.fillStyle = 'rgba(76, 232, 255, 0.36)';
    ctx.textAlign = 'left';
    for (const m of auMarks) {
      const mr = this._worldToMapRadius(m.worldR, maxR);
      ctx.fillText(m.label, cx + 4, cy - mr + 9);
    }

    // Ship map coordinate
    const sp = ship.root.position;
    const sr = this._worldToMapRadius(Math.hypot(sp.x, sp.z), maxR);
    const sang = Math.atan2(sp.z, sp.x);
    const shipSX = cx + Math.cos(sang) * sr;
    const shipSY = cy + Math.sin(sang) * sr;

    // 4. Planets, Lit 3D Shaded Spheres, Moons & Rings
    const missionId = this.missionManager.activeTargetSectorId;
    this.planetScreenCoords = [];
    let selectedCoord = null;

    for (const def of SOLAR_BODIES) {
      const rec = this.solarSystem.bodies.get(def.id);
      const pos = rec ? rec.group.position : { x: 0, z: 0 };
      const worldR = Math.hypot(pos.x, pos.z);
      const mapR = this._worldToMapRadius(worldR, maxR);
      const ang = Math.atan2(pos.z, pos.x);
      const isSelected = def.id === this.selectedId;
      const isHovered = def.id === this.hoveredId;

      if (def.orbitRadius > 0 && def.type !== 'belt') {
        ctx.strokeStyle = isSelected
          ? 'rgba(76, 232, 255, 0.56)'
          : isHovered
          ? 'rgba(76, 232, 255, 0.34)'
          : 'rgba(130, 175, 225, 0.16)';
        ctx.lineWidth = isSelected ? 1.5 : 1;
        ctx.beginPath();
        ctx.arc(cx, cy, mapR, 0, Math.PI * 2);
        ctx.stroke();
      }

      const px = cx + Math.cos(ang) * mapR;
      const py = cy + Math.sin(ang) * mapR;
      this.planetScreenCoords.push({ id: def.id, x: px, y: py });
      if (isSelected) selectedCoord = { x: px, y: py, def };

      const dotR = def.id === 'sun' ? 14 : def.type === 'gas' ? 9.5 : def.type === 'ice' ? 7.2 : 5.6;

      // Planetary rings (Saturn & Uranus)
      if (def.id === 'saturn' || def.id === 'uranus') {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(def.id === 'uranus' ? 1.18 : -0.36);
        ctx.strokeStyle = def.id === 'uranus' ? 'rgba(136, 227, 236, 0.45)' : 'rgba(235, 212, 160, 0.85)';
        ctx.lineWidth = def.id === 'uranus' ? 1.2 : 2.6;
        ctx.beginPath();
        ctx.ellipse(0, 0, dotR * 2.05, dotR * 0.65, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Sol multi-halo bloom
      if (def.id === 'sun') {
        const g = ctx.createRadialGradient(px, py, 2, px, py, 36);
        g.addColorStop(0, 'rgba(255, 245, 200, 0.98)');
        g.addColorStop(0.35, 'rgba(255, 180, 75, 0.45)');
        g.addColorStop(1, 'rgba(255, 110, 20, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, 36, 0, Math.PI * 2);
        ctx.fill();
      }

      // Directional sunlit 3D gradient planet sphere facing Sol
      if (def.id === 'sun') {
        ctx.fillStyle = def.color;
        ctx.beginPath();
        ctx.arc(px, py, dotR, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const lx = px - Math.cos(ang) * dotR * 0.42;
        const ly = py - Math.sin(ang) * dotR * 0.42;
        const gPlanet = ctx.createRadialGradient(lx, ly, dotR * 0.12, px, py, dotR);
        gPlanet.addColorStop(0, '#ffffff');
        gPlanet.addColorStop(0.45, def.color);
        gPlanet.addColorStop(1, 'rgba(6, 12, 24, 0.92)');
        ctx.fillStyle = gPlanet;
        ctx.beginPath();
        ctx.arc(px, py, dotR, 0, Math.PI * 2);
        ctx.fill();
      }

      // Orbiting Moons miniature indicators (Earth, Jupiter, Neptune)
      if (def.moons && def.moons.length > 0) {
        for (let mi = 0; mi < def.moons.length; mi++) {
          const mAng = (def.moons[mi].initialAngle || 0) + nowSec * (0.65 - mi * 0.15);
          const mDist = dotR + 6 + mi * 3.5;
          ctx.fillStyle = 'rgba(210, 230, 250, 0.72)';
          ctx.beginPath();
          ctx.arc(px + Math.cos(mAng) * mDist, py + Math.sin(mAng) * mDist, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Mission target animated beacon ring
      if (def.id === missionId) {
        const pulse = dotR + 8 + Math.sin(nowSec * 5.0) * 3;
        ctx.strokeStyle = 'rgba(255, 56, 88, 0.88)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(px, py, pulse, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Hover highlight
      if (isHovered && !isSelected) {
        ctx.strokeStyle = 'rgba(76, 232, 255, 0.55)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(px, py, dotR + 5, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Selected rotating holographic acquisition reticle
      if (isSelected) {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(nowSec * 1.1);
        ctx.strokeStyle = '#4ce8ff';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([7, 5]);
        ctx.beginPath();
        ctx.arc(0, 0, dotR + 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      ctx.fillStyle = isSelected ? '#ffffff' : isHovered ? '#6ef2ff' : 'rgba(215, 232, 250, 0.86)';
      ctx.font = isSelected ? 'bold 12px "Segoe UI", sans-serif' : '11px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(def.name, px, py - dotR - 8);

      // Off-mission sector straggler marker: amber diamond, top-right of the node
      if (def.id !== missionId && this.enemyManager) {
        const stragglers = this.enemyManager.getSectorEnemyCount?.(def.id) || 0;
        if (stragglers > 0) {
          const dx = px + dotR + 6;
          const dy = py - dotR - 6;
          const s = 3.1;
          ctx.fillStyle = '#ffb430';
          ctx.beginPath();
          ctx.moveTo(dx, dy - s);
          ctx.lineTo(dx + s, dy);
          ctx.lineTo(dx, dy + s);
          ctx.lineTo(dx - s, dy);
          ctx.closePath();
          ctx.fill();
        }
      }

      // 3A landmark facility micro-glyph beneath the node
      if (LANDMARK_SECTORS.includes(def.id)) {
        ctx.fillStyle = 'rgba(76, 232, 255, 0.78)';
        ctx.font = '9px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('◈', px, py + dotR + 13);
      }
    }

    // 5. Quantum-Warp Predicted Trajectory Bezier Arc + Traveling Plasma Pulses
    if (selectedCoord && Math.hypot(selectedCoord.x - shipSX, selectedCoord.y - shipSY) > 8) {
      const tx = selectedCoord.x;
      const ty = selectedCoord.y;
      const midX = (shipSX + tx) * 0.5;
      const midY = (shipSY + ty) * 0.5;
      const dx = tx - shipSX;
      const dy = ty - shipSY;
      // Subtle curve bowing slightly away from radial line for sci-fi navigation feel
      const ctrlX = midX - dy * 0.16;
      const ctrlY = midY + dx * 0.16;

      ctx.save();
      ctx.strokeStyle = 'rgba(76, 232, 255, 0.55)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(shipSX, shipSY);
      ctx.quadraticCurveTo(ctrlX, ctrlY, tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);

      // Traveling plasma pulse along curve
      const tPulse = (nowSec * 0.85) % 1;
      const mt = 1 - tPulse;
      const pxPulse = mt * mt * shipSX + 2 * mt * tPulse * ctrlX + tPulse * tPulse * tx;
      const pyPulse = mt * mt * shipSY + 2 * mt * tPulse * ctrlY + tPulse * tPulse * ty;
      ctx.fillStyle = '#9cf8ff';
      ctx.beginPath();
      ctx.arc(pxPulse, pyPulse, 3.2, 0, Math.PI * 2);
      ctx.fill();

      // Distance & ETA pill on trajectory midpoint
      const wpPos = this.solarSystem.getBodyWorldPosition(selectedCoord.def.id);
      if (wpPos) {
        const worldDist = wpPos.distanceTo(sp);
        const eta = (worldDist / SHIP_CONFIG.warpSpeed + SHIP_CONFIG.warpChargeTime).toFixed(1);
        const label = `DIST ${Math.round(worldDist)}u · 约 ${eta}s`;
        const lblX = 0.25 * shipSX + 0.5 * ctrlX + 0.25 * tx;
        const lblY = 0.25 * shipSY + 0.5 * ctrlY + 0.25 * ty;

        ctx.font = 'bold 9.5px "Cascadia Mono", monospace';
        const tw = ctx.measureText(label).width + 10;
        ctx.fillStyle = 'rgba(4, 14, 28, 0.86)';
        ctx.fillRect(lblX - tw * 0.5, lblY - 9, tw, 15);
        ctx.strokeStyle = 'rgba(76, 232, 255, 0.45)';
        ctx.lineWidth = 1;
        ctx.strokeRect(lblX - tw * 0.5, lblY - 9, tw, 15);
        ctx.fillStyle = '#6cf2ff';
        ctx.textAlign = 'center';
        ctx.fillText(label, lblX, lblY + 2);
      }
      ctx.restore();
    }

    // 6. Plot Natural Selection Live Ship Vector + Pulse Ring
    const fwd = ship.getForward();
    const heading = Math.atan2(fwd.z, fwd.x);
    ctx.save();
    ctx.translate(shipSX, shipSY);

    ctx.strokeStyle = 'rgba(56, 242, 148, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, 10 + Math.sin(nowSec * 4.0) * 2.5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.rotate(heading);
    ctx.fillStyle = '#38f294';
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-5.5, -5);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-5.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
