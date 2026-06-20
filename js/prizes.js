// 景品設定: GLBを増やすときは modelPaths にパスを追加する
const PRIZE_CONFIG = {
    modelPaths: ['GLB/cap.glb', 'GLB/ninja.glb','GLB/macho.glb','GLB/pityu.glb','GLB/kamu.glb','GLB/torikera.glb','GLB/pack.glb'],
    fallbackCount: 24,
    modelCount: 16,
    mobileModelCount: 8,
    baseSize: 0.6,
    glbScale: 2.0
};

// 6. 景品の生成
function createPrizes() {
    const modelPaths = PRIZE_CONFIG.modelPaths;
    const fallbackCount = PRIZE_CONFIG.fallbackCount;
    const modelCount = getModelPrizeCount();
    const size = PRIZE_CONFIG.baseSize;
    const modelSize = size * PRIZE_CONFIG.glbScale;

    createFallbackPrizes(fallbackCount);

    if (!THREE.GLTFLoader) {
        return;
    }

    const loader = new THREE.GLTFLoader();
    Promise.all(modelPaths.map(path => {
        return loadPrizeModel(loader, path, modelSize).catch(error => {
            console.warn(`GLB景品を読み込めませんでした: ${path}`, error);
            return null;
        });
    }))
        .then(results => {
            const models = results.filter(model => model !== null);

            if (models.length > 0) {
                createModelPrizes(models, modelCount, modelSize, fallbackCount);
            } else {
                console.warn('GLB景品を読み込めませんでした。ローカルサーバー経由で開いているか確認してください。');
            }
        })
        .catch(error => {
            console.warn('GLB景品の読み込み中にエラーが発生しました。', error);
        });
}

function getModelPrizeCount() {
    const isTouchDevice = navigator.maxTouchPoints && navigator.maxTouchPoints > 1;
    const isAppleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && isTouchDevice);

    return isAppleMobile ? PRIZE_CONFIG.mobileModelCount : PRIZE_CONFIG.modelCount;
}

function loadPrizeModel(loader, path, targetSize) {
    return new Promise((resolve, reject) => {
        loader.load(path, gltf => {
            const model = gltf.scene;
            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            const modelSize = box.getSize(new THREE.Vector3());
            const maxSize = Math.max(modelSize.x, modelSize.y, modelSize.z);
            const scale = maxSize > 0 ? targetSize / maxSize : 1;

            model.scale.multiplyScalar(scale);
            model.position.copy(center).multiplyScalar(-scale);
            model.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    child.frustumCulled = false;
                }
            });

            // モデル情報にオリジナルのパスを付与して後から複製できるようにする
            model.userData = { path: path };

            resolve(model);
        }, undefined, reject);
    });
}

function createModelPrizes(models, count, size, startIndex) {
    for (let i = 0; i < count; i++) {
        const originalModel = models[i % models.length];
        const model = originalModel.clone(true);
        const body = new CANNON.Body({
            mass: 0.38,
            shape: new CANNON.Box(new CANNON.Vec3(size * 0.35, size * 0.35, size * 0.35)),
            material: materials.physicsDefault
        });

        body.linearDamping = 0.6;
        body.angularDamping = 0.6;

        const position = getPrizeStartPosition(startIndex + i);
        model.position.set(position.x, position.y, position.z);
        model.rotation.y = Math.random() * Math.PI * 2;
        
        // プレビュー用にuserDataをクローン側へ継承
        model.userData = { 
            type: 'glb', 
            path: originalModel.userData.path,
            originalModel: originalModel 
        };

        scene.add(model);
        prizeMeshes.push(model);

        body.position.set(position.x, position.y, position.z);
        body.quaternion.setFromEuler(0, model.rotation.y, 0);
        world.addBody(body);
        prizeBodies.push(body);
    }
}

