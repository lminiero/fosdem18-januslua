var server = null;
if(window.location.protocol === 'http:')
	server = "http://" + window.location.hostname + ":8088/janus";
else
	server = "https://" + window.location.hostname + ":8089/janus";

var janus = null;
var chatroulette = null;
var opaqueId = "chatroulette-"+Janus.randomString(12);

var myusername = null;
var mypeer = null;

var started = false;
var bitrateTimer = null;
var spinner = null;

var audioenabled = false;
var videoenabled = false;

$(document).ready(function() {
	// Initialize the library (all console debuggers enabled)
	Janus.init({debug: "all", callback: function() {
		// Use a button to start the demo
		$('#start').click(function() {
			if(started)
				return;
			started = true;
			$(this).attr('disabled', true).unbind('click');
			// Make sure the browser supports WebRTC
			if(!Janus.isWebrtcSupported()) {
				bootbox.alert("No WebRTC support... ");
				return;
			}
			// Create session
			janus = new Janus(
				{
					server: server,
					success: function() {
						// Attach to Lua plugin
						janus.attach(
							{
								plugin: "janus.plugin.lua",
								opaqueId: opaqueId,
								success: function(pluginHandle) {
									$('#details').remove();
									chatroulette = pluginHandle;
									Janus.log("Plugin attached! (" + chatroulette.getPlugin() + ", id=" + chatroulette.getId() + ")");
									// Prepare the username registration
									$('#videocall').removeClass('hide').show();
									$('#login').removeClass('hide').show();
									$('#registernow').removeClass('hide').show();
									$('#register').click(registerUsername);
									$('#username').focus();
									$('#start').removeAttr('disabled').html("Stop")
										.click(function() {
											$(this).attr('disabled', true);
											janus.destroy();
										});
								},
								error: function(error) {
									console.error("  -- Error attaching plugin...", error);
									bootbox.alert("Error attaching plugin... " + error);
								},
								consentDialog: function(on) {
									Janus.debug("Consent dialog should be " + (on ? "on" : "off") + " now");
									if(on) {
										// Darken screen and show hint
										$.blockUI({ 
											message: '<div><img src="up_arrow.png"/></div>',
											css: {
												border: 'none',
												padding: '15px',
												backgroundColor: 'transparent',
												color: '#aaa',
												top: '10px',
												left: (navigator.mozGetUserMedia ? '-100px' : '300px')
											} });
									} else {
										// Restore screen
										$.unblockUI();
									}
								},
								iceState: function(state) {
									Janus.log("ICE state changed to " + state);
								},
								mediaState: function(medium, on) {
									Janus.log("Janus " + (on ? "started" : "stopped") + " receiving our " + medium);
								},
								webrtcState: function(on) {
									Janus.log("Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
									$("#videoleft").parent().unblock();
								},
								slowLink: function(uplink, nacks) {
									Janus.warn("Janus reports problems " + (uplink ? "sending" : "receiving") +
										" packets on this PeerConnection (" + nacks + " NACKs/s " + (uplink ? "received" : "sent") + ")");
								},
								onmessage: function(msg, jsep) {
									Janus.debug(" ::: Got a message :::");
									Janus.debug(msg);
									if(jsep !== undefined && jsep !== null) {
										Janus.debug("Handling SDP as well...");
										Janus.debug(jsep);
										chatroulette.handleRemoteJsep({jsep: jsep});
									}
									if(msg["result"] === "ok" && msg["name"]) {
										myusername = msg["name"];
										toastr.success("Now available as '" + myusername + "'!", null, {timeOut: 2000});
									}
									if(msg["matched"] === true) {
										mypeer = msg["name"];
										toastr.info("Chatting with " + mypeer + " now!", null, {timeOut: 2000});
										$('#reject').html("Reject " + mypeer + " (try new match)")
											.removeClass('hide').show()
											.removeAttr('disabled')
											.click(rejectPeer);
										$('#datarecv').val("[now chatting with " + mypeer + "]");
										$('#callee').removeClass('hide').show()
											.html(mypeer)
											.removeClass('btn-success btn danger')
											.addClass('btn-success');
									} else if(msg["matched"] === false) {
										if(mypeer) {
											$('#datarecv').val("[not chatting with " + mypeer + " anymore]");
											toastr.warning(mypeer + " has gone, waiting for a new match...", null, {timeOut: 2000});
										} else {
											$('#datarecv').val("[not chatting with anyone right now]");
											toastr.warning("Couldn't find any match, waiting for one...", null, {timeOut: 2000});
										}
										mypeer = null;
										$('#reject').hide().attr('disabled', true).unbind('click');
										$('#callee').removeClass('hide').show()
											.html('(you)')
											.removeClass('btn-success btn danger')
											.addClass('btn-danger');
									}
								},
								onlocalstream: function(stream) {
									Janus.debug(" ::: Got a local stream :::");
									Janus.debug(stream);
									if($('#myvideo').length === 0) {
										$('#videos').removeClass('hide').show();
										$('#videoleft').append('<video class="rounded centered" id="myvideo" width=320 height=240 autoplay muted="muted"/>');
									}
									Janus.attachMediaStream($('#myvideo').get(0), stream);
									$("#myvideo").get(0).muted = "muted";
									$("#videoleft").parent().block({
										message: '<b>Publishing...</b>',
										css: {
											border: 'none',
											backgroundColor: 'transparent',
											color: 'white'
										}
									});
									// No remote video yet
									$('#videoright').append('<video class="rounded centered" id="waitingvideo" width=320 height=240 />');
									if(spinner == null) {
										var target = document.getElementById('videoright');
										spinner = new Spinner({top:100}).spin(target);
									} else {
										spinner.spin();
									}
									var videoTracks = stream.getVideoTracks();
									if(videoTracks === null || videoTracks === undefined || videoTracks.length === 0) {
										// No webcam
										$('#myvideo').hide();
										$('#videoleft').append(
											'<div class="no-video-container">' +
												'<i class="fa fa-video-camera fa-5 no-video-icon"></i>' +
												'<span class="no-video-text">No webcam available</span>' +
											'</div>');
									}
								},
								onremotestream: function(stream) {
									Janus.debug(" ::: Got a remote stream :::");
									Janus.debug(stream);
									if($('#peervideo').length > 0) {
										// Been here already: let's see if anything changed
										var videoTracks = stream.getVideoTracks();
										if(videoTracks && videoTracks.length > 0 && !videoTracks[0].muted) {
											$('#novideo').remove();
											if($("#peervideo").get(0).videoWidth)
												$('#peervideo').show();
										}
										return;
									}
									$('#videos').removeClass('hide').show();
									$('#videoright').append('<video class="rounded centered hide" id="peervideo" width=320 height=240 autoplay/>');
									// Show the video, hide the spinner and show the resolution when we get a playing event
									$("#peervideo").bind("playing", function () {
										$('#waitingvideo').remove();
										if(this.videoWidth)
											$('#peervideo').removeClass('hide').show();
										if(spinner !== null && spinner !== undefined)
											spinner.stop();
										spinner = null;
										var width = this.videoWidth;
										var height = this.videoHeight;
										$('#curres').removeClass('hide').text(width+'x'+height).show();
									});
									Janus.attachMediaStream($('#peervideo').get(0), stream);
									var videoTracks = stream.getVideoTracks();
									if(videoTracks === null || videoTracks === undefined || videoTracks.length === 0 || videoTracks[0].muted) {
										// No remote video
										$('#peervideo').hide();
										$('#videoright').append(
											'<div id="novideo" class="no-video-container">' +
												'<i class="fa fa-video-camera fa-5 no-video-icon"></i>' +
												'<span class="no-video-text">No remote video available</span>' +
											'</div>');
									}
									// Enable audio/video buttons and bitrate limiter
									audioenabled = true;
									videoenabled = true;
									$('#toggleaudio').click(
										function() {
											audioenabled = !audioenabled;
											if(audioenabled) {
												$('#toggleaudio').html("Disable audio").removeClass("btn-success").addClass("btn-danger");
												chatroulette.unmuteAudio();
											} else {
												$('#toggleaudio').html("Enable audio").removeClass("btn-danger").addClass("btn-success");
												chatroulette.muteAudio();
											}
										});
									$('#togglevideo').click(
										function() {
											videoenabled = !videoenabled;
											if(videoenabled) {
												$('#togglevideo').html("Disable video").removeClass("btn-success").addClass("btn-danger");
												chatroulette.unmuteVideo();
											} else {
												$('#togglevideo').html("Enable video").removeClass("btn-danger").addClass("btn-success");
												chatroulette.muteVideo();
											}
										});
									$('#toggleaudio').parent().removeClass('hide').show();
									$('#bitrate a').click(function() {
										var id = $(this).attr("id");
										var bitrate = parseInt(id)*1000;
										if(bitrate === 0) {
											Janus.log("Not limiting bandwidth via REMB");
										} else {
											Janus.log("Capping bandwidth to " + bitrate + " via REMB");
										}
										$('#bitrateset').html($(this).html() + '<span class="caret"></span>').parent().removeClass('open');
										chatroulette.send({"message": { "bitrate": bitrate }});
										return false;
									});
									if(Janus.webRTCAdapter.browserDetails.browser === "chrome" || Janus.webRTCAdapter.browserDetails.browser === "firefox" ||
											Janus.webRTCAdapter.browserDetails.browser === "safari") {
										$('#curbitrate').removeClass('hide').show();
										bitrateTimer = setInterval(function() {
											// Display updated bitrate, if supported
											var bitrate = chatroulette.getBitrate();
											//~ Janus.debug("Current bitrate is " + chatroulette.getBitrate());
											$('#curbitrate').text(bitrate);
											// Check if the resolution changed too
											var width = $("#peervideo").get(0).videoWidth;
											var height = $("#peervideo").get(0).videoHeight;
											if(width > 0 && height > 0)
												$('#curres').removeClass('hide').text(width+'x'+height).show();
										}, 1000);
									}
								},
								ondataopen: function(data) {
									Janus.log("The DataChannel is available!");
									$('#videos').removeClass('hide').show();
									$('#datasend').removeAttr('disabled');
								},
								ondata: function(data) {
									Janus.debug("We got data from the DataChannel! " + data);
									$('#datarecv').val(data);
								},
								oncleanup: function() {
									Janus.log(" ::: Got a cleanup notification :::");
									if(spinner !== null && spinner !== undefined)
										spinner.stop();
									spinner = null;
									$('#myvideo').remove();
									$('#waitingvideo').remove();
									$("#videoleft").parent().unblock();
									$('#peervideo').remove();
									$('#toggleaudio').attr('disabled', true);
									$('#togglevideo').attr('disabled', true);
									$('#bitrate').attr('disabled', true);
									$('#curbitrate').hide();
									$('#curres').hide();
									$('#datasend').attr('disabled', true);
								}
							});
					},
					error: function(error) {
						Janus.error(error);
						bootbox.alert(error, function() {
							window.location.reload();
						});
					},
					destroyed: function() {
						window.location.reload();
					}
				});
		});
	}});
});

function checkEnter(field, event) {
	var theCode = event.keyCode ? event.keyCode : event.which ? event.which : event.charCode;
	if(theCode == 13) {
		if(field.id == 'username')
			registerUsername();
		else if(field.id == 'datasend')
			sendData();
		return false;
	} else {
		return true;
	}
}

function registerUsername() {
	// Try a registration
	$('#username').attr('disabled', true);
	$('#register').attr('disabled', true).unbind('click');
	var username = $('#username').val();
	if(username === "") {
		bootbox.alert("Insert a username to register (e.g., pippo)");
		$('#username').removeAttr('disabled');
		$('#register').removeAttr('disabled').click(registerUsername);
		return;
	}
	if(/[^a-zA-Z0-9]/.test(username)) {
		bootbox.alert('Input is not alphanumeric');
		$('#username').removeAttr('disabled').val("");
		$('#register').removeAttr('disabled').click(registerUsername);
		return;
	}
	// Register name and negotiate WebRTC
	var register = { name: username };
	Janus.debug("Trying a createOffer (audio/video/data sendrecv)");
	chatroulette.createOffer(
		{
			// No media provided: by default, it's sendrecv for audio and video
			media: { data: true },	// Let's negotiate data channels as well
			success: function(jsep) {
				Janus.debug("Got SDP!");
				Janus.debug(jsep);
				chatroulette.send({ message: register, jsep: jsep });
			},
			error: function(error) {
				Janus.error("WebRTC error:", error);
				bootbox.alert("WebRTC error... " + JSON.stringify(error));
			}
		});
}

function rejectPeer() {
	if(mypeer === null)
		return;
	$('#reject').attr('disabled', true).unbind('click');
	var reject = { reject: mypeer };
	chatroulette.send({ message: reject });
}

function sendData() {
	var data = $('#datasend').val();
	if(data === "") {
		bootbox.alert('Insert a message to send on the DataChannel');
		return;
	}
	chatroulette.data({
		text: data,
		error: function(reason) { bootbox.alert(reason); },
		success: function() { $('#datasend').val(''); },
	});
}
