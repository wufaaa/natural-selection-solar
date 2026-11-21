import * as THREE from 'three';

const SHARED_MATS = {
  obsidian: new THREE.MeshStandardMaterial({
    color: '#1b2029',
    metalness: 0.85,
    roughness: 0.34,
  }),
  gunmetal: new THREE.MeshStandardMaterial({
    color: '#343e4f',
    metalness: 0.82,
    roughness: 0.32,
  }),
  crimsonGlow: new THREE.MeshStandardMaterial({
    color: '#d9384a',
    emissive: new THREE.Color('#d9243c'),
    emissiveIntensity: 1.55,
  }),
  amberGlow: new THREE.MeshStandardMaterial({
    color: '#e5a440',
    emissive: new THREE.Color('#df7e24'),
    emissiveIntensity: 1.45,
  }),
  cyanCore: new THREE.MeshStandardMaterial({
    color: '#5ec8e6',
    emissive: new THREE.Color('#2ba4d4'),
    emissiveIntensity: 1.5,
  }),
};

export function createEnemyMesh(type) {
  const built = buildEnemyMesh(type);
  const materials = new Map();
  const sharedMaterials = new Set(Object.values(SHARED_MATS));
  built.group.traverse((child) => {
    const original = child.material;
    if (!original?.isMeshStandardMaterial && !original?.isMeshPhysicalMaterial) return;
    if (!materials.has(original)) {
      const local = sharedMaterials.has(original) ? original.clone() : original;
      materials.set(original, { material: local, color: local.color.clone() });
    }
    child.material = materials.get(original).material;
  });
  built.flashMats = [...materials.values()];
  if (type === 'drone' || type === 'gunship' || type === 'destroyer') {
    const size = type === 'destroyer' ? 1.6 : type === 'gunship' ? 0.85 : 0.45;
    const tail = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6),
      new THREE.MeshBasicMaterial({ color: '#ff7350', transparent: true, opacity: 0.42,
        blending: THREE.AdditiveBlending, depthWrite: false }));
    tail.position.z = type === 'destroyer' ? 10 : type === 'gunship' ? 4.8 : 2.9;
    tail.scale.z = 2.6;
    built.group.add(tail);
    built.engineHalo = tail;
  }
  return built;
}

