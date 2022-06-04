import * as THREE from 'three';

import Manager from './manager';
import { Pawn, Dice, Deck, Container  } from './pawns';
import { Box, Cylinder } from './shapes.js';

export class Game {
    name = "";
    manager;
    templates = new Map();
    
    constructor(manager) {
        this.manager = manager;
    }
    init(clear, callback) {
        if (clear) {
            this.manager.sendEvent("clear_pawns", true, {}, () => callback());
        } else {
            callback();
        }
    }
}

export class Welcome extends Game {
    name = "Welcome";
    
    constructor(manager) {
        super(manager);
        
        let birdHeight = 4.3;
        let bird = new Pawn({
            name: "Bird Statue",
            position: new THREE.Vector3(-1.9,2.8,-1.35),
            rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI/6, 0)),
            mesh: 'generic/bird.gltf?v=2', colliderShapes: [
                new Cylinder(1.5, birdHeight)
            ],
        });
        
        this.templates.set(bird.name, bird);
    }
    
    init(clear) {
        super.init(clear, () => {
            let deck = new Deck({
                name: "welcome", contents: ["generic/welcome.png"],
                sideColor: 0x000000, cornerRadius: 0.06,
                position: new THREE.Vector3(0.9, 0, 0),// new THREE.Quaternion()/*.setFromEuler(new THREE.Euler(0, -Math.PI/12, 0))*/,
                size: new THREE.Vector2(1.25 * 8, 1 * 8),
                moveable: false
            });
            this.manager.addPawn(deck);
            
            this.manager.addPawn(this.templates.get("Bird Statue").clone());
        });
    }
}

export class Checkers extends Game {
    name = "Checkers";
    
    constructor(manager) {
        super(manager);
        
        let checkerRed = new Pawn({
            name: "Red Checker",
            mesh: 'checkers/checker_red.gltf?v=2',
            colliderShapes: [
                new Cylinder(0.8, 0.35)
            ]
        });
        let checkerBlack = new Pawn({
            name: "Black Checker",
            mesh: 'checkers/checker_black.gltf?v=2',
            colliderShapes: [
                new Cylinder(0.8, 0.35)
            ]
        });
        this.templates.set(checkerRed.name, checkerRed);
        this.templates.set(checkerBlack.name, checkerBlack);
    }
    
    init(clear) {
        super.init(clear, () => {
            let board = new Pawn({
                position: new THREE.Vector3(0,0.5,0),
                mesh: 'checkers/checkerboard.gltf',
                colliderShapes: [
                    new Box(new THREE.Vector3(8.0,0.5,8.0))
                ],
                moveable: false
            });
            this.manager.addPawn(board);
            
            for (let x = 0; x < 8; x++) {
                for (let y = 0; y < 8; y++) {
                    if ((x + y) % 2 != 0 || y == 4 || y == 3)
                        continue;
                    let checker = y < 4 ?
                        this.templates.get("Red Checker").clone() : this.templates.get("Black Checker").clone();
                    checker.setPosition(new THREE.Vector3(-7 + x * 2,1.5,-7 + y * 2));
                    this.manager.addPawn(checker);
                }
            }
            
            let checkerRedBag = new Container({
                holds: this.templates.get("Red Checker").serialize(),
                name: "Red Checkers",
                position: new THREE.Vector3(-11, 2.5, -3),
                mesh: 'generic/bag.gltf?v=2', colliderShapes: [
                    new Cylinder(1.5, 2.5)
                ],
            });
            let checkerBlackBag = new Container({
                holds: this.templates.get("Black Checker").serialize(),
                name: "Black Checkers",
                position: new THREE.Vector3(-11, 2.5, 3),
                mesh: 'generic/bag.gltf?v=2', colliderShapes: [
                    new Cylinder(1.5, 2.5)
                ],
            });
            this.manager.addPawn(checkerRedBag);
            this.manager.addPawn(checkerBlackBag);
        });
    }
}

export class Chess extends Game {
    name = "Chess";
    
    constructor(manager) {
        super(manager);
    }
    
    init(clear) {
        super.init(clear, () => {
            let board = new Pawn({
                position: new THREE.Vector3(0,0.5,0),
                mesh: 'checkers/checkerboard.gltf',
                colliderShapes: [
                    new Box(new THREE.Vector3(8.0,0.5,8.0))
                ],
                moveable: false
            });
            this.manager.addPawn(board);
            
            let queen = this.getPiece('queen', 0.7, 2.81);
            let king = this.getPiece('king', 0.7, 3.18);
            let rook = this.getPiece('rook', 0.625, 1.9);
            let knight = this.getPiece('knight', 0.625, 2.09);
            let bishop = this.getPiece('bishop', 0.625, 2.67);
            let pawn = this.getPiece('pawn', 0.625, 1.78);
            
            // SPAWN
            let rookPositions = [
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(7, 0, 0),
            ];
            this.addPiece(rook, rookPositions);
            let knightPositions = [
                new THREE.Vector3(1, 0, 0),
                new THREE.Vector3(6, 0, 0),
            ];
            this.addPiece(knight, knightPositions);
            let bishopPositions = [
                new THREE.Vector3(2, 0, 0),
                new THREE.Vector3(5, 0, 0),
            ];
            this.addPiece(bishop, bishopPositions);
            let queenPositions = [
                new THREE.Vector3(3, 0, 0),
            ];
            this.addPiece(queen, queenPositions);
            let kingPositions = [
                new THREE.Vector3(4, 0, 0),
            ];
            this.addPiece(king, kingPositions);
            
            let pawnPositions = [
                new THREE.Vector3(1, 0, 1),
                new THREE.Vector3(0, 0, 1),
                new THREE.Vector3(2, 0, 1),
                new THREE.Vector3(3, 0, 1),
                new THREE.Vector3(4, 0, 1),
                new THREE.Vector3(5, 0, 1),
                new THREE.Vector3(6, 0, 1),
                new THREE.Vector3(7, 0, 1),
            ];
            this.addPiece(pawn, pawnPositions);
        });
    }
    
