import { Object3D } from 'three';

export class XRHandMeshModel {
    controller: Object3D;
    handModel: Object3D;
    bones: Object3D[];

    constructor(handModel: Object3D, controller: Object3D, path: string, handedness: string);

    updateMesh(): void;
}
