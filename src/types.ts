import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export interface GameObject {
  mesh:     THREE.Object3D;
  body:     RAPIER.RigidBody;
  mass:     number;
  tier:     number;
  type:     string;
  id:       number;
  consumed: boolean;
}

export interface UserData {
  xp:        number;
  level:     number;
  highScore: number;
  coins:     number;
  currentMatchLevel: number;
  missionsCompleted: number;
  stars: number;
  upgrades: {
    speed:   number;
    size:    number;
    suction: number;
  };
  selectedSkin: string;
  unlockedSkins: string[];
}

export const defaultUserData = (): UserData => ({
  xp:        0,
  level:     1,
  highScore: 0,
  coins:     0,
  currentMatchLevel: 1,
  missionsCompleted: 0,
  stars: 0,
  selectedSkin: '#00f2ff',
  upgrades:  { speed: 1, size: 1, suction: 1 },
  unlockedSkins: ['#00f2ff']
});

export const GameMode = {
  SOLO:    'solo',
  CLASSIC: 'classic',
  BATTLE:  'battle',
  DAILY:   'daily',
} as const;

export type GameMode = typeof GameMode[keyof typeof GameMode];

export interface Challenge {
  id: string;
  description: string;
  goal: number;
  current: number;
  reward: number;
  completed: boolean;
}
