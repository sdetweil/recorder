"use strict";
// My module

const io = require("socket.io-client");
const EventEmitter = require("events");
const { spawn, exec, spawnSync } = require("child_process");
const getPort = require("get-port");
const psleep = require("sleep");
const create_reco_process = false;
const redebug = true;
if (redebug) console.log("our location=" + __dirname);

// gets the port where the stock SM rec process is running
// and the socket.io port is up 1

function recorder(smart_mirror_remote_port) {
	this.host = "http://localhost";
	this.sm_port = smart_mirror_remote_port - 1;
	this.port = 0;
	this.ioClient = null;
	this.voiceClient = null;
	this.Emitter = null;
	this.recording = false;
	this.ready = false;
	this.kwsProcess = null;

	const sleepAndCheck = (cmd, ms) => {
		psleep.msleep(ms);
		return spawnSync(cmd, { shell: true });
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
			let found = false;
			console.log(
				" checking on recorder " + target
					? "running still"
					: "Not running"
			);
			while (timeout > 0) {
				let r = sleepAndCheck(cmd, delay);
				//r.stdout=r.buffer.toString()
				console.log(
					"process list ='" + r.stdout + "' error=" + r.stderr
				);
				// check the cmd results
				if (target == false) {
					if (
						r.stdout
							.toString()
							.toLowerCase()
							.indexOf(query.toLowerCase()) == -1
					) {
						console.log(query + " not running now");
						resolve();
						found = true;
						break;
					}
				} else {
					console.log(
						" stdout=" + r.stdout.toString() + " test for " + query
					);
					let s = r.stdout.toString();
					if (s.toLowerCase().indexOf(query.toLowerCase()) > -1) {
						console.log(" found '" + query + "'");
						resolve();
						found = true;
						break;
					}
				}
				timeout -= delay;
				console.log("adjusting remaining delay");
			}
			// thru whole delay, failed
			if (!found) {
				console.log("test for ${query} not found again");
				reject("timeout");
			}
		});
	};

	this.init = function () {
		this.ioClient.on("connected", (socket) => {
			//if(redebug)
			console.log("connected");
			clearTimeout(this.timerHandle);
		});

		// background sonus process sends its config info
		// so we don't have to figure out differently
		this.ioClient.on("info", (info) => {
			// indicate we have no hotwords
			//if(redebug)
			console.log("got info");

			this.startRecognizerProcess(this.port);
			this.ready = true;
		});

		// start our recorder
		this.ioClient.on("stopped", () => {
			// background task paused
			// start our reco engine
			//if(redebug)
			waitRunning("arecord", false, 1000).then(
				() => {
					console.log("background recorder stopped, start ours");
					this.voiceClient.emit("start");
					this.recording = true;
				},
				() => {
					console.log(
						"main recorder hasn't stopped yet, lets try again"
					);
					this.ioClient.emit("stop");
				}
			);
		});

		this.ioClient.on("started", () => {
			if (redebug) console.log("native reco started");
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
						"assistant received partial text from reco engine=" +
							message
					);
				this.Emitter.emit("partial", message);
				// turn off our reco engine
			});

			this.voiceClient.on("final-text", (message) => {
				if (redebug)
					console.log(
						"assistant received final text from reco engine=" +
							message
					);
				this.Emitter.emit("final", message);
				// turn off our reco engine
				this.voiceClient.emit("stop");
			});

			this.voiceClient.on("error", (error) => {
				// pass it on
				this.Emitter.emit("error", error);
			});

			this.voiceClient.on("started", (error) => {
				// pass it on
				if (redebug) console.log("our recorder says it started ");
				waitRunning("arecord", true, 1000).then(
					() => {
						console.log("our recorder did start");
						this.recording = true;
					},
					() => {
						console.log("our recorder did NOT start, trying again");
						this.voiceClient.emit("start");
					}
				);
			});

			// our background responds stopped to the final-text event stop that was sent
			this.voiceClient.on("stopped", () => {
				// turn back on the mirrors engine

				if (redebug) console.log("assistant pause to restart");
				let self = this;
				// 200ms quiet time
				waitRunning("arecord", false, 1000).then(
					() => {
						if (redebug)
							console.log("assistant restarting base reco");
						// tell the smart mirror reco engine to resume now
						self.ioClient.emit("start");
					},
					() => {
						console.log("assistant recorder hasn't stopped yet");
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
			this.kwsProcess = spawn(
				"node",
				[__dirname + "/sonus.js", socketNumber],
				{
					detached: false,
				}
			);
			this.kwsProcess.on("error", (err) => {
				console.error("assistant spawn err: ", err);
			});
			this.kwsProcess.on("exit", (code, signal) => {
				if (code) {
					console.error("assistant Child exited with code", code);
				} else if (signal) {
					console.error(
						"assistant Child was killed with signal",
						signal
					);
				} else {
					if (redebug) console.log("assistant Child exited okay");
				}
			});
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
		this.Emitter = new EventEmitter();

		if (redebug) console.log("assistant requesting port");
		// ask for a range
		var self = this;
		// get a free port
		getPort({ port: getPort.makeRange(5100, 5200) })
			.then((port) => {
				port = 5100;
				// use first available
				if (redebug)
					console.log("assistant have available ports =", port);
				// wil be the port we use for OUR reco engine control
				self.port = port;

				if (redebug)
					console.log("assistant have available port=" + self.port);
				// connect to the smart-mirror reco process
				// io client to background sonus
				self.ioClient = io.connect(self.host + ":" + this.sm_port);

				// setup the handlers
				self.init();

				// do this last, prevent race condition of server sending back

				self.timerHandle = setTimeout(function () {
					self.reject("no response");
				}, 8000);

				// connect to the sonus process and get its config info
				self.ioClient.emit("getinfo");
				// we start idle
				self.recording = false;
			})
			.catch((error) => {
				if (redebug)
					console.log("assistant port request failed=" + error);
			});
	});
};
recorder.prototype.start = function () {
	if (this.ready) {
		// tell the background sonus to stop
		// this will auto start our engine
		this.ioClient.emit("stop");
	}
};
// not sure what to do here
recorder.prototype.stop = function () {
	if (redebug) console.log("stop");
	this.ioClient.emit("start");
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
