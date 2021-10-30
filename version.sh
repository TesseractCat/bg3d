hash=$(git describe --always)
sed "s/{{version}}/$hash/g" templates/index.html > static/index.html
