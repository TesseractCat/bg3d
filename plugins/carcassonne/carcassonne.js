function getCards() {
    let cards = [
        'citybend2.jpg',
        'citydiagonal3.jpg',
        'cityends3.jpg',
        'citygrass3.jpg',
        'cityinterior1.jpg',
        'cityintersection3.jpg',
        'cityoutcrop5.jpg',
        'citypath1.jpg',
        'cityroad1.jpg',
        'cityturn3.jpg',
        'cityturnleft3.jpg',
        'cityturnright3.jpg',
        'intersection1.jpg',
        'intersection4.jpg',
        'monastery2.jpg',
        'monastery4.jpg',
        'road8.jpg',
        'start3.jpg',
        'turn9.jpg',
        'shielded/citydiagonal2.jpg',
        'shielded/citygrass1.jpg',
        'shielded/cityinterior1.jpg',
        'shielded/citypath2.jpg',
        'shielded/cityroad2.jpg',
        'shielded/cityturn2.jpg',
    ].map(c => 'cards/' + c);
    return cards.flatMap(card => {
        let repeatCount = parseInt(card.replace(/[^\d]/g, ''));
        return Array(repeatCount).fill(card);
    });
}

self.start = async function() {
    let cardSize = 1.8;

    let deck = new Deck({
        name: "Landscape Tiles",
        back: "back.jpg",
        contents: getCards(), cornerRadius: 0.06,
        position: new Vector3(0, 1, 0),
        rotation: new Vector3(Math.PI, 0, 0),
        size: new Vector2(cardSize, cardSize),
    });
    deck.shuffle();
    deck.create();

    let startDeck = new Deck({
        name: "Landscape Tiles",
        back: "back.jpg",
        contents: ["cards/start3.jpg"], cornerRadius: 0.06,
        position: new Vector3(0, 1, cardSize * 4 * 1.05),
        size: new Vector2(cardSize, cardSize),
    });
    startDeck.create();

    let scoreboard = new Deck({
        name: "Scoreboard",
        contents: ['scoreboard.jpg'],
        position: new Vector3(0, 0.01/2, -6),
        size: new Vector2(7 * 1.48, 7),
        moveable:false,
    });
    scoreboard.create();

    // Snap positions
    new SnapPoint({
        position: new Vector3(0,0,0),
        size: new Vector2(99,99),
        radius: cardSize * 1.05,
        scale: cardSize * 1.05,
        snaps: ["Landscape Tiles"],
    }).create();

    let meepleInfo = [
        ['Blue',   0x2222dd, new Vector3(-5, 1, 0)],
        ['Yellow', 0xffff11, new Vector3(-5 - 4, 1, 0)],
        ['Green',  0x22dd22, new Vector3(-5 - 8, 1, 0)],
        ['Red',    0xdd2222, new Vector3(-5 - 4, 1, -4)],
        ['Black',  0x222222, new Vector3(-5 - 8, 1, -4)],
    ];
    for (let [colorName, color, position] of meepleInfo) {
        let meeple = new Pawn({
            name: colorName + " Meeple",
            tint: color,
            mesh: 'generic/meeple.gltf', colliderShapes: [
                new Box(new Vector3(0.31, 0.31, 0.2)),
            ],
        });
        let meepleBag = new Container({
            name: colorName + " Meeple",
            holds: meeple, capacity: 8,
            position: position,
            mesh: 'generic/bag.gltf', colliderShapes: [
                new Cylinder(1.5, 2.5)
            ],
        })
        meepleBag.create();
    }
}
