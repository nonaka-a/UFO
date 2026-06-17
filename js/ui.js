let timerInterval;

// --- プレビューシーン用変数 ---
let previewScene, previewCamera, previewRenderer, previewObject;
let isPreviewActive = false;
let previewAnimId;
let previewRotation = { x: 0, y: 0 };
let isDraggingPreview = false;
let previousMousePosition = { x: 0, y: 0 };
let savedGameState = null;

// UIインタラクション初期化
function initUI() {
    // 180度カメラ用にカメラボタンの動作を拡張（どこからでも一度正面に戻り、正面なら右側面へトグル）
    document.getElementById('cam-btn').addEventListener('click', () => {
        if (cameraTheta !== 0) {
            cameraTheta = 0; // 正面(0度)に戻す
        } else {
            cameraTheta = Math.PI / 2; // 右側面(90度)に回す
        }
        updateMainCamera();
    });

    // アーム（クレーン本体と爪）の影投影フラグのみを再帰的に切り替えるヘルパー
    function setCraneShadow(enabled) {
        if (craneUnitMesh) {
            craneUnitMesh.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = enabled;
                }
            });
        }
        clawVisuals.forEach((claw) => {
            claw.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = enabled;
                }
            });
        });
    }

    // 右下のトグルボタン。景品の影は残したまま、アーム自体の影だけをオンオフします
    const shadowBtn = document.getElementById('shadow-toggle-btn');
    let isCraneShadowEnabled = true; // アームの影の初期状態
    
    if (shadowBtn) {
        shadowBtn.addEventListener('click', () => {
            isCraneShadowEnabled = !isCraneShadowEnabled;
            
            // アーム自体の影投影フラグのみを切り替える
            setCraneShadow(isCraneShadowEnabled);
            
            if (isCraneShadowEnabled) {
                shadowBtn.innerText = '影: オン';
                shadowBtn.classList.remove('shadow-off');
            } else {
                shadowBtn.innerText = '影: オフ';
                shadowBtn.classList.add('shadow-off');
            }
            // シャドウマップの更新をトリガー
            renderer.shadowMap.needsUpdate = true;
        });
    }

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

// 獲得景品の3Dプレビューモーダルの初期化と表示
function triggerGetUI(prizeData) {
    if (isPreviewActive) return;

    savedGameState = gameState;
    gameState = 'modal';

    const overlay = document.getElementById('get-overlay');
    overlay.style.display = 'flex';

    const canvas = document.getElementById('preview-canvas');
    const container = document.getElementById('preview-container');
    
    previewScene = new THREE.Scene();
    previewScene.background = new THREE.Color(0xfff0f5);

    const aspect = container.clientWidth / container.clientHeight;
    previewCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 10);
    previewCamera.position.set(0, 0, 2.3);

    previewRenderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    previewRenderer.setPixelRatio(window.devicePixelRatio);
    previewRenderer.setSize(container.clientWidth, container.clientHeight);
    previewRenderer.outputEncoding = THREE.sRGBEncoding;

    const ambient = new THREE.AmbientLight(0xffffff, 1.1);
    previewScene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(2, 5, 3);
    previewScene.add(dir);

    const previewGroup = new THREE.Group();
    previewScene.add(previewGroup);

    if (prizeData.type === 'glb' && prizeData.originalModel) {
        previewObject = prizeData.originalModel.clone(true);
        previewObject.position.set(0, 0, 0);

        const box = new THREE.Box3().setFromObject(previewObject);
        const size = box.getSize(new THREE.Vector3());
        const maxSize = Math.max(size.x, size.y, size.z);

        const targetPreviewSize = 1.5;
        if (maxSize > 0) {
            const scaleFactor = targetPreviewSize / maxSize;
            previewObject.scale.multiplyScalar(scaleFactor);
        }

        const updatedBox = new THREE.Box3().setFromObject(previewObject);
        const updatedCenter = updatedBox.getCenter(new THREE.Vector3());
        previewObject.position.sub(updatedCenter);

    } else {
        const radius = 0.72; 
        const isSphere = prizeData.isSphere;
        const baseColor = prizeData.color || 0xff758c;

        const mat = new THREE.MeshStandardMaterial({
            color: isSphere ? 0xffffff : baseColor, // 球体はお顔が暗くならないようにベースは白
            roughness: 0.5,
            metalness: 0.05
        });

        // 獲得画面で表示する球体（ニコちゃん）にもお顔のテクスチャを再現して貼り付ける
        if (isSphere) {
            mat.map = createSmileyTexture(baseColor);
            mat.needsUpdate = true;
        }

        let geo;
        if (isSphere) {
            geo = new THREE.SphereGeometry(radius, 32, 32);
        } else {
            geo = new THREE.BoxGeometry(radius * 1.3, radius * 1.3, radius * 1.3);
        }
        previewObject = new THREE.Mesh(geo, mat);
    }

    previewGroup.add(previewObject);

    previewRotation = { x: 0.1, y: 0.5 };
    previewGroup.rotation.set(previewRotation.x, previewRotation.y, 0);

    isPreviewActive = true;

    setupPreviewInteraction(container, previewGroup);

    const closeBtn = document.getElementById('close-modal-btn');
    const onCloseClick = () => {
        closeBtn.removeEventListener('click', onCloseClick);
        destroyPreview();
        overlay.style.display = 'none';
        gameState = savedGameState || 'move';
    };
    closeBtn.addEventListener('click', onCloseClick);

    function renderPreview() {
        if (!isPreviewActive) return;
        previewAnimId = requestAnimationFrame(renderPreview);

        if (!isDraggingPreview) {
            previewRotation.y += 0.012;
        }

        previewGroup.rotation.x = previewRotation.x;
        previewGroup.rotation.y = previewRotation.y;

        previewRenderer.render(previewScene, previewCamera);
    }
    renderPreview();
}

function setupPreviewInteraction(container, targetGroup) {
    const onStart = (clientX, clientY) => {
        isDraggingPreview = true;
        previousMousePosition = { x: clientX, y: clientY };
    };

    const onMove = (clientX, clientY) => {
        if (!isDraggingPreview || !targetGroup) return;
        const deltaX = clientX - previousMousePosition.x;
        const deltaY = clientY - previousMousePosition.y;

        previewRotation.y += deltaX * 0.015;
        previewRotation.x += deltaY * 0.015;

        previewRotation.x = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, previewRotation.x));

        previousMousePosition = { x: clientX, y: clientY };
    };

    const onEnd = () => {
        isDraggingPreview = false;
    };

    container.addEventListener('mousedown', (e) => onStart(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', onEnd);

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