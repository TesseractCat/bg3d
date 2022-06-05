self.start = async function() {
    console.log("Starting chess...");

    addPawn(new Pawn({
        position: new Vector3(0,5,0),
        mesh: 'king_white.gltf',
        name: 'King',
        colliderShapes: [new Cylinder(0.7, 3.18)],
    }));
}
