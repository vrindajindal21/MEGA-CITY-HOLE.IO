import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { GameObject } from '../types';
import type { Physics } from '../core/Physics';

interface TierDef {
  name:    string;
  count:   number;
  w: number; h: number; d: number;
  mass:    number;
  color:   string;
  tierIdx: number;
}

export interface LevelResult {
  objects: GameObject[];
  scenery: THREE.Object3D[];
}

export class LevelGenerator {
  private scene:   THREE.Scene;
  private physics: Physics;
  private geoPool: Map<string, THREE.BufferGeometry> = new Map();
  private matPool: Map<string, THREE.Material> = new Map();

  constructor(scene: THREE.Scene, physics: Physics) {
    this.scene   = scene;
    this.physics = physics;
    this.initPools();
  }

  private initPools() {
    this.geoPool.set('box', new THREE.BoxGeometry(1, 1, 1));
    this.geoPool.set('cylinder', new THREE.CylinderGeometry(1, 1, 1, 24));
    this.geoPool.set('sphere', new THREE.SphereGeometry(1, 24, 16));
    this.geoPool.set('dodeca', new THREE.DodecahedronGeometry(1));
  }

  public generate(level: number): LevelResult {
    const objects: GameObject[]    = [];
    const scenery: THREE.Object3D[] = [];
    
    // Scale difficulty: more objects as level increases, but cap at 6x for performance
    const countMultiplier = Math.min(6, 1 + (level - 1) * 0.35);
    const spread = Math.min(250, 100 + level * 10);

    const tiers: TierDef[] = [];
    
    // Level 1: Basics
    tiers.push({ name: 'Cookie',     count: Math.floor(160 * countMultiplier), w: 1.8, h: 0.5,  d: 1.8, mass: 120,   color: '#D2A679', tierIdx: 1 });
    tiers.push({ name: 'Soda',       count: Math.floor(70 * countMultiplier),  w: 1.2, h: 2.4,  d: 1.2, mass: 180,   color: '#ff3e00', tierIdx: 1 });
    tiers.push({ name: 'Macaron',    count: Math.floor(80 * countMultiplier),  w: 2.4, h: 2.0,  d: 2.4, mass: 380,   color: '#FFB7C5', tierIdx: 1 });

    // Level 2+: Bakery Favorites
    if (level >= 2) {
      tiers.push({ name: 'Cupcake',    count: Math.floor(100 * countMultiplier), w: 2.0, h: 2.2,  d: 2.0, mass: 250,   color: '#FFB7C5', tierIdx: 1 });
      tiers.push({ name: 'Burger',     count: Math.floor(60 * countMultiplier),  w: 3.0, h: 2.5,  d: 3.0, mass: 650,   color: '#FFA500', tierIdx: 2 });
    }

    // Level 3+: Fast Food
    if (level >= 3) {
      tiers.push({ name: 'Donut',      count: Math.floor(50 * countMultiplier),  w: 3.2, h: 1.2,  d: 3.2, mass: 900,   color: '#FF69B4', tierIdx: 2 });
      tiers.push({ name: 'Pizza',      count: Math.floor(40 * countMultiplier),  w: 4.5, h: 0.8,  d: 4.5, mass: 1200,  color: '#FFD700', tierIdx: 2 });
    }

    // Level 4+: Large Desserts
    if (level >= 4) {
      tiers.push({ name: 'Cake',       count: Math.floor(25 * countMultiplier),  w: 7.0, h: 5.5,  d: 7.0, mass: 5500,  color: '#FFFDD0', tierIdx: 3 });
      tiers.push({ name: 'IceCream',   count: Math.floor(20 * countMultiplier),  w: 3.5, h: 8.0,  d: 3.5, mass: 3000,  color: '#A52A2A', tierIdx: 3 });
    }

    // Level 5+: Landmarks
    if (level >= 5) {
      tiers.push({ name: 'Tower',      count: Math.floor(10 * countMultiplier),  w: 5.0, h: 14.0, d: 5.0, mass: 15000, color: '#E6E6FA', tierIdx: 4 });
      tiers.push({ name: 'GiantDonut', count: 2 + Math.floor(level/3),           w: 15, h: 5, d: 15, mass: 50000, color: '#FFD700', tierIdx: 5 });
    }

    // New Detail Items
    tiers.push({ name: 'Car',         count: Math.floor(15 * countMultiplier),  w: 4.5, h: 2.2, d: 2.5, mass: 2000,  color: '#ffdd00', tierIdx: 2 });
    tiers.push({ name: 'Streetlight', count: Math.floor(20 * countMultiplier),  w: 1.0, h: 8.0, d: 1.0, mass: 500,   color: '#333',     tierIdx: 1 });
    tiers.push({ name: 'Bench',       count: Math.floor(25 * countMultiplier),  w: 3.5, h: 1.2, d: 1.5, mass: 400,   color: '#8B4513', tierIdx: 1 });

    // Spawn items in organized clusters
    tiers.forEach(tier => {
      const clusterCount = Math.max(1, Math.floor(tier.count / 15));
      const itemsPerCluster = Math.floor(tier.count / clusterCount);

      for (let c = 0; c < clusterCount; c++) {
        // Random cluster center
        const cAngle = Math.random() * Math.PI * 2;
        const cDist  = 10 + Math.random() * (spread - 10);
        const cx     = Math.cos(cAngle) * cDist;
        const cz     = Math.sin(cAngle) * cDist;

        // Patterns unlocked by level
        const availablePatterns = ['grid', 'circle'];
        if (level >= 2) availablePatterns.push('heart');
        if (level >= 3) availablePatterns.push('star');
        if (level >= 4) availablePatterns.push('diamond');
        if (level >= 5) availablePatterns.push('spiral', 'scurve');

        const pattern = availablePatterns[Math.floor(Math.random() * availablePatterns.length)];

        for (let i = 0; i < itemsPerCluster; i++) {
          let ox = 0, oz = 0;
          const t = (i / itemsPerCluster);
          
          if (pattern === 'grid') {
            const cols = Math.ceil(Math.sqrt(itemsPerCluster));
            ox = ((i % cols) - cols / 2) * (tier.w * 1.5);
            oz = (Math.floor(i / cols) - cols / 2) * (tier.d * 1.5);
          } else if (pattern === 'circle') {
            const pAngle = t * Math.PI * 2;
            const pDist  = (tier.w * 1.2) * (1 + Math.floor(i / 8));
            ox = Math.cos(pAngle) * pDist;
            oz = Math.sin(pAngle) * pDist;
          } else if (pattern === 'heart') {
            const angle = t * Math.PI * 2;
            ox = 16 * Math.pow(Math.sin(angle), 3);
            oz = -(13 * Math.cos(angle) - 5 * Math.cos(2*angle) - 2 * Math.cos(3*angle) - Math.cos(4*angle));
            ox *= (tier.w * 0.4); oz *= (tier.w * 0.4);
          } else if (pattern === 'star') {
            const angle = t * Math.PI * 2;
            const r = (i % 2 === 0 ? 1 : 0.5) * tier.w * 3.5;
            ox = Math.cos(angle) * r;
            oz = Math.sin(angle) * r;
          } else if (pattern === 'diamond') {
            const angle = t * Math.PI * 2;
            const r = tier.w * 3.0 / (Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle)));
            ox = Math.cos(angle) * r;
            oz = Math.sin(angle) * r;
          } else if (pattern === 'spiral') {
            const angle = t * Math.PI * 8;
            const r = t * tier.w * 5;
            ox = Math.cos(angle) * r;
            oz = Math.sin(angle) * r;
          } else if (pattern === 'scurve') {
            ox = (t - 0.5) * tier.w * 12;
            oz = Math.sin(t * Math.PI * 2) * tier.w * 4;
          }

          const x = cx + ox + (Math.random() - 0.5) * 0.5;
          const z = cz + oz + (Math.random() - 0.5) * 0.5;
          const y = tier.h / 2;

          const mesh = this.makeMesh(tier);
          mesh.position.set(x, y, z);
          // Random rotation for variety
          mesh.rotation.y = Math.random() * Math.PI;
          this.scene.add(mesh);

          const body = this.physics.world.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic()
              .setTranslation(x, y, z)
              .setLinearDamping(1.8)
              .setAngularDamping(2.5),
          );
          this.physics.world.createCollider(
            RAPIER.ColliderDesc.cuboid(tier.w / 2, tier.h / 2, tier.d / 2),
            body,
          );

          objects.push({ 
            mesh, 
            body, 
            mass: tier.mass, 
            tier: tier.tierIdx, 
            type: tier.name, 
            id: Math.random(), 
            consumed: false 
          });
        }
      }
    });

    // Mixed Themes for all levels
    const themes = [
      { name: 'Bakery', colors: ['#FFFDD0', '#FFD1DC', '#E6E6FA'], items: ['House', 'Stall'] },
      { name: 'Jungle', colors: ['#2D5A27', '#4A7C44', '#8B4513'], items: ['Tree', 'Rock'] },
      { name: 'Winter', colors: ['#E0F7FA', '#B2EBF2', '#FFFFFF'], items: ['SnowTree', 'Igloo'] },
      { name: 'SciFi',  colors: ['#000000', '#1A1A1A', '#00F2FF'], items: ['NeonTower', 'Pad'] }
    ];

    const sceneryCount = 50 + level * 8;
    const blocks = 10;
    for (let i = 0; i < sceneryCount; i++) {
      const blockIdx = i % blocks;
      const angle  = (blockIdx / blocks) * Math.PI * 2;
      const radius = spread + 45 + (Math.floor(i / blocks) * 40);
      
      const jitterX = (Math.random() - 0.5) * 25;
      const jitterZ = (Math.random() - 0.5) * 25;
      
      const bx = Math.cos(angle) * radius + jitterX;
      const bz = Math.sin(angle) * radius + jitterZ;
      
      const theme = themes[Math.floor(Math.random() * themes.length)];
      const itemType = theme.items[i % theme.items.length];
      const color = theme.colors[Math.floor(Math.random() * theme.colors.length)];
      
      const building = this.makeSceneryItem(itemType, color);
      building.position.set(bx, 0, bz);
      building.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(building);
      scenery.push(building);
    }

    return { objects, scenery };
  }

  public cleanup(objects: GameObject[], scenery: THREE.Object3D[]) {
    objects.forEach(obj => {
      this.scene.remove(obj.mesh);
      this.disposeObject(obj.mesh);
    });
    scenery.forEach(mesh => {
      this.scene.remove(mesh);
      this.disposeObject(mesh);
    });
  }

  private disposeObject(obj: THREE.Object3D) {
    obj.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        const mesh = node as THREE.Mesh;
        // Only dispose geometry. Pooled materials should NOT be disposed!
        mesh.geometry.dispose();
      }
    });
  }

  private getMaterial(color: string, roughness = 0.5, metalness = 0.3): THREE.Material {
    const key = `${color}_${roughness}_${metalness}`;
    if (!this.matPool.has(key)) {
      this.matPool.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
    }
    return this.matPool.get(key)!;
  }

  private makeMesh(tier: TierDef): THREE.Object3D {
    const group = new THREE.Group();
    const mat = this.getMaterial(tier.color);

    if (tier.name === 'Cookie') {
      const g = new THREE.Mesh(new THREE.CylinderGeometry(tier.w / 2, tier.w / 2, tier.h, 16), mat);
      g.castShadow = true;
      group.add(g);
      // Sprinkles
      for (let s = 0; s < 5; s++) {
        const sp = new THREE.Mesh(
          new THREE.SphereGeometry(0.1, 6, 6),
          new THREE.MeshBasicMaterial({ color: [0xff3344, 0x44ffaa, 0xffdd22][s % 3] }),
        );
        sp.position.set((Math.random() - 0.5) * tier.w * 0.6, tier.h / 2 + 0.05, (Math.random() - 0.5) * tier.w * 0.6);
        group.add(sp);
      }
    } else if (tier.name === 'Macaron') {
      const half = new THREE.SphereGeometry(tier.w / 2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      const top  = new THREE.Mesh(half, mat.clone());
      top.position.y = 0.3;
      const bot  = new THREE.Mesh(half, mat.clone());
      (bot.material as THREE.MeshStandardMaterial).color.set('#fff0f5');
      bot.rotation.x = Math.PI;
      bot.position.y = -0.3;
      group.add(top, bot);
    } else if (tier.name === 'Donut' || tier.name === 'GiantDonut') {
      const donut = new THREE.Mesh(new THREE.TorusGeometry(tier.w / 2 * 0.6, tier.w / 2 * 0.35, 12, 32), mat);
      donut.rotation.x = Math.PI / 2;
      donut.castShadow = true;
      group.add(donut);
      if (tier.name === 'GiantDonut') {
        const glow = new THREE.PointLight(tier.color, 10, 20);
        group.add(glow);
      }
    } else if (tier.name === 'Cake') {
      const colors = ['#FFFDD0', '#FFD1DC', '#E6E6FA'];
      for (let layer = 0; layer < 3; layer++) {
        const lw = (tier.w - layer * 1.5);
        const lm = new THREE.MeshStandardMaterial({ 
          color: colors[layer], 
          roughness: 0.3,
          emissive: colors[layer],
          emissiveIntensity: 0.1
        });
        const l = new THREE.Mesh(new THREE.CylinderGeometry(lw / 2, lw / 2, 1.8, 32), lm);
        l.position.y = layer * 1.9;
        l.castShadow = true;
        group.add(l);
        
        // Add "frosting" drips
        if (layer > 0) {
           const drip = new THREE.Mesh(new THREE.CylinderGeometry(lw/2 + 0.1, lw/2 + 0.1, 0.5, 16), lm);
           drip.position.y = layer * 1.9 - 0.8;
           group.add(drip);
        }
      }
      // Cherry on top
      const cherry = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 16), new THREE.MeshStandardMaterial({ color: '#ff0000', roughness: 0.1 }));
      cherry.position.y = 3 * 1.9;
      group.add(cherry);
    } else if (tier.name === 'Cupcake') {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(tier.w/2*0.7, tier.w/2, tier.h*0.5, 12), new THREE.MeshStandardMaterial({ color: '#8B4513', roughness: 0.9 }));
      const top = new THREE.Mesh(new THREE.DodecahedronGeometry(tier.w/2, 1), mat);
      top.position.y = tier.h * 0.3;
      group.add(base, top);
    } else if (tier.name === 'Soda') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(tier.w/2, tier.w/2, tier.h, 24), mat);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(tier.w/2, tier.w/2, 0.2, 24), new THREE.MeshStandardMaterial({ color: '#aaa', metalness: 1, roughness: 0.2 }));
      top.position.y = tier.h/2;
      const tab = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.8), new THREE.MeshStandardMaterial({ color: '#888', metalness: 1 }));
      tab.position.set(0, tier.h/2 + 0.1, 0.4);
      group.add(body, top, tab);
    } else if (tier.name === 'Burger') {
      const bunMat = new THREE.MeshStandardMaterial({ color: '#D4A76A', roughness: 0.8 });
      const meatMat = new THREE.MeshStandardMaterial({ color: '#4b2c20', roughness: 0.9 });
      const cheeseMat = new THREE.MeshStandardMaterial({ color: '#FFD700', metalness: 0.1 });
      const lettuceMat = new THREE.MeshStandardMaterial({ color: '#4caf50' });
      
      const bunTop = new THREE.Mesh(new THREE.SphereGeometry(tier.w/2, 24, 12, 0, Math.PI*2, 0, Math.PI/2), bunMat);
      const meat = new THREE.Mesh(new THREE.CylinderGeometry(tier.w/2, tier.w/2, 0.6, 24), meatMat);
      meat.position.y = -0.4;
      const lettuce = new THREE.Mesh(new THREE.CylinderGeometry(tier.w/2 * 1.1, tier.w/2 * 1.1, 0.2, 16), lettuceMat);
      lettuce.position.y = -0.1;
      const cheese = new THREE.Mesh(new THREE.BoxGeometry(tier.w*0.9, 0.1, tier.d*0.9), cheeseMat);
      cheese.position.y = 0.2;
      cheese.rotation.y = Math.PI / 4;
      const bunBot = new THREE.Mesh(new THREE.CylinderGeometry(tier.w/2, tier.w/2, 0.6, 24), bunMat);
      bunBot.position.y = -1.0;
      group.add(bunTop, cheese, lettuce, meat, bunBot);
    } else if (tier.name === 'Pizza') {
      const slice = new THREE.Mesh(new THREE.CylinderGeometry(tier.w/2, tier.w/2, tier.h, 3), mat);
      slice.rotation.y = Math.PI;
      group.add(slice);
    } else if (tier.name === 'IceCream') {
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.1, tier.w/2, tier.h*0.6, 12), new THREE.MeshStandardMaterial({ color: '#DEB887' }));
      cone.position.y = -tier.h*0.2;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(tier.w/2, 12, 12), mat);
      ball.position.y = tier.h*0.2;
      group.add(cone, ball);
    } else if (tier.name === 'Car') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(tier.w, tier.h*0.5, tier.d), mat);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(tier.w*0.6, tier.h*0.4, tier.d*0.8), mat);
      roof.position.y = tier.h*0.4;
      
      // Windows
      const winMat = new THREE.MeshStandardMaterial({ color: '#333', metalness: 0.9, roughness: 0.1 });
      const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.1, tier.h*0.3, tier.d*0.7), winMat);
      windshield.position.set(tier.w*0.3, tier.h*0.4, 0);
      group.add(windshield);

      const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 12);
      const wheelMat = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.9 });
      for (let w = 0; w < 4; w++) {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.rotation.x = Math.PI/2;
        wheel.position.set(w<2 ? 1.4 : -1.4, -0.6, w%2===0 ? 1.1 : -1.1);
        group.add(wheel);
      }
      group.add(body, roof);
    } else if (tier.name === 'Streetlight') {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, tier.h), new THREE.MeshStandardMaterial({ color: '#333' }));
      pole.position.y = tier.h/2;
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.5), new THREE.MeshStandardMaterial({ color: '#fff' }));
      head.position.y = tier.h;
      group.add(pole, head);
    } else if (tier.name === 'Bench') {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(tier.w, 0.2, tier.d), mat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(tier.w, 1.0, 0.2), mat);
      back.position.set(0, 0.6, -tier.d/2);
      group.add(seat, back);
    } else {
      // Premium Edible Building
      const w = tier.w;
      const h = tier.h;
      const d = tier.d;
      
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      body.position.y = h / 2;
      group.add(body);

      // Windows
      const winCountH = Math.floor(h / 7);
      const winMat = new THREE.MeshStandardMaterial({ 
        color: '#ffffff', 
        metalness: 1,
        roughness: 0
      });
      const winGeo = new THREE.PlaneGeometry(w * 0.12, h * 0.05);

      for (let j = 0; j < winCountH; j++) {
        const yOff = (j + 1) * 7;
        for (let side = 0; side < 4; side++) {
           if (Math.random() > 0.3) {
             const win = new THREE.Mesh(winGeo, winMat);
             if (side === 0) win.position.set(0, yOff, d/2 + 0.1);
             if (side === 1) { win.position.set(0, yOff, -d/2 - 0.1); win.rotation.y = Math.PI; }
             if (side === 2) { win.position.set(w/2 + 0.1, yOff, 0); win.rotation.y = Math.PI/2; }
             if (side === 3) { win.position.set(-w/2 - 0.1, yOff, 0); win.rotation.y = -Math.PI/2; }
             group.add(win);
           }
        }
      }

      // Roof ornament
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 2, d * 0.7), mat);
      roof.position.y = h + 1;
      group.add(roof);
    }

    return group;
  }

  private makeSceneryItem(type: string, color: string): THREE.Object3D {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ 
      color: new THREE.Color(color).multiplyScalar(0.8), 
      roughness: 0.4, 
      metalness: 0.5 
    });

    if (type === 'Tree') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 5, 8), new THREE.MeshStandardMaterial({ color: '#3d2b1f' }));
      trunk.position.y = 2.5;
      const leaves = new THREE.Mesh(new THREE.DodecahedronGeometry(4), new THREE.MeshStandardMaterial({ color: '#2d5a27', roughness: 0.8 }));
      leaves.position.y = 7;
      group.add(trunk, leaves);
    } else if (type === 'NeonTower') {
      const h = 60 + Math.random() * 40;
      const body = new THREE.Mesh(new THREE.BoxGeometry(10, h, 10), new THREE.MeshStandardMaterial({ color: '#0a0a0a', metalness: 0.9 }));
      body.position.y = h / 2;
      
      const neon = new THREE.Mesh(new THREE.BoxGeometry(10.5, h * 0.9, 1.5), new THREE.MeshStandardMaterial({ color: '#00f2ff' }));
      neon.position.y = h/2;
      group.add(body, neon);
      
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(2, 16, 16), new THREE.MeshStandardMaterial({ color: '#ff0000' }));
      beacon.position.y = h + 2;
      group.add(beacon);
    } else {
      // Advanced Building with tiered sections
      const h = 30 + Math.random() * 60;
      const w = 18 + Math.random() * 8;
      const d = 18 + Math.random() * 8;
      
      // Base section
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      body.position.y = h / 2;
      group.add(body);

      // Top tier (occasional)
      if (h > 50) {
        const topW = w * 0.7;
        const topH = h * 0.3;
        const topBody = new THREE.Mesh(new THREE.BoxGeometry(topW, topH, topW), mat);
        topBody.position.y = h + topH/2;
        group.add(topBody);
      }

      // 4-Sided Window Grid
      const winCountH = Math.floor(h / 7);
      const winMat = new THREE.MeshStandardMaterial({ 
        color: '#ffffff', 
        metalness: 1,
        roughness: 0
      });
      const winGeo = new THREE.PlaneGeometry(1.8, 2.8);

      for (let j = 0; j < winCountH; j++) {
        const yOff = (j + 1) * 7;
        
        // Front & Back
        const winCountW = Math.floor(w / 5);
        for (let i = 0; i < winCountW; i++) {
          if (Math.random() > 0.3) {
            const xOff = (i - winCountW / 2 + 0.5) * 5;
            const wf = new THREE.Mesh(winGeo, winMat);
            wf.position.set(xOff, yOff, d/2 + 0.1);
            group.add(wf);
            const wb = wf.clone();
            wb.position.z = -d/2 - 0.1;
            wb.rotation.y = Math.PI;
            group.add(wb);
          }
        }

        // Left & Right
        const winCountD = Math.floor(d / 5);
        for (let i = 0; i < winCountD; i++) {
          if (Math.random() > 0.3) {
            const zOff = (i - winCountD / 2 + 0.5) * 5;
            const wl = new THREE.Mesh(winGeo, winMat);
            wl.position.set(-w/2 - 0.1, yOff, zOff);
            wl.rotation.y = -Math.PI / 2;
            group.add(wl);
            const wr = wl.clone();
            wr.position.x = w/2 + 0.1;
            wr.rotation.y = Math.PI / 2;
            group.add(wr);
          }
        }
      }

      // Roof Details (Helipads / Vents)
      if (Math.random() > 0.5) {
         const helipad = new THREE.Mesh(new THREE.CircleGeometry(w*0.35, 32), new THREE.MeshStandardMaterial({ color: '#222' }));
         helipad.rotation.x = -Math.PI / 2;
         helipad.position.y = h + 0.1;
         group.add(helipad);
      } else {
         const vent = new THREE.Mesh(new THREE.BoxGeometry(w*0.4, 3, d*0.4), new THREE.MeshStandardMaterial({ color: '#333' }));
         vent.position.y = h + 1.5;
         group.add(vent);
      }
    }

    return group;
  }
}
