// --- ゲーム状態管理 ---
let gameState = 'move'; 
let timeLeft = 60;
let timerInterval;
let currentCameraView = 'front';

const CLAW_COUNT = 4;
let currentClawRatios = Array(CLAW_COUNT).fill(1.0);
let clawLockedRatios = Array(CLAW_COUNT).fill(null);
let releaseStartClawRatios = Array(CLAW_COUNT).fill(1.0);

const keys = { up: false, down: false, left: false, right: false };

let scene, renderer;
let world;
let activeCameras = {};

let craneUnitMesh; 
let clawLinks = [];
let clawVisuals = [];

let prizeBodies = [], prizeMeshes = []; 
let heldPrizeBodies = new Set();
let heldPrizeOffsets = new Map();
let prizeContactClaws = new Map();
let materials = {};

const MOVE_SPEED = 0.08;
const LIFT_SPEED = 0.035;
const HOLD_PAUSE_DURATION = 0.55;
const RELEASE_PAUSE_DURATION = 0.45;
const RELEASE_OPEN_SPEED = 0.012;
const RELEASE_DROP_SPEED = -0.85;
const HELD_PRIZE_MAX_SPEED = 1.6;
const HELD_PRIZE_MAX_ANGULAR_SPEED = 1.6;
const HELD_PRIZE_DAMPING = 0.45;
const HELD_PRIZE_FOLLOW_STRENGTH = 0.16;
const LIMIT_X = 4.3;
const LIMIT_Z = 4.3;
const CRANE_HOME_Y = 3.55;
const DROP_DEPTH = -3.0; 
const HOLE_POS = { x: -3.5, z: 3.5 }; 
const HOLE_SIZE = 3.0;
const IS_APPLE_MOBILE = isAppleMobileDevice();
const MAX_PIXEL_RATIO = IS_APPLE_MOBILE ? 1 : 1.5;

initPhysics();
initThree();
createStage();
createCrane();
createPrizes();
initUI();
startTimer();
animate();

// 1. 物理エンジンの初期化
function initPhysics() {
    world = new CANNON.World();
    world.gravity.set(0, -9.82, 0);
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 20; 

    materials.physicsDefault = new CANNON.Material("default");
    materials.physicsClaw = new CANNON.Material("claw");
    
    const contactMaterial = new CANNON.ContactMaterial(
        materials.physicsDefault,
        materials.physicsClaw,
        { 
            friction: 25.0, 
            restitution: 0.0,
            contactEquationStiffness: 20000,   // するっと抜けないように剛性を適度に硬く戻す
            contactEquationRelaxation: 8        // 振動を抑えつつレスポンスを良くする
        } 
    );
    world.addContactMaterial(contactMaterial);

    const selfContactMaterial = new CANNON.ContactMaterial(
        materials.physicsDefault,
        materials.physicsDefault,
        { 
            friction: 5.0, 
            restitution: 0.0,
            contactEquationStiffness: 8000,
            contactEquationRelaxation: 12
        }
    );
    world.addContactMaterial(selfContactMaterial);
}

function isAppleMobileDevice() {
    const isTouchDevice = navigator.maxTouchPoints && navigator.maxTouchPoints > 1;
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && isTouchDevice);
}

// 2. Three.js の初期化
function initThree() {
    const container = document.getElementById('canvas-container');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffe3ed); 

    const frontCam = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    frontCam.position.set(0, 4.8, 9.2);
    frontCam.lookAt(0, -1.2, 0);
    activeCameras.front = frontCam;

    const sideCam = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    sideCam.position.set(9.2, 2.2, 0);
    sideCam.lookAt(0, -1.2, 0);
    activeCameras.side = sideCam;

    renderer = new THREE.WebGLRenderer({ antialias: !IS_APPLE_MOBILE, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = !IS_APPLE_MOBILE;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; 
    
   // GLB（PBRマテリアル）の発色を鮮やかに正しく表現するためのガンマ補正設定
    renderer.outputEncoding = THREE.sRGBEncoding;

    renderer.domElement.addEventListener('webglcontextlost', event => {
        event.preventDefault();
        console.warn('WebGL context lost. iPadではGLB景品数や描画品質を下げて復旧を待ちます。');
    });
    container.appendChild(renderer.domElement);

    // GLBの見やすさを維持しつつ、白飛びを防ぐ輝度（環境光:0.9、平行光:0.7）に調整
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.55);
    dirLight.position.set(0, 15, 0); // アームの影が「真下」に正確に落ち、位置合わせのガイドとなるよう真上からの照射に戻す
    dirLight.castShadow = !IS_APPLE_MOBILE;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 20;
    const d = 5.5;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    dirLight.shadow.bias = -0.001;
    scene.add(dirLight);

    window.addEventListener('resize', onWindowResize);
}

