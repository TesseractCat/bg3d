function getCards() {
    let suits = ['S','D','C','H'];
    let ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
    return suits.flatMap((suit) => ranks.map((rank) => `generic/cards/${rank}${suit}.webp`));
}

self.world.addEventListener("start", async () => {
    let deck = new Deck({
        name: 'Cards',
        back: 'generic/cards/back.webp',
        contents: getCards(), cornerRadius: 0.06,
        position: new Vector3(0, 1, 0),
        size: new Vector2(2.5, 3.5),
    });

    let chipColors = [
        ['Red', 0xff0000, 10],
        ['Blue', 0x071466, 10],
        ['Green', 0x5D8B0E, 5],
        ['Black', 0x111111, 2]
    ];
    for (let [i, [colorName, colorHex, amount]] of chipColors.entries()) {
        let chips = new Deck({
            name: `${colorName} Chips`,
            contents: Array(amount).fill(`poker/${colorName.toLowerCase()}_chip.jpg`),
            border: 'generic/circle.svg', sideColor: colorHex,
            position: new Vector3(-3, 4, (i * 2) - 3),
            size: new Vector2(1.57, 1.57), cardThickness: 0.08,
        });
        self.world.add(chips);
    }

    let die = new Dice({
        name: 'Die',
        position: new Vector3(3,1,0),
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
    self.world.add([deck, die]);

    self.world.close();
});
