import * as THREE from 'three';
import { segmentSphereEntryT } from './WeaponSystem.js';
import { DROPLET_PHASE2_HP_RATIO } from '../core/Constants.js';
import { createEnemyMesh } from './EnemyFactory.js';

const ICE_TINT = new THREE.Color('#77deff');
const FLASH_TINT = new THREE.Color('#ffffff');
const toPlayer = new THREE.Vector3();
const dirToPlayer = new THREE.Vector3();
const tangent = new THREE.Vector3();
const desiredVelocity = new THREE.Vector3();
const facePoint = new THREE.Vector3();
const aimDirection = new THREE.Vector3();
const right = new THREE.Vector3();
const shotOrigin = new THREE.Vector3();
const previousPosition = new THREE.Vector3();
const relativeStart = new THREE.Vector3();
const relativeEnd = new THREE.Vector3();
const relativeOrigin = new THREE.Vector3();
const sweepResult = { point: new THREE.Vector3(), t: 0 };
const impactPoint = new THREE.Vector3();
const incomingPoint = new THREE.Vector3();
const pickupPull = new THREE.Vector3();
const randomAxis = new THREE.Vector3();

const ENEMY_STATS = {
  drone: { name: '侦察蜂群', hp: 110, shield: 0, speed: 128, score: 150, expRadius: 6.5 },
  gunship: { name: '脉冲炮艇', hp: 280, shield: 120, speed: 92, score: 380, expRadius: 10 },
  destroyer: { name: '三体驱逐舰', hp: 820, shield: 360, speed: 54, score: 1100, expRadius: 19 },
  relay: { name: '智子中继信标', hp: 960, shield: 480, speed: 0, score: 1600, expRadius: 26 },
  droplet: { name: '强互作用力探测器「水滴」', hp: 2600, shield: 0, speed: 245, score: 6500, expRadius: 34 },
};

export class EnemyManager {
  constructor(scene, audio, vfx) {
    this.scene = scene;
    this.audio = audio;
    this.vfx = vfx;

    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];

    this.nextId = 1;
    this.kills = 0;
    this.score = 0;

    this._projGeo = new THREE.SphereGeometry(0.45, 8, 6);
    this._pickupGeo = new THREE.OctahedronGeometry(1.4, 0);

