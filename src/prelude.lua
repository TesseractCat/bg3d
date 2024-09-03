-- Global vector math

local vmath = require "math"
vec3 = vmath.vec3
vec2 = vmath.vec2
quat = vmath.quat

-- Pawns

Pawn = {
    __index = function(self, key)
        if key == "id" then
            return rawget(self, key)
        end

        if Pawn[key] ~= nil then
            return Pawn[key] -- Pawn class methods
        else
            if key:sub(1, 4) == "get_" then
                local key = key:sub(5, -1)
                return function(self)
                    if self:spawned() then
                        return self:get(key)
                    else
                        return rawget(self, key)
                    end
                end
            elseif key:sub(1,4) == "set_" then
                local key = key:sub(5, -1)
                return function(self, value)
                    if self:spawned() then
                        local update = {}
                        update[key] = value
                        self:update(update)
                    else
                        rawset(self, key, value)
                    end
                end
            end
        end

        return nil
    end,
    __newindex = function(self, key, value)
        error("Pawns cannot be directly modified")
    end
}
function Pawn:spawned()
    return self.id ~= nil
end
function Pawn:get(key)
    if self:spawned() then
        return lobby:get_pawn(self.id, key)
    else
        error("Attempted to update not-yet-spawned pawn")
    end
end
function Pawn:update(table)
    if self:spawned() then
        table.id = self.id
        lobby:update_pawn(table)
    else
        error("Attempted to update not-yet-spawned pawn")
    end
end
function Pawn:destroy()
    if self:spawned() then
        lobby:destroy_pawn(self.id)
    else
        error("Attempted to destroy not-yet-spawned pawn")
    end
end
function Pawn:new(options)
    if options["id"] ~= nil then
        error("Attempted to create pawn with manually assigned id")
    end

    local o
    if type(options) == "number" then
        o = {id = options}
    else
        options.position = options.position or vec3(0,0,0)
        options.rotation = options.rotation or quat(0,0,0,0)
        options.select_rotation = options.select_rotation or quat(0,0,0,0)
        o = options
    end
    setmetatable(o, self)
    return o
end

DeckData = {}
SnapPointData = {}
ContainerData = {}
DiceData = {}
function DeckData:new(options)
    local o = {
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
    local o = {
        radius = options.radius or 1,
        size = options.size or vec2(1, 1),
        scale = options.scale or 1,
        snaps = options.snaps or {}
    }
    setmetatable(o, self)
    return o
end
function ContainerData:new(options)
    local o = {
        holds = options.holds or {},
        capacity = options.capacity or 1,
    }
    setmetatable(o, self)
    return o
end
function DiceData:new(options)
    local o = {
        roll_rotations = options.roll_rotations or {},
    }
    setmetatable(o, self)
    return o
end

-- Lobby extensions

lobby_ext = {}
function lobby_ext:schedule(co)
    local alive, ticks = coroutine.resume(co)
    if ticks then
        lobby:timeout(function()
            lobby_ext:schedule(co)
        end, ticks)
    end
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