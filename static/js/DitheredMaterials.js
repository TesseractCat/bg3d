import { MeshStandardMaterial, ShaderMaterial, ShaderLib, RGBADepthPacking } from 'three';

// https://gkjohnson.github.io/threejs-sandbox/screendoor-transparency/src/ScreenDoorShader.js
function ditherMixin(shader) {
    let ditherCode = `
    // adapted from https://www.shadertoy.com/view/Mlt3z8
    float bayerDither2x2( vec2 v ) {
        return mod( 3.0 * v.y + 2.0 * v.x, 4.0 );
    }
    float bayerDither4x4( vec2 v ) {
        vec2 P1 = mod( v, 2.0 );
        vec2 P2 = mod( floor( 0.5  * v ), 2.0 );
        return 4.0 * bayerDither2x2( P1 ) + bayerDither2x2( P2 );
    }
    `;
    shader.fragmentShader = `
        ${ditherCode}
        ${shader.fragmentShader}
    `.replace(
        /main\(\) {/,
        v => `
            ${v}
            if( (bayerDither4x4(floor(mod(gl_FragCoord.xy, 4.0))))/16.0 >= opacity ) discard;
        `
    );
}

export class MeshStandardDitheredMaterial extends MeshStandardMaterial {
    constructor(params) {
        super(params);
        this.onBeforeCompile = (shader) => {
            ditherMixin(shader);
        };
    }
}
export class DepthDitheredMaterial extends ShaderMaterial {
    constructor() {
        super(ShaderLib.depth);
        this.defines.DEPTH_PACKING = RGBADepthPacking;
        ditherMixin(this);
        this.fragmentShader = `uniform float opacity;\n${this.fragmentShader}`;
    }

    get opacity() {
        if (this.uniforms && this.uniforms.opacity !== undefined) {
            return this.uniforms.opacity.value;
        } else {
            return 1;
        }
    }
    set opacity(x) {
        if (this.uniforms && this.uniforms.opacity !== undefined)
            this.uniforms.opacity.value = x;
    }
}
