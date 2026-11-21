import * as THREE from 'three';
import { SHIP_CONFIG } from '../core/Constants.js';
import { segmentSphereEntryT } from './WeaponSystem.js';

const wingRight = new THREE.Vector3();
const wingUp = new THREE.Vector3();
const wingForward = new THREE.Vector3();
const wingDesired = new THREE.Vector3();
const wingAim = new THREE.Vector3();
const wingDir = new THREE.Vector3();
const boltStart = new THREE.Vector3();
const boltHit = new THREE.Vector3();
const boltCandidate = { t: 0, point: new THREE.Vector3() };

export const UPGRADE_CATALOG = [
  {
    id: 'railgun_overclock',
    name: '高能脉冲超频核',
    tag: 'PRIMARY FIRE',
    desc: '双联脉冲激光射频 +28%，解锁舰首高能超频第三联光束，伤害 +18%。',
    color: '#4ce8ff',
  },
  {
    id: 'gamma_prism',
    name: '伽马棱镜增幅',
    tag: 'BEAM LANCE',
    desc: '伽马粒子光矛伤害 +38%、热量累积 -30%，持续灼烧目标周围引发等离子溅射。',
    color: '#6bf8ff',
  },
  {
    id: 'swarm_rack',
    name: '蜂群微型弹舱',
    tag: 'MISSILE SALVO',
    desc: '导弹备弹上限 +4、单轮齐射 +2 枚追踪导弹，爆炸冲击波与杀伤半径大幅扩大。',
    color: '#ffb430',
  },
  {
    id: 'phase_shield',
    name: '相位偏导护盾',
    tag: 'DEFENSE GRID',
    desc: '能量护盾上限 +180 并立刻充满，回充速率 +45%，护盾受损时反弹震荡波。',
    color: '#38f294',
  },
  {
    id: 'chain_detonation',
    name: '链式殉爆弹头',
    tag: 'CHAIN BLAST',
    desc: '击毁敌舰将触发二次量子殉爆波，对周围 45u 内敌军造成毁灭性范围伤害。',
    color: '#ff5268',
  },
  {
    id: 'wingman_squad',
    name: '亚洲舰队僚机中队',
    tag: 'FLEET WINGMEN',
    desc: '部署 +2 架自主作战友军拦截机伴飞「自然选择号」，自动锁定周边敌舰开火！',
    color: '#76c7ff',
  },
  {
    id: 'overdrive_core',
    name: '恒星聚变超载核',
    tag: 'SOLAR OVERDRIVE',
    desc: '恒星超载 [Z] 充能效率 +45%，脉冲加速能耗减半，立即修复舰体装甲 +280。',
    color: '#ffd95e',
  },
  { id: 'cryo_singularity', name: '智子反制寒霜核', tag: 'EMP CONTROL', desc: '扩大 EMP 范围，缩短冷却，并使敌舰减速、承受更多伤害。', color: '#7ef2ff' },
  { id: 'kinetic_recycler', name: '量子动能回收阵', tag: 'SALVAGE', desc: '击杀恢复护盾与推进电容，提高补给掉落几率。', color: '#38f294' },
];

export const SYNERGY_CATALOG = [
  { id: 'shatter_rail', name: '聚能爆裂脉冲', requires: ['railgun_overclock', 'chain_detonation'], desc: '每第五轮激光脉冲强化并在命中点引发范围爆裂。', color: '#ff8844' },
  { id: 'prism_overdrive', name: '棱镜超载', requires: ['gamma_prism', 'overdrive_core'], desc: '超载使光矛热量归零，并向邻近敌舰折射电弧。', color: '#ffd95e' },
  { id: 'cryo_swarm', name: '寒霜蜂群', requires: ['swarm_rack', 'cryo_singularity'], desc: '导弹命中与溅射施加减速和易伤。', color: '#7ef2ff' },
];

function createWingmanMesh() {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({
    color: '#a8c6e8',
    metalness: 0.85,
    roughness: 0.25,
  });
  const glowMat = new THREE.MeshBasicMaterial({ color: '#4ce8ff' });

  const fus = new THREE.Mesh(new THREE.ConeGeometry(0.62, 3.2, 5), hullMat);
  fus.rotation.x = -Math.PI * 0.5;
  fus.scale.set(1.2, 0.55, 1);
  g.add(fus);

  const wings = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.08, 1.0), hullMat);
  wings.position.set(0, 0, 0.45);
  g.add(wings);

  const engine = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), glowMat);
  engine.position.set(0, 0, 1.55);
  g.add(engine);

  return g;
}

