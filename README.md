FOSDEM'18 Janus Lua demo (chatroulette)
=======================================

This is the code for the demo mentioned towards the end of my talk on the new Janus Lua plugin at FOSDEM'18: the demo is basically a WebRTC "chatroulette", where all logic is delegated to a Lua script. Slides and a recording of the talk can be found at [this link](https://fosdem.org/2018/schedule/event/janus/).

## How to start it
Two simple steps:

1. make the Janus Lua plugin load the provided `chatroulette.lua` code.
2. serve the contents of the `html` folder.

### Lua script
You load the provided Lua script by simply editing the `janus.plugin.lua.cfg` configuration file, e.g.:

	[general]
	path = /opt/janus/share/janus/lua
	script = /path/to/chatroulette.lua

### Serving the web demos
Exactly the same as you'd [serve the regular Janus demos](https://janus.conf.meetecho.com/docs/deploy).

## Playing with the demos
Just open the `index.html` file with a WebRTC browser, choose a display name, and wait for a match. In case no one is available, your own media will be sent back to you. When you get a match, it switches to a video call + chat between the two of you: when you reject the match, a new one is searched, and again, if no one else's available, you get your own media back until new people join.

Just a very simple example of how Lua can help drive the logic on Janus media streams management: experimental, probably buggy, but hopefully fun... enjoy!
