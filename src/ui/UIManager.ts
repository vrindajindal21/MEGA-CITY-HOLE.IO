import { GameMode, type UserData } from '../types';
import { gsap } from 'gsap';

export class UIManager {
  private scoreEl:       HTMLElement;
  private timerEl:       HTMLElement;
  private mainMenu:      HTMLElement;
  private modeSelection: HTMLElement;
  private endScreen:     HTMLElement;
  private skinPanel:     HTMLElement;
  private settingsMenu:  HTMLElement;
  private hud:           HTMLElement;
  private levelSplash:   HTMLElement;
  private fadeEl:        HTMLElement;

  private callbacks: {
    startGame:  (mode: GameMode) => void;
    buyUpgrade: (type: string)   => void;
    changeSkin: (color: string)  => void;
  };
  private currentMode: GameMode = GameMode.CLASSIC;

  constructor(callbacks: typeof UIManager.prototype.callbacks) {
    this.callbacks = callbacks;
    this.scoreEl      = document.getElementById('score')!;
    this.timerEl      = document.getElementById('timer')!;
    this.mainMenu     = document.getElementById('main-menu')!;
    this.modeSelection= document.getElementById('mode-selection')!;
    this.endScreen    = document.getElementById('end-screen')!;
    this.skinPanel    = document.getElementById('skins-panel')!;
    this.settingsMenu = document.getElementById('settings-menu')!;
    this.hud          = document.getElementById('game-hud')!;
    this.levelSplash  = document.getElementById('level-up')!;
    this.fadeEl       = document.getElementById('screen-fade')!;

    this.setupListeners();
  }