// --- プレビューシーン用変数 ---
let previewScene, previewCamera, previewRenderer, previewObject;
let isPreviewActive = false;
let previewAnimId;
let previewRotation = { x: 0, y: 0 };
let isDraggingPreview = false;
let previousMousePosition = { x: 0, y: 0 };
let savedGameState = null;

// 3. ステージの生成
function createStage() {
    // 筐体の床の白飛びを避けるため、落ち着いたグレー感のある薄いピンクベージュ（0xbaa4a7）に変更し、反射をしっかり抑える
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xbaa4a7, roughness: 0.85 });
    const holeHalf = HOLE_SIZE / 2;
    const stageMin = -5;
    const stageMax = 5;
    const holeMinX = HOLE_POS.x - holeHalf;
    const holeMaxX = HOLE_POS.x + holeHalf;
    const holeMinZ = HOLE_POS.z - holeHalf;
    const holeMaxZ = HOLE_POS.z + holeHalf;
    const floorSegments = [
        [stageMax - stageMin, 0.5, holeMinZ - stageMin, 0, -5, (stageMin + holeMinZ) / 2],
        [holeMinX - stageMin, 0.5, stageMax - holeMinZ, (stageMin + holeMinX) / 2, -5, (holeMinZ + stageMax) / 2],
        [stageMax - holeMaxX, 0.5, stageMax - holeMinZ, (holeMaxX + stageMax) / 2, -5, (holeMinZ + stageMax) / 2],
        [HOLE_SIZE, 0.5, stageMax - holeMaxZ, HOLE_POS.x, -5, (holeMaxZ + stageMax) / 2]
    ];

    floorSegments.forEach(data => {
        if (data[0] <= 0 || data[2] <= 0) return;

        const floorGeo = new THREE.BoxGeometry(data[0], data[1], data[2]);
        const floorMesh = new THREE.Mesh(floorGeo, floorMat);
        floorMesh.position.set(data[3], data[4], data[5]);
        floorMesh.receiveShadow = true;
        scene.add(floorMesh);

        const floorBody = new CANNON.Body({
            mass: 0, shape: new CANNON.Box(new CANNON.Vec3(data[0] / 2, data[1] / 2, data[2] / 2)), material: materials.physicsDefault
        });
        floorBody.position.set(data[3], data[4], data[5]);
        world.addBody(floorBody);
    });

    const holeGeo = new THREE.PlaneGeometry(HOLE_SIZE, HOLE_SIZE);
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x7f3548, side: THREE.DoubleSide });
    const holeMesh = new THREE.Mesh(holeGeo, holeMat);
    holeMesh.rotation.x = Math.PI / 2;
    holeMesh.position.set(HOLE_POS.x, -5.35, HOLE_POS.z);
    scene.add(holeMesh);

    const wallMat = new THREE.MeshStandardMaterial({
        color: 0xff4757, transparent: true, opacity: 0.25, roughness: 0.1, metalness: 0.1
    });

    const wallsData = [
        [0.1, 1.0, HOLE_SIZE, holeMaxX, -4.25, HOLE_POS.z],  
        [HOLE_SIZE, 1.0, 0.1, HOLE_POS.x, -4.25, holeMinZ],
        [10.0, 1.2, 0.1, 0, -4.15, -5.0], 
        [10.0, 1.2, 0.1, 0, -4.15, 5.0],  
        [0.1, 1.2, 10.0, 5.0, -4.15, 0],  
        [0.1, 1.2, 7.5, -5.0, -4.15, -1.25] 
    ];

    wallsData.forEach(data => {
        const wGeo = new THREE.BoxGeometry(data[0], data[1], data[2]);
        const wMesh = new THREE.Mesh(wGeo, wallMat);
        wMesh.position.set(data[3], data[4], data[5]);
        scene.add(wMesh);

        const wBody = new CANNON.Body({
            mass: 0, shape: new CANNON.Box(new CANNON.Vec3(data[0]/2, data[1]/2, data[2]/2)), material: materials.physicsDefault
        });
        wBody.position.set(data[3], data[4], data[5]);
        world.addBody(wBody);
    });
}

