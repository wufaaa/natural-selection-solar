import * as THREE from 'three';
import { CAMPAIGN_STAGES, SOLAR_BODIES } from '../core/Constants.js';

const ENDLESS_SECTORS = ['earth', 'mars', 'belt', 'saturn', 'jupiter', 'uranus', 'neptune'];

export class MissionManager {
  constructor(solarSystem, enemyManager, audio, onComm) {
    this.solarSystem = solarSystem;
    this.enemyManager = enemyManager;
    this.audio = audio;
    this.onComm = onComm;

    this.mode = 'CAMPAIGN'; // CAMPAIGN | ENDLESS
    this.stageIndex = 0;
    this.endlessWave = 1;
    this.campaignComplete = false;
    this.deployedKey = null;
    this.stageTransitionTimer = 0;
    this.pendingAdvance = false;
    this.onSectorCleared = null;
    this.commQueue = [];
    this.deploymentBody = new THREE.Vector3();
    this.nextDeploymentBody = new THREE.Vector3();
    this.deploymentDrift = new THREE.Vector3();
    this.enemyManager.syncDeploymentAnchors = () => this._syncDeploymentAnchors();
    this.missionElapsed = 0;
  }

  get currentStage() {
    if (this.mode === 'ENDLESS') {
      const sectorId = ENDLESS_SECTORS[(this.endlessWave - 1) % ENDLESS_SECTORS.length];
      const body = SOLAR_BODIES.find((b) => b.id === sectorId);
      const isBossWave = this.endlessWave % 3 === 0;
      return {
        id: `endless_${this.endlessWave}`,
        sectorId,
        code: `WAVE ${String(this.endlessWave).padStart(2, '0')}`,
        title: `无尽防卫 · ${body?.name || sectorId}空域`,
        objective: isBossWave
          ? `击破强化波次「水滴」探测体与混合护航编队`
          : `肃清第 ${this.endlessWave} 波三体入侵舰队`,
        relayCount: this.endlessWave >= 2 ? 1 : 0,
        drones: 3 + Math.min(8, this.endlessWave),
        gunships: 1 + Math.min(5, Math.floor(this.endlessWave * 0.7)),
        destroyers: this.endlessWave >= 2 ? Math.min(3, Math.floor(this.endlessWave / 2)) : 0,
        hasDroplet: isBossWave,
      };
    }
    return CAMPAIGN_STAGES[this.stageIndex] || null;
  }

  get activeTargetSectorId() {
    if (this.campaignComplete) return null;
    return this.currentStage ? this.currentStage.sectorId : null;
  }

  startCampaign(mode = 'CAMPAIGN') {
    this.mode = mode;
    this.commQueue.length = 0;
    this.missionElapsed = 0;
    this.stageIndex = 0;
    this.endlessWave = 1;
    this.campaignComplete = false;
    this.deployedKey = null;
    this.pendingAdvance = false;
    this.enemyManager.clearAll();
    this.enemyManager.kills = 0;
    this.enemyManager.score = 0;

    this._spawnStageForces(this.currentStage);
  }

  get currentDeploymentKey() {
    return `${this.mode}:${this.mode === 'ENDLESS' ? this.endlessWave : this.stageIndex}`;
  }

