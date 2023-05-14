self.world.addEventListener("start", () => {
    let bird = new Pawn({
        name: "Bird Statue",
        position: new Vector3(-1.6,2.8,-1.8),
        rotation: new Vector3(0, Math.PI/6, 0),
        mesh: 'generic/bird.glb',
    });

    let stand = new Pawn({
        name: "Stand",
        tint: 0xf1ede1,
        position: bird.position.setComponent(1, 0),
        mesh: 'generic/stand.gltf',
        moveable: false
    });

    let mat = new Deck({
        name: "Mat", contents: ["notes/cork.webp"],
        border: "notes/mat.svg",
        sideColor: 0x000000, cornerRadius: 0.03,
        position: new Vector3(0, 0, 0.5),
        rotation: new Vector3(0, 0, 0),
        size: new Vector2(10, 9),
        moveable: false
    });

    let deck = new Deck({
        name: 'Cards',
        back: 'generic/cards/back.webp',
        contents: standardDeck(), cornerRadius: 0.06,
        position: new Vector3(bird.position.x + 3.25, 1, bird.position.z),
        rotation: new Vector3(0, -Math.PI/2 - Math.PI/32, 0),
        size: new Vector2(2.5, 3.5),
    });

    let birdSnap = new SnapPoint({
        position: bird.position.setComponent(1, 1),
    });

    let mini = new Pawn({
        name: "Mini Bird",
        tint: 0xdd2222,
        mesh: 'generic/minibird.gltf'
    });
    let bag = new Container({
        name: "Mystery Bag", holds: mini, capacity: 5,
        position: new Vector3(-6.5, 0, 0),
        rotation: new Vector3(0, Math.PI/16, 0),
        mesh: 'generic/bag.gltf',
    })

    let postIts = [
        new Pawn({
            name: "Post-it", tint: 0xFFFF99,
            position: new Vector3(-2.8, 2.8, 3),
            rotation: new Vector3(0, -Math.PI/32, 0),
            texture: 'notes/welcome.webp',
            mesh: 'notes/post-it.gltf',
        }),
        new Pawn({
            name: "Post-it", tint: 0xFF99FF,
            position: new Vector3(1.0, 2.8, 2.8),
            rotation: new Vector3(0, Math.PI/22, 0),
            texture: 'notes/info.webp',
            mesh: 'notes/post-it.gltf',
        }),
        new Pawn({
            name: "Post-it", tint: 0xBBFFFF,
            position: new Vector3(6.0, 2.8, -1.6),
            rotation: new Vector3(0, Math.PI/2 - Math.PI/64, 0),
            texture: 'notes/cards.webp',
            mesh: 'notes/post-it.gltf',
        }),
    ];

    self.world.add([stand, bird, birdSnap, deck, mat, bag]);
    self.world.add(postIts);

    let queen = new Pawn({
        name: "Queen",
        mesh: 'chess/queen.gltf',
        position: new Vector3(3.5,1,1),
        tint: 0x303030
    });
    let die = new Dice({
        name: 'Die',
        position: new Vector3(4,1,3),
        mesh: 'generic/die.gltf',
        rollRotations: [
            new Vector3(0, 0, 0),
            new Vector3(Math.PI/2, 0, 0),
            new Vector3(Math.PI, 0, 0),
            new Vector3(-Math.PI/2, 0, 0),
            new Vector3(0, 0, Math.PI/2),
            new Vector3(0, 0, -Math.PI/2),
        ]
    });
    self.world.add([queen, die]);

    /*for (let i = 0; i < 5; i++) {
        let birdHeight = 4.3;
        let bird = new Pawn({
            name: "Bird Statue",
            position: new Vector3(-1.9,2.8,-1.35),
            rotation: new Vector3(0, Math.PI/6, 0),
            mesh: 'generic/bird.gltf'
        });
        self.world.add(bird);

        await timeout(500);
    }
    while (true) {
        // for (let pawn of self.world.pawns().values()) {
        //     if (pawn.name == "Bird Statue") {
        //         pawn.position.y += Math.random() * 2.0;
        //     }
        // }
        //self.world.commit(self.world.pawns().values().filter(p => p.name == "Bird Statue").map(p => p.id));
        self.world.commit();
        await timeout(500);
    }*/

    self.world.close();
});