// 4. クレーンユニットの生成
function createCrane() {
    craneUnitMesh = new THREE.Group();
    craneUnitMesh.position.set(0, CRANE_HOME_Y, 0);
    scene.add(craneUnitMesh);

    const matChrome = new THREE.MeshStandardMaterial({ color: 0xdcdde1, roughness: 0.15, metalness: 0.85 });
    const matPink = new THREE.MeshStandardMaterial({ color: 0xff7495, roughness: 0.3, metalness: 0.2 });
    // 白色パーツが発光しているように見えないよう、わずかにグレーに寄せる
    const matWhite = new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.4 });

    const cyl1Geo = new THREE.CylinderGeometry(0.5, 0.5, 0.5, 16);
    const cyl1 = new THREE.Mesh(cyl1Geo, matWhite);
    cyl1.position.y = 0.4;
    cyl1.castShadow = true;
    craneUnitMesh.add(cyl1);

    const cyl2Geo = new THREE.CylinderGeometry(0.45, 0.45, 0.7, 16);
    const cyl2 = new THREE.Mesh(cyl2Geo, matPink);
    cyl2.position.y = -0.2;
    cyl2.castShadow = true;
    craneUnitMesh.add(cyl2);

    const cyl3Geo = new THREE.CylinderGeometry(0.35, 0.4, 0.3, 16);
    const cyl3 = new THREE.Mesh(cyl3Geo, matChrome);
    cyl3.position.y = -0.6;
    cyl3.castShadow = true;
    craneUnitMesh.add(cyl3);

    clawLinks = [];
    clawVisuals = [];

    // 1枚目・2枚目のアーム外側への滑らかな湾曲をローカル座標系で再定義
    const clawShape = new THREE.Shape();
    clawShape.moveTo(0, 0); 
    clawShape.lineTo(0.06, -0.05);
    // 外側（右方向）に大きく膨らみを持たせつつ下降
    clawShape.quadraticCurveTo(0.35, -0.3, 0.25, -0.8);
    // 内側（左方向）に深く巻き込む先端のカーブ
    clawShape.quadraticCurveTo(0.15, -1.1, -0.15, -1.15);
    clawShape.lineTo(-0.15, -1.07);
    // 内側輪郭を通って戻る
    clawShape.quadraticCurveTo(0.08, -1.0, 0.15, -0.7);
    clawShape.quadraticCurveTo(0.22, -0.3, -0.02, 0);

    const extrudeSettings = {
        depth: 0.06,
        bevelEnabled: true,
        bevelSegments: 2,
        steps: 1,
        bevelSize: 0.005,
        bevelThickness: 0.005
    };

    const clawGeo = new THREE.ExtrudeGeometry(clawShape, extrudeSettings);
    clawGeo.translate(0, 0, -0.03); // 厚みの中心をZ軸に合わせる

    for (let i = 0; i < CLAW_COUNT; i++) {
        const clawGroup = new THREE.Group();
        const clawMesh = new THREE.Mesh(clawGeo, matChrome);
        clawMesh.castShadow = true;
        clawGroup.add(clawMesh);
        scene.add(clawGroup);
        clawVisuals.push(clawGroup);

        // 物理コライダーの簡易設定（グラつき防止のためキネマティック駆動）
        const clawBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: materials.physicsClaw });
        
        const shapeUpper = new CANNON.Box(new CANNON.Vec3(0.08, 0.3, 0.03));
        clawBody.addShape(shapeUpper, new CANNON.Vec3(0.1, -0.3, 0));

        const shapeLower = new CANNON.Box(new CANNON.Vec3(0.15, 0.04, 0.03));
        const qLower = new CANNON.Quaternion();
        qLower.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), 0.5);
        clawBody.addShape(shapeLower, new CANNON.Vec3(-0.02, -1.0, 0), qLower);

        const shapeTip = new CANNON.Sphere(0.11);
        clawBody.addShape(shapeTip, new CANNON.Vec3(-0.14, -1.13, 0));

        world.addBody(clawBody);
        clawLinks.push(clawBody);
    }

    updateClawPositions(1.0);
}

