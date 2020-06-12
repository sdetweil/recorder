"use strict";
// My module

const io = require("socket.io-client");
const EventEmitter = require("events");
const { spawn } = require("child_process");
const getPort = require("get-port");
const kws_active = false;
const redebug = false;
if (redebug) console.log("our location=" + __dirname);
function recorder(smart_mirror_remote_port) {
	this.host = "http://localhost";
	this.sm_port = smart_mirror_remote_port + 1;
	this.port = 0;
	this.ioClient = null;
	this.voiceClient = null;
	this.Emitter = null;
	this.recording = false;
	this.ready = false;
	this.kwsProcess = null;

	this.init = function () {
		this.ioClient.on("connected", (socket) => {
			//if(redebug)
			console.log("connected");
		});

		// background sonus process sends its config info
		// so we don't have to figure out differently
		this.ioClient.on("info", (info) => {
			// indicate we have no hotwords
			//if(redebug)
			console.log("got info");

			this.startSonus(this.port);
			this.ready = true;
		});

		// start our recorder
		this.ioClient.on("stopped", () => {
			// background task paused
			// start our reco engine
			//if(redebug)
			console.log("background recorder stopped, start ours");
			this.voiceClient.emit("start");
			this.recording = true;
		});

		this.ioClient.on("started", () => {
			if (redebug) console.log("native reco started");
		});
	};

	this.waitSocket = function (socket) {
		var self = this;
		if (redebug) console.log("enter wait socket=" + socket);
		if (!this.voiceClient) {
			if (redebug) console.log("host=" + this.host + ":" + socket);
			this.voiceClient = io.connect(this.host + ":" + socket);
			if (redebug)
				console.log("connecting to the voice client socket =" + socket);
			this.timer = setTimeout(function () {
				self.waitSocket(socket);
			}, 500);
		} else {
			if (redebug) console.log("have the voice client socket");
			clearTimeout(this.timer);
			// tell waiting open task
			this.voiceClient.on("partial-text", (message) => {
				if (redebug)
					console.log(
						"assistant received partial from reco engine=" + message
					);
				this.Emitter.emit("partial", message);
				// turn off our reco engine
			});
			this.voiceClient.on("final-text", (message) => {
				if (redebug)
					console.log(
						"assistant received text from reco engine=" + message
					);
				this.Emitter.emit("final", message);
				// turn off our reco engine
				this.voiceClient.emit("stop");
			});
			this.voiceClient.on("stopped", () => {
				// turn back on the mirrors engine
				let self = this;
				// 200ms quiet time
				setTimeout(() => {
					self.ioClient.emit("start");
				}, 100);
			});
			this.resolve(this.Emitter);
		}
	};
	this.startSonus = function (socketNumber) {
		// Initilize the keyword spotter
		//if(redebug)
		console.log("process starting in the background");
		if (kws_active) {
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
		getPort({ port: getPort.makeRange(5100, 5200) })
			.then((port) => {
				port = 5100;
				// use first available
				if (redebug)
					console.log("assistant have available ports =", port);
				self.port = port;
				if (redebug)
					console.log("assistant have available port=" + self.port);

				// io client to background sonus
				self.ioClient = io.connect(self.host + ":" + this.sm_port);

				// setup the handlers
				self.init();

				// do this last, prevent race condition of server sending back

				self.timerHandle = setTimeout(function () {
					self.reject("no response");
				}, 1500);

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
		this.ioClient.emit("stop");
	}
};
// not sure what to do here
recorder.prototype.stop = function () {
	//if(redebug)
	console.log("stop");
};
// not sure what to do here
recorder.prototype.close = function () {
	//if(redebug)
	console.log("close");
};
// are we recording ?
recorder.prototype.recording = function () {
	return this.recording;
};

module.exports = recorder;
