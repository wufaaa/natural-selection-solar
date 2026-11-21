import * as THREE from 'three';

export class Landmarks {
  constructor(scene) {
    this.scene = scene;
    this.animated = [];
    this._tmpBodyPos = new THREE.Vector3();
    this.earthDock = this._createEarthOrbitalDock();
    this.marsArray = this._createMarsArray();
    this.jupiterGraveyard = this._createJupiterGraveyard();
    this.mercurySentinel = this._createMercurySentinel();
    this.saturnStation = this._createSaturnIceStation();
    this.neptuneBeacon = this._createNeptuneLighthouse();

    this.scene.add(this.earthDock);
    this.scene.add(this.marsArray);
    this.scene.add(this.jupiterGraveyard);
    this.scene.add(this.mercurySentinel);
    this.scene.add(this.saturnStation);
    this.scene.add(this.neptuneBeacon);
  }

  _createEarthOrbitalDock() {
    const group = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({
      color: '#46586e',
      metalness: 0.85,
      roughness: 0.34,
    });
    const darkFrame = new THREE.MeshStandardMaterial({
      color: '#1b2432',
      metalness: 0.78,
      roughness: 0.42,
    });
    const cyanGlow = new THREE.MeshStandardMaterial({
      color: '#5ec8e6',
      emissive: new THREE.Color('#2ba4d4'),
      emissiveIntensity: 1.3,
    });
    const amberGlow = new THREE.MeshStandardMaterial({
      color: '#e5a440',
      emissive: new THREE.Color('#df7e24'),
      emissiveIntensity: 1.2,
    });

    // Outer hexagonal shipyard ring
    const ring = new THREE.Mesh(new THREE.TorusGeometry(28, 1.15, 8, 24), steel);
    ring.rotation.x = Math.PI * 0.5;
    group.add(ring);

    const innerRing = new THREE.Mesh(new THREE.TorusGeometry(22, 0.55, 6, 24), darkFrame);
    innerRing.rotation.x = Math.PI * 0.5;
    group.add(innerRing);

    // 4 sleek docking pylons + guide beacons
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(1.5, 5.6, 2.8), darkFrame);
      pylon.position.set(Math.cos(a) * 28, 0, Math.sin(a) * 28);
      pylon.rotation.y = -a;
      group.add(pylon);

