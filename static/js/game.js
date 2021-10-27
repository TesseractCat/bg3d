import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import Manager from './manager';
import { Pawn, Dice, Deck, Container  } from './pawns';

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
            let deck = new Deck({
                manager: this.manager, name: "welcome", contents: ["generic/welcome.png"],
                position: new THREE.Vector3(0.9, 0, 0),// new THREE.Quaternion()/*.setFromEuler(new THREE.Euler(0, -Math.PI/12, 0))*/,
                size: new THREE.Vector2(1.25 * 8, 1 * 8),
                moveable: false
            });
            this.manager.addPawn(deck);
            
            let birdHeight = 4.1;
            let bird = new Pawn({
                manager: this.manager,
                position: new THREE.Vector3(-1.9,2.8,-1.35),
                rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI/6, 0)),
                mesh: 'generic/bird.gltf', physicsBody: new CANNON.Body({
                    mass: 5,
                    shape: new CANNON.Cylinder(1.5, 1.5, birdHeight, 8)
                })
            });
            bird.meshOffset = new THREE.Vector3(0,-0.5 * birdHeight,0);
            this.manager.addPawn(bird);
        });
    }
}

export class Checkers extends Game {
    name = "Checkers";
    
    init(clear) {
        super.init(clear, () => {
            let board = new Pawn({
                manager: this.manager,
                position: new THREE.Vector3(0,0.5,0),
                mesh: 'checkers/checkerboard.gltf',
                physicsBody: new CANNON.Body({
                    mass: 0,
                    shape: new CANNON.Box(new CANNON.Vec3(8.0,0.5,8.0))
                }),
                moveable: false
            });
            this.manager.addPawn(board);
            
            let checkerRed = new Pawn({
                manager: this.manager,
                mesh: 'checkers/checker_red.gltf',
                physicsBody: new CANNON.Body({
                    mass: 5,
                    shape: new CANNON.Cylinder(1.1, 1.1, 0.48, 6)//new CANNON.Vec3(1.0,0.2,1.0))
                })
            });
            let checkerBlack = new Pawn({
                manager: this.manager,
                mesh: 'checkers/checker_black.gltf',
                physicsBody: new CANNON.Body({
                    mass: 5,
                    shape: new CANNON.Cylinder(1.1, 1.1, 0.48, 6)//new CANNON.Vec3(1.0,0.2,1.0))
                })
            });
            for (let x = 0; x < 8; x++) {
                for (let y = 0; y < 8; y++) {
                    if ((x + y) % 2 != 0 || y == 4 || y == 3)
                        continue;
                    let checker = y < 4 ? checkerRed.clone() : checkerBlack.clone();
                    checker.setPosition(new THREE.Vector3(-7 + x * 2,1.5,-7 + y * 2));
                    this.manager.addPawn(checker);
                }
            }
            
            let checkerRedBag = new Container({
                manager: this.manager, holds: checkerRed.serialize(),
                position: new THREE.Vector3(-11, 2.5, -3),
                mesh: 'generic/bag.gltf', physicsBody: new CANNON.Body({
                    mass: 5,
                    shape: new CANNON.Cylinder(1.5, 1.5, 2.5, 8)
                })
            });
            checkerRedBag.meshOffset = new THREE.Vector3(0,-0.5 * 2.5,0);
            let checkerBlackBag = new Container({
                manager: this.manager, holds: checkerBlack.serialize(),
                position: new THREE.Vector3(-11, 2.5, 3),
                mesh: 'generic/bag.gltf', physicsBody: new CANNON.Body({
                    mass: 5,
                    shape: new CANNON.Cylinder(1.5, 1.5, 2.5, 8)
                })
            });
            checkerBlackBag.meshOffset = new THREE.Vector3(0,-0.5 * 2.5,0);
            this.manager.addPawn(checkerRedBag);
            this.manager.addPawn(checkerBlackBag);
        });
    }
}

export class Cards extends Game {
    name = "Cards";
    
    init(clear) {
        super.init(clear, () => {
            let ranks = "A,2,3,4,5,6,7,8,9,10,J,Q,K".split(",");
            let suits = "C,S,D,H".split(",");
            let cards = [];
            for (let rank of ranks) {
                for (let suit of suits) {
                    cards.push("generic/cards/" + rank + suit + ".jpg");
                }
            }
            let deckTemplate = new Deck({
                manager: this.manager,
                name: "standard_deck", contents: cards, back: "generic/cards/Red_back.jpg",
                position: new THREE.Vector3(0, 3, 0), size: new THREE.Vector2(2.5 * 1.0, 3.5 * 1.0)
            });
            for (var i = 0; i < 3; i++) {
                let deck = deckTemplate.clone();
                deck.data.name = i.toString();
                deck.setPosition(new THREE.Vector3(i * 3.5 - (3 * 3.5)/2, 3, 0));
                this.manager.addPawn(deck);
            }
        });
    }
}

