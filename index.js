"use strict";
// My module

const io = require("socket.io-client");
const EventEmitter = require("events");
const { spawn } = require("child_process");

function recorder(host, port) {
	this.host = "http://" + (host ? host : "localhost");
	this.port = port;
	this.ioClient = null;
	this.voiceClient = null;
	this.Emitter = null;
	this.recording = false;
	this.ready = false;
	this.kwsProcess = null;

	this.init = function () {
		this.ioClient.on("connected", (socket) => {
			//console.log("connected")
		});

		// background sonus process sends its config info
		// so we don't have to figure out differently
		this.ioClient.on("info", (info) => {
			// indicate we have no hotwords
			//console.log("got info");

			this.startSonus(this.port - 2);
			this.ready = true;
		});

		// start our recorder
		this.ioClient.on("stopped", () => {
			// background task paused
			// start our reco engine
			//console.log("background recorder stopped, start ours")
			this.voiceClient.emit("start");
			this.recording = true;
		});

		this.ioClient.on("started", () => {
			//console.log("native reco started");
		});
	};

	this.waitSocket = function (socket) {
		var self = this;
		//console.log("enter wait socket="+socket)
		if (!this.voiceClient) {
			//console.log("host="+this.host + ":" +socket)
			this.voiceClient = io.connect(this.host + ":" + socket);
			//console.log("connecting to the voice client socket ="+socket)
			this.timer = setTimeout(function () {
				self.waitSocket(socket);
			}, 500);
		} else {
			//console.log("have the voice client socket")
			clearTimeout(this.timer);
			// tell waiting open task
			this.voiceClient.on("text", (message) => {
				//console.log("received text from reco engine="+message)
				this.Emitter.emit("text", message);
				// turn off our reco engine
				this.voiceClient.emit("stop");
				// turn back on the mirrors engine
				this.ioClient.emit("start");
			});
			this.resolve(this.Emitter);
		}
	};
	this.startSonus = function (socketNumber) {
		// Initilize the keyword spotter
		//console.log("process starting in the background")
		this.kwsProcess = spawn("node", ["./sonus.js", socketNumber], {
			detached: false,
		});
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
		// io clicne to bnackground sonus
		this.ioClient = io.connect(this.host + ":" + this.port);

		// setup the handlers
		this.init();
		var self = this;
		// do this last, prevent race condition of server sending back
		this.timerHandle = setTimeout(function () {
			self.reject("no response");
		}, 1500);
		// connect to the sonus process and get its config info
		this.ioClient.emit("getinfo");
		// we start idle
		this.recording = false;
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
	//console.log("stop");
};
// not sure what to do here
recorder.prototype.close = function () {
	//console.log("close");
};
// are we recording ?
recorder.prototype.recording = function () {
	return this.recording;
};

module.exports = recorder;
