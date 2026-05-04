import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { gsap } from 'gsap';
import { Renderer } from './Renderer';
import { Physics } from './Physics';
import { UIManager } from '../ui/UIManager';
import { BotManager } from '../entities/BotManager';
import { LevelGenerator } from '../world/LevelGenerator';
import { GameMode, type GameObject, type UserData, defaultUserData } from '../types';

const INITIAL_HOLE_SIZE = 2.6;

export class Game {
  private renderer: Renderer;
  private physics: Physics;
  private ui!: UIManager;
  private bots!: BotManager;
  private levelGen!: LevelGenerator;

  private isPlaying: boolean = false;
  private currentGameMode: GameMode = GameMode.CLASSIC;
  private currentLevel: number = 1;
  private isEnding: boolean = false;
  private score: number = 0;
  private sessionCoins: number = 0;
  private timeLeft: number = 120;
  
  private objects: GameObject[] = [];
  private sceneryMeshes: THREE.Object3D[] = [];
  private holeGroup: THREE.Group = new THREE.Group();
  private holeMesh!: THREE.Mesh;
  private holeRim!: THREE.Mesh;
  private holeTrail!: THREE.Mesh;
  private groundShader: any = null;
  private holeSize: number = INITIAL_HOLE_SIZE;
  private sizeTier: number = 1;
  private growthXP: number = 0;
  private feverCharge: number = 0;
  private lastEatTime: number = 0;
  private rimColor: string = '#00f2ff';

  // Mission System


  private userData: UserData = defaultUserData();
  private moveDir: THREE.Vector3 = new THREE.Vector3();
  private mouseDir: THREE.Vector3 = new THREE.Vector3();
  private startMissionsCount: number = 0;
  private minimapCtx: CanvasRenderingContext2D | null = null;
  private frameCount: number = 0;

  constructor() {
    this.renderer = new Renderer();
    this.physics = new Physics();
    this.init();
  }

  private async init() {
    await RAPIER.init();
    this.physics.initialize();
    
    this.bots = new BotManager(this.renderer.scene, this.physics);
    this.levelGen = new LevelGenerator(this.renderer.scene, this.physics);
    
    this.ui = new UIManager({
      startGame: (mode: GameMode) => this.startGame(mode),
      buyUpgrade: (type: any) => this.buyUpgrade(type),
      changeSkin: (color: string) => this.changeSkin(color)
    });

    this.setupHole();
    this.setupGround();
    this.setupLights();
    this.setupMinimap();
    this.loadUserData();
    this.setupControls();
    this.animate();
    
    const loading = document.getElementById('loading-screen');
    const menu = document.getElementById('main-menu');
    if (loading) {
      gsap.to(loading, { opacity: 0, duration: 1.0, onComplete: () => {
        loading.classList.add('hidden');
        menu?.classList.remove('hidden');
        gsap.fromTo(menu, { opacity: 0, scale: 0.95 }, { opacity: 1, scale: 1, duration: 0.5 });
      }});
    }
  }

  private holeLight!: THREE.PointLight;