export class UpgradeSystem {
  constructor(scene, audio, vfx) {
    this.scene = scene;
    this.audio = audio;
    this.vfx = vfx;

    this.levels = {};
    this.activeSynergies = [];
    this.xp = 0;
    this.xpToNext = 520;
    this.level = 1;

    // Solar Overdrive [Z]
    this.overdriveCharge = 35; // 0..100
    this.overdriveTimer = 0;

    // Kill Combo & Streak
    this.comboCount = 0;
    this.comboTimer = 0;
    this.comboMaxWindow = 6.5;

    // Pending 3-card upgrade drafts
    this.pendingDrafts = 0;
    this.onDraftReady = null;
    this.onBanner = null;

    // Allied AI Wingmen
    this.wingmen = [];
    this.wingmanBolts = [];
    this._boltGeo = new THREE.CylinderGeometry(0.045, 0.045, 5.5, 5);
    this._boltGeo.rotateX(Math.PI * 0.5);
    this._boltGeo.translate(0, 0, 2.75);
    this._boltMat = new THREE.MeshBasicMaterial({
      color: '#5ceaff',
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }

  get isOverdriveActive() {
    return this.overdriveTimer > 0;
  }

  getLevel(id) {
    return this.levels[id] || 0;
  }

  reset() {
    this.levels = {};
    this.activeSynergies = [];
    this.xp = 0;
    this.xpToNext = 520;
    this.level = 1;
    this.overdriveCharge = 35;
    this.overdriveTimer = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.pendingDrafts = 0;

    for (const { mesh } of this.wingmen) {
      this.scene.remove(mesh);
      const materials = new Set();
      mesh.traverse((child) => {
        child.geometry?.dispose();
        if (child.material) materials.add(child.material);
      });
      for (const material of materials) material.dispose();
    }
    for (const b of this.wingmanBolts) this.scene.remove(b.mesh);
    this.wingmen = [];
    this.wingmanBolts = [];
  }

  rollChoices(count = 3) {
    const pool = UPGRADE_CATALOG.filter((u) => (this.levels[u.id] || 0) < 4);
    const src = [...pool];
    for (let i = src.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [src[i], src[j]] = [src[j], src[i]];
    }
    return src.slice(0, count);
  }

  hasSynergy(id) {
    return this.activeSynergies.some((synergy) => synergy.id === id);
  }

  getActiveModules() {
    return UPGRADE_CATALOG.filter(({ id }) => this.getLevel(id) > 0)
      .map((module) => ({ ...module, lv: this.getLevel(module.id) }));
  }

  getCandidateSynergies(upgradeId) {
    return SYNERGY_CATALOG.filter(({ requires }) => requires.includes(upgradeId)).map((synergy) => {
      const missing = synergy.requires.filter((coreId) => coreId !== upgradeId && this.getLevel(coreId) === 0);
      const unlocked = this.hasSynergy(synergy.id);
      return {
        ...synergy,
        unlocked,
        readyToUnlock: !unlocked && missing.length === 0,
        missing: missing.map((coreId) => UPGRADE_CATALOG.find(({ id }) => id === coreId).name),
      };
    });
  }

  getLootDropBonus() {
    return this.getLevel('kinetic_recycler') * 0.08;
  }

  applyUpgrade(id, ship, weaponSystem) {
    if (this.getLevel(id) >= 4 || !UPGRADE_CATALOG.some((core) => core.id === id)) return;
    this.levels[id] = (this.levels[id] || 0) + 1;
    this.audio.playUpgradePickup();

    if (id === 'phase_shield') {
      ship.maxShieldBonus = (ship.maxShieldBonus || 0) + 180;
      ship.rechargeShield(400);
    } else if (id === 'swarm_rack') {
      weaponSystem.bonusMissileMax += 4;
      weaponSystem.bonusSalvo += 2;
      weaponSystem.missileAmmo = Math.min(12 + weaponSystem.bonusMissileMax, weaponSystem.missileAmmo + 6);
    } else if (id === 'overdrive_core') {
      ship.healHull(280);
      this.overdriveCharge = Math.min(100, this.overdriveCharge + 40);
    } else if (id === 'wingman_squad') {
      for (let i = 0; i < 2; i++) {
        this._spawnWingman(ship.root.position);
      }
    }
    for (const synergy of SYNERGY_CATALOG) {
      if (this.hasSynergy(synergy.id) || !synergy.requires.every((coreId) => this.getLevel(coreId) > 0)) continue;
      this.activeSynergies.push(synergy);
      this.audio?.playSynergyUnlock?.();
      this.onBanner?.(`SYNERGY UNLOCKED // ${synergy.name}`, synergy.color);
    }
  }

  _spawnWingman(anchorPos) {
    const mesh = createWingmanMesh();
    const idx = this.wingmen.length;
    const side = idx % 2 === 0 ? 1 : -1;
    const rank = Math.floor(idx / 2) + 1;
    mesh.position.copy(anchorPos).add(new THREE.Vector3(side * (9 + rank * 5), 2.5, 4 + rank * 3));
    this.scene.add(mesh);
    this.wingmen.push({
      mesh,
      side,
      rank,
      fireTimer: 0.4 + Math.random() * 0.6,
    });
  }

  triggerOverdrive(ship) {
    if (this.overdriveTimer > 0 || this.overdriveCharge < 100) return false;
    this.overdriveCharge = 0;
    this.overdriveTimer = 8.5;
    ship.rechargeShield(450);
    if (this.vfx.spawnOverdriveBurst) {
      this.vfx.spawnOverdriveBurst(ship.root.position);
    } else {
      this.vfx.spawnEmpWave(ship.root.position, 55, '#ffd95e');
    }
    this.audio.playOverdrive();
    this.onBanner?.('恒星聚变超载启动', '#4ce8ff');
    return true;
  }

  registerKill(enemy, weaponSystem, enemyManager, ship = null) {
    // Combo streak tracking
    this.comboCount++;
    if (enemyManager.stats) enemyManager.stats.maxCombo = Math.max(enemyManager.stats.maxCombo, this.comboCount);
    const recyclerLevel = this.getLevel('kinetic_recycler');
    if (ship && ship.hull > 0 && recyclerLevel > 0) {
      ship.rechargeShield(35 * recyclerLevel);
      ship.boost = Math.min(SHIP_CONFIG.maxBoost, ship.boost + 15 * recyclerLevel);
    }
    this.comboTimer = this.comboMaxWindow;

    const streakLabels = {
      2: '双重击破',
      3: '三连猎杀',
      5: '舰队王牌 ×5',
      8: '恒星战舰无双',
    };
    if (streakLabels[this.comboCount]) {
      this.onBanner?.(streakLabels[this.comboCount], '#ffbe30');
    } else if (this.comboCount > 8 && this.comboCount % 4 === 0) {
      this.onBanner?.(`制空统治 ×${this.comboCount}`, '#ff5268');
    }

    // Combo score multiplier boost
    const bonusPts = Math.round(enemy.scoreValue * Math.min(2.0, (this.comboCount - 1) * 0.25));
    enemyManager.score += bonusPts;

    // Charge Solar Overdrive [Z]
    const odMult = 1 + this.getLevel('overdrive_core') * 0.45;
    const baseCharge = enemy.type === 'droplet' ? 60 : enemy.type === 'relay' || enemy.type === 'destroyer' ? 32 : 16;
    if (!this.isOverdriveActive) {
      this.overdriveCharge = Math.min(100, this.overdriveCharge + baseCharge * odMult);
    }

    // Chain Detonation upgrade: quantum blast damages neighboring enemies
    const chainLv = this.getLevel('chain_detonation');
    if (chainLv > 0) {
      const blastR = 38 + chainLv * 12;
      const blastDmg = 95 * chainLv;
      const center = enemy.mesh.position;
      this.vfx.spawnExplosion(center, 11 + chainLv * 2, '#ff4868');
      for (const other of [...enemyManager.enemies]) {
        if (other.id !== enemy.id && other.hp > 0 && other.mesh.position.distanceTo(center) <= blastR) {
          enemyManager.applyDamage(other, blastDmg, other.mesh.position, 'emp');
        }
      }
    }

    // Salvage XP & Level-Up Draft trigger
    const xpGain = enemy.type === 'droplet' ? 600 : enemy.type === 'relay' ? 360 : enemy.type === 'destroyer' ? 280 : enemy.type === 'gunship' ? 160 : 95;
    this.xp += xpGain * (1 + Math.min(0.6, (this.comboCount - 1) * 0.1));
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      this.xpToNext = Math.round(this.xpToNext * 1.28);
      this.pendingDrafts++;
    }
    if (this.pendingDrafts > 0 && this.onDraftReady) {
      this.onDraftReady();
    }
  }

  grantSectorDraft() {
    this.pendingDrafts++;
    if (this.onDraftReady) this.onDraftReady();
  }

  update(dt, time, ship, enemyManager, playMode) {
    if (playMode !== 'PLAYING') return;

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.comboCount = 0;
      }
    }

