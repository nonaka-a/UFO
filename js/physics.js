let world;
const materials = {};

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
            contactEquationStiffness: 20000,   // するっと抜けないように剛性を適度に硬く維持
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