    getPiece(name, radius, height) {
        let white = new Pawn({
            name: name,
            mesh: 'chess/' + name + '_white.gltf?v=2',
            colliderShapes: [
                new Cylinder(radius, height)
            ]
        });
        let black = new Pawn({
            name: name,
            mesh: 'chess/' + name + '_black.gltf?v=2',
            colliderShapes: [
                new Cylinder(radius, height)
            ]
        });
        return [white, black];
    }
    addPiece(piece, positions) {
        positions.forEach((p) => {
            let temp;
            temp = piece[1].clone();
            temp.setPosition(new THREE.Vector3(-7 + p.x * 2, 3, -7 + p.z * 2));
            this.manager.addPawn(temp);
            temp = piece[0].clone();
            temp.setPosition(new THREE.Vector3(-7 + p.x * 2, 3, -7 + (7 - p.z) * 2));
            temp.setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0)));
            temp.selectRotation.y = Math.PI;
            this.manager.addPawn(temp);
        });
    }
}

export class Cards extends Game {
    name = "Cards";
    
    constructor(manager) {
        super(manager);
        
        let ranks = "A,2,3,4,5,6,7,8,9,10,J,Q,K".split(",");
        let suits = "C,S,D,H".split(",");
        let cards = [];
        for (let rank of ranks) {
            for (let suit of suits) {
                cards.push("generic/cards/" + rank + suit + ".jpg");
            }
        }
        let deckTemplate = new Deck({
            name: "Standard Deck",
            contents: cards, back: "generic/cards/Red_back.jpg",
            cornerRadius: 0.08, sideColor: 0xffffff,
            size: new THREE.Vector2(2.5 * 1.0, 3.5 * 1.0)
        });
        this.templates.set(deckTemplate.name, deckTemplate);
    }
    
    init(clear) {
        super.init(clear, () => {
            let deck = this.templates.get("Standard Deck").clone();
            deck.name = "Standard Deck";
            deck.setPosition(new THREE.Vector3(0, 2, 0));
            this.manager.addPawn(deck);
            
            /*let pokerChips = new Deck({
                name: "Poker Chip",
                contents: Array(10).fill("poker/chip.jpg"),
                cornerRadius: 0.52, sideColor: 0x12225a,
                size: new THREE.Vector2(1.5, 1.5),
                position: new THREE.Vector3(3, 1, 0)
            });
            this.manager.addPawn(pokerChips);*/
        });
    }
}

export class Monopoly extends Game {
    name = "Monopoly";
    
