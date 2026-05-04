import "../style.css"
import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { gsap } from 'gsap'
import { Howl } from 'howler'

// Game Constants
const MATCH_DURATION = 90;
const CLASSIC_DURATION = 120;
const INITIAL_HOLE_SIZE = 2.0;

const GameMode = {
  SOLO: 'solo',
  CLASSIC: 'classic',
  BATTLE: 'battle'
} as const;

type GameMode = typeof GameMode[keyof typeof GameMode];

interface UserData {
  xp: number;
  level: number;
  coins: number;
  highScore: number;
  upgrades: {
    speed: number;
    size: number;
    suction: number;
  };
}

class Game {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private world!: RAPIER.World;
  private groundShader: any = null;

  // Game State
  private isPlaying: boolean = false;
  private currentGameMode: GameMode = GameMode.CLASSIC;
  private timeLeft: number = MATCH_DURATION;
  private currentLevel: number = 1;
  private score: number = 0;
  private levelTarget: number = 10000;
  private sizeTier: number = 1;
  private holeSize: number = INITIAL_HOLE_SIZE;
  private combo: number = 0;
  private comboTimeout: any = null;
  private timerInterval: any = null;

  // Solo mode
  private totalObjectsConsumed: number = 0;
  private totalObjectsInLevel: number = 0;
  private consumptionPercentage: number = 0;

  // Session coins (display only, resets per game)
  private sessionCoins: number = 0;

  // Refs
  private holeGroup!: THREE.Group;
  private holeMesh!: THREE.Mesh;
  private objects: { mesh: THREE.Mesh, body: RAPIER.RigidBody, mass: number, tier: number, id: number, consumed: boolean, parts?: THREE.Mesh[] }[] = [];
  private bots: { mesh: THREE.Group, score: number, size: number, tier: number, name: string, personality: string }[] = [];
  private traffic: { mesh: THREE.Mesh, body: RAPIER.RigidBody, speed: number, direction: THREE.Vector3 }[] = [];
  private holeLight!: THREE.PointLight;

  // Progression
  private userData: UserData = {
    xp: 0,
    level: 1,
    coins: 0,
    highScore: 0,
    upgrades: { speed: 1, size: 1, suction: 1 } // FIX: start at 1, not 0
  };

  // Fever Mode
  private feverMode: boolean = false;
  private feverScore: number = 0;
  private feverMax: number = 5000;

  // UI Refs
  private uiScore!: HTMLElement;
  private uiTimer!: HTMLElement;
  private uiGrowthBar!: HTMLElement;
  private uiSizeTier!: HTMLElement;
  private uiCoins!: HTMLElement;

  // Audio
  private sfx: { [key: string]: Howl } = {};
  private currentSkin: string = 'Basic';
  private currentMap: string = 'Bakery';

  constructor() {
    this.init();
  }

  async init() {
    const loadFill = document.getElementById('loading-fill');
    const loadHint = document.querySelector('.loading-hint') as HTMLElement;

    const setProgress = (pct: number, msg: string) => {
      if (loadFill) loadFill.style.width = `${pct}%`;
      if (loadHint) loadHint.innerText = msg;
    };

    setProgress(10, 'Initializing physics...');
    await RAPIER.init();

    setProgress(30, 'Building renderer...');
    this.setupThree();
    this.setupPhysics();
    this.setupLights();

    setProgress(60, 'Generating city...');
    this.setupEnvironment();

    setProgress(80, 'Setting up controls...');
    this.setupUI();
    this.setupControls();
    this.setupAudio();
    this.loadUserData();

    setProgress(100, 'Ready!');

    const loading = document.getElementById('loading-screen');
    if (loading) {
      await new Promise(r => setTimeout(r, 400));
      gsap.to(loading, {
        opacity: 0,
        duration: 0.8,
        onComplete: () => loading.classList.add('hidden')
      });
    }

    // Show main menu
    document.getElementById('main-menu')?.classList.remove('hidden');

    this.animate();
    (window as any).game = this;
    console.log('MEGA CITY HOLE.IO Ready');
  }

  private loadUserData() {
    const data = localStorage.getItem('holeio_userdata');
    if (data) {
      try {
        const parsed = JSON.parse(data);
        this.userData = {
          xp: parsed.xp ?? 0,
          level: parsed.level ?? 1,
          coins: parsed.coins ?? 0,
          highScore: parsed.highScore ?? 0,
          upgrades: {
            speed: parsed.upgrades?.speed ?? 1,
            size: parsed.upgrades?.size ?? 1,
            suction: parsed.upgrades?.suction ?? 1,
          }
        };
      } catch (e) {
        console.warn('Failed to parse user data, resetting.');
      }
    }
    this.updateUpgradeUI();
  }

  private saveUserData() {
    localStorage.setItem('holeio_userdata', JSON.stringify(this.userData));
  }

  private updateUpgradeUI() {
    const progress = (this.userData.xp % 5000) / 5000;
    const levelEl = document.getElementById('player-level');
    const xpEl = document.getElementById('xp-fill');
    if (levelEl) levelEl.innerText = this.userData.level.toString();
    if (xpEl) xpEl.style.width = `${progress * 100}%`;

    ['speed', 'size', 'suction'].forEach(id => {
      const level = (this.userData.upgrades as any)[id];
      const cost = level * 100;
      const el = document.getElementById(`upg-${id}`);
      if (el) {
        el.querySelector('.upg-val')!.innerHTML = `LVL ${level}<br><small style="color:#aaa;font-size:0.6rem">${cost}🪙</small>`;
      }
    });

    // Update persistent coin display in menu
    const coinsEl = document.getElementById('menu-coins');
    if (coinsEl) coinsEl.innerText = this.userData.coins.toString();
    const hsEl = document.getElementById('high-score-display');
    if (hsEl) hsEl.innerText = this.userData.highScore.toString();
  }