function buildEnemyMesh(type) {
  const group = new THREE.Group();

  if (type === 'drone') {
    // Sleek delta-wing autonomous hunter ("Gull" analog)
    const body = new THREE.Mesh(new THREE.ConeGeometry(1.4, 4.4, 4), SHARED_MATS.obsidian);
    body.rotation.x = -Math.PI * 0.5;
    body.scale.set(1.35, 1.0, 0.48);
    group.add(body);

    const wingL = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.14, 1.5), SHARED_MATS.gunmetal);
    wingL.position.set(-1.6, 0, 0.5);
    wingL.rotation.y = 0.45;
    group.add(wingL);

    const wingR = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.14, 1.5), SHARED_MATS.gunmetal);
    wingR.position.set(1.6, 0, 0.5);
    wingR.rotation.y = -0.45;
    group.add(wingR);

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), SHARED_MATS.crimsonGlow);
    eye.position.set(0, 0.12, -1.65);
    group.add(eye);

    const thruster = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.22, 0.7, 10), SHARED_MATS.amberGlow);
    thruster.rotation.x = Math.PI * 0.5;
    thruster.position.set(0, 0, 2.25);
    group.add(thruster);

    return { group, hitRadius: 3.0, telegraphLine: null, shieldNodes: [] };
  }

  if (type === 'gunship') {
    // Armored twin-hull rail corvette ("Hound" analog)
    const spine = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.6, 7.2), SHARED_MATS.obsidian);
    group.add(spine);

    for (const s of [-1, 1]) {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.9, 6.4), SHARED_MATS.gunmetal);
      pod.position.set(s * 2.5, 0, -0.4);
      group.add(pod);

      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 3.2, 8), SHARED_MATS.amberGlow);
      rail.rotation.x = Math.PI * 0.5;
      rail.position.set(s * 2.5, 0, -4.2);
      group.add(rail);
    }

    const bridge = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.85, 2.1), SHARED_MATS.crimsonGlow);
    bridge.position.set(0, 1.05, -1.2);
    group.add(bridge);

    // Visible crimson telegraph laser sightline before burst fire
    const lineGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.0, 6);
    lineGeo.rotateX(Math.PI * 0.5);
    lineGeo.translate(0, 0, -0.5);
    const lineMat = new THREE.MeshBasicMaterial({
      color: '#ff2b4a',
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const telegraphLine = new THREE.Mesh(lineGeo, lineMat);
    telegraphLine.position.set(0, 0, -3.5);
    group.add(telegraphLine);

    return { group, hitRadius: 4.8, telegraphLine, shieldNodes: [] };
  }

  if (type === 'destroyer') {
    // Tri-Solaris Escort Destroyer
    const hull = new THREE.Mesh(new THREE.BoxGeometry(4.6, 3.2, 18.0), SHARED_MATS.obsidian);
    group.add(hull);

    const prow = new THREE.Mesh(new THREE.ConeGeometry(3.2, 7.5, 4), SHARED_MATS.gunmetal);
    prow.rotation.x = -Math.PI * 0.5;
    prow.rotation.z = Math.PI * 0.25;
    prow.position.set(0, 0, -12.6);
    group.add(prow);

    const coreStrip = new THREE.Mesh(new THREE.BoxGeometry(1.1, 3.6, 13.5), SHARED_MATS.crimsonGlow);
    coreStrip.position.set(0, 0.2, -1.0);
    group.add(coreStrip);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.8, 0.45, 6, 18), SHARED_MATS.gunmetal);
    ring.position.set(0, 0, 2.5);
    group.add(ring);

    const thruster = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 1.4, 2.2, 12), SHARED_MATS.amberGlow);
    thruster.rotation.x = Math.PI * 0.5;
    thruster.position.set(0, 0, 9.6);
    group.add(thruster);

    // Human-scale radiator fins & bridge antenna masts for silhouette authority
    for (const s of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.4, 5.2), SHARED_MATS.gunmetal);
      fin.position.set(s * 2.9, 1.2, 1.2);
      fin.rotation.z = -s * 0.32;
      group.add(fin);
    }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 4.4, 6), SHARED_MATS.gunmetal);
    mast.position.set(0, 3.1, -3.5);
    group.add(mast);

    return { group, hitRadius: 10.5, telegraphLine: null, shieldNodes: [] };
  }

  if (type === 'relay') {
    // Towering Sophon Uplink Relay spire with dark exoskeleton collars & restrained tactical beam
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 4.4, 26, 6), SHARED_MATS.obsidian);
    group.add(spire);

    const waistRing = new THREE.Mesh(new THREE.TorusGeometry(5.6, 0.45, 6, 18), SHARED_MATS.gunmetal);
    waistRing.rotation.x = Math.PI * 0.5;
    waistRing.position.y = -2.5;
    group.add(waistRing);

    const core = new THREE.Mesh(new THREE.OctahedronGeometry(2.8, 0), SHARED_MATS.crimsonGlow);
    core.position.y = 4.5;
    group.add(core);

    // Slender subtle quantum uplink beacon filament (does not slice planetary foreground like a solid bar)
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.55, 175, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: '#e83858',
        transparent: true,
        opacity: 0.17,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    beam.position.y = 95;
    group.add(beam);

    // 3 armored exoskeleton emitter satellites (avoids blurry unframed bloom squares)
    const shieldNodes = [];
    for (let i = 0; i < 3; i++) {
      const nodeWrap = new THREE.Group();
      const coreMesh = new THREE.Mesh(new THREE.OctahedronGeometry(1.15, 0), SHARED_MATS.cyanCore);
      const cage = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.22, 6, 12), SHARED_MATS.gunmetal);
      cage.rotation.x = Math.PI * 0.35;
      nodeWrap.add(coreMesh);
      nodeWrap.add(cage);
      const a = (i / 3) * Math.PI * 2;
      nodeWrap.position.set(Math.cos(a) * 14, (i - 1) * 4, Math.sin(a) * 14);
      group.add(nodeWrap);
      shieldNodes.push(nodeWrap);
    }

    return { group, hitRadius: 14.0, telegraphLine: null, shieldNodes, beam };
  }

  // BOSS: The Droplet (强互作用力探测器「水滴」)
  // Authentic smooth teardrop profile via LatheGeometry, facing -Z
  const points = [];
  const segs = 28;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs; // 0 blunt nose -> 1 sharp tail
    const y = (t - 0.35) * 9.5;
    let r;
    if (t < 0.28) {
      r = Math.sin((t / 0.28) * Math.PI * 0.5) * 2.15;
    } else {
      const k = (t - 0.28) / 0.72;
      r = 2.15 * Math.pow(1 - k, 1.55);
    }
    points.push(new THREE.Vector2(Math.max(0.001, r), y));
  }
  const dropletGeo = new THREE.LatheGeometry(points, 48);
  // Rotate so blunt nose faces -Z and sharp tail trails +Z
  dropletGeo.rotateX(Math.PI * 0.5);

  const mirrorMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    metalness: 1.0,
    roughness: 0.015,
    envMapIntensity: 2.6,
    emissive: new THREE.Color('#000000'),
    emissiveIntensity: 0,
  });
  const dropletBody = new THREE.Mesh(dropletGeo, mirrorMat);
  group.add(dropletBody);

  // Signature blazing Cherenkov-blue plasma propulsion ring at tail
  const haloMat = new THREE.MeshBasicMaterial({
    color: '#5ce1ff',
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const tailHalo = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.22, 12, 32), haloMat);
  tailHalo.position.set(0, 0, 5.8);
  group.add(tailHalo);

  // Ramming charge sightline
  const ramLineGeo = new THREE.CylinderGeometry(0.18, 0.18, 1.0, 8);
  ramLineGeo.rotateX(Math.PI * 0.5);
  ramLineGeo.translate(0, 0, -0.5);
  const ramLineMat = new THREE.MeshBasicMaterial({
    color: '#ff2040',
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const telegraphLine = new THREE.Mesh(ramLineGeo, ramLineMat);
  telegraphLine.position.set(0, 0, -3.5);
  group.add(telegraphLine);

  return {
    group,
    hitRadius: 5.4,
    telegraphLine,
    shieldNodes: [],
    mirrorMat,
    tailHalo,
  };
}
