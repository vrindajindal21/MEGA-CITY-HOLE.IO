import * as THREE from 'three';
import type { GameObject } from '../types';
import { gsap } from 'gsap';
import type { Physics } from '../core/Physics';

export class BotManager {
  private scene:   THREE.Scene;
  private physics: Physics;
  private bots:    BotEntry[] = [];

  constructor(scene: THREE.Scene, physics: Physics) {
    this.scene   = scene;
    this.physics = physics;
  }

  public createBots(count: number) {
    this.cleanup();
    const names   = ['ALPHA', 'BETA', 'GAMMA', 'DELTA', 'EPSILON'];
    const colors  = [0xff4444, 0x44ff44, 0xff44ff, 0xffaa00];

    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 160;
      const z = (Math.random() - 0.5) * 160;

      const group = new THREE.Group();

      // Black void disc
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, 0.3, 32),
        new THREE.MeshBasicMaterial({ color: 0x000000 }),
      );
      disc.position.y = -0.15;
      group.add(disc);

      // Colored rim
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(1, 0.07, 16, 64),
        new THREE.MeshStandardMaterial({ color: colors[i % colors.length] }),
      );
      rim.rotation.x = Math.PI / 2;
      group.add(rim);

      group.position.set(x, 0, z);
      this.scene.add(group);

      this.bots.push({
        name:  names[i % names.length],
        mesh:  group,
        size:  2.0,
        tier:  1,
        score: 0,
        target: null,
        targetTimer: 0,
      });
    }
  }

  private frameCount = 0;

  public update(_dt: number, objects: GameObject[], _playerPos: THREE.Vector3, _playerSize: number) {
    this.frameCount++;
    const baseSpeed = 0.08 + (Math.min(this.bots.length, 10) * 0.005);

    for (let bIdx = 0; bIdx < this.bots.length; bIdx++) {
      const bot = this.bots[bIdx];
      if (!bot.mesh.visible) continue;

      // Stagger logic and eating checks to spread CPU load
      const updateLogic = (this.frameCount + bIdx) % 3 === 0;
      const updateEating = (this.frameCount + bIdx) % 6 === 0;

      // 1. Move logic
      if (updateLogic) {
        bot.targetTimer--;
        
        const bx = bot.mesh.position.x;
        const bz = bot.mesh.position.z;
        const dxP = bx - _playerPos.x;
        const dzP = bz - _playerPos.z;
        const distToPlayerSq = dxP * dxP + dzP * dzP;

        if (distToPlayerSq < 225) { // 15 * 15
          if (_playerSize > bot.size + 0.5) {
            const dist = Math.sqrt(distToPlayerSq);
            bot.target = new THREE.Vector3(bx + (dxP/dist) * 20, 0, bz + (dzP/dist) * 20);
            bot.targetTimer = 30;
          } else if (bot.size > _playerSize + 0.5) {
            bot.target = _playerPos.clone();
            bot.targetTimer = 20;
          }
        }

        if (bot.targetTimer <= 0 || !bot.target) {
          let nearestObj: GameObject | null = null;
          let minDistSq = 1000000;
          
          for (let i = 0, len = objects.length; i < len; i++) {
            const o = objects[i];
            if (o.consumed || o.tier > bot.tier) continue;
            const dx = bx - o.mesh.position.x;
            const dz = bz - o.mesh.position.z;
            const dSq = dx * dx + dz * dz;
            if (dSq < minDistSq) {
              minDistSq = dSq;
              nearestObj = o;
            }
          }

          if (nearestObj) {
            bot.target = nearestObj.mesh.position.clone();
            bot.targetTimer = 40 + Math.floor(Math.random() * 40);
          } else {
            bot.target = new THREE.Vector3((Math.random() - 0.5) * 400, 0, (Math.random() - 0.5) * 400);
            bot.targetTimer = 60;
          }
        }
      }

      if (bot.target) {
        const dx = bot.target.x - bot.mesh.position.x;
        const dz = bot.target.z - bot.mesh.position.z;
        const distSq = dx * dx + dz * dz;
        if (distSq > 0.01) {
          const dist = Math.sqrt(distSq);
          const speed = baseSpeed * (1.2 - (bot.tier * 0.05));
          bot.mesh.position.x = Math.max(-280, Math.min(280, bot.mesh.position.x + (dx / dist) * speed));
          bot.mesh.position.z = Math.max(-280, Math.min(280, bot.mesh.position.z + (dz / dist) * speed));
        }
      }

      // 2. Consumption logic (Staggered and optimized)
      if (updateEating) {
        const bx = bot.mesh.position.x;
        const bz = bot.mesh.position.z;
        const range = bot.size;

        for (let i = 0, len = objects.length; i < len; i++) {
          const obj = objects[i];
          if (obj.consumed || obj.tier > bot.tier) continue;
          
          const dx = bx - obj.mesh.position.x;
          const dz = bz - obj.mesh.position.z;
          
          if (dx < range && dx > -range && dz < range && dz > -range) {
            const distSq = dx * dx + dz * dz;
            if (distSq < (bot.size * 0.58) * (bot.size * 0.58)) {
              obj.consumed = true;
              obj.mesh.visible = false;
              this.scene.remove(obj.mesh);
              try { this.physics.world.removeRigidBody(obj.body); } catch (_) {}

              bot.score += obj.mass;
              if (bot.score > bot.tier * 6000) {
                bot.tier++;
                bot.size += 0.6;
                gsap.to(bot.mesh.scale, { x: bot.size / 2, z: bot.size / 2, duration: 0.5 });
              }
            }
          }
        }

        // 3. Bot-on-Bot combat
        for (let j = 0; j < this.bots.length; j++) {
          const other = this.bots[j];
          if (bot === other || !other.mesh.visible) continue;
          const dx = bx - other.mesh.position.x;
          const dz = bz - other.mesh.position.z;
          const dSq = dx * dx + dz * dz;
          if (dSq < (bot.size * 0.8) * (bot.size * 0.8) && bot.size > other.size + 0.2) {
            other.mesh.visible = false;
            bot.score += 500;
            bot.size += 0.2;
            gsap.to(bot.mesh.scale, { x: bot.size/2, z: bot.size/2, duration: 0.5, ease: 'back.out' });
          }
        }
      }
    }
  }

  public cleanup() {
    this.bots.forEach(b => {
      this.scene.remove(b.mesh);
      b.mesh.traverse((node) => {
        if ((node as THREE.Mesh).isMesh) {
          const mesh = node as THREE.Mesh;
          mesh.geometry.dispose();
          if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
          else mesh.material.dispose();
        }
      });
    });
    this.bots = [];
  }

  public getScores(): Array<{ name: string; score: number }> {
    return this.bots.map(b => ({ name: b.name, score: b.score }));
  }

  public getBots(): BotEntry[] {
    return this.bots;
  }
}

interface BotEntry {
  name:   string;
  mesh:   THREE.Group;
  size:   number;
  tier:   number;
  score:  number;
  target: THREE.Vector3 | null;
  targetTimer: number;
}