  _spawnStageForces(stage) {
    if (!stage || this.deployedKey === this.currentDeploymentKey) return;
    this.deployedKey = this.currentDeploymentKey;

    const center = this.solarSystem.getWarpTargetPosition(stage.sectorId) || new THREE.Vector3();
    const planetPos = this.solarSystem.getBodyWorldPosition(stage.sectorId) || new THREE.Vector3();
    const toPlanet = planetPos.clone().sub(center).normalize();
    if (!toPlanet.lengthSq()) toPlanet.set(0, 0, -1);
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(toPlanet, up).normalize();
    if (!side.lengthSq()) side.set(1, 0, 0);
    const heading = side.multiplyScalar(0.94).addScaledVector(up, 0.31).addScaledVector(toPlanet, 0.18).normalize();
    const anchor = center.clone().addScaledVector(heading, 235);
    const radius = SOLAR_BODIES.find(({ id }) => id === stage.sectorId)?.radius || 0;
    const radial = new THREE.Vector3();
    const key = this.currentDeploymentKey;
    this.deploymentBody.copy(planetPos);

    const deploy = (type, pos) => {
      radial.subVectors(pos, planetPos);
      if (radius > 0 && radial.lengthSq() < (radius + 65) ** 2) {
        if (!radial.lengthSq()) radial.copy(toPlanet).negate();
        pos.copy(planetPos).addScaledVector(radial.normalize(), radius + 65);
      }
      const enemy = this.enemyManager.spawnEnemy(type, pos, stage.sectorId, key);
      enemy.deploymentHome = pos.clone();
    };

    const spawnAround = (count, type, minR, maxR) => {
      for (let i = 0; i < count; i++) {
        const a = (i / Math.max(1, count)) * Math.PI * 2 + Math.random() * 0.5;
        const r = minR + Math.random() * (maxR - minR);
        const y = (Math.random() - 0.5) * 60;
        const pos = anchor.clone().add(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
        deploy(type, pos);
      }
    };

    if (stage.relayCount > 0) {
      for (let i = 0; i < stage.relayCount; i++) {
        const offset = new THREE.Vector3((i - (stage.relayCount - 1) * 0.5) * 75, 10, 0);
        deploy('relay', anchor.clone().add(offset));
      }
    }
    spawnAround(stage.drones, 'drone', 42, 125);
    spawnAround(stage.gunships, 'gunship', 62, 155);
    spawnAround(stage.destroyers, 'destroyer', 82, 175);

    if (stage.hasDroplet) {
      deploy('droplet', anchor.clone().add(new THREE.Vector3(0, 24, -45)));
    }

    if (stage.introComms) {
      stage.introComms.forEach((c, idx) => {
        this.commQueue.push({ at: this.missionElapsed + idx * 2.4, ...c });
        this.commQueue.sort((a, b) => a.at - b.at);
      });
    }
  }

  _syncDeploymentAnchors() {
    if (!this.deployedKey || this.campaignComplete) return;
    const body = this.solarSystem.getBodyWorldPosition(this.activeTargetSectorId, this.nextDeploymentBody);
    if (!body) return;
    const drift = this.deploymentDrift.subVectors(body, this.deploymentBody);
    if (drift.lengthSq() === 0) return;
    for (const enemy of this.enemyManager.enemies) {
      if (enemy.deploymentKey !== this.deployedKey || !enemy.deploymentHome) continue;
      enemy.mesh.position.add(drift);
      enemy.deploymentHome.add(drift);
    }
    this.deploymentBody.copy(body);
  }

  onSectorArrived(sectorId) {
    const body = SOLAR_BODIES.find((b) => b.id === sectorId);
    if (body) {
      this.onComm?.(
        '舰桥导航系统',
        `已脱离曲率航道，抵达「${body.name} (${body.enName})」空域 — ${body.distanceAU}。`
      );
      this.audio.playCommsPing();
    }

    if (!this.campaignComplete && this.currentStage && sectorId === this.currentStage.sectorId) {
      if (!this.pendingAdvance && this.deployedKey !== this.currentDeploymentKey) {
        this._spawnStageForces(this.currentStage);
      }
      return;
    }

    // Dynamic Sector Bounty Skirmish in any planetary orbit!
    const existing = this.enemyManager.enemies.some((e) => e.sectorId === sectorId);
    if (!existing && sectorId !== 'sun') {
      const warpPt = this.solarSystem.getWarpTargetPosition(sectorId) || new THREE.Vector3();
      const planetPos = this.solarSystem.getBodyWorldPosition(sectorId) || new THREE.Vector3();
      const dir = planetPos.clone().sub(warpPt).normalize();
      const anchor = warpPt.clone().addScaledVector(dir, 75);

      const droneCount = sectorId === 'belt' ? 5 : 3;
      const gunshipCount = sectorId === 'neptune' || sectorId === 'belt' ? 2 : 1;
      for (let i = 0; i < droneCount; i++) {
        this.enemyManager.spawnEnemy(
          'drone',
          anchor.clone().add(new THREE.Vector3((Math.random() - 0.5) * 90, (Math.random() - 0.5) * 45, (Math.random() - 0.5) * 90)),
          sectorId
        );
      }
      for (let i = 0; i < gunshipCount; i++) {
        this.enemyManager.spawnEnemy(
          'gunship',
          anchor.clone().add(new THREE.Vector3((Math.random() - 0.5) * 110, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 110)),
          sectorId
        );
      }
      if ((sectorId === 'uranus' || sectorId === 'neptune') && Math.random() < 0.35) {
        this.enemyManager.spawnEnemy('destroyer', anchor.clone().add(new THREE.Vector3(62, 16, 0)), sectorId);
      }
      if (this.campaignComplete && sectorId === 'jupiter') {
        this.enemyManager.spawnEnemy('droplet', anchor.clone(), sectorId);
      }
    }
  }

  getObjectiveRemaining(enemyManager = this.enemyManager) {
    const sectorId = this.activeTargetSectorId;
    if (!sectorId || !this.deployedKey) return 0;
    return enemyManager.getSectorEnemyCount(sectorId, this.deployedKey);
  }

  update(dt, ship, onCampaignVictory) {
    // End-of-frame mission rewards must never revive a defeated ship.
    if (!ship || ship.hull <= 0) return;
    this.missionElapsed += dt;
    while (this.commQueue.length && this.commQueue[0].at <= this.missionElapsed) {
      const { sender, text } = this.commQueue.shift();
      this.onComm?.(sender, text);
      this.audio.playCommsPing();
    }
    if (this.campaignComplete) return;
    const stage = this.currentStage;
    if (!stage) return;

    if (this.getObjectiveRemaining() === 0 && !this.pendingAdvance) {
      this.pendingAdvance = true;
      this.stageTransitionTimer = 2.4;
      this.audio.playStageClear();
      ship.healHull(260);
      ship.rechargeShield(350);

      if (this.mode === 'ENDLESS') {
        this.onComm?.(
          '无尽防卫战报',
          `第 ${this.endlessWave} 波已净化！即将部署下一战区波次，并解锁战术模块升级。`
        );
      } else if (this.stageIndex >= CAMPAIGN_STAGES.length - 1) {
        this.onComm?.(
          '亚洲舰队指挥部',
          '「水滴」强互作用力场已瓦解！太阳系核心防线守卫成功！（正在接入自由巡航模式）'
        );
      } else {
        const nextStage = CAMPAIGN_STAGES[this.stageIndex + 1];
        const nextBody = SOLAR_BODIES.find((b) => b.id === nextStage.sectorId);
        this.onComm?.(
          '战区肃清 · 护盾充能完成',
          `「${stage.title}」防线净化完毕！下一目标：${nextBody?.name || nextStage.title}。瞄准航标按 [G] 或 [M] 跃迁！`
        );
      }
    }

    if (this.pendingAdvance) {
      this.stageTransitionTimer -= dt;
      if (this.stageTransitionTimer <= 0) {
        this.pendingAdvance = false;
        this.deployedKey = null;
        if (this.mode === 'ENDLESS') {
          this.endlessWave++;
          this.onSectorCleared?.();
          this._spawnStageForces(this.currentStage);
        } else if (this.stageIndex >= CAMPAIGN_STAGES.length - 1) {
          this.campaignComplete = true;
          onCampaignVictory?.();
        } else {
          this.stageIndex++;
          this.onSectorCleared?.();
          this._spawnStageForces(this.currentStage);
        }
      }
    }
  }
}
