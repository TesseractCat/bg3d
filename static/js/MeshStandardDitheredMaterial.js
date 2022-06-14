import { MeshStandardMaterial } from 'three';

export class MeshStandardDitheredMaterial extends MeshStandardMaterial {
    constructor(params) {
        super(params);

        this.onBeforeCompile = (shader) => {
            // https://gkjohnson.github.io/threejs-sandbox/screendoor-transparency/src/ScreenDoorShader.js
            shader.fragmentShader = `
                    // adapted from https://www.shadertoy.com/view/Mlt3z8
                    float bayerDither2x2( vec2 v ) {
                        return mod( 3.0 * v.y + 2.0 * v.x, 4.0 );
                    }

                    float bayerDither4x4( vec2 v ) {
                        vec2 P1 = mod( v, 2.0 );
                        vec2 P2 = mod( floor( 0.5  * v ), 2.0 );
                        return 4.0 * bayerDither2x2( P1 ) + bayerDither2x2( P2 );
                    }

                    uniform sampler2D ditherTex;
                    ${shader.fragmentShader}
            `.replace(
                /main\(\) {/,
                v => `
                    ${v}
                    if( (bayerDither4x4(floor(mod(gl_FragCoord.xy, 4.0))))/16.0 >= opacity ) discard;
                `
            );
        };
    }
}