export class Monopoly extends Game {
    name = "Monopoly";
    
    init(clear) {
        super.init(clear, () => {
            let board = new Pawn({
                manager: this.manager,
                mesh: 'monopoly/board.gltf',
                physicsBody: new CANNON.Body({
                    mass: 0,
                    shape: new CANNON.Box(new CANNON.Vec3(10.0,0.2,10.0))
                }),
                moveable: false
            });
            this.manager.addPawn(board);
            
            let playerPositions = [
                new THREE.Vector3(0,0,-13),
                new THREE.Vector3(0,0,13),
                new THREE.Vector3(13,0,0),
                new THREE.Vector3(-15.5,0,0),
            ];

            for (let pos of playerPositions) {
                let ones = new Deck({
                    manager: this.manager, name: "1",
                    contents: Array(5).fill("monopoly/1.jpg"),
                    position: pos.clone().add(new THREE.Vector3(0, 2, 0)), size: new THREE.Vector2(5, 2.8)
                });
                this.manager.addPawn(ones);
                
                let fives = new Deck({
                    manager: this.manager, name: "5",
                    contents: Array(5).fill("monopoly/5.jpg"),
                    position: pos.clone().add(new THREE.Vector3(0.5, 4, 0)), size: new THREE.Vector2(5, 2.8)
                });
                this.manager.addPawn(fives);
                
                let tens = new Deck({
                    manager: this.manager, name: "10",
                    contents: Array(5).fill("monopoly/10.jpg"),
                    position: pos.clone().add(new THREE.Vector3(1.0, 6, 0)), size: new THREE.Vector2(5, 2.8)
                });
                this.manager.addPawn(tens);
                
                let fifties = new Deck({
                    manager: this.manager, name: "50",
                    contents: Array(2).fill("monopoly/50.jpg"),
                    position: pos.clone().add(new THREE.Vector3(1.5, 8, 0)), size: new THREE.Vector2(5, 2.8)
                });
                this.manager.addPawn(fifties);
                
                let hundreds = new Deck({
                    manager: this.manager, name: "100",
                    contents: Array(2).fill("monopoly/100.jpg"),
                    position: pos.clone().add(new THREE.Vector3(2.0, 10, 0)), size: new THREE.Vector2(5, 2.8)
                });
                this.manager.addPawn(hundreds);
                
                let fiveHundreds = new Deck({
                    manager: this.manager, name: "500",
                    contents: Array(2).fill("monopoly/500.jpg"),
                    position: pos.clone().add(new THREE.Vector3(2.5, 12, 0)), size: new THREE.Vector2(5, 2.8)
                });
                this.manager.addPawn(fiveHundreds);
            }
            
            let chance = new Deck({
                manager: this.manager, name: "chance",
                contents: [...Array(16).keys()].map(i => "monopoly/chance/" + i + ".jpg"),
                position: new THREE.Vector3(4.5, 3, 4.5), rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI/4, 0)),
                size: new THREE.Vector2(5/1.5, 2.8/1.5)
            });
            this.manager.addPawn(chance);
            let chest = new Deck({
                manager: this.manager, name: "chest",
                contents: [...Array(16).keys()].map(i => "monopoly/chest/" + i + ".jpg"),
                position: new THREE.Vector3(-4.5, 3, -4.5), rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI/4 + Math.PI, 0)),
                size: new THREE.Vector2(5/1.5, 2.8/1.5)
            });
            this.manager.addPawn(chest);
            
            for (let i = 0; i < 28; i++) {
                let property = new Deck({
                    manager: this.manager, name: "properties", contents: ["monopoly/properties/" + i + ".jpg"],
                    position: new THREE.Vector3(((i%6) - 2.5) * 5, 1, 20 + Math.floor(i/6) * 5),
                    size: new THREE.Vector2(1 * 3.5, 1.16*3.5)
                });
                this.manager.addPawn(property);
            }
            
            let die = new Dice({
                manager: this.manager, rollRotations: [
                    {x:0, y:0, z:0},
                    {x:Math.PI/2, y:0, z:0},
                    {x:Math.PI, y:0, z:0},
                    {x:-Math.PI/2, y:0, z:0},
                    {x:0, y:0, z:Math.PI/2},
                    {x:0, y:0, z:-Math.PI/2},
                ],
                mesh: 'generic/die.gltf', physicsBody: new CANNON.Body({
                    mass: 5,
                    shape: new CANNON.Box(new CANNON.Vec3(1/3,1/3,1/3))
                })
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
