define("index", ["require", "exports", "three", "../deps/libs/stats.module", "../deps/postprocessing/EffectComposer", "../deps/postprocessing/RenderPass", "../deps/postprocessing/ShaderPass", "../deps/postprocessing/SAOPass", "../deps/shaders/PixelShader", "../deps/controls/OrbitControls", "../deps/loaders/GLTFLoader"], function (require, exports, THREE, stats_module_1, EffectComposer_1, RenderPass_1, ShaderPass_1, SAOPass_1, PixelShader_1, OrbitControls_1, GLTFLoader_1) {
    "use strict";
    exports.__esModule = true;
    // SCENE
    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdddddd);
    // RENDERING
    var camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    var renderer = new THREE.WebGLRenderer();
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.autoUpdate = true;
    renderer.shadowMap.type = THREE.BasicShadowMap;
    var controls = new OrbitControls_1.OrbitControls(camera, renderer.domElement);
    controls.screenSpacePanning = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.15;
    // POST PROCESSING
    var composer = new EffectComposer_1.EffectComposer(renderer);
    var renderPass = new RenderPass_1.RenderPass(scene, camera);
    composer.addPass(renderPass);
    var saoPass = new SAOPass_1.SAOPass(scene, camera, false, true);
    saoPass.params.saoIntensity = 0.001;
    composer.addPass(saoPass);
    var pixelPass = new ShaderPass_1.ShaderPass(PixelShader_1.PixelShader);
    pixelPass.uniforms["resolution"].value = new THREE.Vector2(window.innerWidth, window.innerHeight);
    pixelPass.uniforms["resolution"].value.multiplyScalar(window.devicePixelRatio);
    pixelPass.uniforms["pixelSize"].value = 3;
    //composer.addPass(pixelPass);
    var stats = (0, stats_module_1["default"])();
    // LIGHTING
    var directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.castShadow = true;
    directionalLight.position.y = 25;
    directionalLight.position.x = 10;
    directionalLight.shadow.camera.left = -50;
    directionalLight.shadow.camera.right = 50;
    directionalLight.shadow.camera.bottom = -50;
    directionalLight.shadow.camera.top = 50;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    scene.add(directionalLight);
    var ambientLight = new THREE.AmbientLight(0x404040, 1.5);
    scene.add(ambientLight);
    //const helper = new THREE.CameraHelper( directionalLight.shadow.camera );
    //scene.add(helper);
    // TABLE
    var plane = new THREE.PlaneGeometry(100, 100);
    plane.rotateX(-Math.PI / 2);
    var material = new THREE.ShadowMaterial();
    material.opacity = 0.3;
    var table = new THREE.Mesh(plane, material);
    table.position.y = 0;
    table.receiveShadow = true;
    scene.add(table);
    // CUBE
    var cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    cube.position.y = 2;
    cube.position.x = 1.25;
    cube.castShadow = true;
    scene.add(cube);
    camera.position.z = 5;
    // MODELS
    var loader = new GLTFLoader_1.GLTFLoader();
    loader.load('models/chess.gltf', function (gltf) {
        gltf.scene.traverse(function (e) {
            e.castShadow = true;
            e.receiveShadow = true;
        });
        scene.add(gltf.scene);
    });
    // SETUP
    window.onload = function () {
        renderer.setSize(window.innerWidth, window.innerHeight);
        composer.setSize(window.innerWidth, window.innerHeight);
        document.body.appendChild(renderer.domElement);
        document.body.appendChild(stats.dom);
    };
    window.onresize = function () {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        composer.setSize(window.innerWidth, window.innerHeight);
        pixelPass.uniforms["resolution"].value.set(window.innerWidth, window.innerHeight).multiplyScalar(window.devicePixelRatio);
    };
    function animate() {
        requestAnimationFrame(animate);
        //renderer.render(scene, camera);
        composer.render();
        controls.update();
        stats.update();
    }
    animate();
});
