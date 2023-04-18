const zip = (a, b) => a.map((k, i) => [k, b[i]]);
function shuffle(contents) {
    let result = [...contents];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]]
            = [result[j], result[i]];
    }
    return result;
}

function getTiles() {
    let tiles = [...Array(19)].map((_, i) => {
        return new Deck({
            name: 'Island',
            contents: [`tiles/${i}.jpg`],
            position: new Vector3(),
            rotation: new Vector3(0, Math.PI/6, 0),
            size: new Vector2(3.5, 3.0),
            border: 'generic/hex.svg',
            moveable: false,
        });
    });

    let toppers = [];
    for (let i = 2; i <= 12; i++) {
        if (i != 7) {
            let topper = new Deck({
                name: `${i}`,
                back: 'numbers/back.jpg',
                contents: [`numbers/${i}.jpg`],
                size: new Vector2(0.8, 0.8),
                border: 'generic/circle.svg',
                moveable: false,
            });
            toppers.push(topper);
            if (i != 2 && i != 12)
                toppers.push(topper.clone());
        }
    }
    tiles = shuffle(tiles);
    toppers = shuffle(toppers);
    let desertIndex = tiles.findIndex(e => e.contents[0] == 'tiles/3.jpg');
    toppers.splice(desertIndex, 0, new Pawn({
        name: 'Robber',
        tint: 0xfafafa,
        mesh: 'pieces/robber.gltf', colliderShapes: [
            new Cylinder(0.477/2, 0.698),
        ],
    }));
    return zip(tiles, toppers);
}
function hexPosition(grid, size) {
    let [x, y] = [grid.x, grid.y];
    return new Vector2(
        (Math.abs(y) % 2 == 1 ? size.x/2 : 0) + size.x * x,
        size.y * y
    );
}
function* getPositions(size) {
    for (let y = -2; y <= 2; y++) {
        let width = 5 - Math.abs(y);
        for (let x = 0; x < width; x++) {
            yield hexPosition(new Vector2(x - Math.floor(width/2), y), size);
        }
    }
}

function setupHarbors(size) {
    let positions = [
        hexPosition(new Vector2(-2,2), size),
        hexPosition(new Vector2(0,3), size),
        hexPosition(new Vector2(2,1), size),
        hexPosition(new Vector2(2,-2), size),
        hexPosition(new Vector2(-1,-3), size),
        hexPosition(new Vector2(-3,-1), size),
    ];
    for (let i = 0; i < 6; i++) {
        let harbor = new Deck({
            name: 'Harbor',
            contents: [`harbors/${i}.jpg`],
            position: new Vector3(positions[i].x, 0.01/2, positions[i].y),
            rotation: new Vector3(0, Math.PI/6 + i * (Math.PI/3), 0),
            size: new Vector2(3.5, 3.0 * 3),
            border: 'harbors/harbor.svg',
            moveable: false,
        });
        harbor.create();
    }
}

async function setupBoard() {
    let size = new Vector2(3.0, 2.6);
    let tiles = getTiles();
    let positions = [...getPositions(size)];

    for (let [[tile, topper], position] of zip(tiles, positions)) {
        tile.position = position.toVector3({y:0.01/2});
        topper.position = position.toVector3({y:0.01/2 + 0.02});

        tile.create();
        topper.create();
    }
    setupHarbors(size);
}