// 5. アームの位置・回転の完全同期と向き修正
function updateClawPositions(openRatio) {
    const center = craneUnitMesh.position;
    const angleStep = (Math.PI * 2) / CLAW_COUNT;
    const baseY = center.y - 0.7; 
    const r_base = 0.25;          
    const dt = 1 / 60;

    // 配列か数値かを判定し、互換性を維持する
    const ratios = Array.isArray(openRatio) ? openRatio : Array(CLAW_COUNT).fill(openRatio);

    for (let i = 0; i < CLAW_COUNT; i++) {
        // 各アームを等間隔に配置
        const angle = angleStep * i;
        const r = ratios[i];
        const swingAngle = -0.22 + r * 0.82; 

        const pX = center.x + Math.cos(angle) * r_base;
        const pZ = center.z + Math.sin(angle) * r_base;
        const pY = baseY;

        const nextPos = new CANNON.Vec3(pX, pY, pZ);

        const qFinal = new THREE.Quaternion();
        const qY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle);
        const qZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), swingAngle);
        
        // Y軸の向きを決定してから、開閉（Z軸）の傾きを適用
        qFinal.multiplyQuaternions(qY, qZ);
        const nextRot = new CANNON.Quaternion(qFinal.x, qFinal.y, qFinal.z, qFinal.w);

        // 速度の計算 (v = dx / dt)
        const vx = (nextPos.x - clawLinks[i].position.x) / dt;
        const vy = (nextPos.y - clawLinks[i].position.y) / dt;
        const vz = (nextPos.z - clawLinks[i].position.z) / dt;

        // 初期化時やリセットによる急激な移動（ワープ）を検知して速度を丸める
        const speedSq = vx*vx + vy*vy + vz*vz;
        if (speedSq > 400) { // 秒速20m以上
            clawLinks[i].velocity.set(0, 0, 0);
            clawLinks[i].angularVelocity.set(0, 0, 0);
        } else {
            clawLinks[i].velocity.set(vx, vy, vz);

            // 角速度の計算
            const qDiff = nextRot.mult(clawLinks[i].quaternion.inverse());
            clawLinks[i].angularVelocity.set(
                qDiff.x * 2 / dt,
                qDiff.y * 2 / dt,
                qDiff.z * 2 / dt
            );
        }

        // 物理位置・回転の更新
        clawLinks[i].position.copy(nextPos);
        clawLinks[i].quaternion.copy(nextRot);

        // メッシュ側へトランスフォームを完全に同期
        clawVisuals[i].position.copy(clawLinks[i].position);
        clawVisuals[i].quaternion.copy(clawLinks[i].quaternion);
    }
}

// --- 2D UI とイベント連携 ---
function initUI() {
    document.getElementById('cam-btn').addEventListener('click', () => {
        currentCameraView = (currentCameraView === 'front') ? 'side' : 'front';
    });

    setupButtonControl('move-up', 'up');
    setupButtonControl('move-down', 'down');
    setupButtonControl('move-left', 'left');
    setupButtonControl('move-right', 'right');

    window.addEventListener('keydown', (e) => {
        if (gameState !== 'move') return;
        if (e.key === 'ArrowUp' || e.key === 'w') keys.up = true;
        if (e.key === 'ArrowDown' || e.key === 's') keys.down = true;
        if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = true;
        if (e.key === 'ArrowRight' || e.key === 'd') keys.right = true;

        // スペースキーが押された時に掴む処理を実行（ページのスクロールを防止）
        if (e.key === ' ' || e.code === 'Space') {
            e.preventDefault();
            startCatchSequence();
        }
    });
    window.addEventListener('keyup', (e) => {
        if (e.key === 'ArrowUp' || e.key === 'w') keys.up = false;
        if (e.key === 'ArrowDown' || e.key === 's') keys.down = false;
        if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = false;
        if (e.key === 'ArrowRight' || e.key === 'd') keys.right = false;

        if (e.key === ' ' || e.code === 'Space') {
            e.preventDefault();
        }
    });

    document.getElementById('catch-btn').addEventListener('click', () => {
        if (gameState === 'move') startCatchSequence();
    });
}

function setupButtonControl(btnId, direction) {
    const btn = document.getElementById(btnId);
    const startAction = (e) => { e.preventDefault(); if (gameState === 'move') keys[direction] = true; };
    const endAction = (e) => { e.preventDefault(); keys[direction] = false; };
    
    btn.addEventListener('mousedown', startAction);
    btn.addEventListener('mouseup', endAction);
    btn.addEventListener('mouseleave', endAction);
    btn.addEventListener('touchstart', startAction);
    btn.addEventListener('touchend', endAction);
}

function startTimer() {
    clearInterval(timerInterval);
    timeLeft = 60;
    document.getElementById('timer').innerText = timeLeft;
    document.getElementById('catch-btn').disabled = false;

    timerInterval = setInterval(() => {
        if (gameState === 'move') {
            timeLeft--;
            document.getElementById('timer').innerText = timeLeft;
            if (timeLeft <= 0) startCatchSequence();
        }
    }, 1000);
}

