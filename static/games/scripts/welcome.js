self.world.addEventListener("start", async () => {
    let birdHeight = 4.3;
    let bird = new Pawn({
        name: "Bird Statue",
        position: new Vector3(-1.9,2.8,-1.35),
        rotation: new Vector3(0, Math.PI/6, 0),
        mesh: 'generic/bird.gltf', colliderShapes: [
            new Cylinder(1.5, birdHeight)
        ],
    });

    let deck = new Deck({
        name: "Welcome", contents: ["generic/welcome.png"],
        sideColor: 0x000000, cornerRadius: 0.06,
        position: new Vector3(0.9, 0, 0),
        size: new Vector2(1.25 * 8, 1 * 8),
        moveable: false
    });

    let birdSnap = new SnapPoint({
        position: new Vector3(-1.9,0,-1.35),
    });

    let die = new Dice({
        name: 'Die', position: new Vector3(0,1,0),
        mesh: 'generic/die.gltf',
        rollRotations: [
            new Vector3(0, 0, 0),
            new Vector3(Math.PI/2, 0, 0),
            new Vector3(Math.PI, 0, 0),
            new Vector3(-Math.PI/2, 0, 0),
            new Vector3(0, 0, Math.PI/2),
            new Vector3(0, 0, -Math.PI/2),
        ],
        colliderShapes: [
            new Box(new Vector3(1/3,1/3,1/3))
        ]
    });

    // let bag = new Container({
    //     name: "Bird Bag", holds: bird,
    //     position: new Vector3(1.9,1.25,-1.35),
    //     rotation: new Vector3(0, -Math.PI/6, 0),
    //     mesh: 'generic/bag.gltf', colliderShapes: [
    //         new Cylinder(1.5, 2.5)
    //     ],
    // })

    self.world.add([bird, deck, birdSnap, die]);

    /*for (let i = 0; i < 5; i++) {
        let birdHeight = 4.3;
        let bird = new Pawn({
            name: "Bird Statue",
            position: new Vector3(-1.9,2.8,-1.35),
            rotation: new Vector3(0, Math.PI/6, 0),
            mesh: 'generic/bird.gltf', colliderShapes: [
                new Cylinder(1.5, birdHeight)
            ],
        });
        self.world.add(bird);

        await timeout(500);
    }
    while (true) {
        for (let pawn of self.world.pawns().values()) {
            if (pawn.name == "Bird Statue") {
                pawn.position.y += Math.random() * 2.0;
            }
        }
        //self.world.commit(self.world.pawns().values().filter(p => p.name == "Bird Statue").map(p => p.id));
        self.world.commit();
        await timeout(1000);
    }*/
});