async function setupPlayers() {
    let playerColors = [
        ['Red', 0xff0000],
        ['Blue', 0x1111ff],
        ['Green', 0x11bb11],
        ['White', 0xdddddd]
    ];
    for (let [i, [colorName, colorHex]] of playerColors.entries()) {
        let rotation = (Math.PI/3 + i * (Math.PI/3) + (i > 1 ? Math.PI/3 : 0)) % (2 * Math.PI);
        let playerPosition = new Vector2(15, 0).rotate(rotation);
        let cardPosition = new Vector2(20, 0).rotate(rotation);

        // Create card
        let costCard = new Deck({
            name: `${colorName} Costs`,
            contents: [`costs/${colorName.toLowerCase()}.jpg`],
            position: cardPosition.toVector3({y: 0.5}),
            rotation: new Vector3(0, i > 1 ? Math.PI : 0, 0),
            size: new Vector2(3.5, 3.5 * 1.26),
        });
        costCard.create();

        // Define pieces
        let settlement = new Pawn({
            name: `${colorName} Settlement`,
            mesh: 'pieces/house.gltf', colliderShapes: [
                new Box(new Vector3(0.39/2, 0.542/2, 0.47/2))
            ], tint: colorHex,
        });
        let city = new Pawn({
            name: `${colorName} City`,
            mesh: 'pieces/city.gltf', colliderShapes: [
                new Box(new Vector3(0.39/2, 0.74/2, 0.74/2))
            ], tint: colorHex,
        });
        let road = new Pawn({
            name: `${colorName} Road`,
            rotation: new Vector3(0,Math.PI/2,0),
            mesh: 'pieces/road.gltf', colliderShapes: [
                new Box(new Vector3(1/2, 0.2/2, 0.2/2))
            ], tint: colorHex,
        });

        // Create bags
        let bag = new Container({
            position: playerPosition.toVector3({y: 1}),
            mesh: 'generic/bag.gltf', colliderShapes: [
                new Cylinder(1.5, 2.5)
            ],
        });
        let cityBag = bag.clone({name: `${colorName} Cities`,
                                 position: bag.position.add(new Vector3(-4, 0, 0)),
                                 holds: city, capacity: 4});
        let settlementBag = bag.clone({name: `${colorName} Settlements`,
                                       position: bag.position.add(new Vector3(0, 0, 0)),
                                       holds: settlement, capacity: 5});
        let roadBag = bag.clone({name: `${colorName} Roads`,
                                 position: bag.position.add(new Vector3(4, 0, 0)),
                                 holds: road, capacity: 15});
        cityBag.create();
        settlementBag.create();
        roadBag.create();
    }
}
async function setupCards() {
    let developmentCards = Array(14).fill('knight');
    developmentCards = developmentCards.concat([...Array(5)].map((_, i) => `victory_${i}`));
    developmentCards = developmentCards.concat([...Array(6)].map((_, i) => `development_${i%3}`));
    let development = new Deck({
        name: "Development",
        back: "development/back.jpg", cornerRadius: 0.06,
        contents: developmentCards.map(card => `development/${card}.jpg`),
        position: new Vector3(15, 1, 0),
        rotation: new Vector3(Math.PI, 0, 0),
        size: new Vector2(2.5, 3.5),
    });
    development.shuffle();
    development.create();

    let longestRoad = new Deck({
        name: "Longest Road",
        contents: ["longestroad.jpg"],
        position: new Vector3(15, 1, 5),
        size: new Vector2(3.2, 4),
    });
    let largestArmy = longestRoad.clone({
        name: "Largest Army", contents: ["largestarmy.jpg"],
        position: new Vector3(15, 1, -5),
    });
    longestRoad.create();
    largestArmy.create();

    let resources = ['Brick', 'Lumber', 'Ore', 'Wool', 'Grain'];
    for (let [i, resource] of resources.entries()) {
        new Deck({
            name: `${resource}`, cornerRadius: 0.06,
            back: 'resources/back.jpg',
            contents: Array(19).fill(`resources/${resource.toLowerCase()}.jpg`),
            position: new Vector3(-15, 1, (i - 2) * 4),
            size: new Vector2(2.5, 3.5),
        }).create();
    }

    // Dice
    let die = new Dice({
        name: 'Die', mesh: 'generic/die.gltf',
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
    die.clone({position: new Vector3(18, 1, 2)}).create();
    die.clone({position: new Vector3(18, 1, -2)}).create();
}

self.start = async function() {
    await setupBoard();
    await setupPlayers();
    await setupCards();
}
