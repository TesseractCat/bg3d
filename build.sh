git pull
bash version.sh
pkill BG3D
npm update
npm run build
cargo build --release
./target/release/BG3D 9095 > log.txt &