    if (this.overdriveTimer > 0) {
      this.overdriveTimer = Math.max(0, this.overdriveTimer - dt);
    }

    // Update Autonomous AI Wingmen flying in agile escort formation
    if (this.wingmen.length) {
      wingRight.set(1, 0, 0).applyQuaternion(ship.root.quaternion);
      wingUp.set(0, 1, 0).applyQuaternion(ship.root.quaternion);
      ship.getForward(wingForward);
    }

    for (let i = 0; i < this.wingmen.length; i++) {
      const w = this.wingmen[i];
      const bobY = Math.sin(time * 2.4 + i * 1.7) * 1.2;
      const desiredPos = wingDesired.copy(ship.root.position)
        .addScaledVector(wingRight, w.side * (8.5 + w.rank * 4.5))
        .addScaledVector(wingUp, 2.2 + bobY)
        .addScaledVector(wingForward, -3.5 * w.rank);

      w.mesh.position.lerp(desiredPos, 1 - Math.exp(-5.5 * dt));

      // Acquire nearest hostile within 650u
      let target = null;
      let minD = 650;
      for (const e of enemyManager.enemies) {
        if (e.hp <= 0) continue;
        const d = e.mesh.position.distanceTo(w.mesh.position);
        if (d < minD) {
          minD = d;
          target = e;
        }
      }

      if (target) {
        const aimPos = wingAim.copy(target.mesh.position).addScaledVector(target.vel, minD / 760);
        w.mesh.lookAt(aimPos);
        w.mesh.rotateY(Math.PI);

        w.fireTimer -= dt;
        if (w.fireTimer <= 0) {
          w.fireTimer = 0.28 + Math.random() * 0.14;
          const dir = wingDir.subVectors(aimPos, w.mesh.position).normalize();
          const muzzle = w.mesh.position.clone().addScaledVector(dir, 1.8);
          const bolt = new THREE.Mesh(this._boltGeo, this._boltMat);
          bolt.position.copy(muzzle);
          bolt.lookAt(aimPos);
          this.scene.add(bolt);
          this.wingmanBolts.push({
            mesh: bolt,
            pos: muzzle,
            vel: dir.clone().multiplyScalar(760),
            age: 0,
            life: 0.9,
            damage: 26 * (ship.loadout?.weaponDmgMult || 1),
          });
        }
      } else {
        w.mesh.quaternion.slerp(ship.root.quaternion, 1 - Math.exp(-6 * dt));
      }
    }

    // Update wingman bolts
    for (let i = this.wingmanBolts.length - 1; i >= 0; i--) {
      const b = this.wingmanBolts[i];
      b.age += dt;
      if (b.age >= b.life) {
        this.scene.remove(b.mesh);
        this.wingmanBolts.splice(i, 1);
        continue;
      }
      boltStart.copy(b.pos);
      b.pos.addScaledVector(b.vel, dt);
      b.mesh.position.copy(b.pos);
      let target = null;
      let firstT = Infinity;
      for (const enemy of enemyManager.enemies) {
        if (enemy.hp <= 0) continue;
        const hit = segmentSphereEntryT(boltStart, b.pos, enemy.mesh.position, enemy.hitRadius + 1.8, boltCandidate);
        if (!hit || hit.t >= firstT) continue;
        firstT = hit.t;
        target = enemy;
        boltHit.copy(hit.point);
      }
      if (target) {
        enemyManager.applyDamage(target, b.damage, boltHit, 'wingman');
        this.vfx.spawnImpactSparks(boltHit, '#4ce8ff', 4, 24, false);
        this.scene.remove(b.mesh);
        this.wingmanBolts.splice(i, 1);
      }
    }
  }
}
