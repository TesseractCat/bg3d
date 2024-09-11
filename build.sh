git pull
bash version.sh
pkill BG3D
npm install
npm run build
cargo build --release
./target/release/BG3D https://birdga.me:9095 > log.txt &
