git pull
bash version.sh
sudo pkill BG3D
npm run build
cargo build --release
sudo ./target/release/BG3D 9095 > log.txt &
