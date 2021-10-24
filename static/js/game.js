import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import Manager from './manager';
import { Pawn, Deck, Dice } from './pawns';

export class Game {
    name = "";
    manager;
    
    constructor(manager) {
        this.manager = manager;
    }
    init(clear, callback) {
        if (clear) {
            //this.manager.clear();
            this.manager.sendEvent("clear_pawns", true, {}, () => callback());
        } else {
            callback();
        }
    }
}

export class Welcome extends Game {
    name = "Welcome";
    
    init(clear) {
        super.init(clear, () => {
            let deck = new Deck(this.manager, "welcome",
                new THREE.Vector3(0.9, 0, 0), new THREE.Quaternion()/*.setFromEuler(new THREE.Euler(0, -Math.PI/12, 0))*/,
                new THREE.Vector2(1.25 * 8, 1 * 8), 
                ["generic/welcome.png"]);
            deck.moveable = false;
            this.manager.addPawn(deck);
            
            let birdHeight = 4.1;
            let bird = new Pawn(this.manager,
                new THREE.Vector3(-1.9,2.8,-1.35), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI/6, 0)),
                'generic/bird.gltf',
                new CANNON.Body({
                    mass: 5,
                    shape: new CANNON.Cylinder(1.5, 1.5, birdHeight, 8)
                })
            );
            bird.meshOffset = new THREE.Vector3(0,-0.5 * birdHeight,0);
            this.manager.addPawn(bird);
        });
    }
}

export class Checkers extends Game {
    name = "Checkers";
    
    init(clear) {
        super.init(clear, () => {
            let board = new Pawn(this.manager, new THREE.Vector3(0,0.5,0), new THREE.Quaternion(), 'checkers/checkerboard.gltf',
                new CANNON.Body({
                    mass: 0,
                    //shape: new CANNON.Box(new CANNON.Vec3(8.0,1.0,8.0))
                    shape: new CANNON.Box(new CANNON.Vec3(9.0,0.5,9.0))
                })
            );
            board.moveable = false;
            this.manager.addPawn(board);
            for (let x = 0; x < 8; x++) {
                for (let y = 0; y < 8; y++) {
                    if ((x + y) % 2 != 0 || y == 4 || y == 3)
                        continue;
                    let checker = new Pawn(this.manager,
                        new THREE.Vector3(-7 + x * 2,1.5,-7 + y * 2), new THREE.Quaternion(),
                        y < 4 ? 'checkers/checker_red.gltf' : 'checkers/checker_black.gltf',
                        new CANNON.Body({
                            mass: 5,
                            shape: new CANNON.Cylinder(1.1, 1.1, 0.48, 6)//new CANNON.Vec3(1.0,0.2,1.0))
                        })
                    );
                    this.manager.addPawn(checker);
                }
            }
        });
    }
}

export class Cards extends Game {
    name = "Cards";
    
    init(clear) {
        super.init(clear, () => {
            /*let table = new Pawn(this.manager, new THREE.Vector3(0,0.0,0), new THREE.Quaternion(), 'poker/table.gltf',
                new CANNON.Body({
                    mass: 0,
                    shape: new CANNON.Box(new CANNON.Vec3(40,0.3,35/2))
                })
            );
            table.moveable = false;
            this.manager.addPawn(table);*/
            
            /*let ranks = "A,2,3,4,5,6,7,8,9,10,J,Q,K".split(",");
            let suits = "Clubs,Spades,Diamonds,Hearts".split(",");
            let cards = [];
            for (let rank of ranks) {
                for (let suit of suits) {
                    cards.push("generic/cards_k/card" + suit + rank + ".png");
                }
            }*/
            let ranks = "A,2,3,4,5,6,7,8,9,10,J,Q,K".split(",");
            let suits = "C,S,D,H".split(",");
            let cards = [];
            for (let rank of ranks) {
                for (let suit of suits) {
                    cards.push("generic/cards/" + rank + suit + ".jpg");
                }
            }
            let deck = new Deck(this.manager, "standard_deck",
                new THREE.Vector3(0, 3, 0), new THREE.Quaternion(), new THREE.Vector2(2.5 * 1.0, 3.5 * 1.0),
                cards, "generic/cards/Red_back.jpg");
            this.manager.addPawn(deck);
        });
    }
}

export class Monopoly extends Game {
    name = "Monopoly";
    