  private setupHole() {
    // Inner hole depth (Now glowing with skin color!)
    const holeGeo = new THREE.CylinderGeometry(1, 0.95, 25, 64, 1, true);
    const holeMat = new THREE.MeshStandardMaterial({ 
      color: this.rimColor, 
      emissive: this.rimColor,
      emissiveIntensity: 0.5,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.8
    });
    this.holeMesh = new THREE.Mesh(holeGeo, holeMat);
    this.holeMesh.position.y = -12.5;
    this.holeGroup.add(this.holeMesh);

    // Main neon rim
    const rimGeo = new THREE.TorusGeometry(1, 0.12, 16, 64);
    const rimMat = new THREE.MeshStandardMaterial({ 
      color: this.rimColor, 
      emissive: this.rimColor, 
      emissiveIntensity: 4,
      transparent: true,
      opacity: 0.9
    });
    this.holeRim = new THREE.Mesh(rimGeo, rimMat);
    this.holeRim.rotation.x = Math.PI / 2;
    this.holeRim.position.y = 0.05;
    this.holeGroup.add(this.holeRim);

    // Hole Glow Light
    this.holeLight = new THREE.PointLight(this.rimColor, 15, 12);
    this.holeLight.position.y = 1;
    this.holeGroup.add(this.holeLight);

    // Inner shadow rim (Keeping it subtle for depth)
    const shadowRimGeo = new THREE.TorusGeometry(0.96, 0.08, 16, 64);
    const shadowRimMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 });
    const shadowRim = new THREE.Mesh(shadowRimGeo, shadowRimMat);
    shadowRim.rotation.x = Math.PI / 2;
    shadowRim.position.y = -0.1;
    this.holeGroup.add(shadowRim);

    // Hole Trail
    const trailGeo = new THREE.CylinderGeometry(1.05, 1.05, 0.2, 32, 1, true);
    const trailMat = new THREE.MeshBasicMaterial({ color: this.rimColor, transparent: true, opacity: 0, side: THREE.DoubleSide });
    this.holeTrail = new THREE.Mesh(trailGeo, trailMat);
    this.holeTrail.position.y = -0.1;
    this.holeGroup.add(this.holeTrail);

    this.renderer.scene.add(this.holeGroup);
  }

  private setupGround() {
    const isLevel4Plus = this.currentLevel >= 4;
    const groundColor = isLevel4Plus ? '#1a1a2e' : '#c8a887'; 
    const groundGeo = new THREE.PlaneGeometry(600, 600);
    const groundMat = new THREE.MeshStandardMaterial({ color: groundColor, roughness: 0.9, metalness: 0.0 });

    groundMat.onBeforeCompile = (shader) => {
      shader.uniforms.uHolePos = { value: new THREE.Vector3() };
      shader.uniforms.uHoleRadius = { value: INITIAL_HOLE_SIZE };
      shader.uniforms.uHoleColor = { value: new THREE.Vector3(0.0, 0.8, 1.0) }; // Default Cyan

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
        uniform vec3 uHoleColor;
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

        // Deep glow rim around hole edge - REMOVED for original color feel
        // float edgeDist = dist - uHoleRadius;
        // float rimGlow = exp(-edgeDist * 1.2) * 0.35;
        // gl_FragColor.rgb += rimGlow * uHoleColor;
        `
      );
      this.groundShader = shader;
    };

    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    this.renderer.scene.add(groundMesh);
    
    this.setupSkyDome();

    if (isLevel4Plus) {
      const grid = new THREE.GridHelper(600, 60, 0x00f2ff, 0x00f2ff);
      grid.position.y = 0.02;
      grid.material.opacity = 0.1;
      grid.material.transparent = true;
      this.renderer.scene.add(grid);
    }
  }

  private setupLights() {
    this.renderer.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    hemiLight.position.set(0, 50, 0);
    this.renderer.scene.add(hemiLight);

    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(60, 100, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.left = -150;
    sun.shadow.camera.right = 150;
    sun.shadow.camera.top = 150;
    sun.shadow.camera.bottom = -150;
    sun.shadow.bias = -0.0005;
    this.renderer.scene.add(sun);
  }

  private setupSkyDome() {
    // Create a very large sphere for the sky
    const skyGeo = new THREE.SphereGeometry(1000, 32, 32);
    // Invert geometry so faces point inward
    skyGeo.scale(-1, 1, 1);

    const isLevel4Plus = this.currentLevel >= 4;
    const topColor = isLevel4Plus ? '#0a0a2a' : '#87ceeb'; // Deep space or Sky Blue
    const bottomColor = isLevel4Plus ? '#1a1a2e' : '#dde8ff'; // Horizon

    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(topColor) },
        bottomColor: { value: new THREE.Color(bottomColor) },
        offset: { value: 33 },
        exponent: { value: 0.6 }
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + offset).y;
          gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
        }
      `,
      side: THREE.BackSide
    });

    const sky = new THREE.Mesh(skyGeo, skyMat);
    this.renderer.scene.add(sky);
  }

  private setupMinimap() {
    const canvas = document.getElementById('minimap') as HTMLCanvasElement;
    if (canvas) this.minimapCtx = canvas.getContext('2d');
  }

  private loadUserData() {
    const saved = localStorage.getItem('holeio_userdata');
    if (saved) {
      try { 
        this.userData = { ...defaultUserData(), ...JSON.parse(saved) }; 
        this.currentLevel = this.userData.level || 1;
        this.rimColor = this.userData.selectedSkin || '#00f2ff';
        // Apply skin after short delay to ensure everything is initialized
        setTimeout(() => this.changeSkin(this.rimColor), 100);
      } catch (e) {}
    }
    this.ui.updateStats(this.userData);
  }

  private buyUpgrade(type: string) {
    if (type.startsWith('skin:')) {
      const parts = type.split(':');
      const color = parts[1];
      const cost = parseInt(parts[2]);
      if (this.userData.coins >= cost) {
        this.userData.coins -= cost;
        if (!this.userData.unlockedSkins.includes(color)) {
          this.userData.unlockedSkins.push(color);
        }
        this.saveData();
        this.ui.updateStats(this.userData);
      }
      return;
    }

    const upgradeType = type as 'speed' | 'size' | 'suction';
    const level = this.userData.upgrades[upgradeType];
    const cost = level * 100;
    if (this.userData.coins >= cost) {
      this.userData.coins -= cost;
      this.userData.upgrades[upgradeType]++;
      this.saveData();
      this.ui.updateStats(this.userData);
    }
  }

  private saveData() {
    this.userData.level = this.currentLevel;
    localStorage.setItem('holeio_userdata', JSON.stringify(this.userData));
  }

  private changeSkin(color: string) {
    this.rimColor = color;
    this.userData.selectedSkin = color;
    this.saveData();

    const threeColor = new THREE.Color(color);
    const isClassic = color === '#ffffff' || color === '#111111';

    if (this.holeMesh) {
      const meshMat = this.holeMesh.material as THREE.MeshStandardMaterial;
      if (isClassic) {
        meshMat.color.set(0x000000);
        meshMat.emissive.set(0x000000);
        meshMat.emissiveIntensity = 0;
        meshMat.opacity = 1.0;
      } else {
        meshMat.color.copy(threeColor);
        meshMat.emissive.set(0x000000);
        meshMat.emissiveIntensity = 0;
        meshMat.opacity = 0.8;
      }
    }

    if (this.holeRim) {
      const rimMat = this.holeRim.material as THREE.MeshStandardMaterial;
      rimMat.color.copy(threeColor);
      rimMat.emissive.set(0x000000);
      rimMat.emissiveIntensity = 0;
    }

    if (this.holeTrail) {
      (this.holeTrail.material as THREE.MeshBasicMaterial).color.copy(threeColor);
    }

    if (this.holeLight) {
      this.holeLight.color.copy(threeColor);
    }

    if (this.groundShader) {
      this.groundShader.uniforms.uHoleColor.value.set(threeColor.r, threeColor.g, threeColor.b);
    }
  }

  public startGame(mode: GameMode) {
    // 1. Reset Game State Immediately
    this.isEnding = false;
    this.isPlaying = false;
    this.currentGameMode = mode;
    this.score = 0;
    this.sessionCoins = 0;
    this.sizeTier = 1;
    this.growthXP = 0;
    this.feverCharge = 0;
    // Calculate Dynamic Timer based on Level & Difficulty
    let baseTime = 120; // Default 2 mins
    if (mode === GameMode.SOLO) baseTime = 150; // Bonus time for solo map-clearing
    
    // Level Bonus: +10s per level to handle bigger cities
    const levelBonus = (this.currentLevel - 1) * 10;
    const finalSeconds = Math.min(300, baseTime + levelBonus);

    this.timeLeft = mode === GameMode.BATTLE ? -1 : finalSeconds;
    this.startTime = Date.now();
    this.gameDuration = mode === GameMode.BATTLE ? -1 : finalSeconds * 1000;
    
    this.holeSize = INITIAL_HOLE_SIZE + (this.userData.upgrades.size - 1) * 0.35;
    this.holeGroup.scale.set(this.holeSize, 1, this.holeSize);
    this.holeGroup.position.set(0, 0, 0);

    // 2. Clear HUD Immediately
    this.ui.updateScore(0);
    this.ui.updateSessionCoins(0);
    this.ui.updateTimer(this.timeLeft);
    const targetScore = 2000 + (this.currentLevel - 1) * 3000;
    const targetEl = document.getElementById('target-score-indicator');
    if (targetEl) targetEl.innerText = `TARGET: ${targetScore}`;
    const hudLvl = document.getElementById('hud-level');
    if (hudLvl) hudLvl.innerText = this.currentLevel.toString();

    // 3. Total Physics & Object Reset
    this.levelGen.cleanup(this.objects, this.sceneryMeshes);
    this.objects = [];
    this.sceneryMeshes = [];

    // Reset physics world to wipe all bodies/colliders clean
    const currentSpread = Math.min(250, 100 + this.currentLevel * 10);
    this.physics.resetWorld(currentSpread);

    // 4. Generate New World
    try {
      const res = this.levelGen.generate(this.currentLevel);
      this.objects = res.objects;
      this.sceneryMeshes = res.scenery;
    } catch (e) {
      const res = this.levelGen.generate(1);
      this.objects = res.objects;
      this.sceneryMeshes = res.scenery;
    }

    this.bots.cleanup();
    this.bots.createBots(Math.min(8, 3 + Math.floor(this.currentLevel / 2)));

    // 4. Start Transition
    this.ui.fadeTransition(() => {
      this.ui.showHUD(mode);
      this.isPlaying = true;
      this.startMissionsCount = this.userData.missionsCompleted;
    this.startMission();
      if (this.currentLevel > 1) {
        this.ui.showLevelSplash(this.currentLevel);
      }
    });
  }

  private startTime: number = 0;
  private gameDuration: number = 120 * 1000;

  private endGame() {
    if (this.isEnding) return;
    this.isEnding = true;
    this.isPlaying = false;

    try {
      this.sessionCoins = Math.floor(this.score / 500);
      this.userData.coins += this.sessionCoins;
      if (this.score > this.userData.highScore) this.userData.highScore = this.score;
      this.userData.xp += Math.floor(this.score / 100);
      
      let won = false;

      if (this.currentGameMode === GameMode.CLASSIC || this.currentGameMode === GameMode.DAILY) {
        // WIN BY MISSIONS: Complete 5 missions to pass the level
        const missionsInRound = this.userData.missionsCompleted - this.startMissionsCount;
        won = missionsInRound >= 5;
      } else if (this.currentGameMode === GameMode.SOLO) {
        const totalObjs = this.objects.length;
        const eaten = this.objects.filter(o => o.consumed).length;
        const pct = (eaten / totalObjs) * 100;
        won = pct >= 90; 
      } else if (this.currentGameMode === GameMode.BATTLE) {
        const botsAlive = this.bots.getBots().filter(b => b.mesh.visible).length;
        won = botsAlive === 0; 
      }
      
      if (won) {
        this.currentLevel++;
        this.handleLevelRewards();
      }

      this.saveData();
      this.ui.updateStats(this.userData);
      this.ui.showEndScreen(this.score, this.sessionCoins, this.userData, won);
    } catch (e) {
      console.error("EndGame error:", e);
      // Fallback: still show end screen
      this.ui.showEndScreen(this.score, 0, this.userData, false);
    }
  }

  private handleLevelRewards() {
    // Level 2: Unlock new hole skin (PINK)
    if (this.currentLevel >= 2 && !this.userData.unlockedSkins.includes('#ff66cc')) {
      this.userData.unlockedSkins.push('#ff66cc');
    }
    // Suction boost milestone
    if (this.currentLevel === 3) this.userData.upgrades.suction++;
  }

  private animate() {
    requestAnimationFrame(() => this.animate());
    
    // Always update shader uniforms to prevent "black disc" visual issue
    if (this.groundShader) {
      this.groundShader.uniforms.uHolePos.value.copy(this.holeGroup.position);
      this.groundShader.uniforms.uHoleRadius.value = this.holeSize;
    }

    this.frameCount++;

    if (this.isPlaying) {
      this.updateControls();
      if (this.gameDuration > 0) {
        const elapsed = Date.now() - this.startTime;
        const remaining = Math.max(0, Math.ceil((this.gameDuration - elapsed) / 1000));
        if (remaining !== this.timeLeft) {
          this.timeLeft = remaining;
          this.ui.updateTimer(this.timeLeft);
        }
        if (remaining <= 0) {
          this.endGame();
          return;
        }
      }

      // 2. Physics stability: 2 substeps per frame
      const substeps = 2;
      for (let i = 0; i < substeps; i++) {
        this.physics.update(1 / (60 * substeps));
      }
      
      this.updatePlayerMovement();
      this.updatePlayerHole();
      this.updateBotHoles();
      this.updateFever();
      
      if (this.groundShader) {
        this.groundShader.uniforms.uHolePos.value.copy(this.holeGroup.position);
        this.groundShader.uniforms.uHoleRadius.value = this.holeSize;
      }
      
      const camY = 24 + this.holeSize * 2.2;
      const camZ = 22 + this.holeSize * 1.8;
      const targetCam = new THREE.Vector3(this.holeGroup.position.x, camY, this.holeGroup.position.z + camZ);
      this.renderer.camera.position.lerp(targetCam, 0.08);
      this.renderer.camera.lookAt(this.holeGroup.position.x, 0, this.holeGroup.position.z);
      
      const updateSlow = this.frameCount % 5 === 0;
      const updateVerySlow = this.frameCount % 15 === 0;

      // Sync positions: only if the body is active/moving
      for (let i = 0, len = this.objects.length; i < len; i++) {
        const obj = this.objects[i];
        if (obj.consumed) continue;
        
        // Performance: Rapier bodies sleep when stable
        if (!obj.body.isSleeping()) {
          const t = obj.body.translation();
          const r = obj.body.rotation();
          obj.mesh.position.set(t.x, t.y, t.z);
          obj.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        }
      }

      if (updateSlow) {
        this.updateLeaderboard();
      }
      if (updateVerySlow) {
        this.updateMinimap();
      }
    }
    this.renderer.render();
  }

  private updatePlayerMovement() {
    // Base speed + upgrade bonus
    let baseSpeed = (0.24 + (this.userData.upgrades.speed - 1) * 0.06) * 1.8;
    if (this.feverCharge > 80) baseSpeed *= 1.5;
    
    // Scale speed by mouse distance for more "joystick" feel
    const currentSpeed = baseSpeed; 
    
    const limit = 280; // Expand from 120 to 280
    
    // Magnetic Assist: Subtly pull the hole toward the nearest edible object
    let assistX = 0;
    let assistZ = 0;
    const assistRange = 12 + this.holeSize * 2;
    const assistStrength = 0.05 + (this.userData.upgrades.suction - 1) * 0.02;

    let nearestDist = assistRange;
    let nearestObj = null;

    for (let i = 0; i < this.objects.length; i++) {
      const obj = this.objects[i];
      if (obj.consumed || obj.tier > this.sizeTier) continue;
      
      const dx = obj.mesh.position.x - this.holeGroup.position.x;
      const dz = obj.mesh.position.z - this.holeGroup.position.z;
      const dSq = dx*dx + dz*dz;
      
      if (dSq < nearestDist * nearestDist) {
        nearestDist = Math.sqrt(dSq);
        nearestObj = obj;
      }
    }

    if (nearestObj) {
      const pullDir = new THREE.Vector3().subVectors(nearestObj.mesh.position, this.holeGroup.position).normalize();
      assistX = pullDir.x * assistStrength;
      assistZ = pullDir.z * assistStrength;
    }

    // Apply movement with assist
    this.holeGroup.position.x = Math.max(-limit, Math.min(limit, this.holeGroup.position.x + (this.moveDir.x * currentSpeed) + assistX));
    this.holeGroup.position.z = Math.max(-limit, Math.min(limit, this.holeGroup.position.z + (this.moveDir.z * currentSpeed) + assistZ));
    
    // Update trail
    if (this.currentLevel >= 6 && this.holeTrail) {
      const trailMat = this.holeTrail.material as THREE.MeshBasicMaterial;
      trailMat.opacity = Math.max(0, (this.feverCharge / 100) * 0.8);
      this.holeTrail.scale.y = 1 + (this.feverCharge / 100) * 2;
    }

    // Battle Mode: Eat Bots
    if (this.currentGameMode === GameMode.BATTLE || true) { // Enable in all modes for fun
      this.bots.getBots().forEach(bot => {
        if (!bot.mesh.visible) return;
        const dist = this.holeGroup.position.distanceTo(bot.mesh.position);
        
        // Use physical size comparison instead of strict tiers
        if (dist < this.holeSize * 0.9) {
          if (this.holeSize > bot.size + 0.1) {
            this.eatBot(bot);
          } else if (bot.size > this.holeSize + 0.1) {
            if (this.currentGameMode === GameMode.BATTLE) {
              this.endGame(); // Player eaten!
            }
          }
        }
      });
    }
  }

  private updatePlayerHole() {
    const radius = this.holeGroup.scale.x;
    const suctionRangeSq = (radius * 1.5) * (radius * 1.5);
    const feedbackRangeSq = (radius * 2.5) * (radius * 2.5);
    
    let suctionBase = 1.0 + (this.userData.upgrades.suction - 1) * 0.3;
    if (this.currentLevel >= 3) suctionBase *= 1.05;

    const px = this.holeGroup.position.x;
    const pz = this.holeGroup.position.z;

    for (let i = 0, len = this.objects.length; i < len; i++) {
      const obj = this.objects[i];
      if (obj.consumed) continue;

      const ox = obj.mesh.position.x;
      const oz = obj.mesh.position.z;
      const dx = px - ox;
      const dz = pz - oz;
      const distSq = dx * dx + dz * dz;

      // 1. Visual Feedback (Throttled)
      if (this.frameCount % 2 === 0 && distSq < feedbackRangeSq) {
        const dist = Math.sqrt(distSq);
        const proximity = 1.0 - Math.min(1, dist / (radius * 2.5));
        
        const wobble = 1.0 + Math.sin(Date.now() * 0.02) * 0.1 * proximity;
        obj.mesh.scale.set(wobble, wobble, wobble);

        if (obj.tier > this.sizeTier) {
          const firstChild = obj.mesh.children[0] as THREE.Mesh;
          if (firstChild && firstChild.material) {
            // Feedback without glowing
          }
        } else {
          const firstChild = obj.mesh.children[0] as THREE.Mesh;
          if (firstChild && firstChild.material) {
            // Feedback without glowing
          }
        }
      } else if (obj.mesh.scale.x !== 1) {
        obj.mesh.scale.set(1, 1, 1);
      }

      // 2. Physics / Suction
      if (distSq < suctionRangeSq) {
        if (obj.tier <= this.sizeTier) {
          const moveSpeed = this.moveDir.length();
          const speedFactor = 1 + moveSpeed * 3.5;
          const dist = Math.sqrt(distSq);
          const pull = (1 - dist / (radius * 1.5)) * suctionBase * 4.5 * speedFactor;
          
          const dirX = dx / (dist || 1);
          const dirZ = dz / (dist || 1);
          obj.body.applyImpulse({ x: dirX * pull, y: -9.5, z: dirZ * pull }, true);
          
          const threshold = moveSpeed > 0.05 ? 0.72 : 0.58;
          if (dist < radius * threshold) {
            this.consumeObject(obj);
          }
        }
      }
    }
  }

  private consumeObject(obj: GameObject) {
    if (obj.consumed) return;
    obj.consumed = true;

    // Mission Progress Tracking
    this.activeMissions.forEach((m, idx) => {
      if (!m.completed && obj.type === m.type) {
        m.current++;
        this.updateMissionUI();
        if (m.current >= m.target) {
          this.completeMission(idx);
        }
      }
    });

    this.score += obj.mass;
    this.growthXP += obj.mass;
    this.feverCharge = Math.min(100, this.feverCharge + 8);
    this.lastEatTime = Date.now();
    
    // Visual Swallowing Animation
    gsap.to(obj.mesh.scale, { 
      x: 0.1, y: 0.1, z: 0.1, 
      duration: 0.25, 
      onComplete: () => {
        obj.mesh.visible = false;
        this.renderer.scene.remove(obj.mesh);
        try { this.physics.world.removeRigidBody(obj.body); } catch (e) {}
      }
    });

    // this.triggerConsumptionFlash(obj.mesh.position);

    // Growth check (Fixed: Carry over excess XP)
    let threshold = this.sizeTier * 7000;
    while (this.growthXP >= threshold) {
      this.sizeTier++;
      this.holeSize += 0.8;
      gsap.to(this.holeGroup.scale, { x: this.holeSize, z: this.holeSize, duration: 0.6, ease: 'back.out' });
      this.growthXP -= threshold;
      threshold = this.sizeTier * 7000;
      this.showGrowthFeedback();
      
      // Trigger a special effect for major level ups
      if (this.sizeTier % 5 === 0) {
        this.triggerScreenShake();
      }
    }

    this.ui.updateScore(this.score);
    this.updateGrowthBar();
    this.showScorePopup(obj.mass, obj.mesh.position);
    this.updateMissionUI(); // Update UI immediately

    // Solo Mode: Check if city is 90% clean to end game instantly
    if (this.currentGameMode === GameMode.SOLO) {
      const totalObjs = this.objects.length;
      const eaten = this.objects.filter(o => o.consumed).length;
      const pct = (eaten / totalObjs) * 100;
      if (pct >= 90) {
        setTimeout(() => this.endGame(), 1000);
      }
    }
  }

  /*
  private triggerConsumptionFlash(pos: THREE.Vector3) {
    const flash = new THREE.PointLight(0x00f2ff, 10, 8);
    flash.position.copy(pos);
    this.renderer.scene.add(flash);
    gsap.to(flash, { intensity: 0, duration: 0.4, onComplete: () => this.renderer.scene.remove(flash) });
  }
  */

  private eatBot(bot: any) {
    bot.mesh.visible = false;
    this.score += 5000;
    this.growthXP += 5000;
    this.showScorePopup(5000, bot.mesh.position);
    this.triggerScreenShake();
    
    // Show Kill Banner (Elimination Popup)
    this.showKillFeedback(bot.name);

    // Refresh leaderboard and Battle objective immediately
    this.updateLeaderboard();
    this.updateMissionUI();
    
    // Check for Battle win
    const botsAlive = this.bots.getBots().filter(b => b.mesh.visible).length;
    if (botsAlive === 0 && this.currentGameMode === GameMode.BATTLE) {
      this.endGame();
    }
  }

  private showKillFeedback(botName: string) {
    const el = document.createElement('div');
    el.className = 'moment';
    el.innerHTML = `<h2 style="color:#ff3e00; text-shadow: 0 0 40px #ff3e00; font-size:3rem; -webkit-text-stroke: 2px #fff;">ELIMINATED<br><span style="color:#fff; font-size:1.8rem; -webkit-text-stroke: 0px;">${botName}</span></h2>`;
    document.getElementById('app')?.appendChild(el);
    
    gsap.fromTo(el, { scale: 0.2, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out' });
    gsap.to(el, { opacity: 0, scale: 1.5, y: -100, duration: 1, delay: 0.7, onComplete: () => el.remove() });
  }

  private triggerScreenShake() {
    const canvas = document.getElementById('canvas-container');
    if (canvas) {
      gsap.fromTo(canvas, 
        { x: -5, y: -5 }, 
        { x: 0, y: 0, duration: 0.1, repeat: 3, ease: "power2.inOut", onComplete: () => { canvas.style.transform = ''; } }
      );
    }
  }

  private hasReachedGoal = false;

  private updateGrowthBar() {
    const bar = document.getElementById('growth-bar');
    const threshold = this.sizeTier * 7000;
    const pct = Math.min(100, (this.growthXP / threshold) * 100);
    if (bar) bar.style.width = `${pct}%`;
    
    const targetEl = document.getElementById('target-score-indicator');
    if (targetEl) targetEl.innerText = `NEXT SIZE: ${threshold}`;

    const tierEl = document.getElementById('size-tier');
    if (tierEl) tierEl.innerText = this.sizeTier.toString();

    // Mission-based Victory moment check
    const allMissionsDone = this.activeMissions.every(m => m.completed);
    if (allMissionsDone && !this.hasReachedGoal) {
      this.hasReachedGoal = true;
      this.showVictoryMoment();
    }
  }

  private showVictoryMoment() {
    const el = document.getElementById('level-up');
    if (el) {
      const h2 = el.querySelector('h2');
      if (h2) h2.innerText = "GOAL REACHED! 🏆";
      el.classList.remove('hidden');
      setTimeout(() => el.classList.add('hidden'), 2000);
    }
    // Reward: Extra speed for the rest of the match
    this.moveDir.multiplyScalar(1.5);
  }

  private showGrowthFeedback() {
    const el = document.getElementById('growth-feedback');
    if (el) {
      gsap.fromTo(el, { opacity: 1, scale: 0.5 }, { opacity: 0, scale: 1.5, duration: 1, ease: 'power2.out' });
    }
    // this.triggerGrowthDome();
  }

  /*
  private triggerGrowthDome() {
    const domeGeo = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMat = new THREE.MeshBasicMaterial({ 
      color: this.rimColor, 
      transparent: true, 
      opacity: 0.4, 
      side: THREE.DoubleSide 
    });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.copy(this.holeGroup.position);
    this.renderer.scene.add(dome);
    
    gsap.fromTo(dome.scale, 
      { x: this.holeSize, y: 0.1, z: this.holeSize }, 
      { x: this.holeSize * 5, y: this.holeSize * 3, z: this.holeSize * 5, duration: 1.0, ease: 'power3.out' }
    );
    gsap.to(domeMat, { 
      opacity: 0, 
      duration: 1.0, 
      ease: 'power2.in',
      onComplete: () => {
        this.renderer.scene.remove(dome);
        domeGeo.dispose();
        domeMat.dispose();
      }
    });
  }
  */

  private showScorePopup(amount: number, _pos: THREE.Vector3) {
    const popup = document.createElement('div');
    popup.className = 'score-popup';
    popup.innerText = `+${amount}`;
    popup.style.left = '50%';
    popup.style.top = '50%';
    document.getElementById('app')?.appendChild(popup);
    gsap.fromTo(popup, { opacity: 1, y: 0 }, { opacity: 0, y: -100, duration: 0.8, onComplete: () => popup.remove() });
  }

  private updateFever() {
    if (Date.now() - this.lastEatTime > 1500) {
      // Level 7 Reward: Slower fever decay
      const decayRate = this.currentLevel >= 7 ? 0.35 : 0.7;
      this.feverCharge = Math.max(0, this.feverCharge - decayRate);
    }
    const intensity = this.feverCharge / 100;
    (this.holeRim.material as THREE.MeshStandardMaterial).emissiveIntensity = 3 + intensity * 8;
    const bar = document.getElementById('fever-bar');
    if (bar) bar.style.width = `${this.feverCharge}%`;
  }

  private updateBotHoles() {
    this.bots.update(1/60, this.objects, this.holeGroup.position, this.holeSize);
  }

  private updateMinimap() {
    if (!this.minimapCtx) return;
    const ctx = this.minimapCtx;
    const size = 120;
    ctx.clearRect(0, 0, size, size);
    
    // Glass background
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, size, size);

    const scale = size / 600; // Map area is -300 to 300
    
    // Draw Objects (Small Gray Dots)
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    this.objects.forEach(obj => {
      if (obj.consumed) return;
      const ox = (obj.mesh.position.x + 300) * scale;
      const oz = (obj.mesh.position.z + 300) * scale;
      ctx.fillRect(ox, oz, 1.5, 1.5);
    });

    // Draw Bots (Red Dots)
    ctx.fillStyle = '#ff4444';
    this.bots.getBots().forEach(bot => {
      if (!bot.mesh.visible) return;
      const bx = (bot.mesh.position.x + 300) * scale;
      const bz = (bot.mesh.position.z + 300) * scale;
      ctx.beginPath();
      ctx.arc(bx, bz, 2, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw Player (Skin Colored Dot with Glow)
    const px = (this.holeGroup.position.x + 300) * scale;
    const pz = (this.holeGroup.position.z + 300) * scale;
    
    ctx.shadowBlur = 10;
    ctx.shadowColor = this.rimColor;
    ctx.fillStyle = this.rimColor;
    ctx.beginPath();
    ctx.arc(px, pz, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0; // Reset for next frame
  }

  private updateLeaderboard() {
    const mini = document.getElementById('leaderboard-mini');
    if (!mini) return;

    // Filter out bots that have been eaten (visible: false)
    const aliveBots = this.bots.getBots().filter(b => b.mesh.visible);
    const scores = [
      { name: 'YOU', score: this.score }, 
      ...aliveBots.map(b => ({ name: b.name, score: b.score }))
    ];
    
    scores.sort((a, b) => b.score - a.score);
    
    mini.innerHTML = scores.map((s, i) => `
      <div class="mini-entry ${s.name === 'YOU' ? 'player' : ''}">
        ${i + 1}. ${s.name} — ${s.score}
      </div>
    `).join('');
  }

  // Mission System
  private activeMissions: { type: string, target: number, current: number, label: string, icon: string, completed: boolean }[] = [];

  private startMission() {
    this.activeMissions = [];
    const container = document.getElementById('mission-container');
    if (!container) return;

    if (this.currentGameMode === GameMode.BATTLE || this.currentGameMode === GameMode.SOLO) {
      // Show Battle/Solo Objective instead of missions
      this.updateMissionUI();
      return;
    }

    const missionCount = this.currentLevel >= 5 ? 3 : (this.currentLevel >= 3 ? 2 : 1);
    
    const possibleMissions = [
      { name: 'Car', label: 'EAT %n CARS', count: 10 + this.currentLevel * 2, icon: '🚗' },
      { name: 'Burger', label: 'EAT %n BURGERS', count: 15 + this.currentLevel * 2, icon: '🍔' },
      { name: 'Soda', label: 'EAT %n SODAS', count: 15 + this.currentLevel * 3, icon: '🥤' },
      { name: 'Skyscraper', label: 'EAT %n SKYSCRAPERS', count: 2 + Math.floor(this.currentLevel / 3), icon: '🏙️' },
      { name: 'Cake', label: 'EAT %n CAKES', count: 5 + this.currentLevel, icon: '🍰' },
      { name: 'Donut', label: 'EAT %n DONUTS', count: 15 + this.currentLevel * 2, icon: '🍩' },
      { name: 'IceCream', label: 'EAT %n ICE CREAMS', count: 10 + this.currentLevel * 2, icon: '🍦' },
      { name: 'Tree', label: 'EAT %n TREES', count: 20 + this.currentLevel * 3, icon: '🌳' },
      { name: 'Bench', label: 'EAT %n BENCHES', count: 15 + this.currentLevel * 2, icon: '🪑' },
      { name: 'Bus', label: 'EAT %n BUSES', count: 4 + Math.floor(this.currentLevel / 2), icon: '🚌' }
    ];

    // Shuffle and pick UNIQUE missions
    const shuffled = possibleMissions.sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(missionCount, shuffled.length); i++) {
      const m = shuffled[i];
      this.activeMissions.push({
        type: m.name,
        target: m.count,
        current: 0,
        label: m.label.replace('%n', m.count.toString()),
        icon: m.icon,
        completed: false
      });
    }
    this.updateMissionUI();
  }

  private updateMissionUI() {
    const container = document.getElementById('mission-container');
    if (!container) return;
    
    // CLEAR EVERYTHING FIRST to prevent duplication
    container.innerHTML = '';

    if (this.currentGameMode === GameMode.CLASSIC || this.currentGameMode === GameMode.DAILY) {
       const done = this.userData.missionsCompleted - this.startMissionsCount;
       const goal = 5;
       const header = document.createElement('div');
       header.className = 'mission-header-goal';
       header.style.textAlign = 'center';
       header.style.padding = '8px';
       header.style.marginBottom = '10px';
       header.style.borderBottom = '1px solid rgba(255,255,255,0.2)';
       header.style.color = done >= goal ? '#00ff88' : '#ffaa00';
       header.innerHTML = `<strong>WIN GOAL: ${done}/${goal} MISSIONS</strong>`;
       container.appendChild(header);
    }

    if (this.currentGameMode === GameMode.BATTLE) {
      const botsAlive = this.bots.getBots().filter(b => b.mesh.visible).length;
      const div = document.createElement('div');
      div.className = 'mission-item battle-objective';
      div.innerHTML = `
        <div class="mission-text"><span style="font-size:1.5rem; margin-right:10px;">💀</span> ELIMINATE ALL BOTS <span class="mission-count">(${botsAlive} LEFT)</span></div>
        <div class="mission-progress-bg">
          <div class="mission-progress-bar" style="width: ${((8 - botsAlive) / 8) * 100}%; background: #ff3e00;"></div>
        </div>
      `;
      container.appendChild(div);
      return;
    }

    if (this.currentGameMode === GameMode.SOLO) {
      const totalObjs = this.objects.length;
      const eaten = this.objects.filter(o => o.consumed).length;
      const pct = Math.floor((eaten / totalObjs) * 100);
      const div = document.createElement('div');
      div.className = 'mission-item solo-objective';
      div.innerHTML = `
        <div class="mission-text"><span style="font-size:1.5rem; margin-right:10px;">🧹</span> CITY CLEANED <span class="mission-count">(${pct}%)</span></div>
        <div class="mission-progress-bg">
          <div class="mission-progress-bar" style="width: ${Math.min(100, (pct / 90) * 100)}%; background: #00f2ff;"></div>
        </div>
        <div style="font-size:0.7rem; color:#aaa; margin-top:5px;">GOAL: 90% CLEARANCE</div>
      `;
      container.appendChild(div);
      return;
    }

    this.activeMissions.forEach((m) => {
      const div = document.createElement('div');
      div.className = `mission-item ${m.completed ? 'completed' : ''}`;
      const pct = (m.current / m.target) * 100;
      div.innerHTML = `
        <div class="mission-text">
          <span style="font-size:1.4rem; margin-right:10px;">${m.icon}</span>
          ${m.label} 
          <span class="mission-count">(${m.current}/${m.target})</span> 
          ${m.completed ? '✅' : ''}
        </div>
        <div class="mission-progress-bg">
          <div class="mission-progress-bar" style="width: ${Math.min(100, pct)}%"></div>
        </div>
      `;
      container.appendChild(div);
    });
  }

  private completeMission(missionIdx: number) {
    const m = this.activeMissions[missionIdx];
    if (m.completed) return;
    m.completed = true;
    m.current = m.target;
    this.updateMissionUI();

    // Visual animation in HUD
    const container = document.getElementById('mission-container');
    if (container) {
      const items = container.querySelectorAll('.mission-item');
      const targetItem = items[missionIdx] as HTMLElement;
      if (targetItem) {
        targetItem.classList.add('just-completed');
        // Golden Flash & Shake
        gsap.to(targetItem, { 
          backgroundColor: '#ffaa00', 
          scale: 1.1, 
          duration: 0.2, 
          yoyo: true, 
          repeat: 3,
          onComplete: () => {
             targetItem.style.backgroundColor = '';
             targetItem.style.scale = '';
          }
        });
      }
    }

    // Hole Feedback: Golden Pulse
    if (this.holeRim) {
      const rimMat = this.holeRim.material as THREE.MeshStandardMaterial;
      gsap.to(rimMat, { emissiveIntensity: 25, duration: 0.3, yoyo: true, repeat: 1 });
      if (this.holeLight) {
        gsap.to(this.holeLight, { intensity: 100, duration: 0.3, yoyo: true, repeat: 1 });
      }
    }

    this.userData.missionsCompleted++;
    if (this.userData.missionsCompleted % 5 === 0) {
      this.userData.stars++;
    }
    
    this.score += 5000;
    this.sessionCoins += 200; 
    this.ui.updateSessionCoins(this.sessionCoins); // Update HUD
    this.saveData();

    // Visual feedback Banner
    const el = document.getElementById('level-up');
    if (el) {
       const h2 = el.querySelector('h2');
       if (h2) {
         h2.innerHTML = `<span style="font-size:3rem; color:#ffaa00; text-shadow: 0 0 30px #ffaa00;">MISSION COMPLETE!</span><br><span style="font-size:1.5rem;">+5,000 PTS ⭐ +200 🪙</span>`;
       }
       el.classList.remove('hidden');
       gsap.fromTo(el, { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out' });
       setTimeout(() => {
         gsap.to(el, { opacity: 0, scale: 2, duration: 0.5, onComplete: () => el.classList.add('hidden') });
       }, 1800);
    }

    this.triggerScreenShake();

    // INSTANT WIN: If this was the 5th mission, end the game immediately!
    if (this.currentGameMode === GameMode.CLASSIC || this.currentGameMode === GameMode.DAILY) {
      const done = this.userData.missionsCompleted - this.startMissionsCount;
      if (done >= 5) {
        setTimeout(() => this.endGame(), 1200); // 1.2s delay to see the banner
        return; // Don't spawn a new mission
      }
    }

    // INFINITE MISSIONS: Replace this mission with a new one after 1.5 seconds
    setTimeout(() => {
      if (this.currentGameMode === GameMode.BATTLE) return;
      
      const possibleMissions = [
        { name: 'Car', label: 'EAT %n CARS', count: 10 + this.currentLevel * 2, icon: '🚗' },
        { name: 'Burger', label: 'EAT %n BURGERS', count: 15 + this.currentLevel * 2, icon: '🍔' },
        { name: 'Soda', label: 'EAT %n SODAS', count: 15 + this.currentLevel * 3, icon: '🥤' },
        { name: 'Skyscraper', label: 'EAT %n SKYSCRAPERS', count: 2 + Math.floor(this.currentLevel / 3), icon: '🏙️' },
        { name: 'Cake', label: 'EAT %n CAKES', count: 5 + this.currentLevel, icon: '🍰' }
      ];
      
      // Filter out missions where the objects are all gone
      const validMissions = possibleMissions.filter(pm => {
        return this.objects.some(obj => !obj.consumed && obj.type === pm.name);
      });

      const pool = validMissions.length > 0 ? validMissions : possibleMissions;
      const next = pool[Math.floor(Math.random() * pool.length)];
      
      this.activeMissions[missionIdx] = {
        type: next.name,
        target: next.count,
        current: 0,
        label: next.label.replace('%n', next.count.toString()),
        icon: next.icon,
        completed: false
      };
      this.updateMissionUI();
    }, 1500);
  }

  private keys: Record<string, boolean> = {};

  private setupControls() {
    window.addEventListener('keydown', (e) => this.keys[e.code] = true);
    window.addEventListener('keyup', (e) => this.keys[e.code] = false);

    let isMouseDown = false;
    window.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).tagName !== 'CANVAS' && (e.target as HTMLElement).id !== 'canvas-container') return;
      isMouseDown = true;
    });
    window.addEventListener('mouseup', () => { 
      isMouseDown = false; 
      this.mouseDir.set(0,0,0); 
    });
    window.addEventListener('mousemove', (e) => {
      if (!isMouseDown || !this.isPlaying) return;
      const dx = e.clientX - window.innerWidth / 2;
      const dy = e.clientY - window.innerHeight / 2;
      const dist = Math.sqrt(dx*dx + dy*dy);
      
      // Use a deadzone of 10px, but scale speed after that
      if (dist > 10) {
        // Normalize direction
        this.mouseDir.x = dx / dist;
        this.mouseDir.z = dy / dist;
        
        // Scale strength based on distance (max speed reached at 150px)
        const strength = Math.min(1.0, dist / 150);
        this.mouseDir.multiplyScalar(strength);
      } else {
        this.mouseDir.set(0, 0, 0);
      }
    });
  }

  private updateControls() {
    if (!this.isPlaying) return;
    
    // 1. Reset movement dir
    this.moveDir.set(0, 0, 0);

    // 2. Add Keyboard input
    if (this.keys['KeyW'] || this.keys['ArrowUp'])    this.moveDir.z -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown'])  this.moveDir.z += 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft'])  this.moveDir.x -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) this.moveDir.x += 1;

    // 3. Add Mouse input if active
    if (this.mouseDir.lengthSq() > 0) {
      this.moveDir.add(this.mouseDir);
    }

    // 4. Finalize
    if (this.moveDir.lengthSq() > 0) {
      this.moveDir.normalize();
    }
  }
}
