import * as THREE from 'three';

// Local instance of moveable object with mesh
export default class Pawn {
    mesh;
    
    constructor(manager, position, mesh) {
        this.manager = manager;

        // MESH
        /*this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial());
        this.mesh.castShadow = true;
        this.manager.scene.add(this.mesh);*/
        
        this.manager.loader.load(mesh, (gltf) => {
            gltf.scene.traverse(function (child) {
                child.castShadow = true;
                child.receiveShadow = true;
            });

            this.mesh = gltf.scene;
            this.manager.scene.add(gltf.scene);
            this.setPosition(this.position);
        });
        
        this.setPosition(position);
    }
    
    animate() { }
    
    setPosition(position) {
        this.position = position;
        
        if (this.mesh) {
            this.mesh.position.copy(position);
        }
    }
}
