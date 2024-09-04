function boardToWorldPos(chessPos, height)
    height = height or 3
    return vec3(-7 + chessPos.x * 2, height, -7 + chessPos.y * 2)
end

function getPiece(name)
    local white = Pawn:new{
        name = name,
        mesh = "chess/" .. name .. ".gltf"
    }
    local black = Pawn:new{
        name = name,
        mesh = "chess/" .. name .. ".gltf",
        tint = tonumber("0x303030")
    }
    return white, black
end
function addPiece(name, positions)
    local pawns = table.flat_map(positions, function(p)
        local white, black = getPiece(name)

        black:set_position(boardToWorldPos(p))

        white:set_position(boardToWorldPos(vec2(p.x, 7 - p.y)))
        white:set_rotation(quat.from_euler(0, math.pi, 0))

        return {white, black}
    end)
    for _, pawn in ipairs(pawns) do
        lobby:create_pawn(pawn)
    end
end

function game.start()
    -- Spawn board
    lobby:create_pawn{
        name = "Board",
        position = vec3(0,0,0),
        mesh = "checkers/checkerboard.glb",
        moveable = false
    }

    -- Snap positions
    lobby:create_pawn{
        position = vec3(0,1,0),
        data = SnapPointData:new{
            size = vec2(8,8),
            radius = 1,
            scale = 2,
        }
    }

    -- Spawn pieces
    local rookPositions = {
        vec2(0, 0),
        vec2(7, 0),
    }
    addPiece("rook", rookPositions)
    local knightPositions = {
        vec2(1, 0),
        vec2(6, 0),
    }
    addPiece("knight", knightPositions)
    local bishopPositions = {
        vec2(2, 0),
        vec2(5, 0),
    }
    addPiece("bishop", bishopPositions)
    local queenPositions = {
        vec2(3, 0),
    }
    addPiece("queen", queenPositions)
    local kingPositions = {
        vec2(4, 0),
    }
    addPiece("king", kingPositions)

    local pawnPositions = {
        vec2(0, 1),
        vec2(1, 1),
        vec2(2, 1),
        vec2(3, 1),
        vec2(4, 1),
        vec2(5, 1),
        vec2(6, 1),
        vec2(7, 1),
    }
    addPiece("pawn", pawnPositions)
end