// --- クレーンシーケンス ---
let sequenceTimer = 0;

function startCatchSequence() {
    gameState = 'drop';
    document.getElementById('catch-btn').disabled = true;
    keys.up = keys.down = keys.left = keys.right = false;
    sequenceTimer = 0;
    // キャッチシーケンス開始時に爪のロック状態を初期化
    clawLockedRatios = Array(CLAW_COUNT).fill(null);
    currentClawRatios = Array(CLAW_COUNT).fill(1.0);
    heldPrizeBodies.clear();
    heldPrizeOffsets.clear();
    prizeContactClaws.clear();
}

function updateCraneSequence() {
    if (gameState === 'move') return;

    if (gameState === 'drop') {
        craneUnitMesh.position.y -= 0.045;
        // 下降中は景品を包み込めるよう、アームを最大に開く(1.0)
        currentClawRatios = Array(CLAW_COUNT).fill(1.0);
        updateClawPositions(currentClawRatios); 
        if (craneUnitMesh.position.y <= DROP_DEPTH) {
            gameState = 'grab';
            sequenceTimer = 0;
        }
    } 
    else if (gameState === 'grab') {
        sequenceTimer += 0.02; 
        let targetRatio = 1.0 - (sequenceTimer * 1.5); 
        if (targetRatio < 0.0) targetRatio = 0.0; 
        
        // アームごとに衝突を確認し、個別に閉じる動きをストップ（ロック）する
        for (let i = 0; i < CLAW_COUNT; i++) {
            if (clawLockedRatios[i] !== null) {
                // ロック済みの場合はその開閉率をキープ
                currentClawRatios[i] = clawLockedRatios[i];
            } else {
                currentClawRatios[i] = targetRatio;
                if (checkClawContact(i)) {
                    // 景品に接触したら、めり込み反発（弾け飛び）を防ぐため、その瞬間の比率でロックする
                    clawLockedRatios[i] = Math.max(0.0, targetRatio);
                }
            }
        }
        updateClawPositions(currentClawRatios);

        if (sequenceTimer >= 1.0) { 
            captureContactedPrizes();
            gameState = 'lift';
        }
    } 
    else if (gameState === 'lift') {
        craneUnitMesh.position.y += LIFT_SPEED;
        updateClawPositions(currentClawRatios); // 掴んだアーム状態を維持して上昇
        if (craneUnitMesh.position.y >= CRANE_HOME_Y) {
            craneUnitMesh.position.y = CRANE_HOME_Y;
            updateClawPositions(currentClawRatios);
            gameState = 'hold';
            sequenceTimer = 0;
        }
    }
    else if (gameState === 'hold') {
        sequenceTimer += 1 / 60;
        updateClawPositions(currentClawRatios);
        if (sequenceTimer >= HOLD_PAUSE_DURATION) {
            gameState = 'return';
        }
    } 
    else if (gameState === 'return') {
        const targetX = HOLE_POS.x;
        const targetZ = HOLE_POS.z;
        
        let dx = targetX - craneUnitMesh.position.x;
        let dz = targetZ - craneUnitMesh.position.z;
        let dist = Math.sqrt(dx * dx + dz * dz);

        if (dist > 0.08) {
            craneUnitMesh.position.x += (dx / dist) * MOVE_SPEED;
            craneUnitMesh.position.z += (dz / dist) * MOVE_SPEED;
            updateClawPositions(currentClawRatios); // 掴んだアーム状態を維持
        } else {
            craneUnitMesh.position.x = targetX;
            craneUnitMesh.position.z = targetZ;
            gameState = 'releasePause';
            sequenceTimer = 0;
        }
    } 
    else if (gameState === 'releasePause') {
        sequenceTimer += 1 / 60;
        updateClawPositions(currentClawRatios);
        if (sequenceTimer >= RELEASE_PAUSE_DURATION) {
            prepareHeldPrizesForRelease();
            heldPrizeBodies.clear();
            heldPrizeOffsets.clear();
            releaseStartClawRatios = currentClawRatios.slice();
            gameState = 'release';
            sequenceTimer = 0;
        }
    }
    else if (gameState === 'release') {
        sequenceTimer += RELEASE_OPEN_SPEED;
        const openProgress = Math.min(sequenceTimer, 1.0);
        
        currentClawRatios = releaseStartClawRatios.map(startRatio => {
            return startRatio + (1.0 - startRatio) * openProgress;
        });
        updateClawPositions(currentClawRatios);

        if (openProgress >= 1.0) {
            gameState = 'reset';
            sequenceTimer = 0;
        }
    }
    else if (gameState === 'reset') {
        const targetX = 0;
        const targetZ = 0;
        let dx = targetX - craneUnitMesh.position.x;
        let dz = targetZ - craneUnitMesh.position.z;
        let dist = Math.sqrt(dx * dx + dz * dz);

        if (dist > 0.08) {
            craneUnitMesh.position.x += (dx / dist) * MOVE_SPEED;
            craneUnitMesh.position.z += (dz / dist) * MOVE_SPEED;
            updateClawPositions(1.0); 
        } else {
            craneUnitMesh.position.x = targetX;
            craneUnitMesh.position.z = targetZ;
            updateClawPositions(1.0);
            
            gameState = 'move';
            // 移動終了後にロックとアーム状態をリセット
            clawLockedRatios = Array(CLAW_COUNT).fill(null);
            currentClawRatios = Array(CLAW_COUNT).fill(1.0);
            heldPrizeBodies.clear();
            heldPrizeOffsets.clear();
            prizeContactClaws.clear();
            startTimer();
        }
    }
}