    init(clear) {
        super.init(clear, () => {
            let board = new Pawn(this.manager, new THREE.Vector3(0,0.0,0), new THREE.Quaternion(), 'monopoly/board.gltf',
                new CANNON.Body({
                    mass: 0,
                    shape: new CANNON.Box(new CANNON.Vec3(10.0,0.2,10.0))
                })
            );
            board.moveable = false;
            this.manager.addPawn(board);
            
            let playerPositions = [
                new THREE.Vector3(0,0,-13),
                new THREE.Vector3(0,0,13),
                new THREE.Vector3(13,0,0),
                new THREE.Vector3(-15.5,0,0),
            ];

            for (let pos of playerPositions) {
                let ones = new Deck(this.manager, "1",
                    pos.clone().add(new THREE.Vector3(0, 2, 0)), new THREE.Quaternion(), new THREE.Vector2(5, 2.8),
                    Array(5).fill("monopoly/1.jpg"));
                this.manager.addPawn(ones);
                
                let fives = new Deck(this.manager, "5",
                    pos.clone().add(new THREE.Vector3(0.5, 4, 0)), new THREE.Quaternion(), new THREE.Vector2(5, 2.8),
                    Array(5).fill("monopoly/5.jpg"));
                this.manager.addPawn(fives);
                
                let tens = new Deck(this.manager, "10",
                    pos.clone().add(new THREE.Vector3(1.0, 6, 0)), new THREE.Quaternion(), new THREE.Vector2(5, 2.8),
                    Array(5).fill("monopoly/10.jpg"));
                this.manager.addPawn(tens);
                
                let fifties = new Deck(this.manager, "50",
                    pos.clone().add(new THREE.Vector3(1.5, 8, 0)), new THREE.Quaternion(), new THREE.Vector2(5, 2.8),
                    Array(2).fill("monopoly/50.jpg"));
                this.manager.addPawn(fifties);
                
                let hundreds = new Deck(this.manager, "100",
                    pos.clone().add(new THREE.Vector3(2.0, 10, 0)), new THREE.Quaternion(), new THREE.Vector2(5, 2.8),
                    Array(2).fill("monopoly/100.jpg"));
                this.manager.addPawn(hundreds);
                
                let fiveHundreds = new Deck(this.manager, "500",
                    pos.clone().add(new THREE.Vector3(2.5, 12, 0)), new THREE.Quaternion(), new THREE.Vector2(5, 2.8),
                    Array(2).fill("monopoly/500.jpg"));
                this.manager.addPawn(fiveHundreds);
            }
            
            let chance = new Deck(this.manager, "chance",
                new THREE.Vector3(4.5, 3, 4.5), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI/4, 0)), new THREE.Vector2(5/1.5, 2.8/1.5),
                [...Array(16).keys()].map(i => "monopoly/chance/" + i + ".jpg"));
                this.manager.addPawn(chance);
            let chest = new Deck(this.manager, "chest",
                new THREE.Vector3(-4.5, 3, -4.5), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI/4 + Math.PI, 0)), new THREE.Vector2(5/1.5, 2.8/1.5),
                [...Array(16).keys()].map(i => "monopoly/chest/" + i + ".jpg"));
            this.manager.addPawn(chest);
            
            for (let i = 0; i < 28; i++) {
                let property = new Deck(this.manager, "properties",
                    new THREE.Vector3(((i%6) - 2.5) * 5, 1, 20 + Math.floor(i/6) * 5), new THREE.Quaternion(),
                    new THREE.Vector2(1 * 3.5, 1.16*3.5),
                    ["monopoly/properties/" + i + ".jpg"]);
                this.manager.addPawn(property);
            }
            
            let leftDie = new Dice(this.manager, new THREE.Vector3(-1.0,1.0,0), new THREE.Quaternion(), 'generic/die.gltf',
                new CANNON.Body({
                    mass: 5,
                    shape: new CANNON.Box(new CANNON.Vec3(1/3,1/3,1/3))
                }),
                [
                    {x:0, y:0, z:0},
                    {x:Math.PI/2, y:0, z:0},
                    {x:Math.PI, y:0, z:0},
                    {x:-Math.PI/2, y:0, z:0},
                    {x:0, y:0, z:Math.PI/2},
                    {x:0, y:0, z:-Math.PI/2},
                ]
            );
            this.manager.addPawn(leftDie);
            let rightDie = new Dice(this.manager, new THREE.Vector3(1.0,1.0,0), new THREE.Quaternion(), 'generic/die.gltf',
                new CANNON.Body({
                    mass: 5,
                    shape: new CANNON.Box(new CANNON.Vec3(1/3,1/3,1/3))
                }),
                [
                    {x:0, y:0, z:0},
                    {x:Math.PI/2, y:0, z:0},
                    {x:Math.PI, y:0, z:0},
                    {x:-Math.PI/2, y:0, z:0},
                    {x:0, y:0, z:Math.PI/2},
                    {x:0, y:0, z:-Math.PI/2},
                ]
            );
            this.manager.addPawn(rightDie);
        });
    }
}