// 動的にニコちゃんマークのテクスチャをCanvasに描画して生成する関数
function createSmileyTexture(colorHex) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    // カラーコードを文字列に変換
    const colorStr = "#" + colorHex.toString(16).padStart(6, '0');

    // ベースの球体色で塗りつぶし
    ctx.fillStyle = colorStr;
    ctx.fillRect(0, 0, 256, 256);

    // 球体への貼付時の3D横引き伸ばしに完全に対抗するため、
    // X軸方向の縮小スケールを「0.55倍」に更に強化してお顔を中心にきゅっと収縮させます
    ctx.save();
    ctx.translate(128, 128);
    ctx.scale(0.55, 1.0);
    ctx.translate(-128, -128);

    // 目の描画（お目々が離れすぎないように中心128にさらに10pxずつ近づけて配置）
    ctx.fillStyle = '#2c3e50';
    // 左目
    ctx.beginPath();
    ctx.arc(96, 105, 14, 0, Math.PI * 2);
    ctx.fill();
    // 右目
    ctx.beginPath();
    ctx.arc(160, 105, 14, 0, Math.PI * 2);
    ctx.fill();

    // 目のハイライト（お目々の移動に同期させて配置）
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(91, 99, 4.5, 0, Math.PI * 2);
    ctx.arc(155, 99, 4.5, 0, Math.PI * 2);
    ctx.fill();

    // にっこりスマイル口
    ctx.strokeStyle = '#2c3e50';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(128, 124, 38, 0.12 * Math.PI, 0.88 * Math.PI);
    ctx.stroke();

    // 描画倍率の復元
    ctx.restore();

    // Three.jsテクスチャへ変換
    const texture = new THREE.CanvasTexture(canvas);
    texture.encoding = THREE.sRGBEncoding;
    return texture;
}

function createFallbackPrizes(count) {
    // 彩度と明度をわずかに抑えたパステルカラーに変更
    const pastelColors = [0xe0667a, 0xe070d8, 0x6ecf8c, 0x6290e0, 0xd4ba59, 0xe0a2a2, 0x94e067, 0x1d919c];
    const size = 0.6; 
    const radius = 0.32; 

    for (let i = 0; i < count; i++) {
        const isSphere = (i % 2 === 0);
        
        let geo, mesh, body;
        const colorVal = pastelColors[i % pastelColors.length];
        
        const mat = new THREE.MeshStandardMaterial({ 
            color: isSphere ? 0xffffff : colorVal, // 球体の場合はテクスチャ自体のパステルカラーを反映させるためベースは白色
            roughness: 0.6, // 反射を抑えてマット（ぬいぐるみ風）な質感に調整
            metalness: 0.05
        });

        // 球体（Sphere）の場合のみニコちゃんテクスチャをマッピング
        if (isSphere) {
            mat.map = createSmileyTexture(colorVal);
            mat.needsUpdate = true;
        }

        if (isSphere) {
            geo = new THREE.SphereGeometry(radius, 20, 20);
            mesh = new THREE.Mesh(geo, mat);
            body = new CANNON.Body({
                mass: 0.38, 
                shape: new CANNON.Sphere(radius * 0.8), // 20%縮小コライダーでめり込み（柔らかさ）を表現
                material: materials.physicsDefault
            });
        } else {
            geo = new THREE.BoxGeometry(size, size, size);
            mesh = new THREE.Mesh(geo, mat);
            body = new CANNON.Body({
                mass: 0.38, 
                shape: new CANNON.Box(new CANNON.Vec3((size/2) * 0.8, (size/2) * 0.8, (size/2) * 0.8)), // 20%縮小コライダー
                material: materials.physicsDefault
            });
        }

        // ぬいぐるみのもちもちした動き（滑り抑制）を表現
        body.linearDamping = 0.6;
        body.angularDamping = 0.6;

        mesh.castShadow = true;
        mesh.receiveShadow = true;

        // プレビュー用に形状とカラー情報を保存
        mesh.userData = { 
            type: 'fallback', 
            isSphere: isSphere, 
            color: colorVal 
        };

        const position = getPrizeStartPosition(i);

        mesh.position.set(position.x, position.y, position.z);
        
        // 球体（ニコちゃん）はお顔が適度にカメラ（手前）を向くように、Y回転角度を制御して配置
        if (isSphere) {
            mesh.rotation.y = (Math.random() - 0.5) * 1.5; // 正面（カメラ方向）を中心に少し左右に傾ける
        }

        scene.add(mesh);
        prizeMeshes.push(mesh);

        body.position.set(position.x, position.y, position.z);
        if (isSphere) {
            body.quaternion.setFromEuler(0, mesh.rotation.y, 0);
        } else {
            body.quaternion.setFromEuler(Math.random(), Math.random(), Math.random());
        }
        world.addBody(body);
        prizeBodies.push(body);
    }
}

function getPrizeStartPosition(index) {
    let posX, posZ;
    let validPos = false;
    while(!validPos) {
        posX = (Math.random() - 0.5) * 7.2 + 0.4; 
        posZ = (Math.random() - 0.5) * 7.2 - 0.4; 
        const dx = posX - HOLE_POS.x;
        const dz = posZ - HOLE_POS.z;
        if (Math.sqrt(dx*dx + dz*dz) > HOLE_SIZE * 0.85) {
            validPos = true;
        }
    }

    return {
        x: posX,
        y: -4.5 + (Math.floor(index / 8) * 0.65),
        z: posZ
    };
}