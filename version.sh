hash=$(git describe --always)
sed "s/{{version}}/$hash/g" templates/index.html > static/index.html
sed "s/{{version}}/$hash/g" templates/index.css > static/index.css
sed "s/{{version}}/$hash/g" templates/frontpage.html > static/frontpage/index.html
sed "s/{{version}}/$hash/g" templates/frontpage.css > static/frontpage/index.css
