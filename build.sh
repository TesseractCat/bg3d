bash version.sh
git pull
sudo pkill BG3D
npm run build
cargo build --release
sudo ./target/release/BG3D 443 > log.txt &
