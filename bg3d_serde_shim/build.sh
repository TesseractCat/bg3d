cargo build --release --target wasm32-unknown-unknown
wasm-bindgen --out-dir out target/wasm32-unknown-unknown/release/bg3d_serde_shim.wasm