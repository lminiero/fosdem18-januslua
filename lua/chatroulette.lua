-- This is a simple example of an echo test application built in Lua,
-- and conceived to be used in conjunction with the janus_lua.c plugin
--
-- Note: this example depends on lua-json to do JSON processing
-- (http://luaforge.net/projects/luajson/)
json = require('json')
-- We also import our own SDP helper utilities: you may have better ones
sdp = require('janus-sdp')
-- Let's also use our ugly stdout logger just for the fun of it: to add
-- some color to the text we use the ansicolors library
-- (https://github.com/kikito/ansicolors.lua)
colors = require "ansicolors"
logger = require('janus-logger')

-- Example details
name = "chatroulette.lua"
logger.prefix(colors("[%{blue}" .. name .. "%{reset}]"))
logger.print("Loading...")

-- State and properties
sessions = {}
ids = {}
tasks = {}

-- Methods
function init(config)
	-- This is where we initialize the plugin, for static properties
	logger.print("Initializing...")
	if config ~= nil then
		logger.print("Configuration file provided (" .. config .. "), but we don't need it")
	end
	logger.print("Initialized")
end

function destroy()
	-- This is where we deinitialize the plugin, when Janus shuts down
	logger.print("Deinitialized")
end

function createSession(id)
	-- Keep track of a new session
	logger.print("Created new session: " .. id)
	sessions[id] = { id = id, lua = name, rejected = {} }
	table.insert(ids, id)
end

function destroySession(id)
	-- A Janus plugin session has gone
	logger.print("Destroyed session: " .. id)
	hangupMedia(id)
	sessions[id] = nil
	-- Get rid of the ids in the hashtables we have
	local i=1
	while i <= #ids do
		if ids[i] == id then
			table.remove(ids, i)
		else
			i = i + 1
		end
	end
	for index,s in pairs(sessions) do
		s.rejected[id] = nil
	end
end

function querySession(id)
	-- Return info on a session
	logger.print("Queried session: " .. id)
	local s = sessions[id]
	if s == nil then
		return nil
	end
	local info = { script = s["lua"], id = s["id"] }
	local infojson = json.encode(info)
	return infojson
end

function handleMessage(id, tr, msg, jsep)
	-- Handle a message, synchronously or asynchronously, and return
	-- something accordingly: if it's the latter, we'll do a coroutine
	logger.print("Handling message for session: " .. id)
	local s = sessions[id]
	if s == nil then
		return -1, "Session not found"
	end
	-- Decode the message JSON string to a table
	local msgT = json.decode(msg)
	-- Let's return a synchronous response if there's no jsep, asynchronous otherwise
	if jsep == nil then
		processRequest(id, msgT)
		local response = { chatroulette = "response", result = "ok" }
		local responsejson = json.encode(response)
		return 0, responsejson
	else
		-- Decode the JSEP JSON string to a table too
		local jsepT = json.decode(jsep)
		-- We need a new coroutine here
		local async = coroutine.create(function(id, tr, comsg, cojsep)
			-- We'll only execute this when the scheduler resumes the task
			logger.print("Handling async message for session: " .. id)
			local s = sessions[id]
			if s == nil then
				logger.print("Can't handle async message: so such session")
				return
			end
			local offer = sdp.parse(cojsep.sdp)
			logger.print("Got offer: " .. sdp.render(offer))
			local answer = sdp.generateAnswer(offer, {
				audio = true, audioCodec = "opus",
				video = true, videoCodec = "vp8",
				data = true
			})
			logger.print("Generated answer: " .. sdp.render(answer))
			logger.print("Processing request: " .. dumpTable(comsg))
			local event = processRequest(id, comsg)
			logger.print("Pushing event:")
			local jsonevent = json.encode(event)
			logger.print("  -- " .. jsonevent)
			local jsepanswer = { type = "answer", sdp = sdp.render(answer) }
			local jsonjsep = json.encode(jsepanswer)
			logger.print("  -- " .. jsonjsep)
			pushEvent(id, tr, jsonevent, jsonjsep)
		end)
		-- Enqueue it: the scheduler will resume it later
		tasks[#tasks+1] = { co = async, id = id, tr = tr, msg = msgT, jsep = jsepT }
		-- Return explaining that this is will be handled asynchronously
		pokeScheduler()
		return 1, nil
	end
end

function setupMedia(id)
	-- WebRTC is now available
	logger.print("WebRTC PeerConnection is up for session: " .. id)
	local s = sessions[id]
	if s == nil then return end
	s.started = true
	-- Allow everything
	configureMedium(id, "audio", "in", true)
	configureMedium(id, "audio", "out", true)
	configureMedium(id, "video", "in", true)
	configureMedium(id, "video", "out", true)
	configureMedium(id, "data", "in", true)
	configureMedium(id, "data", "out", true)
	-- Check if there's any available user, otherwise attach to ourselves
	chatRoulette(id, nil)
end

function hangupMedia(id)
	-- WebRTC not available anymore
	logger.print("WebRTC PeerConnection is down for session: " .. id)
    local s = sessions[id]
    if s == nil then return end
	s.started = false
	-- Detach the stream
    removeRecipient(id, s.peerId)
    if s.peerId ~= nil and s.peerId ~= id then
		-- We need a new user for what was our peer
		removeRecipient(s.peerId, id)
		chatRoulette(s.peerId, id)
    end
end

function resumeScheduler()
	-- This is the function responsible for resuming coroutines associated
	-- with whatever is relevant to the Lua script, e.g., for this script,
	-- with asynchronous requests: if you're handling async stuff yourself,
	-- you're free not to use this and just return, but the C Lua plugin
	-- expects this method to exist so it MUST be present, even if empty
	logger.print("Resuming coroutines")
	for index,task in ipairs(tasks) do
		local success, result = coroutine.resume(task.co, task.id, task.tr, task.msg, task.jsep)
		if not success then
			logger.print(colors("[%{red}exception%{reset}]") .. " " .. dumpTable(result))
		end
	end
	logger.print("Coroutines resumed")
	tasks = {}
end

-- This method implements the "magic", matching available users
function chatRoulette(id)
	local s = sessions[id]
	if s == nil then return end
	logger.print("Looking for a match for session " .. id)
	-- Find a match
	local ok = false
	if s.name ~= nil and #ids > 1 then
		local temp = {}
		local index = nil
		local pId = nil
		for index,pId in ipairs(ids) do
			local p = sessions[pId]
			if pId ~= id and p ~= nil and p.name ~= nil and p.started == true and p.peerId == nil and
					s.rejected[pId] == nil and p.rejected[id] == nil then
				temp[#temp+1] = pId
			end
		end
		logger.print("Possible matches for session " .. id .. ": " .. dumpTable(temp))
		if #temp > 0 then
			-- This list only contains valid candidates, which means we found a match
			index = math.random(1, #temp)
			pId = temp[index]
			local p = sessions[pId]
			-- Found a match!
			logger.print("Found a match! " .. id .. " <-->" .. pId)
			removeRecipient(id, id)
			removeRecipient(pId, pId)
			addRecipient(id, pId)
			addRecipient(pId, id)
			sendPli(id)
			sendPli(pId)
			s.peerId = pId
			p.peerId = id
			-- Notify the users
			local event = { chatroulette = "event", matched = true, peer = pId, name = p.name }
			local jsonevent = json.encode(event)
			pushEvent(id, nil, jsonevent, nil)
			event = { chatroulette = "event", matched = true, peer = id, name = s.name }
			jsonevent = json.encode(event)
			pushEvent(pId, nil, jsonevent, nil)
			-- Break the loop
			ok = true
		end
	end
	if ok == false then
		-- No match, let's get our own media
		logger.print("No match, attaching session to itself")
		removeRecipient(id, id)
		addRecipient(id, id)
		sendPli(id)
		-- Notify the user
		local event = { chatroulette = "event", matched = false }
		local jsonevent = json.encode(event)
		pushEvent(id, nil, jsonevent, nil)
	end
end

-- We use this internal method to process an API request
function processRequest(id, msg)
	if msg == nil then
		return nil
	end
	local s = sessions[id]
	if s == nil then return nil end
	-- This is where we handle the requests, sync or async
	local newName = nil
	if msg["name"] ~= nil and s.name == nil then
		s.name = msg["name"]
		logger.print("Session " .. id .. " has taken name " .. s.name)
		-- Let's send it back to the user as a confirmation
		newName = s.name
	end
	if msg["reject"] ~= nil then
		local peerId = s.peerId
		if peerId ~= nil then
			logger.print("Session " .. id .. " is asking for a new match")
			-- Stop relaying the media to each other, and mark the session as rejected
			s.rejected[peerId] = true
			s.peerId = nil
			local p = sessions[peerId]
			if p ~= nil then p.peerId = nil end
			removeRecipient(id, id)
			removeRecipient(id, peerId)
			removeRecipient(peerId, peerId)
			removeRecipient(peerId, id)
			-- Find a new match for both
			chatRoulette(id)
			chatRoulette(peerId)
		end
	end
	if msg["bitrate"] ~= nil then
		setBitrate(id, msg["bitrate"])
	end
	local event = { chatroulette = "event", result = "ok" }
	if newName ~= nil then
		event["name"] = newName
	end
	return event
end

-- Helper for logging tables
-- https://stackoverflow.com/a/27028488
function dumpTable(o)
	if type(o) == 'table' then
		local s = '{ '
		for k,v in pairs(o) do
			if type(k) ~= 'number' then k = '"'..k..'"' end
			s = s .. '['..k..'] = ' .. dumpTable(v) .. ','
		end
		return s .. '} '
	else
		return tostring(o)
	end
end

-- Done
logger.print("Loaded")
