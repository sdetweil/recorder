"use strict";
// My module

const io = require("socket.io-client");
const _reEventEmitter = require("events");
const { spawn, exec, spawnSync } = require("child_process");
const { waitRunning } = require("waitprocess");
const getPort = require("get-port");
const create_reco_process = true;
const redebug = false;
if (redebug) console.log("our location=" + __dirname);

// gets the port where the stock SM rec process is running
// and the socket.io port is up 1

var kwsProcess = null;
var kwsPort = null;
function recorder(smart_mirror_remote_port, filename) {
	this.host = "http://localhost";
	this.sm_port = smart_mirror_remote_port;
	this.smSonus = null;
	this.voiceClient = null;
	this.Emitter = null;
	this.recording = false;
	this.ready = false;
	//this.kwsProcess = null;
	// indicates raw or text output
	this.rawFilename = filename;
	this.recoProgram = "";
	/*
	const sleepAndCheck = (cmd, ms) => {
		return new Promise((resolve, reject) => {
			setTimeout(() => {
				let pid = spawnSync(cmd, { shell: true });
				resolve(pid);
			}, ms);
		});
	};

	const waitRunning = (query, target, timeout) => {
		return new Promise((resolve, reject) => {
			let platform = process.platform;
			let cmd = "";
			switch (platform) {
				case "win32":
					cmd = `tasklist`;
					break;
				case "darwin":
					cmd = `bash -c "ps -ax | grep ${query}"`;
					break;
				case "linux":
					cmd = `ps -A | grep ${query}| tr -d '\n'`;
					break;
				default:
					break;
			}

			let delay = 100;
			if (redebug)
				console.log(
					" checking on recorder is " + target
						? ""
						: "not" + " running still"
				);
			// wait some time for processes to start
			let timerHandle = setInterval(
				() => {
					// start one and check if its running
					sleepAndCheck(cmd, delay).then((r) => {
						//r.stdout=r.buffer.toString()
						if (redebug)
							console.log(
								"recorder process list ='" + r.stdout + "'"
							);
						// check the cmd results
						let s = r.stdout.toString().toLowerCase();
						if (target == false) {
							if (s.indexOf(query.toLowerCase()) == -1) {
								if (redebug)
									console.log(
										"recorder " +
											query +
											" is not running now"
									);
								clearInterval(timerHandle);
								resolve();
								return;
							}
						} else {
							if (redebug)
								console.log(
									" testing for '" +
										query +
										"' in stdout=" +
										r.stdout.toString()
								);
							if (s.indexOf(query.toLowerCase()) > -1) {
								if (redebug)
									console.log(
										" recorder found '" +
											query +
											"' running"
									);
								clearInterval(timerHandle);
								resolve();
								return;
							}
						}
						timeout -= delay;
						if (redebug)
							console.log("recorder adjusting remaining delay");
						// thru whole delay, failed
						if (timeout <= 0) {
							if (redebug)
								console.log(
									"recorder test for '" +
										query +
										"' was not found "
								);
							clearInterval(timerHandle);
							reject("timeout");
							return;
						}
					}); // end of sleep and check then
				}, // end iunterval handler
				delay
			); // end setInterval
		}); // end promise
	};
*/
	this.init = function () {
		this.smSonus.on("connected", (socket) => {
			if (redebug) console.log("recorder connected to sm sonus");
			clearTimeout(this.timerHandle);
		});

		// background sonus process sends its config info
		// so we don't have to figure out differently
		this.smSonus.on("info", (info) => {
			// indicate we have no hotwords

			this.recoProgram = info.reco;
			if (redebug)
				console.log(
					"recorder got info from sm sonus = " +
						JSON.stringify(info) +
						"recoProgram=" +
						this.recoProgram
				);
			this.startRecognizerProcess(kwsPort);
			this.ready = true;
		});

		// start our recorder
		this.smSonus.on("stopped", () => {
			// background task paused
			// start our reco engine

			waitRunning(this.recoProgram, false, 1000).then(
				() => {
					if (redebug)
						console.log("background recorder stopped, start ours");
					this.voiceClient.emit("start", this.rawFilename);
					this.recording = true;
				},
				() => {
					if (redebug)
						console.log(
							"main recorder hasn't stopped yet, lets try again"
						);
					this.smSonus.emit("stop");
				}
			);
		});

		this.smSonus.on("started", () => {
			if (redebug) console.log("recorder native reco started");
		});
	};

	this.waitSocket = function (socket) {
		var self = this;
		if (redebug) console.log("enter wait socket=" + socket);

		// if we haven't connected to our reco process yet
		if (!this.voiceClient) {
			if (redebug) console.log("host=" + this.host + ":" + socket);
			// connect now (we passed this same port number on its startup, so we should be in synch)

			this.voiceClient = io.connect(this.host + ":" + socket);
			if (redebug)
				console.log("connecting to the voice client socket =" + socket);
			this.timer = setTimeout(function () {
				self.waitSocket(socket);
			}, 1500);
		} else {
			if (redebug) console.log("have the voice client socket");
			clearTimeout(this.timer);

			// setup handlers for incoming reco text events
			// tell waiting open task
			this.voiceClient.on("partial-text", (message) => {
				if (redebug)
					console.log(
						" received partial text from reco engine=" + message
					);
				this.Emitter.emit("partial", message);
				// turn off our reco engine
			});

			this.voiceClient.on("final-text", (message) => {
				if (redebug)
					console.log(
						" received final text from reco engine=" + message
					);
				if (message != "") {
					this.Emitter.emit("final", message);
					// turn off our reco engine
					this.voiceClient.emit("stop", this.rawFilename);
				} else {
					if (redebug)
						console.log(
							" ignoring final text from reco engine=" + message
						);
				}
			});

			this.voiceClient.on("ended", (filename) => {
				// raw record completed
				this.Emitter.emit("final_audio", filename);
				// tell voiceclient to unhook mic
				this.voiceClient.emit("stop", filename);
				if (redebug)
					console.log(
						" received raw audio from reco engine=" + filename
					);
			});
			this.voiceClient.on("error", (error) => {
				// pass it on
				this.Emitter.emit("error", error);
			});

			this.voiceClient.on("started", (error) => {
				// pass it on
				if (redebug) console.log("our recorder says it started ");
				waitRunning(this.recoProgram, true, 1000).then(
					() => {
						console.log("our recorder did start");
						this.recording = true;
					},
					() => {
						console.log("our recorder did NOT start, trying again");
						this.voiceClient.emit("start", this.rawFilename);
					}
				);
			});

			// our background responds stopped to the final-text event stop that was sent
			this.voiceClient.on("stopped", () => {
				// turn back on the mirrors engine

				if (redebug) console.log(" check for our recorder stopped");
				let self = this;
				// 200ms quiet time
				waitRunning(this.recoProgram, false, 1000).then(
					() => {
						if (redebug) console.log(" restarting base reco");
						// tell the smart mirror reco engine to resume now
						self.smSonus.emit("start");
					},
					() => {
						console.log(" our recorder hasn't stopped yet");
					}
				);
			});
			// we can tell the app client to use this emitter for incoming text events
			this.resolve(this.Emitter);
		}
	};
	this.startRecognizerProcess = function (socketNumber) {
		// Initilize the keyword spotter

		if (redebug) console.log("process starting in the background");
		// if we should start the background
		// (for debug we can manually launch one in the foreground to see the log)
		if (create_reco_process) {
			// if not already created (alexa and assistant both use it)
			if (!kwsProcess) {
				kwsProcess = spawn(
					"node",
					[__dirname + "/sonus.js", socketNumber],
					{
						detached: false,
					}
				);
				kwsProcess.on("error", (err) => {
					console.error(" spawn err: ", err);
				});
				kwsProcess.on("exit", (code, signal) => {
					if (code) {
						console.error(" Child exited with code", code);
					} else if (signal) {
						console.error(" Child was killed with signal", signal);
					} else {
						if (redebug) console.log(" Child exited okay");
					}
				});
			}
		}
		this.waitSocket(socketNumber);
	};
}
// client wants to control reco
recorder.prototype.open = function () {
	return new Promise((resolve, reject) => {
		// cloud speech reco client
		this.resolve = resolve;
		this.reject = reject;
		// tool to talk to our consumer
		this.Emitter = new _reEventEmitter();

		if (redebug) console.log(" requesting port");
		// ask for a range
		var self = this;
		// get a free port
		getPort({ port: getPort.makeRange(5100, 5200) })
			.then((port) => {
				if (!create_reco_process) port = 5100;
				// use first available
				if (redebug) console.log(" have available ports =", port);
				// wil be the port we use for OUR reco engine control
				kwsPort = port;
				if (redebug) console.log(" have available port=" + kwsPort);
				// connect to the smart-mirror reco process
				// io client to background sonus
				self.smSonus = io.connect(self.host + ":" + this.sm_port);

				// setup the handlers
				self.init();

				// do this last, prevent race condition of server sending back

				self.timerHandle = setTimeout(function () {
					self.reject("no response");
				}, 8000);

				// connect to the sonus process and get its config info
				self.smSonus.emit("getinfo");
				// we start idle
				self.recording = false;
			})
			.catch((error) => {
				if (redebug) console.log(" port request failed=" + error);
			});
	});
};
recorder.prototype.start = function () {
	if (this.ready) {
		// tell the background sonus to stop
		// this will auto start our engine
		this.smSonus.emit("stop");
	}
};
// not sure what to do here
recorder.prototype.stop = function () {
	if (redebug) console.log("speech service requests stop");
	this.smSonus.emit("start");
};
// not sure what to do here
recorder.prototype.close = function () {
	if (redebug) console.log("close");
};
// are we recording ?
recorder.prototype.recording = function () {
	return this.recording;
};

module.exports = recorder;