  private setupThree() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#FFD1DC');
    this.scene.fog = new THREE.Fog('#FFD1DC', 40, 120);

    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 400);
    this.camera.position.set(0, 18, 16);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    document.getElementById('canvas-container')?.appendChild(this.renderer.domElement);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  private setupPhysics() {
    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    this.world = new RAPIER.World(gravity);

    // Ground physics — match 70-unit city radius
    const groundBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(80, 0.1, 80), groundBody);

    // Boundary walls (invisible)
    const wallH = 12, wallR = 72;
    const wallPositions = [
      { x: 0, y: wallH/2, z: -wallR, hx: wallR, hy: wallH, hz: 0.5 },
      { x: 0, y: wallH/2, z:  wallR, hx: wallR, hy: wallH, hz: 0.5 },
      { x: -wallR, y: wallH/2, z: 0, hx: 0.5, hy: wallH, hz: wallR },
      { x:  wallR, y: wallH/2, z: 0, hx: 0.5, hy: wallH, hz: wallR },
    ];
    wallPositions.forEach(w => {
      const wb = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(w.x, w.y, w.z));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(w.hx, w.hy, w.hz), wb);
    });

    // Visual ground with hole shader
    const groundGeo = new THREE.PlaneGeometry(160, 160);
    const groundMat = new THREE.MeshStandardMaterial({ color: '#c8a887', roughness: 0.9, metalness: 0.0 });

    groundMat.onBeforeCompile = (shader) => {
      shader.uniforms.uHolePos = { value: new THREE.Vector3() };
      shader.uniforms.uHoleRadius = { value: INITIAL_HOLE_SIZE };

      shader.vertexShader = `
        varying vec3 vWorldPos;
        ${shader.vertexShader}
      `.replace(
        '#include <worldpos_vertex>',
        `
        #include <worldpos_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `
      );

      shader.fragmentShader = `
        uniform vec3 uHolePos;
        uniform float uHoleRadius;
        varying vec3 vWorldPos;
        ${shader.fragmentShader}
      `.replace(
        '#include <clipping_planes_fragment>',
        `
        #include <clipping_planes_fragment>
        float dist = distance(vWorldPos.xz, uHolePos.xz);
        if (dist < uHoleRadius) discard;

        // Tile grid
        vec2 gridUv = vWorldPos.xz * 0.25;
        float lines = step(0.97, fract(gridUv.x)) + step(0.97, fract(gridUv.y));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.55, 0.40, 0.30), lines * 0.5);

        // Deep glow rim around hole edge
        float edgeDist = dist - uHoleRadius;
        float rimGlow = exp(-edgeDist * 1.2) * 0.35;
        gl_FragColor.rgb += rimGlow * vec3(0.0, 0.8, 1.0);
        `
      );
      this.groundShader = shader;
    };

    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    this.scene.add(groundMesh);

    // ── Hole visuals ──────────────────────────────────────────
    this.holeGroup = new THREE.Group();
    this.holeGroup.position.set(0, 0, 0);

    // Dark cylinder walls (inner sides of the hole)
    const holeGeo = new THREE.CylinderGeometry(1, 0.85, 12, 32, 1, true);
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x050508, side: THREE.BackSide });
    this.holeMesh = new THREE.Mesh(holeGeo, holeMat);
    this.holeMesh.position.y = -6;
    this.holeGroup.add(this.holeMesh);

    // Black void floor (so nothing shows through bottom)
    const floorGeo = new THREE.CircleGeometry(0.95, 32);
    const floorMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const voidFloor = new THREE.Mesh(floorGeo, floorMat);
    voidFloor.rotation.x = Math.PI / 2;
    voidFloor.position.y = -11.9;
    this.holeGroup.add(voidFloor);

    // Neon rim at ground level
    const rimGeo = new THREE.RingGeometry(0.96, 1.18, 64);
    const rimMat = new THREE.MeshBasicMaterial({ color: 0x00f2ff, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.015;
    this.holeGroup.add(rim);

    // Inner glow ring
    const innerRimGeo = new THREE.RingGeometry(0.78, 0.96, 64);
    const innerRimMat = new THREE.MeshBasicMaterial({ color: 0x003344, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    const innerRim = new THREE.Mesh(innerRimGeo, innerRimMat);
    innerRim.rotation.x = -Math.PI / 2;
    innerRim.position.y = 0.01;
    this.holeGroup.add(innerRim);

    this.scene.add(this.holeGroup);

    // Atmosphere light
    this.holeLight = new THREE.PointLight(0x00f2ff, 2.5, 14);
    this.scene.add(this.holeLight);
  }

  private setupLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(50, 100, 50);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.left = -120;
    sun.shadow.camera.right = 120;
    sun.shadow.camera.top = 120;
    sun.shadow.camera.bottom = -120;
    sun.shadow.bias = -0.0001;
    this.scene.add(sun);

    this.scene.add(new THREE.HemisphereLight(0xffd1dc, 0x664444, 0.6));
  }

  private setupEnvironment() {
    this.generateLevel();
    this.countTotalObjects();
    this.createBots();
  }

  private cleanupLevel() {
    // FIX: properly remove all meshes AND physics bodies, clear array
    this.objects.forEach(obj => {
      this.scene.remove(obj.mesh);
      if (obj.parts) obj.parts.forEach(p => this.scene.remove(p));
      try { this.world.removeRigidBody(obj.body); } catch (_) { }
    });
    this.objects = [];

    this.traffic.forEach(t => {
      this.scene.remove(t.mesh);
      try { this.world.removeRigidBody(t.body); } catch (_) { }
    });
    this.traffic = [];
  }

  private generateLevel() {
    this.cleanupLevel();

    // Tighter spread so objects fill visible area
    const spread = 65 + this.currentLevel * 3;
    const lvlMult = 1 + (this.currentLevel - 1) * 0.15;

    const tiers = [
      { type: 'cookie',  count: Math.floor(100 * lvlMult), sz: [1.2, 0.4, 1.2] as [number,number,number], mass: 100,  tierIdx: 1 },
      { type: 'macaron', count: Math.floor(60  * lvlMult), sz: [1.5, 1.0, 1.5] as [number,number,number], mass: 300,  tierIdx: 2 },
      { type: 'donut',   count: Math.floor(35  * lvlMult), sz: [2.5, 0.8, 2.5] as [number,number,number], mass: 800,  tierIdx: 3 },
      { type: 'cake',    count: Math.floor(15  * lvlMult), sz: [5.0, 6.0, 5.0] as [number,number,number], mass: 5000, tierIdx: 4 },
    ];

    this.levelTarget = 8000 + this.currentLevel * 3000;

    tiers.forEach(tier => {
      for (let i = 0; i < tier.count; i++) {
        const x = (Math.random() - 0.5) * spread;
        const z = (Math.random() - 0.5) * spread;
        if (Math.abs(x) < 5 && Math.abs(z) < 5) continue;

        let mesh: THREE.Object3D;
        if      (tier.type === 'cookie')  mesh = this.createCookieMesh();
        else if (tier.type === 'macaron') mesh = this.createMacaronMesh();
        else if (tier.type === 'donut')   mesh = this.createDonutMesh();
        else                              mesh = this.createCakeMesh();

        const yOff = tier.sz[1] / 2;
        mesh.position.set(x, yOff, z);
        mesh.traverse((c: any) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
        this.scene.add(mesh);

        const body = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic().setTranslation(x, yOff, z).setLinearDamping(2.5).setAngularDamping(6.0)
        );
        this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(tier.sz[0]/2, tier.sz[1]/2, tier.sz[2]/2).setFriction(0.8),
          body
        );
        this.objects.push({ mesh: mesh as THREE.Mesh, body, mass: tier.mass, tier: tier.tierIdx, id: Math.random(), consumed: false, parts: [] });
      }
    });
    console.log(`Generated ${this.objects.length} objects in level ${this.currentLevel}`);

    // City props – benches, fire hydrants, signs
    const propDefs = [
      { geo: () => new THREE.BoxGeometry(0.3, 0.8, 0.3), color: '#ff3e00', mass: 10 },   // hydrant
      { geo: () => new THREE.BoxGeometry(0.15, 1.6, 0.15), color: '#ffcc00', mass: 5 },  // sign pole
      { geo: () => new THREE.BoxGeometry(1.4, 0.4, 0.4), color: '#886644', mass: 15 },   // bench
      { geo: () => new THREE.BoxGeometry(0.5, 0.5, 0.5), color: '#00cc88', mass: 8 },    // box
    ];
    for (let i = 0; i < 120; i++) {
      const x = (Math.random() - 0.5) * (spread + 10);
      const z = (Math.random() - 0.5) * (spread + 10);
      if (Math.abs(x) < 4 && Math.abs(z) < 4) continue;
      const def = propDefs[i % propDefs.length];
      const geo = def.geo();
      const ph = (geo as THREE.BoxGeometry).parameters.height;
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.8 }));
      mesh.position.set(x, ph / 2, z);
      mesh.castShadow = true;
      this.scene.add(mesh);
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, ph/2, z).setLinearDamping(2.0).setAngularDamping(5.0));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid((geo as THREE.BoxGeometry).parameters.width/2, ph/2, (geo as THREE.BoxGeometry).parameters.depth/2), body);
      this.objects.push({ mesh, body, mass: def.mass, tier: 1, id: Math.random(), consumed: false });
    }

    // Buildings (too big to swallow at start — become reachable when big)
    for (let i = 0; i < 30; i++) {
      const x = (Math.random() - 0.5) * (spread + 20);
      const z = (Math.random() - 0.5) * (spread + 20);
      if (Math.abs(x) < 8 && Math.abs(z) < 8) continue;
      const w = 3 + Math.random() * 4;
      const h = 4 + Math.random() * 10;
      const d = 3 + Math.random() * 4;
      const colors = ['#8899aa', '#aa9988', '#99aacc', '#ccaa88'];
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.7 })
      );
      mesh.position.set(x, h/2, z);
      mesh.castShadow = true;
      this.scene.add(mesh);
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, h/2, z).setLinearDamping(3.0).setAngularDamping(8.0));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(w/2, h/2, d/2).setFriction(0.9), body);
      this.objects.push({ mesh, body, mass: Math.floor(w * h * d * 100), tier: Math.ceil(h / 5), id: Math.random(), consumed: false });
    }

    this.createTraffic();
  }

  private countTotalObjects() {
    this.totalObjectsInLevel = this.objects.length;
  }

  private createTraffic() {
    // Traffic cars are consumable objects (tier 2)
    const carColors = ['#ff3e00', '#00f2ff', '#ffd700', '#ffffff', '#66ff66', '#ff66cc'];
    for (let i = 0; i < 15; i++) {
      const x = (Math.random() - 0.5) * 120;
      const z = (Math.random() - 0.5) * 120;
      if (Math.abs(x) < 10 && Math.abs(z) < 10) continue;

      const carGroup = new THREE.Group();
      const carBody = new THREE.Mesh(
        new THREE.BoxGeometry(1.8, 0.8, 3.2),
        new THREE.MeshStandardMaterial({ color: carColors[i % carColors.length], roughness: 0.3 })
      );
      const carTop = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.5, 1.6),
        new THREE.MeshStandardMaterial({ color: '#222', roughness: 0.2, metalness: 0.8 })
      );
      carTop.position.y = 0.65;
      carTop.position.z = -0.2;
      carGroup.add(carBody, carTop);
      carGroup.position.set(x, 0.5, z);
      carGroup.traverse((c: any) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
      this.scene.add(carGroup);

      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0.5, z).setLinearDamping(0.5)
      );
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.9, 0.5, 1.6).setFriction(0.8), body);

      // Add cars as consumable objects (tier 2)
      this.objects.push({ mesh: carGroup as any, body, mass: 400, tier: 2, id: Math.random(), consumed: false });

      const speed = 0.08 + Math.random() * 0.1;
      const dir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      this.traffic.push({ mesh: carGroup as any, body, speed, direction: dir });
    }
  }

  // ── Mesh factories ──────────────────────────────────────────

  private createCookieMesh() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.2, 12), new THREE.MeshStandardMaterial({ color: '#D2B48C', roughness: 0.8 })));
    for (let i = 0; i < 5; i++) {
      const chip = new THREE.Mesh(new THREE.SphereGeometry(0.08, 4, 4), new THREE.MeshStandardMaterial({ color: '#3E2723' }));
      const a = (i / 5) * Math.PI * 2;
      chip.position.set(Math.cos(a) * 0.3, 0.12, Math.sin(a) * 0.3);
      g.add(chip);
    }
    return g;
  }

  private createMacaronMesh() {
    const g = new THREE.Group();
    const colors = ['#FFB6C1', '#B0E0E6', '#DDA0DD', '#98FB98'];
    const c = colors[Math.floor(Math.random() * colors.length)];
    const mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 });
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.75, 0.4, 16), mat);
    top.position.y = 0.25;
    const bot = top.clone(); bot.position.y = -0.25;
    const cream = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.2, 16), new THREE.MeshStandardMaterial({ color: '#fff' }));
    g.add(top, bot, cream);
    return g;
  }

  private createDonutMesh() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.4, 12, 24), new THREE.MeshStandardMaterial({ color: '#D2B48C', roughness: 0.7 }));
    ring.rotation.x = Math.PI / 2;
    const frosting = new THREE.Mesh(new THREE.TorusGeometry(1, 0.42, 8, 24, Math.PI), new THREE.MeshStandardMaterial({ color: '#FF69B4', roughness: 0.4 }));
    frosting.rotation.x = Math.PI / 2;
    frosting.position.y = 0.05;
    g.add(ring, frosting);
    return g;
  }

  private createCakeMesh() {
    const g = new THREE.Group();
    const l1 = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 2, 24), new THREE.MeshStandardMaterial({ color: '#FFF8DC' }));
    const l2 = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 1.8, 24), new THREE.MeshStandardMaterial({ color: '#FFB6C1' }));
    l2.position.y = 1.9;
    const l3 = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 1.5, 24), new THREE.MeshStandardMaterial({ color: '#FFFACD' }));
    l3.position.y = 3.5;
    const cherry = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), new THREE.MeshStandardMaterial({ color: '#FF0000' }));
    cherry.position.y = 4.5;
    g.add(l1, l2, l3, cherry);
    return g;
  }

  private resetBots() {
    // Remove old bot meshes from scene before clearing
    this.bots.forEach(b => {
      this.scene.remove(b.mesh);
      // dispose geometries/materials
      b.mesh.traverse((c: any) => {
        if (c.isMesh) {
          c.geometry?.dispose();
          if (Array.isArray(c.material)) c.material.forEach((m: any) => m.dispose());
          else c.material?.dispose();
        }
      });
    });
    this.bots = [];
    this.createBots();
  }

  private createBots() {
    const botNames = ['B0T_ALPHA', 'B0T_BETA', 'NOOB_MASTER', 'CITY_EATER'];
    const personalities = ['aggressive', 'passive', 'random', 'aggressive'];

    botNames.forEach((name, i) => {
      const group = new THREE.Group();

      // Bot hole depth
      const inner = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 0.85, 6, 32, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x080808, side: THREE.BackSide })
      );
      inner.position.y = -3;
      group.add(inner);

      // Bot void floor
      const botFloor = new THREE.Mesh(
        new THREE.CircleGeometry(0.9, 32),
        new THREE.MeshBasicMaterial({ color: 0x000000 })
      );
      botFloor.rotation.x = Math.PI / 2;
      botFloor.position.y = -5.9;
      group.add(botFloor);

      const botRimColors = [0xff3e00, 0xffcc00, 0xff00ff, 0x00ff88];
      const rim = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1.12, 32),
        new THREE.MeshBasicMaterial({ color: botRimColors[i % 4], transparent: true, opacity: 0.9, side: THREE.DoubleSide })
      );
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = 0.01;
      group.add(rim);

      const spread = 80;
      group.position.set((Math.random() - 0.5) * spread, 0, (Math.random() - 0.5) * spread);
      this.scene.add(group);

      // Bot name label (HTML overlay — updated in renderMinimap/updateLeaderboard)
      this.bots.push({ mesh: group, score: 0, size: INITIAL_HOLE_SIZE, tier: 1, name, personality: personalities[i] });
    });
  }

  private setupAudio() {
    const silence = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';
    this.sfx = {
      pop: new Howl({ src: [silence], volume: 0.5 }),
      growth: new Howl({ src: [silence], volume: 0.6 }),
      vacuum: new Howl({ src: [silence], loop: true, volume: 0.1 }),
      rumble: new Howl({ src: [silence], volume: 0.4 }),
      music: new Howl({ src: [silence], loop: true, volume: 0.3 })
    };

    const sounds: Record<string, string> = {
      pop: 'https://cdn.pixabay.com/audio/2022/03/10/audio_c3527e73c2.mp3',
      growth: 'https://cdn.pixabay.com/audio/2021/08/04/audio_0625c1539c.mp3',
      rumble: 'https://cdn.pixabay.com/audio/2022/03/15/audio_10672e1851.mp3',
      music: 'https://cdn.pixabay.com/audio/2022/01/18/audio_d0a13f69d2.mp3'
    };

    Object.entries(sounds).forEach(([key, url]) => {
      const vol = this.sfx[key].volume();
      const h = new Howl({ src: [url], volume: vol, loop: key === 'music' || key === 'vacuum' });
      h.on('load', () => { this.sfx[key] = h; });
    });
  }

  private applyVolume(musicVol: number, sfxVol: number) {
    if (this.sfx.music) this.sfx.music.volume(musicVol);
    ['pop', 'growth', 'vacuum', 'rumble'].forEach(k => {
      if (this.sfx[k]) this.sfx[k].volume(sfxVol * (k === 'vacuum' ? 0.15 : 0.6));
    });
  }

  private setupUI() {
    this.uiScore = document.getElementById('score')!;
    this.uiTimer = document.getElementById('timer')!;
    this.uiGrowthBar = document.getElementById('growth-bar')!;
    this.uiSizeTier = document.getElementById('size-tier')!;
    this.uiCoins = document.getElementById('coins')!;

    document.getElementById('play-button')?.addEventListener('click', () => this.showModeSelection());

    document.getElementById('mode-solo')?.addEventListener('click', () => this.startGameWithMode(GameMode.SOLO));
    document.getElementById('mode-classic')?.addEventListener('click', () => this.startGameWithMode(GameMode.CLASSIC));
    document.getElementById('mode-battle')?.addEventListener('click', () => this.startGameWithMode(GameMode.BATTLE));
    document.getElementById('back-to-menu')?.addEventListener('click', () => this.hideModeSelection());
    document.getElementById('mode-daily')?.addEventListener('click', () => {
      this.currentMap = 'Downtown';
      this.changeMapVisuals();
      this.startGameWithMode(GameMode.SOLO);
    });

    document.getElementById('again-button')?.addEventListener('click', () => {
      document.getElementById('end-screen')?.classList.add('hidden');
      document.getElementById('joystick-zone')?.classList.add('hidden');
      const menu = document.getElementById('main-menu')!;
      menu.classList.remove('hidden');
      // Clear ALL inline GSAP styles before showing
      gsap.set(menu, { clearProps: 'all' });
      gsap.fromTo(menu, { opacity: 0, scale: 0.95 }, { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out' });
      this.updateUpgradeUI();
    });

    // Settings panel
    document.getElementById('settings-button')?.addEventListener('click', () => {
      const sm = document.getElementById('settings-menu')!;
      sm.classList.remove('hidden');
      gsap.fromTo(sm, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.3 });
    });
    document.getElementById('close-settings')?.addEventListener('click', () => {
      const sm = document.getElementById('settings-menu')!;
      gsap.to(sm, { opacity: 0, scale: 0.9, duration: 0.25, onComplete: () => sm.classList.add('hidden') });
    });
    document.getElementById('close-skins')?.addEventListener('click', () => {
      const sp = document.getElementById('skins-panel')!;
      gsap.to(sp, { opacity: 0, scale: 0.9, duration: 0.25, onComplete: () => sp.classList.add('hidden') });
    });
    document.getElementById('reset-progress')?.addEventListener('click', () => {
      if (confirm('Reset all progress?')) { localStorage.removeItem('holeio_userdata'); location.reload(); }
    });

    // Volume sliders
    document.getElementById('music-vol')?.addEventListener('input', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      this.applyVolume(val, parseFloat((document.getElementById('sfx-vol') as HTMLInputElement)?.value ?? '0.6'));
    });
    document.getElementById('sfx-vol')?.addEventListener('input', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      this.applyVolume(parseFloat((document.getElementById('music-vol') as HTMLInputElement)?.value ?? '0.5'), val);
    });
    document.getElementById('start-onboarding')?.addEventListener('click', () => {
      const ob = document.getElementById('onboarding')!;
      gsap.to(ob, { opacity: 0, scale: 0.8, duration: 0.4, onComplete: () => ob.classList.add('hidden') });
    });
    document.getElementById('share-button')?.addEventListener('click', () => {
      if (navigator.share) { navigator.share({ title: 'MEGA CITY HOLE.IO', text: `I scored ${this.score} in MEGA CITY HOLE.IO!`, url: location.href }); }
      else { navigator.clipboard?.writeText(location.href); const b = document.getElementById('share-button')!; b.innerText = '✅ COPIED!'; setTimeout(() => b.innerText = '📤 SHARE', 2000); }
    });

    // Next level button — increment level THEN start
    document.getElementById('next-level-button')?.addEventListener('click', () => {
      document.getElementById('end-screen')?.classList.add('hidden');
      this.currentLevel++;
      // Update map visuals for new level tier
      if (this.currentLevel === 5) this.currentMap = 'Downtown';
      else if (this.currentLevel === 10) this.currentMap = 'Industrial';
      else if (this.currentLevel === 20) this.currentMap = 'Futuristic';
      this.changeMapVisuals();
      this.startGame();
    });

    document.getElementById('maps-button')?.addEventListener('click', () => {
      const maps = ['Bakery', 'Suburbs', 'Downtown', 'Industrial', 'Futuristic'];
      const mapLevels = [1, 1, 5, 10, 20];
      const index = (maps.indexOf(this.currentMap) + 1) % maps.length;
      if (this.userData.level >= mapLevels[index]) {
        this.currentMap = maps[index];
        document.getElementById('maps-button')!.innerText = `MAP: ${this.currentMap.toUpperCase()}`;
        this.changeMapVisuals();
      } else {
        alert(`Unlocks at Level ${mapLevels[index]}!`);
      }
    });

    // Populate skins panel
    const skinsGrid = document.getElementById('skins-grid');
    if (skinsGrid) {
      const skinDefs = [
        { name: 'Basic', color: 0x000000, css: '#000', cost: 0 },
        { name: 'Neon', color: 0x00f2ff, css: '#00f2ff', cost: 0 },
        { name: 'Fire', color: 0xff3e00, css: '#ff3e00', cost: 200 },
        { name: 'Galaxy', color: 0x00ffaa, css: '#00ffaa', cost: 500 },
        { name: 'Purple', color: 0x9933ff, css: '#9933ff', cost: 800 },
        { name: 'Gold', color: 0xffd700, css: '#ffd700', cost: 1500 },
      ];
      skinDefs.forEach((s) => {
        const card = document.createElement('div');
        card.className = `skin-card${s.name === this.currentSkin ? ' active' : ''}`;
        card.innerHTML = `<div class="skin-preview" style="background:${s.css};box-shadow:0 0 12px ${s.css}"></div><div class="skin-name">${s.name}</div>${s.cost ? `<div class="skin-cost">${s.cost}🪙</div>` : ''}`;
        card.addEventListener('click', () => {
          if (s.cost > this.userData.coins) return;
          this.currentSkin = s.name;
          // Change RIM color, not hole walls
          const rim = this.holeGroup.children.find(c => c instanceof THREE.Mesh && (c as THREE.Mesh).geometry.type === 'RingGeometry') as THREE.Mesh;
          if (rim) (rim.material as THREE.MeshBasicMaterial).color.setHex(s.color);
          this.holeLight.color.setHex(s.color || 0x00f2ff);
          skinsGrid.querySelectorAll('.skin-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          this.sfx.pop.play();
        });
        skinsGrid.appendChild(card);
      });
    }

    document.getElementById('skins-button')?.addEventListener('click', () => {
      const sp = document.getElementById('skins-panel')!;
      sp.classList.remove('hidden');
      gsap.fromTo(sp, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.3 });

    });

    document.getElementById('revive-button')?.addEventListener('click', () => {
      document.getElementById('end-screen')?.classList.add('hidden');
      const btn = document.getElementById('revive-button') as HTMLButtonElement;
      btn.innerText = 'LOADING...';
      btn.disabled = true;
      setTimeout(() => {
        btn.innerText = 'WATCH AD: REVIVE +30S';
        btn.disabled = false;
        this.isPlaying = true;
        this.timeLeft += 30;
        document.getElementById('game-hud')?.classList.remove('hidden');
        this.sfx.vacuum.play();
        this.startTimer();
      }, 1500);
    });

    ['speed', 'size', 'suction'].forEach(id => {
      document.getElementById(`upg-${id}`)?.addEventListener('click', () => {
        const cost = (this.userData.upgrades as any)[id] * 100;
        if (this.userData.coins >= cost) {
          this.userData.coins -= cost;
          (this.userData.upgrades as any)[id]++;
          this.saveUserData();
          this.updateUpgradeUI();
          this.sfx.growth.play();
          gsap.fromTo(`#upg-${id}`, { scale: 0.9 }, { scale: 1, duration: 0.2, ease: 'back.out' });
        } else {
          gsap.to(`#upg-${id}`, {
            keyframes: { '0%': { x: -8 }, '25%': { x: 8 }, '50%': { x: -8 }, '75%': { x: 8 }, '100%': { x: 0 } },
            duration: 0.35
          });
        }
      });
    });
  }

  private setupControls() {
    let isDragging = false;

    const handleMove = (dx: number, dz: number) => {
      if (!this.isPlaying) return;
      const speedMult = 0.2 + (this.userData.upgrades.speed - 1) * 0.05;
      this.holeGroup.position.x = Math.max(-68, Math.min(68, this.holeGroup.position.x + dx * speedMult));
      this.holeGroup.position.z = Math.max(-68, Math.min(68, this.holeGroup.position.z + dz * speedMult));
    };

    // Keyboard controls (WASD + arrows)
    const keys: Record<string, boolean> = {};
    window.addEventListener('keydown', (e) => { keys[e.code] = true; });
    window.addEventListener('keyup', (e) => { keys[e.code] = false; });
    const updateKeys = () => {
      if (!this.isPlaying) return;
      let dx = 0, dz = 0;
      if (keys['KeyW'] || keys['ArrowUp']) dz -= 1.5;
      if (keys['KeyS'] || keys['ArrowDown']) dz += 1.5;
      if (keys['KeyA'] || keys['ArrowLeft']) dx -= 1.5;
      if (keys['KeyD'] || keys['ArrowRight']) dx += 1.5;
      if (dx || dz) handleMove(dx, dz);
    };
    (this as any)._updateKeys = updateKeys;

    // Mouse controls (follow mouse while clicking)
    let isMouseDown = false;
    window.addEventListener('mousedown', () => isMouseDown = true);
    window.addEventListener('mouseup', () => isMouseDown = false);
    window.addEventListener('mousemove', (e) => {
      if (!this.isPlaying) return;
      if (isMouseDown || e.buttons === 1) {
        handleMove(e.movementX, e.movementY);
      }
    });
    
    // Fallback: Click to move (teleport-ish)
    window.addEventListener('mousedown', (e) => {
      if (!this.isPlaying) return;
      // Only if not clicking UI
      if ((e.target as HTMLElement).id === 'canvas-container' || (e.target as HTMLElement).tagName === 'CANVAS') {
        // optionally handle click-to-move
      }
    });

    // Joystick touch controls
    const jZone = document.getElementById('joystick-zone');
    const jThumb = document.getElementById('joystick-thumb');
    if (jZone && jThumb) {
      let jActive = false;
      let jCenter = { x: 0, y: 0 };
      const jRadius = 40;

      jZone.addEventListener('touchstart', (e) => {
        e.preventDefault();
        jActive = true;
        const rect = jZone.getBoundingClientRect();
        jCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });
      window.addEventListener('touchmove', (e) => {
        if (!jActive) return;
        const t = e.touches[0];
        let dx = t.clientX - jCenter.x;
        let dy = t.clientY - jCenter.y;
        const dist = Math.hypot(dx, dy);
        if (dist > jRadius) { dx = (dx / dist) * jRadius; dy = (dy / dist) * jRadius; }
        jThumb.style.transform = `translate(${dx}px, ${dy}px)`;
        handleMove(dx * 0.06, dy * 0.06);
      }, { passive: true });
      const endJoy = () => { jActive = false; jThumb.style.transform = 'translate(0,0)'; };
      window.addEventListener('touchend', endJoy);
      window.addEventListener('touchcancel', endJoy);
    }

    // Fallback touch (non-joystick area)
    let lastTouch: { x: number; y: number } | null = null;
    window.addEventListener('touchstart', (e) => {
      if ((e.target as HTMLElement).closest('#joystick-zone')) return;
      lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (!lastTouch) return;
      const dx = e.touches[0].clientX - lastTouch.x;
      const dy = e.touches[0].clientY - lastTouch.y;
      handleMove(dx * 0.4, dy * 0.4);
      lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: true });
    window.addEventListener('touchend', () => { lastTouch = null; });
  }

  private showModeSelection() {
    const ms = document.getElementById('mode-selection')!;
    const pb = document.getElementById('play-button')!;
    pb.style.display = 'none';
    ms.classList.remove('hidden');
    gsap.fromTo(ms, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.3 });
  }

  private hideModeSelection() {
    const ms = document.getElementById('mode-selection')!;
    const pb = document.getElementById('play-button')!;
    gsap.to(ms, {
      opacity: 0, duration: 0.25, onComplete: () => {
        ms.classList.add('hidden');
        pb.style.display = '';
      }
    });
  }

  private startGameWithMode(mode: GameMode) {
    this.currentGameMode = mode;
    this.hideModeSelection();
    // Small delay so hide animation completes
    setTimeout(() => this.startGame(), 300);
  }

  private startGame() {
    this.isPlaying = false; // pause during setup

    switch (this.currentGameMode) {
      case GameMode.CLASSIC: this.timeLeft = CLASSIC_DURATION; break;
      case GameMode.SOLO:    this.timeLeft = CLASSIC_DURATION; break;
      case GameMode.BATTLE:  this.timeLeft = -1; break;
      default:               this.timeLeft = MATCH_DURATION;
    }

    // Reset state
    this.score = 0;
    this.sizeTier = 1;
    this.feverScore = 0;
    this.feverMode = false;
    this.totalObjectsConsumed = 0;
    this.consumptionPercentage = 0;
    this.sessionCoins = 0;
    this.combo = 0;

    this.holeSize = INITIAL_HOLE_SIZE + (this.userData.upgrades.size - 1) * 0.2;
    this.holeGroup.scale.set(this.holeSize, 1, this.holeSize);
    this.holeGroup.position.set(0, 0, 0);
    this.camera.position.set(0, 18, 16);

    // UI reset (safe null-guards)
    if (this.uiScore)    this.uiScore.innerText    = '0000';
    if (this.uiCoins)    this.uiCoins.innerText    = '0';
    if (this.uiGrowthBar) this.uiGrowthBar.style.width = '0%';
    if (this.uiSizeTier) this.uiSizeTier.innerText  = '1';
    const feverBar = document.getElementById('fever-bar');
    if (feverBar) feverBar.style.width = '0%';
    const soloPct = document.getElementById('solo-pct');
    if (soloPct) soloPct.classList.add('hidden');
    const comboEl = document.getElementById('combo-feedback');
    if (comboEl) (comboEl as HTMLElement).style.opacity = '0';

    if (this.currentGameMode === GameMode.BATTLE) {
      if (this.uiTimer) this.uiTimer.innerText = '∞';
    } else {
      if (this.uiTimer) this.uiTimer.innerText = this.formatTime(this.timeLeft);
    }
    if (this.uiTimer) {
      this.uiTimer.style.color = '#fff';
      gsap.killTweensOf(this.uiTimer);
    }

    try {
      // Show HUD immediately
      const hud = document.getElementById('game-hud')!;
      hud.classList.remove('hidden');
      gsap.fromTo(hud, { opacity: 0 }, { opacity: 1, duration: 0.5 });

      // Hide menu
      const menu = document.getElementById('main-menu')!;
      menu.classList.add('hidden');
      gsap.set(menu, { clearProps: 'all' });

      // Setup level
      console.log("Starting match setup...");
      this.generateLevel();
      this.countTotalObjects();
      this.resetBots();

      // START GAME
      this.isPlaying = true;
      this.startTimer();
      console.log("Match started! isPlaying:", this.isPlaying);
      
      if (this.sfx.vacuum) this.sfx.vacuum.play();
    } catch (e) {
      console.error("Match start failed:", e);
    }
  }

  private formatTime(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  private startTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.currentGameMode === GameMode.BATTLE) return;

    this.timerInterval = setInterval(() => {
      if (!this.isPlaying) return;
      if (this.timeLeft <= 0) {
        clearInterval(this.timerInterval);
        this.endGame();
        return;
      }
      this.timeLeft--;
      this.uiTimer.innerText = this.formatTime(this.timeLeft);
      if (this.timeLeft === 10) {
        this.uiTimer.style.color = '#ff3e00';
        gsap.to(this.uiTimer, { scale: 1.2, repeat: -1, yoyo: true, duration: 0.5 });
      }
    }, 1000);
  }

  // ── Per-frame update (called once in animate) ────────────────

  private updateFrame() {
    this.world.step();
    this.updatePlayerHole();
    this.updateBotHoles();
    this.updateTraffic();
    this.updateLeaderboard();

    // Sync physics → meshes
    for (let i = 0; i < this.objects.length; i++) {
      const obj = this.objects[i];
      if (obj.consumed || !obj.mesh.visible) continue;
      
      const t = obj.body.translation();
      const r = obj.body.rotation();
      obj.mesh.position.set(t.x, t.y, t.z);
      obj.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }

    // Smooth top-down camera follow
    const targetY = 16 + this.holeSize * 1.5;
    const targetZ = 14 + this.holeSize * 1.2;
    this.camera.position.lerp(new THREE.Vector3(this.holeGroup.position.x, targetY, this.holeGroup.position.z + targetZ), 0.1);
    this.camera.lookAt(this.holeGroup.position.x, 0, this.holeGroup.position.z);
  }

  private updatePlayerHole() {
    const holePos = this.holeGroup.position; // FIX: use holeGroup position
    const radius = this.holeSize * (this.feverMode ? 1.8 : 1);
    const suction = 8 + (this.userData.upgrades.suction - 1) * 3;

    // Iterate a copy so removals don't skip elements
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const obj = this.objects[i];
      if (obj.consumed || !obj.mesh.visible) continue;

      const objPos = obj.mesh.position;
      const distXZ = Math.hypot(holePos.x - objPos.x, holePos.z - objPos.z);

      if (distXZ >= radius) continue;

      // Suction tilt — objects lean toward hole as they're pulled in
      const tiltStrength = Math.max(0, 1 - distXZ / radius);
      if (tiltStrength > 0.1 && !obj.consumed) {
        const tiltX = (holePos.z - obj.mesh.position.z) * tiltStrength * 0.15;
        const tiltZ = -(holePos.x - obj.mesh.position.x) * tiltStrength * 0.15;
        obj.mesh.rotation.x = tiltX;
        obj.mesh.rotation.z = tiltZ;
      }

      const pos = obj.body.translation();

      if (obj.tier > this.sizeTier + 1) {
        // Too big — push away
        const pushDir = new THREE.Vector3(pos.x - holePos.x, 0, pos.z - holePos.z).normalize();
        obj.body.setLinvel({ x: pushDir.x * 6, y: 0, z: pushDir.z * 6 }, true);
        gsap.to(this.camera.position, { x: '+=0.08', duration: 0.04, repeat: 3, yoyo: true });
        continue;
      }

      const dirX = holePos.x - pos.x;
      const dirZ = holePos.z - pos.z;

      if (distXZ < radius * 0.7) {
        // Mark consumed IMMEDIATELY to prevent double-consume from physics loop
        if (obj.consumed) continue;
        obj.consumed = true;

        for (let ci = 0; ci < obj.body.numColliders(); ci++) {
          obj.body.collider(ci).setCollisionGroups(0);
        }
        
        // Physics push down
        obj.body.applyTorqueImpulse({ x: Math.random() * 5, y: Math.random() * 5, z: Math.random() * 5 }, true);
        obj.body.setLinvel({ x: dirX * 2, y: -25, z: dirZ * 2 }, true);

        // Visual: Spin + Shrink + fall
        gsap.to(obj.mesh.rotation, { x: Math.random() * 10, y: Math.random() * 10, z: Math.random() * 10, duration: 0.3 });
        gsap.to(obj.mesh.scale, { x: 0.1, y: 0.1, z: 0.1, duration: 0.25, ease: "power2.in" });
        gsap.to(obj.mesh.position, {
          y: obj.mesh.position.y - 4, duration: 0.3, ease: "power1.in",
          onComplete: () => this.consumeObject(obj)
        });
      } else {
        // Suction pull toward center (stronger as it gets closer)
        const pullForce = suction * (1 - distXZ / radius) * 1.5;
        obj.body.applyImpulse({ x: dirX * pullForce, y: -2, z: dirZ * pullForce }, true);
        // Tilt mesh toward hole center
        obj.mesh.lookAt(holePos.x, obj.mesh.position.y, holePos.z);
      }
    }

    // Bot eating (Classic / Battle)
    if (this.currentGameMode !== GameMode.SOLO) {
      this.bots.forEach(bot => {
        if (bot.size <= 0) return;
        const d = this.holeGroup.position.distanceTo(bot.mesh.position);
        // Player eats bot
        if (d < radius && this.holeSize > bot.size + 0.5) {
          this.score += 5000;
          this.sessionCoins += 100;
          this.userData.coins += 100;
          bot.size = 0;
          bot.mesh.visible = false;
          this.uiScore.innerText = this.score.toString().padStart(4, '0');
          this.uiCoins.innerText = this.sessionCoins.toString();
          this.showGrowthFeedback();
          this.sfx.growth.play();
          this.showMilestone(`ELIMINATED ${bot.name}!`, '💀');
          this.shakeCamera(0.8, 15);
        }
      });
    }
  }

  private updateBotHoles() {
    this.bots.forEach(bot => {
      if (bot.size <= 0) return;

      const botSpeed = (bot.personality === 'aggressive' ? 0.15 : 0.08) + bot.tier * 0.02;
      const botRadius = bot.size * 0.8;

      let targetPos: THREE.Vector3 | null = null;
      let minDist = Infinity;

      // Bot AI: Find nearest edible object
      this.objects.forEach(obj => {
        if (obj.consumed || !obj.mesh.visible || obj.tier > bot.tier) return;
        const d = bot.mesh.position.distanceTo(obj.mesh.position);
        if (d < minDist) { minDist = d; targetPos = obj.mesh.position; }
      });

      // Bot AI: If aggressive, try to eat player if smaller
      if (bot.personality === 'aggressive' && this.holeSize < bot.size - 0.5) {
        const dToPlayer = bot.mesh.position.distanceTo(this.holeGroup.position);
        if (dToPlayer < 20 && dToPlayer < minDist) {
          targetPos = this.holeGroup.position;
          minDist = dToPlayer;
        }
      }

      if (targetPos) {
        const dir = new THREE.Vector3().subVectors(targetPos, bot.mesh.position).normalize();
        bot.mesh.position.x += dir.x * botSpeed;
        bot.mesh.position.z += dir.z * botSpeed;

        // "Eat" objects
        this.objects.forEach(obj => {
          if (obj.consumed || !obj.mesh.visible || obj.tier > bot.tier) return;
          const d = bot.mesh.position.distanceTo(obj.mesh.position);
          if (d < botRadius) {
            obj.consumed = true;
            obj.mesh.visible = false;
            try { this.world.removeRigidBody(obj.body); } catch (_) { }
            bot.score += obj.mass;

            // Bot Growth
            if (bot.score > bot.tier * 2500) {
              bot.tier++;
              bot.size += 0.8;
              gsap.to(bot.mesh.scale, { x: bot.size / INITIAL_HOLE_SIZE, z: bot.size / INITIAL_HOLE_SIZE, duration: 0.6, ease: 'elastic.out(1, 0.5)' });
            }
          }
        });
      }

      // Keep bots in bounds
      bot.mesh.position.x = Math.max(-65, Math.min(65, bot.mesh.position.x));
      bot.mesh.position.z = Math.max(-65, Math.min(65, bot.mesh.position.z));

      // Bot eats player
      if (this.currentGameMode !== GameMode.SOLO && bot.size > 0) {
        const d = bot.mesh.position.distanceTo(this.holeGroup.position);
        if (d < bot.size * 0.8 && bot.size > this.holeSize + 0.5) {
          this.endGame();
        }
      }
    });
  }

  private updateLeaderboard() {
    const list = [
      { name: 'YOU', score: this.score },
      ...this.bots.map(b => ({ name: b.name, score: b.score }))
    ].sort((a, b) => b.score - a.score);

    const lb = document.querySelector('.leaderboard-mini');
    if (lb) {
      lb.innerHTML = list.slice(0, 3).map((item, i) =>
        `<div class="mini-entry ${item.name === 'YOU' ? 'player' : ''}">${i + 1}. ${item.name} — ${item.score}</div>`
      ).join('');
    }
  }

  private consumeObject(obj: typeof this.objects[0]) {
    // consumed flag was set early (before animation) so just ensure mesh is hidden
    obj.mesh.visible = false;
    try { this.world.removeRigidBody(obj.body); } catch (_) { }

    this.score += obj.mass;
    this.sessionCoins += Math.floor(obj.mass / 50) + 1;
    this.userData.coins += Math.floor(obj.mass / 50) + 1;

    this.uiScore.innerText = this.score.toString().padStart(4, '0');
    this.uiCoins.innerText = this.sessionCoins.toString();

    // Floating score popup (only for meaningful objects)
    if (obj.mass >= 100) this.showScorePopup(obj.mesh.position, `+${obj.mass.toLocaleString()}`);

    this.totalObjectsConsumed++;
    this.consumptionPercentage = (this.totalObjectsConsumed / this.totalObjectsInLevel) * 100;

    if (this.currentGameMode === GameMode.SOLO) {
      const pctEl = document.getElementById('solo-pct')!;
      pctEl.innerText = `${Math.floor(this.consumptionPercentage)}%`;
      pctEl.classList.remove('hidden');
    }

    // Size tier (single path — checkGrowth removed, onSizeUp is the only growth handler)
    const newTier = this.calculateSizeTier();
    if (newTier > this.sizeTier) {
      this.sizeTier = newTier;
      this.onSizeUp(newTier);
    } else {
      this.showGrowthFeedback();
    }

    this.showConsumptionEffects(obj);

    if (this.currentGameMode === GameMode.SOLO && this.consumptionPercentage >= 100) {
      this.endGame(); return;
    }

    // Fever
    if (!this.feverMode) {
      this.feverScore += obj.mass;
      document.getElementById('fever-bar')!.style.width = `${Math.min((this.feverScore / this.feverMax) * 100, 100)}%`;
      if (this.feverScore >= this.feverMax) this.triggerFever();
    }

    // Destruction particles
    this.createDestructionParticles(obj.mesh.position, obj.mass);

    // SFX
    if (obj.tier === 1) this.sfx.pop.play();
    else this.sfx.rumble.play();

    // Screen shake for big objects
    if (obj.tier >= 3) {
      this.shakeCamera(0.4, 10);
      if (window.navigator.vibrate) window.navigator.vibrate(60);
    }

    // Growth bar
    this.uiGrowthBar.style.width = `${Math.min((this.score / this.levelTarget) * 100, 100)}%`;
    if (this.score >= this.levelTarget) this.winLevel();

    // Combo
    this.triggerCombo();

    // Hole bounce & wobble
    gsap.fromTo(this.holeGroup.scale, { y: 0.8 }, { y: 1, duration: 0.3, ease: 'elastic.out(1, 0.3)' });
    gsap.fromTo(this.holeGroup.rotation, { z: -0.1 }, { z: 0, duration: 0.4, ease: 'back.out' });
  }

  private triggerCombo() {
    this.combo++;
    const el = document.getElementById('combo-feedback')!;
    el.innerText = `COMBO x${this.combo}!`;
    el.style.opacity = '1';
    if (this.comboTimeout) clearTimeout(this.comboTimeout);
    this.comboTimeout = setTimeout(() => {
      this.combo = 0;
      gsap.to(el, { opacity: 0, duration: 0.5 });
    }, 2000);
    gsap.fromTo(el, { scale: 0.6 }, { scale: 1.2, duration: 0.2, ease: 'back.out' });
  }

  private calculateSizeTier(): number {
    if (this.score >= 10000) return 5;
    if (this.score >= 5000) return 4;
    if (this.score >= 2000) return 3;
    if (this.score >= 500) return 2;
    return 1;
  }

  private onSizeUp(newTier: number) {
    this.uiSizeTier.innerText = newTier.toString();

    const labels = ['TINY', 'SMALL', 'MEDIUM', 'LARGE', 'MASSIVE'];
    const icons = ['🔵', '🟢', '🟡', '🟠', '🔴'];
    this.showMilestone(`${labels[newTier - 1]} HOLE!`, icons[newTier - 1]);

    const targetSize = INITIAL_HOLE_SIZE + (newTier - 1) * 1.5;
    this.holeSize = targetSize;

    // FIX: animate holeGroup scale (not holeMesh scale)
    gsap.to(this.holeGroup.scale, { x: targetSize, z: targetSize, duration: 0.8, ease: 'elastic.out(1, 0.5)' });

    // Screen flash on size up
    const flash = document.createElement('div');
    flash.style.cssText = 'position:fixed;inset:0;background:rgba(0,242,255,0.18);z-index:99;pointer-events:none;';
    document.body.appendChild(flash);
    gsap.to(flash, { opacity: 0, duration: 0.5, onComplete: () => flash.remove() });
    gsap.to(this.camera.position, { x: '+=0.4', duration: 0.08, repeat: 6, yoyo: true });
    this.sfx.growth.play();
  }

  private showMilestone(label: string, icon = '🎯') {
    const el = document.getElementById('size-milestone')!;
    (el.querySelector('.milestone-label') as HTMLElement).innerText = label;
    (el.querySelector('.milestone-icon') as HTMLElement).innerText = icon;
    el.classList.remove('hidden');
    gsap.fromTo(el, { opacity: 0, scale: 0.5 }, {
      opacity: 1, scale: 1, duration: 0.4,
      onComplete: () => gsap.to(el, { opacity: 0, delay: 1.5, duration: 0.5, onComplete: () => el.classList.add('hidden') })
    });
  }

  private showGrowthFeedback() {
    const el = document.getElementById('growth-feedback')!;
    const msgs = ['NICE!', 'GROWING!', 'SIZE UP!', 'BIGGER!', 'HUNGRY!', 'NOM NOM!', 'DEVOUR!'];
    el.innerText = msgs[Math.floor(Math.random() * msgs.length)];
    gsap.fromTo(el, { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1.2, duration: 0.25, onComplete: () => gsap.to(el, { opacity: 0, duration: 0.3 }) });
  }

  private showScorePopup(worldPos: THREE.Vector3, text: string) {
    // Project 3D position to screen
    const vec = worldPos.clone();
    vec.project(this.camera);
    const x = (vec.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-vec.y * 0.5 + 0.5) * window.innerHeight;

    const el = document.createElement('div');
    el.className = 'score-popup';
    el.innerText = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    document.getElementById('game-hud')?.appendChild(el);

    gsap.fromTo(el,
      { opacity: 1, y: 0, scale: 0.7 },
      {
        opacity: 0, y: -60, scale: 1.2, duration: 0.8, ease: 'power2.out',
        onComplete: () => el.remove()
      }
    );
  }

  private showConsumptionEffects(obj: any) {
    const shake = Math.min(obj.mass / 80, 0.25);
    gsap.to(this.camera.position, { x: `+=${shake}`, duration: 0.04, repeat: 3, yoyo: true });
    this.createMicroParticles(obj.mesh.position, obj.tier);

    // Flash rim — but only if not in fever mode (fever keeps it magenta)
    if (!this.feverMode) {
      const rimColor = obj.tier >= 3 ? 0xff6b35 : 0x00ff88;
      const rim = this.holeGroup.children.find(c => c instanceof THREE.Mesh && (c as THREE.Mesh).geometry.type === 'RingGeometry') as THREE.Mesh;
      if (rim) {
        (rim.material as THREE.MeshBasicMaterial).color.setHex(rimColor);
        gsap.delayedCall(0.14, () => (rim.material as THREE.MeshBasicMaterial).color.setHex(0x00f2ff));
      }
    }

    if (window.navigator.vibrate) window.navigator.vibrate(obj.tier >= 3 ? 80 : 30);
  }

  private createDestructionParticles(position: THREE.Vector3, mass: number) {
    const count = Math.min(Math.floor(mass / 15), 15);
    for (let i = 0; i < count; i++) {
      const p = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.2, 0.2),
        new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(Math.random() * 0.15, 1, 0.6), transparent: true, opacity: 1 })
      );
      p.position.copy(position);
      p.position.y += Math.random() * 1.5;
      this.scene.add(p);
      const a = Math.random() * Math.PI * 2;
      const f = 2 + Math.random() * 3;
      gsap.to(p.position, { x: p.position.x + Math.cos(a) * f, z: p.position.z + Math.sin(a) * f, y: p.position.y + Math.random() * 2, duration: 0.5 + Math.random() * 0.4 });
      gsap.to(p.material as THREE.MeshBasicMaterial, { opacity: 0, duration: 0.7, onComplete: () => this.scene.remove(p) });
    }
  }

  private createMicroParticles(position: THREE.Vector3, tier: number) {
    const count = Math.min(tier * 2, 8);
    for (let i = 0; i < count; i++) {
      const p = new THREE.Mesh(
        new THREE.SphereGeometry(0.1 + Math.random() * 0.15),
        new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(Math.random() * 0.3, 1, 0.8), transparent: true, opacity: 1 })
      );
      p.position.set(
        position.x + (Math.random() - 0.5) * 2,
        position.y + Math.random(),
        position.z + (Math.random() - 0.5) * 2
      );
      this.scene.add(p);
      const a = Math.random() * Math.PI * 2;
      const f = 1.5 + Math.random() * 2.5;
      gsap.to(p.position, { x: p.position.x + Math.cos(a) * f, z: p.position.z + Math.sin(a) * f, y: p.position.y + Math.random() * 2, duration: 0.25 + Math.random() * 0.2 });
      gsap.to(p.material as THREE.MeshBasicMaterial, { opacity: 0, duration: 0.35, onComplete: () => this.scene.remove(p) });
    }
  }

  private shakeCamera(intensity = 0.3, repeats = 10) {
    gsap.to(this.camera.position, { x: `+=${intensity}`, duration: 0.05, repeat: repeats, yoyo: true, ease: 'power2.inOut' });
  }

  private triggerFever() {
    this.feverMode = true;
    this.feverScore = 0;

    // Rim goes magenta during fever - NOT the hole walls
    const rim = this.holeGroup.children.find(c => c instanceof THREE.Mesh && (c as THREE.Mesh).geometry.type === 'RingGeometry') as THREE.Mesh;
    if (rim) (rim.material as THREE.MeshBasicMaterial).color.setHex(0xff00ff);
    this.holeLight.color.setHex(0xff00ff);

    // Screen vignette effect for fever
    const vigEl = document.getElementById('fever-vignette');
    if (vigEl) vigEl.classList.remove('hidden');
    const slEl = document.getElementById('speed-lines');
    if (slEl) slEl.classList.remove('hidden');

    gsap.to(this.holeGroup.scale, { x: `*=1.15`, z: `*=1.15`, duration: 0.2, repeat: 1, yoyo: true });

    const lvlUp = document.getElementById('level-up')!;
    lvlUp.querySelector('h2')!.innerText = '🔥 FEVER MODE! 🔥';
    lvlUp.classList.remove('hidden');
    gsap.fromTo(lvlUp, { opacity: 0 }, { opacity: 1, duration: 0.3, onComplete: () => gsap.to(lvlUp, { opacity: 0, delay: 1.5, duration: 0.5, onComplete: () => lvlUp.classList.add('hidden') }) });

    gsap.to(document.getElementById('fever-bar'), {
      width: '0%', duration: 8, ease: 'none', onComplete: () => {
        this.feverMode = false;
        if (rim) (rim.material as THREE.MeshBasicMaterial).color.setHex(0x00f2ff);
        this.holeLight.color.setHex(0x00f2ff);
        if (vigEl) vigEl.classList.add('hidden');
        if (slEl) slEl.classList.add('hidden');
      }
    });
  }

  private winLevel() {
    if (!this.isPlaying) return;
    this.isPlaying = false; // FIX: pause immediately, endGame() checks this
    this.sfx.vacuum.stop();
    // Do NOT increment currentLevel here — next-level-button does it

    const lvlUp = document.getElementById('level-up')!;
    lvlUp.querySelector('h2')!.innerText = `LEVEL ${this.currentLevel} CLEAR! 🎉`;
    lvlUp.classList.remove('hidden');
    gsap.fromTo(lvlUp, { opacity: 0, scale: 0.7 }, {
      opacity: 1, scale: 1, duration: 0.6, ease: 'back.out',
      onComplete: () => {
        gsap.to(lvlUp, {
          opacity: 0, delay: 2, duration: 0.5, onComplete: () => {
            lvlUp.classList.add('hidden');
            this.isPlaying = true; // re-enable so endGame() can proceed
            this.endGame();
          }
        });
      }
    });
  }

  private endGame() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.sfx.vacuum.stop();
    document.getElementById('joystick-zone')?.classList.add('hidden');
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }

    let resultMessage = '';
    let xpGained = 0;
    let rank = 1;

    switch (this.currentGameMode) {
      case GameMode.SOLO:
        const pct = Math.floor(this.consumptionPercentage);
        xpGained = pct * 10 + (pct >= 100 ? 500 : 0);
        resultMessage = pct >= 100 ? 'PERFECT CLEAR! 🎉' : `CONSUMED ${pct}%`;
        break;

      case GameMode.CLASSIC: {
        const sorted = [{ name: 'YOU', score: this.score }, ...this.bots.map(b => ({ name: b.name, score: b.score }))].sort((a, b) => b.score - a.score);
        rank = sorted.findIndex(i => i.name === 'YOU') + 1;
        xpGained = Math.floor(this.score / 10) + (4 - rank) * 100;
        resultMessage = rank === 1 ? 'DOMINATION! 🏆' : `RANK #${rank}`;
        break;
      }

      case GameMode.BATTLE: {
        const alive = this.bots.filter(b => b.size > 0).length;
        if (alive === 0) { resultMessage = 'LAST HOLE STANDING! 👑'; xpGained = 1000; }
        else { rank = alive + 1; resultMessage = `ELIMINATED — RANK #${rank}`; xpGained = Math.floor(this.score / 10); }
        break;
      }

      default:
        xpGained = Math.floor(this.score / 10);
        resultMessage = 'GAME OVER';
    }

    // Level up check
    this.userData.xp += xpGained;
    while (this.userData.xp >= this.userData.level * 5000) {
      this.userData.xp -= this.userData.level * 5000;
      this.userData.level++;
    }
    if (this.score > this.userData.highScore) this.userData.highScore = this.score;
    this.saveUserData();

    // Update UI
    document.getElementById('game-hud')!.classList.add('hidden');
    document.getElementById('end-screen')!.classList.remove('hidden');
    document.getElementById('end-rank')!.innerText = resultMessage;
    document.getElementById('end-score')!.innerText = this.score.toLocaleString();
    document.getElementById('end-xp')!.innerText = `+${xpGained} XP`;
    document.getElementById('end-coins')!.innerText = this.sessionCoins.toString();
    document.getElementById('end-highscore')!.innerText = this.userData.highScore.toLocaleString();

    const ctx = document.getElementById('rank-context')!;
    if (this.currentGameMode === GameMode.SOLO) {
      ctx.innerText = `City consumed: ${Math.floor(this.consumptionPercentage)}%`;
    } else if (this.currentGameMode === GameMode.CLASSIC) {
      ctx.innerText = rank === 1 ? 'You had the biggest hole!' : `You were #${rank} of 5`;
    } else {
      ctx.innerText = this.bots.filter(b => b.size > 0).length === 0 ? 'You eliminated all opponents!' : 'Better luck next time!';
    }

    // Show next level button if score is high enough
    const nlBtn = document.getElementById('next-level-button');
    if (nlBtn) { if (this.score >= this.levelTarget) nlBtn.classList.remove('hidden'); else nlBtn.classList.add('hidden'); }

    this.updateUpgradeUI();
  }

  private changeMapVisuals() {
    const colors: Record<string, string> = {
      Bakery: '#FFD1DC', Suburbs: '#87ceeb', Downtown: '#1a1a2e',
      Industrial: '#4a4a4a', Futuristic: '#000033'
    };
    const c = colors[this.currentMap] ?? '#87ceeb';
    this.scene.background = new THREE.Color(c);
    this.scene.fog = new THREE.FogExp2(c, 0.01);
    // NOTE: do NOT call generateLevel() here — startGame() already calls it
  }

  private renderMinimap() {
    const canvas = document.getElementById('minimap') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    const scale = w / 200;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, w, h);
    // Objects
    this.objects.forEach(obj => {
      if (obj.consumed) return;
      ctx.fillStyle = obj.tier >= 3 ? '#ff69b4' : '#aaa';
      const ox = (obj.mesh.position.x + 100) * scale;
      const oz = (obj.mesh.position.z + 100) * scale;
      ctx.fillRect(ox - 0.5, oz - 0.5, 1, 1);
    });
    // Bots
    this.bots.forEach(bot => {
      if (bot.size <= 0) return;
      ctx.fillStyle = '#ff3e00';
      const bx = (bot.mesh.position.x + 100) * scale;
      const bz = (bot.mesh.position.z + 100) * scale;
      ctx.beginPath(); ctx.arc(bx, bz, 3, 0, Math.PI * 2); ctx.fill();
    });
    // Player
    ctx.fillStyle = '#00f2ff';
    const px = (this.holeGroup.position.x + 100) * scale;
    const pz = (this.holeGroup.position.z + 100) * scale;
    ctx.beginPath(); ctx.arc(px, pz, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#00f2ff'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(px, pz, 6, 0, Math.PI * 2); ctx.stroke();
  }

  private animate() {
    requestAnimationFrame(() => this.animate());
    const t = performance.now() * 0.001;

    if (this.groundShader) {
      this.groundShader.uniforms.uHolePos.value.copy(this.holeGroup.position);
      this.groundShader.uniforms.uHoleRadius.value = this.holeGroup.scale.x;
    }

    if (this.holeLight) {
      this.holeLight.position.set(this.holeGroup.position.x, 2, this.holeGroup.position.z);
      this.holeLight.intensity = this.feverMode ? 5 + Math.sin(t * 8) : 2 + Math.sin(t * 2) * 0.3;
    }

    // Animate rim — slow spin + opacity pulse
    const rim = this.holeGroup.children.find(c =>
      c instanceof THREE.Mesh && (c as THREE.Mesh).geometry.type === 'RingGeometry'
    ) as THREE.Mesh | undefined;
    if (rim) {
      rim.rotation.z = t * (this.feverMode ? 4 : 0.6);
      (rim.material as THREE.MeshBasicMaterial).opacity = 0.75 + Math.sin(t * 3) * 0.2;
    }

    // Animate bot rim rings
    this.bots.forEach((bot, i) => {
      const botRim = bot.mesh.children.find(c =>
        c instanceof THREE.Mesh && (c as THREE.Mesh).geometry.type === 'RingGeometry'
      ) as THREE.Mesh | undefined;
      if (botRim) botRim.rotation.z = -t * (0.5 + i * 0.15);
    });

    if (this.isPlaying) {
      (this as any)._updateKeys?.();
      this.updateFrame();
      this.renderMinimap();
    }

    this.renderer.render(this.scene, this.camera);
  }

  private updateTraffic() {
    this.traffic.forEach(t => {
      // Skip consumed cars
      if (!t.mesh.visible) return;
      const pos = t.body.translation();
      t.body.setLinvel({ x: t.direction.x * t.speed * 50, y: 0, z: t.direction.z * t.speed * 50 }, true);
      if (Math.abs(pos.x) > 95) t.body.setTranslation({ x: -pos.x * 0.9, y: 0.5, z: pos.z }, true);
      if (Math.abs(pos.z) > 95) t.body.setTranslation({ x: pos.x, y: 0.5, z: -pos.z * 0.9 }, true);
      t.mesh.position.set(pos.x, pos.y, pos.z);
      t.mesh.rotation.y = Math.atan2(t.direction.x, t.direction.z);
    });
  }
}

new Game();
