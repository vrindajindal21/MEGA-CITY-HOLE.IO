import "../style.css"
import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { gsap } from 'gsap'
import { Howl } from 'howler'

// Game Constants
const MATCH_DURATION = 90; // seconds
const CLASSIC_DURATION = 120; // 2 minutes for classic mode
const INITIAL_HOLE_SIZE = 2.0;
const MAX_HOLE_SIZE = 15;

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
  private clock: THREE.Clock = new THREE.Clock();
  private groundShader: any = null;
  
  // Game State
  private isPlaying: boolean = false;
  private currentGameMode: GameMode = GameMode.CLASSIC;
  private timeLeft: number = MATCH_DURATION;
  private currentLevel: number = 1;
  private score: number = 0;
  private levelTarget: number = 2000;
  private sizeTier: number = 1;
  private holeSize: number = INITIAL_HOLE_SIZE;
  private combo: number = 0;
  private comboTimeout: any = null;
  private timerInterval: any = null;
  
  // Solo mode specific
  private totalObjectsConsumed: number = 0;
  private totalObjectsInLevel: number = 0;
  private consumptionPercentage: number = 0;
  
  // Coin system (now persisted in userData)
  private totalCoinsEarned: number = 0;

  // Refs
  private holeMesh!: THREE.Mesh;
  private holeBody!: RAPIER.RigidBody;
  private objects: { mesh: THREE.Mesh, body: RAPIER.RigidBody, mass: number, tier: number, id: number, parts?: THREE.Mesh[] }[] = [];
  private bots: { mesh: THREE.Mesh, score: number, size: number, tier: number, name: string, personality: string }[] = [];
  private traffic: { mesh: THREE.Mesh, body: RAPIER.RigidBody, speed: number, direction: THREE.Vector3 }[] = [];
  private holeLight!: THREE.PointLight;
  
  // Progression
  private userData: UserData = {
    xp: 0,
    level: 1,
    upgrades: { speed: 1, size: 1, suction: 1 }
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
  private currentMap: string = 'Suburbs';
  
  constructor() {
    this.init();
  }

  async init() {
    await RAPIER.init();
    this.setupThree();
    this.setupPhysics();
    this.setupLights();
    this.setupEnvironment();
    this.setupUI();
    this.setupControls();
    this.setupAudio();
    this.loadUserData();
    
    // Hide loading screen
    const loading = document.getElementById('loading-screen');
    if (loading) {
      gsap.to(loading, { 
        display: 'none',
        opacity: 0, 
        duration: 1, 
        onComplete: () => loading.classList.add('hidden') 
      });
    }
    
    this.animate();
    console.log("MEGA CITY HOLE.IO Ready");
  }

  private loadUserData() {
    const data = localStorage.getItem('holeio_userdata');
    if (data) {
      this.userData = JSON.parse(data);
      // Ensure new fields exist for old players
      if (this.userData.coins === undefined) this.userData.coins = 0;
      this.updateUpgradeUI();
    } else {
    }
  }

  private saveUserData() {
    localStorage.setItem('holeio_userdata', JSON.stringify(this.userData));
  }

  private updateUpgradeUI() {
    const xpForNextLevel = this.userData.level * 5000;
    const progress = (this.userData.xp % 5000) / 5000;
    
    document.getElementById('player-level')!.innerText = this.userData.level.toString();
    document.getElementById('xp-fill')!.style.width = `${progress * 100}%`;
    
    ['speed', 'size', 'suction'].forEach(id => {
      const level = (this.userData.upgrades as any)[id];
      const cost = level * 1000;
      const el = document.getElementById(`upg-${id}`)!;
      el.querySelector('.upg-val')!.innerHTML = `LVL ${level}`;
      // Optional: Add cost display if needed
    });
  }

  private setupThree() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#a3d1ff'); 
    this.scene.fog = new THREE.FogExp2('#a3d1ff', 0.01);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, 20, 20);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
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

    // Ground Plane (Physics only)
    let groundDesc = RAPIER.RigidBodyDesc.fixed();
    let groundBody = this.world.createRigidBody(groundDesc);
    let groundCollider = RAPIER.ColliderDesc.cuboid(100, 0.1, 100);
    this.world.createCollider(groundCollider, groundBody);

    // Visual Ground with Hole Shader and Pavement
    const groundGeo = new THREE.PlaneGeometry(200, 200);
    const groundMat = new THREE.MeshStandardMaterial({ color: '#222', roughness: 0.9, metalness: 0.1 });
    
    groundMat.onBeforeCompile = (shader) => {
      shader.uniforms.uHolePos = { value: new THREE.Vector3() };
      shader.uniforms.uHoleRadius = { value: INITIAL_HOLE_SIZE };
      
      shader.vertexShader = `
        varying vec3 vWorldPos;
        varying vec2 vUv;
        ${shader.vertexShader}
      `.replace(
        '#include <worldpos_vertex>',
        `
        #include <worldpos_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vUv = uv;
        `
      );

      shader.fragmentShader = `
        uniform vec3 uHolePos;
        uniform float uHoleRadius;
        varying vec3 vWorldPos;
        varying vec2 vUv;
        ${shader.fragmentShader}
      `.replace(
        '#include <clipping_planes_fragment>',
        `
        #include <clipping_planes_fragment>
        float dist = distance(vWorldPos.xz, uHolePos.xz);
        if (dist < uHoleRadius) discard;
        
        // City Grid / Pavement
        vec2 gridUv = vWorldPos.xz * 0.5;
        float lines = step(0.95, fract(gridUv.x)) + step(0.95, fract(gridUv.y));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.4), lines * 0.5);
        
        // Ground highlight near hole
        float highlight = smoothstep(uHoleRadius + 1.0, uHoleRadius, dist);
        gl_FragColor.rgb += highlight * vec3(0.1, 0.2, 0.3);
        `
      );
      this.groundShader = shader;
    };

    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    this.scene.add(groundMesh);

    // The Hole Visuals
    const holeGroup = new THREE.Group();
    
    // Depth Cylinder
    const holeGeo = new THREE.CylinderGeometry(1, 1, 10, 32, 1, true);
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
    this.holeMesh = new THREE.Mesh(holeGeo, holeMat);
    this.holeMesh.position.y = -5;
    holeGroup.add(this.holeMesh);
    
    // Hole Rim with Neon Glow
    const rimGeo = new THREE.RingGeometry(0.98, 1.15, 32);
    const rimMat = new THREE.MeshBasicMaterial({ color: 0x00f2ff, transparent: true, opacity: 0.8 });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 5.02; 
    this.holeMesh.add(rim);

    this.scene.add(holeGroup);

    // Hole Light for atmosphere
    this.holeLight = new THREE.PointLight(0x00f2ff, 2, 10);
    this.holeLight.position.y = 1;
    this.scene.add(this.holeLight);
  }

  private setupLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
    sunLight.position.set(50, 100, 50);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.left = -100;
    sunLight.shadow.camera.right = 100;
    sunLight.shadow.camera.top = 100;
    sunLight.shadow.camera.bottom = -100;
    sunLight.shadow.bias = -0.0001;
    this.scene.add(sunLight);

    // Add a Rim Light / Hemisphere for better building shadows
    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x444444, 0.6);
    this.scene.add(hemiLight);
  }

  private setupEnvironment() {
    this.currentMap = 'Bakery'; // Default to sweet theme
    this.generateLevel();
    this.countTotalObjects();
    this.createBots();
  }

  private generateLevel() {
    const seed = this.currentLevel;
    const objectCountMult = 1 + (seed * 0.1);
    
    this.objects.forEach(obj => {
      obj.mesh.visible = false;
      this.world.removeRigidBody(obj.body);
    });
    this.objects = [];

    const tiers = [
      { type: 'cookie', count: 150, size: [1.2, 0.4, 1.2], mass: 100, color: '#D2B48C' },
      { type: 'macaron', count: 80, size: [1.5, 1, 1.5], mass: 300, color: '#FFB6C1' },
      { type: 'donut', count: 50, size: [2.5, 0.8, 2.5], mass: 800, color: '#FF69B4' },
      { type: 'cake', count: 20, size: [5, 6, 5], mass: 5000, color: '#FFFFFF' }
    ];

    this.levelTarget = 10000;

    tiers.forEach((tier, tierIdx) => {
      for (let i = 0; i < tier.count; i++) {
        const x = (Math.random() - 0.5) * (180 + seed * 2);
        const z = (Math.random() - 0.5) * (180 + seed * 2);
        
        if (Math.abs(x) < 8 && Math.abs(z) < 8) continue;

        let mesh: THREE.Group | THREE.Mesh;
        if (tier.type === 'cookie') {
          mesh = this.createCookieMesh();
        } else if (tier.type === 'macaron') {
          mesh = this.createMacaronMesh();
        } else if (tier.type === 'donut') {
          mesh = this.createDonutMesh();
        } else if (tier.type === 'cake') {
          mesh = this.createCakeMesh();
        } else {
          mesh = new THREE.Mesh(
            new THREE.BoxGeometry(tier.size[0], tier.size[1], tier.size[2]),
            new THREE.MeshStandardMaterial({ color: tier.color })
          );
        }
        
        mesh.position.set(x, tier.size[1] / 2, z);
        mesh.traverse((child: any) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        this.scene.add(mesh);

        // Add "Destruction Juice": Sub-parts for buildings
        let parts: THREE.Mesh[] = [];
        if (tier.type === 'house' || tier.type === 'skyscraper') {
          for(let j=0; j<4; j++) {
            const p = new THREE.Mesh(new THREE.BoxGeometry(tier.size[0]/2, tier.size[1]/4, tier.size[2]/2), (mesh as any).material || new THREE.MeshStandardMaterial({color: tier.color}));
            p.visible = false;
            this.scene.add(p);
            parts.push(p);
          }
        }

        const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, tier.size[1] / 2, z);
        const body = this.world.createRigidBody(bodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.cuboid(tier.size[0]/2, tier.size[1]/2, tier.size[2]/2);
        this.world.createCollider(colliderDesc, body);

        this.objects.push({ 
          mesh: mesh as THREE.Mesh, 
          body, 
          mass: tier.mass, 
          tier: tierIdx + 1, 
          id: Math.random(),
          parts
        });
      }
    });

    // Add Props (Small stuff like hydrants, benches)
    for(let i=0; i<300; i++) {
      const x = (Math.random()-0.5)*180;
      const z = (Math.random()-0.5)*180;
      if (Math.abs(x) < 5 && Math.abs(z) < 5) continue;

      const propGeo = new THREE.BoxGeometry(0.3, 0.6, 0.3);
      const propMat = new THREE.MeshStandardMaterial({ color: i % 2 === 0 ? '#ff3e00' : '#ffcc00' });
      const mesh = new THREE.Mesh(propGeo, propMat);
      mesh.position.set(x, 0.3, z);
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0.3, z));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.15, 0.3, 0.15), body);
      this.objects.push({ mesh, body, mass: 5, tier: 1, id: Math.random() });
    }

    this.createTraffic();
  }

  private countTotalObjects() {
    this.totalObjectsInLevel = this.objects.length;
    console.log(`Total objects in level: ${this.totalObjectsInLevel}`);
  }

  private createTraffic() {
    const carColors = ['#ff3e00', '#00f2ff', '#ffd700', '#ffffff'];
    for(let i=0; i<15; i++) {
      const x = (Math.random()-0.5)*180;
      const z = (Math.random()-0.5)*180;
      const speed = 0.1 + Math.random()*0.2;
      const dir = new THREE.Vector3(Math.random()-0.5, 0, Math.random()-0.5).normalize();
      
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 3.5), new THREE.MeshStandardMaterial({ color: carColors[i % 4] }));
      mesh.position.set(x, 0.5, z);
      this.scene.add(mesh);
      
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0.5, z));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(1, 0.5, 1.75), body);
      
      this.traffic.push({ mesh, body, speed, direction: dir });
    }
  }

  private createCookieMesh() {
    const group = new THREE.Group() as any;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.2, 12), new THREE.MeshStandardMaterial({ color: '#D2B48C', roughness: 0.8 }));
    group.add(base);
    // Chocolate chips
    for(let i=0; i<5; i++) {
      const chip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 4, 4), new THREE.MeshStandardMaterial({ color: '#3E2723' }));
      const angle = (i/5)*Math.PI*2;
      chip.position.set(Math.cos(angle)*0.3, 0.1, Math.sin(angle)*0.3);
      group.add(chip);
    }
    return group;
  }

  private createMacaronMesh() {
    const group = new THREE.Group() as any;
    const colors = ['#FFB6C1', '#B0E0E6', '#DDA0DD', '#98FB98'];
    const color = colors[Math.floor(Math.random()*colors.length)];
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.75, 0.4, 16), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
    top.position.y = 0.25;
    const bottom = top.clone();
    bottom.position.y = -0.25;
    const cream = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.2, 16), new THREE.MeshStandardMaterial({ color: '#FFFFFF' }));
    group.add(top, bottom, cream);
    return group;
  }

  private createDonutMesh() {
    const group = new THREE.Group() as any;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.4, 12, 24), new THREE.MeshStandardMaterial({ color: '#D2B48C', roughness: 0.7 }));
    ring.rotation.x = Math.PI/2;
    const frosting = new THREE.Mesh(new THREE.TorusGeometry(1, 0.41, 8, 24, Math.PI), new THREE.MeshStandardMaterial({ color: '#FF69B4', roughness: 0.4 }));
    frosting.rotation.x = Math.PI/2;
    frosting.position.y = 0.05;
    group.add(ring, frosting);
    return group;
  }

  private createCakeMesh() {
    const group = new THREE.Group() as any;
    const layer1 = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 2, 24), new THREE.MeshStandardMaterial({ color: '#FFF' }));
    const layer2 = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 1.8, 24), new THREE.MeshStandardMaterial({ color: '#FFB6C1' }));
    layer2.position.y = 1.9;
    const layer3 = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 1.5, 24), new THREE.MeshStandardMaterial({ color: '#FFF' }));
    layer3.position.y = 3.5;
    // Cherry on top
    const cherry = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), new THREE.MeshStandardMaterial({ color: '#FF0000' }));
    cherry.position.y = 4.5;
    group.add(layer1, layer2, layer3, cherry);
    return group;
  }

  private createBots() {
    const botNames = ['B0T_ALPHA', 'B0T_BETA', 'NOOB_MASTER', 'CITY_EATER'];
    const personalities = ['aggressive', 'passive', 'random', 'aggressive'];
    
    botNames.forEach((name, i) => {
      // Bot Hole Visual (with depth)
      const group = new THREE.Group();
      const holeGeo = new THREE.CylinderGeometry(1, 1, 0.5, 32, 1, true);
      const holeMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
      const mesh = new THREE.Mesh(holeGeo, holeMat);
      mesh.position.y = -0.25;
      group.add(mesh);

      // Rim
      const rim = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.1, 32), new THREE.MeshBasicMaterial({ color: Math.random() * 0xffffff }));
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = 0.01;
      group.add(rim);

      group.position.set((Math.random()-0.5)*120, 0, (Math.random()-0.5)*120);
      this.scene.add(group);
      
      this.bots.push({ 
        mesh: group as any, 
        score: 0, 
        size: INITIAL_HOLE_SIZE, 
        tier: 1, 
        name, 
        personality: personalities[i] 
      });
    });
  }



  private setupAudio() {
    // Fallback to silent Howl to prevent crashes/errors blocking logic
    const silence = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';
    this.sfx = {
      pop: new Howl({ src: [silence], volume: 0.5 }),
      growth: new Howl({ src: [silence], volume: 0.6 }),
      vacuum: new Howl({ src: [silence], loop: true, volume: 0.1 }),
      rumble: new Howl({ src: [silence], volume: 0.4 })
    };

    // Try to load real sounds asynchronously
    const sounds = {
      pop: 'https://cdn.pixabay.com/audio/2022/03/10/audio_c3527e73c2.mp3',
      growth: 'https://cdn.pixabay.com/audio/2021/08/04/audio_0625c1539c.mp3',
      rumble: 'https://cdn.pixabay.com/audio/2022/03/15/audio_10672e1851.mp3'
    };

    Object.entries(sounds).forEach(([key, url]) => {
      const h = new Howl({ src: [url], volume: (this.sfx as any)[key].volume() });
      h.on('load', () => { (this.sfx as any)[key] = h; });
    });
  }

  private setupUI() {
    this.uiScore = document.getElementById('score')!;
    this.uiTimer = document.getElementById('timer')!;
    this.uiGrowthBar = document.getElementById('growth-bar')!;
    this.uiSizeTier = document.getElementById('size-tier')!;
    this.uiCoins = document.getElementById('coins')!;

    // Main Buttons
    document.getElementById('play-button')?.addEventListener('click', () => this.showModeSelection());
    
    // Game Mode Selection
    document.getElementById('mode-solo')?.addEventListener('click', () => this.startGameWithMode(GameMode.SOLO));
    document.getElementById('mode-classic')?.addEventListener('click', () => this.startGameWithMode(GameMode.CLASSIC));
    document.getElementById('mode-battle')?.addEventListener('click', () => this.startGameWithMode(GameMode.BATTLE));
    document.getElementById('back-to-menu')?.addEventListener('click', () => this.hideModeSelection());
    document.getElementById('again-button')?.addEventListener('click', () => {
      document.getElementById('end-screen')?.classList.add('hidden');
      this.startGame();
    });

    document.getElementById('maps-button')?.addEventListener('click', () => {
      const maps = ['Suburbs', 'Downtown', 'Industrial', 'Futuristic'];
      const mapLevels = [1, 5, 10, 20];
      const index = (maps.indexOf(this.currentMap) + 1) % maps.length;
      
      if (this.userData.level >= mapLevels[index]) {
        this.currentMap = maps[index];
        document.getElementById('maps-button')!.innerText = `MAP: ${this.currentMap.toUpperCase()}`;
        this.changeMapVisuals();
        this.sfx.pop.play();
      } else {
        alert(`Unlocks at Level ${mapLevels[index]}!`);
      }
    });

    document.getElementById('skins-button')?.addEventListener('click', () => {
      const colors = [0x000000, 0x00f2ff, 0xff3e00, 0x00ffaa, 0x9933ff];
      const colorNames = ['Basic', 'Neon', 'Fire', 'Galaxy', 'Emoji'];
      const index = (colorNames.indexOf(this.currentSkin) + 1) % colors.length;
      this.currentSkin = colorNames[index];
      (this.holeMesh.material as THREE.MeshBasicMaterial).color.setHex(colors[index]);
      document.getElementById('skins-button')!.innerText = `SKIN: ${this.currentSkin.toUpperCase()}`;
      this.sfx.pop.play();
    });
    
    document.getElementById('revive-button')?.addEventListener('click', () => {
      this.isPlaying = false;
      document.getElementById('end-screen')?.classList.add('hidden');
      // Simulate Rewarded Ad with better feedback
      const btn = document.getElementById('revive-button') as HTMLButtonElement;
      btn.innerText = "LOADING AD...";
      btn.disabled = true;
      
      setTimeout(() => {
        btn.innerText = "WATCH AD: REVIVE +30S";
        btn.disabled = false;
        this.isPlaying = true;
        this.timeLeft += 30;
        document.getElementById('game-hud')?.classList.remove('hidden');
        this.sfx.vacuum.play();
        this.startTimer();
      }, 1500);
    });
    
    // Upgrades
    ['speed', 'size', 'suction'].forEach(id => {
      document.getElementById(`upg-${id}`)?.addEventListener('click', () => {
        const cost = this.userData.upgrades[id as keyof UserData['upgrades']] * 100; // Lower cost for coins
        if (this.userData.coins >= cost) {
          this.userData.coins -= cost;
          (this.userData.upgrades as any)[id]++;
          this.saveUserData();
          this.updateUpgradeUI();
          this.sfx.growth.play();
          
          gsap.fromTo(`#upg-${id}`, { scale: 0.9 }, { scale: 1, duration: 0.2, ease: 'back.out' });
        } else {
          gsap.to(`#upg-${id}`, { 
            keyframes: {
              "0%": { x: -10 },
              "25%": { x: 10 },
              "50%": { x: -10 },
              "75%": { x: 10 },
              "100%": { x: 0 }
            },
            duration: 0.4
          });
        }
      });
    });
  }

  private setupControls() {
    let isDragging = false;
    const moveSpeed = 0.2;

    const handleMove = (dx: number, dz: number) => {
      if (!this.isPlaying) return;
      const speedMult = 0.2 + (this.userData.upgrades.speed - 1) * 0.05;
      this.holeMesh.position.x += dx * speedMult;
      this.holeMesh.position.z += dz * speedMult;
      
      // Clamp to world
      this.holeMesh.position.x = Math.max(-90, Math.min(90, this.holeMesh.position.x));
      this.holeMesh.position.z = Math.max(-90, Math.min(90, this.holeMesh.position.z));
    };

    window.addEventListener('mousedown', () => isDragging = true);
    window.addEventListener('mouseup', () => isDragging = false);
    window.addEventListener('mousemove', (e) => {
      if (isDragging) {
        handleMove(e.movementX * 0.05, e.movementY * 0.05);
      }
    });

    // Touch controls
    let lastTouch: { x: number, y: number } | null = null;
    window.addEventListener('touchstart', (e) => {
      lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    });
    window.addEventListener('touchmove', (e) => {
      if (lastTouch) {
        const dx = e.touches[0].clientX - lastTouch.x;
        const dy = e.touches[0].clientY - lastTouch.y;
        handleMove(dx * 0.05, dy * 0.05);
        lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    });
  }

  private showModeSelection() {
    const modeSelection = document.getElementById('mode-selection');
    const playButton = document.getElementById('play-button');
    
    if (modeSelection && playButton) {
      playButton.style.display = 'none';
      modeSelection.classList.remove('hidden');
      gsap.fromTo(modeSelection, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.3 });
    }
  }

  private hideModeSelection() {
    const modeSelection = document.getElementById('mode-selection');
    const playButton = document.getElementById('play-button');
    
    if (modeSelection && playButton) {
      gsap.to(modeSelection, { opacity: 0, duration: 0.3, onComplete: () => {
        modeSelection.classList.add('hidden');
        playButton.style.display = 'block';
      }});
    }
  }

  private startGameWithMode(mode: GameMode) {
    this.currentGameMode = mode;
    this.hideModeSelection();
    this.startGame();
  }

  private startGame() {
    this.isPlaying = true;
    
    // Set time based on game mode
    switch (this.currentGameMode) {
      case GameMode.CLASSIC:
        this.timeLeft = CLASSIC_DURATION;
        break;
      case GameMode.SOLO:
        this.timeLeft = CLASSIC_DURATION;
        break;
      case GameMode.BATTLE:
        this.timeLeft = -1; // No time limit for battle mode
        break;
      default:
        this.timeLeft = MATCH_DURATION;
    }
    
    // Reset game state
    this.score = 0;
    this.sizeTier = 1;
    this.feverScore = 0;
    this.feverMode = false;
    this.totalObjectsConsumed = 0;
    this.consumptionPercentage = 0;
    
    this.holeSize = INITIAL_HOLE_SIZE + (this.userData.upgrades.size - 1) * 0.2;
    this.holeMesh.scale.set(this.holeSize, 1, this.holeSize);
    this.holeMesh.position.set(0, -2.5, 0); // Reset position
    this.camera.position.set(0, 15, 15);
    
    // Reset objects and count them for solo mode
    this.generateLevel();
    this.countTotalObjects();
    
    // UI Reset
    this.uiScore.innerText = "0000";
    this.uiCoins.innerText = "0";
    if (this.currentGameMode === GameMode.BATTLE) {
      this.uiTimer.innerText = "∞";
    } else {
      const mins = Math.floor(this.timeLeft / 60);
      const secs = this.timeLeft % 60;
      this.uiTimer.innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    this.uiTimer.style.color = "#fff";
    this.uiGrowthBar.style.width = "0%";
    this.uiSizeTier.innerText = "1";
    document.getElementById('fever-bar')!.style.width = "0%";
    
    gsap.to('#main-menu', { opacity: 0, scale: 0.8, duration: 0.5, onComplete: () => {
      const menu = document.getElementById('main-menu');
      if (menu) {
        menu.classList.add('hidden');
        menu.style.display = 'none';
      }
    }});
    
    document.getElementById('game-hud')?.classList.remove('hidden');
    gsap.fromTo('#game-hud', { opacity: 0, y: 50 }, { opacity: 1, y: 0, duration: 0.5 });
    
    this.startTimer();
    this.sfx.vacuum.play();
  }

  private startTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    
    // Battle mode has no time limit
    if (this.currentGameMode === GameMode.BATTLE) {
      return;
    }
    
    this.timerInterval = setInterval(() => {
      if (this.timeLeft <= 0) {
        clearInterval(this.timerInterval);
        this.endGame();
        return;
      }
      this.timeLeft--;
      const mins = Math.floor(this.timeLeft / 60);
      const secs = this.timeLeft % 60;
      this.uiTimer.innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      
      if (this.timeLeft === 10) {
        this.uiTimer.style.color = '#ff3e00';
        gsap.to(this.uiTimer, { scale: 1.2, repeat: -1, yoyo: true, duration: 0.5 });
      }
    }, 1000);
  }

  private updateHoleLogic() {
    this.updatePlayerHole();
    this.updateBotHole();
    this.updateLeaderboard();
  }

  private updatePlayerHole() {
    const holePos = this.holeMesh.position;
    const radius = this.holeSize * (this.feverMode ? 1.8 : 1);
    const suctionPower = 8 + (this.userData.upgrades.suction - 1) * 3;

    this.objects.forEach((obj, index) => {
      if (!obj.mesh.visible) return;
      
      const objPos = obj.mesh.position;
      const distXZ = Math.sqrt(Math.pow(holePos.x - objPos.x, 2) + Math.pow(holePos.z - objPos.z, 2));
      
      if (distXZ < radius) {
        const body = obj.body;
        const pos = body.translation();
        
        // Check if object is too big to consume
        if (obj.tier > this.sizeTier + 1) {
          // Object blocks the hole - push it away
          const pushForce = 5 + (obj.tier - this.sizeTier) * 2;
          const pushDir = new THREE.Vector3(
            pos.x - holePos.x,
            0,
            pos.z - holePos.z
          ).normalize();
          
          body.setLinvel({ 
            x: pushDir.x * pushForce, 
            y: 0, 
            z: pushDir.z * pushForce 
          }, true);
          
          // Visual feedback for blocked object
          if (obj.mesh.material) {
            (obj.mesh.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0xff0000);
            gsap.to((obj.mesh.material as THREE.MeshStandardMaterial).emissive, { 
              r: 0, g: 0, b: 0, 
              duration: 0.5 
            });
          }
          
          // Small screen shake for impact
          gsap.to(this.camera.position, {
            x: "+=0.1",
            duration: 0.05,
            repeat: 3,
            yoyo: true,
            ease: "power2.inOut"
          });
          
          return;
        }
        
        // 1. Pull toward center
        const dirX = (holePos.x - pos.x);
        const dirZ = (holePos.z - pos.z);
        
        // 2. If very close to center, fall through ground
        if (distXZ < radius * 0.85) {
          // Disable ground collision on all colliders of the body
          for (let i = 0; i < body.numColliders(); i++) {
            body.collider(i).setCollisionGroups(0);
          }
          
          // Apply tumbling torque
          body.applyImpulse({ x: (Math.random()-0.5)*5, y: -2, z: (Math.random()-0.5)*5 }, true);
          body.applyTorqueImpulse({ x: Math.random()*2, y: Math.random()*2, z: Math.random()*2 }, true);
          
          // Heavy downward pull
          body.setLinvel({ x: dirX * suctionPower, y: -20, z: dirZ * suctionPower }, true);
          this.consumeObject(obj, index);
        } else {
          // Strong suction pull
          body.setLinvel({ x: dirX * suctionPower, y: body.linvel().y, z: dirZ * suctionPower }, true);
        }
      }
    });

    // 3. Battle Mode: Can eat bots?
    if (this.currentGameMode === GameMode.BATTLE || this.currentGameMode === GameMode.CLASSIC) {
      this.bots.forEach((bot) => {
        if (bot.size <= 0) return;
        const d = this.holeMesh.position.distanceTo(bot.mesh.position);
        if (d < radius && this.holeSize > bot.size + 1) {
          // Consume Bot!
          this.score += 5000; // Big bonus
          this.userData.coins += 100;
          bot.size = 0;
          bot.mesh.visible = false;
          
          // Update UI
          this.uiScore.innerText = this.score.toString().padStart(4, '0');
          this.uiCoins.innerText = this.userData.coins.toString();
          
          this.showGrowthFeedback();
          this.sfx.growth.play();
          
          // Milestone for bot kill
          const milestoneEl = document.getElementById('size-milestone')!;
          (milestoneEl.querySelector('.milestone-label') as HTMLElement).innerText = `ELIMINATED ${bot.name}!`;
          milestoneEl.classList.remove('hidden');
          gsap.fromTo(milestoneEl, { opacity: 0, scale: 0 }, { opacity: 1, scale: 1.5, duration: 0.5, yoyo: true, repeat: 1, onComplete: () => milestoneEl.classList.add('hidden') });
        }
      });
    }
  }

  
  
  private updateBotHole() {
    this.bots.forEach(bot => {
      const baseSpeed = bot.personality === 'aggressive' ? 0.12 : 0.07;
      const speed = baseSpeed + (bot.tier * 0.02);

      // 1. Find Target
      let nearest: any = null;
      let minDist = Infinity;
      
      this.objects.forEach(obj => {
        if (!obj.mesh.visible || obj.tier > bot.tier) return;
        const d = bot.mesh.position.distanceTo(obj.mesh.position);
        if (d < minDist) {
          minDist = d;
          nearest = obj;
        }
      });

      // 2. Move Smoothly
      if (nearest) {
        const targetPos = nearest.mesh.position;
        const dir = new THREE.Vector3().subVectors(targetPos, bot.mesh.position).normalize();
        
        // Lerp movement for smoothness
        bot.mesh.position.x += dir.x * speed;
        bot.mesh.position.z += dir.z * speed;
        
        // 3. Consume
        const dist = bot.mesh.position.distanceTo(targetPos);
        if (dist < bot.size * 0.8) {
          nearest.mesh.visible = false;
          this.world.removeRigidBody(nearest.body);
          bot.score += nearest.mass;
          
          // Bot Growth
          if (bot.score > bot.tier * 2000) {
            bot.tier++;
            bot.size += 0.8;
            gsap.to(bot.mesh.scale, { x: bot.size / INITIAL_HOLE_SIZE, z: bot.size / INITIAL_HOLE_SIZE, duration: 0.5, ease: 'back.out' });
            
            // Bot Growth Ring Effect
            const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.2, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
            ring.rotation.x = -Math.PI/2;
            ring.position.y = 0.05;
            bot.mesh.add(ring);
            gsap.to(ring.scale, { x: 3, y: 3, duration: 0.6, onComplete: () => bot.mesh.remove(ring) });
            gsap.to(ring.material, { opacity: 0, duration: 0.6 });
          }
        }
      } else {
        // 4. Wander logic
        bot.mesh.position.x += Math.sin(Date.now() * 0.001 + bot.name.length) * speed * 0.5;
        bot.mesh.position.z += Math.cos(Date.now() * 0.001 + bot.name.length) * speed * 0.5;
      }

      // 5. Battle Mode: Bot can eat Player?
      if (this.currentGameMode === GameMode.BATTLE || this.currentGameMode === GameMode.CLASSIC) {
        const d = bot.mesh.position.distanceTo(this.holeMesh.position);
        if (d < bot.size && bot.size > this.holeSize + 1) {
          this.endGame(); // Player eaten!
        }
      }

      // Clamp bots to world
      bot.mesh.position.x = Math.max(-95, Math.min(95, bot.mesh.position.x));
      bot.mesh.position.z = Math.max(-95, Math.min(95, bot.mesh.position.z));
    });
  }

  private updateLeaderboard() {
    const list = [
      { name: 'YOU', score: this.score },
      ...this.bots.map(b => ({ name: b.name, score: b.score }))
    ].sort((a, b) => b.score - a.score);

    const miniList = document.querySelector('.leaderboard-mini')!;
    miniList.innerHTML = list.slice(0, 3).map((item, i) => 
      `<div class="mini-entry ${item.name === 'YOU' ? 'player' : ''}">${i + 1}. ${item.name} - ${item.score}</div>`
    ).join('');
  }

  private consumeObject(obj: any, index: number) {
    obj.mesh.visible = false;
    this.world.removeRigidBody(obj.body);
    
    this.score += obj.mass;
    this.userData.coins += Math.floor(obj.mass / 50) + 1; // Award coins to persistent data
    this.uiScore.innerText = this.score.toString().padStart(4, '0');
    this.uiCoins.innerText = this.userData.coins.toString();
    
    // Track consumption for solo mode
    this.totalObjectsConsumed++;
    this.consumptionPercentage = (this.totalObjectsConsumed / this.totalObjectsInLevel) * 100;
    
    if (this.currentGameMode === GameMode.SOLO) {
      const pctEl = document.getElementById('solo-pct')!;
      pctEl.innerText = `${Math.floor(this.consumptionPercentage)}%`;
      pctEl.classList.remove('hidden');
    }
    
    // Check for size progression
    const oldSizeTier = this.sizeTier;
    const newSizeTier = this.calculateSizeTier();
    
    if (newSizeTier > oldSizeTier) {
      this.sizeTier = newSizeTier;
      this.onSizeUp(oldSizeTier, newSizeTier);
    } else {
      // Regular growth feedback
      this.showGrowthFeedback();
    }
    
    // Ultra-satisfying micro-feedback for EVERY consumption
    this.showConsumptionEffects(obj);
    
    // Check solo mode win condition
    if (this.currentGameMode === GameMode.SOLO && this.consumptionPercentage >= 100) {
      this.endGame();
    }
    
    // Fever Progress
    if (!this.feverMode) {
      this.feverScore += obj.mass;
      const feverBar = document.getElementById('fever-bar')!;
      feverBar.style.width = `${(this.feverScore / this.feverMax) * 100}%`;
      if (this.feverScore >= this.feverMax) this.triggerFever();
    }

    // Enhanced Destruction Juice: Sub-parts with better physics
    if (obj.parts && obj.parts.length > 0) {
      obj.parts.forEach((p: THREE.Mesh, i: number) => {
        p.position.copy(obj.mesh.position);
        p.position.y += Math.random() * 2 + 1;
        p.visible = true;
        
        // Random explosion direction
        const explosionForce = 8 + Math.random() * 4;
        const angle = (Math.PI * 2 * i) / obj.parts.length + Math.random() * 0.5;
        const targetX = p.position.x + Math.cos(angle) * explosionForce;
        const targetZ = p.position.z + Math.sin(angle) * explosionForce;
        
        // Animate with physics-like motion
        gsap.to(p.position, { 
          x: targetX, 
          z: targetZ, 
          y: -3, 
          duration: 0.8 + Math.random() * 0.4,
          ease: "power2.out"
        });
        
        // Add rotation for more dynamic destruction
        gsap.to(p.rotation, { 
          x: Math.random() * Math.PI * 4, 
          y: Math.random() * Math.PI * 4, 
          z: Math.random() * Math.PI * 2,
          duration: 0.6 + Math.random() * 0.3,
          ease: "power2.out"
        });
        
        // Fade out effect
        gsap.to(p.material as THREE.MeshStandardMaterial, {
          opacity: 0,
          duration: 0.8,
          onComplete: () => p.visible = false
        });
      });
    }
    
    // Create particle explosion effect for all objects
    this.createDestructionParticles(obj.mesh.position, obj.mass);

    // SFX
    if (obj.tier === 1) this.sfx.pop.play();
    else this.sfx.rumble.play();

    // Screen Shake
    if (obj.tier >= 3) {
      this.shakeCamera();
      if (window.navigator.vibrate) window.navigator.vibrate(50);
    }

    // Level Progress
    const progress = (this.score / this.levelTarget);
    this.uiGrowthBar.style.width = `${Math.min(progress * 100, 100)}%`;

    if (this.score >= this.levelTarget) {
      this.winLevel();
    }
    
    this.checkGrowth();

    // Combo Logic
    this.triggerCombo();

    // Juice: Scale bounce on hole group
    if (this.holeMesh.parent) {
      gsap.fromTo(this.holeMesh.parent.scale, { y: 0.85 }, { y: 1, duration: 0.25, ease: 'back.out' });
    }
  }

  private triggerCombo() {
    this.combo++;
    const comboEl = document.getElementById('combo-feedback')!;
    comboEl.innerText = `COMBO x${this.combo}!`;
    comboEl.style.opacity = '1';
    
    if (this.comboTimeout) clearTimeout(this.comboTimeout);
    this.comboTimeout = setTimeout(() => {
      this.combo = 0;
      gsap.to(comboEl, { opacity: 0, duration: 0.5 });
    }, 2000);
    
    gsap.fromTo(comboEl, { scale: 0.5 }, { scale: 1.2, duration: 0.2, ease: 'back.out' });
  }

  private checkGrowth() {
    const growthMilestone = this.sizeTier * 1000;
    if (this.score >= growthMilestone && this.sizeTier < 10) {
      this.sizeTier++;
      this.holeSize += 0.8;
      this.uiSizeTier.innerText = this.sizeTier.toString();
      this.sfx.growth.play();
      gsap.to(this.holeMesh.scale, { x: this.holeSize, z: this.holeSize, duration: 0.5, ease: 'back.out' });
      gsap.to(this.camera.position, { y: 15 + this.sizeTier * 2, z: 15 + this.sizeTier * 2, duration: 1 });
    }
  }

  private winLevel() {
    this.isPlaying = false;
    this.sfx.vacuum.stop();
    this.currentLevel++;
    
    const lvlUp = document.getElementById('level-up')!;
    lvlUp.querySelector('h2')!.innerText = `LEVEL ${this.currentLevel-1} CLEAR!`;
    lvlUp.classList.remove('hidden');
    
    gsap.fromTo(lvlUp.querySelector('h2'), { scale: 0.5, opacity: 0 }, { 
      scale: 1, opacity: 1, duration: 1, ease: 'back.out', onComplete: () => {
        setTimeout(() => {
          lvlUp.classList.add('hidden');
          this.endGame();
          this.generateLevel();
        }, 2000);
      }
    });
  }

  private calculateSizeTier(): number {
    // Size tiers based on score - more frequent progression for dopamine hits
    if (this.score >= 10000) return 5; // Skyscrapers
    if (this.score >= 5000) return 4;  // Large buildings
    if (this.score >= 2000) return 3;  // Houses
    if (this.score >= 500) return 2;   // Cars
    return 1; // Small objects
  }

  private onSizeUp(oldTier: number, newTier: number) {
    // Update UI
    this.uiSizeTier.innerText = newTier.toString();
    
    // Visual feedback
    const milestoneEl = document.getElementById('size-milestone')!;
    const labels = ['TINY', 'SMALL', 'MEDIUM', 'LARGE', 'MASSIVE'];
    const icons = ['🔵', '🟢', '🟡', '🟠', '🔴'];
    
    (milestoneEl.querySelector('.milestone-label') as HTMLElement).innerText = `${labels[newTier - 1]} HOLE!`;
    (milestoneEl.querySelector('.milestone-icon') as HTMLElement).innerText = icons[newTier - 1];
    
    // Show milestone animation
    gsap.fromTo(milestoneEl, { 
      opacity: 0, 
      scale: 0.5 
    }, { 
      opacity: 1, 
      scale: 1, 
      duration: 0.5,
      onComplete: () => {
        gsap.to(milestoneEl, { opacity: 0, delay: 1.5, duration: 0.5 });
      }
    });
    
    // Physical growth animation
    const targetSize = INITIAL_HOLE_SIZE + (newTier - 1) * 1.5;
    gsap.to(this.holeMesh.scale, { 
      x: targetSize, 
      z: targetSize, 
      duration: 0.8, 
      ease: "elastic.out(1, 0.5)" 
    });
    
    this.holeSize = targetSize;
    
    // Screen shake for impact
    gsap.to(this.camera.position, { 
      x: "+=0.5", 
      duration: 0.1, 
      repeat: 5, 
      yoyo: true,
      ease: "power2.inOut"
    });
    
    // Play sound effect
    this.sfx.pop.play();
  }

  private showGrowthFeedback() {
    const feedbackEl = document.getElementById('growth-feedback')!;
    const messages = ['NICE!', 'GROWING!', 'SIZE UP!', 'BIGGER!', 'HUNGRY!'];
    feedbackEl.innerText = messages[Math.floor(Math.random() * messages.length)];
    
    gsap.fromTo(feedbackEl, { 
      opacity: 0, 
      scale: 0.5 
    }, { 
      opacity: 1, 
      scale: 1.2, 
      duration: 0.3,
      onComplete: () => {
        gsap.to(feedbackEl, { opacity: 0, duration: 0.3 });
      }
    });
  }

  private createDestructionParticles(position: THREE.Vector3, mass: number) {
    const particleCount = Math.min(Math.floor(mass / 10), 20);
    
    for (let i = 0; i < particleCount; i++) {
      const particle = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.2, 0.2),
        new THREE.MeshBasicMaterial({ 
          color: new THREE.Color().setHSL(Math.random() * 0.1, 1, 0.5),
          transparent: true,
          opacity: 1
        })
      );
      
      particle.position.copy(position);
      particle.position.y += Math.random() * 2;
      
      const angle = Math.random() * Math.PI * 2;
      const force = 2 + Math.random() * 3;
      
      this.scene.add(particle);
      
      gsap.to(particle.position, {
        x: particle.position.x + Math.cos(angle) * force,
        z: particle.position.z + Math.sin(angle) * force,
        y: particle.position.y + Math.random() * 2 - 1,
        duration: 0.5 + Math.random() * 0.5
      });
      
      gsap.to(particle.material as THREE.MeshBasicMaterial, {
        opacity: 0,
        duration: 0.8,
        onComplete: () => {
          this.scene.remove(particle);
        }
      });
    }
  }

  private shakeCamera() {
    gsap.to(this.camera.position, {
      x: "+=0.3",
      duration: 0.05,
      repeat: 11,
      yoyo: true,
      ease: "power2.inOut"
    });
  }

  private showConsumptionEffects(obj: any) {
    // Micro-screen shake for EVERY object
    const shakeIntensity = Math.min(obj.mass / 50, 0.3);
    gsap.to(this.camera.position, {
      x: `+=${shakeIntensity}`,
      duration: 0.05,
      repeat: 3,
      yoyo: true,
      ease: "power2.inOut"
    });
    
    // Particle burst effect
    this.createMicroParticles(obj.mesh.position, obj.tier);
    
    // Quick flash effect
    const flashColor = obj.tier >= 3 ? '#ff6b35' : '#00ff88';
    (this.holeMesh.material as THREE.MeshBasicMaterial).color.set(flashColor);
    gsap.to(this.holeMesh.material, { 
      opacity: 0.3, 
      duration: 0.1,
      onComplete: () => {
        (this.holeMesh.material as THREE.MeshBasicMaterial).color.set('#000000');
        (this.holeMesh.material as THREE.MeshBasicMaterial).opacity = 1;
      }
    });
    
    // Haptic feedback for mobile
    if (window.navigator.vibrate) {
      window.navigator.vibrate(obj.tier >= 3 ? 100 : 50);
    }
  }

  private createMicroParticles(position: THREE.Vector3, tier: number) {
    const particleCount = Math.min(tier * 2, 8);
    
    for (let i = 0; i < particleCount; i++) {
      const particle = new THREE.Mesh(
        new THREE.SphereGeometry(0.1 + Math.random() * 0.2),
        new THREE.MeshBasicMaterial({ 
          color: new THREE.Color().setHSL(Math.random() * 0.3, 1, 0.8),
          transparent: true,
          opacity: 1
        })
      );
      
      particle.position.copy(position);
      particle.position.y += Math.random() * 1;
      particle.position.x += (Math.random() - 0.5) * 2;
      particle.position.z += (Math.random() - 0.5) * 2;
      
      this.scene.add(particle);
      
      // Quick burst animation
      const burstForce = 2 + Math.random() * 3;
      const angle = Math.random() * Math.PI * 2;
      
      gsap.to(particle.position, {
        x: particle.position.x + Math.cos(angle) * burstForce,
        z: particle.position.z + Math.sin(angle) * burstForce,
        y: particle.position.y + Math.random() * 2,
        duration: 0.3 + Math.random() * 0.2
      });
      
      gsap.to(particle.material as THREE.MeshBasicMaterial, {
        opacity: 0,
        scale: 0,
        duration: 0.4,
        onComplete: () => {
          this.scene.remove(particle);
        }
      });
    }
  }

  private triggerFever() {
    this.feverMode = true;
    this.feverScore = 0;
    const feverBar = document.getElementById('fever-bar')!;
    
    // Visuals
    (this.holeMesh.material as THREE.MeshBasicMaterial).color.set('#ff00ff');
    gsap.to(this.holeMesh.scale, { x: '+=0.5', y: '+=0.5', duration: 0.2, repeat: 1, yoyo: true });
    
    const lvlUp = document.getElementById('level-up')!;
    lvlUp.querySelector('h2')!.innerText = "FEVER MODE!";
    lvlUp.classList.remove('hidden');
    gsap.fromTo(lvlUp.querySelector('h2'), { scale: 0.5, opacity: 0 }, { scale: 1.5, opacity: 1, duration: 0.3, yoyo: true, repeat: 1, onComplete: () => lvlUp.classList.add('hidden') });

    // Duration
    gsap.to(feverBar, { width: '0%', duration: 8, ease: 'none', onComplete: () => {
      this.feverMode = false;
      (this.holeMesh.material as THREE.MeshBasicMaterial).color.set(this.currentSkin === 'Basic' ? '#000000' : '#00f2ff'); // Simplified reset
    }});
  }

  private endGame() {
    this.isPlaying = false;
    this.sfx.vacuum.stop();
    if (this.timerInterval) clearInterval(this.timerInterval);
    
    // Calculate results based on game mode
    let resultMessage = '';
    let xpGained = 0;
    let rank = 1;
    
    switch (this.currentGameMode) {
      case GameMode.SOLO:
        const consumptionRate = Math.floor(this.consumptionPercentage);
        xpGained = Math.floor(consumptionRate * 10); // XP based on consumption percentage
        resultMessage = `CONSUMED ${consumptionRate}% OF CITY!`;
        if (consumptionRate >= 100) {
          resultMessage = "PERFECT CLEAR! CITY DEVOURED!";
          xpGained += 500; // Bonus for perfect clear
        }
        break;
        
      case GameMode.CLASSIC:
        // Classic mode: largest hole by time end
        const list = [
          { name: 'YOU', score: this.score },
          ...this.bots.map(b => ({ name: b.name, score: b.score }))
        ].sort((a, b) => b.score - a.score);
        rank = list.findIndex(i => i.name === 'YOU') + 1;
        xpGained = Math.floor(this.score / 10) + (4 - rank) * 100; // Bonus for higher ranks
        resultMessage = rank === 1 ? "DOMINATION! BEAT YOUR RECORD?" : `RANK #${rank} - KEEP TRYING!`;
        break;
        
      case GameMode.BATTLE:
        // Battle mode: last hole standing
        const aliveBots = this.bots.filter(b => b.size > 0);
        if (aliveBots.length === 0) {
          resultMessage = "ULTIMATE VICTORY! LAST HOLE STANDING!";
          xpGained = 1000;
        } else {
          rank = aliveBots.length + 1;
          xpGained = Math.floor(this.score / 10);
          resultMessage = `ELIMINATED! RANK #${rank}`;
        }
        break;
        
      default:
        xpGained = Math.floor(this.score / 10);
        resultMessage = "GAME OVER";
    }
    
    // Update user data
    this.userData.xp += xpGained;
    if (this.userData.xp >= this.userData.level * 5000) {
      this.userData.level++;
    }
    this.saveUserData();

    // Show end screen
    document.getElementById('game-hud')?.classList.add('hidden');
    document.getElementById('end-screen')?.classList.remove('hidden');
    
    // Update end screen UI
    document.getElementById('end-rank')!.innerText = this.currentGameMode === GameMode.SOLO ? resultMessage : `RANK #${rank}`;
    document.getElementById('end-score')!.innerText = this.score.toLocaleString();
    document.getElementById('end-xp')!.innerText = `+${xpGained} XP`;
    
    const contextEl = document.getElementById('rank-context')!;
    if (this.currentGameMode === GameMode.SOLO) {
      contextEl.innerText = `You consumed ${Math.floor(this.consumptionPercentage)}% of the city!`;
    } else if (this.currentGameMode === GameMode.CLASSIC) {
      const list = [
        { name: 'YOU', score: this.score },
        ...this.bots.map(b => ({ name: b.name, score: b.score }))
      ].sort((a, b) => b.score - a.score);
      if (rank > 1) {
        const pct = Math.floor((this.score / list[0].score) * 100);
        contextEl.innerText = `You were ${100 - pct}% away from Rank #1!`;
      } else {
        contextEl.innerText = "BEAT YOUR RECORD?";
      }
    } else if (this.currentGameMode === GameMode.BATTLE) {
      const aliveBots = this.bots.filter(b => b.size > 0);
      if (aliveBots.length === 0) {
        contextEl.innerText = "You eliminated all opponents!";
      } else {
        contextEl.innerText = `You were eliminated by ${aliveBots.length} remaining holes!`;
      }
    } else {
      contextEl.innerText = resultMessage;
    }
  }

  private changeMapVisuals() {
    const mapColors: { [key: string]: string } = {
      'Suburbs': '#87ceeb',
      'Downtown': '#1a1a2e',
      'Industrial': '#444444',
      'Futuristic': '#000022',
      'Bakery': '#FFD1DC'
    };
    this.scene.background = new THREE.Color(mapColors[this.currentMap]);
    this.scene.fog = new THREE.FogExp2(mapColors[this.currentMap], 0.01);
    
    // Clear and regenerate
    this.generateLevel();
  }

  
  private animate() {
    requestAnimationFrame(() => this.animate());

    const deltaTime = this.clock.getDelta();
    
    // Update Shader Uniforms
    if (this.groundShader) {
      this.groundShader.uniforms.uHolePos.value.copy(this.holeMesh.position);
      this.groundShader.uniforms.uHoleRadius.value = this.holeSize;
    }

    // Update Hole Light
    if (this.holeLight) {
      this.holeLight.position.set(this.holeMesh.position.x, 2, this.holeMesh.position.z);
      this.holeLight.intensity = this.feverMode ? 5 : 2;
    }

    if (this.isPlaying) {
      this.world.step();
      this.updatePlayerHole();
      this.updateBotHole();
      this.updateTraffic();
      this.updateHoleLogic();

      // Sync physics meshes
      this.objects.forEach(obj => {
        if (obj.mesh.visible) {
          const t = obj.body.translation();
          const r = obj.body.rotation();
          obj.mesh.position.set(t.x, t.y, t.z);
          obj.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        }
      });

      // Update camera to follow hole smoothly
      const camY = 20 + this.sizeTier * 3;
      const camZ = 20 + this.sizeTier * 3;
      const targetPos = new THREE.Vector3(
        this.holeMesh.position.x,
        camY,
        this.holeMesh.position.z + camZ
      );
      this.camera.position.lerp(targetPos, 0.05);
      this.camera.lookAt(this.holeMesh.position.x, 0, this.holeMesh.position.z);
    }

    this.renderer.render(this.scene, this.camera);
  }

  private updateTraffic() {
    this.traffic.forEach(t => {
      const pos = t.body.translation();
      t.body.setLinvel({ x: t.direction.x * t.speed * 50, y: 0, z: t.direction.z * t.speed * 50 }, true);
      
      // Wrap around
      if (Math.abs(pos.x) > 100) t.body.setTranslation({ x: -pos.x, y: 0.5, z: pos.z }, true);
      if (Math.abs(pos.z) > 100) t.body.setTranslation({ x: pos.x, y: 0.5, z: -pos.z }, true);
      
      t.mesh.position.set(pos.x, pos.y, pos.z);
      t.mesh.rotation.y = Math.atan2(t.direction.x, t.direction.z);
    });
  }
}

new Game();
