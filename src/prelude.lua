-- Global vector math

local vmath = require "math"
vec3 = vmath.vec3
vec2 = vmath.vec2
quat = vmath.quat

-- Pawns

Pawn = {
    __index = function(self, key)
        if key == "id" then
            return rawget(self, id)
        else
            if Pawn[key] ~= nil then
                return Pawn[key] -- Pawn class methods
            else
                return lobby:get_pawn(self.id, key) -- Pawn get fields
            end
        end
    end,
    __newindex = function(self, key, value)
        update = {}
        update[key] = value
        self:update(update)
    end
}
function Pawn:update(table)
    table.id = self.id
    lobby:update_pawn(table)
end
function Pawn:destroy()
    lobby:destroy_pawn(self.id)
end
function Pawn:new(id)
    local o = {id = id}
    setmetatable(o, self)
    return o
end

DeckData = {}
SnapPointData = {}
ContainerData = {}
DiceData = {}
function DeckData:new(options)
    o = {
        back = options.back or nil,
        border = options.border or nil,

        size = options.size or vec2(1, 1),
        side_color = options.side_color or 16777215,
        corner_radius = options.corner_radius or 0,
        card_thickness = options.card_thickness or 0.01,

        contents = options.contents or {},
    }
    setmetatable(o, self)
    return o
end
function SnapPointData:new(options)
    o = {
        radius = options.radius or 1,
        size = options.size or vec2(1, 1),
        scale = options.scale or 1,
        snaps = options.snaps or {}
    }
    setmetatable(o, self)
    return o
end

-- Extension functions

function table.extend(tbl, rhs)
    for i=1,#rhs do
        table.insert(tbl, rhs[i])
    end
end
function table.map(tbl, f)
    local t = {}
    for k,v in pairs(tbl) do
        t[k] = f(v)
    end
    return t
end
function table.flat_map(tbl, f)
    local t = {}
    for k,v in pairs(tbl) do
        table.extend(t, f(v))
    end
    return t
end