      const arm = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.45, 0.7), steel);
      arm.position.set(Math.cos(a) * 24, 0, Math.sin(a) * 24);
      arm.rotation.y = -a;
      group.add(arm);

      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), i % 2 === 0 ? cyanGlow : amberGlow);
      beacon.position.set(Math.cos(a) * 25.8, 3.1, Math.sin(a) * 25.8);
      group.add(beacon);
    }

    // Central orbital spine mast
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 34, 12), steel);
    group.add(mast);

    const coreBeacon = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 4.0, 12), cyanGlow);
    coreBeacon.position.y = 14;
    group.add(coreBeacon);

    // Space Elevator Orbital Guide Tether Beam extending toward Earth's surface
    const tetherMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
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
        varying vec2 vUv;
        void main() {
          float fade = sin(vUv.y * 3.14159265);
          float bands = 0.55 + 0.45 * sin(vUv.y * 56.0);
          gl_FragColor = vec4(vec3(0.32, 0.72, 0.92), fade * bands * 0.09);
          #include <logdepthbuf_fragment>
        }
      `,
    });
    const tether = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.34, 96, 10, 1, true), tetherMat);
    tether.rotation.x = Math.PI * 0.5;
    tether.position.z = -52;
    group.add(tether);

    this.animated.push({ obj: group, spinY: 0.08 });
    return group;
  }

  _createMarsArray() {
    const group = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({
      color: '#5c4c48',
      metalness: 0.8,
      roughness: 0.38,
    });
    const solar = new THREE.MeshStandardMaterial({
      color: '#1b355c',
      metalness: 0.72,
      roughness: 0.25,
    });
    const redBeacon = new THREE.MeshStandardMaterial({
      color: '#ff5238',
      emissive: new THREE.Color('#ff3218'),
      emissiveIntensity: 2.8,
    });

    const hub = new THREE.Mesh(new THREE.OctahedronGeometry(5.5, 0), metal);
    group.add(hub);

    const dish = new THREE.Mesh(new THREE.ConeGeometry(8.5, 3.8, 16, 1, true), metal);
    dish.position.y = 6.5;
    dish.rotation.x = Math.PI;
    group.add(dish);

    const scanMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
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
        varying vec2 vUv;
        void main() {
          float fade = (1.0 - vUv.y) * 0.22;
          float wave = 0.65 + 0.35 * sin(vUv.x * 18.8495);
          gl_FragColor = vec4(vec3(1.0, 0.38, 0.22), fade * wave);
          #include <logdepthbuf_fragment>
        }
      `,
    });
    const scanCone = new THREE.Mesh(new THREE.ConeGeometry(28, 52, 20, 1, true), scanMat);
    scanCone.position.y = 32;
    scanCone.rotation.x = Math.PI;
    group.add(scanCone);

    for (let s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(16, 0.25, 4.5), solar);
      wing.position.set(s * 12.5, 0, 0);
      group.add(wing);

      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 8), redBeacon);
      lamp.position.set(s * 20.6, 0.4, 0);
      group.add(lamp);
    }

    this.animated.push({ obj: group, spinY: -0.14 });
    return group;
  }

  _createJupiterGraveyard() {
    const group = new THREE.Group();
    const burntArmor = new THREE.MeshStandardMaterial({
      color: '#2a3038',
      metalness: 0.75,
      roughness: 0.58,
    });
    const emberGlow = new THREE.MeshStandardMaterial({
      color: '#ff4422',
      emissive: new THREE.Color('#ff2608'),
      emissiveIntensity: 2.4,
    });

    const hullGeo = new THREE.BoxGeometry(1.0, 1.0, 1.0);
    const prowGeo = new THREE.ConeGeometry(0.9, 2.2, 6);
    prowGeo.rotateX(-Math.PI * 0.5);

    for (let i = 0; i < 14; i++) {
      const wreck = new THREE.Group();
      const angle = (i / 14) * Math.PI * 2 + (i % 3) * 0.2;
      const dist = 365 + (i % 4) * 55;
      wreck.position.set(
        Math.cos(angle) * dist,
        ((i % 5) - 2) * 38,
        Math.sin(angle) * dist
      );
      wreck.rotation.set(i * 0.7, i * 1.1, i * 0.4);

      const len = 8 + (i % 4) * 4.5;
      const body = new THREE.Mesh(hullGeo, burntArmor);
      body.scale.set(2.2, 1.8, len);
      wreck.add(body);

      if (i % 2 === 0) {
        const nose = new THREE.Mesh(prowGeo, burntArmor);
        nose.scale.set(1.3, 1.1, 2.5);
        nose.position.z = -len * 0.5 - 1.5;
        wreck.add(nose);
      }

      const distress = new THREE.Mesh(new THREE.SphereGeometry(0.45, 6, 6), emberGlow);
      distress.position.set(0, 1.2, 0);
      wreck.add(distress);

      group.add(wreck);
      this.animated.push({
        obj: wreck,
        spinY: 0.04 * ((i % 2) * 2 - 1),
        spinX: 0.025,
      });
    }
    return group;
  }

  _createMercurySentinel() {
    const group = new THREE.Group();
    const goldShield = new THREE.MeshStandardMaterial({
      color: '#c89b44',
      metalness: 0.92,
      roughness: 0.24,
    });
    const darkObsidian = new THREE.MeshStandardMaterial({
      color: '#1b2028',
      metalness: 0.85,
      roughness: 0.38,
    });
    const irGlow = new THREE.MeshStandardMaterial({
      color: '#ffaa38',
      emissive: new THREE.Color('#ff6a14'),
      emissiveIntensity: 3.0,
    });

    const core = new THREE.Mesh(new THREE.OctahedronGeometry(4.2, 0), darkObsidian);
    group.add(core);
    const shieldDisk = new THREE.Mesh(new THREE.CylinderGeometry(11.5, 13.0, 0.9, 6), goldShield);
    shieldDisk.rotation.x = Math.PI * 0.5;
    shieldDisk.position.z = -5.5;
    group.add(shieldDisk);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(9.2, 0.45, 6, 18), irGlow);
    group.add(ring);

    this.animated.push({ obj: ring, spinY: 0.32, spinX: 0.18 });
    return group;
  }

  _createSaturnIceStation() {
    const group = new THREE.Group();
    const cryoMetal = new THREE.MeshStandardMaterial({
      color: '#7aa0c4',
      metalness: 0.85,
      roughness: 0.28,
    });
    const iceGlow = new THREE.MeshStandardMaterial({
      color: '#7ef2ff',
      emissive: new THREE.Color('#32c8ff'),
      emissiveIntensity: 2.8,
    });

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 26, 8), cryoMetal);
    group.add(mast);

    const ringA = new THREE.Mesh(new THREE.TorusGeometry(13.5, 0.65, 8, 24), cryoMetal);
    ringA.rotation.x = Math.PI * 0.5;
    group.add(ringA);

    const ringB = new THREE.Mesh(new THREE.TorusGeometry(9.2, 0.35, 6, 20), iceGlow);
    ringB.rotation.x = Math.PI * 0.35;
    group.add(ringB);

    this.animated.push({ obj: ringA, spinZ: 0.14 });
    this.animated.push({ obj: ringB, spinY: -0.45 });
    return group;
  }

  _createNeptuneLighthouse() {
    const group = new THREE.Group();
    const alloy = new THREE.MeshStandardMaterial({
      color: '#2d3f58',
      metalness: 0.88,
      roughness: 0.3,
    });
    const deepBlueGlow = new THREE.MeshStandardMaterial({
      color: '#52b8ff',
      emissive: new THREE.Color('#1a7aff'),
      emissiveIntensity: 3.4,
    });

    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 3.0, 38, 6), alloy);
    group.add(spire);

    const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(3.4, 0), deepBlueGlow);
    beacon.position.y = 21;
    group.add(beacon);

    const halo = new THREE.Mesh(new THREE.TorusGeometry(6.5, 0.3, 6, 24), deepBlueGlow);
    halo.position.y = 21;
    halo.rotation.x = Math.PI * 0.5;
    group.add(halo);

    this.animated.push({ obj: beacon, spinY: 0.65 });
    this.animated.push({ obj: halo, spinX: 0.24, spinY: 0.18 });
    return group;
  }

  update(dt, solarSystem) {
    const bodyPos = this._tmpBodyPos;
    if (solarSystem.getBodyWorldPosition('earth', bodyPos)) {
      this.earthDock.position.set(bodyPos.x - 148, bodyPos.y + 26, bodyPos.z + 112);
      this.earthDock.lookAt(bodyPos);
    }

    if (solarSystem.getBodyWorldPosition('mars', bodyPos)) {
      this.marsArray.position.set(bodyPos.x + 118, bodyPos.y + 34, bodyPos.z + 82);
    }

    if (solarSystem.getBodyWorldPosition('jupiter', bodyPos)) {
      this.jupiterGraveyard.position.copy(bodyPos);
    }

    if (solarSystem.getBodyWorldPosition('mercury', bodyPos)) {
      this.mercurySentinel.position.set(bodyPos.x + 86, bodyPos.y + 24, bodyPos.z + 64);
      this.mercurySentinel.lookAt(0, 0, 0);
    }

    if (solarSystem.getBodyWorldPosition('saturn', bodyPos)) {
      this.saturnStation.position.set(bodyPos.x - 210, bodyPos.y + 115, bodyPos.z + 295);
    }

    if (solarSystem.getBodyWorldPosition('neptune', bodyPos)) {
      this.neptuneBeacon.position.set(bodyPos.x - 165, bodyPos.y + 42, bodyPos.z + 185);
    }

    for (const item of this.animated) {
      if (item.spinY) item.obj.rotation.y += item.spinY * dt;
      if (item.spinX) item.obj.rotation.x += item.spinX * dt;
      if (item.spinZ) item.obj.rotation.z += item.spinZ * dt;
    }
  }
}
