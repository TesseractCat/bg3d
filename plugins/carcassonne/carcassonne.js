function getCards() {
    let cards = [
        'citybend2.webp',
        'citydiagonal3.webp',
        'cityends3.webp',
        'citygrass3.webp',
        'cityinterior1.webp',
        'cityintersection3.webp',
        'cityoutcrop5.webp',
        'citypath1.webp',
        'cityroad1.webp',
        'cityturn3.webp',
        'cityturnleft3.webp',
        'cityturnright3.webp',
        'intersection1.webp',
        'intersection4.webp',
        'monastery2.webp',
        'monastery4.webp',
        'road8.webp',
        'start3.webp',
        'turn9.webp',
        'shielded/citydiagonal2.webp',
        'shielded/citygrass1.webp',
        'shielded/cityinterior1.webp',
        'shielded/citypath2.webp',
        'shielded/cityroad2.webp',
        'shielded/cityturn2.webp',
    ].map(c => 'cards/' + c);
    return cards.flatMap(card => {
        let repeatCount = parseInt(card.replace(/[^\d]/g, ''));
        return Array(repeatCount).fill(card);
    });
}

self.world.addEventListener("start", () => {
    let cardSize = 1.8;

    let deck = new Deck({
        name: "Landscape Tiles",
        back: "back.webp",
        contents: getCards(), cornerRadius: 0.06,
        position: new Vector3(0, 1, 0),
        rotation: new Vector3(Math.PI, 0, 0),
        size: new Vector2(cardSize, cardSize),
    });
    deck.shuffle();

    let startDeck = new Deck({
        name: "Landscape Tiles",
        back: "back.webp",
        contents: ["cards/start3.webp"], cornerRadius: 0.06,
        position: new Vector3(0, 1, cardSize * 4 * 1.05),
        size: new Vector2(cardSize, cardSize),
    });

    let scoreboard = new Deck({
        name: "Scoreboard",
        contents: ['scoreboard.webp'],
        position: new Vector3(0, 0.01/2, -6),
        size: new Vector2(7 * 1.48, 7),
        moveable:false,
    });

    // Snap positions
    let snap = new SnapPoint({
        position: new Vector3(0,0,0),
        size: new Vector2(99,99),
        radius: cardSize * 1.05,
        scale: cardSize * 1.05,
        snaps: ["Landscape Tiles"],
    });

    self.world.add([deck, startDeck, scoreboard, snap]);

    let meepleInfo = [
        ['Blue',   0x2222dd, new Vector3(-5, 1, 0)],
        ['Yellow', 0xffff11, new Vector3(-5 - 4, 1, 0)],
        ['Green',  0x22dd22, new Vector3(-5 - 8, 1, 0)],
        ['Red',    0xdd2222, new Vector3(-5 - 4, 1, -4)],
        ['Black',  0x222222, new Vector3(-5 - 8, 1, -4)],
    ];
    self.world.add(
        meepleInfo.map(([colorName, color, position]) => {
            let meeple = new Pawn({
                name: colorName + " Meeple",
                tint: color,
                mesh: 'generic/meeple.gltf'
            });
            let meepleBag = new Container({
                name: colorName + " Meeple",
                holds: meeple, capacity: 8,
                position: position,
                mesh: 'generic/bag.gltf'
            })
            return meepleBag;
        })
    );

    self.world.close();
});
