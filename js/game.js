// --- ゲーム状態管理 ---
let gameState = 'move'; 
let timeLeft = 60;
let currentCameraView = 'front';

const CLAW_COUNT = 4;
let currentClawRatios = Array(CLAW_COUNT).fill(1.0);
let clawLockedRatios = Array(CLAW_COUNT).fill(null);
let releaseStartClawRatios = Array(CLAW_COUNT).fill(1.0);

const keys = { up: false, down: false, left: false, right: false };

let scene, renderer;
let activeCameras = {};

let prizeBodies = [], prizeMeshes = []; 
let heldPrizeBodies = new Set();
let heldPrizeOffsets = new Map();
let prizeContactClaws = new Map();

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

// --- カメラドラッグ用状態変数 ---
let isDraggingCamera = false;
let prevCameraMouseX = 0;
let cameraTheta = 0; // 0 = 正面 (0度), Math.PI/2 = 右側面 (90度)
let bgDome;          // 遠景としてカメラに追従させるための背景ドーム変数

initPhysics();
initThree();
createStage();
createCrane();
createPrizes();
initUI();
startTimer();

// BGM（BGM.mp3）のオーディオ設定
const bgm = new Audio('BGM.mp3');
bgm.loop = true;
bgm.volume = 0.45; // プレイの邪魔にならないよう、適度な音量に調整

// ブラウザの自動再生ブロックを回避するため、最初のユーザー操作でBGMを開始
function playBGMOnFirstInteraction() {
    bgm.play().then(() => {
        // 再生が開始されたらイベントリスナーを破棄
        window.removeEventListener('click', playBGMOnFirstInteraction);
        window.removeEventListener('keydown', playBGMOnFirstInteraction);
        window.removeEventListener('touchstart', playBGMOnFirstInteraction);
    }).catch(err => {
        console.warn('BGMの自動再生ポリシーによるブロック: ', err);
    });
}

// 各種操作イベントにBGM再生処理を紐付け
window.addEventListener('click', playBGMOnFirstInteraction);
window.addEventListener('keydown', playBGMOnFirstInteraction);
window.addEventListener('touchstart', playBGMOnFirstInteraction);

animate();

function isAppleMobileDevice() {
    const isTouchDevice = navigator.maxTouchPoints && navigator.maxTouchPoints > 1;
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && isTouchDevice);
}

// 2. Three.js の初期化
function initThree() {
    const container = document.getElementById('canvas-container');
    scene = new THREE.Scene();
    
    // 空間のベース背景色
    scene.background = new THREE.Color(0xffe3ed); 

    // カメラに連動する背景球体（スカイドーム）をシーンに追加
    // カメラのクリッピング限界（far:100）の手前に収まるよう、半径45 of 球体に設定
    const bgGeometry = new THREE.SphereGeometry(45, 32, 32);
    const bgMaterial = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
    bgDome = new THREE.Mesh(bgGeometry, bgMaterial);
    
    // 初期配置
    bgDome.position.set(0, 0, 0);
    scene.add(bgDome);

    // 背景画像 (BG.jpg) をロードしてドームマテリアルに適用
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load('BG.jpg', (texture) => {
        texture.encoding = THREE.sRGBEncoding;
        
        // 横方向への引き伸ばしを少し抑えて縮小（タイリング）し、自然な表示にする設定
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.repeat.set(2, 1); // 横方向の密度を2倍にして背景をスッキリ小さく見せる
        
        bgMaterial.map = texture;
        bgMaterial.needsUpdate = true;
    }, undefined, (err) => {
        console.warn('背景画像 "BG.jpg" の読み込みに失敗しました。', err);
    });

    const mainCam = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    activeCameras.front = mainCam;
    updateMainCamera();

    renderer = new THREE.WebGLRenderer({ antialias: !IS_APPLE_MOBILE, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = !IS_APPLE_MOBILE;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; 
    
    renderer.outputEncoding = THREE.sRGBEncoding;

    renderer.domElement.addEventListener('webglcontextlost', event => {
        event.preventDefault();
        console.warn('WebGL context lost. iPadではGLB景品数や描画品質を下げて復旧を待ちます。');
    });
    container.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.55);
    dirLight.position.set(0, 15, 0); 
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

    initCameraDrag();

    window.addEventListener('resize', onWindowResize);
}

function updateMainCamera() {
    const minTheta = 0;
    const maxTheta = Math.PI / 2;
    cameraTheta = Math.max(minTheta, Math.min(maxTheta, cameraTheta));

    const R = 9.2; 
    const ratio = cameraTheta / (Math.PI / 2);
    const Y = 4.8 + ratio * (2.2 - 4.8);

    const X = R * Math.sin(cameraTheta);
    const Z = R * Math.cos(cameraTheta);

    const mainCam = activeCameras.front;
    if (mainCam) {
        mainCam.position.set(X, Y, Z);
        mainCam.lookAt(0, -1.2, 0);
    }
}

function initCameraDrag() {
    const dom = renderer.domElement;

    const onStart = (clientX) => {
        if (gameState === 'modal') return;
        isDraggingCamera = true;
        prevCameraMouseX = clientX;
    };

    const onMove = (clientX) => {
        if (!isDraggingCamera || gameState === 'modal') return;
        const dx = clientX - prevCameraMouseX;
        
        // ドラッグ方向とカメラワークの直感を一致させるため、減算 ( -= ) に変更
        cameraTheta -= dx * 0.006;
        
        prevCameraMouseX = clientX;
        updateMainCamera();
    };

    const onEnd = () => {
        isDraggingCamera = false;
    };

    dom.addEventListener('mousedown', (e) => onStart(e.clientX));
    window.addEventListener('mousemove', (e) => onMove(e.clientX));
    window.addEventListener('mouseup', onEnd);

    dom.addEventListener('touchstart', (e) => {
        if (e.touches.length > 0) {
            onStart(e.touches[0].clientX);
        }
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
        if (e.touches.length > 0) {
            onMove(e.touches[0].clientX);
        }
    }, { passive: true });
    window.addEventListener('touchend', onEnd);
}

// 景品の同期・穴判定処理
function updatePrizesPhysics() {
    let gotPrize = false;
    let gotPrizeData = null;
    const MAX_SPEED = 4.0; 

    for (let i = prizeBodies.length - 1; i >= 0; i--) {
        const body = prizeBodies[i];
        const mesh = prizeMeshes[i];

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

// --- メインループ ---
function animate() {
    requestAnimationFrame(animate);

    if (gameState === 'move') {
        if (keys.up)    craneUnitMesh.position.z -= MOVE_SPEED;
        if (keys.down)  craneUnitMesh.position.z += MOVE_SPEED;
        if (keys.left)  craneUnitMesh.position.x -= MOVE_SPEED;
        if (keys.right) craneUnitMesh.position.x += MOVE_SPEED;

        craneUnitMesh.position.x = Math.max(-LIMIT_X, Math.min(LIMIT_X, craneUnitMesh.position.x));
        craneUnitMesh.position.z = Math.max(-LIMIT_Z, Math.min(LIMIT_Z, craneUnitMesh.position.z));
        
        updateClawPositions(1.0); 
    } else {
        updateCraneSequence();
    }

    world.step(1 / 60);
    updatePrizesPhysics();

    // 毎フレーム、背景ドームの位置をアクティブカメラの位置に完全追従させる（無限遠効果）
    // これにより、カメラがどう動いても背景が極端に寄らず、はるか遠くに小さく美しく表示されます
    if (bgDome && activeCameras.front) {
        bgDome.position.copy(activeCameras.front.position);
    }

    renderer.render(scene, activeCameras.front);
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