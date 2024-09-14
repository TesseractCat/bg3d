-- Imports

local vmath = require "math"
vec3 = vmath.vec3
vec2 = vmath.vec2
quat = vmath.quat

require "utility"

-- Pawns

local function proxy(table, on_set)
    local proxy_mt = {}
    function proxy_mt.__index(table, key)
        local field = table.__proxy[key]
        if type(field) == "table" then
            local proxy = {__proxy = table}
            setmetatable(proxy, proxy_mt)
            return proxy
        end
        return field
    end
    function proxy_mt.__newindex(table, key, value)
        table.__proxy[key] = value
        on_set()
    end
    local proxy = {__proxy = table}
    setmetatable(proxy, proxy_mt)
    return proxy
end

PawnProxy = {
    __index = function(self, key)
        if key == "id" then
            return rawget(self, key)
        end

        if PawnProxy[key] ~= nil then
            return PawnProxy[key] -- Pawn class methods
        else
            local table = self:get()
            local field = table[key]
            if type(field) == "table" then
                -- Proxy all writes to ensure pawn:update() method is called
                return proxy(field, function()
                    self:update(table)
                end)
            else
                return field
            end
        end
    end,
    __newindex = function(self, key, value)
        local table = self:get()
        table[key] = value
        self:update(table)
    end,
    __eq = function(a, b)
        return a.id == b.id
    end
}
function PawnProxy:get()
    return lobby:get_pawn(self.id)
end
function PawnProxy:clone()
    local o = self:get()
    o.id = nil
    return o
end
function PawnProxy:update(table)
    lobby:update_pawn(table)
end
function PawnProxy:destroy()
    lobby:destroy_pawn(self.id)
end
function PawnProxy:new(id)
    local o = {id = id}
    setmetatable(o, self)
    return o
end

Pawn = {}
function Pawn:destroy()
    error("Attempted to destroy a non-spawned pawn")
end
function Pawn:new(options)
    local o = options
    o.select_rotation = o.select_rotation or o.rotation
    setmetatable(o, self)
    return o
end

-- Pawn Data

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

lobby_ext = lobby_ext or {}
function lobby_ext:schedule(co)
    local alive, ticks = coroutine.resume(co)
    if type(ticks) ~= "number" then
        error(string.format("Expected number while running coroutine, got type %s with value: '%s'",
                            type(ticks), tostring(ticks)))
    end
    if ticks then
        lobby:timeout(function()
            lobby_ext:schedule(co)
        end, ticks)
    end
end
lobby_ext.default_pawns = require "pawns"
local function register_pawns(table, path)
    for key, value in pairs(table) do
        if type(value) == "table" then
            if getmetatable(value) == Pawn then
                lobby:register_pawn(path, value)
            else
                register_pawns(value, path .. "/" .. key:gsub("^%l", string.upper))
            end
        end
    end
end
register_pawns(lobby_ext.default_pawns, "")