function prepareHeldPrizesForRelease() {
    heldPrizeBodies.forEach(body => {
        body.position.x += (HOLE_POS.x - body.position.x) * 0.25;
        body.position.z += (HOLE_POS.z - body.position.z) * 0.25;
        body.velocity.set(0, RELEASE_DROP_SPEED, 0);
        body.angularVelocity.set(0, 0, 0);
    });
}

function holdPrize(body) {
    if (!heldPrizeBodies.has(body)) {
        heldPrizeBodies.add(body);
        heldPrizeOffsets.set(body, new CANNON.Vec3(
            body.position.x - craneUnitMesh.position.x,
            body.position.y - craneUnitMesh.position.y,
            body.position.z - craneUnitMesh.position.z
        ));
    }
}

function registerPrizeContact(body, clawIndex) {
    if (!prizeContactClaws.has(body)) {
        prizeContactClaws.set(body, new Set());
    }
    prizeContactClaws.get(body).add(clawIndex);
}

function captureContactedPrizes() {
    prizeContactClaws.forEach((contactingClaws, body) => {
        if (!prizeBodies.includes(body)) return;

        const dx = body.position.x - craneUnitMesh.position.x;
        const dz = body.position.z - craneUnitMesh.position.z;
        const dy = body.position.y - craneUnitMesh.position.y;
        const isUnderClawCenter = Math.sqrt(dx * dx + dz * dz) < 0.75 && dy < -0.8 && dy > -4.6;

        if (contactingClaws.size >= 2 && isUnderClawCenter) {
            holdPrize(body);
        }
    });
}

// 爪と景品の接触判定
function checkClawContact(clawIndex) {
    const clawBody = clawLinks[clawIndex];
    for (let i = 0; i < world.contacts.length; i++) {
        const c = world.contacts[i];
        if (c.bi === clawBody || c.bj === clawBody) {
            const other = (c.bi === clawBody) ? c.bj : c.bi;
            if (prizeBodies.includes(other)) {
                registerPrizeContact(other, clawIndex);
                return true;
            }
        }
    }
    return false;
}

function calmHeldPrizeMotion(body) {
    const heldStates = ['lift', 'hold', 'return', 'releasePause'];
    if (!heldStates.includes(gameState)) return;
    if (!heldPrizeBodies.has(body)) return;

    const offset = heldPrizeOffsets.get(body);
    if (!offset) return;

    const targetX = craneUnitMesh.position.x + offset.x;
    const targetY = craneUnitMesh.position.y + offset.y;
    const targetZ = craneUnitMesh.position.z + offset.z;

    body.position.x += (targetX - body.position.x) * HELD_PRIZE_FOLLOW_STRENGTH;
    body.position.y += (targetY - body.position.y) * HELD_PRIZE_FOLLOW_STRENGTH;
    body.position.z += (targetZ - body.position.z) * HELD_PRIZE_FOLLOW_STRENGTH;

    body.velocity.scale(HELD_PRIZE_DAMPING, body.velocity);
    body.angularVelocity.scale(HELD_PRIZE_DAMPING, body.angularVelocity);

    const speed = body.velocity.length();
    if (speed > HELD_PRIZE_MAX_SPEED) {
        body.velocity.scale(HELD_PRIZE_MAX_SPEED / speed, body.velocity);
    }

    const angularSpeed = body.angularVelocity.length();
    if (angularSpeed > HELD_PRIZE_MAX_ANGULAR_SPEED) {
        body.angularVelocity.scale(HELD_PRIZE_MAX_ANGULAR_SPEED / angularSpeed, body.angularVelocity);
    }
}