  public buildSkinsGrid(userData: UserData) {
    const skins = [
      { id: 'classic', label: 'CLASSIC', color: '#ffffff', req: { type: 'level', val: 1 }, cost: 0 },
      { id: 'cyan',    label: 'CYAN',    color: '#00f2ff', req: { type: 'level', val: 1 }, cost: 0 },
      { id: 'fire',    label: 'FIRE',    color: '#ff3e00', req: { type: 'level', val: 1 }, cost: 0 },
      { id: 'pink',    label: 'PINK',    color: '#ff66cc', req: { type: 'level', val: 2 }, cost: 200 },
      { id: 'lime',    label: 'LIME',    color: '#66ff44', req: { type: 'level', val: 5 }, cost: 500 },
      { id: 'gold',    label: 'GOLD',    color: '#ffd700', req: { type: 'stars', val: 5 }, cost: 1000 },
      { id: 'violet',  label: 'VIOLET',  color: '#8a2be2', req: { type: 'level', val: 8 }, cost: 1500 },
      { id: 'magma',   label: 'MAGMA',   color: '#ff0000', req: { type: 'stars', val: 10 }, cost: 2500 },
      { id: 'void',    label: 'VOID',    color: '#111111', req: { type: 'stars', val: 15 }, cost: 5000 },
    ];
    const grid = document.getElementById('skins-grid');
    if (!grid) return;
    grid.innerHTML = '';

    skins.forEach(({ label, color, req, cost }) => {
      let isUnlocked = userData.unlockedSkins?.includes(color);
      let isLevelMet = true;
      if (req.type === 'level') isLevelMet = userData.level >= req.val;
      if (req.type === 'stars') isLevelMet = userData.stars >= req.val;
      
      // Auto-unlock if level met
      if (isLevelMet && !isUnlocked) {
        userData.unlockedSkins.push(color);
        isUnlocked = true;
      }

      const card = document.createElement('div');
      card.className = `skin-card ${!isUnlocked ? 'locked' : ''} ${userData.selectedSkin === color ? 'active' : ''}`;
      
      const preview = document.createElement('div');
      preview.className = 'skin-preview';
      preview.style.background = `radial-gradient(circle at 35% 35%, #fff4, ${color})`;
      if (cost >= 1000) preview.style.boxShadow = `0 0 15px ${color}`;

      const name = document.createElement('div');
      name.className = 'skin-name';
      
      if (!isUnlocked) {
        name.innerHTML = `<span style="font-size:0.5rem;opacity:0.7">${req.type === 'level' ? 'LVL ' + req.val : req.val + ' STARS'}</span><br>🪙 ${cost}`;
      } else {
        name.textContent = label;
      }
      
      card.append(preview, name);
      
      card.addEventListener('click', () => {
        if (isUnlocked) {
          // Select Skin
          grid.querySelectorAll('.skin-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          this.callbacks.changeSkin(color);
          gsap.fromTo(card, { scale: 0.85 }, { scale: 1, duration: 0.3, ease: 'back.out' });
        } else {
          // Try to Buy
          if (userData.coins >= cost) {
            this.callbacks.buyUpgrade(`skin:${color}:${cost}`); // Reuse upgrade callback with prefix
          } else {
            // Not enough coins feedback
            gsap.to(card, { x: 10, duration: 0.1, repeat: 3, yoyo: true });
          }
        }
      });
      grid.appendChild(card);
    });
  }

  private setupListeners() {
    this.bind('play-button',  () => this.showModeSelection());
    this.bind('back-to-menu', () => this.hideModeSelection());
    this.bind('skins-button', () => this.showPanel(this.skinPanel));
    this.bind('close-skins',  () => this.hidePanel(this.skinPanel));
    this.bind('settings-button', () => this.showPanel(this.settingsMenu));
    this.bind('close-settings',  () => this.hidePanel(this.settingsMenu));

    // Fix: Ensure these buttons restart the game in the correct mode
    const restartFn = () => {
      this.hideEndScreen();
      this.callbacks.startGame(this.currentMode); 
    };

    this.bind('again-button', restartFn);
    this.bind('next-level-button', restartFn);

    ['solo', 'classic', 'battle'].forEach(mode => {
      this.bind(`mode-${mode}`, () => {
        this.currentMode = mode as GameMode;
        this.callbacks.startGame(this.currentMode);
      });
    });
    this.bind('mode-daily', () => {
      this.currentMode = GameMode.CLASSIC;
      this.callbacks.startGame(this.currentMode);
    });

    ['speed', 'size', 'suction'].forEach(id => {
      this.bind(`upg-${id}`, () => this.callbacks.buyUpgrade(id));
    });

    this.bind('reset-progress', () => {
      localStorage.removeItem('holeio_userdata');
      location.reload();
    });
  }

  private bind(id: string, fn: () => void) {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', () => {
        gsap.fromTo(el, { scale: 0.92 }, { scale: 1, duration: 0.2, ease: 'back.out' });
        fn();
      });
    }
  }

  public showHUD(mode: GameMode) {
    [this.mainMenu, this.modeSelection, this.skinPanel, this.settingsMenu, this.endScreen].forEach(el => {
      el.classList.add('hidden');
    });
    this.hud.classList.remove('hidden');
    gsap.fromTo(this.hud, { opacity: 0, y: -40 }, { opacity: 1, y: 0, duration: 0.6, ease: 'back.out' });
    if (mode === GameMode.BATTLE) this.timerEl.innerText = '∞';
    
    const indicator = document.getElementById('level-indicator');
    if (indicator) indicator.classList.remove('hidden');
  }

  public showLevelSplash(level: number) {
    this.levelSplash.classList.remove('hidden');
    this.levelSplash.querySelector('h2')!.innerText = `LEVEL ${level}`;
    
    this.triggerConfetti(); // Celebration!

    gsap.fromTo(this.levelSplash, { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.8, ease: 'elastic.out(1, 0.5)' });
    
    // Reward Notification
    const rewards: Record<number, string> = {
      2: "Unlocked New Hole Skin! 🎨",
      3: "Suction Boost +5%! 🌀",
      4: "New City Map Unlocked! 🏙️",
      5: "New Particle Effect! ✨",
      6: "New Hole Trail! 🔥",
      7: "Bigger Combo Limit! ⚡"
    };
    
    if (rewards[level]) {
      this.showRewardNotification(rewards[level]);
    }

    setTimeout(() => {
      gsap.to(this.levelSplash, { opacity: 0, scale: 1.5, duration: 0.5, onComplete: () => this.levelSplash.classList.add('hidden') });
    }, 2000);
  }

  private showRewardNotification(message: string) {
    const note = document.createElement('div');
    note.className = 'reward-notification';
    note.innerHTML = `<div class="reward-icon">🎁</div><div><small>REWARD UNLOCKED</small><br><strong>${message}</strong></div>`;
    document.body.appendChild(note);
    gsap.fromTo(note, { x: 100, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: 'back.out' });
    gsap.to(note, { x: 100, opacity: 0, duration: 0.5, delay: 3, onComplete: () => note.remove() });
  }

  public fadeTransition(callback: () => void) {
    this.fadeEl.classList.remove('hidden');
    gsap.to(this.fadeEl, { opacity: 1, duration: 0.4, onComplete: () => {
      callback();
      setTimeout(() => {
        gsap.to(this.fadeEl, { opacity: 0, duration: 0.6, onComplete: () => this.fadeEl.classList.add('hidden') });
      }, 100);
    }});
  }

  public updateSessionCoins(amount: number) {
    const el = document.getElementById('hud-coins');
    if (el) el.innerText = amount.toString();
  }

  public updateScore(score: number) {
    this.scoreEl.innerText = score.toString().padStart(4, '0');
    gsap.fromTo(this.scoreEl, { scale: 1.5, color: '#00f2ff' }, { scale: 1, color: '#fff', duration: 0.3 });
  }

  public updateTimer(time: number) {
    if (time < 0) { this.timerEl.innerText = '∞'; return; }
    const m = Math.floor(time / 60);
    const s = time % 60;
    this.timerEl.innerText = `${m}:${s.toString().padStart(2, '0')}`;
    if (time <= 10) this.timerEl.style.color = '#ff3e00';
    else this.timerEl.style.color = '#fff';
  }

  public updateStats(userData: UserData) {
    const lvlEl = document.getElementById('player-level');
    const menuCoins = document.getElementById('menu-coins');
    const playBtn = document.getElementById('play-button');
    
    if (lvlEl) lvlEl.innerText = userData.level.toString();
    if (menuCoins) menuCoins.innerText = userData.coins.toString();
    if (playBtn) playBtn.innerHTML = `LEVEL ${userData.level}<br><span style="font-size:0.8rem;opacity:0.7">START MATCH</span>`;

    ['speed', 'size', 'suction'].forEach(id => {
      const lvl = (userData.upgrades as any)[id];
      const el  = document.getElementById(`upg-${id}`);
      if (!el) return;
      const val = el.querySelector('.upg-val');
      if (val) val.innerHTML = `LVL ${lvl}<br><small style="color:#aaa">${lvl * 100}🪙</small>`;
    });

    const xpFill = document.getElementById('xp-fill');
    if (xpFill) {
      const pct = (userData.xp % 5000) / 50;
      gsap.to(xpFill, { width: `${pct}%`, duration: 1 });
    }

    // Refresh Skins Grid
    this.buildSkinsGrid(userData);
  }

  public showModeSelection() {
    this.modeSelection.classList.remove('hidden');
    gsap.fromTo(this.modeSelection, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.4, ease: 'back.out' });
  }

  public hideModeSelection() {
    gsap.to(this.modeSelection, { opacity: 0, duration: 0.2, onComplete: () => this.modeSelection.classList.add('hidden') });
  }

  public showEndScreen(score: number, coins: number, userData: UserData, won: boolean) {
    this.hud.classList.add('hidden');
    this.endScreen.classList.remove('hidden');
    
    const rankEl = document.getElementById('end-rank');
    const contextEl = document.getElementById('rank-context');
    const againBtn = document.getElementById('again-button');
    const nextBtn = document.getElementById('next-level-button');

    if (rankEl) {
      rankEl.innerText = won ? "LEVEL PASSED! 🎊" : "LEVEL FAILED! 💔";
      rankEl.style.color = won ? "#00ff88" : "#ff3e00";
      rankEl.style.textShadow = won ? "0 0 20px rgba(0,255,136,0.6)" : "0 0 20px rgba(255,62,0,0.6)";
    }
    
    if (contextEl) {
      contextEl.innerText = won 
        ? "Amazing! You've unlocked a NEW LEVEL! 🚀" 
        : "Don't give up! Reach the target score to unlock the next level. 💪";
    }

    if (won) {
      this.triggerConfetti();
      againBtn?.classList.add('hidden');
      nextBtn?.classList.remove('hidden');
      if (nextBtn) {
        nextBtn.innerText = "NEXT LEVEL 🚀";
        gsap.fromTo(nextBtn, { scale: 0.9 }, { scale: 1.1, duration: 0.5, repeat: -1, yoyo: true });
      }
    } else {
      againBtn?.classList.remove('hidden');
      nextBtn?.classList.add('hidden');
      if (againBtn) {
        againBtn.innerText = "TRY AGAIN 🔄";
      }
    }

    const set = (id: string, val: string) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    set('end-score', score.toString());
    set('end-coins', `+${coins}`);
    set('end-xp', `+${Math.floor(score / 100)}`);
    set('end-highscore', userData.highScore.toString());

    gsap.fromTo(this.endScreen, { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 0.6, ease: 'elastic.out(1, 0.5)' });
  }

  private triggerConfetti() {
    const colors = ['#ff3e00', '#00f2ff', '#ffd700', '#ff00ff', '#00ff88'];
    const originY = window.innerHeight;
    
    // Create two poppers from bottom corners
    [0, window.innerWidth].forEach(originX => {
      for (let i = 0; i < 60; i++) {
        const conf = document.createElement('div');
        conf.className = 'confetti';
        conf.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        conf.style.left = `${originX}px`;
        conf.style.top = `${originY}px`;
        document.body.appendChild(conf);
        
        const angle = (originX === 0) 
          ? (Math.random() * -Math.PI / 3) - Math.PI / 6 // Shoot right-up
          : (Math.random() * Math.PI / 3) + Math.PI + Math.PI / 6; // Shoot left-up
          
        const velocity = 15 + Math.random() * 25;
        const vx = Math.cos(angle) * velocity;
        const vy = Math.sin(angle) * velocity - 10;
        
        gsap.to(conf, {
          x: vx * 50,
          y: vy * 50,
          rotation: Math.random() * 1080,
          opacity: 0,
          scale: Math.random() * 1.5 + 0.5,
          duration: 2 + Math.random() * 2,
          ease: 'power3.out',
          onComplete: () => conf.remove()
        });
      }
    });

    // Center burst
    for (let i = 0; i < 40; i++) {
        const conf = document.createElement('div');
        conf.className = 'confetti';
        conf.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        conf.style.left = '50%';
        conf.style.top = '50%';
        document.body.appendChild(conf);
        
        const angle = Math.random() * Math.PI * 2;
        const velocity = 5 + Math.random() * 15;
        const vx = Math.cos(angle) * velocity;
        const vy = Math.sin(angle) * velocity;
        
        gsap.to(conf, {
          x: vx * 40,
          y: vy * 40,
          rotation: Math.random() * 720,
          opacity: 0,
          duration: 1.5 + Math.random(),
          ease: 'power2.out',
          onComplete: () => conf.remove()
        });
    }
  }

  public hideEndScreen() {
    gsap.to(this.endScreen, { opacity: 0, duration: 0.3, onComplete: () => this.endScreen.classList.add('hidden') });
  }

  public showMainMenu() {
    this.mainMenu.classList.remove('hidden');
    gsap.fromTo(this.mainMenu, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.4 });
  }

  private showPanel(el: HTMLElement) {
    el.classList.remove('hidden');
    gsap.fromTo(el, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.4, ease: 'back.out' });
  }

  private hidePanel(el: HTMLElement) {
    gsap.to(el, { opacity: 0, duration: 0.2, onComplete: () => el.classList.add('hidden') });
  }
}
