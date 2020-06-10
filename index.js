// My module

const io = require("socket.io-client");
// Configure Sonus
const Sonus = require("sonus");
const EventEmitter = require("events");

function recorder(host, port) {
	this.host = "http://" + (host ? host : "localhost");
	this.port = port;
	this.sonus = null;
	this.ioClient = null;
	this.Emitter = null;
	this.recording = false;
	this.ready = false;

	this.init = function () {
		this.ioClient.on("connected", (socket) => {
			//console.log("connected")
		});

		// background sonus process sends its config info
		// so we don't have to figure out differently
		this.ioClient.on("info", (info) => {
			// indicate we have no hotwords
			console.log("got info");
			info.hotwords = -1;
			// sget reco enfine ready
			sonus = Sonus.init(info, this.client);
			this.ready = true;
			// tell waiting open task
			this.resolve(this.Emitter);

			sonus.on("us error", (error) => {
				console.log("sonus error");
			});

			// we get these, but don't care
			sonus.on("partial-result", (partial) => {
				//console.log("sonus partial="+partial)
			});

			// final full transcript of spoken words
			sonus.on("final-result", (transcript) => {
				// send the transcript to the requestor
				this.Emitter.emit("text", transcript);
				// stop our reco engine
				Sonus.stop();
				//inidcate we are not recording
				this.recording = false;
				// tell the background task to start rec again
				this.ioClient.emit("start");
			});
		});

		// start our recorder
		this.ioClient.on("stopped", () => {
			// background task paused
			// start our reco engine
			Sonus.start(sonus);
			this.recording = true;
		});

		this.ioClient.on("started", () => {
			//console.log("native reco started");
		});
	};
}

recorder.prototype.open = function (client) {
	return new Promise((resolve, reject) => {
		// cloud speech reco client
		this.resolve = resolve;
		this.reject = reject;
		this.client = client;
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