// --- 景品の同期・穴判定処理 ---
function updatePrizesPhysics() {
    let gotPrize = false;
    let gotPrizeData = null;
    const MAX_SPEED = 4.0; // 吹き飛び防止のための最大速度制限

    for (let i = prizeBodies.length - 1; i >= 0; i--) {
        const body = prizeBodies[i];
        const mesh = prizeMeshes[i];

        // 速度制限の適用（異常な力で弾け飛ぶのを防止）
        const speed = body.velocity.length();
        if (speed > MAX_SPEED) {
            body.velocity.scale(MAX_SPEED / speed, body.velocity);
        }

        calmHeldPrizeMotion(body);

        mesh.position.copy(body.position);
        mesh.quaternion.copy(body.quaternion);

        const dx = body.position.x - HOLE_POS.x;
        const dz = body.position.z - HOLE_POS.z;
        const distToHole = Math.sqrt(dx * dx + dz * dz);

        if (distToHole < HOLE_SIZE * 0.55 && body.position.y < -4.8) {
            // 獲得した景品のデータを確保
            gotPrizeData = Object.assign({}, mesh.userData);

            scene.remove(mesh);
            world.remove(body);
            heldPrizeBodies.delete(body);
            heldPrizeOffsets.delete(body);
            prizeContactClaws.delete(body);
            
            prizeBodies.splice(i, 1);
            prizeMeshes.splice(i, 1);

            gotPrize = true;
        }
    }

    if (gotPrize && gotPrizeData) {
        triggerGetUI(gotPrizeData);
    }
}

// 獲得景品の3Dプレビューモーダルの初期化と表示
function triggerGetUI(prizeData) {
    if (isPreviewActive) return;

    // ゲーム状態を一時退避しモーダル停止状態へ
    savedGameState = gameState;
    gameState = 'modal';

    const overlay = document.getElementById('get-overlay');
    overlay.style.display = 'flex';

    // プレビュー用のキャンバスとシーン作成
    const canvas = document.getElementById('preview-canvas');
    const container = document.getElementById('preview-container');
    
    previewScene = new THREE.Scene();
    previewScene.background = new THREE.Color(0xfff0f5);

    // 縦横比を正しく算出し、最適なカメラ距離を維持
    const aspect = container.clientWidth / container.clientHeight;
    previewCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 10);
    previewCamera.position.set(0, 0, 2.3);

    previewRenderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    previewRenderer.setPixelRatio(window.devicePixelRatio);
    previewRenderer.setSize(container.clientWidth, container.clientHeight);
    previewRenderer.outputEncoding = THREE.sRGBEncoding;

    // モーダル用のライト設定
    const ambient = new THREE.AmbientLight(0xffffff, 1.1);
    previewScene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(2, 5, 3);
    previewScene.add(dir);

    // 軸ブレを防止しドラッグ回転を綺麗に行うための親グループ（Pivotグループ）を作成
    const previewGroup = new THREE.Group();
    previewScene.add(previewGroup);

    // 獲得景品モデルのクローンとプレビュー配置
    if (prizeData.type === 'glb' && prizeData.originalModel) {
        previewObject = prizeData.originalModel.clone(true);
        previewObject.position.set(0, 0, 0);

        // バウンディングボックスを用いて、あらゆるGLBのサイズを自動で計測
        const box = new THREE.Box3().setFromObject(previewObject);
        const size = box.getSize(new THREE.Vector3());
        const maxSize = Math.max(size.x, size.y, size.z);

        // ウィンドウ内に最大に表示するための目標スケール（最長辺を 1.5 に正規化する）
        const targetPreviewSize = 1.5;
        if (maxSize > 0) {
            const scaleFactor = targetPreviewSize / maxSize;
            previewObject.scale.multiplyScalar(scaleFactor);
        }

        // 正規化後のモデルのズレを再計測し、中心が必ず (0, 0, 0) に重なるよう補正
        const updatedBox = new THREE.Box3().setFromObject(previewObject);
        const updatedCenter = updatedBox.getCenter(new THREE.Vector3());
        previewObject.position.sub(updatedCenter);

    } else {
        // フォールバック景品の再現
        const radius = 0.72; 
        const mat = new THREE.MeshStandardMaterial({
            color: prizeData.color || 0xff758c,
            roughness: 0.5,
            metalness: 0.05
        });
        let geo;
        if (prizeData.isSphere) {
            geo = new THREE.SphereGeometry(radius, 32, 32);
        } else {
            geo = new THREE.BoxGeometry(radius * 1.3, radius * 1.3, radius * 1.3);
        }
        previewObject = new THREE.Mesh(geo, mat);
    }

    // Pivotグループにオブジェクトを追加
    previewGroup.add(previewObject);

    // 回転量の初期化（以降は親グループを回転させる）
    previewRotation = { x: 0.1, y: 0.5 };
    previewGroup.rotation.set(previewRotation.x, previewRotation.y, 0);

    isPreviewActive = true;

    // ドラッグイベントの紐付け
    setupPreviewInteraction(container);

    // 次へボタンのイベントハンドラ
    const closeBtn = document.getElementById('close-modal-btn');
    const onCloseClick = () => {
        closeBtn.removeEventListener('click', onCloseClick);
        destroyPreview();
        overlay.style.display = 'none';
        
        // 元のゲーム状態に復帰
        gameState = savedGameState || 'move';
    };
    closeBtn.addEventListener('click', onCloseClick);

    // プレビュー描画ループ
    function renderPreview() {
        if (!isPreviewActive) return;
        previewAnimId = requestAnimationFrame(renderPreview);

        // ドラッグしていない間は自動でゆっくり回転
        if (!isDraggingPreview) {
            previewRotation.y += 0.012;
        }

        previewGroup.rotation.x = previewRotation.x;
        previewGroup.rotation.y = previewRotation.y;

        previewRenderer.render(previewScene, previewCamera);
    }
    renderPreview();
}