    this.upgradeSystem = null;
    this.listenerShip = null;
    this.onMajorKill = null;
    this.resetStats();
    this.onPlayerHit = null; // callback(damage, fromWorldPos)
    this.onEnemyKilled = null; // callback(enemy)
    this.onDamageDealt = null; // callback(worldPos, dmg, kind)
  }

  resetStats() {
    this.stats = { damageByWeapon: { railgun: 0, gamma: 0, missile: 0, emp: 0, wingman: 0 }, maxCombo: 0, perfectDodges: 0 };
  }

  getSectorEnemyCount(sectorId, deploymentKey = null) {
    let count = 0;
    for (const enemy of this.enemies) {
      if (enemy.sectorId === sectorId && enemy.hp > 0 && (deploymentKey === null || enemy.deploymentKey === deploymentKey)) count++;
    }
    return count;
  }

  getNearestDroplet(refPos, maxDist = 2200) {
    if (!refPos || maxDist <= 0) return null;
    let nearest = null;
    let bestSq = maxDist * maxDist;
    for (const enemy of this.enemies) {
      if (enemy.type !== 'droplet' || enemy.hp <= 0) continue;
      const distanceSq = enemy.mesh.position.distanceToSquared(refPos);
      if (distanceSq >= bestSq) continue;
      bestSq = distanceSq;
      nearest = enemy;
    }
    return nearest;
  }

  staggerDropletFromEmp(enemy, duration = 4) {
    if (enemy?.type !== 'droplet' || enemy.hp <= 0 || duration <= 0) return false;
    if (enemy.state === 'VENT') {
      enemy.stateTimer = Math.max(enemy.stateTimer, duration);
      enemy.vulnerableTimer = Math.max(enemy.vulnerableTimer, duration);
      return true;
    }
    if (enemy.telegraphLine) enemy.telegraphLine.material.opacity = 0;
    enemy.vel.multiplyScalar(0.15);
    this._ventDroplet(enemy, duration);
    return true;
  }

  applyStatusEffect(enemy, { slowTimer = 0, vulnMult = 1, stunTimer = 0 }) {
    if (enemy.hp <= 0) return;
    enemy.slowTimer = Math.max(enemy.slowTimer, slowTimer);
    if (vulnMult > 1) {
      enemy.vulnTimer = Math.max(enemy.vulnTimer, slowTimer, stunTimer);
      enemy.vulnMult = Math.max(enemy.vulnMult, vulnMult);
    }
    enemy.stunTimer = Math.max(enemy.stunTimer, stunTimer);
  }

  _removeEnemyMesh(mesh) {
    this.scene.remove(mesh);
    const materials = new Set();
    const geometries = new Set();
    mesh.traverse((node) => {
      if (node.geometry) geometries.add(node.geometry);
      if (node.material) materials.add(node.material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }

  clearAll() {
    for (const e of this.enemies) this._removeEnemyMesh(e.mesh);
    this.resetStats();
    for (const p of this.projectiles) {
      this.scene.remove(p.mesh);
      p.mesh.material.dispose();
    }
    for (const pk of this.pickups) {
      this.scene.remove(pk.mesh);
      pk.mesh.material.dispose();
    }
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
  }

  spawnEnemy(type, position, sectorId = 'earth', deploymentKey = null) {
    const stats = ENEMY_STATS[type];
    const built = createEnemyMesh(type);
    built.group.position.copy(position);
    this.scene.add(built.group);

    const enemy = {
      id: this.nextId++,
      type,
      sectorId,
      deploymentKey,
      deploymentHome: null,
      name: stats.name,
      mesh: built.group,
      hitRadius: built.hitRadius,
      telegraphLine: built.telegraphLine,
      shieldNodes: built.shieldNodes || [],
      mirrorMat: built.mirrorMat || null,
      tailHalo: built.tailHalo || null,
      flashMats: built.flashMats,
      engineHalo: built.engineHalo,
      phase: 1,
      hitFlashTimer: 0,
      slowTimer: 0,
      stunTimer: 0,
      vulnTimer: 0,
      vulnMult: 1,
      blitzLeft: 0,
      trailTimer: 0,
      auraTimer: 6,
      smokeTimer: 0,
      volleyCount: 0,
      perfectDodgeConsumed: false,
      hp: stats.hp,
      maxHp: stats.hp,
      shield: stats.shield,
      maxShield: stats.shield,
      speed: stats.speed,
      scoreValue: stats.score,
      expRadius: stats.expRadius,
      vel: new THREE.Vector3(),
      state: 'ENGAGE',
      stateTimer: Math.random() * 2.5,
      fireTimer: 1.2 + Math.random() * 1.8,
      telegraphTimer: 0,
      telegraphAim: type === 'gunship' ? new THREE.Vector3() : null,
      telegraphAimLocked: false,
      vulnerableTimer: 0,
      orbitAngle: Math.random() * Math.PI * 2,
      orbitSign: Math.random() < 0.5 ? 1 : -1,
    };

    this.enemies.push(enemy);
    return enemy;
  }

  applyDamage(enemy, amount, hitPos, weaponKind = 'railgun') {
    if (enemy.hp <= 0) return { killed: false, crit: false, shielded: false };

    const initialTotal = enemy.shield + Math.max(0, enemy.hp);
    let dmg = amount * (enemy.vulnTimer > 0 ? enemy.vulnMult : 1);
    let crit = false;
    let shielded = false;

    if (enemy.type === 'droplet') {
      if (enemy.vulnerableTimer > 0) {
        dmg *= 2.6;
        crit = true;
      } else if (weaponKind === 'gamma') {
        dmg *= 1.15;
      } else if (weaponKind === 'emp') {
        dmg *= 1.5;
        crit = true;
      } else {
        dmg *= 0.35; // Strong-interaction mirror armor resists cold kinetic fire
      }
    }

    if (enemy.type === 'relay' && enemy.shield > 0 && weaponKind !== 'emp') {
      // Relay Barrier absorbs kinetic hits more strongly until shield pylons fall
      if (weaponKind === 'railgun' || weaponKind === 'wingman') dmg *= 0.8;
    } else if (enemy.type === 'relay' && enemy.shield <= 0) {
      dmg *= 1.65;
      crit = true;
    }

    if (enemy.shield > 0) {
      shielded = true;
      const mult = weaponKind === 'gamma' || weaponKind === 'emp' ? 1.55 : 0.7;
      const sDmg = Math.min(enemy.shield, dmg * mult);
      enemy.shield -= sDmg;
      if (enemy.shield === 0 && enemy.type === 'relay') {
        for (const node of enemy.shieldNodes) {
          this.vfx.spawnExplosion(node.getWorldPosition(new THREE.Vector3()), 2.6, '#5ce1ff');
          node.visible = false;
        }
      }
      const leftover = dmg - sDmg / mult;
      if (leftover > 0) enemy.hp -= leftover;
    } else {
      enemy.hp -= dmg;
    }

    enemy.hitFlashTimer = 0.12;
    const effective = initialTotal - enemy.shield - Math.max(0, enemy.hp);
    if (Object.hasOwn(this.stats.damageByWeapon, weaponKind)) this.stats.damageByWeapon[weaponKind] += effective;
    if (enemy.type === 'droplet' && enemy.hp > 0 && enemy.phase === 1 && enemy.hp / enemy.maxHp <= DROPLET_PHASE2_HP_RATIO) {
      enemy.phase = 2;
      enemy.vulnerableTimer = 0;
      if (enemy.telegraphLine) enemy.telegraphLine.material.opacity = 0;
      this._beginBlitz(enemy, true);
      this.audio.playDropletTelegraph?.();
      this.vfx.spawnEmpWave(enemy.mesh.position, 42, '#5ce1ff');
    }
    const fxPos = hitPos || enemy.mesh.position;
    if (this.onDamageDealt) {
      this.onDamageDealt(fxPos, Math.round(effective), shielded ? 'shield' : crit ? 'crit' : 'hull');
    }

    if (enemy.hp <= 0) {
      this._killEnemy(enemy);
      return { killed: true, crit: true, shielded };
    }
    return { killed: false, crit, shielded };
  }

  _killEnemy(enemy) {
    const pos = enemy.mesh.position.clone();
    const size =
      enemy.type === 'droplet'
        ? 'boss'
        : enemy.type === 'destroyer' || enemy.type === 'relay'
        ? 'capital'
        : enemy.type === 'gunship'
        ? 'medium'
        : 'small';

    const expCol = enemy.type === 'droplet' ? '#6be8ff' : enemy.type === 'relay' ? '#ff3860' : '#ff9842';
    if (size === 'boss' || size === 'capital') {
      this.vfx.spawnCapitalExplosion(pos, enemy.expRadius, expCol);
    } else {
      this.vfx.spawnExplosion(pos, enemy.expRadius, expCol);
    }
    const listener = this.listenerShip?.root;
    const offset = listener ? pos.clone().sub(listener.position) : null;
    const dist = offset?.length() || 0;
    const right = listener ? new THREE.Vector3(1, 0, 0).applyQuaternion(listener.quaternion) : null;
    const pan = dist > 0 && right ? THREE.MathUtils.clamp(offset.dot(right) / dist, -1, 1) : 0;
    this.audio.playExplosion(size, pan, 1 / (1 + dist / 450));

    // Drop magnetized pickup
    const lootBonus = this.upgradeSystem?.getLootDropBonus?.() || 0;
    if (enemy.type !== 'droplet' && (enemy.type !== 'drone' || Math.random() < Math.min(1, 0.45 + lootBonus))) {
      this._spawnPickup(pos, Math.random() < 0.55 ? 'hull' : 'shield');
    }

    this._removeEnemyMesh(enemy.mesh);
    const idx = this.enemies.indexOf(enemy);
    if (idx !== -1) this.enemies.splice(idx, 1);

    this.kills++;
    this.score += enemy.scoreValue;
    if (this.onEnemyKilled) this.onEnemyKilled(enemy);
    if (size === 'boss' || size === 'capital') this.onMajorKill?.(enemy);
  }

  _spawnPickup(pos, kind) {
    const col = kind === 'hull' ? '#3bff96' : '#3ce3ff';
    const mat = new THREE.MeshBasicMaterial({
      color: col,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(this._pickupGeo, mat);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.pickups.push({ mesh, kind, age: 0, life: 36 });
  }

  _spawnEnemyProjectile(origin, dir, speed, damage, colorHex = '#ff6a38', radius = 0.65) {
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this._projGeo, mat);
    mesh.position.copy(origin);
    mesh.scale.setScalar(radius * 1.4);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh,
      pos: origin.clone(),
      vel: dir.clone().normalize().multiplyScalar(speed),
      damage,
      age: 0,
      life: 4.0,
    });
  }

  clearProjectilesInRadius(center, radius) {
    const rSq = radius * radius;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (this.projectiles[i].pos.distanceToSquared(center) <= rSq) {
        this.vfx.spawnImpactSparks(this.projectiles[i].pos, '#4ee8ff', 2, 12);
        this.scene.remove(this.projectiles[i].mesh);
        this.projectiles[i].mesh.material.dispose();
        this.projectiles.splice(i, 1);
      }
    }
  }

  update(dt, time, ship, cameraRig, playMode) {
    const playerPos = ship.root.position;
    const isPlaying = playMode === 'PLAYING';

    this.listenerShip = ship;
    this.syncDeploymentAnchors?.();
    // Shield counters and chain kills can remove multiple enemies during a ram.
    for (const e of [...this.enemies]) {
      if (e.hp <= 0) continue;
      e.hitFlashTimer = Math.max(0, e.hitFlashTimer - dt);
      e.slowTimer = Math.max(0, e.slowTimer - dt);
      e.stunTimer = Math.max(0, e.stunTimer - dt);
      e.vulnTimer = Math.max(0, e.vulnTimer - dt);
      if (!e.vulnTimer) e.vulnMult = 1;
      for (const { material, color } of e.flashMats) {
        material.color.copy(color);
        if (e.slowTimer > 0) material.color.lerp(ICE_TINT, 0.42);
        if (e.hitFlashTimer > 0) material.color.lerp(FLASH_TINT, e.hitFlashTimer / 0.12);
      }
      if (e.engineHalo) e.engineHalo.material.opacity = 0.37 + Math.sin(time * 31 + e.id) * 0.12;
      if (e.expRadius >= 19 && e.hp / e.maxHp < 0.4) {
        e.smokeTimer -= dt;
        if (e.smokeTimer <= 0) {
          e.smokeTimer += 0.28;
          if (e.smokeTimer <= 0) e.smokeTimer = 0.28;
          if (e.mesh.position.distanceToSquared(playerPos) < 1800 ** 2) this.vfx.spawnDamagedSmoke?.(e.mesh.position);
        }
      }
      if (e.stunTimer > 0) continue;
      const motionDt = e.slowTimer > 0 ? dt * 0.55 : dt;
      const pos = e.mesh.position;
      toPlayer.subVectors(playerPos, pos);
      const dist = toPlayer.length();

      // Return stragglers to the encounter when the pilot leaves the engagement.
      if (dist > 1800 && e.deploymentHome && e.type !== 'relay') {
        const home = desiredVelocity.subVectors(e.deploymentHome, pos);
        const distance = home.length();
        if (distance > 1) pos.addScaledVector(home, Math.min(1, e.speed * 0.7 * dt / distance));
        e.vel.set(0, 0, 0);
      }
      if (dist > 1800) {
        if (e.type === 'relay') {
          e.mesh.rotation.y += dt * 0.4;
        }
        continue;
      }

      if (dist > 0.001) dirToPlayer.copy(toPlayer).divideScalar(dist);
      else dirToPlayer.set(0, 0, -1);

      if (e.type === 'relay') {
        e.mesh.rotation.y += dt * 0.35;
        e.shieldNodes.forEach((n, idx) => {
          const a = time * 1.15 + (idx / 3) * Math.PI * 2;
          n.position.set(Math.cos(a) * 14, Math.sin(time * 1.8 + idx) * 3.5, Math.sin(a) * 14);
          n.rotation.y += dt * 1.5;
          n.visible = e.shield > 0;
        });

        if (e.shield > 0 && isPlaying) {
          e.auraTimer -= dt;
          if (e.auraTimer <= 0) {
            e.auraTimer += 6;
            for (const ally of this.enemies) {
              if (ally === e || ally.hp <= 0 || ally.sectorId !== e.sectorId || ally.shield >= ally.maxShield ||
                  ally.mesh.position.distanceToSquared(pos) > 260 ** 2) continue;
              ally.shield = Math.min(ally.maxShield, ally.shield + 60);
              this.vfx.spawnArcLink?.(pos, ally.mesh.position, '#4ce8ff');
            }
          }
        }
        if (isPlaying && dist < 460) {
          e.fireTimer -= dt;
          if (e.fireTimer <= 0) {
            e.fireTimer = 2.1;
            const aim = aimDirection.copy(playerPos).addScaledVector(ship.velocity, dist / 420).sub(pos).normalize();
            shotOrigin.copy(pos).y += 5;
            this._spawnEnemyProjectile(shotOrigin, aim, 235, 34, '#ff2d55', 0.85);
          }
        }
        continue;
      }

      if (e.type === 'droplet') {
        this._updateDropletAI(e, motionDt, time, ship, dist, dirToPlayer, isPlaying, cameraRig);
        continue;
      }

      // Standard mobile units: drone, gunship, destroyer
      e.orbitAngle += e.orbitSign * dt * (e.type === 'drone' ? 0.95 : 0.42);
      const preferredDist = e.type === 'drone' ? 88 : e.type === 'gunship' ? 145 : 225;

      tangent.set(-dirToPlayer.z, 0.18 * Math.sin(e.orbitAngle * 1.7), dirToPlayer.x).normalize();
      const radialPush = THREE.MathUtils.clamp((dist - preferredDist) * 0.018, -1, 1);

      const desiredVel = desiredVelocity.copy(dirToPlayer).multiplyScalar(radialPush * e.speed)
        .addScaledVector(tangent, e.speed * (e.type === 'gunship' && e.telegraphTimer > 0 ? 0.25 : 0.85));

      e.vel.lerp(desiredVel, 1 - Math.exp(-3.4 * dt));
      pos.addScaledVector(e.vel, motionDt);

      // Face along velocity or toward player when firing
      const facePt = facePoint.addVectors(pos, e.vel);
      e.mesh.lookAt(facePt);
      e.mesh.rotateY(Math.PI); // since factory models face -Z

      if (!isPlaying) continue;

      // Weapon fire & Gunship laser telegraph
      if (e.type === 'gunship' && e.telegraphLine) {
        if (e.telegraphTimer > 0) {
          e.telegraphTimer -= dt;
          if (!e.telegraphAimLocked) {
            e.telegraphAim.copy(playerPos).addScaledVector(ship.velocity, dist / 360).sub(pos).normalize();
            if (e.telegraphAim.lengthSq() === 0) e.telegraphAim.copy(dirToPlayer);
            e.telegraphAimLocked = e.telegraphTimer <= 0.35;
          }
          e.mesh.lookAt(facePoint.addVectors(pos, e.telegraphAim));
          e.mesh.rotateY(Math.PI);
          e.telegraphLine.scale.set(0.7, 0.7, Math.max(1, Math.min(360, dist - 6.0)));
          e.telegraphLine.material.opacity = 0.36 + 0.26 * Math.sin(time * 28);
          if (e.telegraphTimer <= 0) {
            e.telegraphLine.material.opacity = 0;
            this._spawnEnemyProjectile(pos, e.telegraphAim, 360, 44, '#ff4522', 0.9);
            e.fireTimer = 3.2;
          }
        } else {
          e.telegraphLine.material.opacity = 0;
          e.fireTimer -= dt;
          if (e.fireTimer <= 0 && dist < 440) {
            e.telegraphAimLocked = false;
            e.telegraphTimer = 1.05; // Clear 1.05s telegraph sightline!
          }
        }
      } else {
        e.fireTimer -= dt;
        if (e.fireTimer <= 0 && dist < (e.type === 'destroyer' ? 540 : 380)) {
          e.fireTimer = e.type === 'destroyer' ? 1.55 : 1.75 + Math.random() * 0.9;
          const pSpeed = e.type === 'destroyer' ? 275 : 230;
          const aim = aimDirection.copy(playerPos).addScaledVector(ship.velocity, (dist / pSpeed) * 0.65).sub(pos).normalize();
          const dmg = e.type === 'destroyer' ? 38 : 22;
          if (e.type === 'destroyer' && ++e.volleyCount % 2 === 0) {
            right.set(1, 0, 0).applyQuaternion(e.mesh.quaternion);
            for (const side of [-1, 1]) {
              this._spawnEnemyProjectile(shotOrigin.copy(pos).addScaledVector(right, side * 2.8), aim, pSpeed, dmg, '#ff3a52', 1.2);
            }
          } else {
            this._spawnEnemyProjectile(pos, aim, pSpeed, dmg, e.type === 'destroyer' ? '#ff3a52' : '#ffaa38', e.type === 'destroyer' ? 1.0 : 0.6);
          }
        }
      }
    }

    // Update enemy projectiles vs Natural Selection
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.scene.remove(p.mesh);
        p.mesh.material.dispose();
        this.projectiles.splice(i, 1);
        continue;
      }

      previousPosition.copy(p.pos);
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);

      const hit = isPlaying && ship.hull > 0 && this._relativeSweep(previousPosition, p.pos, ship, 4.8);
      if (hit) {
        if (ship.isInvulnerable) {
          this._perfectDodge(ship, p);
          this.scene.remove(p.mesh);
          p.mesh.material.dispose();
          this.projectiles.splice(i, 1);
          continue;
        }
        const point = impactPoint.lerpVectors(previousPosition, p.pos, hit.t);
        const source = this._incomingPoint(ship, hit.point, p.vel, 4.8);
        const res = ship.takeDamage(p.damage, source);
        if (res.shielded) this.audio.playShieldImpact();
        this.vfx.spawnImpactSparks(point, res.shielded ? '#56e2ff' : '#ff6038', 7, 28, false);
        cameraRig.addShake(res.hullDamaged ? 0.32 : 0.16);
        this.onPlayerHit?.(p.damage, source);

        this.scene.remove(p.mesh);
        p.mesh.material.dispose();
        this.projectiles.splice(i, 1);
      }
    }

    // Magnetized Pickups
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.age += dt;
      pk.mesh.rotation.y += dt * 2.4;
      pk.mesh.rotation.x += dt * 1.4;

      const d = pk.mesh.position.distanceTo(playerPos);
      if (d < 85 && isPlaying && ship.hull > 0) {
        const pull = pickupPull.subVectors(playerPos, pk.mesh.position).normalize();
        pk.mesh.position.addScaledVector(pull, (95 - d) * 1.9 * dt);
      }

      if (d < 7.5 && isPlaying && ship.hull > 0) {
        if (pk.kind === 'hull') {
          ship.healHull(180);
        } else {
          ship.rechargeShield(220);
        }
        this.audio.playHitmarker('kill');
        this.vfx.spawnImpactSparks(playerPos, pk.kind === 'hull' ? '#3bff96' : '#3ce3ff', 10, 26);
        this.scene.remove(pk.mesh);
        pk.mesh.material.dispose();
        this.pickups.splice(i, 1);
        continue;
      }

      if (pk.age >= pk.life) {
        this.scene.remove(pk.mesh);
        pk.mesh.material.dispose();
        this.pickups.splice(i, 1);
      }
    }
  }

  _relativeSweep(start, end, ship, radius) {
    relativeStart.subVectors(start, ship.prevPosition || ship.root.position);
    relativeEnd.subVectors(end, ship.root.position);
    return segmentSphereEntryT(relativeStart, relativeEnd, relativeOrigin, radius, sweepResult);
  }

  _incomingPoint(ship, contact, velocity, radius) {
    incomingPoint.copy(contact);
    if (incomingPoint.lengthSq() < 1e-6) incomingPoint.copy(velocity).negate().normalize().multiplyScalar(radius);
    return incomingPoint.add(ship.root.position);
  }

  _perfectDodge(ship, attack) {
    if (attack.perfectDodgeConsumed) return;
    attack.perfectDodgeConsumed = true;
    if (ship.triggerPerfectDodge?.()) this.stats.perfectDodges++;
  }

  _beginBlitz(e, first = false) {
    e.state = 'RICOCHET_BLITZ';
    e.stateTimer = 0;
    e.blitzLeft = 3;
    e.trailTimer = 0;
    if (!first) this.audio.playDropletTelegraph?.();
  }

  _ventDroplet(e, duration) {
    e.state = 'VENT';
    e.stateTimer = duration;
    e.vulnerableTimer = Math.max(e.vulnerableTimer, duration);
    this.audio.playDropletVent?.();
    this.vfx.spawnDropletVentSteam?.(e.mesh.position);
  }

  _updateDropletAI(e, dt, time, ship, dist, dirToPlayer, isPlaying, cameraRig) {
    const pos = e.mesh.position;
    const playerPos = ship.root.position;

    if (e.vulnerableTimer > 0) {
      e.vulnerableTimer = Math.max(0, e.vulnerableTimer - dt);
      if (e.mirrorMat) {
        e.mirrorMat.emissive.set('#ff8822');
        e.mirrorMat.emissiveIntensity = 1.4 + 0.8 * Math.sin(time * 24);
      }
    } else if (e.mirrorMat) {
      e.mirrorMat.emissive.set('#000000');
      e.mirrorMat.emissiveIntensity = 0;
    }

    if (e.tailHalo) {
      const pulse = 1.0 + 0.25 * Math.sin(time * 18);
      e.tailHalo.scale.setScalar(pulse);
    }

    e.stateTimer -= dt;

    if (e.state === 'RICOCHET_BLITZ') {
      if (e.stateTimer <= 0 && e.blitzLeft > 0) {
        const lateral = tangent.set(-dirToPlayer.z, 0.24 * e.blitzLeft, dirToPlayer.x).normalize();
        e.vel.copy(dirToPlayer).multiplyScalar(0.42)
          .addScaledVector(lateral, e.blitzLeft % 2 ? 1 : -1).normalize().multiplyScalar(e.speed * 1.45);
        e.blitzLeft--;
        e.stateTimer += 0.48;
      } else if (e.stateTimer <= 0) {
        e.state = 'TELEGRAPH_RAM';
        e.stateTimer = 0.95;
        this.audio.playDropletTelegraph?.();
        for (let i = 0; i < 6; i++) {
          const angle = i * Math.PI / 3;
          this._spawnEnemyProjectile(pos, aimDirection.set(Math.cos(angle), 0, Math.sin(angle)), 295, 30, '#4ee8ff');
        }
        return;
      }
      pos.addScaledVector(e.vel, dt);
      e.mesh.lookAt(facePoint.addVectors(pos, e.vel));
      e.mesh.rotateY(Math.PI);
      e.trailTimer += dt;
      if (e.trailTimer >= 0.05) {
        e.trailTimer -= 0.05;
        this.vfx.spawnDropletTrail?.(pos, true);
      }
    } else if (e.state === 'ENGAGE') {
      // Signature sudden acute-angle sharp turns!
      if (e.stateTimer <= 0) {
        randomAxis.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.6, Math.random() - 0.5).normalize();
        const turnDir = desiredVelocity.crossVectors(dirToPlayer, randomAxis).normalize().addScaledVector(dirToPlayer, 0.35).normalize();
        e.vel.copy(turnDir).multiplyScalar(e.speed);
        e.stateTimer = 1.15 + Math.random() * 0.9;
        this.vfx.spawnImpactSparks(pos, '#5ce1ff', 8, 32);

        if (dist > 340) {
          e.vel.copy(dirToPlayer).multiplyScalar(e.speed);
        } else if (isPlaying && Math.random() < 0.42 && e.vulnerableTimer <= 0) {
          e.state = 'TELEGRAPH_RAM';
          e.stateTimer = 1.25;
          this.audio.playDropletTelegraph?.();
        }
      }

      pos.addScaledVector(e.vel, dt);
      e.mesh.lookAt(facePoint.addVectors(pos, e.vel));
      e.mesh.rotateY(Math.PI);

      // Periodic thermal plasma bursts
      e.fireTimer -= dt;
      if (isPlaying && e.fireTimer <= 0 && dist < 520) {
        e.fireTimer = 1.45;
        const aim = aimDirection.copy(playerPos).addScaledVector(ship.velocity, dist / 340).sub(pos).normalize();
        this._spawnEnemyProjectile(pos, aim, 340, 32, '#4ee8ff', 0.8);
      }
      if (e.telegraphLine) e.telegraphLine.material.opacity = 0;
    } else if (e.state === 'TELEGRAPH_RAM') {
      // Hover and aim crimson lock beam before hyper-velocity ram lunge
      e.vel.multiplyScalar(Math.exp(-5 * dt));
      pos.addScaledVector(e.vel, dt);
      e.mesh.lookAt(playerPos);
      e.mesh.rotateY(Math.PI);

      if (e.telegraphLine) {
        e.telegraphLine.scale.set(0.85, 0.85, Math.max(1, Math.min(480, dist - 6.0)));
        e.telegraphLine.material.opacity = 0.45 + 0.4 * Math.sin(time * 32);
      }
      if (e.stateTimer <= 0) {
        e.state = 'RAM_LUNGE';
        e.perfectDodgeConsumed = false;
        e.stateTimer = 0.85;
        e.vel.copy(dirToPlayer).multiplyScalar(430);
        if (e.telegraphLine) e.telegraphLine.material.opacity = 0;
      }
    } else if (e.state === 'RAM_LUNGE') {
      previousPosition.copy(pos);
      pos.addScaledVector(e.vel, dt);
      e.mesh.lookAt(facePoint.addVectors(pos, e.vel));
      e.mesh.rotateY(Math.PI);

      const hit = isPlaying && ship.hull > 0 && this._relativeSweep(previousPosition, pos, ship, 10.5);
      if (hit) {
        if (ship.isInvulnerable) {
          this._perfectDodge(ship, e);
          this._ventDroplet(e, 4.4);
          return;
        }
        const point = impactPoint.lerpVectors(previousPosition, pos, hit.t);
        const source = this._incomingPoint(ship, hit.point, e.vel, 10.5);
        const res = ship.takeDamage(195, source);
        if (res.shielded) this.audio.playShieldImpact();
        this.vfx.spawnExplosion(point, 10, '#66e8ff');
        cameraRig.addShake(0.85);
        this.onPlayerHit?.(195, source);
        if (e.hp <= 0 || e.state !== 'RAM_LUNGE') return;
        this._ventDroplet(e, 4.2);
        e.vel.multiplyScalar(-0.2);
      } else if (e.stateTimer <= 0) {
        // Missed lunge -> Thermal Vent vulnerability window!
        this._ventDroplet(e, 4.4);
      }
    } else if (e.state === 'VENT') {
      e.vel.multiplyScalar(Math.exp(-4 * dt));
      pos.addScaledVector(e.vel, dt);
      e.mesh.lookAt(playerPos);
      e.mesh.rotateY(Math.PI);
      if (e.stateTimer <= 0) {
        if (e.phase === 2) this._beginBlitz(e);
        else {
          e.state = 'ENGAGE';
          e.stateTimer = 0.4;
        }
      }
    }
  }
}