    init(clear) {
        super.init(clear, () => {
            let board = new Pawn({
                position: new THREE.Vector3(0, 0.1, 0),
                mesh: 'monopoly/board.gltf',
                colliderShapes: [
                    new Box(new THREE.Vector3(10.0,0.1,10.0))
                ],
                moveable: false
            });
            this.manager.addPawn(board);
            
            let playerPositions = [
                new THREE.Vector3(0,0,-13),
                new THREE.Vector3(0,0,13),
                new THREE.Vector3(13,0,0),
                new THREE.Vector3(-15.5,0,0),
            ];

            let ones = new Deck({
                name: "1",
                contents: Array(5).fill("monopoly/1.jpg"), size: new THREE.Vector2(5, 2.8)
            });
            let fives = new Deck({
                name: "5",
                contents: Array(5).fill("monopoly/5.jpg"), size: new THREE.Vector2(5, 2.8)
            });
            let tens = new Deck({
                name: "10",
                contents: Array(5).fill("monopoly/10.jpg"), size: new THREE.Vector2(5, 2.8)
            });
            let fifties = new Deck({
                name: "50",
                contents: Array(2).fill("monopoly/50.jpg"), size: new THREE.Vector2(5, 2.8)
            });
            let hundreds = new Deck({
                name: "100",
                contents: Array(2).fill("monopoly/100.jpg"), size: new THREE.Vector2(5, 2.8)
            });
            let fiveHundreds = new Deck({
                name: "500",
                contents: Array(2).fill("monopoly/500.jpg"), size: new THREE.Vector2(5, 2.8)
            });
            for (let pos of playerPositions) {
                this.manager.addPawn(ones.clone().setPosition(pos.clone().add(new THREE.Vector3(0, 2, 0))));
                this.manager.addPawn(fives.clone().setPosition(pos.clone().add(new THREE.Vector3(0.5, 4, 0))));
                this.manager.addPawn(tens.clone().setPosition(pos.clone().add(new THREE.Vector3(1.0, 6, 0))));
                this.manager.addPawn(fifties.clone().setPosition(pos.clone().add(new THREE.Vector3(1.5, 8, 0))));
                this.manager.addPawn(hundreds.clone().setPosition(pos.clone().add(new THREE.Vector3(2.0, 10, 0))));
                this.manager.addPawn(fiveHundreds.clone().setPosition(pos.clone().add(new THREE.Vector3(2.5, 12, 0))));
            }
            
            let bagX = -(9 + 6)/2;
            let onesBag = new Container({
                holds: ones.serialize(), name: "5 x 1s",
                position: new THREE.Vector3(bagX, 5, -21.5),
                mesh: 'generic/bag.gltf?v=2', colliderShapes: [
                    new Cylinder(1.5, 2.5)
                ],
            });
            bagX += 3;
            let fivesBag = new Container({
                holds: fives.serialize(), name: "5 x 5s",
                position: new THREE.Vector3(bagX, 5, -21.5),
                mesh: 'generic/bag.gltf?v=2', colliderShapes: [
                    new Cylinder(1.5, 2.5)
                ],
            });
            bagX += 3;
            let tensBag = new Container({
                holds: tens.serialize(), name: "5 x 10s",
                position: new THREE.Vector3(bagX, 5, -21.5),
                mesh: 'generic/bag.gltf?v=2', colliderShapes: [
                    new Cylinder(1.5, 2.5)
                ],
            });
            bagX += 3;
            let fiftiesBag = new Container({
                holds: fifties.serialize(), name: "2 x 50s",
                position: new THREE.Vector3(bagX, 5, -21.5),
                mesh: 'generic/bag.gltf?v=2', colliderShapes: [
                    new Cylinder(1.5, 2.5)
                ],
            });
            bagX += 3;
            let hundredsBag = new Container({
                holds: hundreds.serialize(), name: "2 x 100s",
                position: new THREE.Vector3(bagX, 5, -21.5),
                mesh: 'generic/bag.gltf?v=2', colliderShapes: [
                    new Cylinder(1.5, 2.5)
                ],
            });
            bagX += 3;
            let fiveHundredsBag = new Container({
                holds: fiveHundreds.serialize(), name: "2 x 500s",
                position: new THREE.Vector3(bagX, 5, -21.5),
                mesh: 'generic/bag.gltf?v=2', colliderShapes: [
                    new Cylinder(1.5, 2.5)
                ],
            });
            
            this.manager.addPawn(onesBag);
            this.manager.addPawn(fivesBag);
            this.manager.addPawn(tensBag);
            this.manager.addPawn(fiftiesBag);
            this.manager.addPawn(hundredsBag);
            this.manager.addPawn(fiveHundredsBag);
            
            let chance = new Deck({
                name: "chance",
                contents: [...Array(16).keys()].map(i => "monopoly/chance/" + i + ".jpg"),
                position: new THREE.Vector3(4.5, 3, 4.5), rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI/4, 0)),
                size: new THREE.Vector2(5/1.5, 2.8/1.5)
            });
            this.manager.addPawn(chance);
            let chest = new Deck({
                name: "chest",
                contents: [...Array(16).keys()].map(i => "monopoly/chest/" + i + ".jpg"),
                position: new THREE.Vector3(-4.5, 3, -4.5), rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI/4 + Math.PI, 0)),
                size: new THREE.Vector2(5/1.5, 2.8/1.5)
            });
            this.manager.addPawn(chest);
            
            for (let i = 0; i < 28; i++) {
                let property = new Deck({
                    name: "properties", contents: ["monopoly/properties/" + i + ".jpg"],
                    position: new THREE.Vector3(((i%6) - 2.5) * 5, 1, 20 + Math.floor(i/6) * 5),
                    size: new THREE.Vector2(1 * 3.5, 1.16*3.5)
                });
                this.manager.addPawn(property);
            }
            
            let die = new Dice({
                rollRotations: [
                    {x:0, y:0, z:0},
                    {x:Math.PI/2, y:0, z:0},
                    {x:Math.PI, y:0, z:0},
                    {x:-Math.PI/2, y:0, z:0},
                    {x:0, y:0, z:Math.PI/2},
                    {x:0, y:0, z:-Math.PI/2},
                ],
                mesh: 'generic/die.gltf', colliderShapes: [
                    new Box(new THREE.Vector3(1/3,1/3,1/3))
                ]
            });
            let leftDie = die.clone();
            leftDie.setPosition(new THREE.Vector3(-1.0, 1.0, 0.0));
            let rightDie = die.clone();
            rightDie.setPosition(new THREE.Vector3(1.0, 1.0, 0.0));
            this.manager.addPawn(leftDie);
            this.manager.addPawn(rightDie);
        });
    }
}