function setupPreviewInteraction(container) {
    const onStart = (clientX, clientY) => {
        isDraggingPreview = true;
        previousMousePosition = { x: clientX, y: clientY };
    };

    const onMove = (clientX, clientY) => {
        if (!isDraggingPreview || !previewObject) return;
        const deltaX = clientX - previousMousePosition.x;
        const deltaY = clientY - previousMousePosition.y;

        previewRotation.y += deltaX * 0.015;
        previewRotation.x += deltaY * 0.015;

        // 縦方向の回転を制限
        previewRotation.x = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, previewRotation.x));

        previousMousePosition = { x: clientX, y: clientY };
    };

    const onEnd = () => {
        isDraggingPreview = false;
    };

    // マウス操作
    container.addEventListener('mousedown', (e) => onStart(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', onEnd);

    // タッチ操作
    container.addEventListener('touchstart', (e) => {
        if (e.touches.length > 0) {
            onStart(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
        if (e.touches.length > 0) {
            onMove(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: true });
    window.addEventListener('touchend', onEnd);
}

// プレビューのクリーンアップ処理
function destroyPreview() {
    isPreviewActive = false;
    cancelAnimationFrame(previewAnimId);

    if (previewRenderer) {
        previewRenderer.dispose();
    }
    previewScene = null;
    previewCamera = null;
    previewRenderer = null;
    previewObject = null;
}

// --- メインループ ---
function animate() {
    requestAnimationFrame(animate);

    // 1. 位置・速度の更新
    if (gameState === 'move') {
        if (keys.up)    craneUnitMesh.position.z -= MOVE_SPEED;
        if (keys.down)  craneUnitMesh.position.z += MOVE_SPEED;
        if (keys.left)  craneUnitMesh.position.x -= MOVE_SPEED;
        if (keys.right) craneUnitMesh.position.x += MOVE_SPEED;

        craneUnitMesh.position.x = Math.max(-LIMIT_X, Math.min(LIMIT_X, craneUnitMesh.position.x));
        craneUnitMesh.position.z = Math.max(-LIMIT_Z, Math.min(LIMIT_Z, craneUnitMesh.position.z));
        
        updateClawPositions(1.0); // 待機移動中も広角に開いた状態を維持
    } else {
        updateCraneSequence();
    }

    // 2. 物理エンジンの進行
    world.step(1 / 60);

    // 3. 景品の物理同期
    updatePrizesPhysics();

    const currentCam = activeCameras[currentCameraView];
    renderer.render(scene, currentCam);
}

function onWindowResize() {
    const container = document.getElementById('canvas-container');
    const width = container.clientWidth;
    const height = container.clientHeight;

    for (let key in activeCameras) {
        activeCameras[key].aspect = width / height;
        activeCameras[key].updateProjectionMatrix();
    }
    renderer.setSize(width, height);
}
