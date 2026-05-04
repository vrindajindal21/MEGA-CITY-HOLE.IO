Great goal! Here's the full picture of how to get your Three.js hole.io game onto the Play Store.Here's the full Play Store pipeline for your game, with the exact tools and steps at each stage.**The exact commands in order, copy-paste ready:**

Wrap with Capacitor (web → Android)

This is your bridge. Capacitor turns your Vite/Three.js app into a real Android APK.

Install
npm install @capacitor/core @capacitor/cli @capacitor/android
Init
npx cap init "Mega City Hole IO" "com.yourname.holeiogame" — pick a unique app ID, you can't change it after publishing
Build your web app
npm run build — this creates the dist/ folder Capacitor will bundle
Add Android platform
npx cap add android then npx cap sync — copies your dist into the Android project
capacitor.config.ts
Set webDir: 'dist' and server.androidScheme: 'https' — required for Three.js WebGL to work in the WebView
Capacitor uses a WebView (Chrome engine) internally. Your Three.js/Rapier game runs exactly as it does in a browser — no rewrite needed. Performance is near-native on modern Android.
2
Configure Android project

Open in Android Studio and set up the app identity.

Open project
npx cap open android — opens Android Studio. You need Android Studio Hedgehog or later installed.
App name & icon
Edit android/app/src/main/res/ — replace launcher icons with your own. Use 512×512px source. Android Studio's Image Asset Studio generates all sizes.
Permissions
In AndroidManifest.xml add INTERNET permission. Remove any unused permissions — Play Store reviewers flag unnecessary ones.
Target SDK
Set targetSdkVersion 34 (Android 14) in build.gradle. Play Store requires this from August 2024 onwards for new apps.
Version code
Set versionCode 1 and versionName "1.0.0". Each update to Play Store needs a higher versionCode — never reuse one.
3
Performance tuning for mobile WebView

Three.js runs in a WebView — a few settings make a huge difference.

Pixel ratio cap
Already in your code: Math.min(devicePixelRatio, 2). On high-DPI phones like Galaxy S24 (3×) this halves GPU load.
Disable antialias on mobile
Detect mobile via navigator.maxTouchPoints > 0 and set antialias: false in WebGLRenderer. Big perf win on mid-range phones.
Hardware acceleration
In MainActivity.java add this.bridge.getWebView().setLayerType(View.LAYER_TYPE_HARDWARE, null); — enables GPU compositing in WebView.
Reduce shadow map size
Drop from 2048 to 1024 on mobile. Shadow quality barely changes but render time halves on older GPUs.
Lock to 60fps
Capacitor's WebView defaults to 60fps. Don't use setPreferredFramesPerSecond — let the browser manage it.
Test on a real mid-range Android (e.g. Redmi Note 12) before submitting — emulators don't reflect WebView GPU performance accurately.
4
Sign and build the release APK / AAB

Play Store requires an AAB (Android App Bundle), not a plain APK.

Generate keystore
keytool -genkey -v -keystore release.keystore -alias holeiogame -keyalg RSA -keysize 2048 -validity 10000 — store this file safely forever. Losing it means you can never update your app.
Configure signing
In android/app/build.gradle add a signingConfigs.release block pointing to your keystore. Never commit passwords to git — use local.properties or environment variables.
Build AAB
In Android Studio: Build → Generate Signed Bundle → Android App Bundle → choose release keystore → build. Output is in android/app/release/
File size check
Play Store has a 150MB AAB limit. Your Three.js game should be well under 20MB. If Rapier WASM is large, gzip it — Vite does this automatically with build.reportCompressedSize: true.
5
Google Play Console setup

One-time $25 developer fee, then submit.

Account
Create at play.google.com/console. Pay the $25 one-time fee. Takes 24–48h for account verification.
Store listing
App title (max 30 chars), short description (80 chars), full description (4000 chars), 2–8 screenshots per device type, feature graphic (1024×500px), app icon (512×512px).
Content rating
Fill out the IARC questionnaire. Your game has no violence/mature content so it'll be rated E (Everyone). This unlocks all age groups.
Privacy policy
Required even if you collect no data. Use a free generator like privacypolicygenerator.info — host it on GitHub Pages and link it in the console.
Release track
Start with Internal Testing (instant, up to 100 testers) → Closed Testing → Open Testing → Production. Don't go straight to Production for your first release.
Review time
First-time apps take 3–7 days for review. Updates take 1–3 days. Google will email you the result.
Games with in-app purchases or ads need additional policy compliance. If you add Google AdMob or Play Billing later, re-read the monetization policies before submitting.

```bash
# 1. Install Capacitor
npm install @capacitor/core @capacitor/cli @capacitor/android

# 2. Init (change the ID to something unique)
npx cap init "Mega City Hole IO" "com.yourname.megacityhole"

# 3. Build your Vite app
npm run build

# 4. Add Android and sync
npx cap add android
npx cap sync

# 5. Open in Android Studio
npx cap open android

# 6. After configuring in Android Studio, sync again after any web change
npm run build && npx cap sync
```

**`capacitor.config.ts` — critical settings for Three.js/WebGL:**

```typescript
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yourname.megacityhole',
  appName: 'Mega City Hole IO',
  webDir: 'dist',
  server: {
    androidScheme: 'https', // required for WebGL context
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#000000',
  }
};

export default config;
```

**Mobile performance patch for your `Renderer.ts`:**

```typescript
const isMobile = navigator.maxTouchPoints > 0;

this.renderer = new THREE.WebGLRenderer({ 
  antialias: !isMobile,  // off on mobile = big FPS boost
  powerPreference: 'high-performance'
});
this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));

// Reduce shadow quality on mobile
if (isMobile) {
  sun.shadow.mapSize.width = 1024;
  sun.shadow.mapSize.height = 1024;
}
```

**Things to prepare before submitting:**

You'll need a privacy policy URL (free — generate one at `privacypolicygenerator.info` and host on GitHub Pages), at least 2 screenshots at 1080×1920px (use Android emulator's screenshot tool), a 512×512px app icon with no rounded corners (Play Store adds them), and a 1024×500px feature graphic for the store banner.

**Biggest risk to watch:** Rapier's WASM file. Make sure it's bundled correctly in your Vite build — add this to `vite.config.ts` if you see WASM loading errors in the WebView:

```typescript
// vite.config.ts
export default {
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat']
  },
  build: {
    target: 'esnext' // needed for WASM top-level await
  }
}
```

Want me to write out the full `build.gradle` signing config, or help with the store listing copy?